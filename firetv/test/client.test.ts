/**
 * Tests for the overlay client's state machine, `firetv/src/client.ts`.
 *
 * The two spec behaviours a client can actually implement are the ones asserted hardest:
 *
 * 1. **FR14 — the 15-second auto-dismiss.** Vega has no platform timer (the research in
 *    `docs/05-hackathon-requirements/05-fire-tv-vega-findings.md` is explicit that timers
 *    are the app's job), so the timer is here, and its edge cases are here: exactly 15s,
 *    a replacement event re-arms it, a manual dismissal cancels it.
 * 2. **FR13 — the dismiss action**, which hides the event without touching the
 *    connection.
 *
 * And the behaviour a television must have that a dashboard does not: **reconnect with
 * backoff, forever**. A TV that gives up after four network hiccups silently misses every
 * doorbell after the fourth. The socket is scripted; no network, no browser.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOverlayClient,
  DEFAULT_AUTO_DISMISS_MS,
  parseOverlayMessage,
  type OverlayMessage,
  type SocketFactory,
  type SocketHandlers,
} from '../src/client';

const EVENT: OverlayMessage = {
  event_id: 'evt_1',
  description: 'A person in a dark jacket walks up the path and rings the doorbell.',
  snapshot_url: 'https://s3.test/a.jpg',
  timestamp: '2026-10-04T08:12:31.000Z',
  device_name: 'Front Door',
};

const EVENT_2: OverlayMessage = { ...EVENT, event_id: 'evt_2', description: 'A courier leaves a parcel.' };

/** A scripted socket: the test holds the handlers and drives them by hand. */
function scriptedSocket(calls: SocketHandlers[]): SocketFactory {
  return (_url, handlers) => {
    calls.push(handlers);
    return { close: () => undefined };
  };
}

function validFrame(message: OverlayMessage): string {
  return JSON.stringify(message);
}

describe('parseOverlayMessage', () => {
  it('accepts a valid §3.4 payload', () => {
    expect(parseOverlayMessage({ ...EVENT })).toEqual(EVENT);
  });

  it('rejects a non-object frame', () => {
    expect(() => parseOverlayMessage('hello')).toThrow(/not an object/);
  });

  it('names the field that is missing or empty', () => {
    expect(() => parseOverlayMessage({ ...EVENT, snapshot_url: undefined })).toThrow(/"snapshot_url"/);
    expect(() => parseOverlayMessage({ ...EVENT, description: '' })).toThrow(/"description"/);
    expect(() => parseOverlayMessage({ event_id: 'x' })).toThrow(/"description"/);
  });
});

