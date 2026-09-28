**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §11, read directly; the tree is copied verbatim from that section, so it records intent rather than disk state. Every path's actual status was re-checked against the working tree on 2026-09-28 with `find src test scripts -type f`; the "expect-absent" declaration on each path below is self-invalidating and still passes, so each named path is genuinely absent.

<!-- docs-check:expect-absent docs/PRD.md docs/ARCHITECTURE.md docs/FRICTION_LOG.md FRICTION_LOG.md bedrockDescriber.ts dailySummary.ts types/index.ts test/fixtures/ring_motion_event.json src/handlers/dailySummary.ts -->

# Planned structure

**The tree below is the plan, not a description of the working tree.** It is copied
verbatim from `ARCHITECTURE.md` §11 "Repository Structure", so it is a record of what
the specification asks for — not a claim that any of it is missing. **Most of the paths
in it now exist.** An earlier version of this page opened by asserting that no path in
the tree existed on disk, which stopped being true at the tooling phase and stayed
wrong for three phases after that. The per-path status is the *Reading the tree* table
below; the authoritative inventory is
[01-current-state](./01-current-state.md).

It is recorded here, in one place, so that no other document has to invent a file
layout. When a path in this tree is created, it moves out of the "Still unwritten"
table into a real subject folder.

## Planned tree

<!-- docs-check:skip planned -->
```text
front-door-intelligence/
├── docs/                       # this documentation set
├── src/
│   ├── handlers/
│   │   ├── webhookHandler.ts
│   │   ├── snapshotFetcher.ts
│   │   ├── bedrockDescriber.ts
│   │   ├── overlayPusher.ts
│   │   ├── eventQuery.ts
│   │   └── dailySummary.ts
│   ├── lib/
│   │   ├── ringClient.ts
│   │   ├── bedrockClient.ts
│   │   ├── dynamoClient.ts
│   │   └── signatureVerifier.ts
│   └── types/
│       └── index.ts
├── firetv/
│   ├── App.tsx
│   ├── components/
│   │   └── Overlay.tsx
│   └── package.json
├── web/
│   ├── src/
│   │   ├── App.tsx
│   │   └── components/
│   │       └── EventTimeline.tsx
│   └── package.json
├── test/
│   ├── fixtures/
│   │   └── ring_motion_event.json
│   └── handlers.test.ts
├── template.yaml               # AWS SAM template
├── .env.example
├── README.md
├── LICENSE                     # MIT
└── package.json
```
<!-- docs-check:skip end -->

## Reading the tree

The tree lists six handler files, and they do not map one-to-one onto the numbered
component sections in [02-pipeline-components](../02-architecture/02-pipeline-components.md):

| Handler file | `ARCHITECTURE.md` section | Status |
|---|---|---|
| `webhookHandler.ts` | §3.1 Ring Webhook Ingress | **written** |
| `snapshotFetcher.ts` | §3.2 Snapshot Fetcher | **written** |
| `bedrockDescriber.ts` | §3.3 Bedrock Describer | folded into `snapshotFetcher.ts` — decision D018 |
| `overlayPusher.ts` | §3.4 Overlay Pusher | **written**, delivery only — decision D021 |
| `dailySummary.ts` | §3.6 Daily Summary Generator | not written |
| `eventQuery.ts` | §4.2 Query Flow — described only in the data flow, with no numbered component section of its own | **written** — the one remaining MUST in the core pipeline |

The two that do not appear in the table are accounted for elsewhere: §3.5, the
DynamoDB event store, is a data contract handled by `dynamoClient.ts` in `lib/`, and
§3.7, the optional cross-track adapters, has no file in the planned tree at all.

## What the tooling phase retired from this list

Moved out when the file was actually created, per the rule that this page lists only
what remains unwritten:

| Path | Created | Now documented in |
|---|---|---|
| `package.json` | tooling phase | [02-toolchain](./02-toolchain.md) |
| `.env.example` | tooling phase | [02-toolchain](./02-toolchain.md), `docs/04-libraries/01-signature-verification.md` |
| `src/lib/signatureVerifier.ts` | tooling phase | [01-signature-verification](../04-libraries/01-signature-verification.md) |
| `test/` | tooling phase, partially | [01-signature-verification](../04-libraries/01-signature-verification.md) |

All four planned `lib/` files now exist, as do four of the six handlers. Still
unwritten: `src/handlers/dailySummary.ts`, the Fire TV app, and the web dashboard — so
`dailySummary` is now the **only** remaining `src/` file the spec asks for.

Three structures the plan did not list were added: `src/lib/snapshotStore.ts` (the S3
write and the SQS hand-off), a WebSocket connections table
(decision D020) backed by `src/lib/connectionStore.ts`, and a second SQS queue for
overlay delivery backed by `src/lib/overlayPush.ts`. The tree's `src/lib/` block
therefore lists four files where seven exist. `scripts/` and `AGENTS.md` are likewise
absent from the specification's tree. The root `package.json` in the tree above also now
carries a `workspaces` field once `firetv/` and `web/` exist — see
[02-toolchain](./02-toolchain.md).

Two separate front ends are planned: `firetv/` for the Vega OS overlay and `web/` for
the dashboard timeline. Each carries its own `package.json`, which implies a workspace
or a second install — an open tooling question recorded in
[02-toolchain](./02-toolchain.md).

`test/fixtures/ring_motion_event.json` is the payload named in the local webhook curl
example in `ARCHITECTURE.md` §9.1, so the curl command cannot work until that fixture
exists.

## Deviations from the plan already in the tree

Two paths in `ARCHITECTURE.md` §11 are already inconsistent with reality, and this
documentation set resolves them:

| Planned | Actual | Resolution |
|---|---|---|
| `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/FRICTION_LOG.md` | `prd.md` and `ARCHITECTURE.md` live at the repo root | The specs stay at the root. `docs/` holds the navigable subject folders instead of copies, so there is one source of truth per fact |
| `FRICTION_LOG.md` at repo root | Not created | Still owed — FR18. Recipe: [03-add-a-friction-log-entry](../00-how-to/03-add-a-friction-log-entry.md) |

The spec also has no entry for `scripts/`, which now holds
`scripts/docs-check.mjs`, `scripts/build-lambda.mjs`, and `scripts/verify-bundle.mjs`,
or for `AGENTS.md`.

## How to retire this file

When source code lands, do not delete this page. Move each created path into the
subject folder that now describes it, shrink the tree to only what remains unwritten,
and let `scripts/docs-check.mjs` enforce the rest. See
[05-open-a-new-code-subject](../00-how-to/05-open-a-new-code-subject.md).

## Related

- [01-current-state](./01-current-state.md) — the real inventory
- [03-verification-commands](./03-verification-commands.md) — the check that keeps this honest
