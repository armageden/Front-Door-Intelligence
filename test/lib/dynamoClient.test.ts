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
  IDEMPOTENCY_TABLE_ENV,
  IDEMPOTENCY_TTL_SECONDS,
  claimRequestId,
  putEvent,
  setClient,
  toDoorEvent,
} from '../../src/lib/dynamoClient';
import type { DoorEvent, RingWebhookPayload } from '../../src/types';

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
