# Front Door Intelligence

**A Ring doorbell press becomes one sentence of plain English on your TV.**

Amazon Developer Hackathon 2026 — Ring and Fire TV tracks, with the AWS Builder and Open
Source mini-challenges.

When someone rings your doorbell or walks past the camera, an AI model looks at the
snapshot and writes one sentence — *"A delivery driver places a medium box by the door"* —
which appears on your Fire TV within seconds. No notification badge telling you
*something happened*. A sentence telling you **what**.

---

## Status — please read this before judging the demo

**Five backend stages and both front ends are complete and tested. Nothing is deployed,
and no Vega or Fire OS shell has ever run.**

| Stage | Requirement | State |
|---|---|---|
| Webhook ingress | FR1, FR2, FR3, FR7, NFR1, NFR2 | implemented, tested against fakes |
| Snapshot + AI description | FR4, FR5, FR11 | implemented, tested against fakes |
| Overlay delivery | FR6 | implemented, tested against fakes |
| Event query (`GET /events/today`) | FR8 | implemented, tested against fakes |
| Daily summary | FR7's second half | implemented, tested against fakes. No SES email |
| Web dashboard (`web/`) | the client for FR8 | implemented, 50 tests. Plain TypeScript, not React — decision D029. **Rendered in a real browser** |
| Fire TV overlay (`firetv/`) | the client for FR6, FR13, FR14 | implemented, 20 tests. The §3.4 payload over the Overlay WebSocket, 15-second auto-dismiss, D-pad-reachable dismiss. Plain TypeScript in the WebView Vega sanctions — decision D034. **Rendered in a real browser** |
| Demo pages (`web/dist/pipeline.html`, `demo.html`, `firetv/dist/overlay.html`) | judges, without a deployment | fixture data through the production clients — no backend needed |

**You can see both front ends right now, without deploying anything.** Start with
`web/dist/pipeline.html`: it runs all five stages and shows the real overlay client beside
the real dashboard, wired to one fixture stream so they cannot disagree — including the
moment an event appears in the timeline *before* its sentence exists.

```bash
npm run build:web && npm run build:firetv
# serve each dist/ with any static file server, then open:
#   web/dist/pipeline.html — START HERE: the whole chain, both screens at once
#   web/dist/demo.html     — the homeowner's day (fixture data)
#   firetv/dist/overlay.html — the TV overlay alone (fixture pushes, auto-dismiss at 15s)
npx serve web/dist
npx serve firetv/dist
# or preview the combined hosted site exactly as GitHub Pages serves it:
node scripts/stage-demos.mjs && npx serve site   # landing page at the root
```

**And a hosted copy publishes itself from this repository.** `.github/workflows/demos.yml`
publishes both demos to GitHub Pages on every push to `main` — `scripts/stage-demos.mjs`
stages a landing page with the overlay under `/overlay/` and the dashboard under
`/dashboard/`. The landing page's links are relative to that staged root, so opening
`scripts/demo-landing.html` straight from the repository 404s by design — stage first. One manual enable is required
the first time (Settings → Pages → Source: "GitHub Actions"); after that every push
republishes. The build commands come from the docs contract, so the workflow cannot drift.

Every demo renders fixture data through the same code the live pages run — the dashboard's
`load()`, the overlay's `start()` — with only the transport faked. A banner says the data
is a fixture. Add `?endpoint=…` to either page to point it at a real deployment.

**Both front ends (`web/`, `firetv/`) are written**, and both were served and rendered in a
real browser on 2026-10-04 — the demos, the dashboard's error state, its controls, and the
overlay's 15-second auto-dismiss and dismiss button, all watched live. All five backend
stages are written, including the daily summary (`ARCHITECTURE.md` §3.6), which is the one
stage triggered by a clock rather than by Ring or a queue.

**One requirement is not implementable as written** on Vega OS — the
picture-in-picture overlay (FR12) above another app's playback, which has no documented API
at all. FR13 and FR14 are implemented on the surface Vega does sanction (a transparent
WebView); FR12 alone remains a platform limit, verified against all 38 documented Vega
APIs. The Fire TV track's **Fire OS** option has documented heads-up notifications that
float over content; see [Entry 6 of the Friction Log](./FRICTION_LOG.md) and decision D021.

