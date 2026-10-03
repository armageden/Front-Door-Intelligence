/**
 * Tests for the describe stage: snapshot fetch, Bedrock description, and the
 * FR11 fallback.
 *
 * The point of these tests is the **failure matrix**, not the happy path. The product
 * promise is a sentence about what happened; a silent failure produces an alert the
 * user never sees, which is the exact problem this project exists to fix. So every
 * failure mode is asserted to still produce a description.
 *
 * No AWS, no network, no queue. `fetchSnapshot`, `describeImage`, and the store are all
 * injected.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SQSHandler } from 'aws-lambda';

import { describeEvent } from '../../src/handlers/snapshotFetcher';
import { EncryptedMediaError, SnapshotNotReadyError } from '../../src/lib/ringClient';
import { BedrockError, deterministicDescription } from '../../src/lib/bedrockClient';
import type { DoorEvent } from '../../src/types';

const BASE_EVENT: DoorEvent = {
  date: '2026-02-13',
  event_id: 'front_door_cam_motion_1786715596787',
  timestamp: '2026-02-13T13:39:57.200Z',
  occurred_at_ms: 1786715596787,
  device_id: 'front_door_cam',
  device_name: 'Front Door',
  event_type: 'motion_detected',
  sub_type: 'human',
  account_id: 'ava1.ring.account.XXXYYY',
  processed: false,
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function snapshotOk(overrides: Partial<Parameters<typeof describeEvent>[0]> = {}) {
  return describeEvent({
    event: BASE_EVENT,
    fetchSnapshot: async () => ({ bytes: JPEG, contentType: 'image/jpeg' }),
    describeImage: async () => 'A person places a medium box by the door',
    ...overrides,
  });
}

describe('describeEvent — happy path', () => {
  it('describes the image and marks the event processed', async () => {
    const result = await snapshotOk();
    expect(result).toEqual({
      description: 'A person places a medium box by the door',
      source: 'ai',
      processed: true,
      // Reported even though BASE_EVENT already had one, so the caller can persist it. This
      // shape grew when device-name resolution landed; the assertion is exact on purpose,
      // because a field appearing here is a change to what gets written back to the event.
      deviceName: 'Front Door',
    });
  });

  it('anchors the media window to the device clock, not the Lambda clock', async () => {
    const fetchSnapshot = vi.fn(async () => ({ bytes: JPEG, contentType: 'image/jpeg' }));
    await snapshotOk({ fetchSnapshot });
    // 1786715596787 - 5000, widened forward to give the recording time to exist.
    expect(fetchSnapshot).toHaveBeenCalledWith('front_door_cam', 1786715596787);
  });

  it('uploads the snapshot and returns its key', async () => {
    const putSnapshot = vi.fn(async () => 'snapshots/2026-02-13/evt.jpg');
    const result = await snapshotOk({ store: { putSnapshot } });
    expect(putSnapshot).toHaveBeenCalledWith(
      'snapshots/2026-02-13/front_door_cam_motion_1786715596787.jpg',
      JPEG,
      'image/jpeg',
    );
    expect(result.snapshotKey).toBe('snapshots/2026-02-13/evt.jpg');
  });
});

describe('device name resolution', () => {
  // Ring sends no device name in any webhook, so it has to be fetched with
  // GET /v1/devices/{id}. Every event stored before this feature therefore read "at the
  // door" in the FR11 fallback instead of the camera's actual name.
  const nameless = (): DoorEvent => {
    const { device_name: _omitted, ...rest } = BASE_EVENT;
    return rest;
  };

  it('puts the resolved name into the FR11 fallback sentence', async () => {
    const result = await describeEvent({
      event: nameless(),
      fetchSnapshot: async () => {
        throw new Error('media unavailable');
      },
      resolveDeviceName: async () => 'Front Door',
    });

    // This is the whole point: resolve BEFORE building the sentence, not after.
    expect(result.description).toBe('Person detected at Front Door');
    expect(result.deviceName).toBe('Front Door');
  });

  it('resolves the name even when Bedrock answers, and reports it for persistence', async () => {
    const result = await snapshotOk({
      event: nameless(),
      resolveDeviceName: async () => 'Front Door',
    });

    expect(result.source).toBe('ai');
    expect(result.deviceName).toBe('Front Door');
  });

  it('still writes a sentence when the lookup fails', async () => {
    // A name is cosmetic. Losing it must never cost the event its description.
    const result = await describeEvent({
      event: nameless(),
      fetchSnapshot: async () => {
        throw new Error('media unavailable');
      },
      resolveDeviceName: async () => {
        throw new Error('401 unauthorized');
      },
    });

    expect(result.description).toBe('Person detected at the door');
    expect(result.deviceName).toBeUndefined();
  });

  it('treats a blank name as no name rather than writing an empty string', async () => {
    const result = await snapshotOk({
      event: nameless(),
      resolveDeviceName: async () => '   ',
    });

    expect(result.deviceName).toBeUndefined();
  });

  it('trims what the API returns', async () => {
    const result = await snapshotOk({
      event: nameless(),
      resolveDeviceName: async () => '  Front Door  ',
    });

    expect(result.deviceName).toBe('Front Door');
  });

  it('makes no lookup at all when the event already has a name', async () => {
    // Ingress cannot know it, but a redelivered message re-reads a row that already has one.
    // Re-fetching would be a Ring API call for nothing.
    const resolveDeviceName = vi.fn(async () => 'Front Door');
    await snapshotOk({ resolveDeviceName });

    // BASE_EVENT carries a device_name, so the stage must not spend a call.
    expect(resolveDeviceName).not.toHaveBeenCalled();
  });
});

describe('describeEvent — every failure still yields a sentence', () => {
  it('falls back when Bedrock is unavailable (FR11)', async () => {
    const result = await snapshotOk({
      describeImage: async () => {
        throw new BedrockError('anthropic.claude-3-haiku', new Error('throttled'));
      },
    });
    expect(result.source).toBe('fallback');
    expect(result.description).toBe('Person detected at Front Door');
    expect(result.processed).toBe(true);
  });

  it('falls back when Bedrock returns empty text', async () => {
    const result = await snapshotOk({ describeImage: async () => '   ' });
    expect(result.source).toBe('fallback');
    expect(result.description).toBe('Person detected at Front Door');
  });

  it('degrades without retry on encrypted TAKE/E2EE media', async () => {
    const fetchSnapshot = vi.fn(async () => {
      throw new EncryptedMediaError('application/octet-stream');
    });
    const result = await snapshotOk({ fetchSnapshot });
    expect(result.source).toBe('fallback');
    expect(result.reason).toMatch(/encrypted/i);
    // One call only: retrying encrypted media cannot succeed.
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('leaves the event unprocessed on 425 so the queue can redeliver it', async () => {
    const result = await snapshotOk({
      fetchSnapshot: async () => {
        throw new SnapshotNotReadyError();
      },
    });
    expect(result.processed).toBe(false);
    expect(result.description).toBe('Person detected at Front Door');
  });

  it('falls back when the snapshot fetch fails for any other reason', async () => {
    const result = await snapshotOk({
      fetchSnapshot: async () => {
        throw new Error('socket hang up');
      },
    });
    expect(result.source).toBe('fallback');
    expect(result.reason).toMatch(/snapshot fetch failed/);
  });

  it('keeps the AI description when only the upload fails', async () => {
    const result = await snapshotOk({
      store: {
        putSnapshot: async () => {
          throw new Error('bucket unreachable');
        },
      },
    });
    // A missing image is cosmetic. A missing sentence is the product failure.
    expect(result.source).toBe('ai');
    expect(result.description).toBe('A person places a medium box by the door');
    expect(result.snapshotKey).toBeUndefined();
  });

  it('falls back when the event carries no usable timestamp', async () => {
    // exactOptionalPropertyTypes: the key is omitted rather than set to undefined.
    const { occurred_at_ms: _omitted, ...withoutTimestamp } = BASE_EVENT;
    const result = await describeEvent({
      event: { ...withoutTimestamp, timestamp: 'not a date' },
      fetchSnapshot: async () => ({ bytes: JPEG, contentType: 'image/jpeg' }),
      describeImage: async () => 'never called',
    });
    expect(result.source).toBe('fallback');
    expect(result.reason).toMatch(/no usable timestamp/);
  });
});

describe('deterministicDescription (FR11)', () => {
  it.each([
    ['human', 'Person detected at Front Door'],
    ['vehicle', 'Vehicle detected at Front Door'],
    ['motion', 'Motion detected at Front Door'],
    ['other_motion', 'Motion detected at Front Door'],
  ])('maps sub_type %s to a deterministic sentence', (subType, expected) => {
    expect(deterministicDescription({ sub_type: subType, device_name: 'Front Door' })).toBe(expected);
  });

  it('says nothing identifiable rather than guessing an unknown subtype', () => {
    // FR9's own wording for the nothing-to-report case. An unrecognised subtype must
    // not become a confident claim about a person.
    expect(deterministicDescription({ sub_type: 'alien_invasion', device_name: 'Front Door' })).toBe(
      'Nothing identifiable at Front Door',
    );
  });

  it('works with no sub_type at all', () => {
    expect(deterministicDescription({ device_name: 'Front Door' })).toBe(
      'Nothing identifiable at Front Door',
    );
  });

  it('degrades the location phrase when the device name is unknown', () => {
    expect(deterministicDescription({ sub_type: 'human' })).toBe('Person detected at the door');
    expect(deterministicDescription({ sub_type: 'human', device_name: '  ' })).toBe(
      'Person detected at the door',
    );
  });
});
