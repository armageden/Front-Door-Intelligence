**Verified against:** `docs/.docsrc.json`, the contract this subject is declared in, and the working tree.

# 07 — Web dashboard

| Field | Value |
|---|---|
| **Subject** | The dashboard in `web/` — the client for `GET /events/today` |
| **Folder** | `docs/07-web-dashboard/` — declared as subject `web-dashboard`, order 7, in [`docs/.docsrc.json`](../.docsrc.json) |
| **Source of truth** | `web/src/` |
| **Reverse coverage** | **Not covered.** `paths.libGlobs` and `paths.handlerGlobs` are `src/**` only, so a new file under `web/src/` will *not* fail the validator if this page stops mentioning it. That is a recorded gap, not an oversight — see [01-dashboard](./01-dashboard.md) |
| **Status** | Written and tested. No dependencies, no framework. Served from `web/dist/` and rendered in a real browser on 2026-10-04 — demo page and live page both; never rendered against a deployed backend |

**Read this when** you want to know what the dashboard shows a homeowner, what it refuses
to claim, and why it is not the React app `ARCHITECTURE.md` §11 sketches.

## Naming

`07-web-dashboard`, and it is the highest-numbered subject because it is the newest —
`06-handlers` existed first and its number is stable by contract, so this could not take
it. Renumbering either would silently repoint the relative links in its siblings, which
check 9 exists to prevent.

## Contents

| File | What it covers |
|---|---|
| [01-dashboard](./01-dashboard.md) | `api.ts`, `view.ts`, `app.ts`, `demo.ts` → the three layers, the fixture demo, why they are split, and the two things the UI refuses to guess |

## Related

- The endpoint it reads: [04-event-query](../06-handlers/04-event-query.md)
- The store behind it: [02-dynamodb](../04-libraries/02-dynamodb.md)
- The other front end, which does not exist: [04-planned-structure](../03-repository/04-planned-structure.md)
- The decision that shaped this: [06-design-decisions](../02-architecture/06-design-decisions.md)