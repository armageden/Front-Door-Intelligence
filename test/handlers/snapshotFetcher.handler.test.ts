/**
 * Tests for the describe stage's SQS adapter — the `handler` export.
 *
 * These exist because `describeEvent()` has been tested thoroughly and the thing that
 * actually runs in production had not been: the wiring between the queue envelope, the
 * three clients, and the device-name memo. It was 40 uncovered statements, the largest gap
 * in the repository, and none of it needed new production code to close — only stubs at the
 * module boundary.
 *
 * What is genuinely being asserted here is behaviour a reader would want confirmed:
 *
 * 1. **A batch reports per-message failures by `messageId`,** which is how SQS redelivers
 *    only what failed. A wrong identifier means a bad message is redelivered forever and a
 *    good one alongside it.
 * 2. **A record with no `messageId` is skipped** rather than producing an empty identifier
 *    the API would reject.
 * 3. **The device name is looked up once per camera per batch,** not once per event.
 * 4. **A failure in one record does not abandon the rest of the batch.**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import * as ringClient from '../../src/lib/ringClient';
import * as bedrock from '../../src/lib/bedrockClient';
import * as dynamo from '../../src/lib/dynamoClient';
import * as store from '../../src/lib/snapshotStore';
import { handler } from '../../src/handlers/snapshotFetcher';
import type { SQSEvent } from 'aws-lambda';

/**
 * `SQSHandler` is a Callback type, so it takes (event, context, callback) even though the
 * implementation awaits its first argument. The extra two are unused here and are supplied
 * as stubs rather than worked around with a cast, so the call site stays honest.
 */
const invoke = handler as unknown as (
  event: unknown,
  context: unknown,
  callback: unknown,
) => Promise<{ batchItemFailures: { itemIdentifier: string }[] }>;

const NO_CONTEXT = { getRemainingTimeInMillis: () => 30_000 } as never;
const NO_CALLBACK = (() => undefined) as never;
import type { DoorEvent } from '../../src/types';

const EVENT: DoorEvent = {
  date: '2026-02-13',
  event_id: 'front_door_cam_motion_1786715596787',
  timestamp: '2026-02-13T13:39:57.200Z',
  occurred_at_ms: 1786715596787,
  device_id: 'front_door_cam',
  event_type: 'motion_detected',
  sub_type: 'human',
  processed: false,
};

const BODY = JSON.stringify({
  date: EVENT.date,
  event_id: EVENT.event_id,
  timestamp: EVENT.timestamp,
});

function sqsEvent(
  records: { messageId?: string; body: string }[],
): Parameters<typeof handler>[0] {
  return { Records: records } as unknown as SQSEvent;
}

