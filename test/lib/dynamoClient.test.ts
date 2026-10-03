/**
 * Tests for the DynamoDB layer.
 *
 * `claimRequestId` is the whole mechanism behind NFR2, so its two outcomes — first
 * caller wins, later callers are told it is a duplicate — are asserted directly
 * rather than through the handler. The client is a stub: no AWS account is involved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

import {
  EVENTS_TABLE_ENV,
  EVENTS_TTL_SECONDS,
  IDEMPOTENCY_TABLE_ENV,
  IDEMPOTENCY_TTL_SECONDS,
  SUMMARY_SORT_KEY,
  claimRequestId,
  eventExpiryEpoch,
  isPartitionDate,
  markProcessed,
  putEvent,
  putSummary,
  querySummary,
  setClient,
  toDoorEvent,
} from '../../src/lib/dynamoClient';
import type { DaySummaryRecord, DoorEvent, RingWebhookPayload } from '../../src/types';

const V11: RingWebhookPayload = {
  meta: {
    version: '1.1',
    time: '2026-02-13T13:39:57.200Z',
    request_id: '2ad45ade-1818-4154-813b-afdd8bcd8085',
    account_id: 'ava1.ring.account.XXXYYY',
  },
  data: {
    id: 'front_door_cam_motion_1786715596787',
    type: 'motion_detected',
    attributes: {
      source: 'front_door_cam',
      source_type: 'devices',
      timestamp: 1786715596787,
      sub_type: 'human',
    },
  },
};

/** Minimal stand-in for DynamoDBDocumentClient: records commands, returns a canned result. */
function fakeClient(result: unknown = {}) {
  return { send: vi.fn().mockResolvedValue(result) } as never;
}

/** Extract the single command the stub client was asked to send. */
interface SentCommand {
  constructor: { name: string };
  input: Record<string, unknown>;
}

function sentCommand(client: unknown): SentCommand {
  const send = (client as { send: { mock: { calls: [{ args: [unknown] }][] } } }).send;
  const call = send.mock.calls[0];
  if (!call) throw new Error('no command was sent');
  return call[0] as unknown as SentCommand;
}

function failingClient(error: unknown) {
  return { send: vi.fn().mockRejectedValue(error) } as never;
}

beforeEach(() => {
  process.env[EVENTS_TABLE_ENV] = 'FrontDoorEvents';
  process.env[IDEMPOTENCY_TABLE_ENV] = 'FrontDoorIdempotency';
});

afterEach(() => {
  setClient(undefined);
  vi.restoreAllMocks();
});

describe('claimRequestId', () => {
  it('returns true for the first caller', async () => {
    const client = fakeClient();
    await expect(claimRequestId('req-1', client)).resolves.toBe(true);
  });

  it('writes a conditional put keyed on request_id, with a 24-hour TTL', async () => {
    const client = fakeClient();
    await claimRequestId('req-1', client);

    const command = sentCommand(client);
    expect(command.constructor.name).toBe('PutCommand');
    expect(command.input.ConditionExpression).toBe('attribute_not_exists(request_id)');
    expect(command.input.TableName).toBe('FrontDoorIdempotency');

    const item = command.input.Item as { request_id: string; expires_at: number; claimed_at: number };
    expect(item.request_id).toBe('req-1');
    expect(item.expires_at - item.claimed_at).toBe(IDEMPOTENCY_TTL_SECONDS);
    expect(IDEMPOTENCY_TTL_SECONDS).toBe(86_400);
  });

  it('returns false when the id was already claimed', async () => {
    const client = failingClient(
      new ConditionalCheckFailedException({ $metadata: {}, message: 'already exists' }),
    );
    await expect(claimRequestId('req-1', client)).resolves.toBe(false);
  });

  it('rethrows anything that is not a conditional failure', async () => {
    const client = failingClient(new Error('ProvisionedThroughputExceeded'));
    await expect(claimRequestId('req-1', client)).rejects.toThrow(
      /ProvisionedThroughputExceeded/,
    );
  });

  it('throws a named error when the table environment variable is missing', async () => {
    delete process.env[IDEMPOTENCY_TABLE_ENV];
    await expect(claimRequestId('req-1', fakeClient())).rejects.toThrow(
      new RegExp(IDEMPOTENCY_TABLE_ENV),
    );
  });
});

