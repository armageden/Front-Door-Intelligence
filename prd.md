# Front Door Intelligence — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| **Project Name** | Front Door Intelligence |
| **Hackathon** | Build, Ship, Shape: Amazon Developer Hackathon 2026 |
| **Primary Track** | Ring, Fire TV |
| **Mini-Challenges** | AWS Builder, Open Source |
| **Version** | 1.2 |
| **Author** | farhan |
| **Date** | October 16, 2026 |
| **Deadline** | October 24, 2026 (3:00 AM GMT+8) |

---

## 1. Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-09-28 | 1.0 | Initial PRD created | farhan |
| 2026-10-16 | 1.1 | Corrected against the Devpost Official Rules: FR3 subtype values (flat, not dotted), NFR1/NFR4/NFR6 citations, private-repo constraint (private repos are judgeable), Vega OS testing constraint (emulator sufficient). All six dead `[reference:N]` markers removed. Evidence: `docs/05-hackathon-requirements/03-doc-conflicts.md`. | farhan |
| 2026-10-16 | 1.2 | Primary Track set to **Ring, Fire TV**, re-verified against the live Rules: §4 imposes no entry limit and §8 caps only prizes *won*. Goals §2 and Background §3 updated to match. Evidence: `docs/05-hackathon-requirements/03-doc-conflicts.md` conflict 2. | farhan |

---

## 2. Goals

- Transform raw Ring motion events into contextual, one-sentence AI descriptions delivered to the TV screen without interrupting viewing.
- Reduce the cognitive load of checking a phone for every doorbell/motion notification.
- Demonstrate a working, end-to-end pipeline using Ring APIs, AWS Bedrock, and Fire TV overlay — all live, no mocked data in the final demo.
- Enter the **Ring** and **Fire TV** primary tracks — only one track prize can be won, but both may be entered (Rules §8) — and qualify for both mini-challenges (AWS Builder + Open Source).
- Earn the 10% Friction Log bonus by documenting every tooling friction point.

---

## 3. Background Context

Every smart home generates a flood of raw alerts: "Motion detected at Front Door." These notifications are context-free, interruptive, and force the user to stop what they're doing, find their phone, and open an app. The result is alert fatigue, missed deliveries, and anxiety.

**Front Door Intelligence** solves this by inserting an AI reasoning layer between the Ring event and the human. Instead of a raw motion ping, the user receives a natural-language description — "Amazon delivery driver placed a medium box" — displayed as a non-intrusive picture-in-picture overlay on their Fire TV. The system understands *what happened*, not just *that something moved*.

The Amazon Developer Hackathon is the first time Ring, Fire TV, Alexa+, and Bee have been opened to external developers simultaneously. This project targets the **Ring** primary track (priority category: **access control** and **caretaking**) and the **Fire TV** primary track, while integrating AWS Bedrock for the **AWS Builder** mini-challenge and shipping as open source for the **Open Source** mini-challenge.

---

## 4. User Personas

| Persona | Need | How Front Door Intelligence Helps |
|---|---|---|
| **The Remote Worker** | Doesn't want to miss a delivery while in a meeting. | Sees a TV overlay description without leaving the meeting. |
| **The Caregiver** | Needs to know when a nurse or aide arrives without watching the door. | Receives an AI summary of who arrived and when. |
| **The Family** | Wants to know when kids get home without checking phones. | TV overlay announces arrival with a snapshot. |
| **The Access Control Manager** | Needs a log of who entered a business entrance. | Event history + AI daily summary exported to a dashboard. |

---

## 5. Functional Requirements

### 5.1 Core Pipeline

- **FR1:** The system MUST receive Ring webhook events in real time via HTTP POST.
- **FR2:** The system MUST verify the `X-Signature` HMAC-SHA256 header on every incoming webhook request.
- **FR3:** The system MUST extract the event subtype from `data.attributes.sub_type`, whose
  documented values are **flat**: `motion`, `human`, `vehicle`, `other_motion`. The dotted forms
  (`motion.human`) belong to the Event History **query parameter**, a different API surface, and
  match nothing on the webhook. `button_press` is an event `type`, not a subtype (Ring Partner API
  documentation).
- **FR4:** For person/motion events, the system MUST request a camera snapshot via the Ring Partner API within 5 seconds of receiving the webhook.
- **FR5:** The system MUST send the snapshot to Amazon Bedrock (Claude or Nova) for a one-sentence natural-language description.
- **FR6:** The system MUST deliver the description + snapshot to a Fire TV overlay within 8 seconds of the original event.
- **FR7:** The system MUST store every processed event in DynamoDB for daily summary generation.
- **FR8:** The system MUST expose a `GET /events/today` endpoint returning all events for the current day.

### 5.2 AI Description Layer

- **FR9:** Bedrock prompt MUST instruct the model to describe only what is visible: person, package, vehicle, animal, or "nothing identifiable."
- **FR10:** The model MUST NOT make judgments about people (e.g., "suspicious person"). It describes actions and objects only.
- **FR11:** If Bedrock is unavailable, the system MUST fall back to a deterministic local summary (e.g., "Person detected at Front Door").

### 5.3 Fire TV Overlay

- **FR12:** The overlay MUST appear as picture-in-picture without stopping the currently playing content.
- **FR13:** The overlay MUST include: snapshot thumbnail, one-sentence description, timestamp, and a dismiss button.
- **FR14:** The overlay MUST auto-dismiss after 15 seconds if not interacted with.
- **FR15:** The overlay MUST work on Fire TV Stick 4K Select running Vega OS.

