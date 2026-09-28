**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/lib/snapshotStore.ts` → `createSnapshotStore()`, `putSnapshot()`, `enqueueForDescribe()`, `snapshotKey()`, `SNAPSHOT_BUCKET_ENV`, `QUEUE_URL_ENV`, read in full; the SQS and S3 clients imported from the installed `@aws-sdk/client-sqs` and `@aws-sdk/client-s3` packages; the queue and bucket resources in `template.yaml` read in full. Not verified: any live S3 or SQS behaviour — no AWS account is available.

# Snapshot store and describe queue

Two small concerns that live together because both are the plumbing between ingress and
the describe stage: keep the image, and signal that an image is ready to be described.

## Exported surface

| Export | Kind | Purpose |
|---|---|---|
| `createSnapshotStore(options)` | factory | Returns `{ putSnapshot, enqueueForDescribe, bucket }`. `options.send` is injected in tests |
| `snapshotKey(event)` | function | Pure. `snapshots/<date>/<event_id>.jpg`, or an existing key if one is set |
| `SNAPSHOT_BUCKET_ENV` / `QUEUE_URL_ENV` | const | `S3_SNAPSHOT_BUCKET` / `EVENT_QUEUE_URL` |
| `SendLike` / `SnapshotStore` | types | Injection seam and the client shape |

## Why the hand-off is a queue and not a direct invoke

`ARCHITECTURE.md` §3.2 says the snapshot fetcher is triggered by "Direct Lambda invoke
from WebhookHandler". **That is not what was built, and the reason is documented in the
source rather than the spec.**

NFR1 requires the webhook to answer within 5 seconds. The verified media flow alone is
two round trips plus a 303, and Bedrock adds seconds. Doing any of it inline would blow
the budget — and the Ring documentation names exactly this as a Common Mistake:
"doing heavy processing in handler → exceeds 5-second timeout, causes duplicates".

So ingress stores the event, sends a queue message, and returns. The describe stage
consumes the queue. The `Timeout` on the webhook function stays at 5 seconds and the
describe function gets 60, which is the clearest statement of the split.

## The message is identifiers only

```json
{ "date": "...", "event_id": "...", "timestamp": "...", "device_id": "...",
  "occurred_at_ms": 1786715596787, "sub_type": "human", "account_id": "..." }
```

Never the image — SQS caps a message at 256 KB and a JPEG would fail at runtime rather
than at validation. Never the description, which does not exist yet.

**`timestamp` is included for a specific reason:** the consumer needs it to rebuild the
events table's sort key (`timestamp#event_id`) when it reads the event back. Without it
the consumer would have to scan, which is the single thing the `date` partition exists
to prevent. This was a real gap — `getEvent` was written needing a timestamp the first
message shape did not carry, and `tsc` caught it.

The consumer re-reads the event from DynamoDB rather than trusting the message. The
table is the source of truth; the queue is only a signal.

## Snapshot keys mirror the table's partitioning

`snapshots/<date>/<event_id>.jpg` follows the same date-first shape as the events table,
so both are browsable by day and greppable together. An existing `snapshot_s3_key` is
always preferred over a computed one, so a re-run cannot orphan an object it already
wrote.

## Storage settings, and what they are for

`putSnapshot` sets `ContentType` explicitly rather than letting a default apply: a JPEG
stored as `application/octet-stream` breaks the pre-signed URL path the dashboard uses,
where `ARCHITECTURE.md` §6 requires a 1-hour expiry. It also sets server-side encryption
and the bucket in `template.yaml` sets `ObjectOwnership: BucketOwnerEnforced` plus a
full public-access block, so a public ACL cannot be attached later by accident.

## Queue configuration

| Setting | Value | Why |
|---|---|---|
| `MessageRetentionPeriod` | 4 days | The event is a signal; the table is the record. A lost message costs a description, not an event |
| `VisibilityTimeout` | 180s | Must exceed the describe function's 60s timeout, or a slow invocation is redelivered while the first still runs |
| `maxReceiveCount` | 5 | Then to the DLQ |
| `BatchSize` | 1 | A slow Bedrock call should not hold up unrelated doorbell events |

The DLQ URL is a stack output. Messages there are events with no description; the
`events` table row still exists, so the event is recoverable even when the signal is not.

## A queue failure does not fail the webhook

`ingest` enqueues inside a try/catch and logs on failure. The event is already durably
stored at that point, so the worst case is an event with no description — recoverable by
a sweep. Returning 500 instead would make Ring retry a request that already succeeded,
and since 4xx is permanent and 5xx retries, that turns a cosmetic loss into duplicate
delivery pressure on an endpoint Ring can disable.

## Related

- The stage that consumes the queue: [02-describe-stage](../06-handlers/02-describe-stage.md)
- The stage that enqueues: [01-webhook-ingress](../06-handlers/01-webhook-ingress.md)
- The data model: [04-data-store](../02-architecture/04-data-store.md)
- Security posture: [05-security-and-services](../02-architecture/05-security-and-services.md)
- Environment template: `.env.example`
