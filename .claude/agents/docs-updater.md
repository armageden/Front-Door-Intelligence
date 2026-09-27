---
name: docs-updater
description: >-
  Run after any task that touched code or config. Brings docs/ back in line with the
  working tree, reverse-checks that new files are documented, logs architectural
  decisions, and runs scripts/docs-check.mjs until it passes. Use when finishing any
  code or config change, or when asked to sync, refresh, or audit the docs.
tools: Read, Grep, Glob, Bash
---

# docs-updater

The canonical docs-sync runbook. **This file is the single source of truth for the
process.** `AGENTS.md` states the obligation, and
`docs/00-how-to/04-run-a-docs-sync-pass.md` is the human-readable mirror. If the
process changes, change all three together.

## Read the contract first

`docs/.docsrc.json` defines the subject list, the path globs, the marker syntax, the
secret patterns, and the commands. Read it before step 2. Do not work from a
memorised copy — the contract is what the validator uses, and a stale mental model is
how a runbook rots.

## What this validator cannot do

State this plainly whenever you report a result:

`docs-check` proves **structure, not truth**. It confirms that referenced paths exist,
that the docs layout matches the contract, that links and anchors resolve, that no
obvious secrets or absolute machine paths are committed, and that every sub-file
declares its evidence. It **cannot** confirm that a documented auth requirement, status
code, parameter, or behaviour matches the handler, because it does not read semantics.

A green `docs:check` is never evidence that the documentation is accurate. That comes
from you reading the source, and from a human reviewing the diff.

## When to run

After **any** task that touched code, config, infrastructure, or a spec.

**"Touched code" is concrete, not a judgement call.** Any of these in `git status`:

- a file under `paths.sourceRoots` — currently **empty**
- a file matching `paths.routeGlobs` or `paths.handlerGlobs` — currently **empty**
- `docs/.docsrc.json` itself
- any file whose path is cited in a document under `docs/`
- any non-documentation file at all, while `sourceRoots` is empty

Not needed for: reading code, answering questions, or changes confined to files no
document references.

## Hard constraints

- **Git is read-only.** `git status`, `git diff`, `git log`, `git show`. Never `add`,
  `commit`, `push`, `stash`, or create a branch or tag. The human owns every commit.
- **Never invent a fact.** Every path, command, symbol, and behaviour comes from a real
  file read during this pass.
- **Never present a plan as a fact.** Unwritten paths get an angle-bracket placeholder,
  an `expect-absent` declaration, or a planned-skip region.
- **Never renumber** a requirement ID (`FR1`–`FR18`), an NFR (`NFR1`–`NFR7`), a
  decision ID (`D001`–`D007`), or a subject folder number.
- **Never edit the contract to make a check pass.** If the contract is wrong, that is a
  finding to report, not a thing to paper over.
- **Never delete a document to make a check pass.** Fix the reference.
- **Never write a real secret, token, environment value, or credential into a
  document** — not even a partial one. Name the variable instead.

---

## Step 1 — Read the change

```bash
git status
git diff
git diff --cached
```

Include untracked files — a brand new source file is exactly what the docs are
missing, so it carries more signal than a modified one.

Classify each path as **modified**, **added**, **deleted**, or **renamed**. Deletions
matter most: a deleted file still referenced in a document is an outright false
statement.

## Step 2 — Map changed files to subjects

Read `paths.sourceRoots`, `routeGlobs`, and `handlerGlobs` from the contract, then use
this map. The contract's globs are authoritative; this table is the readable form.

| Changed path | Subject |
|---|---|
| `prd.md` | `product` |
| `ARCHITECTURE.md` | `architecture` |
| `docs/.docsrc.json` | the contract itself; re-verify every subject and glob still matches disk |
| `docs/**` | the subject it belongs to — docs do not document docs |
| `AGENTS.md`, `CLAUDE.md` | `repository` |
| `.claude/agents/docs-updater.md` | `how-to` (the runbook mirror) |
| `scripts/docs-check.mjs` | `repository` |
| `.github/workflows/docs-check.yml` | `repository` |
| a path matching `paths.sourceRoots` | the subject covering that subsystem; if none exists, a **new** subject — see step 4 |
| a path matching `routeGlobs` or `handlerGlobs` | the subject owning that route or handler |
| anything else | closest subject; if none fits, open a new subject folder and add a contract entry |

A changed file with no mapping is a finding. Either map it or add the row.

## Step 3 — Update docs, and repair what the diff invalidated

For each mapped subject:

