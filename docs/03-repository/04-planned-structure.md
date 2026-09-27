**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §11, read directly; the tree is copied from that section. No path in it exists on disk, which the "expect-absent" declaration on each named path enforces.

<!-- docs-check:expect-absent docs/PRD.md docs/ARCHITECTURE.md docs/FRICTION_LOG.md FRICTION_LOG.md package.json webhookHandler.ts snapshotFetcher.ts bedrockDescriber.ts overlayPusher.ts eventQuery.ts dailySummary.ts dynamoClient.ts types/index.ts test/fixtures/ring_motion_event.json -->

# Planned structure

**Everything on this page is a plan, not a description of the working tree.** The tree
below is copied from `ARCHITECTURE.md` §11 "Repository Structure". Not one path in it
exists yet — see [01-current-state](./01-current-state.md) for the inventory that
proves it.

It is recorded here, in one place, so that no other document has to invent a file
layout. When a path in this tree is created, it moves out of this file and into a real
subject folder.

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

| Handler file | `ARCHITECTURE.md` section |
|---|---|
| `webhookHandler.ts` | §3.1 Ring Webhook Ingress |
| `snapshotFetcher.ts` | §3.2 Snapshot Fetcher |
| `bedrockDescriber.ts` | §3.3 Bedrock Describer |
| `overlayPusher.ts` | §3.4 Overlay Pusher |
| `dailySummary.ts` | §3.6 Daily Summary Generator |
| `eventQuery.ts` | §4.2 Query Flow — described only in the data flow, with no numbered component section of its own |

The two that do not appear in the table are accounted for elsewhere: §3.5, the
DynamoDB event store, is a data contract handled by `dynamoClient.ts` in `lib/`, and
§3.7, the optional cross-track adapters, has no file in the planned tree at all.

Four library files cover the external dependencies: the Ring client, the Bedrock
client, the DynamoDB client, and HMAC signature verification. Shared types go in
`types/index.ts`.

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
`scripts/docs-check.mjs`, or for `AGENTS.md`.

## How to retire this file

When source code lands, do not delete this page. Move each created path into the
subject folder that now describes it, shrink the tree to only what remains unwritten,
and let `scripts/docs-check.mjs` enforce the rest. See
[05-open-a-new-code-subject](../00-how-to/05-open-a-new-code-subject.md).

## Related

- [01-current-state](./01-current-state.md) — the real inventory
- [03-verification-commands](./03-verification-commands.md) — the check that keeps this honest
