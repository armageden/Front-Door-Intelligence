**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §15, read directly. D001–D007 are paraphrases of that table's seven rows; D008–D013 were made during the tooling and webhook-ingress phases and are not in that table. D014–D021 were added by the describe and overlay-delivery phases, and are likewise absent from the spec's table. The ADR-lite format is this repository's own and is not a project artefact. Take the next unused ID; gaps are never filled.

<!-- docs-check:expect-absent test/handlers.test.ts tsconfig.build.json -->

# Design decisions (ADR-lite)

One paragraph per decision: what was decided, why, and what it replaced. This is the
append target for the docs-sync pass — when a task makes a real architectural choice,
add an entry here rather than editing an existing one.

Seeded from the v1 → v2 correction log in `ARCHITECTURE.md` §15, which is itself a
record of decisions taken during design. Entries below are paraphrases of that table,
kept here so they live in the navigation structure and do not drift out of date.

---

## D001 — Direct Lambda invoke replaces SNS between pipeline stages

**Date:** 2026-09-28. **Source:** `ARCHITECTURE.md` §15.

The pipeline previously chained its Lambda stages through SNS. It now invokes them
directly. The reason is debuggability: the architecture prioritises a linear, traceable
chain because the submission must be demonstrable live, and a direct invoke makes each
hop inspectable and its failure attributable to one stage.

## D002 — WebSocket API added as the overlay push mechanism

**Date:** 2026-09-28. **Source:** `ARCHITECTURE.md` §15.

The design originally had no real-time push path, which would have forced the Fire TV
app to poll. A WebSocket API is now the preferred transport, with app-side HTTP polling
retained as the fallback so the overlay still works if the socket cannot be established.

## D003 — Overlay is a custom React Native component, not KeplerCaptionsView

**Date:** 2026-09-28. **Source:** `ARCHITECTURE.md` §15.

An earlier draft cited `KeplerCaptionsView` as the Vega OS overlay API. It is a
closed-caption surface, not an overlay. The overlay must be a custom React Native
component that does not pause or interrupt playback (FR12). Anyone porting an existing
Android overlay will hit the related wall: Vega OS is Linux-based, uses React Native
with the New Architecture and Turbo Native Modules, and does not recognise Android
files.

## D004 — Webhook payloads treated as carrying no object detail

**Date:** 2026-09-28. **Source:** `ARCHITECTURE.md` §15.

An earlier draft implied the Ring webhook payload included bounding boxes and labels.
It does not. The Partner API sends only a coarse `sub_type` inside `data.attributes`,
so the webhook handler must normalise the payload into a structured event object before
any downstream stage can reason about it. Getting this wrong produces descriptions of
objects the system never received.

## D005 — One app, one primary track

**Date:** 2026-09-28. **Source:** `ARCHITECTURE.md` §15 and §3.7.

The design now states explicitly that one app can only be entered into one primary
track. The Alexa+ MCP server and the Bee context ingest are optional supporting
adapters within the Ring entry, not separate track submissions. This keeps FR16 and
FR17 honestly scoped as MAY.

## D006 — Kiro Crew usage recorded for AWS Builder qualification

**Date:** 2026-09-28. **Source:** `ARCHITECTURE.md` §15 and §7.

If Kiro Crew is used during development it must be documented in the Friction Log and
the README. Building with Kiro Crew alone qualifies for the AWS Builder mini-challenge,
so the decision to use it has to be visible to judges rather than left implicit.

## D007 — Friction Log carries a scoring weight

**Date:** 2026-09-28. **Source:** `ARCHITECTURE.md` §15 and §10.

The Friction Log is worth up to a 10% bonus on the final judging score, so it is
treated as a scored deliverable (FR18) rather than optional notes. That is why a
dedicated recipe exists at
[03-add-a-friction-log-entry](../00-how-to/03-add-a-friction-log-entry.md).

---

## Adding an entry

Write one paragraph, three fields, and do not renumber existing IDs:

- **What was decided** and **why** — the reasoning matters more than the outcome, since
  the next reader needs to know whether the constraint still holds.
- **Date** and **Source** — either a task, or a section of `ARCHITECTURE.md` or
  `prd.md` if the decision was already recorded there.

If a decision is already in `ARCHITECTURE.md` §15, add the entry here and leave the
correction log alone. If the decision changes something already written in this folder,
fix the affected file in the same pass — see
[04-run-a-docs-sync-pass](../00-how-to/04-run-a-docs-sync-pass.md).

---

