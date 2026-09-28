**Back:** [00-overview](./00-overview.md)

**Verified against:** `https://developer.amazon.com/docs/ring/api-documentation.html` — webhook authentication, motion detection, button press, image snapshots, event history, account linking; `https://developer.amazon.com/docs/ring/configure.html` — app credentials; Ring release notes; and the source of `https://github.com/AmazonAppDev/ring-api-helloworld`. Read 2026-09-28. Items that could not be found are listed explicitly at the end.

<!-- docs-check:expect-absent app/api/webhook/route.ts -->

# Ring API findings

`prd.md` and `ARCHITECTURE.md` describe a Ring integration that **does not match the
official API**. One assumption is confirmed; the payload contract is wrong in six of
nine fields, and the snapshot call is wrong. Read this before writing the webhook
handler.

Nothing in `prd.md` or `ARCHITECTURE.md` has been changed — those are content
decisions. The corrected facts are recorded here and cross-referenced from
[03-api-contracts](../02-architecture/03-api-contracts.md).

## ✅ Confirmed: Ring does sign webhooks

> "All webhook requests from Ring include an HMAC-SHA256 signature in the
> `X-Signature` header. Partners **must** verify this signature using the HMAC signing
> key issued with their partner credentials before processing any webhook payload."

Verified: HMAC-SHA256, header `X-Signature`, over the **raw request body bytes**, hex
encoded, with a literal **`sha256=` prefix that must be stripped** before comparison,
compared with a constant-time function. Webhook delivery went GA on 21 April 2025 with
signature verification.

This confirms the assumption in
[01-signature-verification](../04-libraries/01-signature-verification.md) — and the
`sha256=` prefix is a detail `ARCHITECTURE.md` §5.1 omits. The implementation was
corrected for it; see that page for the bug it would have caused.

There are **three** credentials, not two: Client ID, Client Secret, and **HMAC
Signature Key**. The signing key is shown once and cannot be regenerated — you must
delete and recreate the app.

### Three traps the docs call out

1. **Verify the raw body, then parse.** "Pass the raw body bytes, not re-serialized
   JSON… If you parse the JSON and then re-serialize it to compute the HMAC, whitespace
   and key ordering change the bytes — the digest will not match and **every** signature
   check will fail with a payload that looks correct." For Lambda: use `event.body`, and
   check `event.isBase64Encoded` before verifying.
2. **One key, two encodings.** The same HMAC key signs account-linking nonces in
   URL-safe Base64 without padding, and webhooks in hex. "Do not mix the two."
3. **4xx is permanent.** Ring retries only on 5xx and timeout. A 4xx is a permanent
   failure with no retry, and **"persistent 4xx errors (e.g. 10+ consecutive failures
   over 24 hours)" may get the endpoint disabled.** A signature bug returning 401 would
   kill the pipeline quietly and then permanently.

## 🔴 The payload contract is wrong in 6 of 9 fields

`ARCHITECTURE.md` §5.1 and `prd.md` FR3 assume this shape. The real payload is
JSON:API v1.1:

```json
{
  "meta": {
    "version": "1.1",
    "time": "2026-02-13T13:39:57.200155525Z",
    "request_id": "2ad45ade-1818-4154-813b-afdd8bcd8085",
    "account_id": "ava1.ring.account.XXXYYY"
  },
  "data": {
    "id": "<device_id>_motion_<timestamp>",
    "type": "motion_detected",
    "attributes": {
      "source": "<device_id>",
      "source_type": "devices",
      "timestamp": 1786715596787,
      "timestamp_readable": "2026-08-14 08:53:16",
      "sub_type": "motion",
      "component_ids": ["0"]
    },
    "relationships": {
      "devices": { "links": { "self": "/v1/devices/<device_id>" } }
    }
  }
}
```

