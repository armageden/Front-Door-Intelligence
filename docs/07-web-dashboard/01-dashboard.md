**Back:** [00-overview](./00-overview.md)

**Verified against:** `web/src/api.ts` → `buildTodayUrl()`, `parseTodayResponse()`, `fetchToday()`, `QueryError`, read in full; `web/src/view.ts` → `formatClock()`, `formatSubtype()`, `formatDescription()`, `formatDevice()`, `formatEmptyDay()`, `formatSummary()`, `formatHeader()`, `timelineOrder()`, read in full; `web/src/app.ts` → `load()`, `start()`, read in full; `web/src/demo.ts` → `demoResponse`, `demoFetch`, `startDemo()`, read in full; `web/src/main.ts`, `web/index.html`, `web/demo.html`, `web/app.css` read in full; `web/tsconfig.json`, `web/package.json`, and `scripts/build-web.mjs` read in full; `web/test/dashboard.test.ts` (29 tests), `web/test/app.test.ts` (15 tests), and `web/test/demo.test.ts` (6 tests), all run; `web/test/fake-dom.ts` read in full; `npm run build:web` executed, producing `app.js` and `demo.js` in `web/dist/`. **Rendered in a real browser on 2026-10-04:** served from `web/dist/` over local HTTP, the demo page and the live page both opened, screenshotted, and their accessibility trees read; the live page's controls were exercised (a Load against a closed port changed the error from `HTTP 404` to `Failed to fetch`). **A second pass, on 2026-10-04 during a full audit, found one thing the fake-DOM tests could not: the snapshot placeholders were invisible.** The placeholder SVG's background was `#181d27` — exactly the card background — so each frame rendered as an empty box with a thin artefact in it and read as a broken image. Fixed to `#0d1016` with a visible border, and confirmed by reloading the page. This is the whole argument for looking at a rendered page: a background colour matching its container is not a property any assertion in this repository could see. Friction Log Entry 21. Still not verified: anything against a deployed backend, a real Ring snapshot, or a screen reader.

<!-- docs-check:expect-absent web/src/App.tsx web/src/components/EventTimeline.tsx scripts/verify-web.mjs -->

# Dashboard

`web/` — the client for `GET /events/today`. It shows a homeowner the day: a summary in
two or three sentences, then every event with its snapshot and description.

`ARCHITECTURE.md` §11 sketches this as `web/src/App.tsx` plus
`web/src/components/EventTimeline.tsx` in a React app. **That is not what was built**, and
the reason is recorded as decision D029. What exists is four TypeScript files, an HTML
file, a stylesheet, and 4 KB of minified JavaScript with no dependencies at all.

## Three layers, and why the split is the design

| File | Role | Testable with |
|---|---|---|
| `web/src/api.ts` | transport and the response contract | a fake `fetch` passed as an argument |
| `web/src/view.ts` | every string the UI shows | nothing — pure functions |
| `web/src/app.ts` | the DOM, and nothing else | `web/test/fake-dom.ts`, a 60-line stand-in |
| `web/src/main.ts` | calls `start()` on load | one import test |

**`api.ts` takes its transport as an argument instead of calling the global `fetch`.** That
single choice is what lets 29 tests run with no network, no browser, and no DOM, and it is
also what keeps the rendering question — plain DOM today, React later — out of the file
that decides what the data means.

**`view.ts` holds every string.** Not "most strings": all of them. That is a stronger claim
than it sounds, and it is what makes the UI's honesty testable. A dashboard's failure mode
is not usually a wrong value; it is a right value phrased as a claim it cannot support, and
that phrasing lives in exactly one file, with 29 tests on it.

**`app.ts` decides nothing.** It turns `TodayResponse` into DOM nodes. If a judgement about
what a homeowner should be told ever appears there, it is in the wrong file.

It is tested too, against `web/test/fake-dom.ts` — a hand-written stand-in that implements
the seven DOM calls `app.ts` makes and nothing else. That is enough to assert the shell's
branching: that a rejected request renders an unmistakable error rather than an empty
timeline, that a 401 explains the query key, that a null `snapshot_url` produces no `<img>`,
and that the query key never reaches the page on any path. **It is not a browser**, so
layout, styling, and accessibility remain unverified — and the first real render will find
what a stub cannot.

