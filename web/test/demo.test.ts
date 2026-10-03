/**
 * Tests for the demo entry point, `web/src/demo.ts`.
 *
 * Three things are worth asserting, and none of them needs a browser:
 *
 * 1. **The fixture satisfies the response contract.** `demoResponse` is a hand-written
 *    `TodayResponse` in the same file that mirrors the handler's shape by hand. If the
 *    mirrored type drifts, the type error lands here; `parseTodayResponse()` re-validates
 *    at runtime because the demo page renders through the same parse the live page uses.
 * 2. **The demo path renders what the fixture claims.** One pending event, two snapshots,
 *    one unresolved device — every honesty feature the dashboard has, visible on one page.
 * 3. **The demo transport takes no key.** The page has no credential form, so nothing may
 *    imply that a key exists to be entered.
 *
 * Like `main.ts`, the module auto-runs at import, so it is imported dynamically inside the
 * fake DOM scope — the same pattern `app.test.ts` uses for the other entry point.
 */

import { describe, expect, it } from 'vitest';

import { load } from '../src/app';
import { parseTodayResponse } from '../src/api';
import { byClass, byTag, texts, withFakeDom } from './fake-dom';

/**
 * Import the entry under the fake DOM, as `app.test.ts` does for `main.ts`. The first call
 * evaluates the module — whose top-level `startDemo()` finds no `#app` and does nothing —
 * and every later call returns the cache, so the restore never unmounts anything real.
 */
async function importDemo() {
  const { restore } = withFakeDom();
  try {
    return await import('../src/demo');
  } finally {
    restore();
  }
}

describe('the demo fixture', () => {
  it('satisfies the response contract that parseTodayResponse enforces', async () => {
    const { demoResponse } = await importDemo();
    const parsed = parseTodayResponse(demoResponse);

    expect(parsed.date).toBe('2026-10-04');
    expect(parsed.count).toBe(4);
    expect(parsed.events).toHaveLength(4);
    expect(parsed.summary?.source).toBe('ai');
  });

  it('carries one event in every honesty state the UI can show', async () => {
    const { demoResponse } = await importDemo();

    const pending = demoResponse.events.filter((e) => !e.processed);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.description).toBeNull();

    const withSnapshot = demoResponse.events.filter((e) => e.snapshot_url !== null);
    const withoutSnapshot = demoResponse.events.filter((e) => e.snapshot_url === null);
    expect(withSnapshot).toHaveLength(2);
    expect(withoutSnapshot).toHaveLength(2);

    const named = demoResponse.events.filter((e) => e.device_name !== undefined);
    expect(named).toHaveLength(2);
  });
});

describe('the demo transport', () => {
  it('returns the fixture as a 200 and ignores the URL and the key entirely', async () => {
    const { demoFetch, demoResponse } = await importDemo();

    const response = await demoFetch('https://not-a-real-host/events/today?date=2099-01-01', {
      headers: { 'X-Query-Key': 'anything-at-all' },
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBe(demoResponse);
  });
});

describe('the demo page', () => {
  it('imports and auto-runs without throwing when there is nothing on the page', async () => {
    await expect(importDemo()).resolves.toBeDefined();
  });

  it('renders four events through the production load(), one of them pending', async () => {
    const { demoFetch } = await importDemo();
    const { root, restore } = withFakeDom();
    try {
      await load(root as unknown as HTMLElement, demoFetch, '', '');
    } finally {
      restore();
    }

    expect(byClass(root, 'event')).toHaveLength(4);
    expect(byClass(root, 'event--pending')).toHaveLength(1);
    expect(texts(root).join(' ')).toMatch(/4 events on 2026-10-04 · 1 still being described/);
    expect(texts(root).join(' ')).toMatch(/Being described…/);
  });

  it('renders two snapshot images and an unresolved device, without inventing either', async () => {
    const { demoFetch } = await importDemo();
    const { root, restore } = withFakeDom();
    try {
      await load(root as unknown as HTMLElement, demoFetch, '', '');
    } finally {
      restore();
    }

    const images = byTag(root, 'img');
    expect(images).toHaveLength(2);
    // The placeholder is a data URL, so the demo page renders with no bucket to sign against.
    expect(images[0]?.src).toMatch(/^data:image\/svg\+xml/);
    expect(texts(root).join(' ')).toMatch(/Unknown device/);
    // The summary is the model's, so the fallback label must not appear.
    expect(texts(root).join(' ')).not.toMatch(/Counts only/);
  });
});
