# Friction Log — Front Door Intelligence

Amazon Developer Hackathon 2026, Ring and Fire TV tracks. Every entry below is a real obstacle hit
while building this repository, with the decision or code that resolved it. Entries cite
the project's own decision log (`docs/02-architecture/06-design-decisions.md`, D001–D041)
and research notes, so each one is checkable rather than reconstructed from memory.

**Entry format.** The Official Rules §6 define a six-field enum for friction entries:
*task attempted, steps taken, expected vs actual result, severity rating, workaround used,
actionable suggestion*. `ARCHITECTURE.md` §10 gives a shorter four-field template that
omits **severity rating** and **workaround used**. The Rules control, per §11.4, so the
six-field shape is used throughout.

**Severity rating** — `High`: blocked a requirement or invalidated planned architecture.
`Medium`: cost hours or forced a design change. `Low`: cost under an hour or produced a
code comment.

---

## Ring API

### Entry 1: The webhook signature covers the raw body bytes, and re-serialising breaks it silently

- **Task attempted:** Verify Ring's `X-Signature` HMAC-SHA256 header on every webhook
  request (FR2).
- **Steps taken:** Parsed the incoming JSON and re-serialised it before computing the
  digest, which is the natural implementation.
- **Expected vs actual:** Expected any canonical JSON serialisation to produce the same
  digest. Actually, the official documentation states the HMAC covers the **raw request
  body bytes**: *"If you parse the JSON and then re-serialize it to compute the HMAC,
  whitespace and key ordering change the bytes — the digest will not match and every
  signature check will fail with a payload that looks correct."* Key ordering and
  whitespace differ between the parser and the sender, so every request failed
  verification with a body that looked entirely correct.
- **Severity rating:** **High.** FR2 is a MUST. A signature check that fails 100% of the
  time looks like a bad secret, not a serialisation bug, and would have sent debugging
  time into the wrong place.
- **Workaround used:** Verify against the untouched body string, and parse only after the
  digest matches. API Gateway's base64 encoding must be decoded first. Implemented in
  `src/handlers/webhookHandler.ts` → `readRawBody()`, and `src/lib/signatureVerifier.ts`.
  The ordering rule is documented at the top of the handler so a future refactor cannot
  silently swap the two steps. Decision D012 records the residual risk.
- **Actionable suggestion:** The Ring webhook documentation should carry a Node.js code
  example that hashes the raw body, and should state the encoding explicitly (hex, not
  base64). The failure mode is silent and the wrong first guess is the one most
  implementations reach for.

### Entry 2: The webhook payload contract in the architecture spec is wrong in 6 of 9 fields

- **Task attempted:** Map the Ring webhook payload onto the project's internal event shape
  (FR3).
- **Steps taken:** Implemented against `ARCHITECTURE.md` §5.1 first, then cross-checked
  every field against the official Ring API documentation on 2026-09-28.
- **Expected vs actual:** Expected the spec's field names to match the API. Actually 6 of
  9 fields were wrong. The most dangerous: **webhook `sub_type` is flat** (`human`,
  `vehicle`, `motion`, `other_motion`). The spec's `motion.human` form is an
  **`event_types` value for the Event History query parameter** — a different API surface.
  Code matching `sub_type === "motion.human"` matches nothing, ever, and fails silently
  rather than erroring. Also: `data.device_id` does not exist (it is
  `data.attributes.source`); `data.attributes.timestamp` is epoch milliseconds and is not
  derivable from `meta.time`; `data.id` is a composite *event* id, not a device id, so
  using it in a device API call returns 404.
- **Severity rating:** **High.** FR3 is a MUST, and this failure mode is silent — a
  subtype that never matches produces a plausible-looking description with no subtype
  context, which no test against a fake would catch.
- **Workaround used:** `src/types/index.ts` models the **real** API with a header comment
  ordering the file to follow the documentation rather than the spec, and every divergence
  is recorded in `docs/05-hackathon-requirements/04-ring-api-findings.md`. The same dotted
  form reappeared in the §5.2 response contract and was corrected again at the query
  stage (decision D023).
- **Actionable suggestion:** A webhook reference should include one complete annotated
  payload per `meta.version`, since `1.0` and `1.1` differ — `1.0` carries **no**
  `account_id`, so any integration that assumes it breaks on older firmware.

### Entry 3: There is no webhook sandbox, so the whole ingress path is unverifiable locally

- **Task attempted:** Verify the ingress path (FR1, FR2, NFR1, NFR2) before submitting.
- **Steps taken:** Looked for a webhook simulator, a replay tool, or a fixture-based
  sender in the Ring documentation and the Developer Portal.
- **Expected vs actual:** Expected the Developer Playground to offer webhook replay,
  since it simulates live view. Actually the Playground issues tokens and simulates **live
  view only**. There is no documented webhook sandbox and no event-injection API, so
  FR1/FR2/NFR1 cannot be exercised end to end without a real doorbell press.