| `ARCHITECTURE.md` assumes | Reality |
|---|---|
| `request_id` top level | **`meta.request_id`** |
| `event_type` | **Does not exist.** It is `data.type` |
| `data.id` is the device id | **No.** It is a composite event id `<device_id>_<sub_type>_<timestamp>`. Using it as a device id produces a garbage API call |
| `data.device_id` | **Does not exist.** Device id is `data.attributes.source` |
| `data.device_name` | **Does not exist in any webhook.** Must be resolved via `GET /v1/devices/{id}` |
| `data.created_at` | **Does not exist.** Use `meta.time` or `data.attributes.timestamp` |
| `data.attributes.sub_type` | ✅ **Correct** |
| subtypes `motion.human` etc. | 🔴 **Wrong for webhooks** — see below |
| `button_press` | ✅ **Correct** — a real `data.type` |

### The subtype trap — the subtlest error

`motion.human`, `motion.vehicle`, `motion.other_motion` **are real strings in Ring's
API** — but on a **different surface**. They are `event_types` query values on the
**Event History** endpoint, not webhook `sub_type` values.

Webhook `sub_type` is **flat**: `motion`, `human`, `vehicle`, `other_motion`.

**Matching `sub_type === "motion.human"` matches nothing, ever.** Correct code is
`sub_type === "human"`. The spec conflated two distinct API surfaces.

The two subtype lists also disagree — Event History includes `motion.animal`, the
webhook table does not. Treat `sub_type` as an open string, not a closed enum.

### Fields the spec omits, and you will need

- **`meta.account_id`** — how you key DynamoDB per user and look up that user's tokens.
  Without it you cannot call the API on their behalf.
- `data.attributes.component_ids` — which camera module, required for multi-camera devices.
- `data.relationships.devices.links.self` — the canonical device URL.

### Version inconsistency to handle

The normative spec says `meta.version` is "Always `1.1`", but the same page's own
example ships `"version": "1.0"` with **no `account_id`**, and the official starter's
test simulator also emits `1.0`. **Accept both, and never assume `account_id` is
present.** Make it nullable and branch.

### Real event types

`motion_detected`, `button_press`, `device_added`, `device_removed`, `device_online`,
`device_offline`, `app_integration_added`, `app_integration_removed`,
`subscription_activated`, `subscription_deactivated`.

There is **no `person_detected`**, no `ding`, no `on_demand` webhook. Button-press
payloads carry **no `sub_type`**.

## 🔴 The snapshot call is wrong

`ARCHITECTURE.md` §3.2 assumes `GET /camera/{id}/snapshot`. The real flow is a
**POST that returns a 303 redirect**:

```
POST /v1/devices/{device_id}/media/image/download
Authorization: Bearer <access_token>
```

1. POST with request parameters → **303 See Other** with a pre-signed `Location` URL
2. GET that URL → the binary image

```json
{ "type": "at_timestamp", "timestamp": 1787176751000,
  "image_options": { "format": "jpeg", "resolution": { "width": 1920, "height": 1080 } },
  "components": [ { "component_id": "1" } ] }
```

`components` is required on Ring Elite. Use `latest_in_range` with a window starting at
or after `data.attributes.timestamp`: a request fired the instant of the event will
usually return `425 RECORDING_NOT_READY`.

### Two things that affect the AI layer

1. **A mandatory watermark, added 8 June 2026.** "All media content delivered through
   the Ring Partner API now includes a mandatory visible watermark overlay containing the
   Ring logo (top-left), Device ID, App Name, and timestamp (top-right)… applied
   server-side and cannot be removed. **Ring developers using AI/ML models to process
   media content may need to retrain models to account for the watermark overlay.**"

   This is a design problem, not a footnote. A burned-in Device ID and App Name sits
   across the image the Bedrock model describes **and** the image shown in a
   picture-in-picture overlay. The watermark is fixed-pixel, so requesting full
   1920×1080 makes it proportionally smaller.

2. **TAKE / E2EE video encryption, 16 September 2026.** A TAKE device "stays visible
   and callable through the Ring Partner API, but video requests return encrypted
   content, so your app cannot read recordings or snapshots, or open a live stream. E2EE
   devices are not returned by any Ring Partner API."

   **The snapshot → Bedrock → overlay flow cannot work on TAKE or E2EE accounts.**
   Detect undecodable media and degrade to the FR11 fallback.

## 🔴 Do not copy the official starter's webhook auth

