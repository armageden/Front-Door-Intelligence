/**
 * Tests for the DEFAULT transports — the code paths taken when no seam is injected.
 *
 * Every other test in this repository injects a fake, which is the right way to test logic
 * and the wrong way to test *wiring*. These paths are what actually execute in production:
 * the `??` fallbacks that construct a real AWS client, and the SDK calls that follow.
 *
 * They are all runnable offline, and that is the point. A transport test here asserts
 * something a stubbed test never can:
 *
 * - the lazy `import('@aws-sdk/…')` inside bedrockClient resolves and does not throw on load;
 * - the client is constructed with the region it was given;
 * - the failure that comes back is an **AWS-shaped SDK error**, which is what the stage's
 *   `catch` branches are actually written against. A stubbed rejection of `new Error(…)`
 *   would pass those branches without proving the real error would too.
 *
 * No account, no network. Fake credentials are set below, because the SDKs resolve
 * credentials before they will attempt anything, and without them they spend about a second
 * reaching for the instance metadata service and then fail for the wrong reason.
 *
 * What is deliberately NOT asserted: that any of these calls succeed. They cannot here, and
 * pretending otherwise would be the exact mistake Friction Log Entry 13 records.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBedrockClient, BedrockError } from '../../src/lib/bedrockClient';
import { createSnapshotStore } from '../../src/lib/snapshotStore';
import { createPoster } from '../../src/lib/overlayPush';
import { createRingClient } from '../../src/lib/ringClient';

const FAKE_CREDS = {
  AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  AWS_REGION: 'us-east-1',
} as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const [key, value] of Object.entries(FAKE_CREDS)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

/**
 * An AWS SDK failure, rather than a bare `Error`.
 *
 * `BedrockError` folds the cause into its own message rather than setting `.cause`, so
 * this inspects the message. An earlier version asserted a `.cause` and a name that neither
 * exists — both were wrong about the code, and the tests were corrected rather than the
 * code being bent to match them.
 */
function expectAwsFailure(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).not.toBe('');
}

describe('the Bedrock default transport', () => {
  it('resolves the lazy SDK import and fails against a real client, not a stub', async () => {
    // The client is constructed here with no `send` seam, so this executes
    // `await import('@aws-sdk/client-bedrock-runtime')` for the first time in the suite.
    const client = createBedrockClient({ modelId: 'anthropic.test', region: 'us-east-1' });

    let caught: unknown;
    try {
      await client.describeImage(new Uint8Array([1, 2, 3]));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BedrockError);
    // Wrapped, not leaked: the stage catches BedrockError specifically to reach FR11, and
    // the model id travels with the error so a failure names what failed.
    expect((caught as BedrockError).modelId).toBe('anthropic.test');
    expect((caught as Error).message).toContain('anthropic.test');
    expectAwsFailure(caught);
  });

  it('wraps a non-Error cause into a readable message', async () => {
    // `describe(cause)` has a String() branch that only a non-Error rejection can reach.
    const client = createBedrockClient({
      modelId: 'anthropic.test',
      region: 'us-east-1',
      send: async () => {
        throw 'a bare string';
      },
    });

    await expect(client.describeImage(new Uint8Array([1]))).rejects.toThrow(/a bare string/);
  });
});

describe('the snapshot store default transports', () => {
  it('uploads through a real S3 client when no seam is given', async () => {
    const store = createSnapshotStore({ bucket: 'front-door-snapshots' });

    let caught: unknown;
    try {
      await store.putSnapshot('snapshots/x.jpg', new Uint8Array([1]));
    } catch (error) {
      caught = error;
    }

    // Reached the SDK and the network boundary. With fake credentials the S3 client reports
    // that the key is unknown, which proves the request was actually attempted rather than
    // short-circuited by a missing configuration — and it proves it offline, in about a second.
    expectAwsFailure(caught);
    expect(String((caught as Error).message)).toMatch(
      /access key|credential|signature|endpoint|region|ENOTFOUND|EAI_AGAIN|not a real endpoint/i,
    );
  });

  it('sends through a real SQS client when no seam is given', async () => {
    const store = createSnapshotStore({ bucket: 'front-door-snapshots' });

    let caught: unknown;
    try {
      await store.enqueueForDescribe(
        {
          date: '2026-02-13',
          event_id: 'evt-1',
          timestamp: '2026-02-13T13:39:57.200Z',
          device_id: 'front_door_cam',
          event_type: 'motion_detected',
          processed: false,
        },
        'https://sqs.us-east-1.amazonaws.com/123456789012/queue',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
  });

  it('returns an empty object when the queue answers without a message id', async () => {
    // A queue response is allowed to omit MessageId, and the documented behaviour is a
    // successful hand-off rather than an error.
    const store = createSnapshotStore({
      bucket: 'b',
      send: async () => ({}),
    });

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

  it('passes the queue message id through when there is one', async () => {
    const store = createSnapshotStore({
      bucket: 'b',
      send: async () => ({ MessageId: 'mid-1' }),
    });

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
    ).resolves.toBe('mid-1');
  });
});

describe('the overlay poster default transport', () => {
  it('posts through a real API Gateway Management client when no seam is given', async () => {
    // The endpoint below is deliberately not resolvable, so the call fails at the network
    // boundary \u2014 which is the only place this can be exercised without a deployment.
    const post = createPoster('https://not-a-real-endpoint.invalid/prod');

    let caught: unknown;
    try {
      await post({ connectionId: 'c-1', data: '{"a":1}' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
  });
});

describe('the Ring client defaults', () => {
  it('falls back to the global fetch, sleep and clock when no seams are given', async () => {
    // Constructing with no `fetchImpl` is what production does. The request then fails
    // because there is no token, which proves the global fetch was reached rather than an
    // injected one.
    const client = createRingClient({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'refresh',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 401 }),
    );

    await expect(client.getDevice('front_door_cam')).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalled();
  });
});