let getEvent: MockInstance<typeof dynamo.getEvent>;
let markProcessed: MockInstance<typeof dynamo.markProcessed>;
let putSnapshot: MockInstance<ReturnType<typeof store.createSnapshotStore>['putSnapshot']>;
let getDevice: ReturnType<typeof vi.fn>;
let describeImage: ReturnType<typeof vi.fn>;
let fetchSnapshot: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env['S3_SNAPSHOT_BUCKET'] = 'test-bucket';
  process.env['RING_CLIENT_ID'] = 'id';
  process.env['RING_CLIENT_SECRET'] = 'secret';
  process.env['RING_REFRESH_TOKEN'] = 'refresh';
  // The handler's default describe transport calls requireEnv() BEFORE the mocked
  // createBedrockClient, so an unset model id makes the stage silently take the FR11
  // fallback instead of using the model. Setting it is what keeps these tests on the AI
  // path rather than the degraded one.
  process.env['BEDROCK_MODEL_ID'] = 'anthropic.test';

  getEvent = vi.spyOn(dynamo, 'getEvent').mockResolvedValue(EVENT);
  markProcessed = vi.spyOn(dynamo, 'markProcessed').mockResolvedValue(undefined);

  putSnapshot = vi.fn(async () => 'snapshots/2026-02-13/x.jpg');
  vi.spyOn(store, 'createSnapshotStore').mockReturnValue({
    putSnapshot,
    enqueueForDescribe: vi.fn(async () => undefined),
    bucket: 'test-bucket',
  } as never);

  getDevice = vi.fn(async () => ({ deviceId: 'front_door_cam', name: 'Front Door' }));
  fetchSnapshot = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }));
  vi.spyOn(ringClient, 'createRingClient').mockReturnValue({
    getDevice,
    fetchSnapshot,
    getAccessToken: vi.fn(async () => 'token'),
  } as never);

  describeImage = vi.fn(async () => 'A person places a medium box by the door');
  vi.spyOn(bedrock, 'createBedrockClient').mockReturnValue({ describeImage } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the SQS adapter', () => {
  it('describes an event and reports no failures', async () => {
    const result = await invoke(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([]);
    expect(markProcessed).toHaveBeenCalledTimes(1);
  });

  it('persists the sentence it wrote', async () => {
    await invoke(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    const outcome = markProcessed.mock.calls[0]?.[1] as { reason?: string; description: string; source: string } | undefined;
    // The reason is asserted rather than the sentence alone: a silent fallback here would
    // still "write a description" and the suite would pass while the stage degraded.
    expect(outcome?.reason).toBeUndefined();
    expect(outcome?.description).toBe('A person places a medium box by the door');
    expect(outcome?.source).toBe('ai');
  });

  it('names the failing message by its id, which is how SQS redelivers only that one', async () => {
    // A wrong or missing identifier here would redeliver a good message forever.
    const result = await invoke(sqsEvent([{ messageId: 'm-bad', body: '{not json' }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm-bad' }]);
  });

  it('skips a record with no messageId rather than reporting an empty one', async () => {
    const result = await invoke(sqsEvent([{ body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    // Nothing to redeliver by, so it is neither processed nor reported.
    expect(result.batchItemFailures).toEqual([]);
    expect(getEvent).not.toHaveBeenCalled();
  });

  it('keeps going after one record fails', async () => {
    // Malformed JSON, so this record fails on its own without disturbing the next one. An
    // earlier version made the TABLE throw, which failed every record and hid the property
    // being tested.
    const result = await invoke(
      sqsEvent([
        { messageId: 'm-bad', body: '{not json' },
        { messageId: 'm-good', body: BODY },
      ]),
      NO_CONTEXT,
      NO_CALLBACK,
    );

    // The bad one is reported; the good one was still described.
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm-bad' }]);
    expect(markProcessed).toHaveBeenCalledTimes(1);
  });

  it('reports a record whose event is gone from the table as handled, not failed', async () => {
    // Absent means expired or removed, which is not something redelivery can fix.
    getEvent.mockResolvedValue(undefined);
    const result = await invoke(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([]);
  });

  it('looks the device name up once per camera, however many events arrive', async () => {
    await invoke(
      sqsEvent([
        { messageId: 'm-1', body: BODY },
        { messageId: 'm-2', body: BODY },
        { messageId: 'm-3', body: BODY },
      ]),
      NO_CONTEXT,
      NO_CALLBACK,
    );

    // Three events from one doorbell is one GET /v1/devices call, not three.
    expect(getDevice).toHaveBeenCalledTimes(1);
  });

  it('treats a device with a blank name as unnamed rather than storing an empty string', async () => {
    getDevice.mockResolvedValue({ deviceId: 'front_door_cam', name: '   ' });
    await invoke(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    const outcome = markProcessed.mock.calls[0]?.[1];
    expect(outcome?.deviceName).toBeUndefined();
  });

  it('still writes a sentence when the device lookup fails outright', async () => {
    getDevice.mockRejectedValue(new Error('401 unauthorized'));
    await invoke(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    const outcome = markProcessed.mock.calls[0]?.[1] as
      | { description: string; deviceName?: string }
      | undefined;
    expect(outcome?.description).toBeTruthy();
    expect(outcome?.deviceName).toBeUndefined();
  });

  it('reports a storage failure as a batch failure so the queue retries it', async () => {
    // The event was described but not saved, which is exactly what a redelivery fixes.
    markProcessed.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
    const result = await invoke(sqsEvent([{ messageId: 'm-1', body: BODY }]), NO_CONTEXT, NO_CALLBACK);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm-1' }]);
  });

  it('returns an empty failure list for an empty batch', async () => {
    const result = await invoke(sqsEvent([]), NO_CONTEXT, NO_CALLBACK);
    expect(result.batchItemFailures).toEqual([]);
  });
});

/** Force `processMessage` to reject by making the stored event blow up on read. */
function processMessageSpyFails(): void {
  getEvent.mockRejectedValue(new Error('table unavailable'));
}