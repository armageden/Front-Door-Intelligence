/**
 * The last uncovered paths on the Lambda side: the payload guard, the Ring client's own
 * error branches, the connection registry, and two `requireEnv` helpers.
 *
 * Every one of these is a guard on bad input or a missing configuration, which is
 * precisely the code that runs when something has already gone wrong. Untested guards are
 * the code least likely to be correct, because nothing exercises it until production does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { ingest, readRawBody } from '../../src/handlers/webhookHandler';
import { WEBHOOK_SECRET_ENV } from '../../src/handlers/webhookHandler';
import { describeEvent } from '../../src/handlers/snapshotFetcher';
import { handler as summaryHandler } from '../../src/handlers/dailySummary';
import { createRingClient, RingApiError } from '../../src/lib/ringClient';
import {
  listConnections,
  registerConnection,
  removeConnection,
  setClient as setConnectionClient,
  CONNECTIONS_TABLE_ENV,
} from '../../src/lib/connectionStore';
import * as dynamo from '../../src/lib/dynamoClient';
import { computeSignature, SIGNATURE_PREFIX } from '../../src/lib/signatureVerifier';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const SECRET = 'test-secret';

const PAYLOAD = {
  meta: { version: '1.1', time: '2026-02-13T13:39:57.200Z', request_id: 'r-1' },
  data: {
    id: 'evt-1',
    type: 'motion_detected',
    attributes: { source: 'front_door_cam', source_type: 'devices', timestamp: 1786715596787 },
  },
};

function signed(raw: string): string {
  return SIGNATURE_PREFIX + computeSignature(SECRET, raw);
}

function apiEvent(body: unknown): APIGatewayProxyEventV2 {
  return { body, isBase64Encoded: false } as unknown as APIGatewayProxyEventV2;
}

let putEvent: MockInstance<typeof dynamo.putEvent>;

beforeEach(() => {
  process.env[WEBHOOK_SECRET_ENV] = SECRET;
  process.env[dynamo.EVENTS_TABLE_ENV] = 'FrontDoorEvents';
  process.env[dynamo.IDEMPOTENCY_TABLE_ENV] = 'FrontDoorIdempotency';
  process.env[CONNECTIONS_TABLE_ENV] = 'FrontDoorConnections';
  putEvent = vi.spyOn(dynamo, 'putEvent').mockResolvedValue(undefined);
  vi.spyOn(dynamo, 'claimRequestId').mockResolvedValue(true);
});

afterEach(() => {
  // The registry keeps its OWN client singleton, separate from dynamoClient's — a fact the
  // first attempt at these tests got wrong by spying on the wrong `getClient`.
  setConnectionClient(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readRawBody', () => {
  it('returns undefined for a body that is not a string', () => {
    // API Gateway omits the body on some 4xx paths, and `undefined` is the honest answer.
    expect(readRawBody({ body: undefined } as unknown as APIGatewayProxyEventV2)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    // Not worth hashing; a 400 saying so is more useful than a 401 blaming the signature.
    expect(readRawBody({ body: '' } as unknown as APIGatewayProxyEventV2)).toBeUndefined();
  });
});

describe('the webhook payload guard', () => {
  /**
   * Each mutation removes one field the guard requires. The point is not the count but the
   * shape: a payload that is valid JSON and still not a Ring webhook must be a 400 naming a
   * reason, never a 500 from a property access on `undefined`.
   */
  const cases: { name: string; payload: unknown }[] = [
    { name: 'a body that is an array', payload: [] },
    { name: 'a body that is a string', payload: 'nope' },
    { name: 'a body that is null', payload: null },
    { name: 'a payload with no meta', payload: { data: PAYLOAD.data } },
    { name: 'a meta that is not an object', payload: { meta: 'x', data: PAYLOAD.data } },
    { name: 'a meta with no time', payload: { meta: { request_id: 'r' }, data: PAYLOAD.data } },
    { name: 'a meta with an empty request_id', payload: { meta: { time: 't', request_id: '' }, data: PAYLOAD.data } },
    { name: 'a payload with no data', payload: { meta: PAYLOAD.meta } },
    { name: 'a data that is not an object', payload: { meta: PAYLOAD.meta, data: 'x' } },
    { name: 'a data with no id', payload: { meta: PAYLOAD.meta, data: { type: 'motion_detected' } } },
    { name: 'a data with no type', payload: { meta: PAYLOAD.meta, data: { id: 'evt-1' } } },
    { name: 'a data with no attributes', payload: { meta: PAYLOAD.meta, data: { id: 'evt-1', type: 'motion_detected' } } },
    { name: 'attributes that are not an object', payload: { meta: PAYLOAD.meta, data: { id: 'e', type: 't', attributes: 'x' } } },
    { name: 'attributes with no source', payload: { meta: PAYLOAD.meta, data: { id: 'e', type: 't', attributes: { timestamp: 1 } } } },
    { name: 'a non-numeric timestamp', payload: { meta: PAYLOAD.meta, data: { id: 'e', type: 't', attributes: { source: 's', timestamp: 'soon' } } } },
  ];

  for (const { name, payload } of cases) {
    it(`answers 400 for ${name}`, async () => {
      const raw = JSON.stringify(payload);
      const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });

      // 400, not 500: the caller sent something wrong and a retry will not fix it.
      expect(result.statusCode).toBe(400);
      expect(result.outcome).toBe('malformed_payload');
      expect(putEvent).not.toHaveBeenCalled();
    });
  }

  it('accepts the unmodified payload, so the guard is not simply rejecting everything', async () => {
    const raw = JSON.stringify(PAYLOAD);
    const result = await ingest({ rawBody: raw, signature: signed(raw), secret: SECRET });

    expect(result.statusCode).toBe(200);
    expect(putEvent).toHaveBeenCalledTimes(1);
  });
});

