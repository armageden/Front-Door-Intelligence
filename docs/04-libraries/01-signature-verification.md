**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/lib/signatureVerifier.ts` → `computeSignature()`, `verifySignature()`, read in full; `test/lib/signatureVerifier.test.ts` → 18 passing assertions; requirements traced to `prd.md` FR2, `ARCHITECTURE.md` §3.1, §5.1, §6, §8.2, §12. Unverified: which bytes Ring signs — see the assumption below.

# Signature verification

Implements **FR2**: "The system MUST verify the `X-Signature` HMAC-SHA256 header on
every incoming webhook request."

> **The webhook payload contract in `ARCHITECTURE.md` §5.1 is wrong in 6 of 9
> fields.** The official Ring API uses JSON:API v1.1: `request_id` lives at
> `meta.request_id`, not top level; there is no `event_type` field, it is `data.type`;
> there is no `device_id`, it is `data.attributes.source`; there is no `device_name` at
> all; there is no `created_at`; and **the `motion.human` / `motion.vehicle` subtype
> strings are from a different API surface** — webhook `sub_type` is flat (`human`,
> `vehicle`, `motion`, `other_motion`), and the dotted form belongs to the Event
> History query parameter. Matching `sub_type === "motion.human"` matches nothing,
> ever.
>
> Also: the snapshot call is not `GET /camera/{id}/snapshot`. It is
> `POST /v1/devices/{id}/media/image/download`, which returns a **303** to a
> pre-signed URL.
>
> Both are documented from the official docs, but **rewriting `ARCHITECTURE.md` §5.1
> and `prd.md` FR3 is a content decision that has been left to the author.** Until it
> is made, the documents below describe the **specification as written**, and this
> warning is the correction on record. See
> [03-api-contracts](../02-architecture/03-api-contracts.md) for the as-specified
> contract.

## Exported surface

From `src/lib/signatureVerifier.ts`:

| Export | Kind | Purpose |
|---|---|---|
| `SIGNATURE_HEADER` | `const` | `"x-signature"`, lowercased as HTTP headers are matched |
| `SIGNATURE_PREFIX` | `const` | `"sha256="` — the algorithm prefix Ring prepends. Stripped before comparison |
| `SIGNATURE_ALGORITHM` | `const` | `"sha256"` |
| `SIGNATURE_ENCODING` | `const` | `"hex"` |
| `computeSignature(secret, payload)` | function | Hex HMAC-SHA256 of `payload` under `secret` |
| `verifySignature(options)` | function | Constant-time check of a header against a payload |
| `SignatureFailureReason` | type | `'missing_signature' \| 'malformed_signature' \| 'signature_mismatch'` |
| `SignatureVerificationResult` | type | `{ valid: boolean; reason?: SignatureFailureReason }` |
| `VerifySignatureOptions` | type | `{ secret, payload, signature }` |

## Verification status: the assumption is now CONFIRMED

**Confirmed against the official Ring Partner API documentation**
(https://developer.amazon.com/docs/ring/api-documentation.html#webhook-authentication--verification),
which `ARCHITECTURE.md` never cited:

| Question | Answer | Source |
|---|---|---|
| Does Ring sign webhooks? | **Yes.** "All webhook requests from Ring include an HMAC-SHA256 signature in the `X-Signature` header." Partners **must** verify before processing. | Ring API docs, webhook authentication |
| What is signed? | **The raw request body bytes, exactly as received.** | Same |
| Hex or base64? | **Hex**, with a literal `sha256=` prefix that must be stripped before comparing. | Same |
| Constant-time compare required? | **Yes**, mandated by the docs. | Same |
| When was it added? | Webhook event delivery GA, **21 April 2025**. | Ring release notes |

The credential is a third secret the specs never mention: the **HMAC Signature Key**,
distinct from Client ID and Client Secret. It is shown once and cannot be
regenerated — you must delete and recreate the app.

### A bug this found, and the fix

`ARCHITECTURE.md` §5.1 describes the header as "HMAC-SHA256 hex digest" and omits the
`sha256=` prefix. The first version of `verifySignature` followed the spec literally
and **would have rejected 100% of genuine Ring traffic** — every signature would have
failed the hex-format check on the `sha256=` characters, while the whole test suite
still passed, because every test fed it a bare digest.

That is the exact failure mode this project is most exposed to, so it is worth
stating plainly: **a green test suite did not catch a bug that would have broken
production**, because the tests encoded the same wrong assumption as the code. The
fix strips `SIGNATURE_PREFIX` before validating, and five tests now cover the
prefixed form specifically.

### Three further traps from the official docs

1. **Verify on raw bytes, before any `JSON.parse`.** The docs name re-serialised JSON
   as a Common Mistake whose consequence is "every signature check fails with a 401,
   even though the payload looks correct." For Lambda this means using `event.body`
   rather than a parsed object, and checking `event.isBase64Encoded`. A handler that
   does `JSON.parse` first **cannot** verify correctly.
2. **One key, two encodings.** The same HMAC key signs account-linking nonces in
   URL-safe Base64 without padding, and webhooks in hex. "Do not mix the two."
3. **Returning 4xx permanently drops events.** Ring retries only on 5xx and timeout;
   4xx is a permanent failure with no retry. Ten or more consecutive 4xx over 24
   hours **may get the endpoint disabled**. A signature bug returning 401 would
   therefore kill the pipeline quietly and then permanently.

### The signed-payload question is closed, but delivery is still untested

The docs confirm the mechanism. What they do **not** provide is any way to exercise
it without real hardware: the Developer Playground gives a 30-minute OAuth token and
simulates live-view/WHEP events, not webhook delivery, and the "synthetic sandbox"
the get-started glossary describes is not corroborated by the testing docs, which
describe real staging users with real US-located devices.

So signature verification is verified against the documentation, not against a live
delivery. The pipeline must verify the signature and **return 200 immediately**,
processing asynchronously — never do Bedrock work inline, and never let a
verification failure become a 4xx.

## Behaviour

`verifySignature` returns a discriminated result rather than throwing or returning
a bare boolean, so a caller can log *why* a request was rejected.

| Input | Result | Why |
|---|---|---|
| `sha256=<correct digest>` — what Ring sends | `{ valid: true }` | Prefix stripped, constant-time match |
| Correct digest, no prefix | `{ valid: true }` | Bare digest also accepted |
| Uppercase hex digest | `{ valid: true }` | Case-insensitive hex |
| Wrong secret | `signature_mismatch` | Digests differ |
| Tampered payload | `signature_mismatch` | Digests differ |
| Truncated digest | `signature_mismatch` | Length differs — caught before the compare, not thrown |
| `undefined`, `null`, or `''` | `missing_signature` | Header absent |
| `sha256=` with no digest | `malformed_signature` | Empty digest after prefix strip |
| Non-hex characters | `malformed_signature` | Rejected up front |
| Odd number of hex digits | `malformed_signature` | Rejected up front |
| Base64 instead of hex | `malformed_signature` | Rejected up front |

Two deliberate choices:

- **Malformed input is rejected before the comparison.** `timingSafeEqual` throws on
  a length mismatch, so shape is validated first. A malformed header is a client
  error, not a server fault, and gets its own reason code.
- **The compare is constant-time.** A caller cannot recover the expected digest one
  character at a time by timing repeated requests. The length check that precedes it
  does leak length, which is fixed and public.

## Tests

`test/lib/signatureVerifier.test.ts` — 18 assertions, all passing as of 2026-09-28.

The suite includes a **known-answer test**: `computeSignature('key', <pangram>)`
against the published HMAC-SHA256 vector
`f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8`. That anchors
the digest computation to an external reference, so a regression in the primitive
fails here rather than silently in production. The value was confirmed against
`node:crypto` before being written into the test, not recalled.

## Environment

Reads the secret from `RING_WEBHOOK_SECRET` — `ARCHITECTURE.md` §8.2. The variable
is declared in `.env.example` with a placeholder value; the real value is never
committed (NFR3).

## Idempotency lives next door

`ARCHITECTURE.md` §3.1 also requires idempotency via `request_id` in DynamoDB with a
24-hour TTL (NFR2). That is implemented in
[02-dynamodb](./02-dynamodb.md) → `claimRequestId()`, and it is what the webhook
handler calls after verifying a signature.

## Related

- The component this serves: [02-pipeline-components](../02-architecture/02-pipeline-components.md)
- The security posture: [05-security-and-services](../02-architecture/05-security-and-services.md)
- The webhook payload: [03-api-contracts](../02-architecture/03-api-contracts.md)
- Environment template: `.env.example`
