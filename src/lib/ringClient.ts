/**
 * Ring Partner API client: OAuth token lifecycle, device lookup, and image snapshots.
 *
 * Every fact here was verified against
 * https://developer.amazon.com/docs/ring/api-documentation.html on 2026-09-28.
 * Two things that specification gets wrong, and that this module must not copy:
 *
 * - The snapshot call is **not** `GET /camera/{id}/snapshot`. It is
 *   `POST /v1/devices/{id}/media/image/download`, which answers **303** with a
 *   pre-signed `Location` to fetch in a second request.
 * - The architecture document's webhook payload is unrelated to this module, but its
 *   `data.attributes.timestamp` is what drives `at_timestamp` snapshot requests.
 *
 * ## Not verified
 *
 - **The exact signal for TAKE / E2EE encrypted media is unknown.** The docs say such
 *   devices "return encrypted content" without specifying a status code or content
 *   type. This module does not guess at a code. It checks that the response actually
 *   is an image and raises {@link EncryptedMediaError} if not, which is the honest
 *   generalisation: we asked for an image and did not get one.
 * - There is no documented webhook simulator, so nothing in this module has been
 *   exercised against live Ring infrastructure.
 */

import { setTimeout as delay } from 'node:timers/promises';

/** Verified: the current Ring API surface. Older docs and code may say "AVA". */
export const DEFAULT_API_BASE_URL = 'https://api.amazonvision.com';
export const DEFAULT_OAUTH_URL = 'https://oauth.ring.com/oauth/token';

/** Access tokens last ~4 hours. Refresh well before that. */
export const DEFAULT_TOKEN_EXPIRY_SECONDS = 4 * 60 * 60;

/** Refresh tokens last ~30 days. */
export const REFRESH_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** Verified global limit: 100 requests/second per partner `client_id`. */
export const RATE_LIMIT_TPS = 100;

/**
 * Total attempts for a retried request, including the first.
 *
 * Kept honest deliberately: the retry condition is `attempt < MAX_ATTEMPTS - 1`, so
 * this number is the number of requests actually made. A constant that counts retries
 * while being named "attempts" is the kind of off-by-one that hides until a 429 loop
 * costs four times the expected requests.
 */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Subtract this from token expiry so a token cannot expire mid-flight. */
export const TOKEN_EXPIRY_SKEW_SECONDS = 60;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type SleepLike = (ms: number) => Promise<unknown>;

export interface RingClientOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** Injected for tests. Defaults to global `fetch`. */
  readonly fetchImpl?: FetchLike;
  readonly sleepImpl?: SleepLike;
  readonly now?: () => number;
  readonly apiBaseUrl?: string;
  readonly oauthUrl?: string;
  /** Image width/height. The watermark is fixed-pixel, so full size keeps it small. */
  readonly imageWidth?: number;
  readonly imageHeight?: number;
}

/* ------------------------------------------------------------------- errors */

export class RingApiError extends Error {
  readonly statusCode: number;
  readonly body: string;

  constructor(statusCode: number, body: string, message?: string) {
    super(message ?? `Ring API returned ${statusCode}`);
    this.name = 'RingApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

/** 425 — the request beat the recording. Retry with a later window. */
export class SnapshotNotReadyError extends Error {
  constructor(message = 'Ring has no media for that window yet') {
    super(message);
    this.name = 'SnapshotNotReadyError';
  }
}

/**
 * The response was not an image. On a TAKE or E2EE account the documented behaviour is
 * that media comes back encrypted, so this is the signal to degrade to the FR11
 * deterministic summary rather than to retry.
 */
export class EncryptedMediaError extends Error {
  readonly receivedContentType: string | undefined;

  constructor(receivedContentType: string | undefined) {
    super(
      `expected image media, received ${receivedContentType ?? 'no content-type'}. ` +
        'Probable TAKE/E2EE encrypted media — degrade rather than retry.',
    );
    this.name = 'EncryptedMediaError';
    this.receivedContentType = receivedContentType;
  }
}

/* ------------------------------------------------------------------- types */

export interface RingDevice {
  readonly deviceId: string;
  readonly name: string;
  readonly description?: string;
}

export interface SnapshotResult {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** From the 303 response's `X-Media-Timestamp`, when present. */
  readonly mediaTimestamp?: string;
  /** `recording` or `snapshot`, from `X-Media-Origin`. */
  readonly origin?: string;
}

export type SnapshotRequest =
  | { readonly mode: 'at_timestamp'; readonly timestampMs: number; readonly componentId?: string }
  | { readonly mode: 'latest_in_range'; readonly startTimestampMs: number; readonly endTimestampMs?: number; readonly componentId?: string };

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/* ------------------------------------------------------------------- client */

export function createRingClient(options: RingClientOptions) {
  const {
    clientId,
    clientSecret,
    refreshToken,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    oauthUrl = DEFAULT_OAUTH_URL,
    imageWidth = 1920,
    imageHeight = 1080,
  } = options;

  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleepImpl: SleepLike = options.sleepImpl ?? ((ms) => delay(ms));
  const now: () => number = options.now ?? (() => Date.now());

  let cached: CachedToken | undefined;

  /**
   * Exchange the refresh token for an access token.
   *
   * Verified: `POST https://oauth.ring.com/oauth/token` with
   * `grant_type=refresh_token`. Refresh tokens last ~30 days and access tokens ~4
   * hours.
   *
   * **A refresh token is not a bearer token.** The docs are explicit that placing one
   * in an `Authorization: Bearer` header yields 401, so the two are kept strictly
   * separate here — `getAccessToken()` always runs before any API call.
   */
  async function refreshAccessToken(): Promise<CachedToken> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetchImpl(oauthUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new RingApiError(response.status, await safeText(response), 'token refresh failed');
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new RingApiError(response.status, '', 'token refresh response had no access_token');
    }

    const ttl = payload.expires_in ?? DEFAULT_TOKEN_EXPIRY_SECONDS;
    return {
      accessToken: payload.access_token,
      // Skewed so a token cannot expire between the check and the request it guards.
      expiresAtMs: now() + (ttl - TOKEN_EXPIRY_SKEW_SECONDS) * 1000,
    };
  }

  /** Cached access token, refreshed when within the skew window of expiry. */
  async function getAccessToken(): Promise<string> {
    if (cached && cached.expiresAtMs > now()) return cached.accessToken;
    cached = await refreshAccessToken();
    return cached.accessToken;
  }

  /**
   * One authenticated request with 401-retry and 429 backoff.
   *
   * Verified: 100 TPS per `client_id`; on 429 back off exponentially from 1s and
   * honour `Retry-After`. A 401 triggers exactly one token refresh and retry, since a
   * 401 on a fresh token is a real auth failure rather than a stale one.
   */
  async function request(
    path: string,
    init: RequestInit = {},
    attempt = 0,
  ): Promise<Response> {
    const token = await getAccessToken();
    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
    });

