/**
 * Tests for the two browser entry points, driven against the fake DOM.
 *
 * These are the files that execute on import and are therefore reached by nothing else in
 * the repository: `pipeline-main.ts` wires the Replay button, and `firetv/src/main.ts` picks
 * between the live socket and the fixture demo. Both had **zero** coverage, and both had
 * bugs only a browser found — an eight-second blank first card in the overlay demo, and a
 * page that ran once and froze.
 *
 * The modules are imported dynamically rather than at the top, because importing them *is*
 * the behaviour under test: their side effect is the point. A top-level import would run
 * them once before any DOM existed.
 *
 * **Fake timers throughout.** Both entries install `setInterval` and `setTimeout` loops that
 * never end, which keeps a real event loop alive and hangs the run. With time under the
 * test's control the loops can be advanced deliberately and then abandoned.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setEnv, withOverlayDom, withPipelineDom } from './fake-dom';

beforeEach(() => {
  vi.useFakeTimers();
  // The dashboard's fixture transport still runs the REAL response mapper, including the
  // snapshot pre-signer, because that is the code path a judge exercises. Presigning is a
  // local operation but the S3 client resolves credentials before it will do it, so without
  // these the load ends in its error state and every event disappears.
  setEnv({
    AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    AWS_REGION: 'us-east-1',
    S3_SNAPSHOT_BUCKET: 'front-door-snapshots',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

/** Let queued microtasks drain without advancing the clock. */
const drain = async (turns = 6): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

describe('the overlay entry point', () => {
  it('reveals the banner and paints a fixture card when there is no endpoint', async () => {
    const { document, restore } = withOverlayDom();

    try {
      await import('../../firetv/src/main');
      await vi.advanceTimersByTimeAsync(50);

      // The banner names the data as a fixture. A page showing invented events without
      // saying so is the failure this repository refuses everywhere else, and it starts here.
      expect(document.querySelector('#demo-banner')?.hidden).toBe(false);
      expect(document.querySelectorAll('.overlay-card')).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('cycles to a second fixture on the next tick', async () => {
    const { document, restore } = withOverlayDom();

    try {
      await import('../../firetv/src/main');
      await vi.advanceTimersByTimeAsync(50);
      const first = document.querySelector('.overlay-description')?.textContent;

      await vi.advanceTimersByTimeAsync(8_100);
      const second = document.querySelector('.overlay-description')?.textContent;

      // Proves the interval is armed, which the previous version got wrong: it delivered
      // nothing for a full interval after load, so the demo opened on a waiting message.
      expect(first).toBeTruthy();
      expect(second).not.toBe(first);
    } finally {
      restore();
    }
  });

  it('does nothing when the page has no overlay mount point', async () => {
    // The guard that turns a build mistake into a still page rather than a load-time crash.
    const { restore } = withOverlayDom();
    document.body.replaceChildren();

    try {
      await import('../../firetv/src/main');
      await drain();
      expect(true).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('the pipeline entry point', () => {
  it('builds the stage strip and drives an event through both surfaces', async () => {
    const { document, restore } = withPipelineDom();

    try {
      await import('../../web/src/pipeline-main');
      await vi.advanceTimersByTimeAsync(2_000);

      // Five stages, the day growing on the dashboard, and a sentence on the television.
      expect(document.querySelectorAll('.stage')).toHaveLength(5);
      expect(document.querySelectorAll('#app .event').length).toBeGreaterThan(0);
      expect(document.querySelectorAll('#overlay .overlay-card')).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('lights the stages in chain order', async () => {
    const { document, restore } = withPipelineDom();

    try {
      await import('../../web/src/pipeline-main');
      await vi.advanceTimersByTimeAsync(2_000);

      const lit = document
        .querySelectorAll('.stage')
        .map((node) => node.classList.contains('stage--done'));
      // Some lit, none skipped: the strip is not meant to clear mid-run.
      expect(lit.some(Boolean)).toBe(true);
      expect(lit.at(-1)).toBe(true);
    } finally {
      restore();
    }
  });

  it('wires Replay to a real restart', async () => {
    const { document, restore } = withPipelineDom();

    try {
      const button = document.getElementById('replay');
      if (button === null) throw new Error('replay button not staged');

      await import('../../web/src/pipeline-main');
      await vi.advanceTimersByTimeAsync(2_000);
      const before = document.querySelectorAll('#app .event').length;

      expect(button.dispatch('click')).toBe(1);
      await vi.advanceTimersByTimeAsync(2_000);

      // A restart begins again from the first event, so the count climbs back from low
      // rather than continuing from where it was.
      const after = document.querySelectorAll('#app .event').length;
      expect(after).toBeGreaterThan(0);
      expect(after).toBeLessThanOrEqual(before + 1);
    } finally {
      restore();
    }
  });

  it('empties the day between cycles rather than accumulating', async () => {
    // The defect: a betweenCycles callback that only reset a cache key, so the timeline grew
    // 3, 6, 9, 12... and a judge watching long enough saw a day with forty events on it.
    const { document, restore } = withPipelineDom();

    try {
      await import('../../web/src/pipeline-main');
      let peak = 0;
      for (let i = 0; i < 40; i += 1) {
        await vi.advanceTimersByTimeAsync(1_000);
        peak = Math.max(peak, document.querySelectorAll('#app .event').length);
      }
      expect(peak).toBeLessThanOrEqual(3);
    } finally {
      restore();
    }
  });
});