## The two things the UI refuses to guess

Both are tested, and both exist because the server does not know them.

**A pending event is shown, not hidden.** An event whose describe stage has not run has
`description: null` and `processed: false`. It still happened. So it appears with the label
*"Being described…"* rather than being dropped, and the header counts how many are pending.
A timeline that hides events until it has something nice to say about them disagrees with
reality for exactly as long as the queue is behind.

**A deterministic summary is labelled as counts.** `formatSummary()` appends *"(Counts only
— the model was unavailable.)"* when `summary_source` is `fallback`. The fallback sentence
is truthful — it is a real count of the day — but it is not the model's account of the
day, and a homeowner who cannot tell the difference would come to trust the prose in a way
the system does not promise.

Smaller versions of the same rule: a missing snapshot renders as absent rather than as an
image that 404s; an unresolved device reads "Unknown device" rather than inventing a
name, because `device_name` is absent on **every** event stored today; a truncated
response says "showing the first 200 only"; and a day that reported a count but rendered
no events is called a bug rather than an empty day.

**A failed fetch never renders as a quiet day.** `load()` catches, and a network failure
shows an error. This is the single most misleading thing the app could do — a blank timeline
after a failed request reads as "nothing happened at the front door today", which is a
confident false statement about someone's home.

## Where the key goes, and where it does not

The key is typed into a password field, held in memory, and sent as `X-Query-Key`. It is
**never** a query parameter, never written to `localStorage`, and never placed in the
bundle. A URL ends up in browser history, proxy logs, and `Referer` headers, and this key
guards a homeowner's door activity (D022) — so where it travels is a security property.
There is a test asserting the key does not appear in the URL and one asserting it does not
leak into an error message.

This is why the app takes the API base URL as an input rather than baking it in: baking a
URL in would be fine, and baking a key in would ship a credential to every visitor.

## The types are mirrored, not imported

`TodayResponse` in `web/src/api.ts` is a hand-written copy of the handler's export. It is
not an import, and the reason is deliberate: the handler runs on Node, this runs in a
browser, and importing it would pull the AWS SDK into a 4 KB bundle.

**The cost is real, and it is the honest downside of that choice.** If the handler's
response changes, this file does not know, and the failure mode is `undefined` in a browser
rather than a compile error. The mitigation is that `parseTodayResponse()` validates the
two fields the rest of the UI depends on and throws naming which one was wrong — so the
drift surfaces as a message a human can act on instead of a blank page.

## The demo, and why it shares the production path

`web/demo.html` plus `web/src/demo.ts` render a fixed day with **no backend at all**. The
point of the demo is that almost nothing on the page is demo-specific: `startDemo()` calls
the same `load()` the live page calls, with a transport that returns a fixed
`TodayResponse` instead of touching the network — the same substitution the tests make.
The response validation, every formatter, and the entire DOM shell are the production
code; the only fake thing is the fetch.

The fixture is built to show every honesty state on one page: a pending event renders
*"Being described…"* with the amber border, one event has no `device_name` and reads
"Unknown device", two carry snapshots (data-URL placeholders, since a demo with no bucket
has nothing to sign a URL against) and two do not, and the summary is the model's, so the
fallback label stays off. The page says the data is a fixture, in a banner above the
timeline — a demo that looked like a real day at a real door would be exactly the kind of
quiet false claim this dashboard refuses everywhere else.

`web/test/demo.test.ts` guards the demo against the drift the mirrored types are exposed
to: the fixture is re-parsed through `parseTodayResponse()`, so a response-shape change
fails a test rather than blanking a judge's page. Six tests cover the fixture, the
transport, and the rendered output.

## Three demos, and why there are three

| Page | What it is for |
|---|---|
| `pipeline.html` | **The one to open first.** Both surfaces on one page, running the chain |
| `demo.html` | The dashboard alone — the day, the timeline, the summary |
| `index.html` | The live dashboard, pointed at a real deployment by the operator |

`pipeline.html` exists because the other two show the two *ends* of the pipeline, and a
judge opening them in turn has to infer they are the same system. The thing being built is a
chain. On that page both surfaces are the production clients — `load()` from `app.ts` and
`start()` from `firetv/src/app.ts` — reading a single `daySoFar()` call, so they cannot
disagree. It also shows the one thing a finished screenshot cannot: an event appearing in
the timeline *before* its sentence exists, which is the webhook answering inside five seconds
while the description arrives from a queue afterwards.

