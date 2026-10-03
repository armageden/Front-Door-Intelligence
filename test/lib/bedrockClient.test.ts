/**
 * Tests for the Bedrock client and the snapshot store.
 *
 * The Bedrock request envelope is the thing most likely to need adjustment on first
 * real invocation, so it is asserted here in full rather than mocked away. The
 * documented model, token, and temperature settings are asserted separately, because
 * those come from `ARCHITECTURE.md` and are the parts we can actually verify.
 *
 * No AWS account and no network. `send` and `put` are injected.
 */

import { describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import {
  ANTHROPIC_VERSION,
  BedrockError,
  MAX_TOKENS,
  SYSTEM_PROMPT,
  TEMPERATURE,
  createBedrockClient,
} from '../../src/lib/bedrockClient';
import { createSnapshotStore, snapshotKey } from '../../src/lib/snapshotStore';
import type { DoorEvent } from '../../src/types';

const MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

/** The exact shape `createBedrockClient` hands to its injected `send`. */
interface SendInput {
  modelId: string;
  contentType: string;
  accept: string;
  body: Uint8Array;
}
type Send = (input: SendInput) => Promise<{ body: Uint8Array }>;

/**
 * vitest 5's MockInstance is not directly assignable to a callable seam, so keep the
 * spy for assertions and hand the client a plain function that forwards to it. Same
 * pattern as the sleep seam in ringClient's tests.
 */
function okWith(body: unknown): { spy: MockInstance<Send>; send: Send } {
  const spy = vi.fn<Send>(async () => ({
    body: new TextEncoder().encode(JSON.stringify(body)),
  }));
  return { spy, send: (input) => spy(input) };
}

/** The body actually sent, decoded. */
/** For the non-JSON body cases, where the raw bytes matter. */
function okWithRaw(raw: string): { spy: MockInstance<Send>; send: Send } {
  const spy = vi.fn<Send>(async () => ({ body: new TextEncoder().encode(raw) }));
  return { spy, send: (input) => spy(input) };
}

function sentBody(send: MockInstance<Send>): Record<string, unknown> {
  const call = send.mock.calls[0];
  if (!call) throw new Error('nothing was sent');
  return JSON.parse(new TextDecoder().decode(call[0].body)) as Record<string, unknown>;
}

function clientWith(bundle: { spy: MockInstance<Send>; send: Send }) {
  return createBedrockClient({ modelId: MODEL, region: 'us-east-1', send: bundle.send });
}

describe('the request envelope', () => {
  it('carries the model id, region, and JSON content type', async () => {
    const { spy: send, send: wire } = okWith({ content: [{ type: 'text', text: 'A person at the door' }] });
    await clientWith({ spy: send, send: wire }).describeImage(JPEG);

    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0];
    if (!call) throw new Error('nothing was sent');
    expect(call[0].modelId).toBe(MODEL);
    const input = call[0];
    expect(input.contentType).toBe('application/json');
    expect(input.accept).toBe('application/json');
  });

  it('sends one image block with standard base64 and one text block', async () => {
    const { spy: send, send: wire } = okWith({ content: [{ type: 'text', text: 'ok' }] });
    await clientWith({ spy: send, send: wire }).describeImage(JPEG);

    const body = sentBody(send) as unknown as {
      anthropic_version: string;
      max_tokens: number;
      temperature: number;
      system: string;
      messages: { role: string; content: { type: string; source?: Record<string, string> }[] }[];
    };

    expect(body.anthropic_version).toBe(ANTHROPIC_VERSION);
    const [message] = body.messages;
    expect(message?.role).toBe('user');
    const image = message?.content.find((b) => b.type === 'image');
    expect(image?.source?.['media_type']).toBe('image/jpeg');
    // Standard base64, not the URL-safe variant Bedrock would not accept.
    expect(image?.source?.['data']).toBe(Buffer.from(JPEG).toString('base64'));
    expect(image?.source?.['data']).not.toContain('-');
    expect(message?.content.some((b) => b.type === 'text')).toBe(true);
  });

  it('uses the documented cost and determinism settings', async () => {
    const { spy: send, send: wire } = okWith({ content: [{ type: 'text', text: 'ok' }] });
    await clientWith({ spy: send, send: wire }).describeImage(JPEG);
    const body = sentBody(send) as { max_tokens: number; temperature: number };

    // ARCHITECTURE.md §3.3: max tokens 80, temperature 0.2. Both are named there as
    // the Bedrock cost-runaway controls in §6.
    expect(body.max_tokens).toBe(80);
    expect(body.temperature).toBe(0.2);
    expect(MAX_TOKENS).toBe(80);
    expect(TEMPERATURE).toBe(0.2);
  });

  it('instructs the model to ignore the Ring watermark', () => {
    // Decision D017: a deliberate one-sentence deviation from ARCHITECTURE.md §3.3.
    expect(SYSTEM_PROMPT).toMatch(/watermark/i);
    expect(SYSTEM_PROMPT).toMatch(/ignore it completely/i);
    // The specified constraints are still present verbatim.
    expect(SYSTEM_PROMPT).toContain('Describe only what is visible in this security camera snapshot.');
    expect(SYSTEM_PROMPT).toContain('Do not judge or label people.');
    expect(SYSTEM_PROMPT).toContain("Nothing identifiable.");
  });
});