## Toolchain decisions, 2026-09-28

These are not in `ARCHITECTURE.md` §15, which records product-architecture corrections
from v1. They were made during the tooling phase and are logged here because they
constrain every later phase.

### D008 — npm as the package manager

**Date:** 2026-09-28. **Source:** tooling phase.

There was no manifest and no lockfile, so the package manager was an open question and
the documentation explicitly refused to assume one. It is now npm, because
`ARCHITECTURE.md` §9.1 specifies `npm install` — so this follows the specification's
own choice rather than picking a personal preference. The deciding practical factor is
that npm 10.9+ resolves workspaces natively, and `ARCHITECTURE.md` §11 plans three
packages: root, `firetv/`, and `web/`. A second lockfile is the failure mode to avoid,
so the contract records npm as the package manager and the other installed tools —
pnpm and Yarn are on the machine but are not to be used.

### D009 — Bundle handlers with esbuild rather than transpiling with tsc

**Date:** 2026-09-28, revised the same day. **Source:** webhook-ingress phase.

TypeScript 7.0.2 removed `moduleResolution: node10`, so `tsconfig.json` uses
`module`/`moduleResolution` of `node16`. CommonJS rather than ESM, because AWS SAM's
default handler loading is simplest with it and an unnecessary module-format decision
is one less thing to debug against real hardware.

**The build step changed after the first version of this entry.** The original plan was
a `tsconfig.build.json` extending the base config with `rootDir: src`, so `npm run
build` would run `tsc` and emit loose files to `dist/`. That was right about the
`rootDir` problem — without it, handler paths come out as `dist/src/handlers/…` instead
of the `dist/handlers/…` SAM expects — but it was **wrong about the AWS SDK**.

The AWS SDK v3 is not present in the Node.js Lambda runtime, and `tsc` only transpiles:
it never copies `node_modules`. A `dist/` of loose compiled files therefore deploys a
Lambda that starts cleanly and then dies on the first webhook with a module-not-found
for `@aws-sdk/client-dynamodb`. Nothing in `sam build` reports this.

The build is now `scripts/build-lambda.mjs`, which bundles each file in
`src/handlers/` with esbuild into a self-contained CommonJS file at `dist/handlers/…`,
with `outbase` pinned to `src/` so the directory structure survives the single-entry
case. `tsconfig.build.json` was deleted; `tsc` now runs `--noEmit` only, which still
typechecks `test/` along with `src/`.

The deciding factor was testability. Bundling claims to produce a self-contained
artifact, and that claim is cheap to check: `npm run build:verify` walks `dist/`,
enumerates every `require()` call, and fails if any resolves to a package that was not
inlined. The failure mode above is otherwise invisible until production. That is also
why the CI workflow runs `build:verify` — a bundle that cannot require its own
dependencies would otherwise pass CI and fail in AWS.

### D010 — vitest, chosen to make a metric possible

**Date:** 2026-09-28. **Source:** tooling phase.

The test runner is vitest with the v8 coverage provider, rather than Node's built-in
`node:test`. The deciding reason is that a coverage provider was needed: the project had
no mechanical metric of any kind, which made an autonomous optimisation loop
impossible to run honestly. vitest supplies one —
`coverage-summary.json` → `total.lines.pct` — in under a second. It read 100% with a
single module under test, which showed the metric was real but useless at that size; it
read 84.47% across seven test files after the describe stage landed, with the remainder
being AWS-only paths. That is the shape that makes it worth optimising against.

`ARCHITECTURE.md` §11 planned a bare `test/handlers.test.ts` with no runner named, so
this fills a gap in the specification rather than contradicting it.

### D011 — No linter, deliberately

**Date:** 2026-09-28. **Source:** tooling phase.

A linter was considered and left out. `npm run typecheck` is strict and already fails
the build on type errors, which is the correctness gate; a linter is a second opinion
on style, and a second opinion nobody has asked for is a cost with no benefit this
stage. The contract records `lint` as `unavailable` with that reason, so the gap is
visible and gets revisited when style drift becomes a real problem rather than being
quietly forgotten.

### D012 — Signature verification trusts a raw-body assumption, flagged in code

**Date:** 2026-09-28. **Source:** tooling phase.

`signatureVerifier.ts` verifies an `X-Signature` HMAC-SHA256 header, which is what
`ARCHITECTURE.md` §3.1, §5.1, and §6 call for. But `ARCHITECTURE.md` never states which
bytes Ring signs, so the implementation assumes the raw request body and says so in a
module-level comment. `ARCHITECTURE.md` §12 already rates signature verification as
medium likelihood and high impact.