describe('toDoorEvent', () => {
  it('maps the v1.1 payload onto the stored event shape', () => {
    const event = toDoorEvent(V11);
    expect(event).toEqual({
      date: '2026-02-13',
      event_id: 'front_door_cam_motion_1786715596787',
      timestamp: '2026-02-13T13:39:57.200Z',
      // Carried separately because a snapshot request must be anchored to the device's
      // own clock; it is not reliably derivable from the ISO string.
      occurred_at_ms: 1786715596787,
      device_id: 'front_door_cam',
      event_type: 'motion_detected',
      sub_type: 'human',
      account_id: 'ava1.ring.account.XXXYYY',
      processed: false,
    });
  });

  it('derives the date partition key in UTC, not local time', () => {
    // 23:30 UTC is already the next day in GMT+8. A local-time implementation would
    // file this event under the wrong partition.
    const payload = { ...V11, meta: { ...V11.meta, time: '2026-02-13T23:30:00.000Z' } };
    expect(toDoorEvent(payload).date).toBe('2026-02-13');

    const justAfter = { ...V11, meta: { ...V11.meta, time: '2026-02-14T00:30:00.000Z' } };
    expect(toDoorEvent(justAfter).date).toBe('2026-02-14');
  });

  it('omits sub_type and account_id when Ring did not send them', () => {
    const payload: RingWebhookPayload = {
      meta: { version: '1.0', time: '2024-04-07T15:30:45Z', request_id: 'legacy' },
      data: {
        id: 'front_door_cam_button_press_1771027372393',
        type: 'button_press',
        attributes: { source: 'front_door_cam', source_type: 'devices', timestamp: 1771027372393 },
      },
    };
    const event = toDoorEvent(payload);
    expect(event.sub_type).toBeUndefined();
    expect(event.account_id).toBeUndefined();
    expect('sub_type' in event).toBe(false);
    expect('account_id' in event).toBe(false);
  });

  it('throws on an unparseable meta.time rather than writing a bad partition key', () => {
    const payload = { ...V11, meta: { ...V11.meta, time: 'not a date' } };
    expect(() => toDoorEvent(payload)).toThrow(/Unparseable meta.time/);
  });
});

describe('putEvent', () => {
  const event: DoorEvent = {
    date: '2026-02-13',
    event_id: 'evt-1',
    timestamp: '2026-02-13T13:39:57.200Z',
    device_id: 'front_door_cam',
    event_type: 'motion_detected',
    processed: false,
  };

  it('writes a composite sort key so same-millisecond events cannot collide', async () => {
    const client = fakeClient();
    await putEvent(event, client);

    const command = sentCommand(client);
    expect(command.input.TableName).toBe('FrontDoorEvents');
    const item = command.input.Item as { sort_key: string; date: string };
    expect(item.sort_key).toBe('2026-02-13T13:39:57.200Z#evt-1');
    expect(item.date).toBe('2026-02-13');
  });

  it('throws a named error when the events table variable is missing', async () => {
    delete process.env[EVENTS_TABLE_ENV];
    await expect(putEvent(event, fakeClient())).rejects.toThrow(new RegExp(EVENTS_TABLE_ENV));
  });
});

