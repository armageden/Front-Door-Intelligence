**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §3.5, read directly, including the event item JSON. The pre-signed URL rule was checked against §6. No table definition exists in the repository.

# Data store

Source: `ARCHITECTURE.md` §3.5. **Specified, not implemented** — no table definition,
CDK or SAM resource, or client code exists in the repository.

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
