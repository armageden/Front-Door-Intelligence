/**
 * The Fire TV overlay client's state machine: connection, payloads, dismissal.
 *
 * This file is deliberately DOM-free and Vega-free. It knows the §3.4 payload and the
 * two behaviours the spec asks of the overlay that a client *can* implement — the
 * 15-second auto-dismiss (FR14) and the dismiss action (FR13) — and nothing about how
 * pixels are drawn. `app.ts` paints what this decides; the Vega shell that would host
 * it inside the transparent `@amazon-devices/webview` sibling of the video surface is
 * documented in `docs/08-fire-tv-overlay/` rather than written here, because no Vega
 * toolchain exists in this repository's environment.
 *
 * ## The transport is a constructor argument
 *
 * The same seam as the dashboard's `fetchToday`: the client takes a `SocketFactory`
 * instead of constructing `WebSocket` itself. Tests inject a scripted socket, the demo
 * entry injects one that cycles fixture payloads, and the live entry injects the real
 * `WebSocket`. The state machine — the part worth testing — never knows the difference.
 */

/** `ARCHITECTURE.md` §3.4 payload, hand-mirrored from `src/lib/overlayPush.ts`. */
export interface OverlayMessage {
  readonly event_id: string;
  readonly description: string;
  readonly snapshot_url: string;
  readonly timestamp: string;
  readonly device_name: string;
}

/**
 * Narrow an unknown frame to `OverlayMessage`, or explain which field failed.
 *
 * The payload crosses the wire as JSON text pushed by `pushToConnections()`. A malformed
 * frame must be rejected with a nameable cause rather than rendered as an event with
 * `undefined` in it — the same rule the dashboard's `parseTodayResponse()` follows.
 */
export function parseOverlayMessage(data: unknown): OverlayMessage {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Overlay frame is not an object');
  }
  const candidate = data as Partial<Record<keyof OverlayMessage, unknown>>;
  for (const field of ['event_id', 'description', 'snapshot_url', 'timestamp', 'device_name'] as const) {
    const value = candidate[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Overlay frame field "${field}" is missing or empty`);
    }
  }
  return candidate as unknown as OverlayMessage;
}

/** What one open connection can do. `close()` is idempotent and may be called once. */
export interface SocketHandle {
  close(): void;
}

export interface SocketHandlers {
  onOpen(): void;
  /** One text frame. Already-read UTF-8, as the WebSocket API delivers it. */
  onData(text: string): void;
  /** The documented close code; 1011 is how API Gateway reports GoneException upstream. */
  onClose(code: number): void;
}

export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketHandle;

export type ClientStatus =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting'; attempt: number; delayMs: number };

export interface OverlayClientOptions {
  readonly url: string;
  readonly socket: SocketFactory;
  /** FR14. §3.4: the overlay auto-dismisses after 15 seconds. */
  readonly autoDismissMs?: number;
  /** First reconnect delay; doubles per attempt up to `reconnectMaxMs`. */
  readonly reconnectBaseMs?: number;
  readonly reconnectMaxMs?: number;
}

export interface OverlayClient {
  start(): void;
  /** Close the socket, cancel every timer. The client does not restart after this. */
  stop(): void;
  /** FR13. Hides the current overlay immediately; the connection stays up. */
  dismiss(): void;
  current(): OverlayMessage | null;
  status(): ClientStatus;
  onEvent(fn: (message: OverlayMessage) => void): void;
  onDismiss(fn: (message: OverlayMessage) => void): void;
  onStatus(fn: (status: ClientStatus) => void): void;
}

export const DEFAULT_AUTO_DISMISS_MS = 15_000;
export const DEFAULT_RECONNECT_BASE_MS = 1_000;
export const DEFAULT_RECONNECT_MAX_MS = 30_000;

/**
 * Build the client.
 *
 * Reconnect policy: every close schedules one retry at `base * 2^(attempt-1)`, capped at
 * `max`, and a successful open resets the attempt count. There is no give-up count — a
 * TV that stops trying because the network hiccuped four times is a TV that silently
 * misses every doorbell after the fourth hiccup. The cap keeps the backoff bounded
 * instead.
 */
export function createOverlayClient(options: OverlayClientOptions): OverlayClient {
  const autoDismissMs = options.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS;
  const reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
  const reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;

  let status: ClientStatus = { kind: 'connecting' };
  let current: OverlayMessage | null = null;
  let attempt = 0;
  let handle: SocketHandle | null = null;
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const eventListeners: ((message: OverlayMessage) => void)[] = [];
  const dismissListeners: ((message: OverlayMessage) => void)[] = [];
  const statusListeners: ((status: ClientStatus) => void)[] = [];

  function setStatus(next: ClientStatus): void {
    status = next;
    for (const fn of statusListeners) fn(status);
  }

  function clearDismissTimer(): void {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  function fire(message: OverlayMessage): void {
    current = message;
    for (const fn of eventListeners) fn(message);
    clearDismissTimer();
    dismissTimer = setTimeout(() => dismissNow(), autoDismissMs);
  }

  function dismissNow(): void {
    clearDismissTimer();
    if (current === null) return;
    const dismissed = current;
    current = null;
    for (const fn of dismissListeners) fn(dismissed);
  }

  function connect(): void {
    if (stopped) return;
    setStatus(attempt === 0 ? { kind: 'connecting' } : { kind: 'reconnecting', attempt, delayMs: 0 });
    try {
      handle = options.socket(options.url, {
        onOpen: () => {
          attempt = 0;
          setStatus({ kind: 'connected' });
        },
        onData: (text) => {
          let message: OverlayMessage;
          try {
            message = parseOverlayMessage(JSON.parse(text));
          } catch (error) {
            // A frame we cannot parse is dropped loudly in the console and silently on
            // screen: an overlay that half-renders a broken frame is worse than one that
            // keeps showing the last good state.
            console.warn('overlay client dropped an unparsable frame', error);
            return;
          }
          // Redelivery of the event already on screen is a duplicate, not news.
          if (current !== null && current.event_id === message.event_id) return;
          fire(message);
        },
        onClose: () => {
          if (stopped) return;
          handle = null;
          attempt += 1;
          const delayMs = Math.min(reconnectBaseMs * 2 ** (attempt - 1), reconnectMaxMs);
          setStatus({ kind: 'reconnecting', attempt, delayMs });
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, delayMs);
        },
      });
    } catch (error) {
      // A synchronous construction failure (a malformed URL, say) is a close like any
      // other: back off and try again rather than dying on a television nobody can watch.
      console.warn('overlay client socket construction failed', error);
      handle = null;
      attempt += 1;
      const delayMs = Math.min(reconnectBaseMs * 2 ** (attempt - 1), reconnectMaxMs);
      setStatus({ kind: 'reconnecting', attempt, delayMs });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    }
  }

  return {
    start() {
      connect();
    },

    stop() {
      stopped = true;
      clearDismissTimer();
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (handle !== null) {
        handle.close();
        handle = null;
      }
    },

    dismiss() {
      dismissNow();
    },

    current() {
      return current;
    },

    status() {
      return status;
    },

    onEvent(fn) {
      eventListeners.push(fn);
    },
    onDismiss(fn) {
      dismissListeners.push(fn);
    },
    onStatus(fn) {
      statusListeners.push(fn);
    },
  };
}
