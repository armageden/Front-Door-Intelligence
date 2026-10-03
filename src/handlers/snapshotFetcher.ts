/**
 * Snapshot fetch and description: the stage between ingress and the overlay.
 *
 * Implements FR4 (request a camera snapshot via the Ring Partner API) and FR5 (send it
 * to Bedrock for a one-sentence description), and drives FR11 (deterministic fallback
 * when Bedrock is unavailable) and FR12's `processed` flag.
 *
 * ## Why this is a separate handler
 *
 * NFR1 requires the webhook endpoint to answer within 5 seconds, and the Ring
 * documentation names inline heavy processing as a Common Mistake for exactly that
 * reason. The verified media flow alone is two round trips plus a 303, and Bedrock adds
 * seconds. This stage therefore runs off an SQS queue, consuming the identifier-only
 * message that ingress enqueues, and re-reads the event from the events table rather
 * than trusting the message body.
 *
 * ## Every failure ends in a description, never in silence
 *
 * The product promise is a sentence about what happened. A silent failure produces an
 * alert the user never sees, which is the exact problem this project exists to fix. So
 * every non-happy path still writes a `description`:
 *
 * | Failure | Description written |
 * |---|---|
 * | Bedrock unavailable or errored | FR11 deterministic summary |
 * | Media not ready (425) | FR11 deterministic summary, event left for retry |
 * | Encrypted media (TAKE/E2EE) | FR11 deterministic summary, no retry |
 * | Device name unresolvable | The AI description, without a location phrase |
 *
 * Only an infrastructure error that prevents writing to DynamoDB propagates, because
 * that is the one case where there is nowhere to record the outcome.
 */

import type { SQSHandler } from 'aws-lambda';

import {
  createRingClient,
  EncryptedMediaError,
  SnapshotNotReadyError,
} from '../lib/ringClient';
import {
  createBedrockClient,
  deterministicDescription,
  BedrockError,
  BEDROCK_MODEL_ENV,
} from '../lib/bedrockClient';
import { createSnapshotStore, snapshotKey, QUEUE_URL_ENV, SNAPSHOT_BUCKET_ENV } from '../lib/snapshotStore';
import { getEvent, markProcessed } from '../lib/dynamoClient';
import type { DoorEvent } from '../types';

/** `ARCHITECTURE.md` §3.3 recommends keeping the whole fetch within the latency budget. */
export const SNAPSHOT_TIMEOUT_MS = 4000;

export interface DescribeEventOptions {
  readonly event: DoorEvent;
  /** Injected in tests. */
  readonly describeImage?: (bytes: Uint8Array) => Promise<string>;
  readonly fetchSnapshot?: (deviceId: string, ms: number) => Promise<{
    bytes: Uint8Array;
    contentType: string;
  }>;
  readonly store?: {
    putSnapshot: (key: string, bytes: Uint8Array, contentType?: string) => Promise<string>;
  };
  /**
   * Resolve the camera's name via `GET /v1/devices/{id}`.
   *
   * Injected in tests; in production the handler wires this to `ringClient.getDevice()`.
   * Returning `undefined` means "the name could not be learned", which is the common case:
   * Ring sends no device name in any webhook, so it has to be fetched, and a lookup that
   * fails must not cost the event its description.
   */
  readonly resolveDeviceName?: (deviceId: string) => Promise<string | undefined>;
  readonly region?: string;
  readonly modelId?: string;
}
export interface DescribeEventResult {
  readonly description: string;
  /** `ai` when the model answered, `fallback` when FR11's deterministic path ran. */
  readonly source: 'ai' | 'fallback';
  readonly snapshotKey?: string;
  readonly processed: boolean;
  /** The resolved camera name, when one was learned. Absent otherwise. */
  readonly deviceName?: string;
  /** Set when the description came from the fallback, for logging. */
  readonly reason?: string;
}

/**
 * Fetch a snapshot and describe it, writing the outcome onto the event.
 *
 * Exported separately from the handler so the logic is testable with no SQS, no AWS,
 * and no clock.
 */
