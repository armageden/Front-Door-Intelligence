**Back:** [00-overview](./00-overview.md)

**Verified against:** `https://developer.amazon.com/docs/vega/0.24/` (architecture, focus management, interactive toast, closed captions, background/foreground, MCP server), the `react-native-vega/0.72` extended API docs, the complete Vega API inventory at `/docs/vega-api/0.24/`, Amazon Dev Community threads from Amazon engineers, and the source of `vega-video-sample` and `react-native-multi-tv-app-sample`. Read 2026-09-28. Doc versions: Vega SDK 0.24 latest; RN for Vega 0.83 (new in 0.24) with 0.72 being deprecated; `react-native-w3cmedia` 2.2.20; `amazon-devices-buildertools-mcp` 1.0.13.

# Fire TV / Vega OS findings

`ARCHITECTURE.md` §3.4 specifies a picture-in-picture overlay that appears over
whatever the user is watching, without interrupting playback. **Two of those three
requirements conflict with what Vega OS actually supports**, and one of the project's
own corrections was correct for the wrong reason.

Doc note: `https://developer.amazon.com/docs/vega/` 404s — the real root is
`https://developer.amazon.com/docs/vega/vega`. The `0.24` paths are current.

## 🔴 The overlay may be architecturally unavailable

There are two distinct cases, and the difference decides the architecture.

### Case A — overlaying **your own app's** video: ✅ supported

From an Amazon engineer, 2026-07-08:

> "Vega OS does support rendering a transparent WebView on top of video playback, which
> is exactly the pattern you need for overlaying UI controls over
> `KeplerVideoSurfaceView`. The approach is to layer a `WebView` (from
> `@amazon-devices/webview`) as a sibling on top of `KeplerVideoSurfaceView`, with the
> WebView set to a fully transparent background."

The same thread gives the critical negative fact:

> "React Native's `zIndex` and `elevation` properties control ordering within the RN
> view hierarchy but **do not affect the hardware video surface layer**, which is why
> the approaches you tried did not work."

**A plain `<View style={{zIndex: 999}}>` overlay will not appear over the video.** That
is the single most important constraint in this document, and it is not mentioned in
`ARCHITECTURE.md`.

### Case B — overlaying **another app's** video: ❌ no documented API

The complete Vega API inventory (38 APIs, last modified 2026-07-28) contains **no
overlay, no system window, no picture-in-picture, and no global notification surface.**

The structure closes the case off too: auto-launching apps is **banned** under Appstore
policy; backgrounded apps "could get terminated when system needs more resources"; and
launching another app backgrounds yours. The only documented system surface that
overlays an app is the Alexa voice button, which is Amazon-owned.

**If "over whatever the user is watching" means over Netflix or Prime, it is not
achievable on Vega OS with any documented API.** The closest option is
`useToastKepler` — a system-level toast requiring the
`com.amazon.notification.privilege.post` privilege, with two hard limits that break the
spec: `duration` accepts only `SHORT` or `LONG` fixed constants, so **the 15-second
auto-dismiss in FR14 is not expressible**; and it is text plus an optional icon, with no
custom view or styling.

An official "Implement Interactive Toast Notifications in Vega" guide exists and is much
closer to the intended feature — a custom absolutely-positioned toast with a progress
bar — but it is **in-app only**, a sibling of your own player, not a system overlay.

## 🟢 `KeplerCaptionsView` rejection was correct, and stronger than stated

`ARCHITECTURE.md` §15 rejects `KeplerCaptionsView` as "for closed captions, not
overlays". Verified correct, with six additional hard limitations that make it unusable
here:

| Constraint | Impact |
|---|---|
| "Multiple `KeplerCaptionsView` instances within the same process are not supported" | Hard blocker for multi-surface designs |
| "CSS styling of subtitles and captions is not supported" | Cannot style a description banner |
| "Custom cue window size is not supported. Captions window size is auto only" | No control over geometry |
| Captions position at the bottom of the screen by default | Collides with controls |
| "Vertical rendering of subtitles is not supported"; VTTRegion unsupported | Further narrowing |
| Requires privilege `com.amazon.devconf.privilege.accessibility` | Signals its real purpose |

Its content model is strictly `VTTCue` on a `TextTrack`; there is no API to push an
arbitrary string as a caption. The project's rejection should be **strengthened, not
softened**.

One nuance worth keeping: `KeplerCaptionsView` *does* sit above the video surface
(`zIndex: 2` over `KeplerVideoSurfaceView` in every official sample), which proves the
surface can be overlaid — the sanctioned mechanism is the transparent WebView.

## ✅ Confirmed: Linux-based, New Architecture, no Android files

> "Amazon built React Native for Vega as an out-of-tree implementation… RNV ported the
> React Native software stack including React Common, Yoga, and Hermes for Vega OS…
> **RNV uses React Native's new architecture and only supports JSI**… supports native
> integrations through **Turbo Native modules and Fabric Native components**."

Confirmed on all three counts in `ARCHITECTURE.md` §3.4. Caveat on the word "Linux":
Amazon's own developer docs say "Vega's **native UI framework**" and never use the word
Linux. The Linux-kernel claim comes from press and ecosystem sources. The functional
facts — out-of-tree fork, a distinct package format rather than an Android app bundle,
and AABs being unable to run on it — are verified.

