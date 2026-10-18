/**
 * Amazon Bedrock client for one-sentence image descriptions.
 *
 * Implements FR5 (send the snapshot to Bedrock for a one-sentence description), FR9 and
 * FR10 (the prompt constrains what may be described and how), and provides the
 * deterministic input for FR11's fallback.
 *
 * ## What is verified, and from where
 *
 * From `ARCHITECTURE.md` §3.3, read directly: model choice via `BEDROCK_MODEL_ID`,
 * `anthropic.claude-3-haiku` or `amazon.nova-lite-v1`; **max tokens 80**;
 * **temperature 0.2**; and the system prompt text, which this module uses as its base.
 *
 * ## The envelope is now verified against the AWS documentation
 *
 * **Fetched and checked 2026-10-04** against the Bedrock reference pages for the
 * Anthropic Claude Messages API. Confirmed correct:
 *
 * - `anthropic_version` must be exactly `bedrock-2023-05-31`, and `max_tokens` and
 *   `messages` are the two other **required** fields — all three are present.
 * - The image block shape is verbatim from the docs' own multimodal example:
 *   `{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }`.
 * - `system` is a valid optional field, and the response's text lives at
 *   `content[].text` where `extractText` looks first.
 *
 * **This verification found a real defect, which is why it was worth doing.** The docs
 * state that `stop_reason` is `max_tokens` when the generated text hit the token ceiling
 * — and in that case the `content` array **still contains text**. The original parser
 * returned it, so a description truncated mid-word would have been stored as a complete
 * sentence and marked `ai`. `extractText` now rejects that case and falls back to FR11's
 * deterministic sentence, which is worse-looking and honest. It also distinguishes a
 * content-classifier `refusal` (empty `content`) from a transport failure.
 *
 * **Still not verified:** that a real `InvokeModel` call returns this, in an account with
 * model access. No AWS account exists here. What is now confirmed is the *shape*; the
 * remaining risk is access and quota, not the envelope.
 *
 * ## The watermark, and why the prompt has an extra sentence
 *
 * Ring applies a **mandatory, unremovable** watermark to every image delivered through
 * the Partner API: the Ring logo top-left, and Device ID, App Name, and timestamp
 * top-right (added 8 June 2026, verified against the Ring docs 2026-09-28).
 *
 * The documented system prompt does not mention it. Feeding a watermarked image to a
 * vision model with that prompt invites the model to describe the overlay as scene
 * content — "a logo in the corner", "text reading device 12345" — which is exactly the
 * failure FR9 exists to prevent. So {@link SYSTEM_PROMPT} is the documented prompt plus
 * one appended sentence telling the model to ignore the overlay.
 *
 * **This is a deviation from the text specified in `ARCHITECTURE.md` §3.3 and FR9**, and
 * it is logged as decision D017. Revert it by deleting the appended clause; the rest of
 * the module is unaffected.
 */

/** `BEDROCK_MODEL_ID` from `ARCHITECTURE.md` §8.2. */
export const BEDROCK_MODEL_ENV = 'BEDROCK_MODEL_ID';

/** `ARCHITECTURE.md` §3.3. The docs also name this as a Bedrock cost control. */
export const MAX_TOKENS = 80;

/** `ARCHITECTURE.md` §3.3. */
export const TEMPERATURE = 0.2;

/**
 * The Anthropic-on-Bedrock API version field.
 *
 * Verified 2026-10-04: the AWS reference states the value "must be bedrock-2023-05-31",
 * which is what makes this a constant rather than a parameter.
 */
export const ANTHROPIC_VERSION = 'bedrock-2023-05-31';

/**
 * The documented system prompt (FR9, FR10), plus the watermark clause described above.
 *
 * The first paragraph is `ARCHITECTURE.md` §3.3 verbatim. The second is additive.
 */
export const SYSTEM_PROMPT = [
  'Describe only what is visible in this security camera snapshot. Use one sentence.',
  'Focus on: people, packages, vehicles, animals. Do not judge or label people.',
  'If nothing is identifiable, say \'Nothing identifiable.\'',
  'The image has a permanent watermark overlay in the corners containing a logo and',
  'device text. Ignore it completely: it is not part of the scene and must never be',
  'mentioned in the description.',
].join(' ');

/** Shown when Bedrock is unavailable. FR11 requires a deterministic local fallback. */
export const NOTHING_IDENTIFIABLE = 'Nothing identifiable';

export interface BedrockClientOptions {
  readonly modelId: string;
  readonly region: string;
  /** Injected for tests. Defaults to a real `BedrockRuntimeClient`. */
  readonly send?: (input: {
    modelId: string;
    contentType: string;
    accept: string;
    body: Uint8Array;
  }) => Promise<{ body: Uint8Array }>;
}

export class BedrockError extends Error {
  readonly modelId: string;