- **Severity rating:** **High.** Stage One is a pass/fail viability gate that checks the
  submission "reasonably applies the required APIs". It also means the entire test suite
  runs against fakes, and a green suite is not evidence the system works against Ring.
- **Workaround used:** Dependency injection at every seam — the Ring client, the document
  client, the S3 presigner, the queue send, and the API Gateway poster are all injectable,
  so 483 tests cover real logic with no network. Request shapes are verified against
  documentation, never against observed traffic, and every document says so. A free Ring
  account may open the token and device-lookup paths (see the Resources notes in
  `docs/05-hackathon-requirements/06-hackathon-resources.md`).
- **Actionable suggestion:** A webhook test harness — a curl-able endpoint that accepts a
  signed fixture and returns the parsed event — would let every Ring integration verify
  its ingress logic in minutes and would remove the single largest source of unverifiable
  code from the ecosystem.

### Entry 4: Encrypted media has no documented status code, so E2EE is detected by absence

- **Task attempted:** Handle TAKE / end-to-end-encrypted media on accounts with E2EE
  enabled (FR4).
- **Steps taken:** Searched the snapshot and media documentation for a status code, header,
  or content type that identifies encrypted media.
- **Expected vs actual:** Expected an explicit signal. Actually Ring states that
  TAKE/E2EE media comes back **encrypted** but publishes **no status code or content type
  distinguishing it**. There is nothing to branch on.
- **Severity rating:** **Medium.** Forces an inference, and an inference recorded in code
  could be wrong.
- **Workaround used:** Detection by absence — a media response that is not a valid JPEG is
  treated as unusable, logged, and the FR11 deterministic fallback writes a sentence
  rather than the stage failing. Decision D016 records that the trigger is an inference,
  not a documented fact.
- **Actionable suggestion:** Publish a content type or a documented 4xx for encrypted
  media. "The bytes are not a JPEG" is an inference every integrator has to reinvent.

### Entry 5: Hand-rolled client, because no SDK exists for the endpoints used

- **Task attempted:** Build the token lifecycle, device lookup, and the two-request
  snapshot flow.
- **Steps taken:** Searched for an official Node.js SDK covering the Partner API endpoints
  this project needs.
- **Expected vs actual:** Expected an official SDK. Actually there is none covering these
  endpoints, so `src/lib/ringClient.ts` is written by hand against the documentation.
- **Severity rating:** **High.** This module has no SDK to check behaviour against and no
  observed traffic, so every request shape is documentation-derived.
- **Workaround used:** Response shapes are narrow-typed and defensively parsed rather than
  asserted, and an unexpected subtype becomes "Nothing identifiable" instead of a confident
  wrong claim. Decision D015 records the choice. The canonical starter,
  `AmazonAppDev/ring-api-helloworld`, has **not** been diffed against this module — a
  known open item.
- **Actionable suggestion:** Publish a maintained server-side SDK for the Partner API, or
  at minimum a reference Node.js implementation the docs link directly.

---

## Vega SDK / Fire TV

### Entry 6: No documented API supports the picture-in-picture overlay the PRD requires

- **Task attempted:** Implement the §3.4 picture-in-picture overlay — an overlay that
  appears over whatever the user is watching without interrupting playback (FR12), with a
  dismiss button (FR13) and a 15-second auto-dismiss (FR14).
- **Steps taken:** Surveyed all **38 documented Vega APIs** on 2026-09-28, looking for a
  system overlay, heads-up surface, or picture-in-picture API.
- **Expected vs actual:** Expected a system overlay API. Actually **none exists**. Findings:
  - Overlaying *another app's* video has no documented path at all.
  - Overlaying your **own** video works, but only via a transparent
    `@amazon-devices/webview` sibling of `KeplerVideoSurfaceView`. React Native `zIndex`
    and `elevation` **do not reach the hardware video layer**, so a plain absolutely
    positioned view silently renders underneath — a failure a community thread shows
    someone already hitting.
  - `useToastKepler`, the closest system surface, is text-and-icon with a fixed SHORT or
    LONG duration, so it **cannot express FR14's 15-second auto-dismiss**.
  - Focus selection **ignores z-order**, so FR13's dismiss button is unreachable by D-pad
    navigation over a content grid.
- **Severity rating:** **High.** Two MUST requirements were not implementable as written
  at the time (FR12 and FR14; FR14 was later implemented — D034), and the failure is
  silent — the view renders, just underneath.
- **Workaround used:** Built the delivery half only: the §3.4 payload, per-connection
  fan-out, and the connection registry, all of which are implementable and track-independent.
  What a Fire TV app **can** do with this payload today is genuinely useful — fetch
  `snapshot_url`, show the sentence as a toast, and trigger a content-launch deep link.
  Decision D021 records the platform limit. FR12 is recorded as *not implementable as
  written* rather than as unfinished work; FR14 was retired from that list by D034.
