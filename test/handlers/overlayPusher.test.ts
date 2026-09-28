/**
 * Tests for the overlay delivery stage.
 *
 * Two behaviours carry the most weight and are asserted hardest:
 *
 * 1. **One dead socket must not stop delivery to the others.** A Fire TV that vanished
 *    without disconnecting would otherwise swallow the description for every other
 *    screen in the house.
 * 2. **A payload missing `snapshot_url` is not sent.** `ARCHITECTURE.md` §3.4 requires
 *    the field, and a message carrying an empty string renders as a broken image.
 *
 * No AWS, no network, no queue. Every dependency is injected.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { deliverEvent, onConnect, onDisconnect } from '../../src/handlers/overlayPusher';
import { setClient as setConnectionClient } from '../../src/lib/connectionStore';
import { createOverlayPush, pushToConnections, PRESIGNED_URL_TTL_SECONDS } from '../../src/lib/overlayPush';
import type { DoorEvent } from '../../src/types';
import type { PushDeps } from '../../src/handlers/overlayPusher';

const SNAPSHOT_KEY = 'snapshots/2026-02-13/evt_abc123.jpg';
const SIGNED = 'https://s3.test/snapshot.jpg?X-Amz-Signature=signed';

const EVENT: DoorEvent = {
  date: '2026-02-13',
  event_id: 'evt_abc123',
  timestamp: '2026-02-13T13:39:57.200Z',
  occurred_at_ms: 1786715596787,
  device_id: 'front_door_cam',
  device_name: 'Front Door',
  event_type: 'motion_detected',
  sub_type: 'human',
  description: 'A person places a medium box by the door',
  snapshot_s3_key: SNAPSHOT_KEY,
  processed: true,
};

beforeAll(() => {
  // The connect route writes to this table; without it every registration fails.
  process.env['CONNECTIONS_TABLE'] = 'FrontDoorConnections';
});

function goneError(): Error {
  const e = new Error('Gone');
  e.name = 'GoneException';
  return e;
}

function deps(overrides: Partial<PushDeps> = {}): PushDeps {
  return {
    loadEvent: vi.fn(async () => EVENT),
    listConnections: vi.fn(async () => [{ connectionId: 'conn-1' }]),
    removeConnection: vi.fn(async () => undefined),
    postToConnection: vi.fn(async () => undefined),
    presign: vi.fn(async () => SIGNED),
    bucket: 'front-door-snapshots',
    ...overrides,
  };
}

describe('the §3.4 payload', () => {
  it('carries exactly the five fields ARCHITECTURE.md 3.4 names', async () => {
    const push = createOverlayPush({
      bucket: 'b',
      postToConnection: async () => undefined,
      presign: async () => SIGNED,
    });
    const message = await push.buildMessage(EVENT);

    expect(Object.keys(message ?? {}).sort()).toEqual([
      'description',
      'device_name',
      'event_id',
      'snapshot_url',
      'timestamp',
    ]);
    expect(message?.description).toBe(EVENT.description);
    expect(message?.snapshot_url).toBe(SIGNED);
    expect(message?.device_name).toBe('Front Door');
  });

  it('signs the URL for one hour, as §6 requires', () => {
    expect(PRESIGNED_URL_TTL_SECONDS).toBe(3600);
  });

  it('returns null rather than an empty snapshot_url', async () => {
    const push = createOverlayPush({
      bucket: 'b',
      postToConnection: async () => undefined,
      presign: async () => SIGNED,
    });
    // An empty string would render as a broken image; no message is the honest answer.
    const { snapshot_s3_key: _omit, ...withoutKey } = EVENT;
    expect(await push.buildMessage(withoutKey as DoorEvent)).toBeNull();
  });

  it('returns null when the event has no description', async () => {
    const push = createOverlayPush({
      bucket: 'b',
      postToConnection: async () => undefined,
      presign: async () => SIGNED,
    });
    const { description: _omit, ...withoutDescription } = EVENT;
    expect(await push.buildMessage(withoutDescription as DoorEvent)).toBeNull();
  });

  it('falls back to the device id when the name was never resolved', async () => {
    // Ring sends no device name in any webhook, so this is the common case, not an edge.
    const push = createOverlayPush({
      bucket: 'b',
      postToConnection: async () => undefined,
      presign: async () => SIGNED,
    });
    const { device_name: _omit, ...withoutName } = EVENT;
    const message = await push.buildMessage(withoutName as DoorEvent);
    expect(message?.device_name).toBe('front_door_cam');
  });
});

describe('pushToConnections', () => {
  const message = {
    event_id: 'evt_abc123',
    description: 'Someone is at the door',
    snapshot_url: SIGNED,
    timestamp: '2026-02-13T13:39:57.200Z',
    device_name: 'Front Door',
  };

  it('delivers to every connection', async () => {
    const sent: { connectionId: string; data: string }[] = [];
    const post = async (input: { connectionId: string; data: string }) => {
      sent.push(input);
    };
    const result = await pushToConnections(
      message,
      [{ connectionId: 'a' }, { connectionId: 'b' }],
      post,
    );
    expect(result).toEqual({ outcome: 'delivered', delivered: 2, pruned: [] });
    expect(JSON.parse(sent[0]!.data)).toEqual(message);
  });

  it('reports no_connections without attempting a send', async () => {
    const post = vi.fn(async () => undefined);
    expect(await pushToConnections(message, [], post)).toEqual({
      outcome: 'no_connections',
      delivered: 0,
      pruned: [],
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps delivering after one socket is gone, and prunes it', async () => {
    // The failure mode this guards: one dead Fire TV swallowing the description for
    // every other screen in the house.
    const post = vi.fn(async ({ connectionId }: { connectionId: string }) => {
      if (connectionId === 'dead') throw goneError();
    });
    const onStale = vi.fn(async () => undefined);

    const result = await pushToConnections(
      message,
      [{ connectionId: 'dead' }, { connectionId: 'alive' }],
      post,
      onStale,
    );

    expect(result.delivered).toBe(1);
    expect(result.pruned).toEqual(['dead']);
    expect(onStale).toHaveBeenCalledWith('dead');
  });

  it('reports all_stale when every socket has gone', async () => {
    const post = vi.fn(async () => {
      throw goneError();
    });
    const result = await pushToConnections(message, [{ connectionId: 'a' }], post);
    expect(result.outcome).toBe('all_stale');
  });

  it('propagates a non-Gone failure rather than counting a silent success', async () => {
    const post = vi.fn(async () => {
      throw new Error('ServiceUnavailableException');
    });
    await expect(pushToConnections(message, [{ connectionId: 'a' }], post)).rejects.toThrow(
      /ServiceUnavailableException/,
    );
  });
});

describe('deliverEvent', () => {
  it('delivers and prunes in one pass', async () => {
    const d = deps({
      listConnections: vi.fn(async () => [{ connectionId: 'a' }, { connectionId: 'dead' }]),
      postToConnection: vi.fn(async ({ connectionId }: { connectionId: string }) => {
        if (connectionId === 'dead') throw goneError();
      }),
    });
    const result = await deliverEvent(EVENT, d);
    expect(result.status).toBe('delivered');
    expect(result.delivered).toBe(1);
    expect(result.pruned).toEqual(['dead']);
    expect(d.removeConnection).toHaveBeenCalledWith('dead');
  });

  it('skips, without failing, when no Fire TV is connected', async () => {
    // Normal for a doorbell product, not an error worth redelivering.
    const d = deps({ listConnections: vi.fn(async () => []) });
    const result = await deliverEvent(EVENT, d);
    expect(result).toEqual({ status: 'skipped', reason: 'no connected clients' });
    expect(d.postToConnection).not.toHaveBeenCalled();
  });

  it('skips when the event has no description', async () => {
    const { description: _omit, ...base } = EVENT;
    const result = await deliverEvent(base as DoorEvent, deps());
    expect(result).toEqual({ status: 'skipped', reason: 'no description on the event' });
  });

  it('skips when the event has no snapshot', async () => {
    const { snapshot_s3_key: _omit, ...base } = EVENT;
    const result = await deliverEvent(base as DoorEvent, deps());
    expect(result).toEqual({
      status: 'skipped',
      reason: 'no snapshot stored, and the payload requires one',
    });
  });
});

describe('connect and disconnect routes', () => {
  // The routes build their own dependencies, so the registry's client seam is the only
  // way to exercise them without an AWS account. Asserting the status code alone would
  // pass whether or not a row was written, which is the thing that matters.
  const sent: { input: Record<string, unknown> }[] = [];
  beforeAll(() => {
    setConnectionClient({
      send: vi.fn(async (command: { input: Record<string, unknown> }) => {
        sent.push({ input: command.input });
        return {};
      }),
    } as never);
  });

  afterAll(() => setConnectionClient(undefined));

  function wsEvent(connectionId: string, query?: Record<string, string>) {
    return {
      requestContext: { connectionId, routeKey: '$connect', eventType: 'CONNECT' },
      queryStringParameters: query,
    } as never;
  }

  it('registers the connection id, which is the only way to push later', async () => {
    sent.length = 0;
    const response = await onConnect(wsEvent('conn-42', { device_id: 'tv-1' }));
    expect(response.statusCode).toBe(200);
    // A 200 with no row written would be a client that receives nothing, silently.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.input.TableName).toBe('FrontDoorConnections');
    const item = sent[0]?.input.Item as Record<string, unknown>;
    expect(item['connection_id']).toBe('conn-42');
    expect(item['device_id']).toBe('tv-1');
    // Bounded growth: a client that vanishes without $disconnect must not persist.
    expect(Number(item['expires_at']) - Math.floor(Number(item['connected_at_ms']) / 1000)).toBe(86_400);
  });

  it('surfaces a registration failure rather than a client that silently receives nothing', async () => {
    // API Gateway treats a 2xx from $connect as a successful socket, so a swallowed
    // failure here produces a client that believes it is connected and gets no events.
    const previous = process.env['CONNECTIONS_TABLE'];
    delete process.env['CONNECTIONS_TABLE'];
    const response = await onConnect(wsEvent('conn-42'));
    expect(response.statusCode).toBe(500);
    if (previous !== undefined) process.env['CONNECTIONS_TABLE'] = previous;
  });

  it('removes the connection on disconnect', async () => {
    sent.length = 0;
    const response = await onDisconnect(wsEvent('conn-42'));
    expect(sent[0]?.input.Key).toEqual({ connection_id: 'conn-42' });
    // 200 even on failure: the row has a TTL, so a failed delete is harmless and a
    // non-2xx would only make API Gateway retry a cleanup.
    expect(response.statusCode).toBe(200);
  });

  it('returns 200 on disconnect even when the table variable is missing', async () => {
    const previous = process.env['CONNECTIONS_TABLE'];
    delete process.env['CONNECTIONS_TABLE'];
    const response = await onDisconnect(wsEvent('conn-42'));
    expect(response.statusCode).toBe(200);
    if (previous !== undefined) process.env['CONNECTIONS_TABLE'] = previous;
  });
});
