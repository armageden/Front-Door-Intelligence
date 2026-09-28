**Verified against:** `docs/.docsrc.json`, the contract this subject is declared in, and the working tree.

<!-- docs-check:expect-absent src/handlers/bedrockDescriber.ts src/handlers/overlayPusher.ts src/handlers/eventQuery.ts src/handlers/dailySummary.ts  src/handlers/overlayPusher.ts src/handlers/eventQuery.ts src/handlers/dailySummary.ts -->

# 06 — Handlers

| Field | Value |
|---|---|
| **Subject** | Lambda request handlers under `src/handlers/` |
| **Folder** | `docs/06-handlers/` — declared as subject `handlers`, order 6, in [`docs/.docsrc.json`](../.docsrc.json) |
| **Source of truth** | `src/handlers/` |
| **Reverse coverage** | Active — `paths.handlerGlobs` is `src/handlers/**/*.ts` |
| **Status** | Two of six handlers implemented. `src/handlers/overlayPusher.ts`, `src/handlers/eventQuery.ts`, and `src/handlers/dailySummary.ts` remain. |

**Read this when** you need what a handler actually receives, what status it returns,
and why those status codes were chosen — as opposed to the design intent in
[02-architecture](../02-architecture/00-overview.md).

## Contents

| File | What it covers |
|---|---|
| [01-webhook-ingress](./01-webhook-ingress.md) | `webhookHandler.ts` → `ingest()`, `readRawBody()`, `handler()`; the raw-body ordering rule, the status-code policy, and the queue hand-off |
| [02-describe-stage](./02-describe-stage.md) | `snapshotFetcher.ts` → `describeEvent()`, `handler`; the media window, and why every failure still writes a sentence |

## Naming

`06-handlers`, not `04-handlers`. The number was taken by
[04-libraries](../04-libraries/00-overview.md) when the first module landed, and
subject numbers are stable by contract — renumbering would silently repoint the
relative links in three sibling folders.

## Related

- The shared modules the handler calls: [04-libraries](../04-libraries/00-overview.md)
- The design behind this stage: [02-pipeline-components](../02-architecture/02-pipeline-components.md)
- The corrected Ring payload shape: [04-ring-api-findings](../05-hackathon-requirements/04-ring-api-findings.md)
- Shared modules: [04-libraries](../04-libraries/00-overview.md)