### 5.4 Optional Cross-Track Integration (Supporting, Not Primary)

- **FR16:** [Optional] An Alexa+ MCP server endpoint MAY expose a `get_latest_door_event` tool for voice queries.
- **FR17:** [Optional] Bee data MAY trigger a "check front door" reminder when the user arrives home.

### 5.5 Friction Log

- **FR18:** The project MUST include a `FRICTION_LOG.md` documenting every tooling error, outdated doc, and broken dependency encountered.

---

## 6. Non-Functional Requirements

- **NFR1:** Webhook endpoint MUST return HTTP 200 within 5 seconds. The Ring documentation names
  inline heavy processing as a Common Mistake because it exceeds the 5-second response budget and
  produces duplicates, so the target is the documentation's own, not an invented SLA.
- **NFR2:** Webhook handling MUST be idempotent — duplicate `request_id` values MUST not create duplicate events.
- **NFR3:** All API keys and tokens MUST be stored as environment variables, never committed to the repository.
- **NFR4:** The public GitHub repository MUST include an MIT License, detectable and visible in
  the About section (Rules §4, submission requirement 5).
- **NFR5:** The README MUST include complete setup instructions so judges can run the project locally.
- **NFR6:** The demo video MUST be under 3 minutes, publicly visible on YouTube or Vimeo, and show
  the project functioning on the target device (Rules §4, submission requirement 7).
- **NFR7:** Total AWS resource usage SHOULD stay within free-tier limits where feasible.

---

## 7. User Stories

| ID | As a... | I want to... | So that... |
|---|---|---|---|
| US1 | Remote Worker | See a TV overlay when a package arrives | I don't miss a delivery while in a meeting |
| US2 | Caregiver | Get an AI summary of a nurse's visit | I can log care activity without watching the door |
| US3 | Family Member | Know when my kids get home | I can feel reassured without checking my phone |
| US4 | Business Owner | Export a daily access log | I can review who entered the building |

---

## 8. UI / UX Vision

### 8.1 Core Screens

| Screen | Purpose |
|---|---|
| **Fire TV Overlay** | Picture-in-picture card with snapshot, description, dismiss button |
| **Web Dashboard** | Event timeline with filters, daily summary view, device status |
| **Setup / Settings** | Ring account linking, Bedrock model selection, overlay preferences |

### 8.2 Interaction Paradigms

- **Non-blocking overlay:** Appears over content, never pauses playback.
- **One-glance comprehension:** Snapshot + one sentence + timestamp. No scrolling.
- **Voice-friendly (optional):** Alexa+ can read the latest event aloud.

### 8.3 Accessibility

- WCAG AA contrast ratios on all overlay text.
- Auto-dismiss timer configurable (default 15 seconds, can be extended to 30).
- Snapshot includes alt-text generated by Bedrock for screen readers.

---

## 9. Success Metrics

| Metric | Target |
|---|---|
| End-to-end latency (Ring event → TV overlay) | < 8 seconds |
| Webhook response time | < 5 seconds |
| Bedrock description accuracy (human eval) | > 80% "describes what's visible" |
| Demo video length | < 3 minutes |
| Friction Log entries | > 10 specific, actionable items |
| Public repo completeness | README + LICENSE + setup instructions + env template |

---

## 10. Constraints

- **Time:** ~26 days to deadline (October 24, 2026).
- **Solo developer:** No team; must prioritize ruthlessly.
- **Ring physical device:** Not required; simulators are explicitly accepted (Rules §4).
- **Public repo:** Publishing publicly is the plan. Rules §4 permits either a public open-source
  repo **or** a private repo shared with `testing@devpost.com` and the Amazon team — private
  repos are judgeable. Public remains the choice because it is simpler and it also serves the
  Open Source mini-challenge. Note that reviewer invitations expire after **7 days**, so if the
  private route were ever taken, collaborators should be added near submission time.
- **Vega OS testing:** An emulator or simulator is sufficient at every stage of submission and
  judging; a physical Fire TV Stick is **not** required (FAQs).

---

## 11. Out of Scope (For This Submission)

- Live video streaming (snapshots only).
- Multi-camera simultaneous overlays.
- Mobile app (web dashboard only).
- Bee primary-track submission (Bee is optional supporting integration only).
- Alexa+ primary-track submission (Alexa+ is optional supporting integration only).

---

## 12. Friction Log Plan

Document the following categories with specific examples:

| Category | What to Document |
|---|---|
| **Ring API** | Token expiration, consent flow confusion, webhook retry behavior |
| **Vega SDK** | Installation errors, emulator issues, overlay API limitations |
| **Bedrock** | Model selection confusion, prompt tuning iterations, latency variance |
| **AWS Setup** | IAM role configuration, Lambda cold starts, DynamoDB throttling |
| **Documentation Gaps** | Outdated examples, missing TypeScript types, unclear error messages |

---

## 13. Submission Checklist

- [ ] Public GitHub repo with MIT License in About section
- [ ] README with setup instructions and environment variable template
- [ ] Demo video < 3 minutes (uploaded to YouTube/Vimeo, public)
- [ ] Devpost submission form filled (tracks: Ring, Fire TV)
- [ ] Friction Log in repo root (`FRICTION_LOG.md`)
- [ ] Working demo accessible to judges
- [ ] AWS Builder mini-challenge: documented Bedrock integration
- [ ] Open Source mini-challenge: repo is public + MIT licensed