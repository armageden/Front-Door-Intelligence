# 00 — How-to

| Field | Value |
|---|---|
| **Layer** | How-to (task-first recipes) |
| **Folder** | `docs/00-how-to/` — declared as subject `how-to`, order 0, in [`docs/.docsrc.json`](../.docsrc.json) |
| **For** | Anyone — human or agent — about to change something in this repository |

**Read this when** you know what you want to do and need the exact steps. If you are
trying to understand how something works instead, go to the reference subjects; they
are linked at the bottom.

**Doing a task? Start with the recipe that matches your change type:**

| Your change | Recipe |
|---|---|
| Add, reword, or retire a functional requirement | [01-update-a-requirement](./01-update-a-requirement.md) |
| Change the technical design, a component, or a data shape | [02-change-the-architecture-spec](./02-change-the-architecture-spec.md) |
| Hit a tooling problem worth points | [03-add-a-friction-log-entry](./03-add-a-friction-log-entry.md) |
| Finished any task that touched code or config | [04-run-a-docs-sync-pass](./04-run-a-docs-sync-pass.md) |
| Created the first file of a new subsystem | [05-open-a-new-code-subject](./05-open-a-new-code-subject.md) |

The last one matters most for a new contributor: it is how the tree stops being a plan
and starts documenting real code.

## How these recipes were chosen

From the two real source documents and their actual structure — the requirement
catalogue in `prd.md` §5, the section layout of `ARCHITECTURE.md` §3 and §11, and the
submission checklist in `prd.md` §13. **Not** from a generic template.

Git history contributed very little, and less than it appears to: the repository has
three commits, and all three predate the code. The first added the two spec documents,
the second was a docs pass, and the third was the webhook pipeline. So there is still
no code *history* to mine for recurring change shapes — only one commit of code. When
more lands, revisit this list against `git log` and re-pick.

## Verify after any recipe

```bash
node scripts/docs-check.mjs
```

The exact command comes from `commands.docsCheck` in the contract, and it is also the
`docs:check` script in `package.json`, so `npm run docs:check` works. Either form is
fine. The remaining command categories in the contract's `commands` block split cleanly:
**available** — build, build:verify, test, test:coverage, typecheck, all; and
**unavailable** — dev, lint, format, each with a stated reason. Do not write an
unavailable one into CI or a script; a command that cannot run fails later, and in a
worse place.

The nine checks it runs are listed in
[03-verification-commands](../03-repository/03-verification-commands.md).

## What the validator does not do

It proves structure, not truth. A green run means the docs are well-formed and refer to
real files — not that a documented status code or parameter matches its handler. The
human-readable mirror of this rule is
[04-run-a-docs-sync-pass](./04-run-a-docs-sync-pass.md).

## Reference subjects

| Subject | Folder |
|---|---|
| Product requirements | [01-product](../01-product/00-overview.md) |
| Technical architecture | [02-architecture](../02-architecture/00-overview.md) |
| The repository itself | [03-repository](../03-repository/00-overview.md) |
| Shared library modules under `src/lib/` | [04-libraries](../04-libraries/00-overview.md) |
| Official hackathon rules and project-doc conflicts | [05-hackathon-requirements](../05-hackathon-requirements/00-overview.md) |
| Lambda handlers under `src/handlers/` | [06-handlers](../06-handlers/00-overview.md) |

## Agent definition

[`.claude/agents/docs-updater.md`](../../.claude/agents/docs-updater.md) is the
canonical runbook. This folder is the human-facing version of it, and the two must
change together.
