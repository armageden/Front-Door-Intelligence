/**
 * S3 storage for camera snapshots, and the SQS hand-off that carries an event from
 * ingress to the describe stage.
 *
 * Two small concerns that live together because they are both the "get the event to the
 * next stage and keep the bytes" plumbing between the webhook and the AI layer.
 *
 * ## The hand-off is asynchronous by necessity
 *
 * The Ring documentation names inline heavy processing in the webhook handler as a
 * Common Mistake: it exceeds the 5-second response budget and produces duplicates. NFR1
 * requires a 200 within 5 seconds, and Bedrock plus a media fetch will not fit inside
 * that alongside signature verification and two DynamoDB writes.
 *
 * So ingress stores the event, enqueues a small message, and returns. The describe stage
 * consumes the queue. The message carries **identifiers only** — never the image, which
 * would be far too large for the queue's message limit, and never the description,
 * which does not exist yet.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import type { DoorEvent } from '../types';

/** `S3_SNAPSHOT_BUCKET`, `ARCHITECTURE.md` §8.2. */
export const SNAPSHOT_BUCKET_ENV = 'S3_SNAPSHOT_BUCKET';
export const QUEUE_URL_ENV = 'EVENT_QUEUE_URL';

export type SendLike = (input: {
  queueUrl: string;
  body: string;
}) => Promise<{ MessageId?: string }>;

/** Seam for the S3 write, so the store is testable without an AWS account. */
export type PutLike = (input: {
  bucket: string;
  key: string;
  bytes: Uint8Array;
  contentType: string;
}) => Promise<void>;

export interface SnapshotStoreOptions {
  readonly bucket: string;
  readonly send?: SendLike;
  readonly put?: PutLike;
}

/**
 * The key layout is `ARCHITECTURE.md` §3.5's example: `snapshots/<date>/<event_id>.jpg`.
 * Partitioning by date means the bucket is browsable by day, which is also how the
 * events table is keyed, so the two stay greppable together.
 */
export function snapshotKey(event: Pick<DoorEvent, 'date' | 'event_id' | 'snapshot_s3_key'>): string {
  if (event.snapshot_s3_key) return event.snapshot_s3_key;
  return `snapshots/${event.date}/${event.event_id}.jpg`;
}

export function createSnapshotStore(options: SnapshotStoreOptions) {
  const { bucket } = options;

    const send: SendLike =
    options.send ??
    (async (input) => {
      const client = new SQSClient({});
      const response = await client.send(
        new SendMessageCommand({ QueueUrl: input.queueUrl, MessageBody: input.body }),
      );
      return response.MessageId !== undefined ? { MessageId: response.MessageId } : {};
    });

  const put: PutLike =
    options.put ??
    (async (input) => {
      const client = new S3Client({});
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.bytes,
          ContentType: input.contentType,
          // The bucket is not public; ARCHITECTURE.md §6 requires pre-signed access.
          // Object ownership is enforced in the template so a public ACL cannot be
          // attached later.
          ServerSideEncryption: 'AES256',
        }),
      );
    });

  /**
   * Upload a snapshot and return its key.
   *
   * Content type is set explicitly rather than left to a default: a JPEG served as
   * `application/octet-stream` breaks the pre-signed URL path in the dashboard, where
   * `ARCHITECTURE.md` §6 requires a 1-hour expiry.
   */
  async function putSnapshot(
    key: string,
    bytes: Uint8Array,
    contentType = 'image/jpeg',
  ): Promise<string> {
    await put({ bucket, key, bytes, contentType });
    return key;
  }

  /**
   * Enqueue an event for the describe stage.
   *
   * Identifiers only. A 256 KB message limit makes anything larger a runtime failure
   * rather than a validation error, so the payload is deliberately minimal: the events
   * table is the source of truth and the queue is only a signal.
   *
   * `timestamp` is included because the consumer needs it to rebuild the table's sort
   * key (`timestamp#event_id`) when it reads the event back. Without it the consumer
   * would have to scan, which is the one thing the `date` partition exists to avoid.
   */
  async function enqueueForDescribe(event: DoorEvent, queueUrl: string): Promise<string | undefined> {
    const messageId = await send({
      queueUrl,
      body: JSON.stringify({
        date: event.date,
        event_id: event.event_id,
        timestamp: event.timestamp,
        device_id: event.device_id,
        // The Ring event timestamp, which is what a snapshot request must be anchored
        // to. `attributes.timestamp` is epoch ms and beats `meta.time` for this.
        occurred_at_ms: event.occurred_at_ms,
        sub_type: event.sub_type,
        account_id: event.account_id,
      }),
    });
    return messageId?.MessageId;
  }

  return { putSnapshot, enqueueForDescribe, bucket };
}

export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
