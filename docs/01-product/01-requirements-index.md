**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` §5, read directly; FR1–FR18 and their exact MUST/MAY wording checked against the source. The status column is derived from the working tree, not from the PRD.

<!-- docs-check:expect-absent FRICTION_LOG.md -->

# Functional requirements (FR1–FR18)

Source: `prd.md` §5. Every ID below is quoted from the PRD; the "status" column is
derived from what is on disk, not from the PRD's intent.

## 5.1 Core pipeline

| ID | Requirement | Status |
|---|---|---|
| FR1 | MUST receive Ring webhook events in real time via HTTP POST | Specified, not implemented |
| FR2 | MUST verify the `X-Signature` HMAC-SHA256 header on every incoming webhook request | Specified, not implemented |
| FR3 | MUST extract the event subtype (`motion.human`, `motion.vehicle`, `motion.other_motion`, `button_press`) from `data.attributes` | Specified, not implemented |
| FR4 | For person/motion events, MUST request a camera snapshot via the Ring Partner API within 5 seconds of receiving the webhook | Specified, not implemented |
| FR5 | MUST send the snapshot to Amazon Bedrock (Claude or Nova) for a one-sentence natural-language description | Specified, not implemented |
| FR6 | MUST deliver the description + snapshot to a Fire TV overlay within 8 seconds of the original event | Specified, not implemented |
| FR7 | MUST store every processed event in DynamoDB for daily summary generation | Specified, not implemented |
| FR8 | MUST expose a `GET /events/today` endpoint returning all events for the current day | Specified, not implemented |

FR1–FR8 form the linear chain: webhook → snapshot → Bedrock → overlay → store → query.
The component-by-component design is in
[02-pipeline-components](../02-architecture/02-pipeline-components.md).

## 5.2 AI description layer

| ID | Requirement | Status |
|---|---|---|
| FR9 | Bedrock prompt MUST instruct the model to describe only what is visible: person, package, vehicle, animal, or "nothing identifiable." | Specified, not implemented |
| FR10 | The model MUST NOT make judgments about people (e.g. "suspicious person"). It describes actions and objects only. | Specified, not implemented |
| FR11 | If Bedrock is unavailable, MUST fall back to a deterministic local summary (e.g., "Person detected at Front Door") | Specified, not implemented |

FR10 is a **safety** requirement, not a quality preference. The PRD ties it to Ring's
priority categories of access control and caretaking. Prompt text that must satisfy
FR9/FR10 is quoted in
[02-pipeline-components](../02-architecture/02-pipeline-components.md).

## 5.3 Fire TV overlay

| ID | Requirement | Status |
|---|---|---|
| FR12 | The overlay MUST appear as picture-in-picture without stopping the currently playing content | Specified, not implemented |
| FR13 | The overlay MUST include: snapshot thumbnail, one-sentence description, timestamp, and a dismiss button | Specified, not implemented |
| FR14 | The overlay MUST auto-dismiss after 15 seconds if not interacted with | Specified, not implemented |
| FR15 | The overlay MUST work on Fire TV Stick 4K Select running Vega OS | Specified, not implemented |

FR12 is the constraint that shapes the Fire TV app design: no playback interruption.
See [01-system-overview](../02-architecture/01-system-overview.md) for why the
WebSocket API is the push mechanism.

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
