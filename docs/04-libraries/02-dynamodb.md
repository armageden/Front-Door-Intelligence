**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/lib/dynamoClient.ts` → `claimRequestId()`, `toDoorEvent()`, `putEvent()`, `IDEMPOTENCY_TTL_SECONDS`, `getClient()`, `setClient()`, `utcDate()`, `sortKeyFor()`, `queryEventsByDate()`, read in full; `test/lib/dynamoClient.test.ts` and `test/handlers/eventQuery.test.ts`, both run; table design traced to `ARCHITECTURE.md` §3.5 and §3.6, and the decision to use UTC recorded as D014.

<!-- docs-check:expect-absent src/handlers/dailySummary.ts -->

# DynamoDB layer

Implements **FR7** (store every processed event) and the storage half of **NFR2**
(duplicate `request_id` values must not create duplicate events).

## Exported surface

From `src/lib/dynamoClient.ts`:

| Export | Kind | Purpose |
|---|---|---|
| `claimRequestId(requestId, client?)` | async function | Conditional put. `true` if this caller claimed the id, `false` if already claimed |
| `toDoorEvent(payload)` | function | Pure mapping from a Ring webhook payload to the stored event shape |
| `putEvent(event, client?)` | async function | Writes the event to the events table |
| `getClient()` / `setClient(client?)` | function | Lazy singleton, and the test seam for replacing it |
| `getEvent(date, eventId, timestamp, client?)` | async function | Read one event back by partition and sort key. `undefined` when absent — an absent row is not an error |
| `queryEventsByDate(date, client?)` | async function | Every event in one partition, oldest first. Follows `LastEvaluatedKey` to the end. FR8's read side |
| `utcDate(now?)` | function | The partition key for a moment in time, as `YYYY-MM-DD` |
| `sortKeyFor(event)` | function | The composite sort key, so the write and read paths cannot drift apart |
| `IDEMPOTENCY_TTL_SECONDS` | `const` | `86400` — 24 hours |
| `EVENTS_TABLE_ENV` / `IDEMPOTENCY_TABLE_ENV` | `const` | `"DYNAMODB_EVENTS_TABLE"` / `"DYNAMODB_IDEMPOTENCY_TABLE"` |
| `DocClient` | type | `DynamoDBDocumentClient` |

Every function takes an **optional** client. With no argument it uses the module
singleton; tests inject a stub. No test in this repository touches AWS.

## The conditional put is the whole of NFR2

```ts
ConditionExpression: 'attribute_not_exists(request_id)'
```

The first caller writes the row and returns `true`. Everyone after gets
`ConditionalCheckFailedException`, which is caught and converted to `false` — **not**
rethrown, because "already seen" is an expected outcome, not an error. Any other
exception is rethrown, so a throttling error is never mistaken for a duplicate.

**There is no read-then-write, deliberately.** Checking for the id and then writing
unconditionally leaves a window in which two concurrent retries of the same webhook
both observe "not seen" and both proceed. A single conditional put is atomic, so that
window does not exist.

The TTL of 24 hours is sized against Ring's actual retry schedule, not chosen for
taste: **1s → 5s → 30s → 2min → 10min → 1hr**, six retries over about an hour. Anything
shorter would expire the claim while retries were still arriving; anything longer lets
the table grow without bound. There is a test asserting the TTL is exactly 86,400
seconds, because a silent change to that constant would be invisible until a duplicate
event reached the pipeline.

## Mapping: the corrected Ring shape

`toDoorEvent` is where the API corrections land. It reads the **real** Ring v1.1
payload, not `ARCHITECTURE.md` §5.1:

| Stored field | Ring source | Note |
|---|---|---|
| `event_id` | `data.id` | Composite event id. **Not** a device id |
| `device_id` | `data.attributes.source` | The spec calls this `data.device_id`, which does not exist |
| `event_type` | `data.type` | The spec calls this `event_type`, which does not exist |
| `sub_type` | `data.attributes.sub_type` | Flat: `human`, not `motion.human` |
| `timestamp` | `meta.time` | ISO 8601 |
| `date` | derived, **UTC** | See below |
| `account_id` | `meta.account_id` | **Absent in v1.0**, so omitted rather than set to `null` |
| `processed` | `false` | Flipped by the description stage, which does not exist yet |

Two mapping choices worth stating:

- **Optional fields are omitted, not set to `null`.** `sub_type` and `account_id` are
  spread conditionally, so a v1.0 payload produces an object without those keys at all.
  A test asserts `'sub_type' in event` is `false`, because a `null` would be a claim
  that the value is known to be absent, which is not the same thing.
- **`device_name` is never invented.** Ring sends no device name in any webhook; it has
  to be resolved via `GET /v1/devices/{id}`. Leaving it unset is honest.

## Why the date key is UTC — a known limitation

`ARCHITECTURE.md` §3.5 says the partition key is `date` (`YYYY-MM-DD`) without saying
whose day. It is **UTC**, so the key is deterministic and does not depend on where the
Lambda runs or on an unset `TZ`.

That is a real product gap, not an oversight: a homeowner's "today's events" query and
the 9:00 PM local daily summary both need **local** dates, so a GMT+8 user has their
evening events filed under tomorrow. Fixing it needs the account's timezone, which
arrives via `meta.account_id` and device metadata rather than in the webhook.

Deciding to use the Lambda's local time was rejected: it would make stored data depend
on execution environment, which is precisely the invisible coupling that breaks during
a region move. Recorded as decision D014.

**The query path does not paper over this.** `GET /events/today` defaults to the UTC
partition and takes an explicit `?date=YYYY-MM-DD`, so a client that wants a local day
asks for the partition it wants instead of being handed a plausible-but-wrong answer.
See [04-event-query](../06-handlers/04-event-query.md).

## Errors are named, not stringly-typed

A missing table environment variable throws an error naming the variable:

```
Missing required environment variable: DYNAMODB_EVENTS_TABLE
```

The webhook handler catches this and returns 500 rather than 4xx, because a
configuration fault is not something Ring should treat as a permanent failure. There
are tests for both missing-variable paths.

## Not yet implemented

- **Device-name resolution.** The API client that does this now exists —
  [03-ring-client](./03-ring-client.md) → `getDevice()`. It is not yet *called* by any
  stage, so stored events still carry no `device_name`.
- **The 90-day TTL on the events table.** `template.yaml` declares the TTL attribute
  but only idempotency rows and connection rows populate `expires_at`, so event items
  are currently retained indefinitely. `ARCHITECTURE.md` §3.5 specifies 90 days.
  Flagged in the template as unreconciled rather than quietly dropped.

## Related

- The handler that calls this: [01-webhook-ingress](../06-handlers/01-webhook-ingress.md)
- The read path: [04-event-query](../06-handlers/04-event-query.md)
- The Ring API client: [03-ring-client](./03-ring-client.md)
- The table design: [04-data-store](../02-architecture/04-data-store.md)
- The decision log: [06-design-decisions](../02-architecture/06-design-decisions.md)
- Environment template: `.env.example`
