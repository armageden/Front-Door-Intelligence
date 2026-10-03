**Back:** [00-overview](./00-overview.md)

**Verified against:** `firetv/src/client.ts` → `createOverlayClient()`, `parseOverlayMessage()`, `DEFAULT_AUTO_DISMISS_MS`, `OverlayMessage`, `SocketFactory`, `ClientStatus`, read in full; `firetv/src/view.ts` → `formatClock()`, `formatStatus()`, `formatDevice()`, read in full; `firetv/src/app.ts` → `paint()`, `start()`, read in full; `firetv/src/main.ts`, `firetv/overlay.html`, `firetv/overlay.css`, `firetv/package.json`, and `firetv/tsconfig.json` read in full; `firetv/test/client.test.ts` (14 tests) and `firetv/test/app.test.ts` (6 tests), all run; `firetv/test/fake-dom.ts` read in full; `scripts/build-firetv.mjs` read in full and `npm run build:firetv` executed, producing a 29,905-byte `firetv/dist/`. **Rendered in a real browser on 2026-10-04:** served from `firetv/dist/`, the demo page was opened and driven — a fixture payload arrived through the client and rendered (sentence, device, time, alt-texted snapshot, Dismiss button, Live status), the same event auto-dismissed 15 seconds after arrival (FR14, watched live), and clicking Dismiss returned the screen to its waiting state with the connection still up (FR13). **Not verified:** anything on a real Vega device, a real Fire OS device, or against a deployed API Gateway WebSocket — the client's socket factory is injectable and was exercised only through scripted sockets and the demo transport.

<!-- docs-check:expect-absent firetv/App.tsx firetv/components/Overlay.tsx firetv/src/App.tsx firetv/src/components/Overlay.tsx -->

# The overlay client

`firetv/` — the last planned product artefact, written last. It renders the §3.4 payload
that `pushToConnections()` puts on the wire: `event_id`, `description`, `snapshot_url`,
`timestamp`, `device_name`, all required.

## Why it is a web page, and why that is not a workaround

`ARCHITECTURE.md` §11 sketches a React Native Kepler app. The research in
[05-fire-tv-vega-findings](../05-hackathon-requirements/05-fire-tv-vega-findings.md)
established three facts that reshape that sketch, all verified against the Vega 0.24
documentation on 2026-09-28:

1. **There is no system overlay API on Vega.** Overlaying *another app's* video has no
   documented path — that is FR12, recorded as not implementable (D021).
2. **The one sanctioned overlay surface is a transparent `@amazon-devices/webview`**
   layered as a sibling of `KeplerVideoSurfaceView`. React Native `zIndex` and `elevation`
   do not reach the hardware video layer.
3. **Timers are the app's job.** `useToastKepler` is SHORT/LONG only; FR14's 15-second
   auto-dismiss needs a hand-rolled timer in whatever renders the overlay.

A dependency-free TypeScript page is therefore not a compromise forced by the toolchain —
it is the content of the documented surface. On Vega it loads inside that WebView. On Fire
OS (the track's other option, which the friction log names as the lead precisely because it
has real heads-up notifications) it loads in an Android WebView, or its logic ports to
native. The two React Native files the spec names stay declared absent, because a Vega
shell that imports `react` and `@amazon-devices/kepler-*` cannot compile, run, or be
tested in this environment — and unverifiable code presented as done is the exact failure
this repository's documentation exists to prevent (Friction Log Entry 13).

## Three layers, the same split as the dashboard

| File | Role | Testable with |
|---|---|---|
| `firetv/src/client.ts` | The state machine: connection, payloads, dismissal, reconnect | a scripted `SocketFactory`; vitest fake timers |
| `firetv/src/view.ts` | Every string the TV shows | nothing — pure functions |
| `firetv/src/app.ts` | The DOM, and nothing else | `firetv/test/fake-dom.ts` |
| `firetv/src/main.ts` | Chooses live or demo, calls `start()` | — |

**The transport is a constructor argument.** `createOverlayClient()` takes a
`SocketFactory` instead of constructing `WebSocket` itself — the same seam as the
dashboard's injectable `fetch`. Tests inject a scripted socket, the demo entry injects one
that cycles fixture payloads, and the live entry injects the real `WebSocket`. The state
machine never knows the difference, which is what makes 12 tests on it possible with no
network.