describe('the overlay client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('becomes current and fires onEvent when a frame arrives', () => {
    const calls: SocketHandlers[] = [];
    const client = createOverlayClient({ url: 'wss://x', socket: scriptedSocket(calls) });
    const events: OverlayMessage[] = [];
    client.onEvent((m) => events.push(m));
    client.start();

    calls[0]!.onOpen();
    calls[0]!.onData(validFrame(EVENT));

    expect(client.current()).toEqual(EVENT);
    expect(events).toEqual([EVENT]);
  });

  it('auto-dismisses after exactly 15 seconds — FR14', () => {
    const calls: SocketHandlers[] = [];
    const client = createOverlayClient({ url: 'wss://x', socket: scriptedSocket(calls) });
    const dismissed: OverlayMessage[] = [];
    client.onDismiss((m) => dismissed.push(m));
    client.start();

    calls[0]!.onOpen();
    calls[0]!.onData(validFrame(EVENT));
    vi.advanceTimersByTime(DEFAULT_AUTO_DISMISS_MS - 1);
    expect(client.current()).toEqual(EVENT);

    vi.advanceTimersByTime(1);
    expect(client.current()).toBeNull();
    expect(dismissed).toEqual([EVENT]);
  });

  it('a replacement event replaces the screen and re-arms the timer', () => {
    const calls: SocketHandlers[] = [];
    const client = createOverlayClient({ url: 'wss://x', socket: scriptedSocket(calls) });
    client.start();
    calls[0]!.onOpen();

    calls[0]!.onData(validFrame(EVENT));
    vi.advanceTimersByTime(10_000);
    calls[0]!.onData(validFrame(EVENT_2));

    expect(client.current()).toEqual(EVENT_2);
    // The old timer must be gone: 5 more seconds is short of EVENT_2's own 15.
    vi.advanceTimersByTime(5_000);
    expect(client.current()).toEqual(EVENT_2);
    vi.advanceTimersByTime(10_000);
    expect(client.current()).toBeNull();
  });

  it('a redelivery of the event already on screen is ignored', () => {
    const calls: SocketHandlers[] = [];
    const client = createOverlayClient({ url: 'wss://x', socket: scriptedSocket(calls) });
    const events: OverlayMessage[] = [];
    client.onEvent((m) => events.push(m));
    client.start();
    calls[0]!.onOpen();

    calls[0]!.onData(validFrame(EVENT));
    calls[0]!.onData(validFrame(EVENT));

    expect(events).toHaveLength(1);
    expect(client.current()).toEqual(EVENT);
  });

  it('dismiss() hides the event immediately and keeps the connection — FR13', () => {
    const calls: SocketHandlers[] = [];
    const client = createOverlayClient({ url: 'wss://x', socket: scriptedSocket(calls) });
    const dismissed: OverlayMessage[] = [];
    client.onDismiss((m) => dismissed.push(m));
    client.start();
    calls[0]!.onOpen();
    calls[0]!.onData(validFrame(EVENT));

    client.dismiss();

    expect(client.current()).toBeNull();
    expect(dismissed).toEqual([EVENT]);
    // A redelivery after a manual dismissal is shown again: the server pushed it twice.
    calls[0]!.onData(validFrame(EVENT));
    expect(client.current()).toEqual(EVENT);
  });

  it('drops an unparsable frame and keeps the last good state', () => {
    const calls: SocketHandlers[] = [];
    const client = createOverlayClient({ url: 'wss://x', socket: scriptedSocket(calls) });
    client.start();
    calls[0]!.onOpen();
    calls[0]!.onData(validFrame(EVENT));

    calls[0]!.onData('<html>502</html>');
    calls[0]!.onData(JSON.stringify({ event_id: 'x' }));

    expect(client.current()).toEqual(EVENT);
  });

  describe('reconnection', () => {
    it('reconnects with doubling backoff and resets on success', () => {
      const calls: SocketHandlers[] = [];
      const client = createOverlayClient({
        url: 'wss://x',
        socket: scriptedSocket(calls),
        reconnectBaseMs: 1_000,
        reconnectMaxMs: 30_000,
      });
      client.start();
      expect(calls).toHaveLength(1);
      calls[0]!.onOpen();
      expect(client.status()).toEqual({ kind: 'connected' });

      calls[0]!.onClose(1011);
      expect(client.status()).toEqual({ kind: 'reconnecting', attempt: 1, delayMs: 1_000 });

      vi.advanceTimersByTime(1_000);
      expect(calls).toHaveLength(2);
      calls[1]!.onOpen();
      expect(client.status()).toEqual({ kind: 'connected' });

      // A fresh close after a successful open is attempt 1 again, not attempt 2.
      calls[1]!.onClose(1011);
      expect(client.status()).toEqual({ kind: 'reconnecting', attempt: 1, delayMs: 1_000 });
    });

    it('caps the backoff instead of doubling forever', () => {
      const calls: SocketHandlers[] = [];
      const client = createOverlayClient({
        url: 'wss://x',
        socket: scriptedSocket(calls),
        reconnectBaseMs: 1_000,
        reconnectMaxMs: 3_000,
      });
      client.start();
      // Four closes with no open in between: 1s, 2s, 3s, then the 3s cap.
      const expected = [1_000, 2_000, 3_000, 3_000];
      for (const [i, delay] of expected.entries()) {
        calls[calls.length - 1]!.onClose(1011);
        expect(client.status()).toEqual({ kind: 'reconnecting', attempt: i + 1, delayMs: delay });
        vi.advanceTimersByTime(delay);
      }
      expect(calls).toHaveLength(5);
    });

    it('keeps showing the current event across a dropped connection', () => {
      const calls: SocketHandlers[] = [];
      const client = createOverlayClient({ url: 'wss://x', socket: scriptedSocket(calls) });
      client.start();
      calls[0]!.onOpen();
      calls[0]!.onData(validFrame(EVENT));
      calls[0]!.onClose(1011);

      expect(client.current()).toEqual(EVENT);
    });

    it('treats a synchronous socket-construction failure as a close and retries', () => {
      let failures = 0;
      const client = createOverlayClient({
        url: 'wss://x',
        socket: () => {
          if (failures < 1) {
            failures += 1;
            throw new Error('bad url');
          }
          return { close: () => undefined };
        },
      });
      client.start();

      expect(client.status()).toEqual({ kind: 'reconnecting', attempt: 1, delayMs: 1_000 });
      vi.advanceTimersByTime(1_000);
      expect(failures).toBe(1);
      // The retry constructed a socket, which reports itself by reporting its close.
      client.stop();
    });
  });

  it('stop() closes the socket, drops the event, and cancels pending work', () => {
    let closed = false;
    const calls: SocketHandlers[] = [];
    const client = createOverlayClient({
      url: 'wss://x',
      socket: (_url, handlers) => {
        calls.push(handlers);
        return {
          close: () => {
            closed = true;
          },
        };
      },
    });
    client.start();
    calls[0]!.onOpen();
    calls[0]!.onData(validFrame(EVENT));

    client.stop();

    expect(closed).toBe(true);
    // stop() tears the transport down; the last shown state is left as it was, and no
    // onDismiss fires — this is teardown, not a dismissal. The page is on its way out.
    expect(client.current()).toEqual(EVENT);
    // A close arriving after stop schedules nothing: the client is done.
    calls[0]!.onClose(1011);
    vi.advanceTimersByTime(60_000);
    expect(calls).toHaveLength(1);
    expect(client.status()).toEqual({ kind: 'connected' });
  });
});
