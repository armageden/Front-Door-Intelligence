**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §3.5, read directly, including the event item JSON. The pre-signed URL rule was checked against §6. The status note below was reconciled against the working tree on 2026-09-28: `template.yaml` declares `EventsTable`, `IdempotencyTable`, and `ConnectionsTable`, and the client code is in `src/lib/dynamoClient.ts` and `src/lib/connectionStore.ts`, both documented in [04-libraries](../04-libraries/00-overview.md). An earlier version of this page claimed no table definition and no client code existed; that was true when written and stopped being true at the tooling phase.

# Data store

Source: `ARCHITECTURE.md` §3.5. **The tables below are implemented in `template.yaml` and
their client code is in `src/lib/`** — the shapes and the reason for each key are still
specified here. Two of the two specified tables exist, plus a third the spec does not
list.

## Tables

| Table | Partition key | Sort key | TTL | Purpose |
|---|---|---|---|---|
| Events table | `date` (YYYY-MM-DD) | `timestamp#event_id` | 90 days | Store all processed events |
| Idempotency table | `request_id` | — | 24 hours | Prevent duplicate processing |

The environment variables naming these are `DYNAMODB_EVENTS_TABLE` and
`DYNAMODB_IDEMPOTENCY_TABLE`, with example values `FrontDoorEvents` and
`FrontDoorIdempotency` — see
[02-non-functional-requirements](../01-product/02-non-functional-requirements.md).

## Why the keys are shaped this way

Partitioning by `date` is what makes `GET /events/today` a single `Query` rather than a
scan. The sort key concatenating `timestamp#event_id` returns the day's events already
ordered by time, which is exactly the order the dashboard timeline needs.

The composite sort key also makes the key non-unique on timestamp alone, so two events
in the same second cannot collide.

The idempotency table has a 24-hour TTL — long enough to absorb Ring's retry storms,
short enough that the table does not grow without bound. This is the storage half of
NFR2.

## The summary row, and why it has no timestamp in its key

`ARCHITECTURE.md` §3.6 says the daily summary is "written to `EventsTable` as a `summary`
item" and names no key. It shares the day's partition under a **constant** sort key,
`summary`, rather than a timestamped one. Three consequences, all of them wanted:

- **It sorts last.** An event's sort key is `timestamp#event_id`, and a timestamp starts
  with a digit, which sorts before `s`. So the day's events come back in order with the
  summary at the end, and no read path filters or re-sorts to stay chronological.
- **The write is idempotent.** One key per day, so a retried or duplicated schedule
  overwrites rather than accumulating a summary per attempt. That is why the write sends no
  condition at all.
- **The read is a `Get`**, on a known key, not a filtered `Query`. The partition is never
  scanned to find it.

The row carries the sentence, its `summary_source` (`ai` or `fallback`), the `event_count`
and `counts_by_sub_type` it was built from, and `generated_at`. Those counts are not in the
specification; they are here so a stored sentence can be interpreted later without
re-deriving what it covered.

`queryEventsByDate` skips the row by **shape** rather than by a type tag, requiring the
fields a real event must have. So the read side stays correct whatever else shares the
partition, including rows this repository has not written yet.

## Event item schema

```json
{
  "date": "2026-10-15",
  "event_id": "evt_abc123",
  "timestamp": "2026-10-15T14:32:00Z",
  "device_id": "front_door_cam",
  "device_name": "Front Door",
  "event_type": "motion.human",
  "description": "Amazon delivery driver placed a medium box",
  "snapshot_s3_key": "snapshots/2026-10-15/evt_abc123.jpg",
  "bedrock_model": "anthropic.claude-3-haiku",
  "latency_ms": 4200,
  "processed": true
}
```

Field notes:

- `date` duplicates the partition key and is stored because the sort key uses the
  timestamp, not the date.
- `event_type` carries the resolved subtype, e.g. `motion.human`.
- `snapshot_s3_key` is an S3 key, not a URL. The API converts it to a pre-signed URL at
  read time — see [03-api-contracts](./03-api-contracts.md).
- `bedrock_model` records which model actually produced `description`, which matters
  when the fallback was used and no model ran.
- `latency_ms` is the measurement behind the sub-8-second target in
  [02-non-functional-requirements](../01-product/02-non-functional-requirements.md).
- `processed` distinguishes a complete event from one written early in the pipeline.

`latency_ms: 4200` in the example is close to the 5-second webhook SLA and sits inside
the 8-second end-to-end target, so the sample data is realistic rather than optimistic.

## Snapshot storage

Snapshots also go to S3, and the bucket is not public: `ARCHITECTURE.md` §6 requires
pre-signed URLs with a 1-hour expiry. The bucket name comes from the
`S3_SNAPSHOT_BUCKET` environment variable, example value `front-door-snapshots`.

## Related

- [02-pipeline-components](./02-pipeline-components.md) — the component that writes these items
- [05-security-and-services](./05-security-and-services.md) — access rules and IAM
