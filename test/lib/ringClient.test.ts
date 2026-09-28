/**
 * Tests for the Ring Partner API client.
 *
 * No network. `fetchImpl`, `sleepImpl`, and `now` are all injected, so token
 * expiry, 429 backoff, and the two-request snapshot flow are exercised without
 * waiting on real time.
 *
 * The payload assertions come from the verified API documentation, not from
 * ARCHITECTURE.md — which specifies `GET /camera/{id}/snapshot`, an endpoint that
 * does not exist.
 */

import { describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import {
  DEFAULT_MAX_ATTEMPTS,
  EncryptedMediaError,
  REFRESH_TOKEN_LIFETIME_SECONDS,
  RingApiError,
  SnapshotNotReadyError,
  TOKEN_EXPIRY_SKEW_SECONDS,
  createRingClient,
} from '../../src/lib/ringClient';
import type { FetchLike } from '../../src/lib/ringClient';

const CLIENT_ID = 'partner_client_id';
const CLIENT_SECRET = 'partner_client_secret';
const REFRESH_TOKEN = 'partner_refresh_token';
const DEVICE_ID = 'front_door_cam';
const PRE_SIGNED = 'https://s3.example.com/snapshot.jpg?X-Amz-Signature=abc';

/** Kept in one place so the stub matches on equality, not a fragile substring. */
const OAUTH_URL = 'https://oauth.test/oauth/token';
const API_BASE = 'https://api.test';

interface StubCall {
  url: string;
  init: RequestInit | undefined;
}

interface Stub {
  fetchImpl: FetchLike;
  calls: StubCall[];
  sleep: MockInstance<(ms: number) => Promise<unknown>>;
}

/** A minimal Response stand-in; only the surface this client touches. */
function reply(
  status: number,
  opts: { json?: unknown; text?: string; headers?: Record<string, string>; bytes?: Uint8Array } = {},
): Response {
  const headers = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => opts.json,
    text: async () => opts.text ?? '',
    arrayBuffer: async () => (opts.bytes ?? new Uint8Array([1, 2, 3])).buffer,
  } as unknown as Response;
}

/** Token refresh succeeds, then the supplied handler answers API calls. */
function stub(handler: (call: StubCall, index: number) => Response): Stub {
  const calls: StubCall[] = [];
  // vitest's MockInstance is not directly assignable to SleepLike, so keep the spy for
  // assertions and hand the client a plain function that forwards to it.
  const sleepSpy = vi.fn<(ms: number) => Promise<unknown>>().mockResolvedValue(undefined);
  const sleep = (ms: number): Promise<unknown> => sleepSpy(ms);
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    if (url === OAUTH_URL) {
      return reply(200, { json: { access_token: 'access-token-1', expires_in: 14400 } });
    }
    return handler(call, calls.length - 1);
  };
  return { fetchImpl, calls, sleep: sleepSpy };
}

/**
 * The first API call. The OAuth token exchange always precedes it, so `calls[0]` is
 * the token POST and not the call under test.
 */
function firstApiCall(stubbed: Stub): StubCall {
  const call = stubbed.calls.find((c) => c.url.startsWith(API_BASE));
  if (!call) throw new Error('no API call was made');
  return call;
}

function client(stubbed: Stub, now = () => 1_000_000) {
  return createRingClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    refreshToken: REFRESH_TOKEN,
    fetchImpl: stubbed.fetchImpl,
    sleepImpl: stubbed.sleep as unknown as (ms: number) => Promise<unknown>,
    now,
    apiBaseUrl: API_BASE,
    oauthUrl: OAUTH_URL,
  });
}

