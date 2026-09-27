**Back:** [00-overview](./00-overview.md)

**Verified against:** The working machine, checked with `command -v` and `--version` for each runtime, plus a `find` sweep confirming no manifest or lockfile exists. The `ARCHITECTURE.md` citations were read directly.

<!-- docs-check:expect-absent package.json package-lock.json pnpm-lock.yaml yarn.lock bun.lockb -->

# Toolchain

Everything here was checked on the working machine. Anything not listed was not
detected, and the absence is meaningful.

## Detected runtimes

| Tool | Version | Detected how |
|---|---|---|
| Node.js | v22.23.3 | on `PATH` |
| npm | 12.1.0 | on `PATH` |
| pnpm | 11.13.1 | on `PATH` |
| Yarn | 1.22.22 | on `PATH` |
| Bun | — | not installed |

## No package manager can be named for this project

The project has no manifest, so there is no package manager to declare. Checked and
absent:

- `package.json`
- `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`

`ARCHITECTURE.md` §11 lists `package.json` in the planned tree, and §9.1 shows
`npm install` as the install step. That is a **plan**, not a detection. Until a
manifest exists, the honest statement is "no package manager is in use yet", and this
is what `AGENTS.md` records.

This matters because picking one is a decision with downstream consequences — lockfile
format, CI caching, install flags. It is recorded authoritatively in the contract's
`packageManager` block, with the full evidence trail, rather than made by inference
here.

## Infrastructure tooling

`ARCHITECTURE.md` §8.1 gives these prerequisites for the eventual backend:

| Tool | Purpose | Present |
|---|---|---|
| AWS SAM CLI | `sam build` and `sam deploy --guided` | Not checked; not assumed |
| AWS credentials | `aws configure` | Not checked; not assumed |
| Vega SDK | Fire TV app build and sideload | Not checked; not assumed |

`ARCHITECTURE.md` §8.1 instructs installing SAM CLI with `brew install aws-sam-cli`.
That line is reproduced from the spec, not verified on this machine.

## Node is used for exactly one thing today

`scripts/docs-check.mjs` — the documentation validator. It is dependency-free plain
Node ES modules, so it runs on a clean checkout with no install step:

```bash
node scripts/docs-check.mjs
```

That is the only executable in the repository. Everything else in
[04-planned-structure](./04-planned-structure.md) is unwritten.

## Related

- [03-verification-commands](./03-verification-commands.md) — commands to run
- [Project snapshot](../../AGENTS.md) — the same picture, in the agent router
