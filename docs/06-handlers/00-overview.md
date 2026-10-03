**Verified against:** `docs/.docsrc.json`, the contract this subject is declared in, and the working tree.

<!-- docs-check:expect-absent src/handlers/bedrockDescriber.ts -->

# 06 — Handlers

| Field | Value |
|---|---|
| **Subject** | Lambda request handlers under `src/handlers/` |
| **Folder** | `docs/06-handlers/` — declared as subject `handlers`, order 6, in [`docs/.docsrc.json`](../.docsrc.json) |
| **Source of truth** | `src/handlers/` |
| **Reverse coverage** | Active — `paths.handlerGlobs` and `paths.routeGlobs` are both `src/handlers/**/*.ts`, so an unreferenced handler or route fails the validator |
| **Status** | Five of six handlers implemented. Every `src/` file the spec asks for now exists. `src/handlers/bedrockDescriber.ts` was folded into `snapshotFetcher.ts` by decision D018 |

**Read this when** you need what a handler actually receives, what status it returns,
and why those status codes were chosen — as opposed to the design intent in
[02-architecture](../02-architecture/00-overview.md).

## Contents

| File | What it covers |
|---|---|
| [01-webhook-ingress](./01-webhook-ingress.md) | `webhookHandler.ts` → `ingest()`, `readRawBody()`, `handler()`; the raw-body ordering rule, the status-code policy, and the queue hand-off |
| [02-describe-stage](./02-describe-stage.md) | `snapshotFetcher.ts` → `describeEvent()`, `handler`; the media window, and why every failure still writes a sentence |
| [03-overlay-push](./03-overlay-push.md) | `overlayPusher.ts` → `deliverEvent()`, `onConnect`, `onDisconnect`; the §3.4 payload, and why the picture-in-picture is not implemented |
| [04-event-query](./04-event-query.md) | `eventQuery.ts` → `queryToday()`, `buildTodayResponse()`; the auth the spec omitted, and why "today" is UTC and overridable |
| [05-daily-summary](./05-daily-summary.md) | `dailySummary.ts` → `resolveSummaryDate()`, `generateDaySummary()`, `handler`; which UTC partition gets summarised, and why every run ends in a sentence |
| [05-daily-summary](./05-daily-summary.md) | `dailySummary.ts` → `resolveSummaryDate()`, `generateDaySummary()`, `handler`; the clock-triggered stage, and which partition it actually summarises |

## Naming

`06-handlers`, not `04-handlers`. The number was taken by
[04-libraries](../04-libraries/00-overview.md) when the first module landed, and
subject numbers are stable by contract — renumbering would silently repoint the
relative links in three sibling folders.

## Related

- The shared modules the handler calls: [04-libraries](../04-libraries/00-overview.md)
- The design behind each stage: [02-pipeline-components](../02-architecture/02-pipeline-components.md)
- The corrected Ring payload shape: [04-ring-api-findings](../05-hackathon-requirements/04-ring-api-findings.md)
- What is still unwritten: [04-planned-structure](../03-repository/04-planned-structure.md)