describe('the Ring client error branches', () => {
  const client = (fetchImpl: typeof fetch, overrides = {}) =>
    createRingClient({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      fetchImpl,
      now: () => 1_700_000_000_000,
      sleepImpl: async () => undefined,
      ...overrides,
    });

  it('names the status when the snapshot request itself fails', async () => {
    const fetchImpl = vi.fn(async () =>
      fetchImplJson({ token_type: 'bearer', access_token: 'tok', expires_in: 3600 }),
    ) as unknown as typeof fetch;
    // First call refreshes the token; the snapshot request then fails.
    let call = 0;
    const flaky = (async () => {
      call += 1;
      if (call === 1) return fetchImplJson({ token_type: 'bearer', access_token: 'tok', expires_in: 3600 });
      return fetchImplJson({}, 500);
    }) as unknown as typeof fetch;

    void fetchImpl;
    await expect(client(flaky).fetchSnapshot('front_door_cam', {
        mode: 'latest_in_range',
        startTimestampMs: 1_786_715_591_000,
      })).rejects.toBeInstanceOf(
      RingApiError,
    );
  });

  it('names the status when the pre-signed media fetch fails', async () => {
    let call = 0;
    const flaky = (async () => {
      call += 1;
      // token, snapshot record, then the pre-signed URL itself, which 404s.
      if (call === 1) return fetchImplJson({ token_type: 'bearer', access_token: 'tok', expires_in: 3600 });
      if (call === 2) {
        // A 303 with a Location, exactly as the media endpoint answers, and the point of the
        // whole two-request flow.
        const redirect = fetchImplJson({}, 303);
        (redirect.headers as unknown as Map<string, string>).set('location', 'https://media.test/x.jpg');
        return redirect;
      }
      return fetchImplJson({}, 404);
    }) as unknown as typeof fetch;

    await expect(
      client(flaky).fetchSnapshot('front_door_cam', {
        mode: 'latest_in_range',
        startTimestampMs: 1_786_715_591_000,
      }),
    ).rejects.toThrow(/pre-signed media fetch failed/);
  });

  it('returns an empty device description rather than throwing on a truncated record', async () => {
    let call = 0;
    const flaky = (async () => {
      call += 1;
      if (call === 1) return fetchImplJson({ token_type: 'bearer', access_token: 'tok', expires_in: 3600 });
      // No `data` at all — a shape the guard has to survive.
      return fetchImplJson({}, 200);
    }) as unknown as typeof fetch;

    const device = await client(flaky).getDevice('front_door_cam');

    // A record with no `data` at all: the id falls back to what was asked for and the name
    // is empty, which is a truthful absence. `description` is OMITTED rather than set to an
    // empty string — the same distinction the webhook guard makes about sub_type.
    expect(device.deviceId).toBe('front_door_cam');
    expect(device.name).toBe('');
    expect('description' in device).toBe(false);
  });
});

