/**
 * Tests for three production entry points that had no coverage: the overlay stage's SQS
 * adapter, the webhook's HTTP adapter, and the daily summary's scheduler adapter.
 *
 * The logic behind each is tested elsewhere. What lives here is the **wiring** \u2014 the envelope
 * in, the collaborators wired up, the answer out \u2014 and that is the part which only ever runs
 * in production, so it is the part most worth exercising.
 *
 * Assertions that are about behaviour rather than about lines:
 *
 * 1. **Failures are reported by `messageId`**, because that is the only thing SQS uses to
 *    decide what to redeliver.
 * 2. **A vanished socket is not a failed delivery.** `GoneException` means API Gateway has
 *    already forgotten that client; everyone reachable was reached, so redelivering would
 *    loop forever over an event that was in fact delivered.
 * 3. **Ingress still accepts events with no queue configured.** The hand-off is last and
 *    optional on purpose; a stack deployed before its describe queue exists must not 500.
 * 4. **A missing model id is reported, not silently ignored.**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { handler as overlayHandler } from '../../src/handlers/overlayPusher';
import { handler as webhookHandler, WEBHOOK_SECRET_ENV } from '../../src/handlers/webhookHandler';
import { handler as summaryHandler } from '../../src/handlers/dailySummary';
import { computeSignature, SIGNATURE_PREFIX } from '../../src/lib/signatureVerifier';
import * as dynamo from '../../src/lib/dynamoClient';
import * as connections from '../../src/lib/connectionStore';
import * as overlayPush from '../../src/lib/overlayPush';
import * as snapshotStore from '../../src/lib/snapshotStore';
import * as bedrock from '../../src/lib/bedrockClient';
import type { DoorEvent } from '../../src/types';

/** Every SQS handler here is the same Callback shape. */
type SqsAdapter = (
  event: unknown,
  context: unknown,
  callback: unknown,
) => Promise<{ batchItemFailures: { itemIdentifier: string }[] }>;

const NO_CONTEXT = { getRemainingTimeInMillis: () => 30_000 } as never;
const NO_CALLBACK = (() => undefined) as never;
const overlay = overlayHandler as unknown as SqsAdapter;

const EVENT: DoorEvent = {
  date: '2026-02-13',
  event_id: 'evt-1',
  timestamp: '2026-02-13T13:39:57.200Z',
  device_id: 'front_door_cam',
  device_name: 'Front Door',
  event_type: 'motion_detected',
  sub_type: 'human',
  description: 'A person places a medium box by the door',
  snapshot_s3_key: 'snapshots/2026-02-13/evt-1.jpg',
  processed: true,
};

const BODY = JSON.stringify({
  date: EVENT.date,
  event_id: EVENT.event_id,
  timestamp: EVENT.timestamp,
});

const sqsEvent = (records: { messageId?: string; body: string }[]): unknown => ({ Records: records });

/** A signed request body, so the adapter can be driven through its real happy path. */
function signedWebhookBody(requestId = 'r-1'): string {
  return JSON.stringify({
    meta: { version: '1.1', time: '2026-02-13T13:39:57.200Z', request_id: requestId },
    data: {
      id: 'evt-1',
      type: 'motion_detected',
      attributes: { source: 'front_door_cam', source_type: 'devices', timestamp: 1786715596787 },
    },
  });
}

function apiEvent(body: string, signature?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /webhook/ring',
    rawPath: '/webhook/ring',
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined ? {} : { 'x-signature': signature }),
    },
    body,
    isBase64Encoded: false,
    requestContext: { http: { method: 'POST', path: '/webhook/ring' } },
  } as unknown as APIGatewayProxyEventV2;
}

const sign = (raw: string): string => SIGNATURE_PREFIX + computeSignature('secret', raw);