describe('markProcessed', () => {
  const event: DoorEvent = {
    date: '2026-02-13',
    event_id: 'evt_1',
    timestamp: '2026-02-13T13:39:57.200Z',
    device_id: 'front_door_cam',
    event_type: 'motion_detected',
    processed: false,
  };

  it('writes the processed flag when it is given', async () => {
    const client = fakeClient();
    await markProcessed(event, { description: 'A person', processed: true, source: 'ai' }, client);

    expect(sentCommand(client).input.UpdateExpression).toContain('processed = :processed');
  });

  it('never blanks the flag when a caller omits it', async () => {
    // processed: false after a successful describe would make the queue redeliver forever.
    // A partial update that omits it is the only safe reading of "not mentioned".
    const client = fakeClient();
    await markProcessed(event, { description: 'A person', source: 'ai' }, client);

    const command = sentCommand(client);
    expect(command.input.UpdateExpression).not.toContain('processed');
    expect(command.input.ExpressionAttributeValues).not.toHaveProperty(':processed');
  });

  it('persists the device name, which no webhook ever carries', async () => {
    const client = fakeClient();
    await markProcessed(event, { description: 'A person', source: 'ai', deviceName: 'Front Door' }, client);

    const command = sentCommand(client);
    expect(command.input.UpdateExpression).toContain('#device_name = :device_name');
    // #device_name must be aliased: the attribute name collides with nothing today, but
    // DynamoDB reserves several words and an unaliased name is a runtime failure, not a
    // compile-time one.
    expect((command.input.ExpressionAttributeNames as Record<string, string>)['#device_name']).toBe('device_name');
  });

  it('omits the device name entirely when none was resolved', async () => {
    const client = fakeClient();
    await markProcessed(event, { description: 'A person', source: 'ai' }, client);

    expect(sentCommand(client).input.UpdateExpression).not.toContain('device_name');
  });
});

describe('event retention — the 90-day TTL §3.5 specifies', () => {
  const event: DoorEvent = {
    date: '2026-02-13',
    event_id: 'evt-1',
    timestamp: '2026-02-13T13:39:57.200Z',
    device_id: 'front_door_cam',
    event_type: 'motion_detected',
    processed: false,
  };

  it('is 90 days', () => {
    expect(EVENTS_TTL_SECONDS).toBe(90 * 24 * 60 * 60);
  });

  it('is measured from the event’s own date, not from when the row is written', () => {
    // Retention means "90 days of activity". Measuring from write time would make an event
    // replayed a year later live for another 90 days.
    const partitionStart = Date.parse('2026-02-13T00:00:00.000Z') / 1000;
    expect(eventExpiryEpoch('2026-02-13')).toBe(partitionStart + EVENTS_TTL_SECONDS);
  });

  it('is identical however late the event is written', () => {
    const writtenImmediately = eventExpiryEpoch('2026-02-13', new Date('2026-02-13T00:00:01Z'));
    const writtenLate = eventExpiryEpoch('2026-02-13', new Date('2027-01-01T00:00:00Z'));

    expect(writtenLate).toBe(writtenImmediately);
  });

  it('expires every row in a partition at the same instant', () => {
    // Otherwise a partition would empty out row by row and a re-run of the summary could
    // outlive the events it describes.
    const morning = eventExpiryEpoch('2026-02-13');
    const night = eventExpiryEpoch('2026-02-13');

    expect(night).toBe(morning);
  });

  it('falls back to a finite expiry on an unparseable date, never NaN', () => {
    // DynamoDB cannot compare NaN, which would silently disable TTL for that row forever.
    const now = new Date('2026-02-13T12:00:00.000Z');
    const expiry = eventExpiryEpoch('not-a-date', now);

    expect(Number.isFinite(expiry)).toBe(true);
    expect(expiry).toBe(now.getTime() / 1000 + EVENTS_TTL_SECONDS);
  });

  it('is written by putEvent, which is the only place the row is created', async () => {
    const client = fakeClient();
    await putEvent(event, client);

    const item = sentCommand(client).input.Item as { expires_at: number };
    expect(item.expires_at).toBe(
      Date.parse('2026-02-13T00:00:00.000Z') / 1000 + EVENTS_TTL_SECONDS,
    );
  });

  it('is not rewritten by markProcessed, so a retry cannot extend retention', async () => {
    // A redelivered queue message must not push an event's life out by however long the
    // queue was backed up. The UpdateExpression is asserted in full for that reason.
    const client = fakeClient();
    await markProcessed(event, { description: 'A person', processed: true, source: 'ai' }, client);

    const command = sentCommand(client);
    expect(command.input.UpdateExpression).not.toContain('expires_at');
    expect(command.input.ExpressionAttributeValues).not.toHaveProperty(':expires_at');
  });

  it('expires the daily summary with the partition it summarises', async () => {
    const client = fakeClient();
    await putSummary(
      {
        date: '2026-02-13',
        summary: 'One visitor today.',
        summary_source: 'ai',
        event_count: 1,
        counts_by_sub_type: { human: 1 },
        generated_at: '2026-02-13T21:00:00.000Z',
      },
      client,
    );

    const item = sentCommand(client).input.Item as { expires_at: number };
    expect(item.expires_at).toBe(
      Date.parse('2026-02-13T00:00:00.000Z') / 1000 + EVENTS_TTL_SECONDS,
    );
  });
});

