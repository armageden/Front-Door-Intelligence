**Verified against:** `docs/.docsrc.json`, the contract this subject is declared in, and the working tree.

<!-- docs-check:expect-absent firetv/App.tsx firetv/components/Overlay.tsx -->

# 08 — Fire TV overlay

| Field | Value |
|---|---|
| **Subject** | The overlay client in `firetv/` — what a television shows when the doorbell rings |
| **Folder** | `docs/08-fire-tv-overlay/` — declared as subject `fire-tv-overlay`, order 8, in [`docs/.docsrc.json`](../.docsrc.json) |
| **Source of truth** | `firetv/src/` |
| **Reverse coverage** | **Not covered.** `paths.libGlobs` and `paths.handlerGlobs` are `src/**` only, so a new file under `firetv/src/` will *not* fail the validator if this page stops mentioning it. The same recorded gap as the dashboard's — see [01-overlay-client](./01-overlay-client.md) |
| **Status** | **Written and tested — the last planned product artefact.** 20 tests over two files, no dependencies, no framework. Rendered in a real browser on 2026-10-04. Not a Vega app; see below for what that means |

**Read this when** you want to know what the TV shows, why the client is a web page rather
than a React Native Vega app, and which of the overlay requirements are actually
implementable.

## Contents

| File | What it covers |
|---|---|
| [01-overlay-client](./01-overlay-client.md) | The three layers, the §3.4 payload, FR13 and FR14, the reconnect policy, the demo mode, and the hosting paths on Vega OS and Fire OS |

## The one-paragraph status

`ARCHITECTURE.md` §11 sketches `firetv/App.tsx` and `firetv/components/Overlay.tsx` — a
React Native Kepler app. **That is not what exists**, and the reason is the platform, not
the toolchain: there is no system overlay API on Vega OS at all (decision D021, verified
against all 38 documented APIs), and the one sanctioned overlay surface is a transparent
`@amazon-devices/webview` sibling of the video surface. What exists is that surface's
content: a dependency-free TypeScript overlay client that receives the §3.4 payload over
the Overlay WebSocket, shows the sentence and the snapshot, auto-dismisses after 15 seconds
(FR14), and offers a real dismiss button (FR13). It runs in any browser today — the demo
mode proves it with fixture pushes — and it is what loads inside the Vega WebView or a Fire
OS Android WebView. The two React Native files the spec names remain declared absent.

## Related

- The payload it renders: [06-overlay-push](../04-libraries/06-overlay-push.md)
- The delivery stage that pushes it: [03-overlay-push](../06-handlers/03-overlay-push.md)
- The platform research behind the design:
  [05-fire-tv-vega-findings](../05-hackathon-requirements/05-fire-tv-vega-findings.md)
- The other front end: [07-web-dashboard](../07-web-dashboard/00-overview.md)
- The decisions: [06-design-decisions](../02-architecture/06-design-decisions.md)
