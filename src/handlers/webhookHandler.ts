/**
 * Ring webhook ingress.
 *
 * Implements FR1 (receive), FR2 (verify the `X-Signature` header), FR3 (extract the
 * event subtype), FR7 (store every processed event), and NFR1 (return within 5
 * seconds) and NFR2 (idempotent on `request_id`).
 *
 * ## Read this before changing the order of the statements below
 *
 * The official Ring documentation is explicit that the HMAC covers the **raw request
 * body bytes**: "If you parse the JSON and then re-serialize it to compute the HMAC,
 * whitespace and key ordering change the bytes — the digest will not match and every
 * signature check will fail with a payload that looks correct."
 *
 * So the signature is verified against the untouched body string, and only then is
 * the body parsed. Reordering these two steps breaks every request.
 *
 * ## Why the responses are what they are
 *
 * Ring treats **4xx as a permanent failure with no retry**, and may disable an
 * endpoint after "10+ consecutive failures over 24 hours" (verified 2026-09-28). That
 * makes the status codes a safety property, not just a REST convention:
 *
 * - A bad signature returns **401**. A forged request must not be accepted, and
 *   dropping it permanently is correct — you never want a forgery retried. If the
 *   endpoint really does get disabled, the secret is misconfigured, and that is
 *   exactly the situation you want surfaced immediately rather than silently.
 * - A **duplicate** returns **200**, never 4xx. Ring retried because it never saw a
 *   2xx; we already stored the event, so 2xx is the truthful answer and stops the
 *   retry loop.
 * - An **unrecognised but correctly signed** event type returns **200** and is not
 *   stored. Ring sending an event we do not act on is not an error, and 4xx here
 *   would start a retry storm over something harmless.
 *
 * ## Not yet wired
 *
 * This handler verifies, deduplicates, and stores. It then returns. The snapshot
 * fetch and the Bedrock description (FR4–FR6) are **not** invoked inline, because the
 * Ring docs name inline heavy processing as a Common Mistake: it exceeds the 5-second
 * budget and produces duplicates. The dispatch seam for the remaining stages is
 * recorded in docs/06-handlers/01-webhook-ingress.md.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { verifySignature, SIGNATURE_HEADER } from '../lib/signatureVerifier';
import { claimRequestId, putEvent, toDoorEvent } from '../lib/dynamoClient';
import {
  createSnapshotStore,
  QUEUE_URL_ENV,
  SNAPSHOT_BUCKET_ENV,
} from '../lib/snapshotStore';
import type { DoorEvent, IngressResult, RingWebhookPayload } from '../types';

/** Event types the pipeline acts on. Others are accepted and ignored. */
const HANDLED_EVENT_TYPES = new Set(['motion_detected', 'button_press']);

/** `RING_WEBHOOK_SECRET`, the HMAC Signature Key from the Ring app credentials. */
export const WEBHOOK_SECRET_ENV = 'RING_WEBHOOK_SECRET';

export interface IngestOptions {
  /**
   * The request body **exactly as received**. Do not pass a parsed object — the
   * digest is computed over these bytes.
   */
  rawBody: string;
  /** The `X-Signature` header value, or `undefined` when absent. */
  signature: string | undefined;
  /** Overridable for tests. Defaults to `process.env.RING_WEBHOOK_SECRET`. */
  secret?: string;
  /**
   * Hand-off to the describe stage. Injected in tests; in production the handler
   * builds a queue-backed implementation. A no-op when absent, which keeps the
   * decision logic testable without AWS.
   */
  enqueue?: (event: DoorEvent) => Promise<unknown>;
}

function malformed(detail: string): IngressResult {
  return { outcome: 'malformed_payload', statusCode: 400, detail };
}

function isRingWebhookPayload(value: unknown): value is RingWebhookPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RingWebhookPayload>;
  const meta = candidate.meta;
  const data = candidate.data;
  if (typeof meta !== 'object' || meta === null) return false;
  if (typeof data !== 'object' || data === null) return false;
  if (typeof meta.request_id !== 'string' || meta.request_id.length === 0) return false;
  if (typeof meta.time !== 'string' || meta.time.length === 0) return false;
  if (typeof data.id !== 'string' || data.id.length === 0) return false;
  if (typeof data.type !== 'string' || data.type.length === 0) return false;
  if (typeof data.attributes !== 'object' || data.attributes === null) return false;
  const attributes = data.attributes;
  if (typeof attributes.source !== 'string' || attributes.source.length === 0) return false;
  if (typeof attributes.timestamp !== 'number') return false;
  return true;
}

/**
 * Verify, deduplicate, and store. Returns a result rather than an HTTP response so
 * the decision logic is testable without an API Gateway event or an AWS account.
 */
