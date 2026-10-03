**Back:** [00-overview](./00-overview.md)

**Verified against:** `package.json` read in full; `scripts/docs-check.mjs` and `.github/workflows/docs-check.yml` both read in full; every command below executed on 2026-10-04, including `npm run test:coverage`, whose `coverage/coverage-summary.json` supplied the 83.85% figure and every per-file percentage quoted below; `template.yaml` additionally parsed with a Python duplicate-key detector, which is how two pre-existing duplicate keys in the `QueryApiKey` parameter were found; `git config --get core.hooksPath` confirmed unset, and the repository's git hooks directory confirmed to hold no hook file.

<!-- docs-check:expect-absent .githooks .husky .lintstagedrc lefthook.yml .pre-commit-config.yaml test/handlers.test.ts -->

# Verification commands

**Nine** command categories are available now. Three remain unavailable, each with a
stated reason in the contract's `commands` block. `build:web` was added by the
web-dashboard phase, which also made `typecheck` a two-pass command; `build:firetv` was
added by the firetv phase, which made it three.

## Available

| Purpose | Command | What it does |
|---|---|---|
| **everything** | `npm run all` | typecheck → test → build → build:verify → build:web → build:firetv → docs:check, in order. The local pre-commit substitute, and step-for-step the same sequence CI runs |
| **docs:check** | `npm run docs:check` | Validates documentation structure against the contract. Exits 1 on any failure |
| **typecheck** | `npm run typecheck` | `tsc --noEmit` three times, strict. Once for Node (`src/`, `test/`) and once for each browser surface (`web/`, `firetv/`). Exits 1 on any type error |
| **test** | `npm test` | `vitest run`. Discovers `test/**/*.test.ts`, `web/test/**/*.test.ts`, and `firetv/test/**/*.test.ts`. Exits 1 on any failure |
| **test:coverage** | `npm run test:coverage` | Tests plus a v8 coverage report to `coverage/` |
| **build** | `npm run build` | `node scripts/build-lambda.mjs` — esbuild bundles each handler into a self-contained CommonJS file in `dist/` |
| **build:web** | `npm run build:web` | `node scripts/build-web.mjs` — esbuild bundles the dashboard into `web/dist/`. Depends on nothing, so unlike `build:verify` it can run anywhere in the chain |
| **build:firetv** | `npm run build:firetv` | `node scripts/build-firetv.mjs` — esbuild bundles the overlay client into `firetv/dist/`. Also order-independent |
| **build:verify** | `npm run build:verify` | Asserts no bundled file requires a package it did not inline |

All nine were run and pass as of 2026-10-04. The docs validator has no dependencies, so
`node scripts/docs-check.mjs` also works with no install step — useful in CI before
`npm ci`.

## Unavailable

| Check | Contract key | Why |
|---|---|---|
| dev | `commands.dev` | The SAM CLI is not installed. `ARCHITECTURE.md` §9.1 plans `sam local start-api`, and both `template.yaml` and the handlers now exist, so the only missing piece is the tool |
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

It read **100** when the first module was under test, in well under a second. It read
**83.78** on 2026-10-03, and **83.85** on 2026-10-04, across 17 test files covering all
five backend stages, both browser surfaces, and their demo entry points.

This matters beyond reporting: it is the first genuinely mechanical metric this
repository has had, and therefore the first thing an autonomous optimisation loop could
measure. It was briefly at its ceiling, which made it useless as a target; it is now
below it again, which makes it meaningful. The four lowest-covered files are the least
happy, and for the same reason: `src/handlers/overlayPusher.ts` at 55.76%,
`src/handlers/snapshotFetcher.ts` at 59.42%, `src/lib/snapshotStore.ts` at 70.58%, and
`src/lib/connectionStore.ts` at 76.92%. Their uncovered lines are default AWS-client
construction and the SQS and WebSocket route plumbing — paths that need a real account to
exercise.

