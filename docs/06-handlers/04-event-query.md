**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/handlers/eventQuery.ts` → `queryToday()`, `buildTodayResponse()`, `handler()`, `MAX_EVENTS`, `QUERY_KEY_ENV`, `QUERY_KEY_HEADER`, read in full; `test/handlers/eventQuery.test.ts` → 22 passing tests, all run; `src/lib/dynamoClient.ts` → `queryEventsByDate()`, `utcDate()`, read in full; the `EventQueryFunction` resource, its IAM policies, the `QueryApiKey` parameter, and the `EventsQueryEndpoint` output in `template.yaml`, read in full; `QUERY_API_KEY` in `.env.example`. Not verified: any live DynamoDB `Query`, any pre-signed URL, and any API Gateway routing — there is no AWS account and no SAM CLI, so `template.yaml` has never been deployed or validated.

# Event query

`GET /events/today` — **FR8**, and the read side of the chain. `ARCHITECTURE.md` §4.2
puts it in front of a dashboard timeline.

Every other stage in this repository was triggered by Ring or by a queue. This is the
first endpoint a **person** calls, which is where two requirements appear that the
pipeline stages never had to think about: who is allowed to ask, and what "today" means.

## Exported surface

| Export | Kind | Purpose |
|---|---|---|
| `handler` | API Gateway V2 handler | Lambda entry point for `GET /events/today` |
| `queryToday(presentedKey, params, deps)` | async function | The logic, with every dependency injected. Returns a status and a body rather than throwing |
| `buildTodayResponse(date, events, presign, maxEvents?)` | async function | Maps stored events to the §5.2 response. Separated from the handler so the response shape is testable with no API Gateway event |
| `TodayEvent` / `TodayResponse` | type | The response contract |
| `MAX_EVENTS` | `const` | `200` — the response ceiling |
| `QUERY_KEY_ENV` / `QUERY_KEY_HEADER` | `const` | `"QUERY_API_KEY"` / `"x-query-key"` |

`queryToday` and `buildTodayResponse` are split the same way `ingest` and
`deliverEvent` are in the other two handlers: the decision logic is testable without an
API Gateway event or an AWS account, and the handler stays a thin adapter.

## The endpoint had no auth in the spec, so it needed one

`POST /webhook/ring` is authenticated by an HMAC over the request body. Ring holds the
secret, we never issue or check a caller identity, and FR2 covers it.

**This endpoint has no such partner.** `ARCHITECTURE.md` §5.2 and §4.2 describe it
without naming an auth mechanism, and §6's mitigation table does not mention it. A
literal reading of the spec is a public endpoint returning a homeowner's door activity
to anyone who guesses the URL.

The gap is closed with a required static key in `X-Query-Key`, compared in constant time
via `timingSafeEqual`. Recorded as decision **D022** because it is a design choice the
spec did not make, not something derived from it.

**It fails closed.** A missing `QUERY_API_KEY` throws rather than admitting everyone, and
the handler turns that into a 500. An endpoint that cannot decide who is allowed must not
decide that everyone is. Two tests assert both halves of that.

This is the minimum that makes the endpoint safe to ship, and it is not good enough for
a real multi-user product: a static key does not distinguish one homeowner from another.
A real authorizer — IAM, or a Cognito identity on the HTTP API — is the correct answer
and is left as a follow-up rather than pretended into this phase.

## "Today" is UTC, and overridable, and never guessed

The events table is partitioned by a **UTC** `date` (D014). That is the only partition a
`Query` addresses cheaply, and a homeowner's local day disagrees with it for part of
every day.

So the endpoint takes `?date=YYYY-MM-DD` and defaults to the UTC date. A client that
wants a local day asks for the partition it wants. Silently serving the UTC day and
labelling it "today" would be the kind of quiet incorrectness that is much harder to
notice than a documented limitation.

| Input | Result |
|---|---|
| no `?date=` | the UTC date today |
| `?date=2026-01-01` | that exact partition |
| `?date=13/02/2026` | **400** `invalid_date` |
| `?date=2026-02-31` | **400** — a well-formed date that does not exist |

A malformed date is **rejected, not replaced with today**. A wrong date that quietly
returns a right-looking answer is the hardest class of bug to find, because the client's
own bug is invisible in the response.

## The response, and the two fields §5.2 conflates

`ARCHITECTURE.md` §5.2 shows `"event_type": "motion.human"`. That is wrong twice, and
the fix is the same one FR3 needed:

- The webhook sends `motion_detected` in `data.type` — that is `event_type`.
- `human` is the flat `sub_type`.

Conflating them into one field loses the distinction the rest of the pipeline is built
on, so the response carries **both**, under their real names.

```json
{ "date": "2026-10-15", "count": 1, "truncated": false,
  "events": [ { "event_id": "evt_abc123", "timestamp": "2026-10-15T14:32:00Z",
    "device_name": "Front Door", "event_type": "motion_detected", "sub_type": "human",
    "description": "A delivery driver places a medium box", "snapshot_url": "https://…",
    "processed": true } ] }