**The payload is parsed defensively.** `parseOverlayMessage()` validates all five §3.4
fields and throws naming the one that is missing or empty — the same rule as the
dashboard's `parseTodayResponse()`. A frame that fails to parse is dropped with a console
warning and the screen keeps its last good state, because an overlay that half-renders a
broken frame is worse than one that keeps showing a true sentence.

## The two overlay requirements a client can implement

**FR14 — the 15-second auto-dismiss.** `DEFAULT_AUTO_DISMISS_MS = 15_000`, armed per
event, cancelled by dismissal, re-armed by a replacement. The tests pin the edge: at
14,999 ms the event is still on screen, at 15,000 it is gone.

**FR13 — the dismiss action.** `dismiss()` hides the event immediately and leaves the
connection up. In the DOM shell it is a real `<button>`, so a D-pad can focus it — on a
television a control is either in the focus order or it does not exist.

FR12 — appearing over *another app's* playback — is not implemented and cannot be; it is
the platform limit above. What this client delivers is the full §3.4 experience on the
surface the platform does provide.

## The reconnect policy: back off, never give up

Every close schedules one retry at 1s, doubling per consecutive failure, capped at 30s; a
successful open resets the count. There is deliberately **no give-up limit**: a TV that
stops trying after four network hiccups silently misses every doorbell after the fourth,
which is the same class of quiet false statement as a dashboard that renders a failed fetch
as an empty day. The status line always shows the truth — `Connecting…`, `Live`,
`Reconnecting (attempt N)…` — because a silent overlay reads as "nothing is at the door".

Duplicate pushes are deduplicated against the event currently on screen: a redelivery of
the same `event_id` is not news. A redelivery *after* dismissal is shown again — the server
pushed it twice on purpose.

## The demo, and the two modes

`overlay.html` with no query string runs the demo: a banner says the events are fixtures,
and a scripted transport pushes one §3.4 payload every 8 seconds through the real client —
parsing, dedupe, auto-dismiss, and repaint are all production code. With
`?endpoint=wss://…` — the `OverlayWebSocketUrl` the template outputs — the page connects for
real, and the banner hides. Nothing is baked into the bundle, the same way the dashboard
takes its base URL as an input rather than a constant.

## The build, and the third tree

`scripts/build-firetv.mjs` mirrors the dashboard's build: esbuild bundles `firetv/src/` to
`firetv/dist/overlay.js` with `platform: 'browser'`, and copies `overlay.html` and
`overlay.css` beside it. `firetv/` is a **third typechecking tree**: the root tsconfig is
Node-only, and `firetv/tsconfig.json` mirrors `web/tsconfig.json` with a DOM lib, so
`npm run typecheck` now runs three passes. The test fake DOM is a copy of the dashboard's
rather than an import, because a cross-tree import fails to resolve by design — the trees
are separate typechecking worlds on purpose.

## Not done

- **No Vega shell.** `firetv/App.tsx` does not exist, and nothing here has run on Vega OS,
  Fire OS, or any television. The client is browser-verified; a TV is a browser with a
  remote and a video surface behind the WebView, and the untested distance between those
  is exactly the distance this page records.
- **No pairing or auth on the socket.** §3.4 has no auth in the spec and the WebSocket API
  carries none; the connection registry on `$connect` is the only gate. The same
  spec-shaped gap as `GET /events/today` had before D022, recorded rather than silently
  shipped — a deployed endpoint would need a token or a private channel before it carried
  anyone's front door.
- **No deep link.** The friction log's "what a Fire TV app can do today" list ends with
  "trigger a content-launch deep link". The payload carries no target to link to, so the
  client has nothing to launch; that remains server-side future work.
- **No reverse coverage.** `firetv/**` matches no glob in the contract, same as `web/`;
  this page is the only thing that keeps the client documented.

## Related

- The payload: [06-overlay-push](../04-libraries/06-overlay-push.md)
- The push stage: [03-overlay-push](../06-handlers/03-overlay-push.md)
- The platform research: [05-fire-tv-vega-findings](../05-hackathon-requirements/05-fire-tv-vega-findings.md)
- The decision: [06-design-decisions](../02-architecture/06-design-decisions.md)
