# AGENTS.md

<!-- docs-check:expect-absent pnpm-lock.yaml yarn.lock bun.lockb bun.lock -->

Router for this repository. Read this first; it points at everything else.

## The contract

**[`docs/.docsrc.json`](./docs/.docsrc.json) is the single source of truth** for the
package manager, every command, every path and glob, the subject layout, the marker
syntax, the secret patterns, and the agent location.

Read the contract instead of trusting this file for any of those. If reality disagrees
with the contract, **fix the contract and say why** — do not work around it in a
consumer, and do not let this file drift into a second source of truth.

`scripts/docs-check.mjs` reads the contract too. It hardcodes nothing about this
repository.

## Project snapshot

**Front Door Intelligence** — an Amazon Developer Hackathon 2026 submission. A Ring
webhook triggers a Lambda chain that fetches a camera snapshot, generates a
one-sentence AI description via Bedrock, and stores the event for a Fire TV overlay.
Specified in `prd.md` and `ARCHITECTURE.md`.

| Field | Value |
|---|---|
| **Status** | **Working backend, partial.** Ingress and the describe stage are implemented and tested against fakes. No live AWS call has ever run. |
| **Language** | TypeScript `^7.0.2`, strict, ES2022, CommonJS output |
| **Framework** | AWS serverless — Lambda, API Gateway, DynamoDB, S3, SQS, Bedrock, via SAM. Never deployed. |
| **Package manager** | **npm** (12.1.0), lockfile `package-lock.json`. Chosen because `ARCHITECTURE.md` §9.1 specifies `npm install`, and npm resolves workspaces natively for the planned `firetv/` and `web/` packages. |
| **Repo shape** | Single package. No workspaces declared — npm fails on a workspace glob that matches nothing, so that waits for those directories. |
| **Runtimes available** | Node v22.23.3, npm 12.1.0, pnpm 11.13.1, Yarn 1.22.22. Bun is not installed. The project requires Node `>=20`. |

### Commands

Verbatim from the contract's `commands` block. **All of the first six run and pass.**

| Purpose | Command | Status |
|---|---|---|
| **everything** | `npm run all` | typecheck + test + build:verify + docs:check, in order |
| **docs:check** | `npm run docs:check` | available |
| **typecheck** | `npm run typecheck` | available — `tsc --noEmit`, covers `test/` too |
| **test** | `npm test` | available — vitest, 102 assertions |
| **test:coverage** | `npm run test:coverage` | available — the only mechanical metric in the repo |
| **build** | `npm run build` | available — esbuild bundles each handler into `dist/` |
| **build:verify** | `npm run build:verify` | available — asserts `dist/` is self-contained |
| dev | — | unavailable: no SAM CLI, no `sam local start-api` |
| lint | — | unavailable: no linter, by choice — see decision D011 |
| format | — | unavailable: no formatter |

Do not write the unavailable ones into CI or scripts. A command that cannot run fails
later, and in a worse place.

## Subject index

The contract's `subjects` array is authoritative, and `docsIndexes` names the files that
must point at every subject. Folders are `NN-` prefixed and the prefix must equal the
subject's `order`; the validator fails otherwise.

| Folder | Covers | Read it when |
|---|---|---|
| [`docs/00-how-to/`](./docs/00-how-to/00-overview.md) | Task-first recipes for this repo's recurring change types | **Doing a task? Start here.** Match your change to a recipe. |
| [`docs/01-product/`](./docs/01-product/00-overview.md) | FR1–FR18, NFR1–NFR7, success metrics, submission checklist | You need to know what the product must do, or which requirement ID to cite |
| [`docs/02-architecture/`](./docs/02-architecture/00-overview.md) | Pipeline design, API contracts, data store, security, decisions D001–D019 | You need the design intent or the reasoning behind a decision |
| [`docs/03-repository/`](./docs/03-repository/00-overview.md) | What exists on disk, the toolchain, check commands, the planned structure | **Before you assume any file, script, or command exists** |
| [`docs/04-libraries/`](./docs/04-libraries/00-overview.md) | Real exported APIs of the five modules under `src/lib/` | You need a module's actual signature, return shape, or failure modes |
| [`docs/05-hackathon-requirements/`](./docs/05-hackathon-requirements/00-overview.md) | The Devpost rules, the Ring API, and where the project docs conflict with both | You need to know what is worth points, or whether a document makes a claim the sources do not support |
| [`docs/06-handlers/`](./docs/06-handlers/00-overview.md) | The two Lambda handlers under `src/handlers/` | You are changing a handler or tracing an event through the pipeline |

Each subject folder opens with a `00-overview.md` carrying the subject name, folder
path, a "read this when" purpose, and a table of contents. Every other file backlinks
to it and carries a `**Verified against:**` line.

The two source documents live at the repo root: `prd.md` and `ARCHITECTURE.md`. Subject
folders reference them; they are never duplicated. **Both contain claims now known to be
wrong** — see [03-doc-conflicts](./docs/05-hackathon-requirements/03-doc-conflicts.md)
and [04-ring-api-findings](./docs/05-hackathon-requirements/04-ring-api-findings.md).
The code follows the verified sources, not the specs. That divergence is recorded, not
hidden.

## Working rules

### Rule 0 — Git is read-only

You may run `git status`, `git diff`, `git log`, `git show`. You must never run
`git add`, `git commit`, `git push`, `git stash`, or create a branch or tag — not even
when a task looks finished, and not even when asked to. The human does every commit.
If you think a commit is warranted, say so and stop.

When the human does ask for a commit: plain messages only. No AI attribution, no
`Co-Authored-By` trailer, no "Generated with" line.

### Rule 1 — Verify before you document

