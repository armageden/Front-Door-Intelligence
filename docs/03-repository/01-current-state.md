**Back:** [00-overview](./00-overview.md)

**Verified against:** The working tree, checked with `git status`, `git ls-files`, and a `find` sweep for every manifest, hook, and CI variant. Status values are point-in-time and go stale the moment code lands.

<!-- docs-check:expect-absent README.md LICENSE FRICTION_LOG.md template.yaml .env.example package.json -->

# Current state

Verified against the working tree. This file is the ground truth for every "does it
exist yet" claim in the documentation.

## What exists

| Path | Kind | Tracked |
|---|---|---|
| `prd.md` | Product requirements spec, version 1.0 | Yes |
| `ARCHITECTURE.md` | Technical architecture spec, version 2.0 (Corrected) | Yes |
| `AGENTS.md` | Agent router and working rules | No — new, uncommitted |
| `CLAUDE.md` | Pointer to `AGENTS.md` | No — new, uncommitted |
| `.claude/agents/docs-updater.md` | Canonical docs-sync runbook | No — new, uncommitted |
| `docs/` | Documentation set, 4 subject folders | No — new, uncommitted |
| `docs/.docsrc.json` | The docs contract — machine-readable source of truth | No — new, uncommitted |
| `scripts/docs-check.mjs` | Documentation validator, reads the contract | No — new, uncommitted |
| `.github/workflows/docs-check.yml` | CI gate that runs the validator | No — new, uncommitted |

Everything except the first two rows was added by the documentation system itself and
is not yet committed. The human owns every commit — see Rule 0 in `AGENTS.md`.

## What does not exist

No application source, no build manifest, no infrastructure template, no test suite,
no lockfile, no git hooks, and no front-end code of any kind. The two spec documents
describe a system that has not been started. The only automation present is the
documentation validator and the CI workflow that runs it — see
[03-verification-commands](./03-verification-commands.md).

## Git

| Field | Value |
|---|---|
| Branch | `main` |
| Remote | `https://github.com/armageden/Front-Door-Intelligence.git` |
| History | One commit: the initial PRD |

## What this means for the documentation

The [01-product](../01-product/00-overview.md) and
[02-architecture](../02-architecture/00-overview.md) subjects describe a **specification
that has not been built**. That is a deliberate split, and it is enforced in two ways:

1. Every subject overview carries an explicit status row saying specified vs
   implemented.
2. `scripts/docs-check.mjs` refuses to let a document reference a code path that does
   not exist on disk. Anything not yet written has to be declared absent or marked as
   planned — see [04-planned-structure](./04-planned-structure.md) for the marker
   syntax.

## Deliverables required but absent

Every item below is named by a requirement or section in the specs and does not exist
in the working tree.

| Missing path | Required by |
|---|---|
| `README.md` | NFR5, and `ARCHITECTURE.md` §11 |
| `LICENSE` (MIT) | NFR4, PRD §13 checklist |
| `FRICTION_LOG.md` | FR18, `ARCHITECTURE.md` §10 |
| `template.yaml` | `ARCHITECTURE.md` §11, §8.3 deploy commands |
| `.env.example` | NFR3, `ARCHITECTURE.md` §8.2 |
| `package.json` | `ARCHITECTURE.md` §11 |
| `src/` (handlers, lib, types) | `ARCHITECTURE.md` §11 |
| `firetv/` | `ARCHITECTURE.md` §11 |
| `web/` | `ARCHITECTURE.md` §11 |
| `test/` | `ARCHITECTURE.md` §11, §9.1 curl example |

Because none of these exist, no statement anywhere in `docs/` may present their
contents as fact. The planned layout is confined to
[04-planned-structure](./04-planned-structure.md).

## Known documentation defect

`prd.md` contains six inline citation markers, `[reference:0]` through
`[reference:5]`, and there is no reference list or footnote file anywhere in the
repository, so all six point at nothing. Their exact placements:

| Marker | Attached to |
|---|---|
| `[reference:0]` | FR3 — the event subtype list in `data.attributes` |
| `[reference:1]` | NFR1 — the 5-second webhook response requirement |
| `[reference:2]` | NFR4 — the MIT License requirement |
| `[reference:3]` | NFR6 — the 3-minute demo video requirement |
| `[reference:4]` | Constraints — Ring physical device not required |
| `[reference:5]` | Constraints — Vega OS testing needs a device |

This is left in place rather than silently stripped, because deciding what each
citation was supposed to support is a content call for the author. See
[04-run-a-docs-sync-pass](../00-how-to/04-run-a-docs-sync-pass.md) for how to raise it
through the friction log.

## Related

- [02-toolchain](./02-toolchain.md) — what can actually be run today
- [03-verification-commands](./03-verification-commands.md) — the check commands