beforeEach(() => {
  process.env['S3_SNAPSHOT_BUCKET'] = 'bucket';
  process.env['WEBSOCKET_ENDPOINT'] = 'https://ws.test/prod';
  process.env[WEBHOOK_SECRET_ENV] = 'secret';
  process.env[dynamo.EVENTS_TABLE_ENV] = 'FrontDoorEvents';
  process.env[dynamo.IDEMPOTENCY_TABLE_ENV] = 'FrontDoorIdempotency';
  process.env['EVENT_QUEUE_URL'] = 'https://sqs.test/queue';
  process.env['BEDROCK_MODEL_ID'] = 'anthropic.test';
  // Presigning is a LOCAL operation — it signs a URL and returns — but the S3 client still
  // resolves credentials before it will do so. Without these it reaches for the instance
  // metadata service, takes about a second, and fails. With them the real presigner runs and
  // the test asserts the real payload rather than a stubbed one.
  process.env['AWS_ACCESS_KEY_ID'] = 'AKIAIOSFODNN7EXAMPLE';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  process.env['AWS_REGION'] = 'us-east-1';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the overlay SQS adapter', () => {
  let getEvent: MockInstance<typeof dynamo.getEvent>;
  let postToConnection: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getEvent = vi.spyOn(dynamo, 'getEvent').mockResolvedValue(EVENT);
    vi.spyOn(connections, 'listConnections').mockResolvedValue([
      { connectionId: 'c-1', connectedAtMs: 1_700_000_000_000 },
    ]);
    vi.spyOn(connections, 'removeConnection').mockResolvedValue(undefined);
    postToConnection = vi.fn(async () => undefined);
    // Only the two AWS calls are stubbed; the real overlayPush builds the real payload.
    vi.spyOn(overlayPush, 'createPoster').mockReturnValue(
      postToConnection as unknown as overlayPush.PostToConnectionLike,
    );
    vi.spyOn(overlayPush, 'createSnapshotPresigner').mockReturnValue(async () => 'https://s3.test/signed');
  });

  it('pushes the real payload to a connected client', async () => {
    const result = await overlay(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([]);
    const sent = postToConnection.mock.calls[0]?.[0] as { connectionId: string; data: string };
    expect(sent.connectionId).toBe('c-1');

    // The REAL §3.4 payload, and the real presigner — see the fake AWS credentials above.
    // Asserting the signature's shape rather than a stubbed string means this also confirms
    // the 1-hour expiry §6 requires is on the wire, which a stub could never do.
    const message = JSON.parse(sent.data) as {
      event_id: string;
      description: string;
      timestamp: string;
      device_name?: string;
      snapshot_url: string;
    };
    expect(message).toMatchObject({
      event_id: 'evt-1',
      description: EVENT.description,
      timestamp: EVENT.timestamp,
      device_name: 'Front Door',
    });
    expect(message.snapshot_url).toContain('/snapshots/2026-02-13/evt-1.jpg');
    expect(message.snapshot_url).toContain('X-Amz-Signature=');
    expect(message.snapshot_url).toContain('X-Amz-Expires=3600');
    expect(getEvent).toHaveBeenCalledTimes(1);
  });

  it('skips a record with no messageId rather than reporting an empty identifier', async () => {
    const result = await overlay(sqsEvent([{ body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([]);
    expect(getEvent).not.toHaveBeenCalled();
  });

  it('treats a vanished event as handled rather than retried', async () => {
    // Redelivery cannot resurrect a row that expired or was removed.
    getEvent.mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await overlay(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'overlay stage skipped a message',
      expect.objectContaining({ reason: 'event not in the table' }),
    );
  });

  it('reports an unparsable message by id, and keeps going', async () => {
    const result = await overlay(
      sqsEvent([
        { messageId: 'm-bad', body: '{not json' },
        { messageId: 'm-good', body: BODY },
      ]),
      NO_CONTEXT,
      NO_CALLBACK,
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm-bad' }]);
    expect(postToConnection).toHaveBeenCalledTimes(1);
  });

  it('reports a message carrying no identifiers, rather than pushing an empty card', async () => {
    // The table is stubbed to behave like the real one: a key of `undefined` is not a valid
    // DynamoDB key, so the read fails. A stub that returned an event for ANY arguments
    // would let an empty message through and push a card with nothing on it.
    getEvent.mockImplementation(async (date, eventId, timestamp) => {
      if (date === undefined || eventId === undefined || timestamp === undefined) {
        throw new Error('The provided key element does not match the schema');
      }
      return EVENT;
    });

    const result = await overlay(
      sqsEvent([{ messageId: 'm-thin', body: '{}' }]),
      NO_CONTEXT,
      NO_CALLBACK,
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm-thin' }]);
    expect(postToConnection).not.toHaveBeenCalled();
  });

  it('skips an event with nothing to say, and says why', async () => {
    const { description: _dropped, ...withoutDescription } = EVENT;
    getEvent.mockResolvedValue(withoutDescription as DoorEvent);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await overlay(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'overlay stage skipped an event',
      expect.objectContaining({ reason: 'no description on the event' }),
    );
  });

  it('skips an event whose snapshot never stored, since the payload requires one', async () => {
    const { snapshot_s3_key: _dropped, ...withoutSnapshot } = EVENT;
    getEvent.mockResolvedValue(withoutSnapshot as DoorEvent);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await overlay(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(warn).toHaveBeenCalledWith(
      'overlay stage skipped an event',
      expect.objectContaining({ reason: 'no snapshot stored, and the payload requires one' }),
    );
  });

  it('treats a GoneException as a delivered prune, not a failure', async () => {
    // Gone means API Gateway already forgot the socket. Everyone reachable was reached, so
    // reporting a batch failure would redeliver this event forever.
    const gone = Object.assign(new Error('Gone'), { name: 'GoneException' });
    postToConnection.mockRejectedValue(gone);
    const removeConnection = vi
      .spyOn(connections, 'removeConnection')
      .mockResolvedValue(undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await overlay(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([]);
    expect(removeConnection).toHaveBeenCalledWith('c-1');
  });

  it('reports a real transport error as a batch failure so the queue retries', async () => {
    postToConnection.mockRejectedValue(new Error('ServiceUnavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await overlay(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm-1' }]);
  });

  it('returns an empty failure list for an empty batch', async () => {
    expect((await overlay(sqsEvent([]), NO_CONTEXT, NO_CALLBACK)).batchItemFailures).toEqual([]);
  });
});

describe('the webhook HTTP adapter', () => {
  let putEvent: MockInstance<typeof dynamo.putEvent>;
  let enqueueForDescribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    putEvent = vi.spyOn(dynamo, 'putEvent').mockResolvedValue(undefined);
    vi.spyOn(dynamo, 'claimRequestId').mockResolvedValue(true);
    enqueueForDescribe = vi.fn(async () => undefined);
    vi.spyOn(snapshotStore, 'createSnapshotStore').mockReturnValue({
      putSnapshot: vi.fn(async () => 'key'),
      enqueueForDescribe,
      bucket: 'bucket',
    } as never);
  });

  it('accepts a signed event, stores it, and hands it to the queue', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const raw = signedWebhookBody();

    const result = await webhookHandler(apiEvent(raw, sign(raw)));

    expect(result.statusCode).toBe(200);
    expect(putEvent).toHaveBeenCalledTimes(1);
    expect(enqueueForDescribe).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('webhook accepted', expect.anything());
  });

  it('runs with no queue configured, because ingress does not depend on the hand-off', async () => {
    // The hand-off is last and optional on purpose: a stack deployed before its describe
    // queue exists must still accept events rather than 500 every time.
    delete process.env['EVENT_QUEUE_URL'];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const raw = signedWebhookBody();

    const result = await webhookHandler(apiEvent(raw, sign(raw)));

    expect(result.statusCode).toBe(200);
    expect(putEvent).toHaveBeenCalledTimes(1);
    expect(enqueueForDescribe).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it('logs rather than failing when the queue send fails', async () => {
    // The event is already durably stored, so a 500 would make Ring retry a request that
    // succeeded. Losing the description is the cheaper failure.
    enqueueForDescribe.mockRejectedValue(new Error('queue unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const raw = signedWebhookBody();

    const result = await webhookHandler(apiEvent(raw, sign(raw)));

    expect(result.statusCode).toBe(200);
    expect(error).toHaveBeenCalledWith(
      'could not enqueue for describe stage',
      expect.objectContaining({ error: 'queue unavailable' }),
    );
  });

  it('turns a missing body into a 400 naming the reason', async () => {
    const result = await webhookHandler(apiEvent(''));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string)).toEqual({
      status: 'rejected',
      reason: 'missing body',
    });
  });

  it('returns 500 rather than 4xx when storage fails, so Ring retries', async () => {
    putEvent.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const raw = signedWebhookBody();

    const result = await webhookHandler(apiEvent(raw, sign(raw)));

    expect(result.statusCode).toBe(500);
    // The key is `message`, not `error` — asserted as written so a rename to `error` here
    // is caught, since the two would otherwise look interchangeable in a log.
    expect(error).toHaveBeenCalledWith('webhook ingress failed', {
      message: 'ProvisionedThroughputExceeded',
    });
  });
});

describe('the daily-summary scheduler adapter', () => {
  let putSummary: MockInstance<typeof dynamo.putSummary>;

  beforeEach(() => {
    putSummary = vi.spyOn(dynamo, 'putSummary').mockResolvedValue(undefined);
  });

  it('writes a row for an empty day without calling the model', async () => {
    vi.spyOn(dynamo, 'queryEventsByDate').mockResolvedValue([]);
    const createClient = vi.spyOn(bedrock, 'createBedrockClient');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await summaryHandler({} as never);

    // Nothing to describe, so a model call would cost tokens to say nothing.
    expect(createClient).not.toHaveBeenCalled();
    expect(putSummary).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'daily summary written',
      expect.objectContaining({ source: 'fallback', reason: 'no events recorded' }),
    );
  });

  it('asks the model about a day with events and records that it did', async () => {
    vi.spyOn(dynamo, 'queryEventsByDate').mockResolvedValue([EVENT]);
    const summariseText = vi.fn(async () => 'One delivery today.');
    vi.spyOn(bedrock, 'createBedrockClient').mockReturnValue({ summariseText } as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await summaryHandler({} as never);

    expect(summariseText).toHaveBeenCalledTimes(1);
    expect(putSummary).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'One delivery today.', summary_source: 'ai', model: 'anthropic.test' }),
    );
    expect(log).toHaveBeenCalledWith(
      'daily summary written',
      expect.objectContaining({ source: 'ai', event_count: 1 }),
    );
  });

  it('passes the caller\'s system prompt and token budget rather than inventing its own', async () => {
    // The prompt is the daily-summary module's language, not the transport's — see D026.
    vi.spyOn(dynamo, 'queryEventsByDate').mockResolvedValue([EVENT]);
    const summariseText = vi.fn(async () => 'One delivery today.');
    vi.spyOn(bedrock, 'createBedrockClient').mockReturnValue({ summariseText } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await summaryHandler({} as never);

    const [, options] = summariseText.mock.calls[0] as unknown as [
      string,
      { system: string; maxTokens: number },
    ];
    expect(options.system).toContain("Summarize today's front door activity");
    expect(options.maxTokens).toBeGreaterThan(80);
  });

  it('rejects a malformed date from the schedule before touching the table', async () => {
    const load = vi.spyOn(dynamo, 'queryEventsByDate');

    await expect(summaryHandler({ date: 'yesterday' } as never)).rejects.toThrow(/malformed date/);
    expect(load).not.toHaveBeenCalled();
  });
});