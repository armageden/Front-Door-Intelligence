/**
 * Tests for `test/fixtures/ring_motion_event.json`.
 *
 * `ARCHITECTURE.md` §9.1 tells a reader to exercise the pipeline with
 * `curl -d @test/fixtures/ring_motion_event.json`. **That command could not work while this
 * file did not exist**, and a fixture that has never been run is not a fixture — it is a
 * guess about what the API sends.
 *
 * So this suite treats the file as an artefact with a contract and checks it:
 *
 * 1. It is byte-for-byte accepted by the **real** ingress path. `ingest()` verifies the HMAC
 *    over the raw file contents and stores the event — which is precisely what the curl
 *    command does, minus the HTTP hop. This is the assertion that would have caught a
 *    payload shaped like `ARCHITECTURE.md` §5.1 rather than like the real Ring API.
 * 2. It survives a JSON round trip through the documented webhook shape, so it does not
 *    depend on a key ordering or a whitespace quirk.
 * 3. Its fields are the ones the pipeline actually reads, asserted by name — so a fixture
 *    that quietly drops `sub_type` or moves the device id is caught here rather than as a
 *    confusing snapshot failure much later.
 *
 * The README documents the matching command, including how to compute the signature. The
 * signature is over the raw bytes, so the command only works against this exact file and
 * only with a signature computed from it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { ingest } from '../src/handlers/webhookHandler';
import { computeSignature, SIGNATURE_PREFIX } from '../src/lib/signatureVerifier';
import { toDoorEvent } from '../src/lib/dynamoClient';
import * as dynamo from '../src/lib/dynamoClient';
import type { DoorEvent, RingWebhookPayload } from '../src/types';

const FIXTURE_PATH = join(process.cwd(), 'test', 'fixtures', 'ring_motion_event.json');
const SECRET = 'test_hmac_signature_key';

/** The exact bytes a `curl -d @file` would send. */
const RAW = readFileSync(FIXTURE_PATH, 'utf8');

let putEventSpy: MockInstance<typeof dynamo.putEvent>;
let claimRequestIdSpy: MockInstance<typeof dynamo.claimRequestId>;

beforeEach(() => {
  process.env[dynamo.EVENTS_TABLE_ENV] = 'FrontDoorEvents';
  process.env[dynamo.IDEMPOTENCY_TABLE_ENV] = 'FrontDoorIdempotency';
  putEventSpy = vi.spyOn(dynamo, 'putEvent').mockResolvedValue(undefined);
  claimRequestIdSpy = vi.spyOn(dynamo, 'claimRequestId').mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the §9.1 curl fixture', () => {
  it('is accepted by the real ingress path, signature and all', async () => {
    // The whole point of the file: this is what §9.1's command sends.
    const result = await ingest({
      rawBody: RAW,
      signature: SIGNATURE_PREFIX + computeSignature(SECRET, RAW),
      secret: SECRET,
    });

    expect(result.statusCode).toBe(200);
    expect(result.outcome).toBe('accepted');
    expect(putEventSpy).toHaveBeenCalledTimes(1);
  });

  it('is rejected without a valid signature, like any other body', async () => {
    // Otherwise a file sitting in the repo would be a way to forge events.
    const result = await ingest({ rawBody: RAW, signature: 'sha256=wrong', secret: SECRET });

    expect(result.statusCode).toBe(401);
    expect(putEventSpy).not.toHaveBeenCalled();
  });

  it('is valid JSON, and parses to the documented webhook shape', () => {
    const parsed = JSON.parse(RAW) as RingWebhookPayload;

    expect(parsed.meta.version).toBe('1.1');
    expect(parsed.data.type).toBe('motion_detected');
  });

  it('carries the device id where the pipeline reads it, not where §5.1 shows it', () => {
    // `ARCHITECTURE.md` §5.1 puts a `device_id` on `data` and a `request_id` at the top
    // level. The real API puts the device id at `data.attributes.source` and the request id
    // under `meta`. A fixture built from §5.1 would fail both of these.
    const parsed = JSON.parse(RAW) as RingWebhookPayload;

    expect(parsed.data.attributes.source).toBe('front_door_cam');
    expect(parsed.meta.request_id).toBeTruthy();
    expect(parsed.data).not.toHaveProperty('device_id');
  });

  it('carries the flat sub_type, not the dotted form', () => {
    // `motion.human` is an Event History query value, not a webhook `sub_type`. Matching the
    // dotted form would match nothing, ever.
    const parsed = JSON.parse(RAW) as RingWebhookPayload;

    expect(parsed.data.attributes.sub_type).toBe('human');
    expect(parsed.data.attributes.sub_type).not.toContain('.');
  });

  it('stores an event the snapshot stage can actually act on', () => {
    // `occurred_at_ms` is what a media request is anchored to, and it is not derivable from
    // `meta.time`. A fixture missing it would produce an event that cannot be described.
    const event: DoorEvent = toDoorEvent(JSON.parse(RAW) as RingWebhookPayload);

    expect(event.date).toBe('2026-02-13');
    expect(event.device_id).toBe('front_door_cam');
    expect(event.occurred_at_ms).toBe(1786715596787);
    expect(Number.isFinite(Date.parse(event.timestamp))).toBe(true);
    expect(event.processed).toBe(false);
  });

  it('is an event type the pipeline handles, so the fixture exercises a real path', async () => {
    const parsed = JSON.parse(RAW) as RingWebhookPayload;

    // `device_online` would be accepted with a 200 and not stored, which would make this
    // fixture useless as an end-to-end exercise.
    expect(parsed.data.type).toBe('motion_detected');
  });

  it('carries timestamp_readable with no timezone offset, as Ring actually sends it', () => {
    // The readable form is local wall-clock time with no offset. `occurred_at_ms` is the
    // field to compute from; re-deriving epoch ms from this string is an off-by-hours bug,
    // which is why the pipeline carries the numeric field alongside it.
    const parsed = JSON.parse(RAW) as RingWebhookPayload;

    expect(parsed.data.attributes.timestamp_readable).toBe('2026-02-13 13:39:57');
    expect(parsed.data.attributes.timestamp_readable).not.toMatch(/[+-]\d\d:?\d\d|Z$/);
  });
});