```

Three fields the spec does not have:

| Field | Why |
|---|---|
| `sub_type` | the flat subtype, separated out as above |
| `processed` | lets a dashboard show a pending row rather than a blank |
| `truncated` | says the ceiling bit, instead of reporting a wrong `count` |

### Events that are incomplete still appear

An event whose describe stage has not run yet has no `description`. It is still an
event — it really happened — so it is returned with `description: null` and
`processed: false`. Hiding it would make the timeline disagree with reality for exactly
as long as the queue is behind.

`snapshot_url` is `null` when no snapshot was stored. A signed URL to a missing object
would 404 in the client, which is worse than an honest null. The presigner is not even
called in that case; there is a test asserting it is not.

### `truncated`, and why there is a ceiling

`queryEventsByDate` follows `LastEvaluatedKey` to the end of the partition — a single
`Query` caps at 1 MB, and silently truncating would report a wrong `count`. But
unbounded, a pathological day could produce a response API Gateway rejects, turning a
data problem into a 502 the caller cannot act on.

So the response caps at `MAX_EVENTS = 200` and sets `truncated: true` when it bites. The
cap is not in §5.2; it is recorded here rather than left as a silent invention.

## The pre-signer is shared, not duplicated

`PRESIGNED_URL_TTL_SECONDS` and the S3 presign call now live in one place:
`createSnapshotPresigner(bucket, presign?)` in `src/lib/overlayPush.ts`, which
`createOverlayPush` also consumes. Two call sites signing snapshots independently is how
they drift on expiry.

It lives in that module because that is where the S3 presigner already was; moving it to
a new module was judged not worth the churn for one function.

## The read is read-only in IAM

`EventQueryFunction` gets `dynamodb:Query` on the events table and `s3:GetObject` on the
bucket — no `ListBucket`, no `PutObject`, no write action on the table at all. A query
handler that can delete an event is a query handler one bug away from losing one.

## What this does not do

- **No local-date resolution.** See D014. The endpoint exposes the partition; it does not
  compute a homeowner's day.
- **No multi-user separation.** One table, one key, one homeowner. Per-account
  partitioning is a prerequisite for a real deployment and is not started.
- **No `web/` dashboard.** The endpoint is the server side of
  `ARCHITECTURE.md` §11's dashboard; the client does not exist.
- **The §6 pre-signed URL is now genuinely implemented.** It was implemented for delivery
  in the overlay phase; this stage reuses it for the query response rather than adding a
  second signer.

## Related

- The store this reads: [02-dynamodb](../04-libraries/02-dynamodb.md)
- The delivery stage that shares the presigner: [03-overlay-push](./03-overlay-push.md)
- The spec contract as written: [03-api-contracts](../02-architecture/03-api-contracts.md)
- The design: [02-pipeline-components](../02-architecture/02-pipeline-components.md)
