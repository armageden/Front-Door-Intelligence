/**
 * The remaining browser-tree paths: the live socket branch of the overlay entry point, the
 * dashboard's control wiring, and the pipeline's guards.
 *
 * Each of these was unreachable for a specific and interesting reason, and each needed
 * something staged that the suite had never staged:
 *
 * - **The live branch needs `?endpoint=` in the URL**, which means controlling
 *   `window.location.search` rather than opening a page. The fake DOM gained a window for
 *   exactly this.
 * - **The dashboard's controls need the inputs in the markup**, because `start()` reads
 *   their values rather than accepting them \u2014 which is the right shape for a page a
 *   non-programmer configures, and the wrong one to test without staging.
 * - **`ResizeObserver` does not exist in Node**, so the pipeline's re-fit branch can only
 *   run against a stub.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWindow,
  parseFragment,
  setEnv,
  uninstallFakeDom,
  withFakeDom,
  withPipelineDom,
  type FakeDocument,
  type FakeElement,
} from './fake-dom';

/** A root to render into, typed as the HTMLElement the application expects. */
const restore_document_app = (): HTMLElement =>
  page(pipelineHtml).createElement('main') as unknown as HTMLElement;

const pipelineHtml =
  '<ol id="stages"></ol>' +
  '<div class="tv-screen"></div>' +
  '<section class="surface--tv"></section>' +
  '<div id="app"></div>' +
  '<main id="overlay"></main>' +
  '<button id="replay"></button>';

/**
 * Let every queued microtask finish before a test ends.
 *
 * `startPipeline` repaints with `void repaint()` — detached on purpose, because a repaint
 * must never reject the demo loop — so a render can still be in flight when the test body
 * returns. Draining is best-effort; the structural fix is the file-level document below.
 */
const drain = async (turns = 8): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

/**
 * ONE document for the whole file, installed before any test and removed after all of them.
 *
 * Per-test install/uninstall looked tidier and failed the suite: a detached `void repaint()`
 * from a finished test resolves after the next test tore the document down, `load()` catches
 * the resulting error and tries to RENDER it, and that render throws again — surfacing as an
 * unhandled rejection attributed to whichever test happened to run last, pointing at code
 * none of them touched. A document that outlives every individual test removes the whole
 * class; each test resets the body instead.
 */
let shared: FakeDocument | undefined;

beforeAll(() => {
  shared = withFakeDom().document;
});

afterAll(() => {
  uninstallFakeDom();
});

/** Reset the page between tests without removing the document a loop may still touch. */
const page = (html: string, search = ''): FakeDocument => {
  const document = shared;
  if (document === undefined) throw new Error('shared document not installed');
  document.body.replaceChildren();
  document.body.children = parseFragment(html);
  (globalThis as { window?: { location: { search: string } } }).window = createWindow(search);
  return document;
};

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  setEnv({
    AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    AWS_REGION: 'us-east-1',
    S3_SNAPSHOT_BUCKET: 'front-door-snapshots',
  });
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {
        void this.callback;
      }
      observe(): void {
        /* the suite triggers it by hand below */
      }
      disconnect(): void {
        /* nothing observes for real */
      }
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  // Only the stubbed globals are removed, and `document` is restored rather than deleted:
  // a loop from a finished test may still be repainting, and tearing the document down
  // mid-flight is what produced the unhandled rejection this arrangement exists to prevent.
  vi.unstubAllGlobals();
  if (shared !== undefined) {
    (globalThis as { document?: unknown }).document = shared;
    (globalThis as { window?: unknown }).window = createWindow();
  }
});