The decision is to implement the assumption rather than skip the module, and to make the
assumption impossible to miss. If the assumption is wrong, every webhook fails
`signature_mismatch` and the pipeline produces nothing while appearing healthy — the
worst failure mode available, which is why it is documented in the code, in
[01-signature-verification](../04-libraries/01-signature-verification.md), and in the
contract's limitations, and queued for confirmation against the Ring sandbox.

### D013 — 401 for a bad signature, 200 for a duplicate, 500 for anything unexpected

**Date:** 2026-09-28. **Source:** webhook-ingress phase.

Ring's delivery semantics make status codes a safety property rather than a REST
convention: **4xx is a permanent failure with no retry**, and "if Ring receives
persistent 4xx errors (e.g., 10+ consecutive failures over 24 hours), Ring **may disable
your webhook endpoint**" (verified 2026-09-28). The whole status mapping follows from
that one fact.

- **Bad signature → 401.** A forgery must not be accepted, and dropping it permanently
  is correct — you never want a forgery retried. The residual risk is that a
  misconfigured secret produces 10+ consecutive 401s and the endpoint is disabled. That
  is the right failure: a silently broken pipeline is worse than an outage that gets
  noticed.
- **Duplicate `request_id` → 200, never 4xx.** Ring retried because it never saw a 2xx.
  The event is already stored, so 2xx is truthful and stops the retry loop.
- **Unhandled event type → 200.** Ring sending `device_online` is not an error. 4xx
  would start a retry storm over something harmless and could accumulate toward the
  disable threshold.
- **Unexpected internal error → 500.** A DynamoDB failure is transient, and 4xx would
  convert a retryable fault into a permanent one. This is the least obvious of the four
  and the most expensive to get wrong, so it has its own test asserting a storage error
  yields 500 and never leaks internal detail to Ring.

The alternative — returning 200 for everything, as the official starter effectively does
by short-circuiting an unset env var — would satisfy the delivery contract by accepting
unauthenticated traffic. Rejected.

### D014 — The event date partition key is UTC, not the homeowner's local date

**Date:** 2026-09-28. **Source:** webhook-ingress phase.

`ARCHITECTURE.md` §3.5 partitions the events table by `date` and describes it as
`YYYY-MM-DD`, without saying whose day. The ingress handler derives it in **UTC**, so
the partition key is deterministic regardless of where the Lambda runs and does not
depend on an unset `TZ`.

This is a real product limitation, not an oversight. A homeowner's "today's events"
query and the 9:00 PM local daily summary (§3.6) both need **local** dates, so a UTC
partition means a homeowner in GMT+8 sees their evening events filed under tomorrow.
Resolving that needs the account's timezone, which arrives with `meta.account_id` and
device metadata rather than in the webhook. Deferred to the daily-summary phase, where
the query path has to confront it anyway.

The alternative — deriving the date from the Lambda's local time — was rejected because
it makes stored data depend on execution environment, which is exactly the kind of
invisible coupling that breaks during a region move.

### D015 — Hand-rolled Ring client, with no SDK to lean on

**Date:** 2026-09-28. **Source:** Ring-client phase.

There is no official Ring Partner SDK — the documentation states plainly, "Use
standard HTTP libraries." So `src/lib/ringClient.ts` is written directly against the
documented HTTP surface: OAuth token exchange, `GET /v1/devices/{id}`, and the
two-request media download.

Two choices inside it are worth recording because both are counter-intuitive.

**`redirect: 'manual'` on the snapshot request.** The media endpoint answers 303 with a
pre-signed URL, and the default `redirect: 'follow'` would consume it and discard the
`X-Media-Timestamp` and `X-Media-Origin` headers. Those headers are the only record of
when the media was captured — the difference between a snapshot and a recording, and
therefore between describing the moment the doorbell fired and describing something
that happened later. Following the redirect automatically throws away exactly the
information the AI layer needs.

**Errors are split by what the caller should do, not by status code alone.** 425 becomes
`SnapshotNotReadyError` and explicitly does not retry, because retrying the same window
cannot produce a recording that does not exist yet. A non-image response becomes
`EncryptedMediaError` so the caller degrades to the FR11 fallback rather than looping.
Collapsing these into one `RingApiError` would push a decision that needs domain
knowledge — retry, or give up and describe nothing? — into every future call site.

### D016 — Encrypted media is detected by absence, not by a status code

