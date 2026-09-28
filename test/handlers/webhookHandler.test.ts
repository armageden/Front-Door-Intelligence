/**
 * Tests for the Ring webhook ingress.
 *
 * Two things matter more than anything else here, and both are asserted explicitly:
 *
 * 1. The signature is verified against the **raw** body, before any parse. The
 *    official Ring docs name "sign re-serialized JSON" as a Common Mistake whose
 *    consequence is that every check fails on a payload that looks correct.
 * 2. Status codes are chosen so that a transient or benign condition never becomes a
 *    4xx, because Ring treats 4xx as permanent and may disable the endpoint.
 *
 * DynamoDB is stubbed at the client boundary. No AWS account is involved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import {
  WEBHOOK_SECRET_ENV,
  handler,
  ingest,
  readRawBody,
} from '../../src/handlers/webhookHandler';
import { computeSignature, SIGNATURE_PREFIX } from '../../src/lib/signatureVerifier';
import * as dynamo from '../../src/lib/dynamoClient';

const SECRET = 'test_hmac_signature_key';

process.env[WEBHOOK_SECRET_ENV] = SECRET;
process.env[dynamo.EVENTS_TABLE_ENV] = 'FrontDoorEvents';
process.env[dynamo.IDEMPOTENCY_TABLE_ENV] = 'FrontDoorIdempotency';

/**
 * A payload matching the real Ring v1.1 shape, verified against the official API
 * documentation on 2026-09-28. Field placement differs from ARCHITECTURE.md §5.1:
 * `request_id` is under `meta`, and the device id is `data.attributes.source`.
 */
const V11_PAYLOAD = {
  meta: {
    version: '1.1',
    time: '2026-02-13T13:39:57.200Z',
    request_id: '2ad45ade-1818-4154-813b-afdd8bcd8085',
    account_id: 'ava1.ring.account.XXXYYY',
  },
  data: {
    id: 'front_door_cam_motion_1786715596787',
    type: 'motion_detected',
    attributes: {
      source: 'front_door_cam',
      source_type: 'devices',
      timestamp: 1786715596787,
      timestamp_readable: '2026-02-13 13:39:57',
      sub_type: 'human',
      component_ids: ['0'],
    },
  },
};

function signed(rawBody: string, secret = SECRET): string {
  return SIGNATURE_PREFIX + computeSignature(secret, rawBody);
}

function apiEvent(body: string, headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /webhook/ring',
    rawPath: '/webhook/ring',
    rawQueryString: '',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    isBase64Encoded: false,
    requestContext: { http: { method: 'POST', path: '/webhook/ring' } },
  } as unknown as APIGatewayProxyEventV2;
}

let putEventSpy: MockInstance<typeof dynamo.putEvent>;
let claimRequestIdSpy: MockInstance<typeof dynamo.claimRequestId>;

