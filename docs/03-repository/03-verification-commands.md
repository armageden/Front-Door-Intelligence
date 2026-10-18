**Back:** [00-overview](./00-overview.md)

**Verified against:** `package.json` read in full; `scripts/docs-check.mjs` and `.github/workflows/docs-check.yml` both read in full; every command below executed on 2026-10-04, including `npm run test:coverage`, whose `coverage/coverage-summary.json` supplied the 99.19% figure and every per-file percentage quoted below; `template.yaml` additionally parsed with a Python duplicate-key detector, which is how two pre-existing duplicate keys in the `QueryApiKey` parameter were found; `git config --get core.hooksPath` confirmed unset, and the repository's git hooks directory confirmed to hold no hook file.

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
| **typecheck** | `npm run typecheck` | `tsc --noEmit` four times, strict. Node (`src/`, `test/`), each browser surface (`web/`, `firetv/`), and the pipeline demo alone — the one file permitted to import across both trees. Exits 1 on any type error |
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

### Verify a new tsconfig actually checks something

An **extending config inherits `exclude` as well as `include`**, and nothing warns you when
the result is empty. `web/tsconfig.pipeline.json` extends `web/tsconfig.json` — which excludes
`web/src/pipeline.ts`, precisely because the base config cannot contain a cross-tree import. The
extending config therefore inherited an exclusion of the very files it existed to check, and
`npm run typecheck` printed a clean run of an empty program for as long as it took to notice.

**Check it once, when you create the config:**

```bash
npx tsc --noEmit -p web/tsconfig.pipeline.json --listFiles | grep -c 'src/pipeline'
```

A `0` means the config is checking nothing while reporting success — which is worse than having
no typecheck, because it is a green light with nothing behind it. This is Friction Log
Entry 25, and `web/tsconfig.pipeline.json` now sets `"exclude": []` with a note saying why.

## The one real metric

`npm run test:coverage` writes `coverage/coverage-summary.json`, whose
`total.lines.pct` is a single number:

```bash
npm run test:coverage --silent >/dev/null 2>&1
node -p "require('./coverage/coverage-summary.json').total.lines.pct"
```

It read **99.19** on 2026-10-03, across 26 test files. It was **77.45** before the coverage
phase, which is worth remembering: the two numbers described almost the same repository,
and the difference was 159 tests concentrated on code that only ever runs in production.

**Four metrics, and only one of them is close to complete.**

| Metric | Value | What it means here |
|---|---|---|
| lines | **99.19** | 13 statements short, all accounted for below |
| statements | 98.63 | the same statements |
| functions | 98.23 | every default factory is now invoked |
| **branches** | **92.85** | **the honest one to quote** |

Branch coverage is lower because it counts defensive paths no input reaches — a `??`, an
early return, a guard against a null. Lines went to 99% without those being exercised, which
is exactly why quoting lines alone would overstate what is known.

### What the last 0.81% is

`npm run coverage:gaps` prints it per file, with the source line, so the claim is checkable
rather than asserted:

```bash
npm run coverage:gaps                      # every file with a gap
npm run coverage:gaps src/lib/ringClient.ts
```

Three groups, and none of them is "work nobody got to":

1. **One line that cannot execute.** `requireEnv` in two handlers is reached only through
   `modelId ?? requireEnv(BEDROCK_MODEL_ID)`, which calls it when `modelId` is nullish —
   and it always throws there. Its `return value` is dead by construction. Reaching 100%
   would have meant changing working code to satisfy a tool.
2. **Guards inside the two browser entry points.** Reaching them means running the real demo
   loop on an instant clock, which spins forever in microtasks and hangs the worker. The
   alternative — injecting the clock — is what `runLoop()` already does for the part worth
   testing, and the rest is wiring a browser exercises better than a fake does.
3. **Two `close()` callbacks and a reconnect timer**, which need a live socket to close.

### What coverage found that a percentage would not have

The work produced three findings none of which is a coverage number, and all three are
recorded where they belong — Friction Log Entry 25 for the first, and decision D040 for the set:

- A whole test file was being typechecked by **no configuration at all** (Entry 25).
- A test helper failed the entire suite while all 483 of its tests passed, via an
  unhandled rejection that surfaced against unrelated code.
- Two handlers contain a line unreachable by construction.

**Coverage is still a floor and not a verdict.** Of the three defects found in this
repository that coverage could not see — an eight-second blank first card, an invisible
snapshot, a demo that froze after seventeen seconds — **none would have been caught by
reaching 100%.** Every one was found by opening the page.

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
