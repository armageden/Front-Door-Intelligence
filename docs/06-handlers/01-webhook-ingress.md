**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/handlers/webhookHandler.ts` → `ingest()`, `readRawBody()`, `handler()` and `WEBHOOK_SECRET_ENV`, read in full; `test/handlers/webhookHandler.test.ts` → 26 passing assertions; requirements traced to `prd.md` FR1, FR2, FR3, FR7, NFR1, NFR2 and `ARCHITECTURE.md` §3.1, §3.5, §4.1, §12. Delivery semantics verified against the Ring Partner API documentation on 2026-09-28.

# Webhook ingress

Serves `POST /webhook/ring`. Implements **FR1** (receive), **FR2** (verify the
`X-Signature` header), **FR3** (extract the event subtype), **FR7** (store every
processed event), **NFR1** (answer within 5 seconds), and **NFR2** (idempotent on
`request_id`).

## Exported surface

From `src/handlers/webhookHandler.ts`:

| Export | Kind | Purpose |
|---|---|---|
| `ingest(options)` | async function | Verify → deduplicate → store. Returns an `IngressResult`, not an HTTP response, so the decision logic is testable without API Gateway or AWS |
| `readRawBody(event)` | function | Extracts the body as the exact bytes Ring sent, decoding base64 when required |
| `handler(event)` | async function | Lambda entry point. Wraps `ingest` and maps the result to an HTTP response |
| `WEBHOOK_SECRET_ENV` | `const` | `"RING_WEBHOOK_SECRET"` |
| `IngestOptions` | type | `{ rawBody, signature, secret? }` — `secret` is a test seam |

## The ordering rule

**Verify the signature against the raw body, then parse.** Never the other way round.

The official Ring documentation is explicit: "Pass the raw body bytes, not
re-serialized JSON… If you parse the JSON and then re-serialize it to compute the
HMAC, whitespace and key ordering change the bytes — the digest will not match and
**every** signature check will fail with a payload that looks correct."

`ingest` therefore receives a `rawBody: string` and cannot be handed a parsed object.
`readRawBody` returns the untouched body, decoding base64 first because the digest is
over the decoded bytes. Reordering these two steps, or letting a body-mapping
integration re-serialise the payload upstream, breaks every request.

There is a test for this specifically: it signs a pretty-printed body, then proves
that the same object re-serialised compactly fails with 401 — which is exactly what
happens if a handler parses before verifying.

## Status codes are a safety property, not a REST convention

Ring treats **4xx as a permanent failure with no retry**, and may disable an endpoint
after "10+ consecutive failures over 24 hours" (verified 2026-09-28). Every status
below is chosen with that in mind.

| Condition | Status | Outcome | Why |
|---|---|---|---|
| Signature valid, payload valid, event type handled | **200** | `accepted` | FR1, FR7. Event stored before acknowledging |
| `request_id` already claimed | **200** | `duplicate` | Ring retried because it never saw a 2xx. We already stored it, so 2xx is truthful and stops the retry loop. **Never 4xx** |
| Signature valid, event type not handled | **200** | `unsupported_event` | Ring sending `device_online` is not an error. 4xx here would start a retry storm over something harmless |
| Signature missing or invalid | **401** | `unverified_signature` | A forgery must not be accepted, and dropping it permanently is correct — you never want a forgery retried |
| Signed body is not valid JSON, or does not match the Ring shape | **400** | `malformed_payload` | Ring or a proxy produced something unusable |
| No body at all | **400** | — | An empty body is not worth hashing, so this is reported accurately rather than as a signature failure |
| **Unexpected internal error** | **500** | — | Deliberate. A 4xx here would be a permanent failure and could get the endpoint disabled. 500 asks Ring to retry |

If the endpoint really does get disabled, the secret is misconfigured — and that is
the situation you want surfaced immediately rather than silently.

The handler also never echoes internal detail back to Ring. Failures are logged
server-side and the response body carries only a status and an outcome. There is a
test asserting a DynamoDB error message containing a table name does not reach the
caller.

## Idempotency

`claimRequestId` performs a **conditional put** — `attribute_not_exists(request_id)` —
against the idempotency table, with a 24-hour TTL that covers Ring's full retry
schedule (1s → 5s → 30s → 2min → 10min → 1hr). The first caller wins; everyone after
gets a `duplicate`.

There is no read-then-write, on purpose. A check followed by an unconditional put
leaves a window where two concurrent retries both observe "not seen" and both proceed.
See [04-data-store](../02-architecture/04-data-store.md) for the key design.

## Payload mapping

Built on the **real** Ring API, not on `ARCHITECTURE.md` §5.1, which is wrong in six of
nine fields. `toDoorEvent` maps:

| Stored field | Ring source |
|---|---|
| `event_id` | `data.id` — a composite event id, **not** a device id |
| `device_id` | `data.attributes.source` |
| `event_type` | `data.type` |
| `sub_type` | `data.attributes.sub_type`, flat: `human`, not `motion.human` |
| `timestamp` | `meta.time` |
| `date` | UTC `YYYY-MM-DD` derived from `meta.time` |
| `account_id` | `meta.account_id`, **absent in v1.0** |
| `processed` | `false` until the description stage completes |

`device_name` is deliberately absent: Ring sends no device name in any webhook, so it
must be resolved later via `GET /v1/devices/{id}`. Not setting it is more honest than
inventing a value.

The `date` partition key is computed in **UTC** so it is deterministic regardless of
where the Lambda runs. A later stage may need the homeowner's local date for "today's
events"; that is a product decision, not an ingress one. There is a test pinning the
UTC behaviour across a day boundary.

## The dispatch seam — not yet wired

This handler verifies, deduplicates, and stores, then returns. It does **not** invoke
the snapshot fetch or the Bedrock description (FR4–FR6).

That is deliberate rather than incomplete-by-accident. The Ring docs name inline heavy
processing as a Common Mistake: it exceeds the 5-second budget and produces
duplicates. The next phase should dispatch the stored event onward — SQS, EventBridge,
or a direct invoke — and the remaining five handlers should consume it.

Until then the pipeline terminates at storage. The `processed: false` flag on the
stored event is the marker for that, and it is what the next stage should look for.

## Not implemented, and why it matters

Two things the handler cannot currently do, both verified as real constraints rather
than oversights:

- **TAKE and E2EE accounts return undecodable media.** The snapshot→Bedrock→overlay
  flow cannot work on them. The next stage must detect that and fall back to the FR11
  deterministic summary.
- **Images carry a mandatory watermark** (Ring logo, Device ID, App Name, timestamp),
  applied server-side and unremovable. It is in the Bedrock vision input *and* in the
  PiP overlay.

## Related

- The verifier this depends on: [01-signature-verification](../04-libraries/01-signature-verification.md)
- The storage layer: [04-data-store](../02-architecture/04-data-store.md)
- The corrected API facts: [04-ring-api-findings](../05-hackathon-requirements/04-ring-api-findings.md)
- Environment template: `.env.example`
