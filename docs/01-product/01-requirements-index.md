**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` §5, read directly; FR1–FR18 and their exact MUST/MAY wording checked against the source. The status column is derived from the working tree, not from the PRD — every row was re-read from the code on 2026-09-28, naming the module that satisfies it. Rows that are not implemented say why, and the two that are *blocked* say so as "not implementable as written" rather than lumping them in with work nobody has started. The Bedrock request envelope and every Ring request shape are verified against documentation, not observed traffic.


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
| FR7 | MUST store every processed event in DynamoDB for daily summary generation | **Implemented both ways** — `dynamoClient.putEvent()` stores every event, and `putSummary()` writes the §3.6 daily summary back into the same partition |
| FR8 | MUST expose a `GET /events/today` endpoint returning all events for the current day | **Implemented** — `eventQuery.ts`, a paginated query on the `date` partition. Returns the UTC day by default and takes `?date=YYYY-MM-DD`; the spec named no auth, so a static `X-Query-Key` was added — decisions D022 and D023 |

FR1–FR8 form the linear chain: webhook → snapshot → Bedrock → overlay → store → query.
**All eight are written and tested against fakes**, and the §3.6 daily summary is written
beside them. The web client exists and renders (see
[07-web-dashboard](../07-web-dashboard/00-overview.md)); what is missing is the Fire TV
client, which is why FR6 is recorded as half. The component-by-component design is in
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
| FR13 | The overlay MUST include: snapshot thumbnail, one-sentence description, timestamp, and a dismiss button | **Implemented** — the §3.4 payload carries all four, and the `firetv/` client renders them with a working dismiss. The rendering is verified only in a browser, never on a television |
| FR14 | The overlay MUST auto-dismiss after 15 seconds if not interacted with | **Implemented in the client** — `DEFAULT_AUTO_DISMISS_MS = 15_000`, watched live in a browser. Vega's own `useToastKepler` cannot express 15s, which is why the overlay is a WebView page rather than a Kepler toast — see D021 and D034 |
| FR15 | The overlay MUST work on Fire TV Stick 4K Select running Vega OS | **Client written, never run on a device.** `firetv/` is a dependency-free page that runs in any browser and is designed to load in the `@amazon-devices/webview` Vega documents — but no Vega device has executed it. D034 |

FR12 is the constraint that shapes the Fire TV app design: no playback interruption.
See [01-system-overview](../02-architecture/01-system-overview.md) for why the
WebSocket API is the push mechanism, and
[05-fire-tv-vega-findings](../05-hackathon-requirements/05-fire-tv-vega-findings.md)
for the API survey behind FR12 and FR14.

**FR12 is the one requirement this project cannot satisfy as written.** The blocker is a
platform limit, not engineering effort, and it was confirmed against all 38 documented
Vega APIs rather than assumed. FR14 was on this list until D034 retired it — the 15-second
auto-dismiss is implemented in the `firetv/` client. That is one finding to raise with the
judges, not a gap to quietly ship around.

## 5.4 Optional cross-track integration

| ID | Requirement | Status |
|---|---|---|
| FR16 | *[Optional]* An Alexa+ MCP server endpoint MAY expose a `get_latest_door_event` tool for voice queries | Optional, not implemented |
| FR17 | *[Optional]* Bee data MAY trigger a "check front door" reminder when the user arrives home | Optional, not implemented |

Both use MAY, not MUST. `ARCHITECTURE.md` §3.7 records why Alexa+ and Bee remain out of scope
as entries: nothing in the Rules limits how many tracks a project may *enter* (only the prizes it
may *win*), but this project enters **Ring and Fire TV**, where both halves are already built.
FR16 and FR17 are therefore scoped as MAY supporting integrations, never separate submissions —
a scoping choice, not a rule.

## 5.5 Friction Log

| ID | Requirement | Status |
|---|---|---|
| FR18 | MUST include a `FRICTION_LOG.md` documenting every tooling error, outdated doc, and broken dependency encountered | **Implemented** — 27 entries across all five `prd.md` §12 categories, in the six-field shape Rules §6 requires. Worth up to a recommended 10% Stage One bonus |

FR18 is the only requirement with a named deliverable file that is missing from the
repo root. The template it must follow is in
[03-add-a-friction-log-entry](../00-how-to/03-add-a-friction-log-entry.md).

## Related

- [02-non-functional-requirements](./02-non-functional-requirements.md) — NFRs and metrics
- [03-submission-checklist](./03-submission-checklist.md) — what must ship for judging