Two implementation consequences, both worth knowing before editing it:

- **It loops, and it does not freeze.** The first version ran its three events once and then
  sat there, perfectly rendered and motionless — a judge who looked away for half a minute came
  back to a screenshot and reasonably concluded it had finished or died. The sequence now
  restarts, and a **Replay** button restarts it on demand. Its control flow is a pure
  `runLoop()`, so "it keeps going" is an assertion rather than something a human has to sit
  and watch for.
- **The day empties between cycles.** An earlier version only reset the repaint cache key and
  re-rendered the same three events, so the timeline grew 3, 6, 9, 12… and a judge watching long
  enough saw a day with forty events on it. The arrays are cleared, not just the key.
- **It is the only file that imports across `web/` and `firetv/`**, which is why
  `web/tsconfig.pipeline.json` exists and why `npm run typecheck` runs four `tsc` passes.
  That config must set `"exclude": []` explicitly: an extending config inherits `exclude`,
  and it was silently checking **nothing** while reporting success. Friction Log Entry 25,
  and the verification recipe is in
  [03-verification-commands](../03-repository/03-verification-commands.md). Decision D039.
- **The television is scaled, not reflowed.** `firetv/overlay.css` is sized for a television,
  so the pane lays it out at 1280x720 and applies `transform: scale()`. Letting it reflow into
  a narrow pane wrapped the sentence to one word per line and burst the card out of its
  container — Friction Log Entry 24.

## The build, and what it does not verify

`scripts/build-web.mjs` bundles `web/src/` to `web/dist/` — `app.js` from `main.ts` for
the live page and `demo.js` from `demo.ts` for the demo — and copies `index.html`,
`demo.html`, and `app.css` beside them. The line that matters is `platform: 'browser'`;
under `platform: 'node'` esbuild would happily emit a `require()` that a browser cannot
execute. The entry points use the object form with pinned output names, because plain
entry points with `outdir` would name the live bundle after its entry file and break
`index.html`'s reference to it.

There is deliberately no equivalent of `scripts/verify-bundle.mjs` for the dashboard. That
script exists because a Lambda shipped
as loose files needs its dependencies packaged, and this has none — so the check would
assert nothing. What the build *does* give is one module URL instead of four, and a loud
failure on a parse error.

`build:web` **is** in CI, unlike `build:verify`: it reads `web/src/` and writes
`web/dist/`, so it cannot fail on ordering.

## Not done

- **Rendered once, in a development browser.** Served locally and checked on 2026-10-04 —
  the accessibility tree, the screenshots, and the controls all behaved as the tests
  predicted. What has still never happened: a render against a **deployed** backend, a
  real Ring snapshot in that `<img>`, or any assistive technology. The fake DOM predicted
  the first real render correctly, but one render is not a compatibility matrix.
- **No React**, and therefore no `EventTimeline` component. The timeline is an `<ol>` in
  `app.ts`.
- **Not wired to `workspaces`.** `web/package.json` exists and declares no dependencies, so
  nothing needs installing, but the root manifest has no `workspaces` field — see
  [02-toolchain](../03-repository/02-toolchain.md).
- **No reverse coverage.** `paths.libGlobs` and `paths.handlerGlobs` are `src/**`, so a new
  file under `web/src/` will not fail the validator if this page stops naming it. Widening
  the globs would drag `web/src/**` into the Node typecheck, so the fix is a new glob pair
  plus a documented exclusion, and it is left for the author.
- **No Fire TV client.** Wrong as of 2026-10-04: `firetv/` now exists — the overlay
  client in [08-fire-tv-overlay](../08-fire-tv-overlay/00-overview.md), a separate package
  with its own subject rather than a sibling here, because it renders a different API (the
  §3.4 push, not `GET /events/today`).

## Related

- The endpoint: [04-event-query](../06-handlers/04-event-query.md)
- The decision: [06-design-decisions](../02-architecture/06-design-decisions.md)
- The check commands: [03-verification-commands](../03-repository/03-verification-commands.md)