**Date:** 2026-09-28. **Source:** Ring-client phase.

Ring documents that TAKE and E2EE devices "return encrypted content" so the app "cannot
read recordings or snapshots", but publishes **no** status code or content type for that
case. The client therefore does not match on a guessed code. It checks the one property
it can verify — that the response is actually an image — and raises
`EncryptedMediaError` if not.

This is an inference and is labelled as one in the module and in
[03-ring-client](../04-libraries/03-ring-client.md). The reasoning: we requested an image
and did not receive one, whatever the underlying cause. The alternative, hardcoding a
speculative status code, would look more precise while being less likely to be right, and
would silently degrade to retrying instead of falling back — which is the failure mode
that makes a doorbell product look broken rather than honest.

`receivedContentType` is kept on the error so the real signal can be identified once
Ring documents it. That is a one-line change when it does.

### D017 — One sentence added to the specified Bedrock prompt

**Date:** 2026-09-28. **Source:** describe-stage phase.

`SYSTEM_PROMPT` is the `ARCHITECTURE.md` §3.3 text verbatim **plus one appended
sentence** telling the model to ignore the image's watermark overlay. This is a
deviation from the specified prompt and is recorded here rather than made silently.

Ring applies a mandatory, unremovable watermark to every Partner API image: Ring logo
top-left, Device ID, App Name, and timestamp top-right (added 8 June 2026, verified).
The specified prompt never mentions it. A vision model given a watermarked image and
that prompt will describe the overlay as scene content — "a logo in the corner", "text
reading device 12345" — and FR9 exists precisely to prevent descriptions of things that
are not the scene. The failure would land on *every* event, because the watermark is on
every image.

Shipping the prompt exactly as written and watching the model narrate Ring's watermark
throughout a demo was judged worse than a one-sentence deviation. Revert by deleting the
appended clause; nothing else depends on it.

### D018 — SQS hand-off instead of a direct Lambda invoke

**Date:** 2026-09-28. **Source:** describe-stage phase.

`ARCHITECTURE.md` §3.2 specifies "Direct Lambda invoke from WebhookHandler" for the
snapshot fetcher. **That was not built.** Ingress stores the event, sends an
identifiers-only SQS message, and returns; the describe stage consumes the queue.

The reason is NFR1's 5-second webhook budget. The verified media flow is two round
trips plus a 303, and Bedrock adds seconds — neither fits alongside signature
verification and two DynamoDB writes. The Ring documentation names this exact mistake:
doing heavy processing in the handler "exceeds 5-second timeout, causes duplicates". A
direct invoke from a Lambda is also synchronous unless something else decouples it, so
the word "direct" was solving a problem the spec did not state.

The queue message carries identifiers only. SQS caps a message at 256 KB, so an image
would fail at runtime rather than at validation, and the events table is already the
source of truth — the queue is a signal, not a record. The consumer re-reads the event
rather than trusting the message.

### D019 — Every failure path still writes a description

**Date:** 2026-09-28. **Source:** describe-stage phase.

`describeEvent` returns a description on every path except one: an infrastructure error
that prevents writing to DynamoDB. Bedrock unavailable, empty model output, encrypted
TAKE/E2EE media, a failed snapshot fetch, a failed upload, and a missing timestamp all
still produce a sentence — most via FR11's deterministic fallback, and a failed upload
via the AI description it already obtained.

The product promise is a sentence about what happened. A silent failure produces an
alert the user never sees, which is the exact problem this project exists to fix, so a
missing description is a worse outcome than a boring one. `description_source` is
persisted as `'ai'` or `'fallback'` so the distinction stays visible and countable
rather than being flattened.

The one exception is 425, which leaves `processed: false` so the queue redelivers: that
failure is early rather than terminal, and marking it processed would discard a
recoverable event.

### D020 — A connections table, which `ARCHITECTURE.md` §11 does not list

**Date:** 2026-09-28. **Source:** overlay-delivery phase.

A DynamoDB table of live WebSocket connection ids was added. §11's planned tree does not
contain it, so this is a gap in the plan being filled rather than a departure from it.

It is not an optimisation. API Gateway owns the socket and delivers the connection id to
`$connect` **once, and nowhere else**; `PostToConnection` needs that id to push anything
at all. A module-level array cannot substitute: Lambda invocations are stateless, so two
concurrent instances would each hold half the connections and neither would know about
the other's, and every event would reach roughly half the screens, intermittently.