`ring-api-helloworld`'s webhook route (the file at `app/api/webhook/route.ts` in that
starter repo) checks an `Authorization: Bearer` header against
`process.env.RING_WEBHOOK_SECRET`. **Ring never sends that header** — it sends
`X-Signature`. So if that env var is set, **every genuine Ring webhook is rejected with
401**; if it is unset, the check short-circuits and the endpoint accepts any
unauthenticated POST. Its Zod schema also gates on a `person_detected` event type that
does not exist and omits `button_press`.

Its *payload* handling is correct, and it independently confirms the official docs: it
reads `meta.request_id`, `data.type`, and `data.attributes.source`. That is worth
noting — the starter agrees with the docs, so the project's flat schema did not come
from the starter either.

| Reuse from the starter | Replace entirely |
|---|---|
| Token refresh plumbing | **Webhook auth** — write real `X-Signature` HMAC over raw bytes |
| SSE broadcast for Fire TV fan-out | The **Zod schema** — rewrite against v1.1 and the full event list |
| Plugin/registry pattern | Anything derived from `RING_WEBHOOK_SECRET` |

## Auth facts

| Token | Lifetime |
|---|---|
| Authorization code | 60 seconds, one-time |
| Access token | ~4 hours |
| Refresh token | ~30 days |

API base `https://api.amazonvision.com`; OAuth `https://oauth.ring.com/oauth/token`;
Playground `https://developer.amazon.com/ring/console/playground`.

"Refresh tokens **cannot** be used as Bearer tokens" — using one gives 401.

Rate limit: **100 requests/second per partner `client_id`**, global, not per-endpoint.
On 429, exponential backoff from 1s honouring `Retry-After`.

## There is no webhook sandbox

This is the practical blocker. The `get-started` glossary advertises a "sandbox
environment with synthetic Ring devices and events", but the testing documentation
describes **real** staging users with **real US-located devices** requiring an active
Ring Protection plan. The two contradict each other; treat the glossary as aspirational.

The Developer Playground (28 May 2026) gives a one-click 30-minute OAuth token, but it
simulates **live view / WHEP events, not webhook delivery**. There is no documented
webhook simulation or replay tool.

**Consequence:** signature verification cannot be exercised against a real Ring
delivery without a registered app, a staging user, and a real US device. For the demo,
build a local harness that signs a fixture body with the HMAC key, and **state plainly
which was validated** — that honesty is itself a friction-log entry.

## Webhook delivery semantics

| Response | Ring behaviour |
|---|---|
| 200–299 | Success, no retry |
| **400–499** | **Permanent failure, no retry** |
| 500–599 | Retry with backoff |
| Timeout >5s | Treated as 5xx, retried |

Retries: 1s → 5s → 30s → 2min → 10min → 1hr. DLQ retained **72 hours**; replay
requires contacting your Ring integration rep.

**Architecture consequence:** verify the signature, persist the event, and return 200
**immediately**. Never do Bedrock work inline. The docs name inline heavy processing
as a Common Mistake.

## Also: two category errors in the project documents

- **"Vega 0.24" is not a Ring API version.** It is a Fire OS / Vega OS documentation
  path. Ring docs carry no version number at all.
- **"MCP spec 2025-11-25" is an Alexa+ requirement, not a Ring one.** It is a hard
  requirement only if you enter the Alexa+ track, where you would owe a real self-hosted
  MCP server. Ring's own MCP is a read-only documentation Q&A server — a research aid
  for you, not something to build against.

## NOT FOUND

- No webhook timestamp or nonce header, and **no documented replay window** for
  webhooks. The 600-second freshness window applies only to account-linking nonces.
- No `device_name` in any webhook payload.
- No documented signing-key rotation mechanism; the only guidance is delete-and-recreate.
- **No official Ring Partner SDK** — "Use standard HTTP libraries."
- No per-endpoint rate limits, only the global 100 TPS per `client_id`.

## Related

- [01-official-requirements](./01-official-requirements.md) — what the hackathon requires
- [01-signature-verification](../04-libraries/01-signature-verification.md) — the implemented verifier
- [03-api-contracts](../02-architecture/03-api-contracts.md) — the as-specified contract, now known to be wrong
