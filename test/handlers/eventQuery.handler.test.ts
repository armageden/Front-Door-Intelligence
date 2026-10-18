/**
 * The remaining DynamoDB shapes, and the event query's HTTP adapter.
 *
 * Two groups that had no coverage:
 *
 * 1. **Shapes the table can hand back that are not events.** `queryEventsByDate` pages
 *    through a partition and must skip a summary row, tolerate a missing `Items`, and stop
 *    when `LastEvaluatedKey` goes away. Each of those is a line a future schema change could
 *    remove without any test noticing.
 * 2. **The query handler itself.** `queryToday` is tested thoroughly; `handler` \u2014 the thing
 *    API Gateway actually invokes \u2014 was not invoked once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import {
  isPartitionDate,
  queryEventsByDate,
  sortKeyFor,
  type DocClient,
} from '../../src/lib/dynamoClient';
import * as dynamo from '../../src/lib/dynamoClient';
import { handler, QUERY_KEY_ENV } from '../../src/handlers/eventQuery';
import { querySummary } from '../../src/lib/dynamoClient';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

/** A document client that replays queued results, one per `send`. */
function pagingClient(responses: unknown[]): { client: DocClient; sent: () => number } {
  let sent = 0;
  const client = {
    send: vi.fn(async () => {
      const next = responses[Math.min(sent, responses.length - 1)];
      sent += 1;
      return next ?? {};
    }),
  } as unknown as DocClient;
  return { client, sent: () => sent };
}

const EVENT = {
  date: '2026-02-13',
  event_id: 'evt-1',
  timestamp: '2026-02-13T13:39:57.200Z',
  device_id: 'front_door_cam',
  event_type: 'motion_detected',
  processed: true,
};

beforeEach(() => {
  process.env[dynamo.EVENTS_TABLE_ENV] = 'FrontDoorEvents';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the shapes a partition can contain', () => {
  it('sorts after every event, which is why the summary is excluded from a timeline', async () => {
    // The whole reason SUMMARY_SORT_KEY is a constant string and not a timestamp.
    const { client } = pagingClient([
      {
        Items: [
          EVENT,
          {
            date: '2026-02-13',
            sort_key: 'summary',
            item_type: 'summary',
            summary: 'A quiet day.',
            summary_source: 'ai',
            event_count: 1,
            counts_by_sub_type: {},
            generated_at: '2026-02-13T21:00:00.000Z',
          },
        ],
      },
    ]);

    const events = await queryEventsByDate('2026-02-13', client);

    expect(events).toHaveLength(1);
    expect(events[0]?.event_id).toBe('evt-1');
  });

  it('skips rows that are not events at all, whatever they are', async () => {
    const { client } = pagingClient([
      { Items: [null, 'a string', 42, EVENT, {}, { event_id: 'evt-2' }] },
    ]);

    const events = await queryEventsByDate('2026-02-13', client);

    // Only the one that carries all three of the fields an event must have.
    expect(events.map((e) => e.event_id)).toEqual(['evt-1']);
  });

  it('follows LastEvaluatedKey to the end rather than trusting one page', async () => {
    const { client, sent } = pagingClient([
      { Items: [EVENT], LastEvaluatedKey: { date: '2026-02-13', sort_key: 'a' } },
      { Items: [{ ...EVENT, event_id: 'evt-2' }], LastEvaluatedKey: { date: '2026-02-13', sort_key: 'b' } },
      { Items: [{ ...EVENT, event_id: 'evt-3' }] },
    ]);

    const events = await queryEventsByDate('2026-02-13', client);

    // A day that silently stopped at 1 MB would report a wrong count.
    expect(events).toHaveLength(3);
    expect(sent()).toBe(3);
  });

  it('tolerates a page with no Items at all', async () => {
    const { client } = pagingClient([{}]);

    await expect(queryEventsByDate('2026-02-13', client)).resolves.toEqual([]);
  });

  it('builds the sort key through the one exported helper', () => {
    // Exported so the write and read paths cannot drift. Nothing called it before.
    expect(sortKeyFor(EVENT)).toBe('2026-02-13T13:39:57.200Z#evt-1');
  });

  it('reads a missing summary as absent rather than throwing', async () => {
    const { client } = pagingClient([{}]);

    await expect(querySummary('2026-02-13', client)).resolves.toBeUndefined();
  });

  it('ignores an item that has no summary string, whatever else it holds', async () => {
    const { client } = pagingClient([{ Item: { date: '2026-02-13', sort_key: 'summary' } }]);

    // A row that lost its sentence is not a summary, and returning it would put `undefined`
    // in the dashboard's headline.
    await expect(querySummary('2026-02-13', client)).resolves.toBeUndefined();
  });
});