Rows carry a 24-hour TTL, but the TTL is only a growth bound. The real mechanism is
`GoneException` on the next push, which prunes the row on the spot — so the table
converges on reality without a sweeper job, and the TTL only needs to outlive a Fire TV
that is merely asleep.

### D021 — The picture-in-picture is not implemented, and the reason is a platform limit

**Date:** 2026-09-28. **Source:** overlay-delivery phase.

`ARCHITECTURE.md` §3.4 specifies a PiP overlay that appears over whatever the user is
watching without interrupting playback. **This is not implementable as specified on Vega
OS**, verified against the documentation on 2026-09-28:

- No system-level overlay, picture-in-picture, or heads-up API exists in any of the 38
  documented Vega APIs. Overlaying *another app's* video has no documented path.
- Overlaying **your own** video works, but only through a transparent
  `@amazon-devices/webview` sibling of `KeplerVideoSurfaceView`. React Native `zIndex`
  and `elevation` do not reach the hardware video layer, so a plain absolutely-positioned
  view silently renders underneath — the failure a community thread documents someone
  already hitting.
- `useToastKepler`, the closest system surface, is text-and-icon with a fixed SHORT or
  LONG duration, so it cannot express FR14's 15-second auto-dismiss.
- Focus selection **ignores z-order**, so FR13's dismiss button would not be reachable by
  D-pad navigation over a content grid.

What was built instead is the delivery half: the §3.4 payload, per-connection fan-out,
and the connection registry. All of that is specified, implementable, and
track-independent. The rendering decision is deferred to the author because it depends
on the track choice — Fire OS Android has documented heads-up notifications that float
over content, which Vega does not, and the rules permit either OS.

**FR6 is at risk regardless.** The path is now three queue hops, and the Bedrock call
alone is several seconds, against an 8-second budget. Unmeasured.

### D022 — A static `X-Query-Key` guards `GET /events/today`, because the spec names no auth

**Date:** 2026-09-28. **Source:** query phase.

`POST /webhook/ring` is authenticated by an HMAC over the body — Ring holds the secret,
so the project never issues or checks a caller identity, and FR2 covers it. `GET
/events/today` has no such partner, and **`ARCHITECTURE.md` §4.2 and §5.2 specify the
endpoint without naming any auth mechanism.** §6's mitigation table does not mention it
either. A literal reading of the spec is a public endpoint returning a homeowner's door
activity to anyone who guesses the URL.

The endpoint requires `X-Query-Key`, compared in constant time via `timingSafeEqual`
against `QUERY_API_KEY`. **It fails closed**: a missing environment variable throws and
becomes a 500, rather than the endpoint deciding that everyone is allowed. Two tests
assert both halves.

This is the minimum that makes the endpoint safe to ship, and it is recorded here as a
design choice the spec did not make rather than something derived from it. It is not
adequate for a real multi-user product — a static key does not distinguish one homeowner
from another, and one table holds one homeowner's data. A real authorizer (IAM, or
Cognito on the HTTP API) plus per-account partitioning are the correct answers and are
left as follow-ups. The IAM policy is already narrowed to match: `dynamodb:Query` and
`s3:GetObject` only, with no write action on the table.

### D023 — "Today" is the UTC partition, overridable by `?date=`, and a bad date is a 400

**Date:** 2026-09-28. **Source:** query phase.

FR8 asks for "all events for the current day". The partition key is **UTC** (D014), and
that is the only partition a `Query` addresses cheaply — so the endpoint defaults to the
UTC date and accepts `?date=YYYY-MM-DD` for anything else. A client that wants a
homeowner's local day asks for the partition it wants.

Rejected: silently serving the UTC day and calling it "today". For part of every day that
is a plausible-looking wrong answer, and the client cannot tell. Rejected also:
computing local time in the handler, which is the execution-environment coupling D014
already rejected once.

A malformed `?date=` returns **400 `invalid_date`**. Falling back to today would hide the
caller's own bug behind a well-formed response, and a wrong date that quietly returns the
right-looking answer is among the hardest bugs to find. `2026-02-31` is rejected too —
well-formed but not a real date, so it can never hold a partition.

The response also splits §5.2's `event_type: "motion.human"` into the two real fields,
`event_type: "motion_detected"` and `sub_type: "human"`, which is the same correction
FR3 required of the ingress path, and adds `processed`, a nullable `description`, and
`truncated` so a capped response never reports a quietly wrong `count`.

### Related

- [01-system-overview](./01-system-overview.md) — the design these decisions produced
- [05-security-and-services](./05-security-and-services.md) — the current threat posture
