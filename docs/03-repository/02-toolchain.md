**Back:** [00-overview](./00-overview.md)

**Verified against:** the working machine, checked with `command -v` and `--version` for each runtime; `package.json`, `package-lock.json`, `tsconfig.json`, `web/tsconfig.json`, and `firetv/tsconfig.json` read in full; `scripts/build-lambda.mjs`, `scripts/build-web.mjs`, `scripts/build-firetv.mjs`, `scripts/stage-demos.mjs`, and `scripts/verify-bundle.mjs` read in full; the contract's `runtimes`, `packageManager`, `commands`, and `workspaces` blocks. The registry hang behind D029 and D030 was measured directly on 2026-10-03: `npm view left-pad version` and `npm install left-pad` both exceed a 240-second timeout, while `curl` to `https://registry.npmjs.org` returns 200 and `curl` of a package tarball downloads 3,619 bytes. Not verified: any `template.yaml` deploy behaviour — no AWS account or SAM CLI is available.

<!-- docs-check:expect-absent tsconfig.build.json -->

# Toolchain

Everything here was checked on the working machine. The repository now declares its
own toolchain, so most of this is read out of files rather than inferred.

## The package manager is npm

| Field | Value |
|---|---|
| Name | **npm** |
| Binary | `npm` |
| Version used | 12.1.0 |
| Lockfile | `package-lock.json` |
| Why | `ARCHITECTURE.md` §9.1 specifies `npm install`, so npm is the specification's own choice rather than an inference. npm 10.9+ resolves workspaces natively, so the planned `firetv/` and `web/` packages need no extra tooling. |

**This changed.** Before the tooling phase there was no manifest and no lockfile, and
the contract recorded `packageManager.detected: false` with a "do not assume npm"
warning. That warning was correct at the time and has been superseded by the files on
disk. The contract records the transition under `packageManager.changedFrom`.

## Declared runtime

| Field | Value |
|---|---|
| Language | TypeScript `^7.0.2` |
| Module format | CommonJS |
| Target | ES2022 |
| Minimum Node | `>=20` (declared in `package.json` `engines`) |
| Test runner | vitest `^5.0.2` |
| Type definitions | `@types/node` `^26.6.3` |
| Coverage | `@vitest/coverage-v8`, v8 provider |

TypeScript 7 matters: it **removed `moduleResolution: node10`**, so `tsconfig.json`
uses `module`/`moduleResolution` of `node16`. An older tsconfig copied from a
pre-TypeScript-7 project will not compile — this cost one failed `npm run typecheck`
during setup and is worth knowing before you copy any config around.

## Available on this machine

| Tool | Version |
|---|---|
| Node.js | v22.23.3 |
| npm | 12.1.0 |
| pnpm | 11.13.1 |
| Yarn | 1.22.22 |
| Bun | not installed |

Only npm is used. The others are present on the machine but are not the project's
package manager; do not introduce a second lockfile.

