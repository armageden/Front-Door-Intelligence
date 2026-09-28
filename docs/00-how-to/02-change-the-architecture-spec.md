**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §3, §5, §6, §7, §8, §9 and §15, read directly, and the section numbering confirmed against the headings actually present in that file.

# Recipe: change the architecture spec

**Goal:** change the technical design — a component, a contract, a data shape, or a
flow — and keep the architecture docs, the design-decision log, and the plan in
[04-planned-structure](../03-repository/04-planned-structure.md) in agreement.

## When this applies

A Lambda's trigger or budget changes, an endpoint's request or response shape changes, a
DynamoDB key or TTL changes, a prompt changes, or the pipeline gains or loses a stage.

## Steps

1. **Edit the owning section in `ARCHITECTURE.md`.** The mapping is one-to-one:
   §3.1 webhook handler, §3.2 snapshot fetcher, §3.3 Bedrock describer, §3.4 overlay
   pusher, §3.5 event store, §3.6 daily summary, §3.7 optional adapters, §5 API
   contracts, §6 security, §7 services, §8 deployment, §9 local development.

2. **Bump the version in the `ARCHITECTURE.md` header table.** It reads
   `Version | 2.0 (Corrected)`. Keep the `(Corrected)` suffix only while a correction
   is outstanding.

3. **Record what changed in `ARCHITECTURE.md` §15** if it replaces an earlier decision.
   The existing seven corrections there follow a fixed
   `Issue in v1 | Correction in v2` shape.

4. **Add a design-decision entry.** Open
   [06-design-decisions](../02-architecture/06-design-decisions.md) and append one
   paragraph: what was decided, why, date, and source. Do not edit D001–D021; take the
   next unused ID. If the
   decision is already captured by a §15 row, add the entry and leave §15 alone.

5. **Mirror the change into the reference subject.** These are the files that carry
   detail without drifting from the Mermaid diagram and JSON blocks in the spec:

   | Change | File to update |
   |---|---|
   | Component behaviour or budget | [02-pipeline-components](../02-architecture/02-pipeline-components.md) |
   | Request or response shape | [03-api-contracts](../02-architecture/03-api-contracts.md) |
   | Table keys, TTL, item fields | [04-data-store](../02-architecture/04-data-store.md) |
   | Threat or mitigation | [05-security-and-services](../02-architecture/05-security-and-services.md) |
   | Flow or ordering | [01-system-overview](../02-architecture/01-system-overview.md) |

6. **Check the knock-on requirements.** Each component traces to requirement IDs. The
   component list and the FR catalogue are cross-linked — a change that breaks FR9
   means the prompt in §3.3 and FR9 both need attention.

7. **Run the validator.**

   ```bash
   node scripts/docs-check.mjs
   ```

## Real patterns to copy

Component tables in `ARCHITECTURE.md` §3 are two-column, `Property | Value`:

```markdown
| Property | Value |
|---|---|
| **Trigger** | Ring Partner API webhook |
| **Timeout** | 4 seconds (must complete before webhook response) |
```

Verbatim prompts stay in fenced blocks so the exact wording survives. When you change a
prompt, copy the new text across both
[02-pipeline-components](../02-architecture/02-pipeline-components.md) and §3.

## Verify

| Question | Answer when |
|---|---|
| Does the header version match the newest correction? | Yes |
| Is there a new `D00<n>` entry? | Appended, existing IDs untouched |
| Does every affected reference file agree with the spec? | No contradictions |
| Do the validator's nine checks pass? | Exit code 0 |

## Depth

- Component detail: [02-pipeline-components](../02-architecture/02-pipeline-components.md)
- Wire formats: [03-api-contracts](../02-architecture/03-api-contracts.md)
- Decision log: [06-design-decisions](../02-architecture/06-design-decisions.md)