describe('response shapes', () => {
  it('reads the Anthropic content block', async () => {
    const { spy: send, send: wire } = okWith({ content: [{ type: 'text', text: '  A person places a box.  ' }] });
    await expect(clientWith({ spy: send, send: wire }).describeImage(JPEG)).resolves.toBe('A person places a box.');
  });

  it('skips non-text content blocks', async () => {
    const { spy: send, send: wire } = okWith({ content: [{ type: 'tool_use' }, { type: 'text', text: 'Someone waits.' }] });
    await expect(clientWith({ spy: send, send: wire }).describeImage(JPEG)).resolves.toBe('Someone waits.');
  });

  it('reads a Nova-shaped output, so a model swap needs no code change', async () => {
    const { spy: send, send: wire } = okWith({ output: { message: 'A vehicle arrives.' } });
    await expect(clientWith({ spy: send, send: wire }).describeImage(JPEG)).resolves.toBe('A vehicle arrives.');
  });

  it('reads a plain-string output', async () => {
    const { spy: send, send: wire } = okWith({ output: 'A box is left.' });
    await expect(clientWith({ spy: send, send: wire }).describeImage(JPEG)).resolves.toBe('A box is left.');
  });

  it('reads a results[].outputText shape', async () => {
    const { spy: send, send: wire } = okWith({ results: [{ outputText: 'Nothing in view.' }] });
    await expect(clientWith({ spy: send, send: wire }).describeImage(JPEG)).resolves.toBe('Nothing in view.');
  });

  it.each([
    ['an unparseable body', 'not json at all'],
    ['a response with no text', JSON.stringify({ content: [] })],
    ['a response with only whitespace text', JSON.stringify({ content: [{ type: 'text', text: '  ' }] })],
  ])('throws BedrockError for %s rather than returning an empty sentence', async (_label, body) => {
    const { spy: send, send: wire } = okWithRaw(body);
    const error = await clientWith({ spy: send, send: wire })
      .describeImage(JPEG)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BedrockError);
    expect((error as BedrockError).modelId).toBe(MODEL);
  });

  it('wraps a transport failure as BedrockError naming the model', async () => {
    const send = vi.fn<Send>(async () => {
      throw new Error('AccessDeniedException');
    });
    const wire: Send = (input) => send(input);
    const error = await clientWith({ spy: send, send: wire })
      .describeImage(JPEG)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BedrockError);
    expect((error as Error).message).toContain(MODEL);
    expect((error as Error).message).toContain('AccessDeniedException');
  });
});