describe('isPartitionDate', () => {
  it.each([
    ['2026-02-13', true],
    ['2026-12-31', true],
    ['2026-02-31', false],
    ['2026-13-01', false],
    ['13/02/2026', false],
    ['2026-2-3', false],
    ['', false],
    ['2026-02-13T00:00:00Z', false],
  ])('%s -> %s', (input, expected) => {
    expect(isPartitionDate(input)).toBe(expected);
  });
});

describe('the event query HTTP adapter', () => {
  let queryEventsByDate: MockInstance<typeof dynamo.queryEventsByDate>;
  let querySummarySpy: MockInstance<typeof dynamo.querySummary>;

  const apiEvent = (query?: Record<string, string>): APIGatewayProxyEventV2 =>
    ({
      version: '2.0',
      routeKey: 'GET /events/today',
      rawPath: '/events/today',
      headers: { 'x-query-key': 'the-key' },
      queryStringParameters: query,
      requestContext: { http: { method: 'GET', path: '/events/today' } },
    }) as unknown as APIGatewayProxyEventV2;

  beforeEach(() => {
    process.env[QUERY_KEY_ENV] = 'the-key';
    process.env['S3_SNAPSHOT_BUCKET'] = 'bucket';
    queryEventsByDate = vi.spyOn(dynamo, 'queryEventsByDate').mockResolvedValue([EVENT]);
    querySummarySpy = vi.spyOn(dynamo, 'querySummary').mockResolvedValue(undefined);
    vi.spyOn(dynamo, 'getEvent').mockResolvedValue(EVENT);
  });

  it('answers 200 with the day and a null summary before the schedule has run', async () => {
    const result = await handler(apiEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string) as { count: number; summary: null };
    expect(body.count).toBe(1);
    expect(body.summary).toBeNull();
  });

  it('includes the stored summary when one exists', async () => {
    querySummarySpy.mockResolvedValue({
      date: '2026-02-13',
      sort_key: 'summary',
      item_type: 'summary',
      summary: 'A quiet day.',
      summary_source: 'ai',
      event_count: 1,
      counts_by_sub_type: { human: 1 },
      generated_at: '2026-02-13T21:00:00.000Z',
    });

    const result = await handler(apiEvent());
    const body = JSON.parse(result.body as string) as { summary: { source: string } };

    expect(body.summary.source).toBe('ai');
  });

  it('answers with today when no date is asked for', async () => {
    // Derived from the UTC clock, not the viewer's \u2014 see D023.
    vi.spyOn(dynamo, 'utcDate').mockReturnValue('2026-02-13');

    await handler(apiEvent());

    expect(queryEventsByDate).toHaveBeenCalledWith('2026-02-13');
  });

  it('queries the partition the caller named', async () => {
    await handler(apiEvent({ date: '2026-01-01' }));

    expect(queryEventsByDate).toHaveBeenCalledWith('2026-01-01');
  });

  it('answers 400 for a malformed date rather than guessing', async () => {
    const result = await handler(apiEvent({ date: '13/02/2026' }));

    expect(result.statusCode).toBe(400);
    expect(queryEventsByDate).not.toHaveBeenCalled();
  });

  it('answers 401 without the key', async () => {
    const result = await handler({
      version: '2.0',
      headers: {},
      requestContext: { http: { method: 'GET', path: '/events/today' } },
    } as unknown as APIGatewayProxyEventV2);

    expect(result.statusCode).toBe(401);
  });

  it('answers 500 when the table cannot be read, so a retry is reasonable', async () => {
    queryEventsByDate.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await handler(apiEvent());

    // Not a 4xx: the caller did nothing wrong and asking again would work.
    expect(result.statusCode).toBe(500);
    expect(error).toHaveBeenCalled();
  });

  it('answers 500 when the key is not configured at all', async () => {
    // Fails closed: an endpoint that cannot decide who is allowed must not admit everyone.
    delete process.env[QUERY_KEY_ENV];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await handler(apiEvent());

    expect(result.statusCode).toBe(500);
  });
});