- **Actionable suggestion:** The Fire TV track's **Fire OS** option is the lead here — it
  has documented heads-up notifications that float over content, which Vega does not. A
  platform-agnostic overlay API (or documented PiP on Vega) would let the PRD's own design
  work as specified on both OSes.

### Entry 7: A WebSocket connection id is delivered once and nowhere else

- **Task attempted:** Push to connected Fire TV clients (FR6).
- **Steps taken:** Looked for a way to enumerate live API Gateway WebSocket connections
  before writing any registry.
- **Expected vs actual:** Expected a list-connections call. Actually API Gateway delivers
  the connection id to the `$connect` route handler **exactly once, and nowhere else**,
  and `PostToConnection` requires that id. Without remembering it, nothing can ever be
  pushed. A module-level array cannot substitute: Lambda invocations are stateless, so two
  concurrent instances would each hold half the connections and neither would know about
  the other's, and every event would reach roughly half the screens, intermittently.
- **Severity rating:** **Medium.** Architecturally load-bearing and easy to get subtly
  wrong — the array version fails only under concurrency, so it passes every single-instance
  test.
- **Workaround used:** A DynamoDB connections table written on `$connect` and pruned on
  `$disconnect`, with a 24-hour TTL as a growth bound. `ARCHITECTURE.md` §11 does not list
  this table — a gap in the plan, not a departure from it. Decision D020.
- **Actionable suggestion:** The WebSocket API docs should call out that connection ids are
  single-delivery, and state the registry requirement explicitly. The "just keep them in
  memory" instinct is the natural wrong turn.

### Entry 8: A dead Fire TV must not silence the whole house

- **Task attempted:** Handle a client that disconnects without a clean `$disconnect`.
- **Steps taken:** Implemented per-connection fan-out and treated `GoneException` as fatal
  for the batch.
- **Expected vs actual:** Expected `GoneException` to be a transport failure. Actually it
  is API Gateway's **documented signal that a socket is closed** — an expected, recoverable
  condition, not an error.
- **Severity rating:** **Medium.** Aborting the batch on it means one vanished Fire TV
  swallows the description for every other screen in the house, and the failure is
  invisible until someone reports a missing notification.
- **Workaround used:** `pushToConnections()` in `src/lib/overlayPush.ts` prunes the stale
  row and continues; any **other** error propagates rather than being counted as a success.
  The registry self-heals as a side effect, so no sweeper job is needed. Asserted by tests.
- **Actionable suggestion:** Document the `GoneException` pattern explicitly — per-
  connection pruning with self-healing — since batch-abort is the obvious default.

---

### Entry 24: The pipeline demo mounted the overlay under the wrong element id and lost all of its CSS

- **Task attempted:** Build a third demo showing the whole chain on one page — the real
  Fire TV overlay client beside the real dashboard.
- **Steps taken:** Mounted the overlay into `<div id="tv">` inside a constrained pane, then
  opened the built page in a browser.
- **Expected vs actual:** Expected a scaled-down television beside the timeline. **The
  overlay rendered unstyled and burst out of its pane**, wrapping the sentence to one word per
  line and spilling over the pipeline stage strip. Two separate causes, neither of which any
  test could see. First, `firetv/overlay.css` keys its entire layout on `#overlay` — centring,
  padding, column flow — so a differently-named mount point silently loses all of it. Second,
  once found, the overlay is sized for a television (a 2rem description in a 46rem card), and
  squeezing that into a side pane makes the browser **reflow** it rather than shrink it.
- **Severity rating:** **Medium.** Presentation only, and it would have been the first thing a
  judge saw on the page the landing page points at.
- **Workaround used:** The pane is now `<main id="overlay">`, matching the overlay's own page
  exactly, and the television lays out at a real 1280x720 and is scaled to fit with a
  `transform` — which means the pane shows the same rendering a television would, rather than a
  reflowed one. The fixed-width screen is absolutely positioned so it cannot inflate the grid,
  and `min-width: 0` stops the surfaces doing it again.
- **Actionable suggestion:** **Component CSS keyed on a hard-coded id is a coupling that no
  type system sees.** A consumer that mounts a component under a different element name gets
  no error and no layout. A class-based root, or the component exporting its own required id,
  turns a silent visual failure into a compile error.

### Entry 25: A tsconfig inherited the exclusion meant to keep it out, so it typechecked nothing and reported success

- **Task attempted:** Let one file legitimately import across two source trees, by giving it
  its own tsconfig.
- **Steps taken:** Added `web/tsconfig.pipeline.json` with `extends: "./tsconfig.json"` and a
  `include` naming the files it was meant to check. It did not set `exclude`.
- **Expected vs actual:** Expected a second pass covering those files. **It covered none of
  them.** An extending config inherits `exclude` from what it extends, and the base config
  excluded `src/pipeline.ts` precisely because the base config cannot contain a
  cross-tree import. So the pipeline config inherited an exclusion of exactly the files it
  existed to check. `npm run typecheck` passed the whole time, printing a clean run of an
  empty program.
