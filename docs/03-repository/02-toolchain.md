**Back:** [00-overview](./00-overview.md)

**Verified against:** the working machine, checked with `command -v` and `--version` for each runtime; `package.json`, `package-lock.json`, and `tsconfig.json` read in full; `scripts/build-lambda.mjs` and `scripts/verify-bundle.mjs` read in full; the contract's `runtimes` and `packageManager` blocks. Not verified: any `template.yaml` deploy behaviour — no AWS account or SAM CLI is available.

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
| `npm run typecheck` | `tsc --noEmit`, strict. Covers `test/` as well as `src/`, so mocks must match real signatures |
| `npm run build` | `node scripts/build-lambda.mjs` — esbuild bundles each file in `src/handlers/` into a self-contained CommonJS file in `dist/` |
| `npm run build:verify` | `node scripts/verify-bundle.mjs` — asserts no bundled file requires a package it was not given |

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
| Vega SDK | For the Fire TV app, per §8.1. Not installed. |

The last three are recorded in the contract's `commands` block as `unavailable`, with
reasons, so nothing tries to run them.

## Workspaces are not declared yet

`ARCHITECTURE.md` §11 plans a second `package.json` under `firetv/` and another under
`web/`. `package.json` has **no** `workspaces` field, because npm fails on a workspace
glob that matches no directory. Add `"workspaces": ["firetv", "web"]` in the same
change that creates those directories.

## Related

- The commands and their status: [03-verification-commands](./03-verification-commands.md)
- What still has to be built: [04-planned-structure](./04-planned-structure.md)
- The same picture in the agent router: [project snapshot](../../AGENTS.md)
