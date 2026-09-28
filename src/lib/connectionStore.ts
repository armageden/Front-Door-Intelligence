/**
 * WebSocket connection registry.
 *
 * API Gateway WebSocket connections are owned by API Gateway, not by the Lambda. When a
 * client connects, the `$connect` route handler is told the connection id and is
 * responsible for remembering it, because the only way to push later is
 * `PostToConnection` with that id.
 *
 * So the registry is not an optimisation. It is the entire mechanism.
 *
 * A separate DynamoDB table rather than a Lambda-global array, because Lambda
 * invocations are stateless: two instances would each hold half the connections and
 * neither would know about the other's. `ARCHITECTURE.md` §11 does not list this table,
 * which is a gap in the plan rather than a departure from it — recorded as decision
 * D020.
 *
 * Connections carry a TTL so a registry cannot grow without bound from clients that
 * vanished without a clean `$disconnect`.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { DocClient } from './dynamoClient';

/** `CONNECTIONS_TABLE`, added by this module. */
export const CONNECTIONS_TABLE_ENV = 'CONNECTIONS_TABLE';

/**
 * How long a connection row survives without a heartbeat.
 *
 * API Gateway sends no ping we can observe, so this is a backstop: it bounds growth, and
 * `PostToConnection` failing with `GoneException` is treated as a stale row and pruned
 * on the spot. The value is generous because the real signal is that failure, not
 * elapsed time.
 */
export const CONNECTION_TTL_SECONDS = 24 * 60 * 60;

export interface RegisteredConnection {
  readonly connectionId: string;
  /** Set on connect; lets a future version target one device rather than all of them. */
  readonly deviceId?: string;
  readonly connectedAtMs: number;
}

let cached: DocClient | undefined;

function client(): DocClient {
  if (!cached) {
    cached = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return cached;
}

/** Test seam: replace the singleton. */
export function setClient(next: DocClient | undefined): void {
  cached = next;
}

function tableName(): string {
  const name = process.env[CONNECTIONS_TABLE_ENV];
  if (!name) throw new Error(`Missing required environment variable: ${CONNECTIONS_TABLE_ENV}`);
  return name;
}

export async function registerConnection(
  connection: RegisteredConnection,
  doc: DocClient = client(),
): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        connection_id: connection.connectionId,
        ...(connection.deviceId !== undefined ? { device_id: connection.deviceId } : {}),
        connected_at_ms: connection.connectedAtMs,
        expires_at: Math.floor(connection.connectedAtMs / 1000) + CONNECTION_TTL_SECONDS,
      },
    }),
  );
}

export async function removeConnection(
  connectionId: string,
  doc: DocClient = client(),
): Promise<void> {
  await doc.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { connection_id: connectionId },
    }),
  );
}

/** Every connection currently believed live. */
export async function listConnections(
  doc: DocClient = client(),
): Promise<RegisteredConnection[]> {
  const response = (await doc.send(
    new QueryCommand({ TableName: tableName() }),
  )) as { Items?: Record<string, unknown>[] };
  return (response.Items ?? []).map((item) => ({
    connectionId: String(item['connection_id']),
    ...(item['device_id'] !== undefined ? { deviceId: String(item['device_id']) } : {}),
    connectedAtMs: Number(item['connected_at_ms'] ?? 0),
  }));
}