## How it builds

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit`, strict, three passes — Node for `src/`+`test/`, then one browser pass each for `web/` and `firetv/` |
| `npm run build` | `node scripts/build-lambda.mjs` — esbuild bundles each file in `src/handlers/` into a self-contained CommonJS file in `dist/` |
| `npm run build:web` | `node scripts/build-web.mjs` — esbuild bundles `web/src/` into `web/dist/app.js` for the browser, and copies the HTML and CSS beside it |
| `npm run build:firetv` | `node scripts/build-firetv.mjs` — esbuild bundles `firetv/src/` into `firetv/dist/overlay.js` for the WebView that hosts the overlay, and copies the HTML and CSS beside it |
| `npm run build:verify` | `node scripts/verify-bundle.mjs` — asserts no bundled file requires a package it was not given |
| `node scripts/stage-demos.mjs` | Stages the hosted demo site into `site/` — dashboard under `dashboard/`, overlay under `overlay/`, landing page at the root. The same staging the demos workflow runs in CI, runnable locally so the hosted experience previews without a push |
| `npm run typecheck:web` | `tsc --noEmit -p web/tsconfig.json` — the dashboard's half of `npm run typecheck` |
| `npm run typecheck:firetv` | `tsc --noEmit -p firetv/tsconfig.json` — the overlay client's half of `npm run typecheck` |

**Why a bundler and not `tsc` emit.** The AWS SDK v3 is not in the Node.js Lambda
runtime, and `tsc` only transpiles — it never copies `node_modules`. A `dist/` of loose
compiled files deploys a Lambda that starts fine and dies on the first webhook with
`Cannot find module '@aws-sdk/client-dynamodb'`. Nothing in `sam build` reports it, so
`build:verify` exists to catch exactly that: it enumerates every `require()` in `dist/`
and fails if one resolves to a package that was not inlined.

`outbase` is pinned to `src/` in the esbuild config. Without it, a single entry point
flattens the output so the bundle lands directly in `dist/` instead of under
`dist/handlers/`, and `template.yaml`'s `Handler` property would point at nothing.

There is deliberately **no** `tsconfig.build.json`. An earlier design used one to set
`rootDir: src`; it is superseded. `tsc` runs `--noEmit` only. Reasoning: decision D009
in [06-design-decisions](../02-architecture/06-design-decisions.md).

## Not configured

| Tool | Why |
|---|---|
| Linter | No linter installed and no lint config. Deliberate: `npm run typecheck` already fails the build on type errors, and a linter is a second opinion on style. Add one when style drift becomes a real problem. |
| Formatter | No formatter, no config. |
| SAM CLI | Needed for `sam build` / `sam deploy` / `sam local start-api`, per `ARCHITECTURE.md` §8.1 and §8.3. Not installed and not assumed. |
| AWS credentials | `aws configure`, per §8.1. Not configured. |
| Vega SDK | For the Vega shell that would host `firetv/` in its WebView, per §8.1. Not installed. The overlay client itself needs only a browser; the shell needs react and the Kepler packages, which cannot be fetched here. |

The last three are recorded in the contract's `commands` block as `unavailable`, with
reasons, so nothing tries to run them.

## Three toolchains now, and three typecheck passes

| | Lambda side | Dashboard | Overlay client |
|---|---|---|---|
| Config | `tsconfig.json` | `web/tsconfig.json` | `firetv/tsconfig.json` |
| Runtime | Node | browser | browser |
| `types` / `lib` | `types: [node]`, no DOM | `lib: [..., "DOM"]`, no Node types | `lib: [..., "DOM"]`, no Node types |
| Module resolution | `node16` | `bundler` | `bundler` |
| Tests | `test/**/*.test.ts` | `web/test/**/*.test.ts` | `firetv/test/**/*.test.ts` |

`npm run typecheck` runs `tsc` **three times**, because sharing one config would let the
Lambda code typecheck against browser globals and the two browser surfaces against
`node:process` — the invisible coupling D009 rejected for bundling, applied to types
instead. The second and third passes are runnable on their own as `typecheck:web` and
`typecheck:firetv`.

The test trees are separate for the same reason: a suite under `test/` that imports
`web/src/` or `firetv/src/` cannot resolve, because each side is compiled with the other's
module rules. That failure is correct and is left in place rather than worked around.
Decision D029; each browser surface carries its own copy of the small fake DOM rather than
importing a sibling's.

## Workspaces are still not declared, and now there is a second reason

`ARCHITECTURE.md` §11 plans a second `package.json` under `firetv/` and another under
`web/`. `web/package.json` now exists. The root manifest has **no** `workspaces` field
still, and there are two reasons, only one of which is the original one:

1. `npm ci` runs against a lockfile that records no workspace, and a lockfile that does not record the workspaces fails outright rather than repairing itself. `firetv/package.json` now exists too (no dependencies, same as `web/package.json`), so the cost of the missing field is still nil — but the moment either package gains a dependency, the lockfile has to be regenerated in the same change.
2. **CI runs `npm ci`**, which fails outright on a lockfile that does not record the new
   workspace — it refuses rather than repairing. Regenerating `package-lock.json` needs
   an install, and installs **do not work in this environment**: `npm view` and
   `npm install` against `registry.npmjs.org` hang indefinitely while `curl` to the same
   host returns 200. Verified 2026-10-03; it is the same hang decision D029 records.

Today the field would buy nothing: `web/package.json` declares **no dependencies**, so
there is nothing to hoist. The moment React is added — D029's swap — the lockfile and
the field have to be updated in the same change. Recorded as D030.

## Related

- The commands and their status: [03-verification-commands](./03-verification-commands.md)
- What still has to be built: [04-planned-structure](./04-planned-structure.md)
- The same picture in the agent router: [project snapshot](../../AGENTS.md)
