/**
 * Tests for the overlay's DOM shell, `firetv/src/app.ts`, against the minimal fake DOM.
 *
 * What a shell is uniquely responsible for, and therefore what these assert:
 *
 * 1. **The dismiss control exists as a real button** (FR13) — on a TV it is reachable by
 *    D-pad focus or it does not exist — and clicking it hides the event.
 * 2. **The connection state is always on screen.** A silent overlay after a dropped
 *    socket reads as "nothing is at the door", which is a confident false statement
 *    about someone's home.
 * 3. **The snapshot is alt-texted with the description**, the same rule as the dashboard.
 *
 * Layout, styling, and focus behaviour are verified only by a real render.
 */

import { describe, expect, it } from 'vitest';

import { paint, start } from '../src/app';
import { createOverlayClient, type OverlayMessage, type SocketFactory } from '../src/client';
import { byClass, byTag, texts, withFakeDom } from './fake-dom';

const EVENT: OverlayMessage = {
  event_id: 'evt_1',
  description: 'A white van parks at the kerb and a driver leaves a medium parcel at the door.',
  snapshot_url: 'https://s3.test/a.jpg',
  timestamp: '2026-10-04T09:47:02.000Z',
  device_name: 'Front Door',
};

type Handlers = Parameters<SocketFactory>[1];

/** A scripted socket; the test holds the handlers and drives them by hand. */
function scriptedSocket(calls: Handlers[]): SocketFactory {
  return (_url, handlers) => {
    calls.push(handlers);
    return { close: () => undefined };
  };
}

/** A client wired the way `start()` wires one: repaint on every state change. */
function wiredClient(
  root: HTMLElement,
): ReturnType<typeof start> & { calls: Handlers[] } {
  const calls: Handlers[] = [];
  const client = start(root, scriptedSocket(calls), 'wss://x');
  return Object.assign(client, { calls });
}

describe('paint', () => {
  it('renders the waiting state and the connection line when nothing is showing', () => {
    const { root, restore } = withFakeDom();
    try {
      const client = createOverlayClient({ url: 'wss://x', socket: () => ({ close() {} }) });
      paint(root as unknown as HTMLElement, client);

      expect(byClass(root, 'overlay-card')).toHaveLength(0);
      expect(texts(root)).toContain('Waiting for the front door…');
      expect(texts(root)).toContain('Connecting…');
    } finally {
      restore();
    }
  });
});

describe('the wired shell', () => {
  it('renders the event: sentence, device, time, snapshot, dismiss button', () => {
    const { root, restore } = withFakeDom();
    try {
      const client = wiredClient(root as unknown as HTMLElement);
      client.calls[0]!.onOpen();
      client.calls[0]!.onData(JSON.stringify(EVENT));

      expect(byClass(root, 'overlay-card')).toHaveLength(1);
      expect(texts(root)).toContain(EVENT.description);
      expect(texts(root)).toContain('Front Door');
      expect(texts(root)).toContain('09:47 UTC');
      expect(texts(root)).toContain('Dismiss');
      expect(texts(root)).toContain('Live');

      const images = byTag(root, 'img');
      expect(images).toHaveLength(1);
      expect(images[0]?.src).toBe(EVENT.snapshot_url);
      expect(images[0]?.alt).toBe(EVENT.description);
    } finally {
      restore();
    }
  });

  it('clicking Dismiss hides the event and shows the waiting state again', () => {
    const { root, restore } = withFakeDom();
    try {
      const client = wiredClient(root as unknown as HTMLElement);
      client.calls[0]!.onOpen();
      client.calls[0]!.onData(JSON.stringify(EVENT));

      const button = byTag(root, 'button')[0]!;
      expect(button.textContent).toBe('Dismiss');
      for (const fn of button.listeners['click'] ?? []) fn();

      expect(client.current()).toBeNull();
      expect(byClass(root, 'overlay-card')).toHaveLength(0);
      expect(texts(root)).toContain('Waiting for the front door…');
    } finally {
      restore();
    }
  });

  it('says the connection is down rather than looking live', () => {
    const { root, restore } = withFakeDom();
    try {
      const client = wiredClient(root as unknown as HTMLElement);
      client.calls[0]!.onOpen();
      client.calls[0]!.onData(JSON.stringify(EVENT));
      client.calls[0]!.onClose(1011);

      // The event stays on screen, but the status line tells the truth.
      expect(byClass(root, 'overlay-card')).toHaveLength(1);
      expect(texts(root)).toContain('Reconnecting (attempt 1)…');
    } finally {
      restore();
    }
  });
});

describe('the overlay entry wiring', () => {
  it('start() connects, paints, and repaints on events', () => {
    const { root, restore } = withFakeDom();
    try {
      const calls: Handlers[] = [];
      const client = start(
        root as unknown as HTMLElement,
        (_url, handlers) => {
          calls.push(handlers);
          return { close() {} };
        },
        'wss://x',
      );

      expect(texts(root)).toContain('Connecting…');
      calls[0]!.onOpen();
      calls[0]!.onData(JSON.stringify(EVENT));

      expect(client.current()).toEqual(EVENT);
      expect(byClass(root, 'overlay-card')).toHaveLength(1);
      expect(texts(root)).toContain('Live');
    } finally {
      restore();
    }
  });

  it('imports the entry without throwing when there is nothing on the page', async () => {
    // main.ts reads `window.location` at module scope, so the stub needs one field —
    // enough to run the demo branch, which finds no #overlay and stops. The classic
    // entry-point bug is a throw during evaluation; this catches exactly that.
    const { restore } = withFakeDom();
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { search: '' } };
    try {
      await expect(import('../src/main')).resolves.toBeDefined();
    } finally {
      (globalThis as { window?: unknown }).window = previousWindow;
      restore();
    }
  });
});