- **Severity rating:** **High**, because of the shape of it rather than the size. A typecheck
  that checks nothing is worse than no typecheck: it is a green light wired to a lamp with
  nothing behind it. It concealed a real compile error (`cycle(id, wait)` — a leftover from
  renaming a parameter) that had been breaking the demo page silently in a browser while
  every gate stayed green.
- **Workaround used:** `web/tsconfig.pipeline.json` now sets `"exclude": []` explicitly, with
  a note saying why. The type error surfaced immediately. The demo's control flow was also
  pulled out into a pure `runLoop()` so this class of wiring is covered by tests rather than
  by a browser.
- **Actionable suggestion:** **`extends` inherits `exclude` as well as `include`, and nothing
  tells you when the result is empty.** Verify any new project with
  `tsc --listFiles | grep <yourfile>` once, when you create it — a config that includes nothing
  is indistinguishable from one that passes.

## Bedrock

### Entry 9: The specified prompt omits the watermark, which the model then describes

- **Task attempted:** Produce a one-sentence description of only what is visible (FR9,
  FR10).
- **Steps taken:** Used the system prompt exactly as `ARCHITECTURE.md` §3.3 specifies.
- **Expected vs actual:** Expected descriptions confined to the scene. Actually the
  documented system prompt does not mention that Ring's snapshots carry a **permanent
  watermark** in the corners containing a logo and device text. Feeding a watermarked
  image to a vision model with that prompt invites the model to describe the overlay — so
  the model writes *"Nothing identifiable. Front Door, front door"* and counts that as a
  scene description. It reads as a broken product.
- **Severity rating:** **Medium.** Erodes FR9 directly, and the output looks plausible
  enough to survive a quick review.
- **Workaround used:** `SYSTEM_PROMPT` in `src/lib/bedrockClient.ts` is the documented
  prompt plus one appended sentence telling the model to ignore the overlay. Decision D017.
- **Actionable suggestion:** Any vision-model sample for Ring media should include the
  watermark in the reference prompt. It is in every frame of every snapshot, so it is not
  an edge case.

### Entry 10: The Bedrock request envelope was written without fetching AWS documentation

- **Task attempted:** Call Claude or Nova on Bedrock and extract the text (FR5).
- **Steps taken:** Wrote the request envelope — `anthropic_version`, `max_tokens`,
  `temperature`, `system`, and a base64 `image` content block — from knowledge.
- **Expected vs actual:** Expected a documented, current envelope. Actually **no AWS
  documentation was fetched while writing it**. It has never been exercised against
  Bedrock, so a field name or model-id mismatch would surface only as an API error on
  first invocation.
- **Severity rating:** **High.** FR5 is a MUST, and this is the least-verified thing in the
  repository.
- **Workaround used:** The failure is loud rather than silent — the error is caught into a
  `BedrockError` and routed to FR11's deterministic fallback, so a bad envelope degrades to
  a working sentence instead of a dead pipeline. `extractText()` handles the Anthropic, Nova,
  and generic result shapes so a model swap needs no code change. It still needs one real
  invocation against Bedrock to be trusted.
- **Actionable suggestion:** A minimal copy-paste InvokeModel body for the current Claude
  and Nova model ids on the Bedrock page would save every builder this guess.

### Entry 11: Latency variance puts the 8-second target at risk, and it cannot be measured locally

- **Task attempted:** Deliver description + snapshot within 8 seconds of the original event
  (FR6).
- **Steps taken:** Counted the hops between the Ring webhook and the TV overlay.
- **Expected vs actual:** Expected a request/response path with one expensive call.
  Actually the path is **three SQS queue hops** — ingress → describe → overlay — and the
  Bedrock call alone is several seconds. Queue visibility timeouts are 180s and 90s, far
  longer than the target, so the design meets 8 seconds only if the hops are genuinely
  fast.
- **Severity rating:** **High.** FR6 is a MUST and this is the requirement most likely to
  fail, with no way to confirm either way without AWS.
- **Workaround used:** Stage boundaries chosen to keep the slow work off the webhook path,
  since NFR1 requires a 5-second response and the Ring docs name inline heavy processing
  as a Common Mistake. The ingress handler acknowledges and returns before the pipeline
  finishes. **Unmeasured** — recorded as a live risk in
  `docs/02-architecture/06-design-decisions.md`, not presented as met.
- **Actionable suggestion:** Publish reference latency figures per Bedrock model and a
  worked end-to-end example with queue hops, so teams can size budgets before building.

---

## AWS Setup

### Entry 12: TypeScript 7 removed `moduleResolution: node10`, breaking copied tsconfigs

- **Task attempted:** Configure `tsconfig.json` for strict TypeScript with CommonJS output.
- **Steps taken:** Started from a conventional serverless tsconfig — `module: commonjs`,
  `moduleResolution: node`.
- **Expected vs actual:** Expected it to compile. Actually **TypeScript 7 removed
  `moduleResolution: node10`**, so the conventional config fails outright.
