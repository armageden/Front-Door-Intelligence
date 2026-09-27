**Back:** [00-overview](./00-overview.md)

**Verified against:** `.claude/agents/docs-updater.md` and `scripts/docs-check.mjs`, both read directly, and `docs/.docsrc.json` for the contract values quoted here. This page and the agent definition are two renderings of one runbook and must be changed together.

# Recipe: run a docs-sync pass

**Goal:** after any task that touched code or config, bring the documentation back in
line with the working tree — and prove the structure holds.

## The obligation

Rule 3 in `AGENTS.md`: after **any** task that touches code, config, infrastructure,
or a spec, run a docs-sync pass and end the report with an explicit
`docs checked/updated: ...` line. If nothing needed changing, say so in those words.

## What counts as "touched code"

Not a judgement call. Any of these appearing in `git status`:

- a file under `paths.sourceRoots` in [`docs/.docsrc.json`](../.docsrc.json) — currently **empty**
- a file matching `paths.routeGlobs` or `paths.handlerGlobs` — currently **empty**
- `docs/.docsrc.json` itself
- any file whose path is cited in a document under `docs/`
- **any non-documentation file at all**, while `sourceRoots` is still empty

The last clause is what applies today.

## Steps

1. **Read the change.** Git is read-only in this workflow:

   ```bash
   git status
   git diff
   git diff --cached
   ```

   Untracked files matter most — a new source file is exactly what the docs are
   missing. Classify each path as modified, added, deleted, or renamed; deletions
   matter most of all, because a deleted file still referenced in a document is an
   outright false statement.

2. **Read the contract first.** [`docs/.docsrc.json`](../.docsrc.json) holds the
   subject list, the globs, the marker syntax, the secret patterns, and the commands.
   Do not work from memory of it.

3. **Map each changed file to its subject.** The readable table lives in the runbook
   under "Step 2". The shape of it:

   | Changed path | Subject |
   |---|---|
   | `prd.md` | `product` |
   | `ARCHITECTURE.md` | `architecture` |
   | `docs/.docsrc.json` | the contract itself |
   | `scripts/`, `.github/`, `AGENTS.md`, `CLAUDE.md` | `repository` |
   | `.claude/agents/docs-updater.md` | `how-to` (the runbook mirror) |
   | a path matching `paths.sourceRoots` | the subject covering that subsystem, or a new one |
   | a path matching `routeGlobs` / `handlerGlobs` | the subject owning that route or handler |

   A changed file with no mapping is itself a finding. Map it, or add the row.

4. **Update the affected docs, and fix what the diff invalidated.** Beyond adding new
   facts, hunt for documentation the change made wrong: a renamed function, a changed
   signature, a deleted file still referenced, a status that no longer matches reality,
   a new required environment variable nobody documents. Stale corrections matter more
   than missing additions.

   Set each sub-file's `**Verified against:**` line to what you actually read, and say
   plainly when a claim is spec-derived and unverified against code.

5. **Reverse check.** Every file matching `routeGlobs` / `handlerGlobs` must be
   referenced by path in at least one document. A file that genuinely should not be
   documented goes in `reverseCoverage.intentionallyUndocumented` as
   `{ path, reason }`, and the reason is printed on every validator run.

   ```bash
   node scripts/docs-check.mjs
   ```

   Check 5 does this mechanically. While the globs are empty it reports
   **NOT APPLICABLE** — report that honestly, not as a pass.

6. **Log a decision if one was made.** A real architectural choice — a new service, a
   changed key strategy, a dropped approach, a chosen library — gets one paragraph
   appended to [06-design-decisions](../02-architecture/06-design-decisions.md).
   Existing IDs `D001`–`D007` are never edited. If it reverses an earlier decision,
   also add a row to `ARCHITECTURE.md` §15 and bump its header version.

7. **Run the validator and fix every failure.**

   ```bash
   node scripts/docs-check.mjs
   ```

   Exit 1 means the documentation does not hold. Do not finish a task reporting success
   with a failing validator; fix the docs or fix the code, and say which. Each failure
   carries a file, a line number, and a suggested fix.

8. **Write the closing line**, in the task report:

   ```text
   docs checked/updated: <what you changed, or "no changes needed">
   ```

## What a pass does and does not mean

`docs-check` proves **structure, not truth**. It confirms that referenced paths exist,
that the layout matches the contract, that links and anchors resolve, that no obvious
secrets or absolute machine paths are committed, and that every sub-file declares its
evidence.

It **cannot** confirm that a documented auth requirement, status code, parameter, or
behaviour matches the handler, because it does not read semantics.

**Never report a green `docs:check` as proof the documentation is accurate.** Accuracy
comes from an agent reading the source and from human review of the diff.

## Rules that are easy to break

- **Never present a plan as a fact.** A path that does not exist gets an angle-bracket
  placeholder, an `expect-absent` declaration, or a planned-skip region — never a
  confident backticked path. [04-planned-structure](../03-repository/04-planned-structure.md)
  is the only page permitted to list unwritten files.
- **Never invent a status value.** "Implemented" requires a file on disk.
- **Never renumber** a requirement, an NFR, a decision ID, or a subject folder number.
- **Never edit the contract to silence a failing check.** If the contract is wrong, that
  is a finding to report.
- **Never delete a doc to make a check pass.** Fix the reference.

## Verify

| Question | Answer when |
|---|---|
| Did every changed file map to a subject? | No orphans |
| Does any doc now describe removed behaviour? | No |
| Is every new file referenced, or allowlisted with a reason? | Yes |
| Does `node scripts/docs-check.mjs` exit 0? | Yes |
| Does the report end with a `docs checked/updated:` line? | Yes |
| Was the pass reported as structural, not semantic? | Yes |

## Depth

- The canonical runbook: `.claude/agents/docs-updater.md`
- The contract: [`docs/.docsrc.json`](../.docsrc.json)
- Working rules: `AGENTS.md`
- The nine checks: [03-verification-commands](../03-repository/03-verification-commands.md)
