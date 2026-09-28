**Verified against:** `docs/.docsrc.json` (the contract this subject describes), `prd.md`, and `ARCHITECTURE.md`; all file-existence claims checked against the working tree.

# 03 — Repository

| Field | Value |
|---|---|
| **Subject** | The repository itself |
| **Folder** | `docs/03-repository/` — declared as subject `repository`, order 3 |
| **Tracks** | What exists, what is real, and what is only a plan |
| **Contract** | [`docs/.docsrc.json`](../.docsrc.json) — the machine-readable source of truth for this subject and the validator |

**Read this when** you need to know what actually exists on disk, which commands are
genuinely runnable, and which parts of the design are still unwritten. Check this
subject before assuming any code, script, or config file exists.

The contract is the authoritative version of the toolchain, commands, globs, and
subject layout documented here. If this page and the contract disagree, the contract
wins and this page is the bug.

## Contents

| File | What it covers |
|---|---|
| [01-current-state](./01-current-state.md) | Complete inventory of the working tree and what is missing against the spec |
| [02-toolchain](./02-toolchain.md) | Verified runtimes, the npm toolchain, and the bundler-versus-`tsc` decision |
| [03-verification-commands](./03-verification-commands.md) | The seven runnable commands, the coverage metric, the nine validator checks, and CI/hook status |
| [04-planned-structure](./04-planned-structure.md) | The file tree from `ARCHITECTURE.md` §11, recorded as planned and unverified |

## Relationship to other subjects

- What the specs require: [01-product](../01-product/00-overview.md)
- The technical design: [02-architecture](../02-architecture/00-overview.md)
- How to keep this subject current: [04-run-a-docs-sync-pass](../00-how-to/04-run-a-docs-sync-pass.md)
- Working rules and the enforcement gate: `AGENTS.md`
