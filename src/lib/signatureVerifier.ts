/**
 * HMAC-SHA256 webhook signature verification.
 *
 * Implements FR2: "The system MUST verify the `X-Signature` HMAC-SHA256 header on
 * every incoming webhook request."
 *
 * ## What is verified, and what is assumed
 *
 * Verified against `ARCHITECTURE.md`: the algorithm is HMAC-SHA256, the value is a
 * hex digest, and the header is `X-Signature` (§3.1 Auth, §5.1 request headers, §6
 * "Webhook forgery" mitigation).
 *
 * **NOT verified:** which bytes Ring actually signs. `ARCHITECTURE.md` never states
 * it. This module assumes the signed payload is the raw, unmodified request body as
 * a UTF-8 string — the usual convention, and the only one consistent with a webhook
 * that carries no signature-friendly canonical form. Treat that as an assumption to
 * be confirmed against the Ring Partner API sandbox, not as a verified fact.
 *
 * `ARCHITECTURE.md` §12 rates "Webhook signature verification fails" as medium
 * likelihood and high impact, and mitigates it by testing against the Ring sandbox
 * and logging raw headers. That is the open risk this module carries.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Request header carrying the digest, lowercased as HTTP headers are matched. */
export const SIGNATURE_HEADER = 'x-signature';

/**
 * Algorithm prefix Ring prepends to the header value.
 *
 * VERIFIED against the official Ring Partner API documentation
 * (https://developer.amazon.com/docs/ring/api-documentation.html#webhook-authentication--verification):
 * the header arrives as `sha256=<hex>`, and the reference implementation strips the
 * prefix before comparing. `ARCHITECTURE.md` §5.1 says only "HMAC-SHA256 hex digest"
 * and omits the prefix — so the spec alone would have produced a verifier that rejects
 * 100% of genuine traffic.
 */
export const SIGNATURE_PREFIX = 'sha256=';

/** Digest algorithm. Fixed by `ARCHITECTURE.md` §3.1. */
export const SIGNATURE_ALGORITHM = 'sha256';

/** Digest encoding. `ARCHITECTURE.md` §5.1 says "HMAC-SHA256 hex digest". */
export const SIGNATURE_ENCODING = 'hex';

/** Why verification failed. Absent when `valid` is true. */
export type SignatureFailureReason =
  | 'missing_signature'
  | 'malformed_signature'
  | 'signature_mismatch';

export interface SignatureVerificationResult {
  readonly valid: boolean;
  readonly reason?: SignatureFailureReason;
}

export interface VerifySignatureOptions {
  /** The shared webhook secret, from `RING_WEBHOOK_SECRET`. */
  readonly secret: string;
  /** The exact bytes Ring signed. Assumed to be the raw request body. */
  readonly payload: string;
  /** The `X-Signature` header value, or absent when the header was not sent. */
  readonly signature: string | null | undefined;
}

/** Compute the hex HMAC-SHA256 digest of `payload` under `secret`. */
export function computeSignature(secret: string, payload: string): string {
  return createHmac(SIGNATURE_ALGORITHM, secret)
    .update(payload, 'utf8')
    .digest(SIGNATURE_ENCODING);
}

/**
 * Verify an `X-Signature` header against a payload.
 *
 * The comparison is constant-time, so a caller cannot learn the expected digest one
 * character at a time by timing repeated requests.
 */
export function verifySignature(options: VerifySignatureOptions): SignatureVerificationResult {
  const { secret, payload, signature } = options;

  if (typeof signature !== 'string' || signature.length === 0) {
    return { valid: false, reason: 'missing_signature' };
  }

  // Ring sends `sha256=<hex>`. Strip the prefix; a bare digest is also accepted
  // because the header is stripped of its prefix in some proxy configurations and
  // a locally generated fixture is easier to produce without it.
  const digest = signature.startsWith(SIGNATURE_PREFIX)
    ? signature.slice(SIGNATURE_PREFIX.length)
    : signature;

  // A hex digest has an even length and only hex digits. Rejecting malformed input
  // up front keeps `timingSafeEqual` from throwing on a length mismatch.
  if (digest.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(digest)) {
    return { valid: false, reason: 'malformed_signature' };
  }

  const expected = Buffer.from(computeSignature(secret, payload), SIGNATURE_ENCODING);
  const provided = Buffer.from(digest.toLowerCase(), SIGNATURE_ENCODING);

  if (expected.length !== provided.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  return timingSafeEqual(expected, provided)
    ? { valid: true }
    : { valid: false, reason: 'signature_mismatch' };
}