- **Severity rating:** **Medium.** One failed `npm run typecheck` during setup, but the
  error names the setting, so it is quick to fix once seen.
- **Workaround used:** `module`/`moduleResolution` of `node16`. Recorded in
  `docs/03-repository/02-toolchain.md` so the next config copy starts from the working
  version. The project targets TypeScript `^7.0.2`.
- **Actionable suggestion:** Note the removal prominently in the TypeScript 7 release
  notes and in every serverless quickstart template, which are mostly stale on this point.

### Entry 13: A `tsc`-emitted `dist/` deploys successfully and fails on first invocation

- **Task attempted:** Produce a deployable Lambda package with `tsc`.
- **Steps taken:** Ran `tsc` to emit compiled files into `dist/`, which is the usual
  serverless default and what `sam build` expects.
- **Expected vs actual:** Expected a working artifact. Actually `tsc` only transpiles; it
  never copies `node_modules`. The **AWS SDK v3 is not in the Node.js Lambda runtime**, so
  the deployed function starts fine and dies on the first webhook with
  `Cannot find module '@aws-sdk/client-dynamodb'`. `sam build` reports no error, and typecheck
  passes, and the unit tests pass — every gate is green on a package that cannot run.
- **Severity rating:** **High.** The failure happens in production, on the first real
  request, and no existing check catches it.
- **Workaround used:** esbuild bundles each handler into a self-contained CommonJS file, and
  `npm run build:verify` enumerates every `require()` in `dist/` and fails if one resolves to
  a package that was not inlined. `outbase` is pinned to `src/` so bundle paths match the
  `Handler` property. Decision D009. The gate is wired into `npm run all`.
- **Actionable suggestion:** Ship a default bundling step in `sam build` templates for
  TypeScript, or warn when `Handler` points at an emitted file whose imports are unresolved.

### Entry 14: `build:verify` silently fell out of CI while the docs still claimed it ran

- **Task attempted:** Keep CI from passing on a bundle that cannot require its own
  dependencies.
- **Steps taken:** Added `build:verify` to the contract's `ci.workflows[0].runsSteps` and to
  the docs, then added the step to `.github/workflows/docs-check.yml`.
- **Expected vs actual:** Expected the gate to run. Actually the workflow never built
  `dist/`, and `scripts/verify-bundle.mjs` asserts against `dist/`, so the step could not
  have worked as written and was left out — while the contract and `AGENTS.md` both continued
  to claim four gates in CI. **The documentation was confidently wrong, and no check caught
  it**: `docs:check` proves structure, not truth, and it stayed green throughout.
- **Severity rating:** **Medium.** No runtime impact, but it is the clearest example in this
  repo of a gate being believed that was not running, and of why a passing docs check is not
  evidence of a correct doc.
- **Workaround used:** Corrected the contract to record reality and documented the gap as a
  finding rather than papering over it. `npm run all` runs the gate locally, so the local
  gate is currently stronger than CI.
- **Resolved 2026-10-04:** CI now runs `npm run build` before the gate, and `npm run all`
  chains the same six commands — closing the gap also fixed `all` failing on a clean
  checkout and a stale `dist/` passing the gate against changed source. Decision D033.
- **Actionable suggestion:** Have CI run the same command the developer runs locally, and
  derive the step list from the contract mechanically rather than restating it — the contract
  is already read at runtime, but its summary of itself was not the thing being checked.

### Entry 15: An unsigned query endpoint was specified with no auth mechanism at all

- **Task attempted:** Expose `GET /events/today` returning a homeowner's door activity
  (FR8).
- **Steps taken:** Implemented the endpoint as `ARCHITECTURE.md` §5.2 and §4.2 describe it,
  then checked §6's security mitigation table.
- **Expected vs actual:** Expected the spec to name an auth mechanism. Actually it names
  **none** — not in §5.2, not in §4.2, and not in the §6 mitigation table. The webhook's
  HMAC does not generalise: it works because Ring holds the secret, and this endpoint has
  no such partner. A literal reading of the spec is a **public endpoint returning a
  homeowner's door activity to anyone who guesses the URL.**
- **Severity rating:** **High.** A privacy leak that a spec-faithful implementation ships by
  default, and no static check flags it.
- **Workaround used:** A required `X-Query-Key` compared in constant time via
  `timingSafeEqual`, failing **closed** when `QUERY_API_KEY` is unset — an endpoint that
  cannot decide who is allowed must not decide that everyone is. IAM narrowed to
  `dynamodb:Query` and `s3:GetObject` only. Decision D022 records that this is a minimum,
  not an auth system: a static key does not distinguish one homeowner from another, and there
  is no per-account partitioning yet.
- **Actionable suggestion:** Security review templates for API specs should require an
  explicit auth column, with "none" stated deliberately. An omission reads as an oversight.

---

## Documentation Gaps

### Entry 16: The PRD's own citation markers point at nothing