describe('snapshotStore', () => {
  const EVENT: DoorEvent = {
    date: '2026-02-13',
    event_id: 'evt_abc123',
    timestamp: '2026-02-13T13:39:57.200Z',
    occurred_at_ms: 1786715596787,
    device_id: 'front_door_cam',
    event_type: 'motion_detected',
    sub_type: 'human',
    processed: false,
  };

  it('keys snapshots by date, mirroring the table partition', () => {
    expect(snapshotKey(EVENT)).toBe('snapshots/2026-02-13/evt_abc123.jpg');
  });

  it('prefers an existing key over a computed one, so a re-run cannot orphan an object', () => {
    expect(snapshotKey({ ...EVENT, snapshot_s3_key: 'custom/key.jpg' })).toBe('custom/key.jpg');
  });

  it('uploads with an explicit content type and returns the key', async () => {
    const put: MockInstance<(i: unknown) => Promise<void>> = vi.fn().mockResolvedValue(undefined);
    const store = createSnapshotStore({ bucket: 'front-door-snapshots', put: put as never });
    const key = await store.putSnapshot('snapshots/x.jpg', JPEG);

    expect(key).toBe('snapshots/x.jpg');
    const input = put.mock.calls[0]?.[0] as { bucket: string; contentType: string; bytes: Uint8Array };
    expect(input.bucket).toBe('front-door-snapshots');
    // Not application/octet-stream: that would break the pre-signed URL path.
    expect(input.contentType).toBe('image/jpeg');
    expect(input.bytes).toBe(JPEG);
  });

  it('enqueues identifiers only, including the timestamp the consumer needs', async () => {
    const send: MockInstance<(i: unknown) => Promise<unknown>> = vi
      .fn()
      .mockResolvedValue({ MessageId: 'msg-1' });
    const store = createSnapshotStore({ bucket: 'b', send: send as never });

    const messageId = await store.enqueueForDescribe(EVENT, 'https://sqs.test/queue');
    expect(messageId).toBe('msg-1');

    const body = JSON.parse(
      String((send.mock.calls[0]?.[0] as { body: string }).body),
    ) as Record<string, unknown>;

    // Never the image, and never a description that does not exist yet.
    expect(body).not.toHaveProperty('image');
    expect(body).not.toHaveProperty('bytes');
    // The consumer rebuilds the sort key timestamp#event_id from this.
    expect(body['timestamp']).toBe('2026-02-13T13:39:57.200Z');
    expect(body['occurred_at_ms']).toBe(1786715596787);
    expect(body['device_id']).toBe('front_door_cam');
    expect(body['sub_type']).toBe('human');
    expect(JSON.stringify(body).length).toBeLessThan(1024);
  });

  it('tolerates a queue response with no message id', async () => {
    const send = vi.fn(async () => ({}));
    const store = createSnapshotStore({ bucket: 'b', send: send as never });
    await expect(store.enqueueForDescribe(EVENT, 'https://sqs.test/queue')).resolves.toBeUndefined();
  });
});

describe('summariseText', () => {
  it('sends text and no image, with the caller system prompt and token budget', async () => {
    const { send, spy } = okWith({ content: [{ type: 'text', text: 'A quiet day.' }] });
    const client = createBedrockClient({ modelId: MODEL, region: 'us-east-1', send });

    await client.summariseText('UTC date: 2026-02-13', {
      system: 'Summarize it.',
      maxTokens: 400,
    });

    const body = sentBody(spy);
    expect(body['system']).toBe('Summarize it.');
    expect(body['max_tokens']).toBe(400);
    expect(body['temperature']).toBe(TEMPERATURE);
    expect(JSON.stringify(body)).not.toContain('image');
  });

  it('uses the same envelope version as the image path', async () => {
    // One wire format, one version: if these ever diverge it is a bug, not a feature.
    const { send, spy } = okWith({ content: [{ type: 'text', text: 'A quiet day.' }] });
    const client = createBedrockClient({ modelId: MODEL, region: 'us-east-1', send });

    await client.summariseText('anything');

    const body = sentBody(spy);
    expect(body['anthropic_version']).toBe(ANTHROPIC_VERSION);
    expect(body['max_tokens']).toBe(MAX_TOKENS);
    expect(body).not.toHaveProperty('system');
  });

  it('raises the same BedrockError the image path raises', async () => {
    const send = vi.fn<Send>(async () => {
      throw new Error('throttled');
    });
    const client = createBedrockClient({ modelId: MODEL, region: 'us-east-1', send });

    await expect(client.summariseText('anything')).rejects.toBeInstanceOf(BedrockError);
  });
});