beforeEach(() => {
  putEventSpy = vi.spyOn(dynamo, 'putEvent').mockResolvedValue(undefined);
  claimRequestIdSpy = vi.spyOn(dynamo, 'claimRequestId').mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `APIGatewayProxyResultV2.body` is optional, so narrow before parsing. */
function parseBody(response: APIGatewayProxyStructuredResultV2): {
  status: string;
  event_id?: string;
} {
  expect(response.body).toBeTypeOf('string');
  return JSON.parse(response.body as string) as { status: string; event_id?: string };
}

describe('ingest — signature handling', () => {
  it('accepts a correctly signed, correctly shaped payload', async () => {
    const raw = JSON.stringify(V11_PAYLOAD);
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });

    expect(result.statusCode).toBe(200);
    expect(result.outcome).toBe('accepted');
    expect(result.event?.device_id).toBe('front_door_cam');
    expect(result.event?.event_type).toBe('motion_detected');
    expect(result.event?.sub_type).toBe('human');
  });

  it('rejects a missing signature with 401 and stores nothing', async () => {
    const result = await ingest({
      rawBody: JSON.stringify(V11_PAYLOAD),
      signature: undefined,
      secret: SECRET,
    });

    expect(result.statusCode).toBe(401);
    expect(result.outcome).toBe('unverified_signature');
    expect(putEventSpy).not.toHaveBeenCalled();
    expect(claimRequestIdSpy).not.toHaveBeenCalled();
  });

  it('rejects a payload whose body was modified after signing', async () => {
    const raw = JSON.stringify(V11_PAYLOAD);
    const tampered = raw.replace('human', 'vehicle');
    const result = await ingest({ rawBody: tampered, signature: signed(raw), secret: SECRET });

    expect(result.statusCode).toBe(401);
    expect(putEventSpy).not.toHaveBeenCalled();
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const raw = JSON.stringify(V11_PAYLOAD);
    const result = await ingest({
      rawBody: raw,
      signature: signed(raw, 'not_the_real_key'),
      secret: SECRET,
    });

    expect(result.statusCode).toBe(401);
  });

  // The regression that matters most: verification must happen on the exact bytes.
  it('verifies against the raw body, not a re-serialised parse', async () => {
    const raw = JSON.stringify(V11_PAYLOAD, null, 2); // pretty-printed
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });
    expect(result.outcome).toBe('accepted');

    // The same object, re-serialised compactly, has different bytes and must fail —
    // which is exactly what happens if a handler parses before verifying.
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(reserialised).not.toBe(raw);
    const viaReserialisation = await ingest({
      rawBody: reserialised,
      signature: signed(raw),
      secret: SECRET,
    });
    expect(viaReserialisation.statusCode).toBe(401);
  });

  it('throws rather than accepting anything when the secret is unset', async () => {
    const previous = process.env[WEBHOOK_SECRET_ENV];
    delete process.env[WEBHOOK_SECRET_ENV];
    await expect(
      ingest({ rawBody: JSON.stringify(V11_PAYLOAD), signature: 'sha256=ab' }),
    ).rejects.toThrow(/RING_WEBHOOK_SECRET/);
    if (previous !== undefined) process.env[WEBHOOK_SECRET_ENV] = previous;
  });
});

describe('ingest — payload validation', () => {
  it.each([
    ['not JSON at all', 'this is not json'],
    ['a JSON array', '[]'],
    ['an object missing meta.request_id', JSON.stringify({ meta: { time: 'x' }, data: {} })],
    ['an object with a non-numeric attributes.timestamp', JSON.stringify({
      meta: { time: '2026-02-13T13:39:57.200Z', request_id: 'r1' },
      data: { id: 'e1', type: 'motion_detected', attributes: { source: 'd1', timestamp: 'soon' } },
    })],
  ])('returns 400 for %s', async (_label, raw) => {
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });
    expect(result.statusCode).toBe(400);
    expect(result.outcome).toBe('malformed_payload');
    expect(putEventSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for an unparseable meta.time', async () => {
    const payload = { ...V11_PAYLOAD, meta: { ...V11_PAYLOAD.meta, time: 'never' } };
    const raw = JSON.stringify(payload);
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });
    expect(result.statusCode).toBe(400);
  });
});

describe('ingest — status codes chosen to avoid 4xx on benign conditions', () => {
  it('returns 200 for a duplicate request_id', async () => {
    claimRequestIdSpy.mockResolvedValue(false);
    const raw = JSON.stringify(V11_PAYLOAD);
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });

    expect(result.statusCode).toBe(200);
    expect(result.outcome).toBe('duplicate');
    expect(putEventSpy).not.toHaveBeenCalled();
  });

  it('returns 200 and stores nothing for a signed event type we do not handle', async () => {
    const payload = { ...V11_PAYLOAD, data: { ...V11_PAYLOAD.data, type: 'device_online' } };
    const raw = JSON.stringify(payload);
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });

    expect(result.statusCode).toBe(200);
    expect(result.outcome).toBe('unsupported_event');
    expect(putEventSpy).not.toHaveBeenCalled();
    expect(claimRequestIdSpy).not.toHaveBeenCalled();
  });

  it('handles button_press, which carries no sub_type', async () => {
    const payload = {
      ...V11_PAYLOAD,
      data: {
        ...V11_PAYLOAD.data,
        id: 'front_door_cam_button_press_1771027372393',
        type: 'button_press',
        attributes: { source: 'front_door_cam', source_type: 'devices', timestamp: 1771027372393 },
      },
    };
    const raw = JSON.stringify(payload);
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });

    expect(result.outcome).toBe('accepted');
    expect(result.event?.sub_type).toBeUndefined();
  });
});

