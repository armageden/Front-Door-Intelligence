**Back:** [00-overview](./00-overview.md)

**Verified against:** `src/lib/bedrockClient.ts` → `createBedrockClient()`, `describeImage()`, `deterministicDescription()`, `SYSTEM_PROMPT`, `MAX_TOKENS`, `TEMPERATURE`, `BedrockError`, read in full; `test/handlers/snapshotFetcher.test.ts` → the fallback matrix; constants traced to `ARCHITECTURE.md` §3.3 and §8.2. **Not verified in this session:** the Bedrock request envelope — no AWS documentation was fetched while writing this.

# Bedrock client

One-sentence image descriptions. Implements **FR5**, carries the **FR9**/**FR10**
prompt constraint, and supplies the **FR11** deterministic fallback.

## Exported surface

| Export | Kind | Purpose |
|---|---|---|
| `createBedrockClient(options)` | factory | Returns `{ describeImage, modelId, region }`. `options.send` is injected in tests, so the AWS SDK is never reached |
| `describeImage(bytes)` | method | JPEG bytes → one-sentence description |
| `deterministicDescription(event)` | function | **Pure and synchronous.** FR11's local summary |
| `SYSTEM_PROMPT` | const | The FR9/FR10 prompt, plus one watermark clause — see below |
| `MAX_TOKENS` | const | `80`, from `ARCHITECTURE.md` §3.3 |
| `TEMPERATURE` | const | `0.2`, from §3.3 |
| `ANTHROPIC_VERSION` | const | `bedrock-2023-05-31` — **not verified in this session** |
| `NOTHING_IDENTIFIABLE` | const | `'Nothing identifiable'` — FR9's own wording |
| `BedrockError` | error class | Carries `modelId` |
| `BEDROCK_MODEL_ENV` | const | `'BEDROCK_MODEL_ID'` |

## The prompt, and one deviation you should know about

`SYSTEM_PROMPT` is the `ARCHITECTURE.md` §3.3 text **verbatim**, plus a single appended
sentence:

> The image has a permanent watermark overlay in the corners containing a logo and
> device text. Ignore it completely: it is not part of the scene and must never be
> mentioned in the description.

**This is a deviation from the specified prompt in FR9 and §3.3.** It is made
deliberately and logged as decision D017.

Ring applies a **mandatory, unremovable watermark** to every image from the Partner
API — Ring logo top-left, Device ID, App Name, and timestamp top-right, added 8 June
2026 and verified against the Ring docs. The specified prompt never mentions it. Feeding
a watermarked image to a vision model with that prompt invites the model to describe the
overlay as scene content: *"a logo in the corner"*, *"text reading device 12345"*. That
is precisely the failure FR9 exists to prevent, and it would arrive on **every single
event**, because the watermark is on every image.

The alternative — shipping the prompt exactly as specified and watching the model
describe Ring's watermark in front of judges — was worse. Revert by deleting the
appended clause; nothing else in the module depends on it.

## Response shapes, three of them

`extractText` handles the Anthropic `content[].text` shape first, then two
non-Anthropic shapes (`output.message` and `results[0].outputText`). The extras exist
because `ARCHITECTURE.md` §3.3 offers `amazon.nova-lite-v1` as an alternative to Claude,
and a model swap should not require a code change. If none match, it throws rather than
returning an empty string, so the caller takes the FR11 fallback instead of storing a
blank description.

## FR11's fallback is pure on purpose

`deterministicDescription` is synchronous, has no I/O, and returns the same string for
the same event every time.

| `sub_type` | Result |
|---|---|
| `human` | `Person detected at <name>` |
| `vehicle` | `Vehicle detected at <name>` |
| `motion`, `other_motion` | `Motion detected at <name>` |
| anything else, or absent | `Nothing identifiable at <name>` |

Two choices in that table:

- **An unrecognised subtype produces FR9's own "Nothing identifiable" wording**, not a
  guess. A wrong-but-confident description is worse than an honest one, and FR9
  specifies this exact phrase for the nothing-to-report case.
- **The location degrades rather than disappearing.** With no device name it reads
  "at the door" instead of dropping the phrase. `device_name` is not in any Ring
  webhook, so this branch is the common one, not an edge case.

## What is not verified

**The request envelope.** `describeImage` builds the standard Claude-on-Bedrock
`InvokeModel` shape: `anthropic_version`, `max_tokens`, `temperature`, a `system`
prompt, and a `messages` array with one image block and one text block. No AWS
documentation was fetched in this session, so treat the envelope as a well-founded
default rather than a confirmed one. It is the most likely thing to need adjusting on
first real invocation, and the failure mode is loud — an API error, caught and turned
into `BedrockError`, then handled by the FR11 fallback.

What *is* verified: the model id, max tokens, temperature, and prompt text all come from
`ARCHITECTURE.md` §3.3 read directly.

## Cost controls

`MAX_TOKENS = 80` and `TEMPERATURE = 0.2` are the two levers `ARCHITECTURE.md` §6 names
for "Bedrock cost runaway", alongside a CloudWatch billing alarm that **is not
configured** — no alarm is declared in `template.yaml`. That gap is recorded in
[01-current-state](../03-repository/01-current-state.md) and is the author's to close
once an account exists.

## Related

- The stage that calls this: [02-describe-stage](../06-handlers/02-describe-stage.md)
- The Ring client that produces the bytes: [03-ring-client](./03-ring-client.md)
- The design intent: [02-pipeline-components](../02-architecture/02-pipeline-components.md)
- Prompt and model requirements: [01-requirements-index](../01-product/01-requirements-index.md)
