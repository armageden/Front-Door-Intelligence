# 02 — Architecture

**Verified against:** `ARCHITECTURE.md` (the source of truth for this subject), read directly. Nothing in this subject is verified against code, because no code exists.

| Field | Value |
|---|---|
| **Subject** | Technical architecture |
| **Folder** | `docs/02-architecture/` — declared as subject `architecture`, order 2, in [`docs/.docsrc.json`](../.docsrc.json) |
| **Source of truth** | `ARCHITECTURE.md` (repo root), version 2.0 (Corrected) |
| **Status of the design** | Fully specified, zero implemented — see [01-current-state](../03-repository/01-current-state.md) |

**Read this when** you need the technical design: pipeline stages, component
contracts, API request/response shapes, the data model, the security posture, or the
reasoning behind a recorded design decision.

> Every component, table and endpoint documented here is a **specification**, not a
> description of running code. No Lambda, table, or endpoint exists in the repository.

## Contents

| File | What it covers |
|---|---|
| [01-system-overview](./01-system-overview.md) | Style, cloud, tracks, the system context diagram, and the two data flows |
| [02-pipeline-components](./02-pipeline-components.md) | The six Lambda functions, their triggers, inputs, outputs and fallbacks |
| [03-api-contracts](./03-api-contracts.md) | Request headers, body shapes and responses for the two specified endpoints |
| [04-data-store](./04-data-store.md) | DynamoDB table keys, TTLs, and the event item schema |
| [05-security-and-services](./05-security-and-services.md) | Threat mitigations and the AWS services in scope |
| [06-design-decisions](./06-design-decisions.md) | ADR-lite log: decision, why, and when it was made |

## Relationship to other subjects

- The requirements this design satisfies: [01-product](../01-product/00-overview.md)
- What actually exists on disk: [03-repository](../03-repository/00-overview.md)
- Recipes for changing the spec: [00-how-to](../00-how-to/00-overview.md)
