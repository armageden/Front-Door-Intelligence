**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/lib/overlayPush.ts` → `createOverlayPush()`, `buildMessage()`, `pushToConnections()`, `createPoster()`, `PRESIGNED_URL_TTL_SECONDS`, `OverlayMessage`, read in full; `src/lib/connectionStore.ts` → `registerConnection()`, `removeConnection()`, `listConnections()`, `CONNECTION_TTL_SECONDS`, read in full; both exercised by `test/handlers/overlayPusher.test.ts`. Not verified: any live API Gateway or S3 call.

# Overlay push and connection registry

Two modules the delivery stage depends on: the message builder, and the record of who
is listening.

## `overlayPush.ts`

| Export | Kind | Purpose |
|---|---|---|
| `createOverlayPush(options)` | factory | Returns `{ buildMessage, presign }`. `options.presign` is injected in tests |
| `buildMessage(event)` | async method | The §3.4 payload, or `null` when one cannot be built honestly |
| `pushToConnections(message, connections, post, onStale?)` | async function | Fan-out with per-connection failure isolation |
| `createPoster(endpoint)` | function | Default `postToConnection`, on the API Gateway Management API |
| `PRESIGNED_URL_TTL_SECONDS` | const | `3600` — the one-hour expiry §6 requires |
| `OverlayMessage` | type | The five §3.4 fields |

### `buildMessage` returns null rather than a degraded payload

The contract requires `snapshot_url`. An event with no stored snapshot cannot produce a
valid message, so the function returns `null` instead of an empty string.

This is the choice worth defending. A payload with `snapshot_url: ""` reaches the TV,
fails to load, and renders a broken image — which looks like a broken product. No
message looks like nothing happened. The honest answer is the second one.

Same for a missing `description`: there is nothing to say, so nothing is said.

### `pushToConnections` isolates failures per connection

```text
connection ok        -> delivered++
connection Gone      -> pruned.push(id); onStale(id); continue
connection otherwise -> throw
```

`GoneException` is API Gateway's documented signal that a socket is closed. It is
handled per connection rather than aborting the batch, because **one dead Fire TV must
not swallow the description for every other screen in the house.**

Everything else propagates. The asymmetry is deliberate: a stale socket is expected and
self-healing, a transport failure is real and should never be recorded as a success.
The registry converges on reality as a side effect — a row API Gateway has forgotten is
discovered on the next push and deleted, so no sweeper job is needed.

`outcome` is `'no_connections'`, `'delivered'`, or `'all_stale'`, so the caller can log
which happened without inspecting counts.

## `connectionStore.ts`

| Export | Kind | Purpose |
|---|---|---|
| `registerConnection(connection, client?)` | async function | Store a connection id with a TTL |
| `removeConnection(id, client?)` | async function | Forget one |
| `listConnections(client?)` | async function | Everyone currently believed live |
| `setClient(client?)` | function | Test seam |
| `CONNECTION_TTL_SECONDS` | const | `86400` — 24 hours |
| `CONNECTIONS_TABLE_ENV` | const | `'CONNECTIONS_TABLE'` |

### Why a table and not a Lambda-global array

API Gateway owns the socket and delivers the connection id to `$connect` once. Remembering
it is the application's job, because `PostToConnection` needs that id.

A module-level array cannot do it: Lambda invocations are stateless, so with two
concurrent instances each would hold half the connections and neither would know about
the other's. Every event would reach roughly half the screens, intermittently.

**`ARCHITECTURE.md` §11 does not list this table.** That is a gap in the plan rather
than a departure from it, and it is recorded as decision D020.

### The TTL is a backstop, not the mechanism

API Gateway sends no heartbeat we can observe, so there is no way to detect a dead
socket proactively. The 24-hour TTL therefore only **bounds growth**; the real signal is
`GoneException` on the next push, which prunes the row immediately.

A 24-hour window is chosen because it is generous: the pruning is what actually keeps
the table accurate, so the TTL only needs to be longer than "a client will be back
before we notice it is gone". A short TTL would drop a Fire TV that was merely asleep.

## Environment

| Variable | Used by |
|---|---|
| `CONNECTIONS_TABLE` | the registry |
| `WEBSOCKET_ENDPOINT` | `createPoster` — the Management API endpoint, `https://` form |
| `S3_SNAPSHOT_BUCKET` | the presigner |

All three are declared in `.env.example` with placeholder values and populated by
`template.yaml`.

## Related

- The stage that uses both: [03-overlay-push](../06-handlers/03-overlay-push.md)
- The verified Vega constraints on what the app can render: [05-fire-tv-vega-findings](../05-hackathon-requirements/05-fire-tv-vega-findings.md)
- Security posture: [05-security-and-services](../02-architecture/05-security-and-services.md)
