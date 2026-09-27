# AGENTS.md

<!-- docs-check:expect-absent package.json package-lock.json pnpm-lock.yaml yarn.lock bun.lockb bun.lock template.yaml tsconfig.json -->

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

**Front Door Intelligence** — an Amazon Developer Hackathon 2026 submission (primary
track: Ring) that turns raw front-door camera motion events into one-sentence AI
descriptions pushed to a Fire TV overlay. Specified in `prd.md` and `ARCHITECTURE.md`.

| Field | Value |
|---|---|
| **Status** | **Specification plus documentation. No application implementation.** |
| **Language** | TypeScript, per the planned layout in `ARCHITECTURE.md` §11. Nothing written yet. |
| **Framework** | AWS serverless — Lambda, API Gateway, DynamoDB, S3, EventBridge, Bedrock, with a SAM template planned. Nothing written yet. |
| **Package manager** | **None in use — do not assume npm.** No `package.json` and no lockfile of any kind exists. `ARCHITECTURE.md` §9.1 shows `npm install`, which is a plan, not a detection. See `packageManager` in the contract. |
| **Repo shape** | Single package, no workspaces. |
| **Runtimes available** | Node v22.23.3, npm 12.1.0, pnpm 11.13.1, Yarn 1.22.22. Bun is not installed. The repo itself declares no runtime. |

### Commands

Verbatim from the contract's `commands` block. Only the first one runs.

| Purpose | Command | Status |
|---|---|---|
| **docs:check** | `node scripts/docs-check.mjs` | available — the only working command in the repo |
| dev | — | unavailable: no manifest, no `template.yaml`, no handlers |
| build | — | unavailable: no build tool; `ARCHITECTURE.md` §8.3 plans `sam build` |
| test | — | unavailable: no test runner, no test files |
| lint | — | unavailable: no linter, no source to lint |
| typecheck | — | unavailable: no `tsconfig.json`, no TypeScript |
| format | — | unavailable: no formatter |

Do not write the unavailable ones into CI or scripts. A command that cannot run fails
later, and in a worse place.

## Subject index

The contract's `subjects` array is authoritative for this table, and `docsIndexes` names
the files that must point at every subject. Folders are `NN-` prefixed and the prefix
must equal the subject's `order`; the validator fails otherwise.

| Folder | Covers | Read it when |
|---|---|---|
| [`docs/00-how-to/`](./docs/00-how-to/00-overview.md) | Task-first recipes for this repo's recurring change types | **Doing a task? Start here.** Match your change to a recipe. |
| [`docs/01-product/`](./docs/01-product/00-overview.md) | FR1–FR18, NFR1–NFR7, success metrics, submission checklist | You need to know what the product must do, or which requirement ID to cite |
| [`docs/02-architecture/`](./docs/02-architecture/00-overview.md) | Pipeline components, API contracts, data store, security, design decisions | You need the technical design, a wire format, or the reasoning behind a decision |
| [`docs/03-repository/`](./docs/03-repository/00-overview.md) | What exists on disk, the toolchain, check commands, the planned structure | **Before you assume any file, script, or command exists** |

Each subject folder opens with a `00-overview.md` carrying the subject name, folder
path, a "read this when" purpose, and a table of contents. Every other file backlinks
to it.

The two source documents live at the repo root: `prd.md` and `ARCHITECTURE.md`. Subject
folders reference them; they are never duplicated.

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
symbol. **If a claim rests on a specification rather than on code, say so and mark it
unverified against code.** If you cannot verify a claim at all, write "not verified" or
leave it out. Never guess.

### Rule 2 — Prefer editing over creating

Edit an existing file rather than adding one. Keep documents short and true. Merge
subjects rather than proliferating them.

### Rule 3 — Run a docs-sync pass after any task that touched code

**"Touched code" means any of these changed in `git status`:**

- a file under `paths.sourceRoots` in the contract — currently **empty**
- a file matching `paths.routeGlobs` or `paths.handlerGlobs` — currently **empty**
- `docs/.docsrc.json` itself
- any file whose path is cited in a document under `docs/`
- any non-documentation file at all, while `sourceRoots` is still empty

The last clause is the operative one today: with no source root defined, treat any
non-doc change as code.

Then run the pass:

1. `git status`, `git diff`, `git diff --cached` — read-only
2. Map each changed file to its subject using the glob map in the runbook
3. Update affected docs, and repair anything the diff made false
4. Reverse check: any new file matching the globs must be referenced by path in a
   doc, or listed in `reverseCoverage.intentionallyUndocumented` with a reason
5. Append an ADR-lite paragraph to `docs/02-architecture/06-design-decisions.md` if a
   real architectural decision was made
6. Run `node scripts/docs-check.mjs` and fix every failure

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

### Rule 5 — A passing `docs:check` is not proof the docs are correct

`docs-check` proves **structure, not truth**. It verifies that referenced paths exist,
that the layout matches the contract, that links resolve, and that no obvious secrets
or absolute paths are committed. It cannot confirm that a documented auth requirement,
status code, parameter, or behaviour matches the handler, because it does not read
semantics.

**Never report a green `docs:check` as evidence that the documentation is accurate.**
Semantic accuracy comes from an agent reading the source, and from human review.

While `routeGlobs` and `handlerGlobs` are empty, the reverse-coverage check reports
`NOT APPLICABLE` rather than passing. Report it that way.

### Rule 6 — Report honestly

State what you verified and what you did not. If a check passed vacuously, say so. If a
command could not run, name it. Do not report success for a check that exercised
nothing.

## Documentation conventions

- **Numbering** — `docs/NN-<subject>/`, from the contract's `subjects`. Never renumber
  without a contract edit.
- **Overviews** — every subject folder needs a `00-overview.md` with subject name,
  folder path, a "read this when" purpose, and a TOC listing every sub-file with a
  one-line description.
- **Backlinks** — every sub-file opens with `**Back:** [00-overview](./00-overview.md)`.
- **Provenance** — every sub-file carries a `**Verified against:**` line naming its
  evidence, and says plainly when it is unverified against code.
- **Code paths** in backticks must exist on disk, be an angle-bracket placeholder, sit
  inside a planned-skip region, or be declared absent.
- **Cross-links** between subjects use relative paths, and must stay inside the repo.

## Markers for paths that do not exist

Two mechanisms, both defined in the contract. Both are printed on every validator run,
so an exemption can never quietly become permanent.

**Declare a single absent path** — for prose that honestly names a missing file:

```markdown
<!-- docs-check:expect-absent README.md LICENSE -->
```

Self-invalidating: the declaration itself fails once the file is created.

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

`.github/workflows/docs-check.yml` runs `node scripts/docs-check.mjs` on push to
`main`, on every pull request, and on manual dispatch, across the Node versions in its
matrix. It blocks on failure — that is the gate.

There is deliberately no pre-commit hook. When a hook system appears, prepend an
**advisory** drift warning that never blocks and never alters existing hook output. CI
blocks; the local hook should only warn.
