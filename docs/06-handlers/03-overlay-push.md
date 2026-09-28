**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/handlers/overlayPusher.ts` → `deliverEvent()`, `handler`, `onConnect`, `onDisconnect`, `WS_ENDPOINT_ENV`, read in full; `test/handlers/overlayPusher.test.ts` → 18 passing assertions; the WebSocket API, queue, and connections table in `template.yaml` read in full. Not verified: any live API Gateway or WebSocket behaviour.

# Overlay push

Pushes the finished description to connected Fire TV clients. Implements the
**delivery** half of **FR6** and the WebSocket half of `ARCHITECTURE.md` §3.4.

## What this stage is, and what it deliberately is not

`ARCHITECTURE.md` §3.4 specifies a picture-in-picture overlay that appears over
whatever the user is watching, without interrupting playback. **This handler builds and
sends the message. It does not implement the picture-in-picture**, and cannot.

Verified against the Vega OS documentation on 2026-09-28:

- There is **no system-level overlay, picture-in-picture, or heads-up API** in any of the
  38 documented Vega APIs. Overlaying *another app's* video is not achievable with a
  documented API.
- Overlaying **your own** video surface works, but only via a transparent
  `@amazon-devices/webview` sibling of `KeplerVideoSurfaceView`. React Native `zIndex`
  and `elevation` **do not reach the hardware video layer**, so a plain absolutely
  positioned view silently renders underneath.
- The closest system surface, `useToastKepler`, is text-and-icon with a fixed SHORT or
  LONG duration — it cannot express FR14's 15-second auto-dismiss.

The message is specified and implementable; the rendering is not, and is blocked on the
track decision. See [05-fire-tv-vega-findings](../05-hackathon-requirements/05-fire-tv-vega-findings.md)
and decision D021.

What a Fire TV app **can** do with this payload today is genuinely useful: fetch
`snapshot_url`, show the sentence as a toast, and offer a content-launch deep link.

## Exported surface

| Export | Kind | Purpose |
|---|---|---|
| `handler` | SQS handler | Consumes the overlay queue and pushes |
| `onConnect` / `onDisconnect` | WebSocket route handlers | Register and remove connection ids |
| `deliverEvent(event, deps)` | async function | The stage's logic, with every dependency injected. Returns a status rather than throwing for expected conditions |
| `PushDeps` | type | The injection seam |
| `WsRouteResult` | type | `{ statusCode, body }` — see below |
| `WS_ENDPOINT_ENV` | const | `'WEBSOCKET_ENDPOINT'` |

`WsRouteResult` is declared locally rather than reusing
`APIGatewayProxyResultV2`, which is a union that includes a bare `string` and forces
every caller to narrow. A `$connect` answer is exactly a status code and a body.

## The three entry points are one module, and two of them are load-bearing

API Gateway owns the WebSocket. It hands the connection id to `$connect` **exactly once,
and nowhere else**, so without `onConnect` nothing can ever be pushed and every
description is silently dropped. `onDisconnect` removes it; the connections table is not
an optimisation, it is the entire mechanism.

`onConnect` returns **500** when registration fails. API Gateway treats a 2xx from
`$connect` as a successful socket, so swallowing the error would produce a client that
believes it is connected and receives nothing — the most expensive kind of silence.
`onDisconnect` deliberately returns **200** even on failure, because the row has a TTL
and a later push prunes it on `GoneException`; a non-2xx would only make API Gateway
retry a cleanup.

## One dead socket must not silence the house

`pushToConnections` iterates connections individually and treats `GoneException` as
"this one is gone" — pruning the row and continuing. A Fire TV that vanished without
disconnecting would otherwise swallow the description for every other screen.

Any **other** failure propagates rather than being counted as a success. That asymmetry
is deliberate: a stale socket is expected and recoverable, a transport failure is real
and should be visible.

The registry self-heals because of this. A row that API Gateway has forgotten is
discovered on the next push and deleted, so the table converges on reality without a
sweeper.

## The payload, and when it is not sent

Exactly the five fields `ARCHITECTURE.md` §3.4 names:

```json
{ "event_id": "...", "description": "...", "snapshot_url": "...",
  "timestamp": "...", "device_name": "..." }
```

Two cases produce **no message at all**, rather than a malformed one:

- **No `snapshot_url`.** `buildMessage` returns `null`. A payload carrying an empty
  string renders as a broken image on a TV, which looks worse than no message at all.
- **No `description`.** There is nothing to say.

`device_name` falls back to the device id when the name was never resolved. Ring sends
no device name in any webhook, so this is the common case rather than an edge case.

`snapshot_url` is pre-signed for **one hour**, the expiry `ARCHITECTURE.md` §6 requires.

## Skip conditions that are not failures

No connected clients is **normal** for a doorbell product, not an error, so it is
skipped rather than retried into the DLQ. Same for an event that has aged out of the
table. Only an infrastructure failure is reported through `batchItemFailures`.

## Latency

FR6 asks for delivery within 8 seconds of the original event. The path is now three
queue hops: ingress → describe → overlay. **That has not been measured**, and the
Bedrock call alone is several seconds, so FR6 is the requirement most at risk. The
queue visibility timeouts (180s describe, 90s overlay) are far longer than the target,
so the design will meet it only if the hops are genuinely fast. This is a real risk, not
a formality, and it is the strongest argument for measuring before the demo.

## Related

- The message builder and the connection registry: [06-overlay-push](../04-libraries/06-overlay-push.md)
- The stage before this: [02-describe-stage](./02-describe-stage.md)
- The verified Vega constraints: [05-fire-tv-vega-findings](../05-hackathon-requirements/05-fire-tv-vega-findings.md)
