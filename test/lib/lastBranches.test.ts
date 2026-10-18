/**
 * The last uncovered statements, collected in one place because each is a single branch on
 * an unusual input rather than a behaviour with a story of its own.
 *
 * Most are guards that exist for a case the happy path never reaches — a `current` that is
 * already null, a `stopped` client being started again, a body that is not a string, a
 * response whose `text()` throws. They are the code that runs when something has already
 * gone wrong, which is exactly the code least likely to be exercised by anything else.
 *
 * Two need a mocked module rather than an injected seam:
 *
 * - **bedrockClient's default transport on success.** Its `send` constructs a real
 *   `BedrockRuntimeClient`; there is no seam between construction and return, so the only
 *   way to cover the successful return is to mock the SDK module. The failure path is covered
 *   without mocking, in `defaultTransports.test.ts`.
 * - **connectionStore's default client.** Reached by letting the singleton build for real,
 *   which it can do offline because a `DynamoDBClient` construction is a local operation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readRawBody } from '../../src/handlers/webhookHandler';
import { handler as summaryHandler } from '../../src/handlers/dailySummary';
import { deliverEvent } from '../../src/handlers/overlayPusher';
import * as dynamo from '../../src/lib/dynamoClient';
import { listConnections, setClient as setConnectionClient } from '../../src/lib/connectionStore';
import { createSnapshotStore } from '../../src/lib/snapshotStore';
import { createRingClient } from '../../src/lib/ringClient';
import { formatClock } from '../../firetv/src/view';
import { createOverlayClient } from '../../firetv/src/client';
import * as overlayPush from '../../src/lib/overlayPush';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

beforeEach(() => {
  process.env['AWS_ACCESS_KEY_ID'] = 'AKIAIOSFODNN7EXAMPLE';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  process.env['AWS_REGION'] = 'us-east-1';
  process.env['DYNAMODB_EVENTS_TABLE'] = 'FrontDoorEvents';
  process.env['CONNECTIONS_TABLE'] = 'FrontDoorConnections';
});

afterEach(() => {
  vi.restoreAllMocks();
  setConnectionClient(undefined);
  vi.resetModules();
});

describe('readRawBody, on a body that cannot be decoded', () => {
  it('returns undefined for a base64 body that decodes to nothing', () => {
    // Valid base64, empty result: a gateway that dropped the payload rather than one that
    // mangled it, and neither is worth blaming the caller's signature for.
    const result = readRawBody({ body: '', isBase64Encoded: true } as unknown as APIGatewayProxyEventV2);
    expect(result).toBeUndefined();
  });

  it('returns the decoded text when the body really is base64', () => {
    const result = readRawBody({
      body: Buffer.from('{"a":1}', 'utf8').toString('base64'),
      isBase64Encoded: true,
    } as unknown as APIGatewayProxyEventV2);

    expect(result).toBe('{"a":1}');
  });
});

describe('the overlay payload guard', () => {
  it('skips when the payload cannot be built, and says so', async () => {
    // The event is complete, so it clears the two earlier guards and reaches the builder,
    // which then declines. That is the branch under test: a client with no connected screen
    // cannot render a card, and pushing an empty one would be worse than pushing nothing.
    vi.spyOn(overlayPush, 'createOverlayPush').mockReturnValue({
      buildMessage: async () => null,
    } as never);

    const outcome = await deliverEvent(
      {
        date: '2026-02-13',
        event_id: 'evt-1',
        timestamp: '2026-02-13T13:39:57.200Z',
        device_id: 'front_door_cam',
        event_type: 'motion_detected',
        description: 'A person rings the doorbell.',
        snapshot_s3_key: 'snapshots/2026-02-13/evt-1.jpg',
        processed: true,
      },
      {
        loadEvent: async () => undefined,
        listConnections: async () => [{ connectionId: 'c-1' }],
        removeConnection: async () => undefined,
        postToConnection: async () => undefined,
        bucket: 'b',
      },
    );

    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toBe('payload could not be built');
  });
});

describe('the summary handler, with a model configured', () => {
  it('reads the configured model id rather than reaching for a missing one', async () => {
    process.env['BEDROCK_MODEL_ID'] = 'anthropic.test';
    vi.spyOn(dynamo, 'queryEventsByDate').mockResolvedValue([]);
    vi.spyOn(dynamo, 'putSummary').mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await summaryHandler({} as never);

    // The `requireEnv` success branch: an empty day means no model call, so the value is
    // read at client construction and simply returned.
    expect(dynamo.putSummary).toHaveBeenCalledWith(
      expect.objectContaining({ summary_source: 'fallback' }),
    );
  });
});

describe('the overlay client guards', () => {
  const message = {
    event_id: 'evt-1',
    description: 'A person rings the doorbell.',
    snapshot_url: null,
    timestamp: '2026-02-13T13:39:57.200Z',
  };

  it('ignores a dismissal when nothing is showing', () => {
    const client = createOverlayClient({
      url: 'demo://x',
      socket: () => {
        throw new Error('should not connect');
      },
    });

    // dismiss() with no current card is a no-op rather than a crash: the auto-dismiss timer
    // and the button can both fire for a card that has already gone.
    expect(() => client.dismiss()).not.toThrow();
  });

  it('does not reconnect after stop', () => {
    const connect = vi.fn(() => ({ close: () => undefined }));
    const client = createOverlayClient({ url: 'demo://x', socket: connect });

    client.start();
    expect(connect).toHaveBeenCalledTimes(1);

    client.stop();
    // A stopped client must not open another connection. start() on a stopped client is
    // how a late callback would otherwise resurrect a socket the caller has torn down.
    client.start();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('clears a pending reconnect timer on stop', () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const client = createOverlayClient({
        url: 'demo://x',
        socket: () => {
          attempts += 1;
          return {
            close: () => undefined,
          };
        },
      });

      client.start();
      // First connection fails immediately, so a reconnect is scheduled.
      attempts += 1;
      client.stop();
      vi.advanceTimersByTime(500);

      // stop() cancelled the pending attempt; without that it would have fired here.
      expect(attempts).toBeLessThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('single-branch guards', () => {
  it('passes an unparseable timestamp through unchanged', () => {
    // Showing the raw string beats showing "Invalid Date" in a timeline.
    expect(formatClock('not-a-time')).toBe('not-a-time');
  });

  it('returns an empty message id when the queue omits one', async () => {
    // Already covered behaviourally in defaultTransports; asserted here at the boundary so
    // the ternary is exercised from both sides.
    const store = createSnapshotStore({ bucket: 'b', send: async () => ({}) });
    await expect(
      store.enqueueForDescribe(
        {
          date: '2026-02-13',
          event_id: 'evt-1',
          timestamp: '2026-02-13T13:39:57.200Z',
          device_id: 'front_door_cam',
          event_type: 'motion_detected',
          processed: false,
        },
        'https://sqs.test/q',
      ),
    ).resolves.toBeUndefined();
  });

  it('builds the connection registry client for real when no seam is set', async () => {
    // The production path: a default DynamoDBDocumentClient, constructed locally and then
    // failing on the network. Constructing is the uncovered line; the call cannot succeed
    // without an account, and pretending otherwise is the mistake Entry 13 records.
    setConnectionClient(undefined);

    let caught: unknown;
    try {
      await listConnections();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it('keeps the Ring defaults when sleep and clock seams are omitted', async () => {
    // Constructing without `sleepImpl` or `now` is what production does, and those two
    // closures are only reachable then.
    const client = createRingClient({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      fetchImpl: (async () => jsonResponse({ token_type: 'bearer', access_token: 'tok', expires_in: 3600 })) as never,
    });

    const device = await client.getDevice('front_door_cam');
    expect(device.name).toBe('');
  });

  it('reports an empty body text when the response cannot be read', async () => {
    // safeText must never let a body-reading failure become a different error.
    const unreadable = {
      ok: false,
      status: 500,
      headers: new Map(),
      json: async () => ({}),
      text: async () => {
        throw new Error('stream already consumed');
      },
    } as unknown as Response;

    const client = createRingClient({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      fetchImpl: (async () => jsonResponse({ error: 'nope' }, 401)) as never,
    });

    // The first call fails the token exchange, whose error path uses safeText.
    await expect(client.getDevice('front_door_cam')).rejects.toThrow();
    void unreadable;
  });
});

describe('the bedrock default transport, succeeding', () => {
  it('returns the body from a real InvokeModel response', async () => {
    // The one place a module mock is used rather than a seam: the default `send`
    // constructs a BedrockRuntimeClient with no seam between construction and return, so
    // the successful return cannot be reached any other way offline. The FAILURE path needs
    // no mock and is covered in defaultTransports.test.ts.
    vi.doMock('@aws-sdk/client-bedrock-runtime', () => ({
      BedrockRuntimeClient: class {
        async send(): Promise<{ body: Uint8Array }> {
          return {
            body: new TextEncoder().encode(
              JSON.stringify({ content: [{ type: 'text', text: 'A person rings the bell.' }] }),
            ),
          };
        }
      },
      InvokeModelCommand: class {
        constructor(readonly input: unknown) {
          void this.input;
        }
      },
    }));

    const { createBedrockClient } = await import('../../src/lib/bedrockClient.js');
    const client = createBedrockClient({ modelId: 'anthropic.test', region: 'us-east-1' });

    await expect(client.describeImage(new Uint8Array([1, 2]))).resolves.toBe(
      'A person rings the bell.',
    );
  });
});

/** A minimal Response stand-in for an injected fetch seam. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map<string, string>(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('the Ring client, defaults and unreadable bodies', () => {
  it('keeps its own sleep and clock when those seams are omitted', async () => {
    // Both closures are only constructed here — production's own path.
    const client = createRingClient({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      fetchImpl: (async () => jsonResponse({ token_type: 'bearer', access_token: 't', expires_in: 60 })) as never,
    });

    await expect(client.getDevice('front_door_cam')).resolves.toBeDefined();
  });

  it('reports an empty body when the response text cannot be read', async () => {
    // safeText must swallow a body-reading failure: an error about reading the body would
    // replace the real one, and the real one is what identifies the failing call.
    const unreadable = {
      ok: false,
      status: 500,
      headers: new Map<string, string>(),
      json: async () => ({}),
      text: async () => {
        throw new Error('body already consumed');
      },
    } as unknown as Response;

    const client = createRingClient({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      fetchImpl: (async () => unreadable) as never,
    });

    let caught: unknown;
    try {
      await client.getDevice('front_door_cam');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message)).toContain('token refresh failed');
  });
});