describe('toDoorEvent mapping, via ingest', () => {
  it('derives a UTC date partition key from meta.time', async () => {
    const raw = JSON.stringify(V11_PAYLOAD);
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });
    // 2026-02-13T13:39:57.200Z is still the 13th in UTC.
    expect(result.event?.date).toBe('2026-02-13');
    expect(result.event?.timestamp).toBe(V11_PAYLOAD.meta.time);
    expect(result.event?.account_id).toBe('ava1.ring.account.XXXYYY');
    expect(result.event?.processed).toBe(false);
  });

  it('tolerates a v1.0 payload with no account_id', async () => {
    const payload = {
      ...V11_PAYLOAD,
      meta: { version: '1.0', time: V11_PAYLOAD.meta.time, request_id: 'req-legacy' },
    };
    const raw = JSON.stringify(payload);
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });
    expect(result.outcome).toBe('accepted');
    expect(result.event?.account_id).toBeUndefined();
  });
});

describe('readRawBody', () => {
  it('returns the body unchanged when not base64 encoded', () => {
    expect(readRawBody(apiEvent('{"a":1}'))).toBe('{"a":1}');
  });

  it('decodes a base64 body', () => {
    const raw = '{"hello":"world"}';
    const event = { ...apiEvent(''), isBase64Encoded: true, body: Buffer.from(raw).toString('base64') };
    expect(readRawBody(event)).toBe(raw);
  });

  it('returns undefined for an empty body, which is not worth hashing', () => {
    expect(readRawBody(apiEvent(''))).toBeUndefined();
  });

  it('returns undefined when the body field is absent', () => {
    const noBody = { ...apiEvent(''), body: undefined };
    expect(readRawBody(noBody as unknown as APIGatewayProxyEventV2)).toBeUndefined();
  });
});

describe('handler', () => {
  it('returns 200 and the event id for a valid request', async () => {
    const raw = JSON.stringify(V11_PAYLOAD);
    const response = await handler(
      apiEvent(raw, { 'x-signature': signed(raw) }),
    );

    expect(response.statusCode).toBe(200);
    expect(parseBody(response).status).toBe('accepted');
    expect(parseBody(response).event_id).toBe('front_door_cam_motion_1786715596787');
  });

  it('finds the signature header regardless of casing', async () => {
    const raw = JSON.stringify(V11_PAYLOAD);
    const response = await handler(
      apiEvent(raw, { 'X-Signature': signed(raw) }),
    );
    expect(response.statusCode).toBe(200);
  });

  it('returns 401 for an unsigned request', async () => {
    const response = await handler(apiEvent(JSON.stringify(V11_PAYLOAD)));
    expect(response.statusCode).toBe(401);
  });

  it('returns 400 when the body is missing entirely', async () => {
    const response = await handler(apiEvent(''));
    expect(response.statusCode).toBe(400);
  });

  it('returns 500, not 4xx, when storage throws, so Ring retries', async () => {
    putEventSpy.mockRejectedValue(new Error('DynamoDB is unhappy'));
    const raw = JSON.stringify(V11_PAYLOAD);
    const response = await handler(apiEvent(raw, { 'x-signature': signed(raw) }));

    // A 4xx here would be treated as a permanent failure and could get the endpoint
    // disabled, so an unexpected internal error must ask for a retry instead.
    expect(response.statusCode).toBe(500);
  });

  it('never echoes internal failure detail back to Ring', async () => {
    putEventSpy.mockRejectedValue(new Error('secret internal detail: table=FrontDoorEvents'));
    const raw = JSON.stringify(V11_PAYLOAD);
    const response = await handler(apiEvent(raw, { 'x-signature': signed(raw) }));

    expect(response.body).not.toContain('FrontDoorEvents');
    expect(response.body).not.toContain('secret internal detail');
  });
});