The pure modules are at **100%**: `src/lib/daySummary.ts`, `src/lib/signatureVerifier.ts`,
`web/src/api.ts`, `web/src/view.ts`, `firetv/src/app.ts`, and `firetv/src/view.ts`. That is the
clearest evidence of what the number actually measures. The query stage is the
counter-example at the other end: `src/handlers/eventQuery.ts` landed at 95% in one pass,
because a pure response-mapping function and an injected dependency seam have nothing left
to hide. Coverage tracks how much of a file is AWS or DOM plumbing, not how good the code
is.

`src/handlers/dailySummary.ts` sits at **82.50%**, and its uncovered lines are the handler
adapter — the part that builds its own DynamoDB and Bedrock clients, exactly like the SQS
handlers above it. The whole decision tree is covered through `generateDaySummary` with
injected dependencies.

**The dashboard is the clearest case in the repository.** `web/src/app.ts` reads 83% against
a hand-written fake DOM, and every other dashboard module is at 100%. Its logic is fully
covered; its *rendering* is not covered at all, because no browser exists here. That
distinction is the point — a single percentage for that file would have hidden which half
is verified, and the per-file numbers do not.

**Coverage is a floor, not a verdict.** 83.78% of lines executed says nothing about
whether the assertions match the real Ring or Bedrock APIs, because every external call
is a fake.

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

## Reverse coverage is active for code, and silent about infrastructure

Check 5 became **APPLICABLE** in the tooling phase via `paths.libGlobs`
(`src/lib/**/*.ts`), and in the webhook-ingress and overlay-delivery phases via
`paths.handlerGlobs` and `paths.routeGlobs` (both `src/handlers/**/*.ts`). An
undocumented module under `src/lib/`, and an unreferenced handler or route, now fail the
validator. Verified by fault injection when the globs were first filled in.

**And one glob does not cover what it looks like it covers.** `paths.libGlobs` and
`paths.handlerGlobs` are `src/lib/**/*.ts` and `src/handlers/**/*.ts`, so they are
anchored at the repository root: a file at `web/src/api.ts` matches **neither**. The
dashboard is therefore the one piece of product code in this repository with **no reverse
coverage**, and check 5 cannot help it. Widening the globs naively would drag `web/src/**`
into the Node typecheck, where its DOM code would fail for the right reason and the wrong
one. The fix is a separate glob pair plus a documented exclusion, and it is left to the
author.

**What is still outside every glob:** `scripts/**` is inside `sourceRoots` but not
reverse-covered, and `template.yaml`, `package.json`, and the CI workflow are in no
glob at all. A new script, a new template resource, or a new CI step can land with no
document naming it. Report reverse coverage as complete *for the three globs* and
absent for infrastructure — not as a blanket claim.

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
| GitHub Actions | **Wired up, all five gates.** `.github/workflows/docs-check.yml` — job `checks` — runs `typecheck`, `test`, `build`, `build:verify`, `build:web`, `build:firetv`, and `docs:check`, in `npm run all`'s order, on push to `main`, on every pull request, and on manual dispatch, across Node 22 and 24. Each step reads its command from the contract, so the workflow cannot drift from the documented commands. Blocks on failure. |
| Pre-commit hook | **None, deliberately.** `core.hooksPath` is unset, the repository's git hooks directory holds no hook file, and there is no `.githooks`, `.husky`, `lefthook.yml`, or `.pre-commit-config.yaml`. |

**`build:verify` was not among the CI steps until 2026-10-04, and the contract previously
listed it as one.** `scripts/verify-bundle.mjs` asserts against `dist/`, which only
`npm run build` creates, and the workflow never built — so the gate could not have run as
documented. That was Friction Log Entry 14: CI ran the gate's documentation, not the gate.
Closing it meant adding the build step before the gate, in CI and in `npm run all` alike —
which also fixed a second latent problem: `all` had assumed `dist/` already existed, so it
failed on a clean checkout and let a stale `dist/` pass the gate against changed source.
Local and CI now run the identical six-command sequence.

`build:web` had been in CI since the web-dashboard phase, which is the contrast that made
the gap above legible. It also writes to a directory and reads from another, but the two
are unrelated: it reads `web/src/` and writes `web/dist/`, so no ordering can break it. The
distinction is not "which steps are cheap" but "which steps depend on another step having
run".

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
