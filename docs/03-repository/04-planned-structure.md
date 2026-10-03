**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §11, read directly; the tree is copied verbatim from that section, so it records intent rather than disk state. Every path's actual status was re-checked against the working tree on 2026-09-28 with `find src test scripts -type f`; the "expect-absent" declaration on each path below is self-invalidating and still passes, so each named path is genuinely absent.

<!-- docs-check:expect-absent docs/PRD.md docs/ARCHITECTURE.md docs/FRICTION_LOG.md bedrockDescriber.ts types/index.ts web/src/App.tsx web/src/components/EventTimeline.tsx firetv/App.tsx firetv/components/Overlay.tsx -->

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
| `dailySummary.ts` | §3.6 Daily Summary Generator | **written** — the text content, without the optional SES email |
| `eventQuery.ts` | §4.2 Query Flow — described only in the data flow, with no numbered component section of its own | **written** |

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
| `test/fixtures/ring_motion_event.json` | fixture phase | [07-web-dashboard](../07-web-dashboard/01-dashboard.md) — §9.1's `curl -d @…` command works again |

All four planned `lib/` files now exist, as do five of the six handlers. **Every `src/`
file the specification asks for now exists.** Still unwritten: only the two React Native
files the tree sketches for the Fire TV shell, which are expected to stay unwritten —
see below.

Four structures the plan did not list were added: `src/lib/snapshotStore.ts` (the S3
write and the SQS hand-off), a WebSocket connections table
(decision D020) backed by `src/lib/connectionStore.ts`, a second SQS queue for
overlay delivery backed by `src/lib/overlayPush.ts`, and `src/lib/daySummary.ts` holding
§3.6's prompt and its deterministic sentence. The tree's `src/lib/` block
therefore lists four files where eight exist. `scripts/` and `AGENTS.md` are likewise
absent from the specification's tree.

**One of the two front ends now exists.** `web/` is written and documented in
[07-web-dashboard](../07-web-dashboard/00-overview.md) — but as plain TypeScript modules and
an `index.html`, **not** the two JSX components the tree shows. The tree's
React layout could not be built here because `react` cannot be installed in this
environment, and decision D029 records both the deviation and what it costs. Since the
demo phase it also carries `web/src/demo.ts` and `web/demo.html`, a fixture-data demo
documented in the same subject (D032).

**Both front ends now exist.** `firetv/` was written on 2026-10-04 — the overlay client in
[08-fire-tv-overlay](../08-fire-tv-overlay/00-overview.md) — as plain TypeScript modules and
an `overlay.html`, **not** the two JSX components the tree shows, for the same reason the
dashboard is not React: `react` and the Kepler packages cannot be installed here (D029), and
the overlay surface Vega sanctions is a WebView anyway (D021, D034). The tree's
`firetv/App.tsx` and `firetv/components/Overlay.tsx` remain declared absent and are expected
to stay that way.

Each front end's own `package.json` is therefore a question rather than a fact: `web/`
carries one with **no dependencies**, and the root manifest still declares no
`workspaces`, because npm resolves workspaces natively but adding the field would also
require regenerating a lockfile this environment cannot produce. Both facts are in
[02-toolchain](./02-toolchain.md).

## Deviations from the plan already in the tree

Two paths in `ARCHITECTURE.md` §11 are already inconsistent with reality, and this
documentation set resolves them:

| Planned | Actual | Resolution |
|---|---|---|
| `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/FRICTION_LOG.md` | `prd.md` and `ARCHITECTURE.md` live at the repo root | The specs stay at the root. `docs/` holds the navigable subject folders instead of copies, so there is one source of truth per fact |
| `FRICTION_LOG.md` at repo root | Written — 20 entries in the six-field shape the Official Rules require | Satisfied. The Rules' schema wins over the four-field template in `ARCHITECTURE.md` §10, since Rules §11.4 makes them controlling |

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