**React Native is not required.** Two other paths exist: a documented **Web** path via
`@amazon-devices/webview` (Chromium 144), and a native **C++** path via Turbo modules.
The rules explicitly permit any framework for Fire TV. There is **no Compose/Kotlin
path for Vega** — Android is a Fire OS concept, and Fire OS has documented heads-up
notifications that float over content.

Given that the overlay is architecturally unavailable on Vega, **Fire OS (Android) as
the primary target with Vega secondary may be the lower-risk path**, and the rules
permit either OS.

## ✅ WebSocket works — the backend design is sound

> "**WebSocket support** — React Native also supports WebSockets" — `react-native-vega/0.72`

Confirmed by the platform's own tooling: Vega Studio's Network Proxy and the Charles
Proxy guide both capture "WebSocket (non-WebView) traffic". The API Gateway WebSocket
API → RN `WebSocket` design works.

**But backgrounded sockets die.** A backgrounded app "could get terminated when system
needs more resources", and a WebSocket held open by a backgrounded app is not
protected. For a 24/7 doorbell path, use WebSocket while foregrounded with DynamoDB as
the source of truth and a catch-up fetch on resume.

Push via **Amazon Device Messaging (ADM)** exists — headless task, 6 KB payload,
`POST https://api.amazon.com/messaging/registrations/{id}/messages` — but explicitly
"makes **no guarantees about delivery or the order of messages**" and does not reattempt
after a handler failure. Treat ADM as a wake-up nudge, never as the delivery guarantee.

## 🟠 Timers, dismissal, and focus — three undocumented gotchas

**Timers are yours to implement.** No platform overlay timer exists; `useToastKepler`
is SHORT/LONG only. The official toast guide hand-rolls `setTimeout`/`setInterval`
(using 5s, not 15s). FR14's 15 seconds is implementable but is a custom timer.

**Dismissal uses `useTVEventHandler`**, imported from
`@amazon-devices/react-native-kepler`, **not** `react-native` — "importing them from
react-native would result in errors". `eventKeyAction` 0 is down, 1 is up.

**Focus ignores z-order** — the trap that will bite FR13's dismiss button:

> "When components overlap, focus candidates are selected **without regard to their
> Z-ordering** within the view hierarchy."

A floating overlay over a content grid **will not be reached by D-pad navigation**,
because Vega selects by geometry, not stacking. Expect to need `setFocusRoot()` or
`trapFocus*`. Also: `hasTVPreferredFocus` works only during initial render; the platform
provides no focus restoration; and losing focus leaves nothing focused.

**The screensaver will fight a 24/7 alert overlay:**

> "Vega's current architecture only prevents the screensaver during **active media
> playback sessions**… There is **no public wake lock API, no manifest capability**… By
> default, screensaver starts in **5 minutes** and low power mode in **15 minutes**."
> "Apps **cannot override** screensaver & low power mode settings." — Amazon staff,
> confirmed 2026-07-22

This directly threatens the design: showing a 15-second toast does not keep the display
awake, and the app may be terminated when idle. Model this explicitly.

One hardware caveat: nested modals can black out video playback on some TV panels
(LG/Vizio/Hisense, reported 2026-05-13, unresolved).

## The Builder Tools MCP server is the cheapest next step

`@amazon-devices/amazon-devices-buildertools-mcp` v1.0.13 provides
`search_documentation`, `read_document`, `list_documents`, `read_asset`,
`analyze_perfetto_traces`, `get_app_hot_functions`, and `symbolicate_acr` — a
**first-party machine-readable interface to the Vega docs**, including content buried
in the Agent Skills that is not on the public web pages.

```bash
npx -y @amazon-devices/amazon-devices-buildertools-mcp@latest init-context
```

Use **Node 24**, not 26 (SQLite3 bindings). Requires Vega SDK 0.22+. Verify with
`check-status`. Supports cursor, cline, kiro, claude-code, copilot, amazon-q.

`useToastKepler` and the interactive-toast guide were both hard to find on the public
web — this MCP server is the way to close the remaining gaps, particularly whether
`useToastKepler` renders above other apps' video.

## Track fit

Fire TV priority categories are AI-enhanced viewing, sports, fitness, family
entertainment, multi-modal UX, and computer vision. **An AI description overlay fits
"AI-enhanced viewing"**, whose creative guidance is "AI-enhanced viewing that adapts to
household patterns, computer vision fitness app using the TV camera, multi-modal UX
combining voice + D-pad + visual in a single flow."

**"Computer vision" is a poor fit** — that category is scoped to the **TV camera**,
whereas this project's vision runs in Bedrock on the Ring camera.

For Ring, the rubric calls "non-security use case (accessibility aid, care-taking
monitoring…)" creative and "motion detection alert" obvious. A "someone is at the
door, AI-summarised for a busy TV viewer" story is squarely the caretaking answer.

## NOT FOUND

1. Whether `useToastKepler` renders above **other apps'** video. Docs say only "on the
   device screen". Must be tested on hardware.
2. Any documented system-level overlay, PiP, or heads-up API on Vega. Searched the
   38-API inventory, the full 0.24 nav, the 0.72 extended API list, and the forums.
3. Whether a backgrounded app's WebSocket survives termination.
4. `useToastKepler` and ADM behaviour on RN **0.83** — both documented only under the
   0.72 tree, which the release notes say is being deprecated. Verify before committing.

## Related

- [04-ring-api-findings](./04-ring-api-findings.md) — the other half of the pipeline
- [01-official-requirements](./01-official-requirements.md) — track eligibility and prizes
- [03-doc-conflicts](./03-doc-conflicts.md) — the track decision this affects