**Nothing in this repository has ever run against Ring or AWS.** There is no webhook
sandbox (Friction Log Entry 3), so all 483 tests exercise real logic against injected
fakes. Every request shape is verified against documentation, not observed traffic.

---

## How it works

```text
Ring webhook  ──▶  Ingress  ──▶  [SQS]  ──▶  Snapshot + Bedrock  ──▶  [SQS]  ──▶  Overlay
                  verify HMAC               fetch camera frame            push to
                  dedupe on request_id      describe in one sentence      connected TVs
                  store, return <5s                                   ◀── WebSocket
                                                                            │
  Homeowner opens dashboard ──▶  GET /events/today  ◀────────────────────────┘
                                query the day's events

  EventBridge, 9 PM ────────▶  Daily summary ──▶  one row in the same partition
```

Ingress acknowledges in under 5 seconds and returns; the heavy work happens behind two SQS
queues. Three hops is the honest cost of never blocking Ring's request.

The describe stage **always writes a sentence**. If Bedrock is unavailable, the upload
fails, or the media is unreadable, a deterministic fallback produces
*"Person detected at Front Door"* rather than leaving a gap. Each event records whether the
sentence came from the model or from the fallback.

The daily summary follows the same rule from the other direction: every run ends with a
stored sentence. Bedrock erroring, the day being empty, or the day having no descriptions
yet all produce a deterministic summary that reports the counts and says nothing more. It is
stored under a fixed sort key, so a retried schedule overwrites rather than accumulating,
and `GET /events/today` returns it alongside the events.

---

## Quick start

