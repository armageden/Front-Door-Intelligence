**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §15, read directly. D001–D007 are paraphrases of that table's seven rows; the ADR-lite format is this repository's own and is not a project artefact. No decision here is verified against code, because there is none.

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

## Related

- [01-system-overview](./01-system-overview.md) — the design these decisions produced
- [05-security-and-services](./05-security-and-services.md) — the current threat posture