  constructor(modelId: string, cause: unknown) {
    super(`Bedrock invocation failed for model ${modelId}: ${describe(cause)}`);
    this.name = 'BedrockError';
    this.modelId = modelId;
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export function createBedrockClient(options: BedrockClientOptions) {
  const { modelId, region } = options;
  const send =
    options.send ??
    (async (input) => {
      // Imported lazily so the module loads without the AWS SDK present, which keeps
      // the test suite honest about what it is exercising.
      const { BedrockRuntimeClient, InvokeModelCommand } = await import(
        '@aws-sdk/client-bedrock-runtime'
      );
      const client = new BedrockRuntimeClient({ region });
      const response = await client.send(
        new InvokeModelCommand({
          modelId: input.modelId,
          contentType: input.contentType,
          accept: input.accept,
          body: input.body,
        }),
      );
      return { body: response.body as Uint8Array };
    });

  /**
   * One `InvokeModel` round trip, with the same failure contract for both callers.
   *
   * Factored out so the transport — the request envelope, the `send` seam, and the
   * extraction of text from whichever response shape the model used — exists once.
   */
  async function invoke(payload: unknown): Promise<string> {
    let response: { body: Uint8Array };
    try {
      response = await send({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: new TextEncoder().encode(JSON.stringify(payload)),
      });
    } catch (cause) {
      throw new BedrockError(modelId, cause);
    }
    return extractText(response.body, modelId);
  }

  /**
   * Describe an image in one sentence.
   *
   * @param imageBytes Raw JPEG bytes, as returned by the Ring media endpoint.
   */
  async function describeImage(imageBytes: Uint8Array): Promise<string> {
    return invoke({
      anthropic_version: ANTHROPIC_VERSION,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                // Bedrock wants standard base64, not the URL-safe variant.
                data: Buffer.from(imageBytes).toString('base64'),
              },
            },
            { type: 'text', text: 'Describe what is visible in this snapshot.' },
          ],
        },
      ],
    });
  }

  /**
   * Ask the same model a question in text, with no image.
   *
   * Used by `ARCHITECTURE.md` §3.6's daily summary, which is given the day's sentences
   * rather than the day's images. The prompt and the token budget are the caller's, not
   * this module's: `src/lib/daySummary.ts` owns the language, and this stays a transport.
   * The response envelope is identical to the image path, which is the claim that is not
   * verified — see the module header.
   */
  async function summariseText(
    text: string,
    options: { system?: string; maxTokens?: number } = {},
  ): Promise<string> {
    return invoke({
      anthropic_version: ANTHROPIC_VERSION,
      max_tokens: options.maxTokens ?? MAX_TOKENS,
      temperature: TEMPERATURE,
      ...(options.system !== undefined ? { system: options.system } : {}),
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    });
  }

  return { describeImage, summariseText, modelId, region };
}

export type BedrockClient = ReturnType<typeof createBedrockClient>;

/** Pull the assistant text out of an Anthropic-shaped response. */
function extractText(body: Uint8Array, modelId: string): string {
  let parsed: {
    content?: { type?: string; text?: string }[];
    // Nova and other models on Bedrock answer in a different shape.
    output?: { message?: string } | string;
    results?: { outputText?: string }[];
    // Verified against the Bedrock Claude request/response reference, 2026-10-04.
    stop_reason?: string;
  };
  try {
    parsed = JSON.parse(new TextDecoder().decode(body)) as typeof parsed;
  } catch (cause) {
    throw new BedrockError(modelId, cause);
  }

  const anthropic = parsed.content?.find((block) => block.type === 'text')?.text;
  if (typeof anthropic === 'string' && anthropic.trim().length > 0) {
    // A response cut off by the token budget still carries text, and returning it here
    // would store a sentence that stops mid-word as if the model had finished it. §3.3's
    // contract is one sentence, and a half-sentence presented as a whole one is worse than
    // the deterministic fallback it replaces.
    if (parsed.stop_reason === 'max_tokens') {
      throw new BedrockError(modelId, new Error('response was truncated at max_tokens'));
    }
    return anthropic.trim();
  }

  // Fallbacks for non-Anthropic models on the same Bedrock endpoint, so a model swap
  // does not require a code change.
  const nova = typeof parsed.output === 'object' ? parsed.output?.message : parsed.output;
  if (typeof nova === 'string' && nova.trim().length > 0) return nova.trim();

  const other = parsed.results?.[0]?.outputText;
  if (typeof other === 'string' && other.trim().length > 0) return other.trim();

  // An empty `content` array with stop_reason `refusal` is a content-classifier block, not
  // a transport failure. It is named distinctly so the reason reaches the logs; both end in
  // FR11's fallback, but they are not the same event.
  if (parsed.stop_reason === 'refusal') {
    throw new BedrockError(modelId, new Error('request was refused by the content classifier'));
  }

  throw new BedrockError(modelId, new Error('response contained no extractable text'));
}

/**
 * FR11's deterministic local summary, used when Bedrock is unavailable.
 *
 * Pure and synchronous by design: the fallback must not itself be able to fail, and it
 * must say the same thing for the same event every time. Device name is used when
 * known, and the human-readable location is used when the name is missing, because
 * "Person detected" alone is a worse sentence than "Person detected at Front Door".
 */
export function deterministicDescription(event: {
  sub_type?: string;
  device_name?: string;
}): string {
  const where = event.device_name?.trim() || 'the door';
  const what = describeSubType(event.sub_type);
  return `${what} at ${where}`;
}

function describeSubType(subType: string | undefined): string {
  switch (subType) {
    case 'human':
      return 'Person detected';
    case 'vehicle':
      return 'Vehicle detected';
    case 'motion':
      return 'Motion detected';
    case 'other_motion':
      return 'Motion detected';
    default:
      // An unrecognised subtype must not become a confident claim. FR9's own wording
      // for the nothing-to-report case is the honest default.
      return NOTHING_IDENTIFIABLE;
  }
}
