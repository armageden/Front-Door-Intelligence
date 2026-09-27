**Back:** [00-overview](./00-overview.md)

**Verified against:** `scripts/docs-check.mjs` and `.github/workflows/docs-check.yml`, both read directly; `docs/.docsrc.json` for the contract values; `git config --get core.hooksPath` and a sweep of the hook-system variants for the hooks table.

<!-- docs-check:expect-absent package.json tsconfig.json template.yaml .githooks .husky .lintstagedrc lefthook.yml .pre-commit-config.yaml test/handlers.test.ts -->

# Verification commands

Only one command in this repository actually runs. Every other category is recorded as
`unavailable` in the contract's `commands` block, each with a stated reason.

## Real

| Purpose | Command | Source |
|---|---|---|
| **docs:check** | `node scripts/docs-check.mjs` | `commands.docsCheck` in the contract |

There is no `npm run docs:check` because there is no `package.json` to declare a script
in — see [02-toolchain](./02-toolchain.md). The command becomes a script entry the day
a package manager is chosen.

## Not configured

| Check | Contract key | Why unavailable |
|---|---|---|
| dev | `commands.dev` | No manifest, no `template.yaml`, no handlers. `ARCHITECTURE.md` §9.1 plans `sam local start-api`; nothing to serve. |
| build | `commands.build` | No build tool, no SAM template. `ARCHITECTURE.md` §8.3 plans `sam build`. |
| test | `commands.test` | No test runner, no test files. `ARCHITECTURE.md` §11 plans `test/handlers.test.ts`. |
| lint | `commands.lint` | No linter installed or configured, no source to lint. |
| typecheck | `commands.typecheck` | No `tsconfig.json`, no TypeScript installed. |
| format | `commands.format` | No formatter, no config. |

These are recorded as `unavailable` rather than given plausible commands. A command
that cannot run is worse than a documented gap, because it gets copied into CI and
fails there instead of failing here.

## The nine checks

`scripts/docs-check.mjs` reads all of this from
[`docs/.docsrc.json`](../.docsrc.json) and hardcodes nothing about the repository.

| # | Check | Driven by |
|---|---|---|
| 1 | Every backticked code path exists, or is a `<placeholder>`, inside a planned-skip region, or declared absent | `pathVerification`, `markers` |
| 2 | Every subject folder has `00-overview.md`; its TOC is complete and every link resolves | `subjects` |
| 3 | Every sub-file backlinks to its own `00-overview.md` | — |
| 4 | No broken relative markdown links or dead anchors, and no link escaping the repo root | — |
| 5 | Reverse coverage: every `routeGlobs` / `handlerGlobs` file is referenced by path, minus the allowlist | `paths.routeGlobs`, `paths.handlerGlobs`, `reverseCoverage` |
| 6 | No obvious secrets: provider token shapes and high-entropy credential assignments | `secrets` |
| 7 | No absolute local filesystem paths | `absolutePathPrefixes` |
| 8 | Every sub-file carries a `**Verified against:**` provenance line | `provenance` |
| 9 | The docs layout matches the contract — no silent renumbering, and every subject is reachable from each configured docs index | `subjects`, `docsIndexes` |

Failures print a file, a line number, and a suggested fix. Exits 1 on any failure.

## Reverse coverage is not applicable, and says so

Check 5 scans for files matching `paths.routeGlobs` and `paths.handlerGlobs`. Both are
empty, because there is no code. The validator prints **NOT APPLICABLE** with the
reason rather than reporting a pass — a vacuous pass here would falsely certify that an
empty repository is fully documented.

It becomes a real check the moment the first handler lands and the globs are filled in.
Verified by fault injection: adding a `src/handlers/` file makes check 5 fail until a
document references it by path.

## Provenance is enforced, not encouraged

Check 8 requires every sub-file to declare its evidence on a `**Verified against:**`
line naming the file and section, plus the symbol where one exists. This is what keeps
the specification subjects honest: the architecture docs state plainly that they are
verified against `ARCHITECTURE.md` and **not** against code, because no code exists.

## What a pass does not mean

The validator proves **structure, not truth**. It cannot confirm that a documented auth
requirement, status code, parameter, or behaviour matches the handler, because it does
not read semantics. A green `docs:check` is never evidence that the documentation is
accurate — that comes from an agent reading the source, and from human review.

The full statement lives in `AGENTS.md` Rule 5 and in
`.claude/agents/docs-updater.md`.

## CI and hooks

| Mechanism | Status |
|---|---|
| GitHub Actions | **Wired up.** `.github/workflows/docs-check.yml` runs the validator on push to `main`, on every pull request, and on manual dispatch, across Node 22 and 24. Blocks on failure. |
| Pre-commit hook | **None, deliberately.** `core.hooksPath` is unset, the repository's git hooks directory holds no hook file, and there is no `.githooks`, `.husky`, `lefthook.yml`, or `.pre-commit-config.yaml` anywhere. |

The hook is skipped on purpose. The advisory drift warning is conditional on an
existing hook system, and introducing husky or lefthook purely to carry a warning would
change the repository's hook posture without being asked. When a hook system appears,
prepend a warning that prints the validator output and never alters the existing exit
code or output. CI blocks; the local hook should only warn, so a stale documentation
state cannot stop unrelated work from being committed.

Because CI runs the validator across its whole matrix, the docs check does not depend on
any single runtime being installed locally.

## Related

- [02-toolchain](./02-toolchain.md) — what the commands depend on
- [01-current-state](./01-current-state.md) — why most checks are unavailable
- [04-run-a-docs-sync-pass](../00-how-to/04-run-a-docs-sync-pass.md) — the obligation