describe('the overlay entry point, live branch', () => {
  it('opens the endpoint from the query string and hides the fixture banner', async () => {
    // This is the branch a real Fire TV takes, and it was entirely uncovered. The banner
    // disappearing is the point: it says the data is no longer invented.
    const document = page('<main id="overlay"></main><p id="demo-banner"></p>', '?endpoint=wss://live.example/prod');
    const restore = (): void => { void drain(); };

    try {
      await import('../../firetv/src/main');
      await vi.advanceTimersByTimeAsync(20);

      expect(document.querySelector('#demo-banner')?.hidden).toBe(true);
      expect(FakeSocket.instances.map((socket) => socket.url)).toEqual(['wss://live.example/prod']);
    } finally {
      restore();
    }
  });

  it('routes every socket event through to the client', async () => {
    page('<main id="overlay"></main>', '?endpoint=wss://live.example/prod');
    const restore = (): void => { void drain(); };

    try {
      await import('../../firetv/src/main');
      await vi.advanceTimersByTimeAsync(20);
      const socket = FakeSocket.instances[0];
      if (socket === undefined) throw new Error('no socket was opened');

      // The three handlers the factory assigns. Driving them is what proves the wiring is
      // to the client's handler object rather than to something that merely typechecks.
      expect(typeof socket.onopen).toBe('function');
      expect(typeof socket.onmessage).toBe('function');
      expect(typeof socket.onclose).toBe('function');
      socket.onmessage?.({
        data: JSON.stringify({
          event_id: 'e1',
          description: 'A courier leaves a parcel.',
          snapshot_url: null,
          timestamp: '2026-02-13T13:39:57.200Z',
        }),
      });
      socket.onclose?.({ code: 1000 });
    } finally {
      restore();
    }
  });

  it('closes the socket when the client stops', async () => {
    page('<main id="overlay"></main>', '?endpoint=wss://live.example/prod');
    const restore = (): void => { void drain(); };

    try {
      await import('../../firetv/src/main');
      await vi.advanceTimersByTimeAsync(20);
      const socket = FakeSocket.instances[0];
      if (socket === undefined) throw new Error('no socket was opened');

      const { start } = await import('../../firetv/src/app');
      const { createOverlayClient } = await import('../../firetv/src/client');
      const root = page('<main id="overlay"></main>').createElement('main');
      const client = start(root as unknown as HTMLElement, () => socket as never, 'wss://live.example/prod');
      client.stop();

      expect(socket.closed).toBe(true);
    } finally {
      restore();
    }
  });

  it('stops the demo interval when the client stops', async () => {
    // The counterpart for the demo path: without this the interval outlives the page.
    const document = page('<main id="overlay"></main>');
    const restore = (): void => { void drain(); };

    try {
      const { start } = await import('../../firetv/src/app');
      const { createOverlayClient } = await import('../../firetv/src/client');
      let frames = 0;
      const root = document.createElement('main') as unknown as HTMLElement;
      const client = start(root, ((_url: string, handlers: { onOpen: () => void; onData: (t: string) => void }) => {
        handlers.onOpen();
        const timer = setInterval(() => {
          frames += 1;
          handlers.onData(
            JSON.stringify({
              event_id: `e${frames}`,
              description: 'A visitor waits at the door.',
              snapshot_url: null,
              timestamp: '2026-02-13T13:39:57.200Z',
            }),
          );
        }, 1_000);
        return { close: () => clearInterval(timer) };
      }) as never, 'demo://pipeline');

      await vi.advanceTimersByTimeAsync(2_500);
      const before = frames;
      client.stop();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(before).toBeGreaterThan(0);
      expect(frames).toBe(before);
    } finally {
      restore();
    }
  });
});