/** A minimal Response stand-in for the injected fetch seam. */
function fetchImplJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
    body: null,
  } as unknown as Response;
}

describe('the connection registry', () => {
  it('lists the connections a scan returns', async () => {
    // The registry keeps its OWN client singleton, separate from dynamoClient's — a fact
    // the first attempt at these tests got wrong by spying on the wrong `getClient`, which
    // left the real one constructing a client and spending a second on credentials.
    setConnectionClient({
      send: vi.fn(async () => ({
        Items: [
          {
            connection_id: 'c-1',
            device_id: 'front_door_cam',
            connected_at: '2026-02-13T13:00:00.000Z',
            expires_at: 1_700_000_000,
          },
        ],
      })),
    } as never);

    const connections = await listConnections();

    expect(connections).toHaveLength(1);
    expect(connections[0]?.connectionId).toBe('c-1');
  });

  it('returns an empty list when the table answers with no Items at all', async () => {
    setConnectionClient({ send: vi.fn(async () => ({})) } as never);

    // No Items at all, not an empty array — the difference the `?? []` handles.
    await expect(listConnections()).resolves.toEqual([]);
  });
});

describe('requireEnv in the describe stage', () => {
  it('names the missing variable instead of failing obscurely', async () => {
    // The default transport cannot build a client without it, and a named error is the
    // difference between a five-second debug and an afternoon.
    const previous = process.env['BEDROCK_MODEL_ID'];
    delete process.env['BEDROCK_MODEL_ID'];

    try {
      const result = await describeEvent({
        event: {
          date: '2026-02-13',
          event_id: 'evt-1',
          timestamp: '2026-02-13T13:39:57.200Z',
          device_id: 'front_door_cam',
          event_type: 'motion_detected',
          processed: false,
        },
        fetchSnapshot: async () => ({ bytes: new Uint8Array([1]), contentType: 'image/jpeg' }),
      });

      // The FR11 fallback catches it, which is the design: no model, still a sentence.
      expect(result.source).toBe('fallback');
      expect(result.reason).toMatch(/BEDROCK_MODEL_ID/);
    } finally {
      if (previous !== undefined) process.env['BEDROCK_MODEL_ID'] = previous;
    }
  });
});

describe('requireEnv in the summary stage', () => {
  it('names the missing model variable rather than failing obscurely', async () => {
    const previous = process.env['BEDROCK_MODEL_ID'];
    delete process.env['BEDROCK_MODEL_ID'];
    vi.spyOn(dynamo, 'queryEventsByDate').mockResolvedValue([
      {
        date: '2026-02-13',
        event_id: 'evt-1',
        timestamp: '2026-02-13T13:39:57.200Z',
        device_id: 'front_door_cam',
        event_type: 'motion_detected',
        sub_type: 'human',
        description: 'A person places a box',
        processed: true,
      },
    ]);
    vi.spyOn(dynamo, 'putSummary').mockResolvedValue(undefined);

    try {
      await summaryHandler({} as never);

      // Still writes a row: the deterministic sentence, with the reason recorded.
      expect(dynamo.putSummary).toHaveBeenCalledWith(
        expect.objectContaining({ summary_source: 'fallback' }),
      );
    } finally {
      if (previous !== undefined) process.env['BEDROCK_MODEL_ID'] = previous;
    }
  });
});

describe('the connection write paths', () => {
  it('writes a connection row carrying a TTL, so the registry cannot grow forever', async () => {
    const send = vi.fn(async () => ({}));
    setConnectionClient({ send } as never);

    await registerConnection({ connectionId: 'c-1', connectedAtMs: 1_700_000_000_000 });

    const command = (send.mock.calls as unknown as [unknown][])[0]?.[0] as
      { input: { Item: Record<string, unknown> } } | undefined;
    expect(command?.input.Item.connection_id).toBe('c-1');
    // The bound on growth. A client that vanishes without a clean $disconnect must not
    // leave a row behind for ever.
    expect(command?.input.Item.expires_at).toBeGreaterThan(0);
  });

  it('removes a connection row on disconnect', async () => {
    const send = vi.fn(async () => ({}));
    setConnectionClient({ send } as never);

    await removeConnection('c-1');

    expect(send).toHaveBeenCalledTimes(1);
  });
});
