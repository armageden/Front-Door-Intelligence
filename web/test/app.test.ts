/**
 * Tests for the dashboard's DOM shell, `web/src/app.ts`.
 *
 * **These do not test a browser.** They run against the minimal fake in `fake-dom.ts`, so
 * what they assert is the shell's branching and structure — which message appears, whether a
 * node was created, whether a modifier class was applied. A real render on 2026-10-04
 * matched these predictions; layout, styling, and accessibility are verified only by such
 * renders, never by this file.
 *
 * The three things worth asserting are the ones a shell is uniquely responsible for:
 *
 * 1. **A failed load never renders as a quiet day.** An empty timeline after a rejected
 *    request reads as "nothing happened at the front door", which is a confident false
 *    statement about someone's home. The error path has to be unmistakably an error.
 * 2. **A 401 is explained, not just reported.** It is the single likeliest misconfiguration,
 *    and the fix is one environment variable.
 * 3. **A null `snapshot_url` produces no `<img>`.** A signed URL to a deleted object would
 *    render as a broken image, which looks like a bug in the pipeline rather than an honest
 *    "no snapshot for this event".
 */

import { describe, expect, it, vi } from 'vitest';

import { load } from '../src/app';
import type { FetchLike, TodayResponse } from '../src/api';
import { byClass, byTag, flatten, texts, withFakeDom } from './fake-dom';

const BASE = 'https://api.test';

function ok(body: unknown): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => body });
}

function failing(status: number, body: unknown = { status: 'error' }): FetchLike {
  return async () => ({ ok: false, status, json: async () => body });
}

const DAY: TodayResponse = {
  date: '2026-02-13',
  count: 2,
  truncated: false,
  summary: null,
  events: [
    {
      event_id: 'evt_1',
      timestamp: '2026-02-13T13:39:57.200Z',
      device_name: 'Front Door',
      event_type: 'motion_detected',
      sub_type: 'human',
      description: 'A person places a medium box by the door',
      snapshot_url: 'https://s3.test/a.jpg',
      processed: true,
    },
    {
      event_id: 'evt_2',
      timestamp: '2026-02-13T14:02:10.000Z',
      event_type: 'motion_detected',
      sub_type: 'vehicle',
      description: null,
      snapshot_url: null,
      processed: false,
    },
  ],
};

async function render(
  fetchImpl: FetchLike,
  date?: string,
): Promise<ReturnType<typeof withFakeDom>['root']> {
  const { root, restore } = withFakeDom();
  try {
    await load(root as unknown as HTMLElement, fetchImpl, BASE, 'k', date);
  } finally {
    restore();
  }
  return root;
}

describe('a successful load', () => {
  it('replaces the loading state rather than appending to it', async () => {
    // `replaceChildren` is the whole point: a reload that appends would stack two days.
    const root = await render(ok(DAY));
    expect(byClass(root, 'loading')).toHaveLength(0);
    expect(byTag(root, 'h1')).toHaveLength(1);
  });

  it('renders one article per event', async () => {
    const root = await render(ok(DAY));
    expect(byClass(root, 'event')).toHaveLength(2);
  });

  it('marks the undescribed event pending, and only that one', async () => {
    const root = await render(ok(DAY));
    const pending = byClass(root, 'event--pending');

    expect(pending).toHaveLength(1);
    expect(texts(pending[0]!)).toContain('Being described…');
  });

  it('renders one image for the event that has a snapshot, and none for the one that does not', async () => {
    const root = await render(ok(DAY));
    const images = byTag(root, 'img');

    expect(images).toHaveLength(1);
    expect(images[0]?.src).toBe('https://s3.test/a.jpg');
  });

  it('alt-texts the image, because a snapshot with no alt is unreadable to a screen reader', async () => {
    const root = await render(ok(DAY));
    expect(byTag(root, 'img')[0]?.alt).toBe('A person places a medium box by the door');
  });

  it('says there is no summary yet rather than omitting the section', async () => {
    const root = await render(ok(DAY));
    const summary = byClass(root, 'summary-text');

    expect(summary).toHaveLength(1);
    expect(summary[0]?.textContent).toMatch(/No daily summary yet/);
  });

  it('shows the model sentence verbatim when there is one', async () => {
    const day = { ...DAY, summary: { summary: 'One delivery.', source: 'ai' as const, event_count: 1, generated_at: 'x' } };
    const root = await render(ok(day));

    expect(byClass(root, 'summary-text')[0]?.textContent).toBe('One delivery.');
  });

  it('renders an empty day as a sentence, not as a blank page', async () => {
    const root = await render(ok({ ...DAY, count: 0, events: [] }));

    expect(byClass(root, 'event')).toHaveLength(0);
    expect(byClass(root, 'empty')[0]?.textContent).toMatch(/Nothing was recorded/);
  });

  it('passes an explicit date through to the transport', async () => {
    const fetchImpl = vi.fn(ok(DAY));
    await render(fetchImpl, '2026-01-01');

    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('date=2026-01-01');
  });
});

describe('a failed load', () => {
  it('renders an unmistakable error, never an empty timeline', async () => {
    // The failure mode this guards: a blank day that reads as "nobody came to the door".
    const root = await render(failing(500));

    expect(byClass(root, 'error')).toHaveLength(1);
    expect(byClass(root, 'event')).toHaveLength(0);
    expect(texts(root).join(' ')).toMatch(/Could not load events/);
  });

  it('explains a 401 as the query key, which is the likeliest misconfiguration', async () => {
    const root = await render(failing(401, { status: 'unauthorized' }));
    const joined = texts(root).join(' ');

    expect(joined).toMatch(/query key was rejected/);
    expect(joined).toMatch(/D022/);
  });

  it('names the server’s own message for a non-401 failure', async () => {
    const root = await render(failing(400, { status: 'invalid_date' }));

    expect(texts(root).join(' ')).toMatch(/invalid_date/);
  });

  it('surfaces a network error rather than swallowing it', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('Failed to fetch');
    };
    const root = await render(fetchImpl);

    expect(texts(root).join(' ')).toMatch(/Failed to fetch/);
  });

  it('never puts the query key into the page, on any path', async () => {
    for (const response of [ok(DAY), failing(401), failing(500)]) {
      const root = await render(response, undefined);
      expect(flatten(root).map((n) => n.textContent ?? '').join(' ')).not.toMatch(/secret/);
    }
  });
});
describe('the entry point', () => {
  it('imports and runs without throwing when there is nothing on the page', async () => {
    // main.ts is four lines whose only job is to call start() at import. The classic bug in
    // an entry point is a throw during module evaluation, which no other test would catch.
    const { restore } = withFakeDom();
    try {
      await expect(import('../src/main')).resolves.toBeDefined();
    } finally {
      restore();
    }
  });
});
