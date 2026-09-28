**Back:** [00-overview](./00-overview.md)

**Verified against:** `package.json` read in full; `scripts/docs-check.mjs` and `.github/workflows/docs-check.yml` both read in full; every command below executed on 2026-09-28; `git config --get core.hooksPath` confirmed unset, and the repository's git hooks directory confirmed to hold no hook file.

<!-- docs-check:expect-absent .githooks .husky .lintstagedrc lefthook.yml .pre-commit-config.yaml test/handlers.test.ts -->

# Verification commands

Six command categories are available now. Three remain unavailable, each with a stated
reason in the contract's `commands` block.

## Available

| Purpose | Command | What it does |
|---|---|---|
| **everything** | `npm run all` | typecheck → test → build:verify → docs:check, in order. The local pre-commit substitute |
| **docs:check** | `npm run docs:check` | Validates documentation structure against the contract. Exits 1 on any failure |
| **typecheck** | `npm run typecheck` | `tsc --noEmit`, strict. Covers `test/` as well as `src/`. Exits 1 on any type error |
| **test** | `npm test` | `vitest run`. Discovers `test/**/*.test.ts`. Exits 1 on any failure |
| **test:coverage** | `npm run test:coverage` | Tests plus a v8 coverage report to `coverage/` |
| **build** | `npm run build` | `node scripts/build-lambda.mjs` — esbuild bundles each handler into a self-contained CommonJS file in `dist/` |
| **build:verify** | `npm run build:verify` | Asserts no bundled file requires a package it did not inline |

All seven were run and pass as of 2026-09-28. The docs validator has no dependencies, so
`node scripts/docs-check.mjs` also works with no install step — useful in CI before
`npm ci`.

## Unavailable

| Check | Contract key | Why |
|---|---|---|
| dev | `commands.dev` | No `template.yaml` and no handlers. `ARCHITECTURE.md` §9.1 plans `sam local start-api`; there is nothing to serve yet |
| lint | `commands.lint` | No linter installed, no config. Deliberate — typecheck is the correctness gate |
| format | `commands.format` | No formatter, no config |

These are recorded as `unavailable` rather than given plausible commands. A command
that cannot run is worse than a documented gap, because it gets copied into CI and
fails there instead of failing here.

## The one real metric

`npm run test:coverage` writes `coverage/coverage-summary.json`, whose
`total.lines.pct` is a single number:

```bash
npm run test:coverage --silent >/dev/null 2>&1
node -p "require('./coverage/coverage-summary.json').total.lines.pct"
```

It read **100** on 2026-09-28 with one module under test, in well under a second.

This matters beyond reporting: it is the first genuinely mechanical metric this
repository has had, and therefore the first thing an autonomous optimisation loop could
measure. It is at its ceiling today, so it only becomes a meaningful optimisation
target as more `src/` modules land.

## The nine checks

`scripts/docs-check.mjs` reads all of this from
[`docs/.docsrc.json`](../.docsrc.json) and hardcodes nothing about the repository.

| # | Check | Driven by |
|---|---|---|
| 1 | Every backticked code path exists, or is a `<placeholder>`, inside a planned-skip region, or declared absent | `pathVerification`, `markers` |
| 2 | Every subject folder has `00-overview.md`; its TOC is complete and every link resolves | `subjects` |
| 3 | Every sub-file backlinks to its own `00-overview.md` | — |
| 4 | No broken relative markdown links or dead anchors, and no link escaping the repo root | — |
| 5 | Reverse coverage: every `libGlobs` / `routeGlobs` / `handlerGlobs` file is referenced by path, minus the allowlist | `paths.libGlobs`, `paths.routeGlobs`, `paths.handlerGlobs`, `reverseCoverage` |
| 6 | No obvious secrets: provider token shapes and high-entropy credential assignments | `secrets` |
| 7 | No absolute local filesystem paths | `absolutePathPrefixes` |
| 8 | Every sub-file carries a `**Verified against:**` provenance line | `provenance` |
| 9 | The docs layout matches the contract — no silent renumbering, and every subject reachable from each docs index | `subjects`, `docsIndexes` |

Failures print a file, a line number, and a suggested fix. Exits 1 on any failure.

## Reverse coverage is now partially active

Check 5 became **APPLICABLE** in the tooling phase via `paths.libGlobs`
(`src/lib/**/*.ts`), so an undocumented module under `src/lib/` now fails the
validator. Verified by fault injection: adding an unreferenced module to `src/lib/`
fails check 5 until a document names it.

`routeGlobs` and `handlerGlobs` are still empty, so a Lambda handler under
`src/handlers/` can land undocumented until the next phase fills them in. That gap is
deliberate: a glob pointing at a directory that does not exist would let the first
handler slip through. Report it as partial coverage, not as full coverage.

## Provenance is enforced, not encouraged

Check 8 requires every sub-file to declare its evidence on a `**Verified against:**`
line naming the file and section, plus the symbol where one exists. That is what
distinguishes `docs/04-libraries/` — claims read out of code on disk — from the
specification subjects, which state plainly that they are **not** verified against
code.

## What a pass does not mean

The validator proves **structure, not truth**. It cannot confirm that a documented
auth requirement, status code, parameter, or behaviour matches the handler, because
it does not read semantics. A green `docs:check` is never evidence that the
documentation is accurate — that comes from an agent reading the source, and from
human review.

The full statement is in `AGENTS.md` Rule 5 and `.claude/agents/docs-updater.md`.

## CI and hooks

| Mechanism | Status |
|---|---|
| GitHub Actions | **Wired up.** `.github/workflows/docs-check.yml` — job `checks` — runs `typecheck`, `test`, and `docs:check` on push to `main`, on every pull request, and on manual dispatch, across Node 22 and 24. Each step reads its command from the contract, so the workflow cannot drift from the documented commands. Blocks on failure. |
| Pre-commit hook | **None, deliberately.** `core.hooksPath` is unset, the repository's git hooks directory holds no hook file, and there is no `.githooks`, `.husky`, `lefthook.yml`, or `.pre-commit-config.yaml`. |

The hook is skipped on purpose. The advisory drift warning is conditional on an
existing hook system, and introducing one purely to carry a warning would change the
repository's hook posture without being asked. When a hook system appears, prepend a
warning that prints the validator output and never alters the existing exit code or
output. CI blocks; the local hook should only warn, so stale documentation cannot stop
unrelated work from being committed.

## Related

- [02-toolchain](./02-toolchain.md) — what the commands depend on
- [01-current-state](./01-current-state.md) — the full inventory
- [04-run-a-docs-sync-pass](../00-how-to/04-run-a-docs-sync-pass.md) — the obligation
