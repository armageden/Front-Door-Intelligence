/**
 * Tests for the dashboard's data layer and view logic.
 *
 * Neither module touches the DOM or the network, which is the whole reason they were split
 * out of `app.ts` — so these run in vitest with nothing stubbed at all.
 *
 * The behaviours worth asserting:
 *
 * 1. **The key never reaches the URL.** It guards a homeowner's door activity (D022), and a
 *    key in a query string lands in history, proxy logs, and `Referer`.
 * 2. **A malformed date is refused locally.** A client that sends a date the server will
 *    reject has learned nothing from the 400.
 * 3. **A body that is not the expected response fails loudly.** The most common real cause
 *    is not a bug in this project at all — it is a login page or a proxy's 502 arriving
 *    where JSON was expected, which would otherwise render a blank dashboard.
 * 4. **A pending event and a fallback summary are labelled as such.** Reading machine counts
 *    as though they were a model's sentence is the misreading this UI must not encourage.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildTodayUrl,
  fetchToday,
  parseTodayResponse,
  QueryError,
  type FetchResponseLike,
  type TodayResponse,
} from '../src/api';
import {
  formatClock,
  formatDescription,
  formatDevice,
  formatEmptyDay,
  formatHeader,
  formatSubtype,
  formatSummary,
  timelineOrder,
} from '../src/view';

const BASE = 'https://abc123.execute-api.us-east-1.amazonaws.com';

function response(status: number, body: unknown): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
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
      snapshot_url: 'https://s3.test/a.jpg?sig=1',
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

describe('buildTodayUrl', () => {
  it('omits the parameter entirely when no date is given', () => {
    // The server defaults to the UTC date. Sending an empty `?date=` would be a 400.
    expect(buildTodayUrl(BASE)).toBe(`${BASE}/events/today`);
  });

  it('encodes an explicit date', () => {
    expect(buildTodayUrl(BASE, '2026-01-01')).toBe(`${BASE}/events/today?date=2026-01-01`);
  });

  it('tolerates a trailing slash, which is a normal way to paste a base URL', () => {
    expect(buildTodayUrl(`${BASE}/`)).toBe(`${BASE}/events/today`);
  });

  it('refuses a malformed date locally, rather than earning a 400', () => {
    expect(() => buildTodayUrl(BASE, '13/02/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => buildTodayUrl(BASE, '2026-02-31')).not.toThrow();
  });
});

describe('fetchToday', () => {
  it('sends the key in a header and never in the URL', async () => {
    const fetchImpl = vi.fn(async () => response(200, DAY));
    await fetchToday(fetchImpl, BASE, 'secret-key');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).not.toContain('secret-key');
    expect(init.headers['X-Query-Key']).toBe('secret-key');
  });

  it('returns the parsed body on success', async () => {
    const fetchImpl = vi.fn(async () => response(200, DAY));
    await expect(fetchToday(fetchImpl, BASE, 'k')).resolves.toMatchObject({ count: 2 });
  });

  it('raises the server’s own message on a 401, which is the likeliest misconfiguration', async () => {
    const fetchImpl = vi.fn(async () => response(401, { status: 'unauthorized' }));

    await expect(fetchToday(fetchImpl, BASE, 'wrong')).rejects.toThrow(/unauthorized/);
    await expect(fetchToday(fetchImpl, BASE, 'wrong')).rejects.toBeInstanceOf(QueryError);
  });

  it('never leaks the key into an error message', async () => {
    const fetchImpl = vi.fn(async () => response(403, { status: 'forbidden' }));

    await expect(fetchToday(fetchImpl, BASE, 'super-secret-key')).rejects.not.toThrow(
      /super-secret-key/,
    );
  });

  it('reports a network failure as an error rather than an empty day', async () => {
    // An empty timeline after a failed fetch is the most misleading thing this app could
    // show: it would read as a quiet day at the front door.
    const fetchImpl = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });

    await expect(fetchToday(fetchImpl, BASE, 'k')).rejects.toThrow(/Failed to fetch/);
  });
});

describe('parseTodayResponse', () => {
  it('accepts the handler’s real shape', () => {
    expect(parseTodayResponse(DAY)).toMatchObject({ date: '2026-02-13', count: 2 });
  });

  it('separates a non-object body from a wrongly-shaped one', () => {
    // The realistic causes differ. A 200 whose body is a string means something upstream
    // answered instead of this project. A 200 whose body is an object of the wrong shape
    // means the handler's contract changed — which is the drift this file cannot detect on
    // its own, so the message has to distinguish the two rather than lumping them.
    expect(() => parseTodayResponse('<html>502</html>')).toThrow(/non-object body/);
    expect(() => parseTodayResponse({ events: 'nope' })).toThrow(/not the expected response/);
  });

  it('names which field was wrong, so a schema drift is diagnosable', () => {
    expect(() => parseTodayResponse({ events: [] })).toThrow(/date=undefined/);
    expect(() => parseTodayResponse({ date: '2026-02-13' })).toThrow(/events=undefined/);
  });

  it('derives count from the events when the field is missing, rather than showing NaN', () => {
    const { count: _count, ...withoutCount } = DAY;
    expect(parseTodayResponse(withoutCount).count).toBe(2);
  });

  it('treats a missing summary as null, which is the honest pre-schedule state', () => {
    const { summary: _summary, ...withoutSummary } = DAY;
    expect(parseTodayResponse(withoutSummary).summary).toBeNull();
  });
});

describe('the timeline text', () => {
  it('shows the stored time in UTC, matching the partition it came from', () => {
    // Rendering it in the viewer's local zone would put an event under the wrong day.
    expect(formatClock('2026-02-13T13:39:57.200Z')).toBe('13:39 UTC');
  });

  it('returns the raw value rather than "Invalid Date" for an unparseable one', () => {
    expect(formatClock('not-a-time')).toBe('not-a-time');
  });

  it('labels a pending event as pending rather than describing it as empty', () => {
    expect(formatDescription(DAY.events[1]!)).toBe('Being described…');
  });

  it('distinguishes no description from no description yet', () => {
    expect(formatDescription({ ...DAY.events[0]!, description: null, processed: true })).toMatch(
      /No description was stored/,
    );
  });

  it('says when the device is unknown instead of inventing a name', () => {
    expect(formatDevice(DAY.events[1]!)).toBe('Unknown device');
    expect(formatDevice(DAY.events[0]!)).toBe('Front Door');
  });

  it('uses the flat sub_type and never the dotted form the spec shows', () => {
    expect(formatSubtype(DAY.events[0]!)).toBe('human');
    // `sub_type` is absent, not null, on events Ring sends no subtype for — so the label
    // has to survive the key being missing rather than only being empty.
    const { sub_type: _omitted, ...withoutSubType } = DAY.events[0]!;
    expect(formatSubtype(withoutSubType)).toBe('motion detected');
  });

  it('orders newest first, the way a timeline is read', () => {
    const ordered = timelineOrder(DAY.events);
    expect(ordered.map((e) => e.event_id)).toEqual(['evt_2', 'evt_1']);
  });

  it('does not mutate the array it was given', () => {
    const input = [...DAY.events];
    timelineOrder(input);
    expect(input.map((e) => e.event_id)).toEqual(['evt_1', 'evt_2']);
  });
});

describe('the day summary', () => {
  const summary = { summary: 'One delivery today.', source: 'ai' as const, event_count: 1, generated_at: '2026-02-13T21:00:00.000Z' };

  it('says plainly when there is not one yet', () => {
    expect(formatSummary(null)).toMatch(/No daily summary yet/);
  });

  it('marks a deterministic summary as counts, so it is not read as a model’s sentence', () => {
    expect(formatSummary({ ...summary, source: 'fallback' })).toMatch(/Counts only/);
  });

  it('passes a model’s sentence through untouched', () => {
    expect(formatSummary(summary)).toBe('One delivery today.');
  });
});

describe('the header line', () => {
  it('agrees in the singular', () => {
    expect(formatHeader({ ...DAY, count: 1, events: [DAY.events[0]!] })).toMatch(/^1 event on /);
  });

  it('always calls out truncation, so a capped day never looks complete', () => {
    expect(formatHeader({ ...DAY, truncated: true })).toMatch(/first 200 only/);
  });

  it('counts the events still being described', () => {
    expect(formatHeader(DAY)).toMatch(/1 still being described/);
  });

  it('separates "nothing happened" from "nothing to show"', () => {
    // A day that reported a count but rendered nothing is a bug, and the message says so.
    expect(formatEmptyDay({ ...DAY, count: 0, events: [] })).toMatch(/Nothing was recorded/);
    expect(formatEmptyDay({ ...DAY, count: 3, events: [] })).toMatch(/reported 3/);
  });
});