- **Task attempted:** Follow the PRD's citations while implementing requirements.
- **Steps taken:** Tried to resolve `[reference:0]` through `[reference:5]` in `prd.md`.
- **Expected vs actual:** Expected a reference list or footnotes. Actually there are **six**
  inline citation markers and **no reference list anywhere in the repository**, so all six
  point at nothing. They sit in FR3, NFR1, NFR4, NFR6 and two constraints entries — and the
  three they attach to are among the most contested in this project.
- **Severity rating:** **Medium.** A judge following any citation finds nothing, and it
  undercuts the credibility of the requirement catalogue exactly where it matters.
- **Workaround used:** Left the markers in place rather than stripping them, because
  deciding what each was meant to support is an author decision, not a cleanup. Full
  placement table in `docs/03-repository/01-current-state.md`.
- **Actionable suggestion:** None needed from the platform — this is a template defect. A
  PRD template should validate that every `[reference:N]` resolves, so an orphan citation
  fails the build rather than the judge.

### Entry 17: An invented rule was steering the project away from a track paying $13,000 more

- **Task attempted:** Follow the documented track-selection rule.
- **Steps taken:** Cross-checked `ARCHITECTURE.md`'s v2 correction log against the Official
  Rules on 2026-09-28.
- **Expected vs actual:** Expected *"One app, one primary track"* to be a rule. It is **not
  in the rules at all** — the correction log records adding a rule that does not exist. The
  rules instead permit a project to win one track prize *and* one mini-challenge prize, and
  allow entering more than one submission if each is substantially different. Meanwhile Fire
  TV first place pays **$25,000 + $15K credits** against Ring's **$12,000** — a **$13,000**
  cash difference plus credits Ring does not offer — for work this project is already specced
  to do.
- **Severity rating:** **High.** An invented rule, recorded as a correction, was actively
  costing money.
- **Workaround used:** Recorded as conflict 2 in `docs/05-hackathon-requirements/03-doc-conflicts.md`
  and as decision D005, with the rule text on the left and the project text on the right. The
  Fire OS finding (Entry 6) gives the Fire TV option a concrete technical path rather than a
  speculative one.
- **Actionable suggestion:** Not a platform gap — a discipline note. Rules-derived constraints
  should carry a citation to the rule, and corrections should be checked against the source
  rather than recorded from memory.

### Entry 18: The mini-challenge eligibility the project relies on is contradicted by the project docs

- **Task attempted:** Determine which mini-challenges the submission qualifies for.
- **Steps taken:** Read `prd.md` §13 and `ARCHITECTURE.md` §14 against Official Rules §4,
  the Resources page, the FAQs, and three Devpost forum threads.
- **Expected vs actual:** Expected the project documents to be right. Two problems:
  1. **Open Source.** `prd.md` says "repo is public + MIT licensed", which is the submission
     repo claiming to be its own contribution. The rules say a new **additional** repo or a
     contribution *"alongside a primary track submission"*, and the submission form demands
     **two distinct URLs**. Whether the submission repo itself qualifies is **NOT FOUND** in
     any source — so as planned the project scores zero for a **$5,000** prize.
  2. **AWS Builder.** `ARCHITECTURE.md` is correct but **understated**: the rules name **Kiro
     Crew** specifically and confirm it qualifies *on its own*, with no separate runtime AWS
     service required. Amazon DevRel confirmed on the forum that Claude Code on Bedrock counts
     too.
- **Severity rating:** **High.** A $5,000 prize lost to a misread, plus a missed argument on
  a qualifying mini-challenge.
- **Workaround used:** Corrected reading recorded in
  `docs/05-hackathon-requirements/02-mini-challenges.md` with the rule text quoted verbatim.
  The bar for a separate open-source repo is low — Hackathon Manager Janet Fang confirmed a
  fresh repo built for a *different* hackathon during the window is eligible. **Not fixed: no
  second repository exists.**
- **Actionable suggestion:** Have the submission form state whether the primary submission repo
  counts as the "additional" open-source contribution. The two-URL requirement implies no,
  but no rule states it outright.

### Entry 19: The judgement criteria list in the project was missing a criterion and had two that do not exist

- **Task attempted:** Prioritise work against the judging criteria.
- **Steps taken:** Compared `ARCHITECTURE.md` §14's criteria list against Official Rules §6.
- **Expected vs actual:** Expected the list to match. Actually Stage Two has **four equally
  weighted** criteria — Tech Implementation, Design, Potential Impact, **Quality of the
  Idea**. `ARCHITECTURE.md` lists Innovation, Impact, Tech Implementation, Design,
  Presentation. **"Innovation" and "Presentation" are not criteria**, and Quality of the
  Idea is missing. A document called "Judging Alignment" naming the wrong criteria
  misdirects every prioritisation decision made against it.
- **Severity rating:** **Medium.** No code impact, but it steers effort toward a criterion
  that is not scored.
