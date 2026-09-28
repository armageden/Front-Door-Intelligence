/**
 * Tests for `src/lib/signatureVerifier.ts` → `verifySignature()` and
 * `computeSignature()`.
 *
 * The known-answer vector below is the published HMAC-SHA256 value for
 * key `"key"` over the pangram, so a regression in the digest computation fails
 * here rather than silently in production.
 */

import { describe, expect, it } from 'vitest';

import {
  computeSignature,
  verifySignature,
  SIGNATURE_ENCODING,
  SIGNATURE_HEADER,
  SIGNATURE_PREFIX,
} from '../../src/lib/signatureVerifier';

const SECRET = 'test_webhook_secret';
const PAYLOAD = '{"request_id":"req_xyz789","event_type":"motion"}';
const DIGEST = computeSignature(SECRET, PAYLOAD);

describe('computeSignature', () => {
  it('matches the published HMAC-SHA256 vector for the pangram', () => {
    expect(computeSignature('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('produces a 64-character hex digest', () => {
    expect(DIGEST).toHaveLength(64);
    expect(DIGEST).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when the secret differs', () => {
    expect(computeSignature('other_secret', PAYLOAD)).not.toBe(DIGEST);
  });

  it('differs when the payload differs', () => {
    expect(computeSignature(SECRET, PAYLOAD + ' ')).not.toBe(DIGEST);
  });
});

describe('SIGNATURE_HEADER', () => {
  it('is the lowercased X-Signature header from ARCHITECTURE.md 5.1', () => {
    expect(SIGNATURE_HEADER).toBe('x-signature');
  });
});

describe('the sha256= prefix', () => {
  // VERIFIED against the official Ring Partner API docs: the header value arrives as
  // `sha256=<hex>`. A verifier that does not strip it rejects 100% of real traffic
  // while still passing a test suite that only ever feeds it a bare digest.
  it('is sha256= as documented by Ring', () => {
    expect(SIGNATURE_PREFIX).toBe('sha256=');
  });

  it('accepts a prefixed signature — the format Ring actually sends', () => {
    expect(
      verifySignature({
        secret: SECRET,
        payload: PAYLOAD,
        signature: SIGNATURE_PREFIX + DIGEST,
      }),
    ).toEqual({ valid: true });
  });

  it('accepts a prefixed uppercase digest', () => {
    expect(
      verifySignature({
        secret: SECRET,
        payload: PAYLOAD,
        signature: SIGNATURE_PREFIX + DIGEST.toUpperCase(),
      }),
    ).toEqual({ valid: true });
  });

  it('rejects a prefixed signature computed over a different payload', () => {
    expect(
      verifySignature({
        secret: SECRET,
        payload: PAYLOAD + ' ',
        signature: SIGNATURE_PREFIX + DIGEST,
      }),
    ).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('reports a prefix with no digest as malformed', () => {
    expect(
      verifySignature({ secret: SECRET, payload: PAYLOAD, signature: SIGNATURE_PREFIX }),
    ).toEqual({ valid: false, reason: 'malformed_signature' });
  });
});

describe('verifySignature', () => {
  it('accepts a correct signature', () => {
    expect(verifySignature({ secret: SECRET, payload: PAYLOAD, signature: DIGEST })).toEqual({
      valid: true,
    });
  });

  it('accepts an uppercase hex signature', () => {
    expect(
      verifySignature({ secret: SECRET, payload: PAYLOAD, signature: DIGEST.toUpperCase() }),
    ).toEqual({ valid: true });
  });

  it('rejects a signature computed with a different secret', () => {
    const result = verifySignature({
      secret: 'wrong_secret',
      payload: PAYLOAD,
      signature: DIGEST,
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('rejects a signature over a tampered payload', () => {
    const tampered = PAYLOAD.replace('motion', 'button_press');
    const result = verifySignature({ secret: SECRET, payload: tampered, signature: DIGEST });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('rejects a truncated digest as a mismatch, not a throw', () => {
    const result = verifySignature({
      secret: SECRET,
      payload: PAYLOAD,
      signature: DIGEST.slice(0, 32),
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
  ])('reports a missing signature when the header is %s', (_label, signature) => {
    const result = verifySignature({ secret: SECRET, payload: PAYLOAD, signature });
    expect(result).toEqual({ valid: false, reason: 'missing_signature' });
  });

  it.each([
    ['non-hex characters', 'zzzz'],
    ['an odd number of hex digits', DIGEST.slice(0, 63)],
    ['a base64 digest instead of hex', 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='],
  ])('reports a malformed signature for %s', (_label, signature) => {
    const result = verifySignature({ secret: SECRET, payload: PAYLOAD, signature });
    expect(result).toEqual({ valid: false, reason: 'malformed_signature' });
  });

  it('never returns a reason when the signature is valid', () => {
    const result = verifySignature({ secret: SECRET, payload: PAYLOAD, signature: DIGEST });
    expect(result.reason).toBeUndefined();
  });

  it('encodes the digest as hex', () => {
    expect(SIGNATURE_ENCODING).toBe('hex');
  });
});