export async function ingest(options: IngestOptions): Promise<IngressResult> {
  const { rawBody, signature, enqueue } = options;
  const secret = options.secret ?? process.env[WEBHOOK_SECRET_ENV];

  if (!secret) {
    // Misconfiguration, not an attack. Fail loudly rather than accepting anything.
    throw new Error(`Missing required environment variable: ${WEBHOOK_SECRET_ENV}`);
  }

  // FR2 — verify against the raw body, before any parse.
  const verification = verifySignature({ secret, payload: rawBody, signature });
  if (!verification.valid) {
    return {
      outcome: 'unverified_signature',
      statusCode: 401,
      // `reason` is only present on failure, and `exactOptionalPropertyTypes` means it
      // must not be assigned `undefined` explicitly.
      ...(verification.reason !== undefined ? { detail: verification.reason } : {}),
    };
  }

  // Only now is it safe to parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return malformed('body is not valid JSON');
  }

  if (!isRingWebhookPayload(parsed)) {
    return malformed('payload does not match the Ring webhook shape');
  }

  if (!HANDLED_EVENT_TYPES.has(parsed.data.type)) {
    // Signed and understood, but nothing to do. 200, and do not store.
    return {
      outcome: 'unsupported_event',
      statusCode: 200,
      detail: `event type not handled: ${parsed.data.type}`,
    };
  }

  // NFR2 — claim the request id before doing any work.
  const claimed = await claimRequestId(parsed.meta.request_id);
  if (!claimed) {
    return {
      outcome: 'duplicate',
      statusCode: 200,
      detail: 'request_id already processed',
    };
  }

  let event: DoorEvent;
  try {
    event = toDoorEvent(parsed);
  } catch (error) {
    return malformed(error instanceof Error ? error.message : 'event could not be derived');
  }

  // FR7 — persist before acknowledging.
  await putEvent(event);

  // Hand off to the describe stage. This is deliberately the last thing before
  // returning: the Ring docs name inline heavy processing as a Common Mistake, because
  // it blows the 5-second budget NFR1 requires.
  //
  // A queue failure must not fail the request. The event is already durably stored, so
  // the worst case is an event with no description, which a sweep can recover.
  // Returning 500 instead would make Ring retry a request that already succeeded.
  if (enqueue) {
    try {
      await enqueue(event);
    } catch (error) {
      console.error('could not enqueue for describe stage', {
        event_id: event.event_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { outcome: 'accepted', statusCode: 200, event };
}

/**
 * Extract the body as the exact bytes Ring sent.
 *
 * API Gateway base64-encodes the body when it cannot pass text through safely, and
 * decoding is mandatory before verification — the digest is over the decoded bytes.
 *
 * Returns `undefined` for an absent or empty body. An empty body is not worth
 * hashing, and reporting it as missing produces an accurate 400 rather than a 401
 * that would blame the caller's signature for a request that carried no payload.
 */
export function readRawBody(event: APIGatewayProxyEventV2): string | undefined {
  if (typeof event.body !== 'string' || event.body.length === 0) return undefined;
  if (event.isBase64Encoded !== true) return event.body;
  try {
    const decoded = Buffer.from(event.body, 'base64').toString('utf8');
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/** Lambda entry point for `POST /webhook/ring`. */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const rawBody = readRawBody(event);

  if (rawBody === undefined) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'rejected', reason: 'missing body' }),
    };
  }

  // Header lookup is case-insensitive, but a caller may hand us either casing.
  const headerSource = event.headers ?? {};
  const signature = Object.entries(headerSource).find(
    ([name]) => name.toLowerCase() === SIGNATURE_HEADER,
  )?.[1];

  let result: IngressResult;
  try {
    // In production the hand-off is a queue send. Built here rather than at module
    // scope so a missing queue configuration surfaces as one logged warning per
    // invocation instead of an import-time crash that would take the whole handler down.
    const store = createSnapshotStore({ bucket: process.env[SNAPSHOT_BUCKET_ENV] ?? '' });
    const queueUrl = process.env[QUEUE_URL_ENV];
    result = await ingest({
      rawBody,
      signature,
      ...(queueUrl
        ? { enqueue: (event: DoorEvent) => store.enqueueForDescribe(event, queueUrl) }
        : {}),
    });
  } catch (error) {
    // An unexpected failure must not become a 4xx: Ring would treat that as a
    // permanent failure and eventually disable the endpoint. 500 asks for a retry.
    console.error('webhook ingress failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'error' }),
    };
  }

  if (result.outcome === 'accepted') {
    console.log('webhook accepted', {
      event_id: result.event?.event_id,
      event_type: result.event?.event_type,
      device_id: result.event?.device_id,
    });
  } else {
    console.warn('webhook not accepted', {
      outcome: result.outcome,
      status: result.statusCode,
      detail: result.detail,
    });
  }

  return {
    statusCode: result.statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      status: result.outcome === 'accepted' ? 'accepted' : 'rejected',
      event_id: result.event?.event_id,
      outcome: result.outcome,
    }),
  };
}
