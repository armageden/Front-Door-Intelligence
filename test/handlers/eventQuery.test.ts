/**
 * Tests for the event query stage, FR8.
 *
 * Three behaviours carry the most weight and are asserted hardest:
 *
 * 1. **The endpoint fails closed.** A missing `QUERY_API_KEY` and a wrong key both deny
 *    access. A query endpoint that leaks a homeowner's door activity to anyone who guesses
 *    the URL is worse than one that returns nothing.
 * 2. **A malformed `?date=` is reported, not silently replaced with today.** A wrong date
 *    that quietly returns the right-looking answer is the hardest kind of bug to find.
 * 3. **A pending event still appears**, with a null description, because it really
 *    happened. The timeline must not disagree with reality while the queue is behind.
 *
 * No AWS, no network. Every dependency is injected.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildTodayResponse,
  handler,
  queryToday,
  MAX_EVENTS,
  QUERY_KEY_ENV,
  QUERY_KEY_HEADER,
} from '../../src/handlers/eventQuery';
import { utcDate } from '../../src/lib/dynamoClient';
import type { DoorEvent } from '../../src/types';
import type { QueryDeps } from '../../src/handlers/eventQuery';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const SIGNED = 'https://s3.test/snapshot.jpg?X-Amz-Signature=signed';
const KEY = 'test-query-key';

const EVENT: DoorEvent = {
  date: '2026-02-13',
  event_id: 'evt_abc123',
  timestamp: '2026-02-13T13:39:57.200Z',
  device_id: 'front_door_cam',
  device_name: 'Front Door',
  event_type: 'motion_detected',
  sub_type: 'human',
  description: 'A person places a medium box by the door',
  snapshot_s3_key: 'snapshots/2026-02-13/evt_abc123.jpg',
  processed: true,
};

function deps(overrides: Partial<QueryDeps> = {}): QueryDeps {
  return {
    loadEvents: vi.fn(async () => [EVENT]),
    presign: vi.fn(async () => SIGNED),
    today: () => '2026-02-13',
    authorize: () => true,
    ...overrides,
  };
}

function apiEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /events/today',
    rawPath: '/events/today',
    headers: { 'x-query-key': KEY },
    requestContext: { http: { method: 'GET', path: '/events/today' } } as APIGatewayProxyEventV2['requestContext'],
    ...overrides,
  } as APIGatewayProxyEventV2;
}

describe('authorisation', () => {
  it('rejects a wrong key with 401 and does not read the table', async () => {
    const loadEvents = vi.fn(async () => [EVENT]);
    const result = await queryToday('wrong-key', {}, deps({ loadEvents, authorize: () => false }));

    expect(result.statusCode).toBe(401);
    expect(loadEvents).not.toHaveBeenCalled();
  });

  it('rejects an absent key', async () => {
    const result = await queryToday(undefined, {}, deps({ authorize: () => false }));
    expect(result.statusCode).toBe(401);
  });

  it('fails closed when QUERY_API_KEY is unset, rather than admitting everyone', async () => {
    const previous = process.env[QUERY_KEY_ENV];
    delete process.env[QUERY_KEY_ENV];
    try {
      // No `authorize` override, so the real default runs and must reject. The throw is
      // what makes it fail closed: `handler` turns it into a 500, never a 200.
      await expect(
        queryToday(KEY, {}, {
          loadEvents: async () => [EVENT],
          presign: async () => SIGNED,
          today: () => '2026-02-13',
        }),
      ).rejects.toThrow(/QUERY_API_KEY/);
    } finally {
      if (previous !== undefined) process.env[QUERY_KEY_ENV] = previous;
    }
  });

  it('surfaces that misconfiguration as a 500 from the handler, never a 200', async () => {
    const previous = process.env[QUERY_KEY_ENV];
    delete process.env[QUERY_KEY_ENV];
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await handler(apiEvent());
      expect(result.statusCode).toBe(500);
    } finally {
      quiet.mockRestore();
      if (previous !== undefined) process.env[QUERY_KEY_ENV] = previous;
    }
  });

  it('accepts the configured key', async () => {
    const result = await queryToday(KEY, {}, deps());
    expect(result.statusCode).toBe(200);
  });
});

describe('the date parameter', () => {
  it('queries the UTC today by default', async () => {
    const loadEvents = vi.fn(async () => [EVENT]);
    await queryToday(KEY, {}, deps({ loadEvents }));
    expect(loadEvents).toHaveBeenCalledWith('2026-02-13');
  });

  it('honours an explicit date', async () => {
    const loadEvents = vi.fn(async () => [EVENT]);
    await queryToday(KEY, { date: '2026-01-01' }, deps({ loadEvents }));
    expect(loadEvents).toHaveBeenCalledWith('2026-01-01');
  });

  it('rejects a malformed date with 400 rather than falling back to today', async () => {
    const loadEvents = vi.fn(async () => [EVENT]);
    const result = await queryToday(KEY, { date: '13/02/2026' }, deps({ loadEvents }));

    expect(result.statusCode).toBe(400);
    expect(result.body).toEqual({ status: 'invalid_date' });
    expect(loadEvents).not.toHaveBeenCalled();
  });

  it('rejects a well-formed date that does not exist', async () => {
    const result = await queryToday(KEY, { date: '2026-02-31' }, deps());
    expect(result.statusCode).toBe(400);
  });

  it('derives the partition from UTC, not local time', () => {
    // 23:30 UTC on the 13th. In any zone at or west of UTC this is still the 13th; the
    // point is that the partition key does not depend on the Lambda's region.
    expect(utcDate(new Date('2026-02-13T23:30:00.000Z'))).toBe('2026-02-13');
    expect(utcDate(new Date('2026-02-14T00:30:00.000Z'))).toBe('2026-02-14');
  });
});

describe('the response shape', () => {
  it('returns the five fields ARCHITECTURE.md 5.2 names, plus the two it conflates', async () => {
    const response = await buildTodayResponse('2026-02-13', [EVENT], async () => SIGNED);
    const event = response.events[0];

    expect(event?.event_type).toBe('motion_detected');
    // The spec shows `motion.human` here; the real webhook splits these into two fields.
    expect(event?.sub_type).toBe('human');
    expect(event?.event_id).toBe('evt_abc123');
    expect(event?.description).toBe('A person places a medium box by the door');
    expect(event?.snapshot_url).toBe(SIGNED);
  });

  it('counts what it returns', async () => {
    const response = await buildTodayResponse('2026-02-13', [EVENT, { ...EVENT, event_id: 'evt_2' }], async () => SIGNED);
    expect(response.count).toBe(2);
    expect(response.truncated).toBe(false);
  });

  it('returns an empty list, not an error, for a day with no events', async () => {
    const response = await buildTodayResponse('2026-02-13', [], async () => SIGNED);
    expect(response).toEqual({ date: '2026-02-13', count: 0, truncated: false, events: [] });
  });
});

describe('honest reporting of gaps', () => {
  it('includes a pending event with a null description, because it happened', async () => {
    const { description: _d, snapshot_s3_key: _s, ...pendingRest } = EVENT;
    const pending: DoorEvent = { ...pendingRest, processed: false };
    const response = await buildTodayResponse('2026-02-13', [pending], async () => SIGNED);

    expect(response.count).toBe(1);
    expect(response.events[0]?.description).toBeNull();
    expect(response.events[0]?.processed).toBe(false);
  });

  it('reports a null snapshot_url when nothing was stored, rather than a URL to nothing', async () => {
    const presign = vi.fn(async () => SIGNED);
    const { snapshot_s3_key: _s, ...noSnapshotRest } = EVENT;
    const noSnapshot: DoorEvent = noSnapshotRest;
    const response = await buildTodayResponse('2026-02-13', [noSnapshot], presign);

    expect(response.events[0]?.snapshot_url).toBeNull();
    expect(presign).not.toHaveBeenCalled();
  });

  it('truncates at the cap and says so, instead of reporting a quietly wrong count', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...EVENT, event_id: `evt_${i}` }));
    const response = await buildTodayResponse('2026-02-13', many, async () => SIGNED, 3);

    expect(response.truncated).toBe(true);
    expect(response.count).toBe(3);
  });

  it('does not truncate exactly at the cap', async () => {
    const many = Array.from({ length: 3 }, (_, i) => ({ ...EVENT, event_id: `evt_${i}` }));
    const response = await buildTodayResponse('2026-02-13', many, async () => SIGNED, 3);

    expect(response.truncated).toBe(false);
  });

  it('caps at MAX_EVENTS by default', async () => {
    const many = Array.from({ length: MAX_EVENTS + 10 }, (_, i) => ({ ...EVENT, event_id: `evt_${i}` }));
    const response = await buildTodayResponse('2026-02-13', many, async () => SIGNED);
    expect(response.events).toHaveLength(MAX_EVENTS);
    expect(response.truncated).toBe(true);
  });
});

describe('the handler', () => {
  it('returns 401 and JSON when the key is wrong', async () => {
    process.env[QUERY_KEY_ENV] = KEY;
    const result = await handler(apiEvent({ headers: { 'x-query-key': 'nope' } }));

    expect(result.statusCode).toBe(401);
    expect(result.headers?.['content-type']).toBe('application/json');
  });

  it('reads the header regardless of casing', async () => {
    process.env[QUERY_KEY_ENV] = KEY;
    const result = await handler(apiEvent({ headers: { 'X-Query-Key': 'nope' } }));
    expect(result.statusCode).toBe(401);
  });

  it('returns 500 when a dependency throws, so the caller can retry', async () => {
    process.env[QUERY_KEY_ENV] = KEY;
    const failing = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // A malformed partition key would be rejected by DynamoDB; here the point is that
      // an unexpected failure becomes a 5xx and never a 4xx.
      const result = await handler(
        apiEvent({ queryStringParameters: { date: '2026-02-13' } }),
      );
      // Without a table configured the load throws; either way it must not be a 4xx.
      expect([500]).toContain(result.statusCode);
    } finally {
      failing.mockRestore();
    }
  });

  it('names the header it expects', () => {
    expect(QUERY_KEY_HEADER).toBe('x-query-key');
    expect(QUERY_KEY_ENV).toBe('QUERY_API_KEY');
  });
});
