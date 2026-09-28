/**
 * DynamoDB access for the event store and the idempotency table.
 *
 * Table design is from `ARCHITECTURE.md` §3.5: the events table is partitioned by
 * `date` (UTC, `YYYY-MM-DD`) and sorted by `timestamp#event_id`; the idempotency
 * table is keyed on `request_id` with a 24-hour TTL.
 *
 * Every exported function takes an optional client so tests can inject a stub
 * instead of reaching AWS. With no argument, a module-level singleton is used.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

import type { DoorEvent, RingWebhookPayload } from '../types';

/** `DYNAMODB_IDEMPOTENCY_TABLE`. `ARCHITECTURE.md` §3.5 — 24 hours. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** `DYNAMODB_EVENTS_TABLE`. */
export const EVENTS_TABLE_ENV = 'DYNAMODB_EVENTS_TABLE';

/** `DYNAMODB_IDEMPOTENCY_TABLE`. */
export const IDEMPOTENCY_TABLE_ENV = 'DYNAMODB_IDEMPOTENCY_TABLE';

export type DocClient = DynamoDBDocumentClient;

let cached: DocClient | undefined;

/** Lazily create a document client. Overridable for tests. */
export function getClient(): DocClient {
  if (!cached) {
    cached = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return cached;
}

/** Test seam: replace the singleton. Pass `undefined` to restore the default. */
export function setClient(client: DocClient | undefined): void {
  cached = client;
}

function tableName(envVar: string): string {
  const name = process.env[envVar];
  if (!name) throw new Error(`Missing required environment variable: ${envVar}`);
  return name;
}

/**
 * Claim a `request_id` exactly once.
 *
 * NFR2 requires that duplicate `request_id` values must not create duplicate events.
 * A conditional write is the whole mechanism: the first caller wins, everyone after
 * gets `ConditionalCheckFailedException` and is told the event was a duplicate.
 *
 * There is no read-then-write here on purpose. A check followed by an unconditional
 * put would leave a window in which two concurrent retries of the same webhook both
 * observe "not seen" and both proceed.
 *
 * @returns `true` if this caller claimed the id, `false` if it was already claimed.
 */
export async function claimRequestId(
  requestId: string,
  client: DocClient = getClient(),
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  try {
    await client.send(
      new PutCommand({
        TableName: tableName(IDEMPOTENCY_TABLE_ENV),
        Item: {
          request_id: requestId,
          claimed_at: now,
          expires_at: now + IDEMPOTENCY_TTL_SECONDS,
        },
        ConditionExpression: 'attribute_not_exists(request_id)',
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

/**
 * Convert a verified webhook payload into the stored event shape.
 *
 * `date` is derived in **UTC** so the partition key is deterministic and independent
 * of where the Lambda runs. A later stage may need the homeowner's local date for
 * "today's events"; that is a product decision, not an ingress one.
 */
export function toDoorEvent(payload: RingWebhookPayload): DoorEvent {
  const timestamp = new Date(payload.meta.time);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Unparseable meta.time: ${payload.meta.time}`);
  }
  return {
    date: timestamp.toISOString().slice(0, 10),
    event_id: payload.data.id,
    timestamp: payload.meta.time,
    device_id: payload.data.attributes.source,
    event_type: payload.data.type,
    ...(payload.data.attributes.timestamp !== undefined
      ? { occurred_at_ms: payload.data.attributes.timestamp }
      : {}),
    ...(payload.data.attributes.sub_type !== undefined
      ? { sub_type: payload.data.attributes.sub_type }
      : {}),
    ...(payload.meta.account_id !== undefined ? { account_id: payload.meta.account_id } : {}),
    processed: false,
  };
}

/** Store a processed event. FR7. */
export async function putEvent(
  event: DoorEvent,
  client: DocClient = getClient(),
): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: tableName(EVENTS_TABLE_ENV),
      Item: {
        ...event,
        // Sort key. The composite suffix keeps the key unique when two events land in
        // the same millisecond.
        sort_key: `${event.timestamp}#${event.event_id}`,
      },
    }),
  );
}

/**
 * Write the describe-stage outcome back onto the event.
 *
 * `processed` is set even when the description came from the FR11 fallback, because
 * "we have a sentence, it is just not an AI sentence" is a terminal state. Leaving it
 * false would make the queue redeliver forever.
 */
export async function markProcessed(
  event: DoorEvent,
  outcome: { description: string; snapshotKey?: string; processed: boolean; source: string },
  client: DocClient = getClient(),
): Promise<void> {
  const names: Record<string, string> = { '#description': 'description' };
  const values: Record<string, unknown> = {
    ':description': outcome.description,
    ':processed': outcome.processed,
    ':source': outcome.source,
  };
  let set = 'SET #description = :description, processed = :processed, description_source = :source';

  if (outcome.snapshotKey !== undefined) {
    set += ', snapshot_s3_key = :snapshot';
    values[':snapshot'] = outcome.snapshotKey;
  }

  await client.send(
    new UpdateCommand({
      TableName: tableName(EVENTS_TABLE_ENV),
      Key: { date: event.date, sort_key: `${event.timestamp}#${event.event_id}` },
      UpdateExpression: set,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/**
 * Read one event back by its partition and sort key.
 *
 * The describe stage re-reads rather than trusting the queue message, because the events
 * table is the source of truth and the message is only a signal. A missing item returns
 * `undefined` rather than throwing: an absent row means the event was removed or has
 * expired, which is not an error condition.
 */
export async function getEvent(
  date: string,
  eventId: string,
  timestamp: string,
  client: DocClient = getClient(),
): Promise<DoorEvent | undefined> {
  const response = (await client.send(
    new GetCommand({
      TableName: tableName(EVENTS_TABLE_ENV),
      Key: { date, sort_key: `${timestamp}#${eventId}` },
    }),
  )) as { Item?: Record<string, unknown> };
  return (response.Item as DoorEvent | undefined) ?? undefined;
}