    if (response.status === 401 && attempt === 0) {
      cached = undefined;
      return request(path, init, attempt + 1);
    }

    if (response.status === 429 && attempt < DEFAULT_MAX_ATTEMPTS - 1) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1000 * 2 ** attempt;
      await sleepImpl(waitMs);
      return request(path, init, attempt + 1);
    }

    return response;
  }

  /** `GET /v1/devices/{id}` — the only way to learn a device name. */
  async function getDevice(deviceId: string): Promise<RingDevice> {
    const response = await request(`/v1/devices/${encodeURIComponent(deviceId)}`);
    if (!response.ok) {
      throw new RingApiError(response.status, await safeText(response), 'device lookup failed');
    }
    const payload = (await response.json()) as {
      data?: { id?: string; attributes?: { name?: string; description?: string } };
    };
    const attributes = payload.data?.attributes ?? {};
    return {
      deviceId: payload.data?.id ?? deviceId,
      // Ring omits `name` on some device records. Empty is a truthful absence.
      name: attributes.name ?? '',
      ...(attributes.description !== undefined ? { description: attributes.description } : {}),
    };
  }

  function snapshotBody(request: SnapshotRequest): Record<string, unknown> {
    const base: Record<string, unknown> = {
      type: request.mode,
      image_options: { format: 'jpeg', resolution: { width: imageWidth, height: imageHeight } },
    };
    if (request.mode === 'at_timestamp') base['timestamp'] = request.timestampMs;
    if (request.mode === 'latest_in_range') {
      base['start_timestamp'] = request.startTimestampMs;
      if (request.endTimestampMs !== undefined) base['end_timestamp'] = request.endTimestampMs;
    }
    // `components` is required on Ring Elite; without it the camera module is chosen
    // non-deterministically. Only sent when the caller knows which module to ask for.
    if (request.componentId !== undefined) {
      base['components'] = [{ component_id: request.componentId }];
    }
    return base;
  }

  /**
   * Fetch a camera image.
   *
   * Two requests, per the verified flow: a POST that answers **303** with a
   * pre-signed `Location`, then a GET of that URL. `redirect: 'manual'` is used so the
   * metadata headers on the 303 are not lost to an automatic follow.
   *
   * The parameter is named `snapshot` rather than `request` because the inner
   * `request()` function would otherwise be shadowed by it.
   */
  async function fetchSnapshot(
    deviceId: string,
    snapshot: SnapshotRequest,
  ): Promise<SnapshotResult> {
    const response = await request(`/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshotBody(snapshot)),
    });

    // 425 means the window is ahead of the recording. Not retryable here: the caller
    // needs a different timestamp, and blindly retrying the same window cannot help.
    if (response.status === 425) throw new SnapshotNotReadyError();
    if (response.status === 416) {
      throw new RingApiError(response.status, await safeText(response), 'no media for that window');
    }
    if (response.status !== 303) {
      throw new RingApiError(response.status, await safeText(response), 'snapshot request failed');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new RingApiError(response.status, '', '303 response had no Location header');
    }

    const mediaTimestamp = response.headers.get('x-media-timestamp') ?? undefined;
    const origin = response.headers.get('x-media-origin') ?? undefined;

    // The pre-signed URL is a plain S3 URL and carries no Ring bearer token.
    const media = await fetchImpl(location, { method: 'GET' });
    if (!media.ok) {
      throw new RingApiError(media.status, await safeText(media), 'pre-signed media fetch failed');
    }

    const contentType = media.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      throw new EncryptedMediaError(contentType || undefined);
    }

    const bytes = new Uint8Array(await media.arrayBuffer());
    return {
      bytes,
      contentType,
      ...(mediaTimestamp !== undefined ? { mediaTimestamp } : {}),
      ...(origin !== undefined ? { origin } : {}),
    };
  }

  return {
    getAccessToken,
    refreshAccessToken,
    getDevice,
    fetchSnapshot,
    /** Test seam: drop the cached token so the next call re-authenticates. */
    invalidateToken: () => {
      cached = undefined;
    },
  };
}

export type RingClient = ReturnType<typeof createRingClient>;

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}