- **Workaround used:** Recorded verbatim in
  `docs/05-hackathon-requirements/01-official-requirements.md`, together with the
  track-specific "Obvious vs Creative" guidance — for Ring, *"motion detection alert, basic
  doorbell live view"* is Obvious, while *"care-taking monitoring, package/delivery
  management, business system integration"* is Creative. This project sits in the Creative
  half of both the rubric and the Ring track's prioritised categories.
- **Actionable suggestion:** Publish a criterion-to-rubric mapping per track. The
  Obvious/Creative split is the most actionable part of the rubric and it is buried.

### Entry 20: The friction log format the project specified is missing two required fields

- **Task attempted:** Produce this file in the shape that earns the bonus.
- **Steps taken:** Followed the template in `ARCHITECTURE.md` §10.
- **Expected vs actual:** Expected §10 to match the required shape. Actually Official Rules §6
  define a **six-field enum** — task attempted, steps taken, expected vs actual result,
  **severity rating**, workaround used, **actionable suggestion**. §10 omits severity rating
  and workaround used, so entries written to it would score against an incomplete schema.
- **Severity rating:** **Medium.** Affects how every entry is judged, and §11.4 makes the
  Rules controlling.
- **Workaround used:** This file uses the six-field shape. The recipe in
  `docs/00-how-to/03-add-a-friction-log-entry.md` has been corrected to match, and its
  "four fields, in this order" instruction replaced.
- **Actionable suggestion:** Where a project-derived template and the rules disagree, cite the
  rule section in the template itself so the conflict is visible at the point of use rather
  than discovered at submission.

### Entry 21: The demo's own fixtures hid a broken first impression, and no test could have seen it

- **Task attempted:** Make the two fixture demos presentable to judges.
- **Steps taken:** Ran both built demo pages in a real browser rather than trusting the unit
  tests that already covered the code feeding them, and looked at what actually painted.
- **Expected vs actual:** Expected a populated page on load. Two defects appeared that no
  test in the repository could have caught. **The overlay opened on "Waiting for the front
  door…" and stayed there for eight seconds** — `demoSocketFactory` used `setInterval`
  alone, so the first fixture landed one full interval after load, and the demo's worst moment
  was an apparently broken page. **The dashboard's snapshot placeholders were invisible**:
  the SVG background was `#181d27`, which is exactly the card background, so each frame
  rendered as an empty box with a thin artefact in it and read as a broken image.
- **Severity rating:** **Medium.** Both are presentation-only, and neither affects the
  pipeline — but these are the two pages a judge opens first, and "broken" is the one
  impression a demo cannot afford.
- **Workaround used:** The socket now emits its first fixture immediately and only then
  starts the interval; the placeholder background moved to `#0d1016` with a visible border in
  both demos. Both were confirmed by reloading the pages in the browser, not by reasoning.
- **Actionable suggestion:** Fixture-driven demos need at least one check that renders the
  real page. A unit test over the fixture data cannot distinguish "renders correctly" from
  "renders as a blank box" — the background colour matching its container is not a property
  any assertion here could see.

### Entry 22: The browser client could never have reached the API, and every demo was green

- **Task attempted:** Publish the two front ends as static demos and let the dashboard read
  `GET /events/today`.
- **Steps taken:** Set `CorsConfiguration` on the HTTP API and the snapshot bucket, then went
  back over the template looking for other things the demos could not exercise.
- **Expected vs actual:** Expected the live dashboard to work once pointed at a deployed
  endpoint. **It would not have.** The API declared no CORS configuration at all; the
  dashboard is served from GitHub Pages and fetches a different origin, and it sends
  `X-Query-Key`, which is not a safelisted header, so the browser preflights — and the
  preflight would have received no `Access-Control-Allow-Origin`.
- **Severity rating:** **High**, and specifically because it is *undetectable from here*.
  Every fixture demo is same-origin and never preflights, so all 326 tests, both rendered
  pages, and anything a judge opens before a deployment would have been green while the live
  path was broken. The next defect found the same way is the WebSocket route expression, which
  routes nothing the pusher actually sends.
- **Workaround used:** `CorsConfiguration` with a `DashboardAllowedOrigins` parameter rather
  than a hard-coded `*`, because an origin allowlist on an endpoint returning a homeowner's
  door activity is a security control the deployer should own. Recorded as decisions D037 and
  D038.
- **Actionable suggestion:** A browser client and a JSON API in the same repository need a
  cross-origin check as part of the definition of done. Serverless templates ship without CORS
  by default and nothing warns you.

### Entry 23: The Bedrock response was parsed without reading the response schema

- **Task attempted:** Confirm the Bedrock request envelope — the repository's own docs had
  called it "the single most likely thing to need adjusting on first real invocation".
- **Steps taken:** Fetched the Bedrock reference pages for the Anthropic Claude Messages API
  and compared the documented request, the documented response, and the code.
