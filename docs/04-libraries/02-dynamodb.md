**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/lib/dynamoClient.ts` → `claimRequestId()`, `toDoorEvent()`, `putEvent()`, `putSummary()`, `getClient()`, `setClient()`, `utcDate()`, `sortKeyFor()`, `isPartitionDate()`, `queryEventsByDate()`, `querySummary()`, `SUMMARY_SORT_KEY`, `EVENTS_TTL_SECONDS`, `eventExpiryEpoch()`, `IDEMPOTENCY_TTL_SECONDS`, read in full; `test/lib/dynamoClient.test.ts` and `test/handlers/eventQuery.test.ts`, both run; table design and the 90-day retention traced to `ARCHITECTURE.md` §3.5 and §3.6, the UTC partition as D014, and the expiry base as D028. Not verified against a live table: no AWS account is available, so every command shape here is asserted against a stub client and neither the `Put`/`Get` shapes nor DynamoDB's documented 48-hour TTL deletion window have been observed from DynamoDB.

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
| `markProcessed(event, outcome, client?)` | async function | Writes the describe-stage outcome back: `description`, `description_source`, and optionally `processed`, `snapshot_s3_key`, `device_name` |
| `getEvent(date, eventId, timestamp, client?)` | async function | Read one event back by partition and sort key. `undefined` when absent — an absent row is not an error |
| `queryEventsByDate(date, client?)` | async function | Every event in one partition, oldest first. Follows `LastEvaluatedKey` to the end. FR8's read side |
| `utcDate(now?)` | function | The partition key for a moment in time, as `YYYY-MM-DD` |
| `isPartitionDate(raw)` | function | Could this string ever hold a day's events? Rejects the shape *and* impossible dates like `2026-02-31` |
| `sortKeyFor(event)` | function | The composite sort key, so the write and read paths cannot drift apart |
| `putSummary(record, client?)` | async function | Unconditional put of one day's summary, on the fixed `summary` sort key. §3.6's write |
| `querySummary(date, client?)` | async function | `Get` on that same key. `undefined` when the day has not been summarised |
| `SUMMARY_SORT_KEY` | `const` | `"summary"` — the constant sort key both summary functions use |
| `EVENTS_TTL_SECONDS` | `const` | `7776000` — 90 days, §3.5's retention for events and summaries |
| `eventExpiryEpoch(date, now?)` | function | When a partition's rows become TTL-eligible. Measured from `date`, never from write time |
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

## The summary row shares the partition, and sorts last in it

`ARCHITECTURE.md` §3.6 says the daily summary is "written to `EventsTable` as a `summary`
item" and names no key. It shares the day's partition under a **constant** sort key,
`SUMMARY_SORT_KEY = "summary"`. Three consequences, all asserted in
`test/lib/dynamoClient.test.ts`:

- **It sorts after every event.** An event's sort key is `timestamp#event_id`, and a
  timestamp begins with a digit, which sorts before `s`. So `queryEventsByDate` returns
  the day's events already in order with the summary last, and no read path has to filter
  or re-sort to stay chronological.
- **The write is idempotent.** One key per day means a retried or duplicated schedule
  overwrites rather than accumulating a summary per attempt. `putSummary` therefore sends
  **no** `ConditionExpression` — a superseded summary is not worth preserving, and a
  conditional write would need an idempotency row of its own to be safe.
- **A non-event row is guarded by shape, not by a tag.** `isDoorEvent` requires
  `event_id`, `timestamp`, and `date`, so the summary row is skipped by the event query
  even though it shares the partition. A test asserts the read.

`querySummary` is a `Get` on the known key, not a filtered `Query`: the key is constant, so
there is exactly one candidate and the partition is never scanned.

## One date rule, two callers

`isPartitionDate` is the single place that decides whether a string could be a partition
key, and both callers use it: `GET /events/today` for `?date=`, and the daily-summary
backfill for a named date. The shape check alone is not enough — `2026-02-31` is well
formed and is not a date, so a `Query` for it returns nothing and the caller cannot tell
that from a genuinely empty day. The rule round-trips through `Date` to reject it.

## The 90-day TTL, and what it is measured from

`ARCHITECTURE.md` §3.5 specifies a 90-day TTL. `template.yaml` declared the
`TimeToLiveSpecification` from the start, and **nothing wrote the attribute** — so it was
inert and events were retained forever. `putEvent` and `putSummary` now write it.

| Export | Kind | Purpose |
|---|---|---|
| `EVENTS_TTL_SECONDS` | `const` | `7776000` — 90 days, from `ARCHITECTURE.md` §3.5 |
| `eventExpiryEpoch(date, now?)` | function | The epoch second a partition's rows become eligible for deletion |

The expiry is measured from the row's **own `date` partition**, not from write time, and
that is the decision worth stating (D028). It is what makes "90 days" mean *90 days of
activity*:

- the table holds exactly 90 day-partitions, whatever the write timing;
- a redelivered queue message or a hand-run replay **cannot extend retention** — a
  year-old event lands in a partition that is already expiring;
- every row in a partition expires together, its summary included, so a summary never
  outlives the events it describes.

`markProcessed` therefore **does not touch `expires_at`**. It is an `UpdateCommand`, and
recomputing the expiry there from the current clock would put the retry hazard on the most
common path of all. A test asserts the update expression contains no `expires_at` at all.

`eventExpiryEpoch` returns a **finite fallback** for an unparseable date rather than `NaN`.
DynamoDB cannot compare `NaN`, so a `NaN` attribute silently disables TTL for that row
*forever* — unbounded retention, which is the worst outcome available. A wrong-but-finite
value at least expires.

DynamoDB's deletion is documented as happening **within 48 hours** of the expiry, so
`expires_at` is an eligibility time, not a deletion time. Nothing here depends on a row
being gone at a particular moment, and `querySummary` returns `undefined` and
`queryEventsByDate` returns a short list rather than failing once a row has been collected.
**Not verified:** that 48-hour window has not been observed.

## `markProcessed` and the one field ingress cannot know

`device_name` is the only field ingress **cannot** set: no Ring webhook carries it, so it
arrives only from `GET /v1/devices/{id}`. The describe stage now resolves it and passes it
in `outcome.deviceName`, and `markProcessed` writes it under an
`ExpressionAttributeName` alias — DynamoDB reserves several words, and an unaliased name is
a runtime failure rather than a compile-time one. The decision is [D031](../02-architecture/06-design-decisions.md).

`processed` became **optional** in that same outcome type, which is a change worth reading
twice. It is optional so a partial update can never write `processed: false` after a
successful describe: that would make the queue redeliver the event forever, which is a worse
failure than the one being avoided. When the field is omitted the update expression contains
no `processed` at all, and a test asserts exactly that.

## Not yet implemented

Nothing outstanding. Device-name resolution was the last gap here and it closed in the
device-name phase — see above.

## Related

- The handler that calls this: [01-webhook-ingress](../06-handlers/01-webhook-ingress.md)
- The read path: [04-event-query](../06-handlers/04-event-query.md)
- The Ring API client: [03-ring-client](./03-ring-client.md)
- The table design: [04-data-store](../02-architecture/04-data-store.md)
- The decision log: [06-design-decisions](../02-architecture/06-design-decisions.md)
- Environment template: `.env.example`
