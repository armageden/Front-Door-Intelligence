**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` §5, read directly; FR1–FR18 and their exact MUST/MAY wording checked against the source. The status column is derived from the working tree, not from the PRD — every row was re-read from the code on 2026-09-28, naming the module that satisfies it. Rows that are not implemented say why, and the two that are *blocked* say so as "not implementable as written" rather than lumping them in with work nobody has started. The Bedrock request envelope and every Ring request shape are verified against documentation, not observed traffic.

<!-- docs-check:expect-absent FRICTION_LOG.md -->

# Functional requirements (FR1–FR18)

Source: `prd.md` §5. Every ID below is quoted from the PRD; the "status" column is
derived from what is on disk, not from the PRD's intent.

## 5.1 Core pipeline

| ID | Requirement | Status |
|---|---|---|
| FR1 | MUST receive Ring webhook events in real time via HTTP POST | **Implemented** — `webhookHandler.ts`, `POST /webhook/ring` |
| FR2 | MUST verify the `X-Signature` HMAC-SHA256 header on every incoming webhook request | **Implemented** — `signatureVerifier.ts` |
| FR3 | MUST extract the event subtype (`motion.human`, `motion.vehicle`, `motion.other_motion`, `button_press`) from `data.attributes` | **Implemented, with the PRD's values corrected** — the code reads `sub_type` as *flat* (`human`, `vehicle`, `motion`, `other_motion`), because the dotted form belongs to the Event History query parameter, not the webhook. See [04-ring-api-findings](../05-hackathon-requirements/04-ring-api-findings.md) |
| FR4 | For person/motion events, MUST request a camera snapshot via the Ring Partner API within 5 seconds of receiving the webhook | **Implemented, unmeasured** — `snapshotFetcher.ts`; the 5-second budget has never been observed |
| FR5 | MUST send the snapshot to Amazon Bedrock (Claude or Nova) for a one-sentence natural-language description | **Implemented** — `bedrockClient.describeImage()`, with a Nova response fallback |
| FR6 | MUST deliver the description + snapshot to a Fire TV overlay within 8 seconds of the original event | **Half** — the message reaches a connected WebSocket client, but no Fire TV app exists and the 8-second target is unmeasured across three queue hops |
| FR7 | MUST store every processed event in DynamoDB for daily summary generation | **Implemented** — `dynamoClient.putEvent()`; the *summary* half is not, see §3.6 |
| FR8 | MUST expose a `GET /events/today` endpoint returning all events for the current day | **Implemented** — `eventQuery.ts`, a paginated query on the `date` partition. Returns the UTC day by default and takes `?date=YYYY-MM-DD`; the spec named no auth, so a static `X-Query-Key` was added — decisions D022 and D023 |

FR1–FR8 form the linear chain: webhook → snapshot → Bedrock → overlay → store → query.
Six of the eight stages are written; the query endpoint and the front end are not. The
component-by-component design is in
[02-pipeline-components](../02-architecture/02-pipeline-components.md).

## 5.2 AI description layer

| ID | Requirement | Status |
|---|---|---|
| FR9 | Bedrock prompt MUST instruct the model to describe only what is visible: person, package, vehicle, animal, or "nothing identifiable." | **Implemented** — `SYSTEM_PROMPT` in `bedrockClient.ts`, plus a watermark clause not in the PRD |
| FR10 | The model MUST NOT make judgments about people (e.g. "suspicious person"). It describes actions and objects only. | **Implemented** — "Do not judge or label people" is in `SYSTEM_PROMPT` |
| FR11 | If Bedrock is unavailable, MUST fall back to a deterministic local summary (e.g., "Person detected at Front Door") | **Implemented** — `deterministicDescription()`, pure and synchronous so it cannot itself fail |

FR10 is a **safety** requirement, not a quality preference. The PRD ties it to Ring's
priority categories of access control and caretaking. Prompt text that must satisfy
FR9/FR10 is quoted in
[02-pipeline-components](../02-architecture/02-pipeline-components.md).

## 5.3 Fire TV overlay

| ID | Requirement | Status |
|---|---|---|
| FR12 | The overlay MUST appear as picture-in-picture without stopping the currently playing content | **Not implementable as written** — no documented Vega OS API supports a system-level overlay. The delivery half is built; decision D021 |
| FR13 | The overlay MUST include: snapshot thumbnail, one-sentence description, timestamp, and a dismiss button | **Partly** — the payload carries `snapshot_url`, `description`, and `timestamp`; the dismiss button needs a client that does not exist |
| FR14 | The overlay MUST auto-dismiss after 15 seconds if not interacted with | Not implementable as written — `useToastKepler` is text-and-icon with a fixed SHORT or LONG duration, and cannot express 15 seconds |
| FR15 | The overlay MUST work on Fire TV Stick 4K Select running Vega OS | Not implemented — no `firetv/` directory exists at all |

FR12 is the constraint that shapes the Fire TV app design: no playback interruption.
See [01-system-overview](../02-architecture/01-system-overview.md) for why the
WebSocket API is the push mechanism, and
[05-fire-tv-vega-findings](../05-hackathon-requirements/05-fire-tv-vega-findings.md)
for the API survey behind FR12 and FR14.

**FR12 and FR14 are the two requirements this project cannot satisfy as written.** Both
blockers are platform limits, not engineering effort, and both were confirmed against
all 38 documented Vega APIs rather than assumed. That is a finding to raise with the
judges, not a gap to quietly ship around.

## 5.4 Optional cross-track integration

| ID | Requirement | Status |
|---|---|---|
| FR16 | *[Optional]* An Alexa+ MCP server endpoint MAY expose a `get_latest_door_event` tool for voice queries | Optional, not implemented |
| FR17 | *[Optional]* Bee data MAY trigger a "check front door" reminder when the user arrives home | Optional, not implemented |

Both use MAY, not MUST. The PRD and `ARCHITECTURE.md` §3.7 both state the governing
rule: one app can only be entered into **one** primary track, so these are supporting
adapters inside the Ring entry, never separate submissions.

## 5.5 Friction Log

| ID | Requirement | Status |
|---|---|---|
| FR18 | MUST include a `FRICTION_LOG.md` documenting every tooling error, outdated doc, and broken dependency encountered | Not implemented — file does not exist |

FR18 is the only requirement with a named deliverable file that is missing from the
repo root. The template it must follow is in
[03-add-a-friction-log-entry](../00-how-to/03-add-a-friction-log-entry.md).

## Related

- [02-non-functional-requirements](./02-non-functional-requirements.md) — NFRs and metrics
- [03-submission-checklist](./03-submission-checklist.md) — what must ship for judging
