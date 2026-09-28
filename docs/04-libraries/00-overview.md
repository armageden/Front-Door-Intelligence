**Verified against:** `docs/.docsrc.json`, the contract this subject is declared in, and the working tree.

# 04 — Libraries

| Field | Value |
|---|---|
| **Subject** | Shared library modules under `src/lib/` |
| **Folder** | `docs/04-libraries/` — declared as subject `libraries`, order 4, in [`docs/.docsrc.json`](../.docsrc.json) |
| **Source of truth** | `src/lib/` |
| **Reverse coverage** | Active — `paths.libGlobs` is `src/lib/**/*.ts`, so an undocumented module here fails the validator |
| **Status** | Seven modules implemented. Every client named in `ARCHITECTURE.md` §11 now exists, plus the WebSocket connection registry. |

**Read this when** you need the real signature, return shape, or failure modes of a
shared module — as opposed to the design intent, which lives in
[02-architecture](../02-architecture/00-overview.md).

This is the first subject in the repository that documents **code rather than a
specification**. Every claim on these pages was read out of a file on disk.

## Contents

| File | What it covers |
|---|---|
| [01-signature-verification](./01-signature-verification.md) | `signatureVerifier.ts` → `computeSignature()`, `verifySignature()`, and the `sha256=` prefix it must strip |
| [02-dynamodb](./02-dynamodb.md) | `dynamoClient.ts` → `claimRequestId()`, `toDoorEvent()`, `putEvent()`, `queryEventsByDate()`; the conditional put that makes NFR2 true, and the paginated query that makes FR8 work |
| [03-ring-client](./03-ring-client.md) | `ringClient.ts` → token lifecycle, device lookup, and the two-request snapshot flow |
| [04-bedrock-client](./04-bedrock-client.md) | `bedrockClient.ts` → `describeImage()`, the FR9/FR10 prompt, and FR11's deterministic fallback |
| [05-snapshot-store](./05-snapshot-store.md) | `snapshotStore.ts` → S3 snapshot keys and the SQS hand-off to the describe stage |
| [06-overlay-push](./06-overlay-push.md) | `overlayPush.ts` and `connectionStore.ts` → the §3.4 payload, per-connection fan-out, the WebSocket connection registry, and the shared snapshot pre-signer |

## Naming

The subject is `04-libraries`, not `04-handlers`, because `src/lib/` was the first
directory with code in it. `ARCHITECTURE.md` §11 plans a `src/handlers/` directory too,
and that now has its own subject at
[06-handlers](../06-handlers/00-overview.md) rather than a number of its own — the
number was taken, and subject numbers are stable by contract, so renumbering would
silently repoint the relative links in three sibling folders.

## Related

- The design behind the module: [02-pipeline-components](../02-architecture/02-pipeline-components.md)
- What still has to be built: [04-planned-structure](../03-repository/04-planned-structure.md)
- The obligation to add a subject when code lands: `AGENTS.md` Rule 4
