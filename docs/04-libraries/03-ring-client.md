**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/lib/ringClient.ts` → `createRingClient()`, `fetchSnapshot()`, `getDevice()`, `getAccessToken()`, the three error classes, and every exported constant, read in full; `test/lib/ringClient.test.ts` → 25 passing assertions; the request and response shapes traced to the official Ring Partner API documentation, read 2026-09-28. Unverified: the exact signal for TAKE/E2EE encrypted media — see the note on `EncryptedMediaError`.

# Ring API client

OAuth token lifecycle, device lookup, and image snapshots. This is the module that
replaces the architecture document's assumed `GET /camera/{id}/snapshot`, **which does
not exist**.

## Exported surface

From `src/lib/ringClient.ts`:

| Export | Kind | Purpose |
|---|---|---|
| `createRingClient(options)` | factory | Returns the client. `options` takes injected `fetchImpl`, `sleepImpl`, and `now`, so every test runs without a network or real time |
| `getAccessToken()` | method | Cached bearer token, refreshed inside the skew window |
| `refreshAccessToken()` | method | Force a `refresh_token` grant |
| `getDevice(deviceId)` | method | `GET /v1/devices/{id}` — the only source of a device name |
| `fetchSnapshot(deviceId, snapshot)` | method | The two-request image flow |
| `invalidateToken()` | method | Test seam; drops the cached token |
| `RingApiError` | error class | Carries `statusCode` and a truncated `body` |
| `SnapshotNotReadyError` | error class | 425. Needs a different window, not a retry |
| `EncryptedMediaError` | error class | Response was not an image. Probable TAKE/E2EE — degrade, don't retry |
| `DEFAULT_API_BASE_URL` | const | `https://api.amazonvision.com` |
| `DEFAULT_OAUTH_URL` | const | `https://oauth.ring.com/oauth/token` |
| `DEFAULT_TOKEN_EXPIRY_SECONDS` | const | 14400 — the documented ~4 hours, used when `expires_in` is absent |
| `REFRESH_TOKEN_LIFETIME_SECONDS` | const | 2592000 — ~30 days |
| `RATE_LIMIT_TPS` | const | 100 — the documented per-`client_id` limit |
| `DEFAULT_MAX_ATTEMPTS` | const | 3 — **total** requests, not retries |
| `TOKEN_EXPIRY_SKEW_SECONDS` | const | 60 |
| `FetchLike` / `SleepLike` | types | Injection seams |

## Token handling: a refresh token is never a bearer token

The docs are explicit that putting a refresh token in an `Authorization: Bearer` header
yields 401. The two are therefore kept strictly separate: `getAccessToken()` always runs
before any API call, and the refresh token appears only in the OAuth form body, never in
a header. There is a test asserting the bearer value is `Bearer access-token-1` and does
not contain the refresh token.

Access tokens are cached with a **60-second skew** subtracted from `expires_in`, so a
token cannot expire between the check and the request it guards. A test pins the
behaviour by advancing an injected clock to `14400 - 60` seconds and asserting a
re-authentication happens.

## The snapshot flow is two requests, not one

```
POST /v1/devices/{id}/media/image/download   →  303 See Other + pre-signed Location
GET  <that Location>                         →  the image bytes
```

`redirect: 'manual'` is deliberate. An automatic redirect follow would consume the 303
and discard the `X-Media-Timestamp` and `X-Media-Origin` headers that the 303 carries,
which are the only record of when the media was actually captured — the difference
between a snapshot and a recording, and the difference between describing the moment
the doorbell fired and describing whatever happened later.

The pre-signed URL is fetched with **no** bearer token. It is an S3 URL and Ring's auth
does not apply; a test asserts the second request carries no headers.

### Request bodies

Two modes, exactly as documented:

```json
{ "type": "at_timestamp", "timestamp": 1787176751000,
  "image_options": { "format": "jpeg", "resolution": { "width": 1920, "height": 1080 } },
  "components": [ { "component_id": "0" } ] }
```

| Field | Rule |
|---|---|
| `type` | `at_timestamp` or `latest_in_range` |
| `timestamp` | epoch ms, `at_timestamp` only, within the last 180 days |
| `start_timestamp` / `end_timestamp` | `latest_in_range`; window ≤ 24 hours, `end_timestamp` optional |
| `image_options.resolution` | defaults to 1920×1080 |
| `components` | **sent only when the caller knows the module.** Required on Ring Elite, where omitting it picks a module non-deterministically |

Full resolution is the default because the mandatory watermark is fixed-pixel: a smaller
image makes the burned-in logo, Device ID, App Name, and timestamp proportionally larger,
in both the Bedrock input and the PiP overlay.

Tests assert the body shape for both modes, that `end_timestamp` is omitted when not
supplied, and that `components` appears only when a module is named.

## Error taxonomy — three cases, three responses

| Error | Cause | What the caller should do |
|---|---|---|
| `SnapshotNotReadyError` | 425, the request beat the recording | Ask for a **later window**. Retrying the same window cannot help, so this does not retry |
| `EncryptedMediaError` | Response was not an image | **Degrade to the FR11 deterministic summary.** Do not retry |
| `RingApiError` | Any other non-OK status | 401 and 429 are handled inside the client; the rest propagate |

`EncryptedMediaError` deserves a note, because **its trigger is an inference, not a
documented fact.** Ring states that TAKE and E2EE devices "return encrypted content"
and that "your app cannot read recordings or snapshots", but it does not publish a status
code or content type for that case. Rather than guess at a specific code, the client
checks the one thing it *can* verify — that the response actually is an image — and
raises `EncryptedMediaError` if not. That generalisation is sound: we requested an
image and did not receive one, whatever the reason. `receivedContentType` is preserved
on the error so the real cause can be identified once it is known.

## Retry policy

- **401** triggers exactly one token refresh and retry. A second consecutive 401 is a
  real authorisation failure, not a stale token, and propagates.
- **429** backs off, honouring `Retry-After` when present and otherwise starting at 1s
  and doubling. The sleep is injected, so the backoff is tested without waiting.
- **`DEFAULT_MAX_ATTEMPTS` counts total requests, not retries.** The condition is
  `attempt < DEFAULT_MAX_ATTEMPTS - 1`, so the constant is the number of requests
  actually made. The first version of this code had the off-by-one the other way and a
  test caught it making four requests while the constant read 3.

## Not verified

- **No live traffic.** Nothing here has been exercised against real Ring
  infrastructure. There is no documented webhook or media simulator; the Developer
  Playground issues tokens and simulates live view, not media downloads.
- **No official Ring Partner SDK exists** — "Use standard HTTP libraries." This client
  is hand-rolled against the documented HTTP surface, so the SDK version can move
  independently of it.
- **Account linking is out of scope.** The one-way flow signs a nonce with the same
  HMAC key, and per the docs the key must be used as **URL-safe Base64 without padding**
  there while webhooks use **hex** — "do not mix the two". Nothing in this module should
  be reused for nonce signing.

## Related

- The handler that will consume this: [01-webhook-ingress](../06-handlers/01-webhook-ingress.md)
- The verified API research: [04-ring-api-findings](../05-hackathon-requirements/04-ring-api-findings.md)
- Shared modules: [00-overview](./00-overview.md)