describe('token lifecycle', () => {
  it('posts a refresh_token grant to the OAuth endpoint', async () => {
    const stubbed = stub(() => reply(200, { json: {} }));
    await client(stubbed).getAccessToken();

    const tokenCall = stubbed.calls[0]!;
    expect(tokenCall.url).toBe(OAUTH_URL);
    expect(tokenCall.init?.method).toBe('POST');
    const body = new URLSearchParams(String(tokenCall.init?.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe(REFRESH_TOKEN);
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('client_secret')).toBe(CLIENT_SECRET);
  });

  it('caches the access token across calls', async () => {
    const stubbed = stub(() => reply(200, { json: {} }));
    const ring = client(stubbed);
    await ring.getAccessToken();
    await ring.getAccessToken();
    await ring.getAccessToken();
    expect(stubbed.calls.filter((c) => c.url === OAUTH_URL)).toHaveLength(1);
  });

  it('re-authenticates once the cached token is inside the skew window', async () => {
    let clock = 0;
    const stubbed = stub(() => reply(200, { json: {} }));
    const ring = client(stubbed, () => clock);

    await ring.getAccessToken();
    // Just under expiry: 14400s TTL minus the 60s skew.
    clock = (14400 - TOKEN_EXPIRY_SKEW_SECONDS) * 1000;
    await ring.getAccessToken();
    expect(stubbed.calls.filter((c) => c.url === OAUTH_URL)).toHaveLength(2);
  });

  it('sends the access token, never the refresh token, as the bearer', async () => {
    const stubbed = stub(() => reply(200, { json: { data: { id: DEVICE_ID, attributes: { name: 'Front Door' } } } }));
    await client(stubbed).getDevice(DEVICE_ID);

    const apiCall = stubbed.calls.find((c) => c.url.includes('/v1/devices/'))!;
    const auth = (apiCall.init?.headers as Record<string, string>).authorization!;
    expect(auth).toBe('Bearer access-token-1');
    // The failure the docs call out explicitly: a refresh token in a Bearer header 401s.
    expect(auth).not.toContain(REFRESH_TOKEN);
  });

  it('raises a named error when the refresh response omits access_token', async () => {
    const fetchImpl: FetchLike = async () => reply(200, { json: { expires_in: 100 } });
    const ring = createRingClient({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN,
      fetchImpl, apiBaseUrl: API_BASE, oauthUrl: OAUTH_URL,
    });
    await expect(ring.getAccessToken()).rejects.toThrow(/no access_token/);
  });

  it('records the verified token lifetimes as documented constants', () => {
    expect(REFRESH_TOKEN_LIFETIME_SECONDS).toBe(2_592_000);
  });
});

describe('getDevice', () => {
  it('returns the device name, which no webhook payload contains', async () => {
    const stubbed = stub(() =>
      reply(200, { json: { data: { id: DEVICE_ID, attributes: { name: 'Front Door', description: 'By the door' } } } }),
    );
    const device = await client(stubbed).getDevice(DEVICE_ID);
    expect(device).toEqual({ deviceId: DEVICE_ID, name: 'Front Door', description: 'By the door' });
  });

  it('encodes the device id into the path', async () => {
    const stubbed = stub(() => reply(200, { json: { data: { attributes: { name: 'x' } } } }));
    await client(stubbed).getDevice('front door/cam#1');
    expect(stubbed.calls.some((c) => c.url.includes('front%20door%2Fcam%231'))).toBe(true);
  });

  it('returns an empty name rather than inventing one when Ring omits it', async () => {
    const stubbed = stub(() => reply(200, { json: { data: { id: DEVICE_ID } } }));
    expect((await client(stubbed).getDevice(DEVICE_ID)).name).toBe('');
  });

  it('throws RingApiError with the status on failure', async () => {
    const stubbed = stub(() => reply(404, { text: 'device not found' }));
    await expect(client(stubbed).getDevice(DEVICE_ID)).rejects.toBeInstanceOf(RingApiError);
    await expect(client(stubbed).getDevice(DEVICE_ID)).rejects.toThrow(/device lookup failed/);
  });
});

describe('fetchSnapshot — the two-request flow', () => {
  function snapshotStub(mediaReply: () => Response) {
    return stub((call) => {
      if (call.url.endsWith('/media/image/download')) {
        return reply(303, {
          headers: {
            location: PRE_SIGNED,
            'x-media-timestamp': '2026-08-14T08:53:16Z',
            'x-media-origin': 'recording',
          },
        });
      }
      return mediaReply();
    });
  }

  it('POSTs to media/image/download and follows the 303 to the pre-signed URL', async () => {
    const stubbed = snapshotStub(() => reply(200, { headers: { 'content-type': 'image/jpeg' } }));
    const result = await client(stubbed).fetchSnapshot(DEVICE_ID, {
      mode: 'at_timestamp',
      timestampMs: 1786715596787,
    });

    const post = firstApiCall(stubbed);
    expect(post.url).toBe(`${API_BASE}/v1/devices/${DEVICE_ID}/media/image/download`);
    expect(post.init?.method).toBe('POST');
    // The next request is the pre-signed URL, with no Ring bearer token.
    const get = stubbed.calls[stubbed.calls.indexOf(post) + 1]!;
    expect(get.url).toBe(PRE_SIGNED);
    expect(get.init?.method).toBe('GET');
    expect(get.init?.headers).toBeUndefined();

    expect(result.contentType).toBe('image/jpeg');
    expect(result.mediaTimestamp).toBe('2026-08-14T08:53:16Z');
    expect(result.origin).toBe('recording');
    expect(result.bytes).toHaveLength(3);
  });

  it('sends the at_timestamp body the API documents', async () => {
    const stubbed = snapshotStub(() => reply(200, { headers: { 'content-type': 'image/jpeg' } }));
    await client(stubbed).fetchSnapshot(DEVICE_ID, { mode: 'at_timestamp', timestampMs: 1786715596787 });

    const body = JSON.parse(String(firstApiCall(stubbed).init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      type: 'at_timestamp',
      timestamp: 1786715596787,
      image_options: { format: 'jpeg', resolution: { width: 1920, height: 1080 } },
    });
  });

  it('sends latest_in_range with a start, and an end only when supplied', async () => {
    const open = snapshotStub(() => reply(200, { headers: { 'content-type': 'image/jpeg' } }));
    await client(open).fetchSnapshot(DEVICE_ID, { mode: 'latest_in_range', startTimestampMs: 1000 });
    let body = JSON.parse(String(firstApiCall(open).init?.body)) as Record<string, unknown>;
    expect(body['start_timestamp']).toBe(1000);
    expect(body).not.toHaveProperty('end_timestamp');

    const closed = snapshotStub(() => reply(200, { headers: { 'content-type': 'image/jpeg' } }));
    await client(closed).fetchSnapshot(DEVICE_ID, {
      mode: 'latest_in_range', startTimestampMs: 1000, endTimestampMs: 2000,
    });
    body = JSON.parse(String(firstApiCall(closed).init?.body)) as Record<string, unknown>;
    expect(body['end_timestamp']).toBe(2000);
  });

  it('includes components only when a module is known, as required on Ring Elite', async () => {
    const withModule = snapshotStub(() => reply(200, { headers: { 'content-type': 'image/jpeg' } }));
    await client(withModule).fetchSnapshot(DEVICE_ID, {
      mode: 'at_timestamp', timestampMs: 1, componentId: '0',
    });
    const body = JSON.parse(String(firstApiCall(withModule).init?.body)) as Record<string, unknown>;
    expect(body['components']).toEqual([{ component_id: '0' }]);

    const without = snapshotStub(() => reply(200, { headers: { 'content-type': 'image/jpeg' } }));
    await client(without).fetchSnapshot(DEVICE_ID, { mode: 'at_timestamp', timestampMs: 1 });
    const body2 = JSON.parse(String(firstApiCall(without).init?.body)) as Record<string, unknown>;
    expect(body2).not.toHaveProperty('components');
  });

  it('raises SnapshotNotReadyError on 425, which a same-window retry cannot fix', async () => {
    const stubbed = stub(() => reply(425, { text: 'RECORDING_NOT_READY' }));
    await expect(
      client(stubbed).fetchSnapshot(DEVICE_ID, { mode: 'at_timestamp', timestampMs: 1 }),
    ).rejects.toBeInstanceOf(SnapshotNotReadyError);
  });

  it('raises RingApiError on 416', async () => {
    const stubbed = stub(() => reply(416, { text: 'MEDIA_NOT_FOUND' }));
    await expect(
      client(stubbed).fetchSnapshot(DEVICE_ID, { mode: 'at_timestamp', timestampMs: 1 }),
    ).rejects.toMatchObject({ name: 'RingApiError', statusCode: 416 });
  });

  it('raises RingApiError when a 303 carries no Location', async () => {
    const stubbed = stub(() => reply(303, { headers: {} }));
    await expect(
      client(stubbed).fetchSnapshot(DEVICE_ID, { mode: 'at_timestamp', timestampMs: 1 }),
    ).rejects.toThrow(/no Location header/);
  });

  it('raises EncryptedMediaError when the response is not an image', async () => {
    // The documented TAKE/E2EE behaviour: media comes back encrypted, so the caller
    // must degrade to the FR11 fallback rather than retry.
    const stubbed = snapshotStub(() => reply(200, { headers: { 'content-type': 'application/octet-stream' } }));
    const error = await client(stubbed)
      .fetchSnapshot(DEVICE_ID, { mode: 'at_timestamp', timestampMs: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EncryptedMediaError);
    expect((error as EncryptedMediaError).receivedContentType).toBe('application/octet-stream');
  });

  it('raises EncryptedMediaError when no content-type is returned at all', async () => {
    const stubbed = snapshotStub(() => reply(200, { headers: {} }));
    await expect(
      client(stubbed).fetchSnapshot(DEVICE_ID, { mode: 'at_timestamp', timestampMs: 1 }),
    ).rejects.toBeInstanceOf(EncryptedMediaError);
  });
});

describe('retry policy', () => {
  it('refreshes the token once on 401 and retries', async () => {
    let apiCalls = 0;
    const stubbed = stub(() => {
      apiCalls++;
      return apiCalls === 1
        ? reply(401, { text: 'expired' })
        : reply(200, { json: { data: { id: DEVICE_ID, attributes: { name: 'Front Door' } } } });
    });

    const device = await client(stubbed).getDevice(DEVICE_ID);
    expect(device.name).toBe('Front Door');
    expect(stubbed.calls.filter((c) => c.url === OAUTH_URL)).toHaveLength(2);
  });

  it('does not retry a second consecutive 401', async () => {
    const stubbed = stub(() => reply(401, { text: 'forbidden' }));
    await expect(client(stubbed).getDevice(DEVICE_ID)).rejects.toMatchObject({ statusCode: 401 });
    // One refresh for the retry, and no second retry after that.
    expect(stubbed.calls.filter((c) => c.url === OAUTH_URL)).toHaveLength(2);
  });

  it('backs off on 429, honouring Retry-After', async () => {
    let apiCalls = 0;
    const stubbed = stub(() => {
      apiCalls++;
      return apiCalls === 1
        ? reply(429, { headers: { 'retry-after': '3' } })
        : reply(200, { json: { data: { attributes: { name: 'Front Door' } } } });
    });

    await client(stubbed).getDevice(DEVICE_ID);
    expect(stubbed.sleep).toHaveBeenCalledWith(3000);
  });

  it('falls back to exponential backoff when Retry-After is absent', async () => {
    let apiCalls = 0;
    const stubbed = stub(() => {
      apiCalls++;
      return apiCalls === 1
        ? reply(429, { headers: {} })
        : reply(200, { json: { data: { attributes: { name: 'Front Door' } } } });
    });

    await client(stubbed).getDevice(DEVICE_ID);
    expect(stubbed.sleep).toHaveBeenCalledWith(1000);
  });

  it('gives up after the documented maximum attempts', async () => {
    const stubbed = stub(() => reply(429, { headers: {} }));
    await expect(client(stubbed).getDevice(DEVICE_ID)).rejects.toMatchObject({ statusCode: 429 });
    const apiCalls = stubbed.calls.filter((c) => c.url.includes('/v1/devices/')).length;
    expect(apiCalls).toBe(DEFAULT_MAX_ATTEMPTS);
  });
});

describe('test seam', () => {
  it('invalidateToken forces re-authentication', async () => {
    const stubbed = stub(() => reply(200, { json: { data: { attributes: { name: 'x' } } } }));
    const ring = client(stubbed);
    await ring.getAccessToken();
    ring.invalidateToken();
    await ring.getAccessToken();
    expect(stubbed.calls.filter((c) => c.url === OAUTH_URL)).toHaveLength(2);
  });
});