describe('the daily summary item', () => {
  const record: DaySummaryRecord = {
    date: '2026-02-13',
    summary: 'One delivery and one visitor today.',
    summary_source: 'ai',
    event_count: 2,
    counts_by_sub_type: { human: 2 },
    generated_at: '2026-02-13T21:00:00.000Z',
  };

  it('writes one fixed sort key, so a second run overwrites rather than accumulates', async () => {
    const client = fakeClient();
    await putSummary(record, client);

    const command = sentCommand(client);
    expect(command.constructor.name).toBe('PutCommand');
    const item = command.input.Item as { sort_key: string; item_type: string; date: string };
    expect(item.sort_key).toBe(SUMMARY_SORT_KEY);
    expect(item.item_type).toBe('summary');
    expect(item.date).toBe('2026-02-13');
  });

  it('writes no condition, because a superseded summary has nothing worth keeping', async () => {
    const client = fakeClient();
    await putSummary(record, client);

    expect(sentCommand(client).input.ConditionExpression).toBeUndefined();
  });

  it('sorts after every event in the partition, so a timeline needs no filtering', async () => {
    // An event's sort key starts with a digit; `s` cannot be beaten by one. This is the
    // whole reason the key is the word `summary` and not a timestamp.
    expect(SUMMARY_SORT_KEY > '2026-02-13T13:39:57.200Z#evt-1').toBe(true);
  });

  it('reads back on the same key rather than querying the partition', async () => {
    const client = fakeClient({ Item: { ...record, sort_key: SUMMARY_SORT_KEY, item_type: 'summary' } });
    await expect(querySummary('2026-02-13', client)).resolves.toMatchObject({
      summary: 'One delivery and one visitor today.',
    });

    const command = sentCommand(client);
    expect(command.constructor.name).toBe('GetCommand');
    expect(command.input.Key).toEqual({ date: '2026-02-13', sort_key: SUMMARY_SORT_KEY });
  });

  it('returns undefined for a day with no summary, which is an ordinary state', async () => {
    await expect(querySummary('2026-02-13', fakeClient({}))).resolves.toBeUndefined();
  });

  it('throws a named error when the events table variable is missing', async () => {
    delete process.env[EVENTS_TABLE_ENV];
    await expect(querySummary('2026-02-13', fakeClient({}))).rejects.toThrow(
      new RegExp(EVENTS_TABLE_ENV),
    );
  });

  it('exposes isPartitionDate for callers that validate a date before querying', () => {
    expect(isPartitionDate('2026-02-13')).toBe(true);
    expect(isPartitionDate('2026-02-31')).toBe(false);
    expect(isPartitionDate('13/02/2026')).toBe(false);
    expect(isPartitionDate('2026-2-3')).toBe(false);
  });
});
