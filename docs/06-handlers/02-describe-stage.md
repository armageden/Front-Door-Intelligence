**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/handlers/snapshotFetcher.ts` → `describeEvent()`, `handler`, `DescribeEventResult`, `SNAPSHOT_TIMEOUT_MS`, read in full; `test/handlers/snapshotFetcher.test.ts` → the failure matrix, all passing; `src/lib/dynamoClient.ts` → `getEvent()` and `markProcessed()`; the queue wiring in `template.yaml` read in full. Not verified: any live Ring or Bedrock call.

# Describe stage

Fetches the camera snapshot and produces the sentence. Implements **FR4** (snapshot
within 5 seconds of the webhook) and **FR5** (Bedrock description), and drives **FR11**
(deterministic fallback).

## Exported surface

| Export | Kind | Purpose |
|---|---|---|
| `describeEvent(options)` | async function | The whole stage, with `fetchSnapshot`, `describeImage`, and `store` all injectable. Returns a `DescribeEventResult` rather than writing, so it is testable with no AWS, no queue, and no clock |
| `handler` | SQS handler | Consumes the describe queue, one record at a time |
| `DescribeEventOptions` | type | `{ event, describeImage?, fetchSnapshot?, store?, region?, modelId? }` |
| `DescribeEventResult` | type | `{ description, source, processed, snapshotKey?, reason? }` |
| `SNAPSHOT_TIMEOUT_MS` | const | `4000` — `ARCHITECTURE.md` §3.2's budget |

`source` is `'ai'` or `'fallback'`, and is persisted as `description_source` on the event
item, so a demo can show how many descriptions were actually model-generated.

## The design rule: every failure ends in a sentence

The product promise is a sentence about what happened. A silent failure produces an
alert the user never sees — which is the exact problem this project exists to fix. So
every non-happy path still writes a `description`:

| Failure | `source` | `processed` | Why |
|---|---|---|---|
| Bedrock unavailable or errored | `fallback` | `true` | FR11's deterministic summary |
| Bedrock returns empty text | `fallback` | `true` | An empty string is not a description |
| Encrypted media (TAKE/E2EE) | `fallback` | `true` | Documented as unrecoverable; one call, no retry |
| Media not ready (425) | `fallback` | **`false`** | The queue redelivers; a later attempt can succeed |
| Snapshot fetch failed | `fallback` | `true` | A missing image must not cost the sentence |
| Upload failed | `ai` | `true` | A missing image is cosmetic; keep the description |
| No usable timestamp | `fallback` | `true` | Nothing to anchor a media window to |

Each of these has a test. The two worth singling out:

**425 leaves `processed: false`.** Every other failure is terminal, but this one is
merely early: the recording may not exist at the instant the event fired, and the
verified Ring behaviour is that `at_timestamp` returns 425 in that case. Marking it
processed would discard a recoverable event; leaving it unprocessed lets the queue's
redelivery pick it up with a wider window.

**A failed upload does not downgrade the description.** If S3 is unreachable but Bedrock
answered, the user still gets their sentence and the dashboard just has no thumbnail.
Inverting that would trade the product's core promise for a picture.

## The media window is anchored to the device's clock

`describeEvent` builds a `latest_in_range` window from `event.occurred_at_ms`:

```
start = occurred_at_ms - 5000     end = occurred_at_ms + 60000
```

The five-second lead is because the verified Ring behaviour is that a request fired at
the instant of the event will often return `425 RECORDING_NOT_READY`. A window that
starts slightly early tolerates that, where `at_timestamp` cannot.

This is why `occurred_at_ms` was added to `DoorEvent`. It is **not** derivable from the
ISO `timestamp`: Ring's `timestamp_readable` carries no timezone offset, and re-deriving
epoch milliseconds from an ISO string risks an off-by-hours window. Carrying the
device's own number is the only reliable anchor.

## The SQS handler names its failures

`processMessage` is the tested unit: it returns a status rather than throwing, so
`described`, `skipped`, and `failed` are each asserted directly. The SQS `handler` is a
thin adapter over it that maps that status to `batchItemFailures`, and it is the one
piece here with no direct unit test — it builds its real dependencies, which need AWS.

That adapter originally always returned an empty array, which would have silently
discarded every failure — a claim of success with no verification behind it, the same
shape of defect as a vacuous coverage check. Splitting the logic into `processMessage is
what made it testable; the residual adapter is short enough to read.

A message naming an event that is not in the table is **not** treated as a failure. The
ingress write is the source of truth and it succeeded, so an absent row means the event
was removed or expired, which is not an error.

## Known gaps

- **`device_name` is still never set.** The event carries `sub_type`, so the fallback
  reads "Person detected at the door". `ringClient.getDevice()` exists and would fix
  it, but calling it costs a third Ring round trip inside a 60-second budget that also
  holds a media fetch and a Bedrock call. The right place is a later enrichment stage or
  the query path, and it is a product call, not a bug.
- **The CloudWatch billing alarm `ARCHITECTURE.md` §6 asks for does not exist.** No alarm
  is declared in `template.yaml`. The token-cost levers are set; detection is not.
- **The Bedrock request envelope is unverified.** No AWS documentation was fetched while
  writing the client. It is the most likely thing to need adjusting on first real
  invocation, and the failure is loud rather than silent — an API error, caught, turned
  into the FR11 fallback. See [04-bedrock-client](../04-libraries/04-bedrock-client.md).
- **The 90-day TTL on the events table is still unreconciled** — declared, but only
  idempotency rows populate `expires_at`.

## Related

- The stage before this: [01-webhook-ingress](./01-webhook-ingress.md)
- The Bedrock client and its prompt: [04-bedrock-client](../04-libraries/04-bedrock-client.md)
- The Ring client: [03-ring-client](../04-libraries/03-ring-client.md)
- The queue and bucket: [05-snapshot-store](../04-libraries/05-snapshot-store.md)
