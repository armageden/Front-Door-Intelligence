/**
 * Overlay delivery: building the message and pushing it to connected Fire TV clients.
 *
 * This module is the **delivery** half of `ARCHITECTURE.md` §3.4. It puts a message on
 * the wire. It does not, and cannot, decide how the Fire TV app draws it.
 *
 * ## Why that distinction is load-bearing
 *
 * `ARCHITECTURE.md` §3.4 specifies a picture-in-picture overlay that appears over
 * whatever the user is watching without interrupting playback. Verified against the Vega
 * OS documentation on 2026-09-28:
 *
 * - There is **no system-level overlay, picture-in-picture, or heads-up API** anywhere
 *   in the 38 documented Vega APIs. Overlaying *another app's* video is not achievable
 *   with any documented API.
 * - Overlaying **your own** video surface works, but only via a transparent
 *   `@amazon-devices/webview` WebView as a sibling of `KeplerVideoSurfaceView`.
 *   React Native `zIndex` and `elevation` **do not** reach the hardware video layer.
 * - The closest system surface, `useToastKepler`, is text-and-icon with a fixed
 *   SHORT/LONG duration, which cannot express FR14's 15-second auto-dismiss.
 *
 * So the payload below is specified and implementable; the rendering is not, and is
 * blocked on the track decision. See
 * docs/05-hackathon-requirements/05-fire-tv-vega-findings.md and decision D021.
 *
 * What the app *can* do today with this payload is entirely useful: fetch
 * `snapshot_url`, show the sentence as a toast, and trigger a content-launch deep link.
 * That is a real demo, not a consolation prize.
 */

import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from '@aws-sdk/client-apigatewaymanagementapi';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { DoorEvent } from '../types';

/** `ARCHITECTURE.md` §3.4 payload, verbatim. */
export interface OverlayMessage {
  readonly event_id: string;
  readonly description: string;
  readonly snapshot_url: string;
  readonly timestamp: string;
  readonly device_name: string;
}

/** `ARCHITECTURE.md` §6: pre-signed URLs expire after one hour. */
export const PRESIGNED_URL_TTL_SECONDS = 3600;

/**
 * Build a pre-signed GET URL for a stored snapshot.
 *
 * The one place that signs snapshot URLs, shared by the delivery stage and the query
 * path (FR8) so the two cannot drift on expiry or on which client is used. It lives
 * here rather than in its own module because this is where the S3 presigner already
 * lives, and because `createOverlayPush` consumes it directly below.
 *
 * Injected in tests; defaults to a real `S3Client` presigner.
 */
export function createSnapshotPresigner(
  bucket: string,
  presign?: (key: string) => Promise<string>,
): (key: string) => Promise<string> {
  if (presign) return presign;
  return async (key: string) => {
    const client = new S3Client({});
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
    });
  };
}

export type PostToConnectionLike = (input: {
  connectionId: string;
  data: string;
}) => Promise<void>;

export interface OverlayPushOptions {
  readonly bucket: string;
  readonly postToConnection: PostToConnectionLike;
  /** Injected in tests; defaults to a real S3 presigner. */
  readonly presign?: (key: string) => Promise<string>;
}

export type PushOutcome = 'delivered' | 'no_connections' | 'all_stale';

export interface PushResult {
  readonly outcome: PushOutcome;
  readonly delivered: number;
  /** Connection ids API Gateway reported as gone. Pruned so the registry self-heals. */
  readonly pruned: string[];
}

export function createOverlayPush(options: OverlayPushOptions) {
  const { bucket, postToConnection } = options;

  const presign = createSnapshotPresigner(bucket, options.presign);

  /**
   * Build the §3.4 payload.
   *
   * `snapshot_url` is required by the contract, so an event with no stored snapshot
   * cannot produce a valid message. That is reported as a null return rather than an
   * empty string, because a payload with `snapshot_url: ""` is worse than no payload: the
   * client would render a broken image and look broken.
   */
  async function buildMessage(event: DoorEvent): Promise<OverlayMessage | null> {
    if (!event.description) return null;
    if (!event.snapshot_s3_key) return null;
    return {
      event_id: event.event_id,
      description: event.description,
      snapshot_url: await presign(event.snapshot_s3_key),
      timestamp: event.timestamp,
      // §3.4 names this field. Ring sends no device name in any webhook, so it is
      // resolved during enrichment; when it is still unknown the event's device id is
      // the most truthful thing available.
      device_name: event.device_name ?? event.device_id,
    };
  }

  return { buildMessage, presign };
}

/**
 * Push a message to every connection, pruning the ones API Gateway has forgotten.
 *
 * `GoneException` is the documented signal that a socket is closed. It is handled per
 * connection rather than aborting the batch: one dead Fire TV must not stop the
 * description reaching the others.
 */
export async function pushToConnections(
  message: OverlayMessage,
  connections: readonly { connectionId: string }[],
  postToConnection: PostToConnectionLike,
  onStale?: (connectionId: string) => Promise<void>,
): Promise<PushResult> {
  if (connections.length === 0) return { outcome: 'no_connections', delivered: 0, pruned: [] };

  const data = JSON.stringify(message);
  const pruned: string[] = [];
  let delivered = 0;

  for (const connection of connections) {
    try {
      await postToConnection({ connectionId: connection.connectionId, data });
      delivered++;
    } catch (error) {
      if (isGone(error)) {
        pruned.push(connection.connectionId);
        if (onStale) await onStale(connection.connectionId);
        continue;
      }
      // Anything else is a real error. Surface it rather than counting a silent
      // success, which is the failure mode this whole module exists to avoid.
      throw error;
    }
  }

  return {
    outcome: delivered === 0 ? 'all_stale' : 'delivered',
    delivered,
    pruned,
  };
}

function isGone(error: unknown): boolean {
  return error instanceof GoneException || (error as { name?: string })?.name === 'GoneException';
}

/** Default `postToConnection`, built on the API Gateway Management API. */
export function createPoster(endpoint: string): PostToConnectionLike {
  const client = new ApiGatewayManagementApiClient({ endpoint });
  return async ({ connectionId, data }) => {
    await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
  };
}
