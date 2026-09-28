/**
 * Tests for the queue path: reading an event back, writing the outcome, and the SQS
 * message handling.
 *
 * The behaviours worth pinning are the ones that decide whether a redelivery happens
 * or not, because getting that wrong either discards a recoverable event or loops a
 * dead one forever.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { getEvent, markProcessed } from '../../src/lib/dynamoClient';
import { processMessage } from '../../src/handlers/snapshotFetcher';
import type { DoorEvent } from '../../src/types';

const EVENTS_TABLE = 'FrontDoorEvents';
const DATE = '2026-02-13';
const EVENT_ID = 'front_door_cam_motion_1786715596787';
const TS = '2026-02-13T13:39:57.200Z';

const EVENT: DoorEvent = {
  date: DATE,
  event_id: EVENT_ID,
  timestamp: TS,
  occurred_at_ms: 1786715596787,
  device_id: 'front_door_cam',
  event_type: 'motion_detected',
  sub_type: 'human',
  processed: false,
};

interface SentCommand {
  constructor: { name: string };
  input: Record<string, unknown>;
}

function fakeClient(result: unknown = {}) {
  return { send: vi.fn().mockResolvedValue(result) } as never;
}

function sentCommand(client: unknown): SentCommand {
  const send = (client as { send: { mock: { calls: [{ args: [unknown] }][] } } }).send;
  const call = send.mock.calls[0];
  if (!call) throw new Error('no command was sent');
  return call[0] as unknown as SentCommand;
}

beforeAll(() => {
  process.env['DYNAMODB_EVENTS_TABLE'] = EVENTS_TABLE;
});

describe('getEvent', () => {
  it('reads by partition and composite sort key, so it is a GetItem not a scan', async () => {
    const client = fakeClient({ Item: EVENT });
    const found = await getEvent(DATE, EVENT_ID, TS, client);

    expect(found?.event_id).toBe(EVENT_ID);
    const command = sentCommand(client);
    expect(command.constructor.name).toBe('GetCommand');
    expect(command.input.TableName).toBe(EVENTS_TABLE);
    expect(command.input.Key).toEqual({ date: DATE, sort_key: `${TS}#${EVENT_ID}` });
  });

  it('returns undefined for an absent item rather than throwing', async () => {
    // An absent row is not an error: the event was removed or expired.
    await expect(getEvent(DATE, EVENT_ID, TS, fakeClient({}))).resolves.toBeUndefined();
  });

  it('throws a named error when the table variable is missing', async () => {
    const previous = process.env['DYNAMODB_EVENTS_TABLE'];
    delete process.env['DYNAMODB_EVENTS_TABLE'];
    await expect(getEvent(DATE, EVENT_ID, TS, fakeClient({}))).rejects.toThrow(
      /DYNAMODB_EVENTS_TABLE/,
    );
    if (previous !== undefined) process.env['DYNAMODB_EVENTS_TABLE'] = previous;
  });
});

describe('markProcessed', () => {
  it('records the description, marks processed, and stores the source', async () => {
    const client = fakeClient();
    await markProcessed(
      EVENT,
      { description: 'A person places a box', processed: true, source: 'ai' },
      client,
    );

    const input = sentCommand(client).input as Record<string, unknown>;
    expect(sentCommand(client).constructor.name).toBe('UpdateCommand');
    expect(input.Key).toEqual({ date: DATE, sort_key: `${TS}#${EVENT_ID}` });
    const values = input.ExpressionAttributeValues as Record<string, unknown>;
    expect(values[':description']).toBe('A person places a box');
    // A fallback sentence is still terminal. Leaving this false would make the queue
    // redeliver a message that will never succeed.
    expect(values[':processed']).toBe(true);
    // The source round-trips so a demo can show how many sentences were model-written.
    expect(values[':source']).toBe('ai');
  });

  it('adds the snapshot key only when there is one', async () => {
    const withKey = fakeClient();
    await markProcessed(
      EVENT,
      { description: 'd', processed: true, source: 'ai', snapshotKey: 'snapshots/x.jpg' },
      withKey,
    );
    const a = sentCommand(withKey).input as Record<string, unknown>;
    expect(String(a.UpdateExpression)).toContain('snapshot_s3_key');
    expect((a.ExpressionAttributeValues as Record<string, unknown>)[':snapshot']).toBe('snapshots/x.jpg');

    const without = fakeClient();
    await markProcessed(EVENT, { description: 'd', processed: true, source: 'ai' }, without);
    const b = sentCommand(without).input as Record<string, unknown>;
    expect(String(b.UpdateExpression)).not.toContain('snapshot_s3_key');
  });

  it('can record processed=false so a 425 is redelivered', async () => {
    const client = fakeClient();
    await markProcessed(EVENT, { description: 'Motion detected', processed: false, source: 'fallback' }, client);
    const values = sentCommand(client).input.ExpressionAttributeValues as Record<string, unknown>;
    expect(values[':processed']).toBe(false);
  });
});

describe('processMessage — the queue path', () => {
  const validBody = JSON.stringify({ date: DATE, event_id: EVENT_ID, timestamp: TS });

  function deps(overrides: Partial<Parameters<typeof processMessage>[1]> = {}) {
    const loadEvent: MockInstance<typeof getEvent> = vi.fn().mockResolvedValue(EVENT);
    const saveOutcome: MockInstance<typeof markProcessed> = vi.fn().mockResolvedValue(undefined);
    const describe = vi.fn(async () => ({
      description: 'A person places a box',
      source: 'ai' as const,
      processed: true,
    }));
    return {
      loadEvent,
      saveOutcome,
      describe,
      deps: { loadEvent, saveOutcome, describe, ...overrides } as never,
    };
  }

  it('describes the event and writes the outcome', async () => {
    const d = deps();
    const outcome = await processMessage(validBody, d.deps);

    expect(outcome.status).toBe('described');
    // Reads with the full sort key, not just the partition.
    expect(d.loadEvent).toHaveBeenCalledWith(DATE, EVENT_ID, TS);
    expect(d.saveOutcome).toHaveBeenCalledTimes(1);
  });

  it('skips, without failing, when the event is not in the table', async () => {
    // The ingress write is the source of truth and it succeeded, so an absent row means
    // removed or expired — not an error worth redelivering.
    const d = deps({ loadEvent: vi.fn(async () => undefined) as never });
    const outcome = await processMessage(validBody, d.deps);
    expect(outcome.status).toBe('skipped');
    expect(d.saveOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ['unparseable JSON', 'not json'],
    ['a message missing the timestamp', JSON.stringify({ date: DATE, event_id: EVENT_ID })],
    ['an empty object', '{}'],
  ])('fails on %s so the message goes to the DLQ rather than looping', async (_label, body) => {
    const d = deps();
    const outcome = await processMessage(body, d.deps);
    expect(outcome.status).toBe('failed');
    expect(d.loadEvent).not.toHaveBeenCalled();
  });

  it('propagates a storage error so the message is redelivered', async () => {
    const d = deps({
      loadEvent: vi.fn(async () => {
        throw new Error('DynamoDB unavailable');
      }) as never,
    });
    await expect(processMessage(validBody, d.deps)).rejects.toThrow(/DynamoDB unavailable/);
  });
});