Every path, command, symbol, endpoint, and behaviour you write must be read out of a
real file in this session. Never infer a path from a spec's planned tree and present it
as real.

Cite the evidence: a sub-file states what it was verified against on its
`**Verified against:**` line, naming the file and section and, where one exists, the
symbol. **If a claim rests on a specification or on documentation rather than on code,
say so.** If you cannot verify a claim at all, write "not verified" or leave it out.
Never guess.

### Rule 2 — Prefer editing over creating

Edit an existing file rather than adding one. Keep documents short and true. Merge
subjects rather than proliferating them.

### Rule 3 — Run a docs-sync pass after any task that touched code

**"Touched code" means any of these changed in `git status`:**

- a file under `paths.sourceRoots` in the contract — currently `src`, `test`, `scripts`
- a file matching `paths.handlerGlobs` — currently `src/handlers/**/*.ts`
- a file matching `paths.routeGlobs` — currently **empty**
- `docs/.docsrc.json` itself
- any file whose path is cited in a document under `docs/`

Note what the globs do **not** cover yet: `src/lib/**` is covered by
`paths.libGlobs`, and a new file there fails reverse coverage. `routeGlobs` is still
empty, so a WebSocket route or a REST resource can land undocumented.

Then run the pass:

1. `git status`, `git diff`, `git diff --cached` — read-only
2. Map each changed file to its subject using the glob map in the runbook
3. Update affected docs, and repair anything the diff made false
4. Reverse check: any new file matching the globs must be referenced by path in a doc,
   or listed in `reverseCoverage.intentionallyUndocumented` with a reason
5. Append an ADR-lite paragraph to `docs/02-architecture/06-design-decisions.md` if a
   real architectural decision was made
6. Run `npm run docs:check` and fix every failure

**End your report with an explicit line:**

```text
docs checked/updated: <what you changed, or "no changes needed">
```

If nothing needed changing, say exactly that and name the subject you checked. A
silent pass is indistinguishable from a skipped pass.

The canonical runbook is [`.claude/agents/docs-updater.md`](./.claude/agents/docs-updater.md).
The human-readable mirror is
[`docs/00-how-to/04-run-a-docs-sync-pass.md`](./docs/00-how-to/04-run-a-docs-sync-pass.md).
Change both together.

### Rule 4 — Code and its subject folder land together

Creating the first file of a subsystem means creating its `docs/NN-<name>/` folder in
the same pass — overview, sub-files, backlinks, contract entry, index entries. Never
leave a repo full of code whose `docs/` tree still describes only the plan.

Folder numbers come from the contract's `subjects` array. **Never reuse a number from a
deleted folder**: relative links in siblings would silently repoint. Renaming a folder
means editing the contract in the same change.

### Rule 5 — A passing check is not proof the code or the docs are right

The gates prove **structure, not truth**, and each has a specific blind spot:

| Gate | Proves | Does not prove |
|---|---|---|
| `npm test` | The logic matches the assertions written for it | That the assertions match the real Ring or Bedrock API |
| `npm run build:verify` | `dist/` has no external `require()` | That the code inside is correct |
| `npm run docs:check` | Docs are well-formed and refer to real files | That a documented status code, parameter, or behaviour is right |
| `npm run typecheck` | Types are consistent | That the types are the right shape for the API |

**No green suite is evidence that the system works against Ring.** There is no webhook
simulator and no AWS account. Every request shape in `src/lib/ringClient.ts` is verified
against documentation, not observed traffic. Say so in your report.

While `routeGlobs` is empty, reverse coverage is **partial**, not complete. Report it
that way.

### Rule 6 — Report honestly

State what you verified and what you did not. If a check passed vacuously, say so. If a
command could not run, name it. Do not report success for a check that exercised
nothing.

## Documentation conventions

- **Numbering** — `docs/NN-<subject>/`, from the contract's `subjects`. Never renumber
  without a contract edit.
- **Overviews** — every subject folder needs a `00-overview.md` with subject name,
  folder path, a "read this when" purpose, and a TOC listing every sub-file.
- **Backlinks** — every sub-file opens with `**Back:** [00-overview](./00-overview.md)`.
- **Provenance** — every sub-file carries a `**Verified against:**` line naming its
  evidence, and says plainly when it is unverified against code.
- **Code paths** in backticks must exist on disk, be an angle-bracket placeholder, sit
  inside a planned-skip region, or be declared absent.
- **Cross-links** between subjects use relative paths, and must stay inside the repo.

## Markers for paths that do not exist

Two mechanisms, both defined in the contract. Both are printed on every validator run, so
an exemption can never quietly become permanent.

**Declare an absent path** — for prose that honestly names a missing file:

```markdown
<!-- docs-check:expect-absent README.md LICENSE -->
```

Self-invalidating: the declaration itself fails once the file is created, which is how a
subject is told its own status has changed.

**Mark a planned region** — for a block that is entirely unwritten, such as the planned
file tree:

```markdown
<!-- docs-check:skip planned -->
...
<!-- docs-check:skip end -->
```

## Other agent configuration

`CLAUDE.md` points here rather than duplicating anything. The docs-sync runbook has
exactly one home: `.claude/agents/docs-updater.md`.

## Enforcement

`.github/workflows/docs-check.yml` runs the four available gates — typecheck, test,
build:verify, docs:check — on push to `main`, on every pull request, and on manual
dispatch, across the Node versions in its matrix. Each step reads its command from the
contract, so the workflow cannot drift from the documented commands. It blocks on
failure — that is the gate.

`build:verify` is in CI because a bundle that cannot require its own dependencies would
otherwise pass CI and fail in production.

There is deliberately no pre-commit hook. When a hook system appears, prepend an
**advisory** drift warning that never blocks and never alters existing hook output. CI
blocks; the local hook should only warn.