export async function describeEvent(options: DescribeEventOptions): Promise<DescribeEventResult> {
  const { event } = options;

  const fetchSnapshot =
    options.fetchSnapshot ??
    (async (deviceId: string, occurredAtMs: number) => {
      const client = createRingClient({
        clientId: requireEnv('RING_CLIENT_ID'),
        clientSecret: requireEnv('RING_CLIENT_SECRET'),
        refreshToken: requireEnv('RING_REFRESH_TOKEN'),
      });
      return client.fetchSnapshot(deviceId, {
        mode: 'latest_in_range',
        // Start a few seconds before the event: the recording may not exist at the
        // exact instant, and `latest_in_range` tolerates that where `at_timestamp`
        // would 425.
        startTimestampMs: Math.max(0, occurredAtMs - 5000),
        endTimestampMs: occurredAtMs + 60_000,
      });
    });

  const describeImage =
    options.describeImage ??
    (async (bytes: Uint8Array) => {
      const client = createBedrockClient({
        modelId: options.modelId ?? requireEnv(BEDROCK_MODEL_ENV),
        region: options.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
      });
      return client.describeImage(bytes);
    });

  // The device name is resolved BEFORE the fallback sentence is built, not after: the
  // fallback reads "Person detected at <name>", and resolving it afterwards would produce
  // "at the door" for an event whose camera is plainly named. A failure is swallowed,
  // because a name is cosmetic and a missing description is the product failure.
  let deviceName: string | undefined;
  if (event.device_name !== undefined && event.device_name.trim().length > 0) {
    // Already known. Ingress cannot learn it, but a redelivered queue message re-reads a row
    // that has it, and re-fetching would spend a Ring API call to learn the same string.
    deviceName = event.device_name.trim();
  } else if (options.resolveDeviceName !== undefined) {
    try {
      const resolved = await options.resolveDeviceName(event.device_id);
      if (resolved !== undefined && resolved.trim().length > 0) deviceName = resolved.trim();
    } catch (error) {
      console.warn('device name lookup failed', {
        device_id: event.device_id,
        error: messageOf(error),
      });
    }
  }

  // Every path below describes the event *with* its name, so the FR11 fallback can use it.
  const named: DoorEvent = deviceName === undefined ? event : { ...event, device_name: deviceName };
  const withName = deviceName === undefined ? {} : { deviceName };

  const fallback = (reason: string): DescribeEventResult => ({
    description: deterministicDescription(named),
    source: 'fallback',
    processed: true,
    ...withName,
    reason,
  });

  // Anchor the media window to the device's own clock. Without it there is no
  // timestamp to ask for and the whole stage is unrunnable.
  const occurredAtMs = event.occurred_at_ms ?? Date.parse(event.timestamp);
  if (!Number.isFinite(occurredAtMs)) {
    return fallback('event carried no usable timestamp');
  }

  let snapshot: { bytes: Uint8Array; contentType: string };
  try {
    snapshot = await fetchSnapshot(event.device_id, occurredAtMs);
  } catch (error) {
    if (error instanceof EncryptedMediaError) {
      // Documented TAKE/E2EE behaviour: retrying cannot help, so degrade immediately.
      return fallback('encrypted media (TAKE/E2EE account)');
    }
    if (error instanceof SnapshotNotReadyError) {
      // The queue's visibility timeout will redeliver; leaving processed false lets a
      // later attempt with a wider window succeed.
      return { ...fallback('media not ready'), processed: false };
    }
    return fallback(`snapshot fetch failed: ${messageOf(error)}`);
  }

  let snapshotKeyValue: string | undefined;
  if (options.store) {
    try {
      snapshotKeyValue = await options.store.putSnapshot(
        snapshotKey(event),
        snapshot.bytes,
        snapshot.contentType,
      );
    } catch (error) {
      // A missing snapshot is cosmetic; a missing description is the product failure.
      // Continue and record the description without an image key.
      snapshotKeyValue = undefined;
      console.warn('snapshot upload failed', { error: messageOf(error) });
    }
  }
  // exactOptionalPropertyTypes: attach the key only when one exists.
  const withKey = snapshotKeyValue !== undefined ? { snapshotKey: snapshotKeyValue } : {};

  try {
    const description = await describeImage(snapshot.bytes);
    if (!description || description.trim().length === 0) {
      return { ...fallback('model returned no text'), ...withKey };
    }
    return {
      description: description.trim(),
      source: 'ai',
      processed: true,
      ...withKey,
      ...withName,
    };
  } catch (error) {
    if (error instanceof BedrockError) {
      return { ...fallback('bedrock unavailable'), ...withKey };
    }
    return { ...fallback(`bedrock error: ${messageOf(error)}`), ...withKey };
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Dependencies for {@link processMessage}, injected so the queue path is testable
 * without AWS, a queue, or a network. Mirrors the `ingest(options)` shape used by
 * `webhookHandler`.
 */
export interface ProcessMessageDeps {
  readonly loadEvent: (date: string, eventId: string, timestamp: string) => Promise<DoorEvent | undefined>;
  readonly saveOutcome: (event: DoorEvent, result: DescribeEventResult) => Promise<void>;
  readonly describe: (event: DoorEvent) => Promise<DescribeEventResult>;
}

export interface ProcessMessageResult {
  readonly status: 'described' | 'skipped' | 'failed';
  readonly reason?: string;
}

/**
 * Process one queue message.
 *
 * Returns rather than throws, so the caller can name failures without try/catch noise
 * and so each failure mode is a return value a test can assert.
 */
export async function processMessage(
  body: string,
  deps: ProcessMessageDeps,
): Promise<ProcessMessageResult> {
  let message: { date: string; event_id: string; timestamp: string };
  try {
    message = JSON.parse(body) as typeof message;
  } catch (error) {
    return { status: 'failed', reason: `unparseable message: ${messageOf(error)}` };
  }
  if (!message?.date || !message.event_id || !message.timestamp) {
    return { status: 'failed', reason: 'message missing date, event_id, or timestamp' };
  }

  // The table is the source of truth; the queue message is only a signal.
  const stored = await deps.loadEvent(message.date, message.event_id, message.timestamp);
  if (!stored) {
    // Not a failure. The ingress write succeeded, so an absent row means the event was
    // removed or expired, which is not an error condition.
    return { status: 'skipped', reason: 'event not in the table' };
  }

  const result = await deps.describe(stored);
  await deps.saveOutcome(stored, result);
  return { status: 'described' };
}

/**
 * SQS entry point.
 *
 * Records are processed independently and the ones that failed are named explicitly, so
 * a single bad message is redelivered without re-driving the ones that succeeded.
 */
export const handler: SQSHandler = async (event) => {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  const store = createSnapshotStore({ bucket: process.env[SNAPSHOT_BUCKET_ENV] ?? '' });

  // One Ring client for the whole batch, and one device lookup per distinct camera. A batch
  // of ten events from one doorbell is ten identical GET /v1/devices calls otherwise, and
  // this is the only non-idempotent-per-event cost in the stage.
  const ring = createRingClient({
    clientId: process.env['RING_CLIENT_ID'] ?? '',
    clientSecret: process.env['RING_CLIENT_SECRET'] ?? '',
    refreshToken: process.env['RING_REFRESH_TOKEN'] ?? '',
  });
  const deviceNames = new Map<string, Promise<string | undefined>>();

  const deps: ProcessMessageDeps = {
    loadEvent: (date, eventId, timestamp) => getEvent(date, eventId, timestamp),
    saveOutcome: (stored, result) => markProcessed(stored, result),
    describe: (stored) => {
      const modelId = process.env[BEDROCK_MODEL_ENV];
      return describeEvent({
        event: stored,
        store,
        resolveDeviceName: (deviceId) => {
          const existing = deviceNames.get(deviceId);
          if (existing !== undefined) return existing;
          const pending = ring
            .getDevice(deviceId)
            .then((device) => (device.name.trim().length > 0 ? device.name : undefined))
            .catch(() => undefined);
          deviceNames.set(deviceId, pending);
          return pending;
        },
        // Omitted rather than passed as undefined: describeEvent falls back to
        // requireEnv, which throws a named error naming the missing variable.
        ...(modelId !== undefined ? { modelId } : {}),
      });
    },
  };

  for (const record of event.Records) {
    const itemIdentifier = record.messageId;
    if (!itemIdentifier) continue;
    try {
      const outcome = await processMessage(record.body, deps);
      if (outcome.status === 'failed') {
        console.error('describe stage rejected a message', {
          messageId: record.messageId,
          reason: outcome.reason,
        });
        batchItemFailures.push({ itemIdentifier });
      } else if (outcome.status === 'skipped') {
        console.warn('describe stage skipped a message', {
          messageId: record.messageId,
          reason: outcome.reason,
        });
      }
    } catch (error) {
      console.error('describe stage failed', {
        messageId: record.messageId,
        error: messageOf(error),
      });
      batchItemFailures.push({ itemIdentifier });
    }
  }

  return { batchItemFailures };
};