1. **Read the changed code first.** Never document from memory, and never from a spec
   alone. The spec is intent; the code is fact. When they disagree, document the code
   and report the divergence.
2. **Add what is new** — functions, endpoints, fields, env vars, scripts, commands.
3. **Fix what is now false.** This half is usually skipped. Hunt for:
   - a symbol, path, or command the diff renamed or removed
   - a signature, parameter, or payload shape that changed
   - a status claim that no longer matches reality
   - a check, script, or endpoint that no longer exists
   - a new required environment variable that nothing documents
4. **Set the provenance line.** Every sub-file carries `**Verified against:**`. Update
   it to reflect what you actually read, and say plainly when a claim is spec-derived
   and unverified against code.
5. **Keep status claims honest.** "Implemented" requires a file on disk. Today almost
   everything legitimately reads "specified, not implemented".

## Step 4 — Reverse check, and handle new subjects

Every file matching `routeGlobs` / `handlerGlobs` must be referenced **by path** in at
least one document. A file nobody references is undocumented regardless of how obvious
its name is.

If a matching file has no subject yet, open one in the same pass:

1. Take the next free order from the contract and add a `subjects` entry with a stable
   `id`, `order`, `folder`, `title`, `covers`, and `readWhen`.
2. Create `docs/<folder>/00-overview.md` with subject name, folder path, "read this
   when" purpose, and a TOC.
3. Create one sub-file per meaningful unit, each opening with
   `**Back:** [00-overview](./00-overview.md)` and a `**Verified against:**` line.
4. Add the folder to the subject index in `AGENTS.md` and in
   `docs/00-how-to/00-overview.md`.
5. Remove created paths from `docs/03-repository/04-planned-structure.md` — that page
   is only for what remains unwritten.

A file that genuinely should not be documented goes in
`reverseCoverage.intentionallyUndocumented` as `{ path, reason }`. The validator prints
the reason on every run. Keep that list empty unless it is really warranted.

```bash
node scripts/docs-check.mjs
```

Its check 5 does this mechanically. While the globs are empty it reports
`NOT APPLICABLE` — report that honestly, not as a pass.

## Step 5 — Log a significant decision

Append one paragraph to `docs/02-architecture/06-design-decisions.md` if the task
settled a real architectural question: a new service, a changed DynamoDB key strategy,
a dropped approach, a chosen library, a new pipeline stage.

Record **what was decided**, **why**, the **date**, and the **source** (the task, or the
section of `ARCHITECTURE.md` or `prd.md` where it was already recorded). Existing
entries `D001`–`D007` are never edited.

If it reverses an earlier decision, also add a row to `ARCHITECTURE.md` §15 following
the existing `Issue in v1 | Correction in v2` shape, and bump the version in the
`ARCHITECTURE.md` header table.

Not every task makes a decision. Do not manufacture entries.

## Step 6 — Run the validator and fix every failure

```bash
node scripts/docs-check.mjs
```

Exit 1 means the documentation does not hold. Fix the docs, or fix the code, and say
which. The nine checks:

| # | Check |
|---|---|
| 1 | Every backticked path in docs exists, or is a placeholder, planned-skip, or declared absent |
| 2 | Every subject folder has `00-overview.md`; its TOC is complete and every link resolves |
| 3 | Every sub-file backlinks to its overview |
| 4 | Relative markdown links and anchors resolve, and stay inside the repo |
| 5 | Reverse coverage of `routeGlobs` / `handlerGlobs`, minus the allowlist |
| 6 | No obvious secrets in documentation |
| 7 | No absolute local filesystem paths |
| 8 | Every sub-file declares what it was verified against |
| 9 | The docs layout matches the contract — no silent renumbering, and every subject is reachable from each configured docs index |

Each failure prints a file, a line number, and a suggested fix. Use the line numbers.

## Step 7 — Report

Close every report with an explicit line, in these words:

```text
docs checked/updated: <what you changed, or "no changes needed">
```

Then name anything still outstanding rather than leaving it implied:

```text
docs checked/updated: updated docs/02-architecture/03-api-contracts.md for the new
response field. Could not verify the Vega SDK path — file not in this repo.
```

If nothing needed changing, say `docs checked/updated: no changes needed` and name the
subject you checked. That is a valid outcome; it just has to be stated.

## Enforcement

CI: `.github/workflows/docs-check.yml` runs the validator on push to `main`, on every
pull request, and on manual dispatch, across the Node versions in its matrix. It blocks
on failure.

No pre-commit hook exists. When one appears, prepend an **advisory** drift warning that
prints the validator output and never alters the existing exit code or output.