**Requirements:** Node `>=20` and npm. AWS deployment additionally needs the SAM CLI and
AWS credentials — see [Deploy](#deploy).

```bash
npm install
npm run all      # typecheck + test + build + build:verify + build:web + build:firetv + docs:check
```

`npm run all` is the whole gate suite, and because it runs `build` itself, it passes on a
clean checkout. All seven steps pass; CI runs the identical sequence.

| Command | What it does |
|---|---|
| `npm run all` | every gate, in order, including the build both bundle gates depend on |
| `npm test` | 483 tests across 26 files (vitest) |
| `npm run test:coverage` | tests + line coverage (99.2% lines, 92.9% branches) |
| `npm run coverage:gaps` | prints the uncovered statements per file, with source |
| `npm run typecheck` | `tsc --noEmit` four times, strict — Node, each browser surface, and the pipeline demo |
| `npm run build` | esbuild bundles each handler into `dist/` |
| `npm run build:web` | esbuild bundles the dashboard into `web/dist/` |
| `npm run build:firetv` | esbuild bundles the overlay client into `firetv/dist/` |
| `npm run build:verify` | asserts `dist/` has no unresolved `require()` |
| `npm run docs:check` | validates the documentation against its contract |

There is no linter and no formatter, deliberately — `typecheck` is the correctness gate.
See decision D011.

### Environment

```bash
cp .env.example .env    # then fill in real values; .env is gitignored
```

| Variable | Purpose |
|---|---|
| `RING_CLIENT_ID`, `RING_CLIENT_SECRET`, `RING_REFRESH_TOKEN` | Ring Partner API credentials |
| `RING_WEBHOOK_SECRET` | HMAC key for the `X-Signature` check |
| `AWS_REGION`, `BEDROCK_MODEL_ID` | model id and region, for both the description and the daily summary call |
| `DYNAMODB_EVENTS_TABLE`, `DYNAMODB_IDEMPOTENCY_TABLE` | event store and idempotency |
| `S3_SNAPSHOT_BUCKET` | private snapshot storage |
| `EVENT_QUEUE_URL` | ingress → describe hand-off |
| `WEBSOCKET_ENDPOINT` | API Gateway Management API endpoint for pushing |
| `QUERY_API_KEY` | guards `GET /events/today` |

No credential is committed to this repository, and `.env.example` holds placeholder values
only. The documentation validator scans for leaked secrets as part of `npm run all`.

---

## Deploy

```bash
sam build && sam deploy --guided
```

`template.yaml` declares seven Lambda functions across five handlers, three DynamoDB tables,
two SQS queues with dead-letter queues, an HTTP API, a WebSocket API, an EventBridge
schedule, and the snapshot bucket.

**The template has never been deployed or validated.** There is no AWS account available
during development, so it is checked only for YAML well-formedness and for consistency with
the build output. Every `Handler` path is asserted to match a real file in `dist/` — and
that is as far as verification goes. Expect to fix something on first deploy.

After deploying, point Ring's Partner API webhook at the `WebhookEndpoint` output, and the
overlay client at the `OverlayWebSocketUrl` output — `firetv/dist/overlay.html?endpoint=<url>`
on any TV-side WebView, or a native shell embedding the same client.

### Unreconciled in the template

- **`GET /events/today` has no per-account scoping.** One table, one static `X-Query-Key`,
  one homeowner. Adequate for a demo, not for multi-user deployment. Decision D022.
- **The daily summary runs at 9 PM UTC by default**, not 9 PM local. The schedule takes a
  `DailySummaryTimezone` parameter, and §3.6's "all events for the current day" is a
  UTC partition — so for any timezone behind UTC, a 9 PM local run would summarise a
  partition holding only the first hours of the evening. Decision D025.
- **The Bedrock budget is not a CloudWatch alarm.** §6 asks for the alarm; `EstimatedCharges`
  cannot be switched on by a template, so a Budget filtered to the Bedrock service is
  declared instead. Deploying without `CostAlarmEmail` creates the budget with no subscriber,
  because AWS rejects an empty address — and AWS requires an address to be confirmed before
  the first notification lands. Decision D027.

**SES email is not implemented.** §3.6 mentions "optional email via SES". It needs a
verified identity, a destination, and an unsubscribe path, none of which the spec names.
The summary is readable through `GET /events/today`, which is where a dashboard would read
it anyway.

---

## Layout

```text
src/
  handlers/    webhookHandler · snapshotFetcher · overlayPusher · eventQuery
               dailySummary
  lib/         signatureVerifier · ringClient · bedrockClient · dynamoClient
               snapshotStore · overlayPush · connectionStore · daySummary
  types/       shared types, modelled on the real Ring API
web/
  src/         api · view · app · main · demo — no dependencies, no framework
  test/        dashboard tests
firetv/
  src/         client · view · app · main — the §3.4 overlay, no dependencies
  test/        overlay tests
test/           18 suites on the Lambda side — 26 files with web/test and firetv/test,
                483 tests, no network access
docs/           9 subject folders — the documentation set has its own contract
scripts/        docs-check · build-lambda · verify-bundle · build-web · build-firetv
                · coverage-gaps · stage-demos
template.yaml  AWS SAM template
```

`docs/` is not filler. It is a source-verified record of the project, including where this
repository's own spec documents are **wrong** — see below. Start at
[`AGENTS.md`](./AGENTS.md).

---

## The documentation found real errors in the spec

This project documents its own conflicts rather than silently working around them.

- **The Ring webhook payload contract in `ARCHITECTURE.md` is wrong in 6 of 9 fields.** The
  most dangerous: webhook `sub_type` is **flat** (`human`, not `motion.human`) — the dotted
  form is an Event History query parameter, a different API surface. Code matching
  `"motion.human"` matches nothing, ever, and fails silently. The code follows the
  verified API.
- **"One app, one primary track" is not a rule.** It appears in `ARCHITECTURE.md` as a v2
  correction, and it is steering the project away from Fire TV first place — **$25,000 +
  $15K credits** versus Ring's **$12,000** — for work already specced.
- **The judging criteria list is wrong.** Stage Two has four equally weighted criteria;
  `ARCHITECTURE.md` names two that do not exist and omits one that does.
- **`GET /events/today` is specified with no auth mechanism anywhere** — not in §5.2, not in
  §4.2, not in the §6 mitigation table. A spec-faithful implementation ships a public
  endpoint returning a homeowner's door activity.
- **The picture-in-picture overlay does not exist as a Vega OS API.** Documented, not
  guessed.

Full detail: [`docs/05-hackathon-requirements/`](./docs/05-hackathon-requirements/00-overview.md).

---

## Friction Log

[`FRICTION_LOG.md`](./FRICTION_LOG.md) records **27** specific, actionable obstacles across
Ring API, Vega SDK, Bedrock, AWS setup, and documentation — each with the workaround used
and an upstream suggestion. Targets the 10% judging bonus.

The two worth reading first are the platform gaps that block other builders too: there is
**no webhook sandbox**, and there is **no documented overlay API on Vega OS**.

---

## License

MIT — see [LICENSE](./LICENSE).