- **Expected vs actual:** Expected to confirm the envelope and find nothing wrong. The request
  is correct — `anthropic_version`, `max_tokens`, `messages`, and the image block match the
  documentation's own multimodal example verbatim. **The response handling was wrong.** The
  docs state that `stop_reason` is `max_tokens` when generation hit the token ceiling, and
  that the `content` array still contains text in that case. The parser returned that text,
  so a description truncated mid-word would have been stored as a complete sentence and marked
  as model-generated — on an event where §3.3 promises exactly one sentence.
- **Severity rating:** **Medium.** It would not throw; it would quietly store a fragment and
  report it as a success. It would surface as the AI describing an event slightly oddly, which
  is close to undebuggable in a demo.
- **Workaround used:** `extractText` now rejects `stop_reason: "max_tokens"` and falls back to
  the deterministic sentence, which is plainer and honest. It also distinguishes a
  content-classifier `refusal` (which returns an empty `content` array) from a transport
  failure, since both previously produced the same generic error.
- **Actionable suggestion:** Publish the response schema, not just the request schema. The
  request is the half everyone checks and the response is the half that decides whether a
  truncated answer is detected at all.

### Entry 26: A test helper failed the whole suite while all 483 of its tests passed

- **Task attempted:** Raise coverage, and stop the demo loop from outliving its test.
- **Steps taken:** Gave `startPipeline` an injectable clock so a test could drive a looping
  demo without waiting real seconds, and gave the fake DOM a `restore()` between tests.
- **Expected vs actual:** Expected a clean run. **Every test passed and `npm test` still
  exited 1.** The demo repaints with `void repaint()` — detached on purpose, because a repaint must
  never reject the demo loop — so a render begun in one test resolved after the *next* test
  had removed the global `document`. `load()` caught the resulting error and tried to render
  its error state, which threw again. Vitest reported one unhandled rejection, attributed to
  whichever test happened to run last and pointing at `web/src/app.ts`, which none of the
  four named tests had touched.
- **Severity rating:** **Medium.** A green tick list with a red exit code trains people to
  ignore the exit code, which is how a real failure gets missed later.
- **Workaround used:** One document installed for the whole test file rather than per test,
  with the page body reset between tests. The document now outlives every individual test, so
  a late repaint finds it. Draining microtasks before teardown is documented as best-effort
  and is not relied on.
- **Actionable suggestion:** **Detached promises outlive the test that started them.** If a
  module keeps a loop, the test needs the loop stopped AND the environment it depends on
  shared for the whole file — not a tidy per-test setup and teardown.

### Entry 27: The AWS credit form still accepts a click and returns a refusal

- **Task attempted:** Obtain AWS promotional credits through the hackathon's credit request
  form, so the stack could be deployed and tested at least once before submission.
- **Steps taken:** Followed the credit request form linked from the hackathon Resources page and
  cross-checked it against Rules §4, which advertises an **Oct 21, 12:00pm PT** deadline for the
  request — two days before submission closes.
- **Expected vs actual:** Expected a live form. It resolves to a notice reading *"Unfortunately,
  we've run out of AWS credits to distribute for this hackathon and no longer able to accept any
  credit request."* The Rules carry a matching dated entry — **"October 7th Update: We are out of
  credit codes and will no longer be accepting credit requests"** — but no banner or Updates post
  announced it, and the Oct 21 deadline the Rules still advertise sits two weeks after the pool
  closed. No request can be submitted at all, and the advertised deadline is moot.
- **Severity rating:** **Medium.** Two costs. The Rules advertise a hard date that cannot be met,
  so it stays on the critical path until someone opens the form. And the notice names neither the
  amount lost nor its relationship to the prize table, so the natural reading is that the
  **$15K** Fire TV and **$5K** mini-challenge credits are gone too — they are not; those are prize
  components paid to a winner and were never routed through this form. Hours can be lost to a
  prize calculation that is actually intact.
- **Workaround used:** No workaround exists for the credits, because the pool is empty. Build and
  test on free tier and tear resources down immediately afterwards, which is what the FAQ
  recommends regardless: *"spin resources up only for testing and tear them down afterward."* The
  question of which of the three linked form URLs was live — recorded as unresolved in
  `docs/05-hackathon-requirements/01-official-requirements.md` — is now moot and is closed.
- **Actionable suggestion:** When a promotional credit pool is exhausted, replace the request form
  with a status notice on the hackathon site **and in the Updates feed**, and say explicitly that
  the prize-table credits are unaffected. A form that accepts a click and returns a refusal is
  worse than a dead link: it costs planning time, leaves a Rules deadline advertised with nothing
  behind it, and invites entrants to write off prize value that is still live.

---

| Category | Entries |
|---|---|
| Ring API | 5 |
| Vega SDK / Fire TV | 5 |
| Bedrock | 3 |
| AWS Setup | 4 |
| Documentation Gaps | 10 |
| **Total** | **27** |

`prd.md` §9 targets **more than 10** specific, actionable items. The two unverified items
most worth reporting upstream are **Entry 3** (no webhook sandbox) and **Entry 6** (no
documented overlay API on Vega OS) — both are platform gaps that block other builders too,
which is what the Product Feedback answers are for.