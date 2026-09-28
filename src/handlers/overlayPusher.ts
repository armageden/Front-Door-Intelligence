/**
 * Overlay delivery stage: push the finished description to connected Fire TV clients.
 *
 * Consumes a second queue, downstream of the describe stage. FR6 asks for delivery
 * within 8 seconds of the original event, and this stage is the last hop before the
 * user sees anything.
 *
 * Three entry points, all in this module because they share the connection registry:
 *
 * - `handler` — the SQS consumer that does the pushing.
 * - `onConnect` / `onDisconnect` — API Gateway's `$connect` and `$disconnect` routes.
 *   These are not optional extras: API Gateway owns the socket, and the connection id
 *   is only ever delivered here, so without them nothing can ever be pushed.
 */

import type {
  APIGatewayProxyWebsocketEventV2,
  SQSEvent,
  SQSHandler,
} from 'aws-lambda';

/**
 * The `$connect` / `$disconnect` response shape.
 *
 * Deliberately not `APIGatewayProxyResultV2`, which is a union that includes a bare
 * string and therefore forces every caller to narrow. A WebSocket route answer is
 * exactly a status code and a body.
 */
export interface WsRouteResult {
  readonly statusCode: number;
  readonly body: string;
}

import { listConnections, registerConnection, removeConnection } from '../lib/connectionStore';
import { createOverlayPush, createPoster, pushToConnections } from '../lib/overlayPush';
import { SNAPSHOT_BUCKET_ENV } from '../lib/snapshotStore';
import { getEvent } from '../lib/dynamoClient';
import type { DoorEvent } from '../types';

/** `WEBSOCKET_ENDPOINT`, the API Gateway Management API endpoint. */
export const WS_ENDPOINT_ENV = 'WEBSOCKET_ENDPOINT';

export interface PushDeps {
  readonly loadEvent: (date: string, eventId: string, timestamp: string) => Promise<DoorEvent | undefined>;
  readonly listConnections: () => Promise<{ connectionId: string }[]>;
  readonly removeConnection: (connectionId: string) => Promise<void>;
  readonly postToConnection: (input: { connectionId: string; data: string }) => Promise<void>;
  readonly presign?: (key: string) => Promise<string>;
  readonly bucket: string;
}

/**
 * Deliver one event.
 *
 * Returns a reason rather than throwing for every expected condition, so a skipped
 * message is visible in logs instead of being retried into the DLQ for a problem that
 * will not resolve itself.
 */
export async function deliverEvent(
  event: DoorEvent,
  deps: PushDeps,
): Promise<{ status: 'delivered' | 'skipped'; reason?: string; delivered?: number; pruned?: string[] }> {
  if (!event.description) return { status: 'skipped', reason: 'no description on the event' };
  if (!event.snapshot_s3_key) {
    return { status: 'skipped', reason: 'no snapshot stored, and the payload requires one' };
  }

  const connections = await deps.listConnections();
  if (connections.length === 0) {
    // Not a failure. No Fire TV is connected right now, which is a normal state for a
    // doorbell product rather than an error worth redelivering.
    return { status: 'skipped', reason: 'no connected clients' };
  }

  const push = createOverlayPush({
    bucket: deps.bucket,
    postToConnection: deps.postToConnection,
    ...(deps.presign !== undefined ? { presign: deps.presign } : {}),
  });
  const message = await push.buildMessage(event);
  if (!message) return { status: 'skipped', reason: 'payload could not be built' };

  const result = await pushToConnections(
    message,
    connections,
    deps.postToConnection,
    (connectionId) => deps.removeConnection(connectionId),
  );

  return {
    status: 'delivered',
    delivered: result.delivered,
    ...(result.pruned.length > 0 ? { pruned: result.pruned } : {}),
  };
}

/** SQS entry point. */
export const handler: SQSHandler = async (event: SQSEvent) => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  const deps: PushDeps = {
    loadEvent: (date, eventId, timestamp) => getEvent(date, eventId, timestamp),
    listConnections: () => listConnections(),
    removeConnection: (connectionId) => removeConnection(connectionId),
    postToConnection: createPoster(process.env[WS_ENDPOINT_ENV] ?? ''),
    ...(process.env[SNAPSHOT_BUCKET_ENV] !== undefined
      ? { bucket: process.env[SNAPSHOT_BUCKET_ENV] as string }
      : { bucket: '' }),
  };

  for (const record of event.Records) {
    const itemIdentifier = record.messageId;
    if (!itemIdentifier) continue;
    try {
      const message = JSON.parse(record.body) as {
        date: string;
        event_id: string;
        timestamp: string;
      };
      const stored = await deps.loadEvent(message.date, message.event_id, message.timestamp);
      if (!stored) {
        console.warn('overlay stage skipped a message', { messageId: record.messageId, reason: 'event not in the table' });
        continue;
      }
      const outcome = await deliverEvent(stored, deps);
      if (outcome.status === 'skipped') {
        console.warn('overlay stage skipped an event', {
          event_id: stored.event_id,
          reason: outcome.reason,
        });
        continue;
      }
      if (outcome.pruned && outcome.pruned.length > 0) {
        console.info('pruned stale connections', { count: outcome.pruned.length });
      }
    } catch (error) {
      console.error('overlay stage failed', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({ itemIdentifier });
    }
  }

  return { batchItemFailures };
};

/**
 * API Gateway `$connect`.
 *
 * The connection id arrives here and nowhere else, so this is where the socket becomes
 * pushable. Failing this registration would produce a client that believes it is
 * connected and silently receives nothing, so the error is surfaced rather than
 * swallowed.
 */
export const onConnect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<WsRouteResult> => {
  const connectionId = event.requestContext.connectionId;
  const deviceId = event.queryStringParameters?.['device_id'];
  try {
    await registerConnection({
      connectionId,
      ...(deviceId !== undefined ? { deviceId } : {}),
      connectedAtMs: Date.now(),
    });
    return { statusCode: 200, body: 'registered' };
  } catch (error) {
    console.error('connect registration failed', {
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { statusCode: 500, body: 'registration failed' };
  }
};

/** API Gateway `$disconnect`. */
export const onDisconnect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<WsRouteResult> => {
  const connectionId = event.requestContext.connectionId;
  try {
    await removeConnection(connectionId);
    return { statusCode: 200, body: 'removed' };
  } catch (error) {
    // A failed removal is harmless: the row has a TTL and a later push will prune it on
    // GoneException. Returning 200 avoids pointless API Gateway retries.
    console.warn('disconnect cleanup failed', {
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { statusCode: 200, body: 'ignored' };
  }
};
