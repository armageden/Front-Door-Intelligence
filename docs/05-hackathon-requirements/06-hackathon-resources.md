**Back:** [00-overview](./00-overview.md)

**Verified against:** the hackathon Resources page, `https://amazonappdev2026.devpost.com/resources`, transcribed as pasted on 2026-09-29, then checked item by item against that source for completeness. **No linked page was fetched.** Every URL below is recorded as the page presents it; none has been opened, so nothing here is a claim that a link resolves, that a sample builds, or that a tool is currently maintained. This file is a catalogue of leads, not a verified source. It is **not** a rules source — see the precedence note below.

# Hackathon resources

Where the tooling, samples, and credits are. Useful mainly because three items on it bear
on open findings elsewhere in this documentation set.

**Precedence, stated once.** Rules §11.4 says the Official Rules prevail over "Hackathon
Materials, including but not limited to … the Hackathon Website". This page *is* the
Hackathon Website. So where it disagrees with the Rules, the Rules win —
[02-mini-challenges](./02-mini-challenges.md) already caught one case of exactly that,
where this page words the Open Source mini-challenge more narrowly than the Rules do.
Nothing on this page is treated as a requirement.

## The four items that change something

### 1. The Devices Builder Tools MCP server — reopens D021

The page leads with an official MCP server and Agent Skills that put Amazon device
knowledge — crash analysis, profiling, documentation search, app setup — inside an AI
coding assistant. [developer.amazon.com/docs/vega/0.24/mcp-server](https://developer.amazon.com/docs/vega/0.24/mcp-server)

**This is the tool that should have been used before concluding what D021 concluded.**
Decision D021 states that no documented Vega OS API supports a system-level or
picture-in-picture overlay, verified across 38 documented APIs — and that finding is why
FR12 was recorded as *not implementable as written* rather than merely unfinished. (FR14
was on that list too until D034 retired it: the 15-second auto-dismiss is implemented in
the `firetv/` client.) If that conclusion is wrong, the project's largest documented gap
is not a platform limit, and the requirement is winnable.

An official tool that searches the Vega documentation is the cheapest available way to
test it. **Highest-value item on this page.** Not done: the finding was researched by
reading documentation, not with this tool, because it is not wired into this repository.

### 2. The Fire TV track accepts **Fire OS or Vega OS** — the other half of D021

> "Build a demo-ready Fire TV app for **Fire OS or Vega OS** using React Native, web
> technologies, or Android (Kotlin/Java)." — Resources page, Fire TV

**This independently corroborates D021's deferral.** The decision already records that
"Fire OS Android has documented heads-up notifications that float over content, which
Vega does not, and the rules permit either OS". The track page now confirms that at the
track level, from a second source.

The consequence was missing from this file until now, and it is the sharpest open
question in the project: **D021 was researched against Vega OS alone, and Vega is a
choice.** If the app targets Fire OS instead, the surface that blocks FR12
exists. `hello-world-fire-tv` — the native Kotlin / Jetpack Compose path — is then the
relevant starter rather than any of the Vega samples.

**What this page does not answer.** A heads-up notification is not the same thing as
"picture-in-picture" as FR12 words it, and nothing here says a 15-second auto-dismiss or
a dismiss button is expressible on that surface. So the honest reading is: the blocker is
conditional on choosing Vega, and the alternative OS is worth pricing before more work
goes into a picture-in-picture that the target platform may not support. **That is an
author decision, not a documentation finding** — picking a track is a product call, and
[03-doc-conflicts](./03-doc-conflicts.md) conflict 2 already argues the Fire TV track
pays $13,000 more in cash than Ring for work this project is largely specced to do.

### 3. The canonical Ring starter — never compared against

[github.com/AmazonAppDev/ring-api-helloworld](https://github.com/AmazonAppDev/ring-api-helloworld) is described as *the* canonical Ring API starter.

Decision D015 records that the Ring client is hand-rolled, "with no SDK to lean on".
This repository has never read the reference implementation. That matters twice over:

- **Submission requirement 6** says Ring projects must call the track's technology *at
  runtime in code*, and this is the artifact judges will hold in mind as the shape of a
  correct Ring integration. See
  [01-official-requirements](./01-official-requirements.md).
- The hand-rolled client's request shapes are verified against documentation only, never
  observed traffic — the standing caveat in
  [04-ring-api-findings](./04-ring-api-findings.md). Diffing against the starter would
  either confirm those shapes or find a real error.

Hours of work, and it either hardens the riskiest unverified module in the project or
finds a bug.

### 4. A free Ring account is a real verification path — but a narrow one

> "Creating a free Ring account gets you access to the Ring (Amazon Vision) APIs."

[developer.amazon.com/docs/ring/get-started.html](https://developer.amazon.com/docs/ring/get-started.html)

This is the first concrete lead on the repository's largest honesty gap: **no live AWS or
Ring call has ever run**, and every gate is exercised against fakes.

**Be precise about what it buys.** [04-ring-api-findings](./04-ring-api-findings.md)
records that the Developer Playground issues tokens and simulates **live view only**,
and that there is no webhook sandbox. So a free account plausibly unblocks *token
lifecycle and device lookup* — meaning `src/lib/ringClient.ts`, the one module with no
SDK and no observed traffic — but it does **not** obviously unblock webhook delivery, so
FR1, FR2, and NFR1 stay unverified. Treat this as the route to retiring a caveat, not as
a route to retiring all of them.

Not verified: whether account creation is instant, whether a physical device is still
required, or whether the Vision APIs differ from the published reference.

## Credits — resolved: the pool is exhausted (Entry 27)

> "Request $150 in AWS credits through the credit request form." —
> [forms.gle/GaHFxSbBQNG9Kti6A](https://forms.gle/GaHFxSbBQNG9Kti6A)

This was a **fourth** candidate for an item once recorded as **NOT FOUND** in
[01-official-requirements](./01-official-requirements.md), where the Rules, this page, and
the FAQ each linked a different form. The four forms proved to be the same dead end: every
one now resolves to a notice that the credit pool is exhausted, so which link is "live" no
longer matters — **Friction Log Entry 27**. The Rules' **Oct 21, 12pm PT** deadline is moot
with it. The $15K/$5K prize credits in the prize table are unaffected: those are paid to a
winner and were never routed through this form.

## Ring track — the prioritised categories this project already matches

> "**Prioritized categories:** access control, business systems, IoT home automation,
> accessibility, and care-taking." — Resources page, Ring

The project's `prd.md` personas are **care-taking** and **access control** — two of the
five on this list, named on the track page. That is worth stating plainly because it
is the strongest possible position for the Ring track, and it is currently buried in a PRD
rather than presented as track alignment.

It also lines up with the rubric. The Ring "Creative" bucket in
[01-official-requirements](./01-official-requirements.md) is "non-security use case
(accessibility aid, **care-taking monitoring**, package/delivery management), business
system integration, multi-camera pipeline, event-based triggers" — against an "Obvious"
bucket of "motion detection alert, basic doorbell live view". The categories page and the
rubric agree, and this project sits in the Creative half of both. Two of the five
categories have no work in the repository yet: **business systems** and **IoT home
automation**.

Remaining Ring resources not otherwise listed here:

- [Ring UX design guide](https://developer.amazon.com/docs/ring/ux-design-guide.html) —
  "Design patterns for Ring experiences". Unread, and directly relevant to the Design
  criterion, which is a quarter of the Stage Two score.
- [Live apps and use cases](https://ring.com/appstore) — "see what is already shipping".
  Relevant to the "Quality of the Idea" criterion, and a check on whether this design is
  already done.
- [Ring API reference](https://developer.amazon.com/docs/ring/api-documentation.html) —
  the source `04-ring-api-findings` was verified against.

## Fire TV samples — relevant because FR12 alone is unbuilt

`firetv/` now exists as the dependency-free WebView overlay client (D034), but D021 is
what blocks the interesting part of it. If the finding above is overturned, these are the
starting points:

| Sample | Why it might matter here |
|---|---|
| [vega-video-sample](https://github.com/AmazonAppDev/vega-video-sample) | "The richest Vega reference" — W3C media player, focus management, live TV, **content launcher**. The content launcher is the workaround D021 already identifies as what a Fire TV app *can* do today |
| [react-native-multi-tv-app-sample](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample) | The most complete starter, one codebase for Vega, Android TV, Apple TV, and web |
| [vega-tv-interfaces-sample](https://github.com/AmazonAppDev/vega-tv-interfaces-sample) | "Recommended TV UI patterns for focus, i18n, navigation, and scrolling". Focus is not cosmetic here: D021 records that **focus selection ignores z-order**, which is why a dismiss button is unreachable over a content grid |
| [react-native-multi-tv-helloworld](https://github.com/AmazonAppDev/react-native-multi-tv-helloworld) | Minimal single-codebase starter |
| [hello-world-fire-tv-react-native](https://github.com/AmazonAppDev/hello-world-fire-tv-react-native) | Five-minute Hello World |
| [hello-world-fire-tv](https://github.com/AmazonAppDev/hello-world-fire-tv) | The native Kotlin / Jetpack Compose path — **and the one that matters if the app targets Fire OS rather than Vega**, per item 2 above |
| [vega-sports-app](https://github.com/AmazonAppDev/vega-sports-app), [vega-audio-sample](https://github.com/AmazonAppDev/vega-audio-sample) | Catalog, service, search, and settings patterns |

The Fire TV track's prioritised categories include **computer vision** and **multi-modal
UX**, which is what this project actually is — relevant to the argument in
[03-doc-conflicts](./03-doc-conflicts.md) conflict 2 that Fire TV first place pays
$13,000 more than Ring. The invented "one app, one primary track" rule that used to block
that entry was removed on 2026-10-16, and the project now enters Ring **and** Fire TV.

The page states the tools are free and public. **A free React Native e-book** is also
listed: [The Ultimate Guide to React Native TV Development](https://www.callstack.com/ebooks/the-ultimate-guide-to-react-native-tv-development),
from the Callstack team.

Track-wide documentation: [Amazon Developer documentation](https://developer.amazon.com/docs/apps-and-games/documentation.html)
— "specs and guides for building apps across Amazon Devices", and the umbrella above
every track link on the page.

## AWS Builder — the documentation bar

[builder.aws.com](https://builder.aws.com/) and [builder.aws.com/learn](https://builder.aws.com/learn).

The AWS Builder mini-challenge scores "**documented integrations**", and
[02-mini-challenges](./02-mini-challenges.md) notes that thin documentation on an
unfamiliar service — AgentCore, Strands SDK, SageMaker — is a Tech Implementation risk.
The Learn catalogue is where that documentation is meant to come from. Kiro Crew is
already recorded as qualifying on its own; the point here is the *documented* half.

The page adds that "the AWS **free tier** is enough to get started", which matters
because the FAQ advises tearing resources down after testing — there is no cost to
running this pipeline during development, and no reason to skip it for budget.

## Alexa+ and Bee — parked, listed for completeness

Not pursued by this project. Recorded only so the tracks are not mistaken for closed.

- **Alexa+** — MCP on the open standards for Agent Skills and Streamable HTTP
  transports. Priorities: **MCP servers, Agent Skills, and self-hosted integrations**.
  The page notes an Alexa+ experience can be simulated with agentic tools via a web
  app, so this track is reachable without hardware. The project's own §3.7 adapter plan
  is [specified and not started](../02-architecture/02-pipeline-components.md).
- **Bee** — [docs.bee.computer](https://docs.bee.computer/), with
  [bee-cli](https://github.com/bee-computer/bee-cli) and
  [bee-skill](https://github.com/bee-computer/bee-skill). Prioritised uses: education,
  developer experience, personal productivity.

## Support and channels

- **Live office hours** — schedule and join link posted on the landing page. No date is
  given here, so availability is unknown. Worth using before Oct 23 rather than after.
- [community.amazondeveloper.com](https://community.amazondeveloper.com/) — general
- [Ring developer forum](https://community.amazondeveloper.com/c/ring/53) — "active
  moderators and a Q&A section with real integration answers". The most likely place to
  get an authoritative answer on the two findings this project cannot settle alone:
  the watermark behaviour in D016 and the overlay limitation in D021.
- [github.com/amazonappdev](https://github.com/amazonappdev) — all sample code
- [YouTube](https://www.youtube.com/channel/UCT9ApARFgQJOeqD-ygmxnJQ) and
  [dev.to/amazonappdev](https://dev.to/amazonappdev)
- [LinkedIn developer showcase](https://www.linkedin.com/showcase/amazon-appstore-developers/)
- [Newsletter](https://m.amazonappservices.com/hackathon-subscribe)

Two Amazon DevRel answers already shape this project's planning — Emerson Sklar on
Kiro Crew and Claude Code, and Janet Fang on separate-repo eligibility — both recorded in
[02-mini-challenges](./02-mini-challenges.md). The forum is where those came from, which
is the strongest argument for treating it as a first-party source.

## What the page asks for, and this is not optional

> "The **product feedback and feature requests** you submit go straight to the teams
> building Fire TV, Alexa+, Bee, Ring, and the AWS tools."

Submission requirement 8 already makes Product Feedback answers mandatory, and AWS
Builder adds a required field describing which AWS services were used and how. The page
frames it as a two-way channel, not a checkbox. The two genuinely useful things this
project could report are the two findings it could not resolve alone: the missing
picture-in-picture surface on Vega OS, and the absent webhook sandbox. **Those are
answers to a question that was actually asked, which is worth more than a form
submission.**

## Related

- [01-official-requirements](./01-official-requirements.md) — the rules that control
- [02-mini-challenges](./02-mini-challenges.md) — where this page disagrees with them
- [04-ring-api-findings](./04-ring-api-findings.md) — what the Ring API actually does
- [05-fire-tv-vega-findings](./05-fire-tv-vega-findings.md) — what Vega OS actually allows