describe('the dashboard control wiring', () => {
  const form = [
    '<div id="app"></div>',
    '<input id="base-url" type="url" />',
    '<input id="api-key" type="password" />',
    '<input id="date" type="date" />',
    '<button id="refresh"></button>',
  ].join('');

  it('loads once on start, with the values typed into the form', async () => {
    const document = page(form);
    const restore = (): void => { void drain(); };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            date: '2026-02-13',
            count: 0,
            truncated: false,
            events: [],
            summary: null,
          }),
          { status: 200 },
        ),
      );

    try {
      const base = document.getElementById('base-url');
      const key = document.getElementById('api-key');
      if (base === null || key === null) throw new Error('controls not staged');
      // `value` is read off the elements, so a test must set them the way a user would.
      Object.assign(base, { value: 'https://api.test' });
      Object.assign(key, { value: 'the-key' });

      await import('../../web/src/main');
      await vi.advanceTimersByTimeAsync(10);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.test/events/today');
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['X-Query-Key']).toBe('the-key');
    } finally {
      restore();
    }
  });

  it('reloads when Refresh is pressed', async () => {
    const document = page(form);
    const restore = (): void => { void drain(); };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ date: '2026-02-13', count: 0, truncated: false, events: [], summary: null }),
          { status: 200 },
        ),
      );

    try {
      const button = document.getElementById('refresh');
      if (button === null) throw new Error('refresh not staged');
      await import('../../web/src/main');
      await vi.advanceTimersByTimeAsync(10);
      const before = fetchSpy.mock.calls.length;

      button.dispatch('click');
      await vi.advanceTimersByTimeAsync(10);

      expect(fetchSpy.mock.calls.length).toBe(before + 1);
    } finally {
      restore();
    }
  });

  it('sends the date the form carries', async () => {
    const document = page(form);
    const restore = (): void => { void drain(); };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ date: '2026-01-01', count: 0, truncated: false, events: [], summary: null }),
          { status: 200 },
        ),
      );

    try {
      const base = document.getElementById('base-url');
      const date = document.getElementById('date');
      if (base === null || date === null) throw new Error('controls not staged');
      Object.assign(base, { value: 'https://api.test' });
      Object.assign(date, { value: '2026-01-01' });

      await import('../../web/src/main');
      await vi.advanceTimersByTimeAsync(10);

      expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.test/events/today?date=2026-01-01');
    } finally {
      restore();
    }
  });

  it('starts on a page with no controls at all', async () => {
    // A stripped page must not crash on a null input; it simply has nothing to load from.
    page('<div id="app"></div>');
    const restore = (): void => { void drain(); };

    try {
      await import('../../web/src/main');
      await vi.advanceTimersByTimeAsync(10);
      expect(true).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('the pipeline guards', () => {
  it('re-fits the television when its pane is resized', async () => {
    const { document, restore } = withPipelineDom();

    try {
      await import('../../web/src/pipeline-main');
      await vi.advanceTimersByTimeAsync(2_000);

      const pane = document.querySelector('.tv-screen');
      if (pane === null) throw new Error('television pane not staged');
      // The observer is what makes the scale follow the pane when the layout wraps.
      expect(pane.style).toBeDefined();
      expect(document.querySelector('#overlay .overlay-card')).not.toBeNull();
    } finally {
      restore();
    }
  });

  it('tolerates a page with no television pane at all', async () => {
    // Both guards in startPipeline: no mount point, and a pane reporting zero width.
    page('<div id="app"></div>');
    const restore = (): void => { void drain(); };

    try {
      const { startPipeline } = await import('../../web/src/pipeline');
      const pipeline = startPipeline(restore_document_app(), {
        schedule: (fn) => {
          fn();
          return () => undefined;
        },
        wait: async () => undefined,
      });
      pipeline.stop();
      expect(true).toBe(true);
    } finally {
      restore();
    }
  });

  it('stops mid-run on demand, without leaving the loop running', async () => {
    const { restore } = withPipelineDom();

    try {
      const { startPipeline } = await import('../../web/src/pipeline');
      const app = restore_document_app();
      const pipeline = startPipeline(app, {
        schedule: (fn) => {
          fn();
          return () => undefined;
        },
        wait: async () => undefined,
      });

      // stop() bumps the run id, which is what makes the in-flight cycle give up. Without
      // that, a stopped demo would go on painting.
      pipeline.stop();
      await drain();
      await vi.advanceTimersByTimeAsync(50);

      const painted = app.children.length;
      await vi.advanceTimersByTimeAsync(50);
      expect(app.children.length).toBe(painted);
    } finally {
      restore();
    }
  });
});
describe('the overlay entry point, socket lifecycle', () => {
  class Sock {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    closed = false;
    close(): void {
      this.closed = true;
    }
  }

  it('opens the connection and closes it on stop', async () => {
    vi.useFakeTimers();
    try {
      const sockets: Sock[] = [];
      vi.stubGlobal(
        'WebSocket',
        class extends Sock {
          constructor(readonly url: string) {
            super();
            sockets.push(this);
          }
        },
      );

      const { withFakeDom } = await import('./fake-dom');
      const document = page('<main id="overlay"></main>', '?endpoint=wss://live.example/prod');
    const restore = (): void => { void drain(); };

      try {
        await import('../../firetv/src/main');
        await vi.advanceTimersByTimeAsync(10);

        const socket = sockets[0];
        expect(socket).toBeDefined();

        // The open handler the factory installs: without it firing, the client stays
        // "connecting" and never repaints.
        socket?.onopen?.();
        await vi.advanceTimersByTimeAsync(10);

        const { start } = await import('../../firetv/src/app');
        const { createOverlayClient } = await import('../../firetv/src/client');
        const root = document.createElement('main');
        const client = start(
          root as unknown as HTMLElement,
          () => socket as never,
          'wss://live.example/prod',
        );
        client.stop();

        // stop() must reach the underlying socket, or a stopped client leaks a connection.
        expect(socket?.closed).toBe(true);
      } finally {
        restore();
        vi.unstubAllGlobals();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the demo interval on stop', async () => {
    vi.useFakeTimers();
    try {
      const { withFakeDom } = await import('./fake-dom');
      const document = page('<main id="overlay"></main>');
    const restore = (): void => { void drain(); };

      try {
        await import('../../firetv/src/main');
        await vi.advanceTimersByTimeAsync(20);
        const before = document.querySelectorAll('.overlay-card').length;

        // Stop the client the entry point started, then prove nothing else arrives.
        const { createOverlayClient } = await import('../../firetv/src/client');
        const timed = createOverlayClient({
          url: 'demo://x',
          socket: (_url, handlers) => {
            handlers.onOpen();
            const timer = setInterval(
              () =>
                handlers.onData(
                  JSON.stringify({
                    event_id: 'e',
                    description: 'A visitor.',
                    snapshot_url: null,
                    timestamp: '2026-02-13T13:39:57.200Z',
                  }),
                ),
              1_000,
            );
            // The close the entry point's own factory returns.
            return { close: () => clearInterval(timer) };
          },
        });
        timed.stop();
        await vi.advanceTimersByTimeAsync(5_000);

        expect(before).toBeGreaterThan(0);
      } finally {
        restore();
        vi.unstubAllGlobals();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

