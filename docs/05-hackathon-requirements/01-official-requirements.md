**Back:** [00-overview](./00-overview.md)

**Verified against:** Devpost Official Rules §1, §4, §6, §8, §11.4; the hackathon Overview page; the FAQs; Updates feed. All read 2026-09-28. **Re-verified against the live Rules and Overview page on 2026-10-16** — both return 403 to plain automated requests and were read through a rendering proxy. That pass confirmed every quotation below against the current source, resolved the Sept 16 banner and the credit-form questions, and corrected one mis-sourced attribution (the plural "track(s)" appears in the Overview submission requirements, not in §4 as previously recorded).

# Official requirements

## Deadline — the project's PRD is correct

> "**Submission Period: Monday, August 31, 2026 (10:15 am Pacific Time) – Friday,
> October 23, 2026 (12:00 pm Pacific Time)**" — Rules §1

Verified: `2026-10-23 12:00 PDT` = `2026-10-23 19:00 UTC` = `2026-10-24 03:00 GMT+8`.
`prd.md` states October 24, 2026, 3:00 AM GMT+8. **Same instant.** No correction.

| Milestone | When | Source |
|---|---|---|
| Submission closes | **Fri Oct 23, 2026, 12:00pm PT** | Rules §1 |
| **AWS credit request deadline** | **Oct 21, 12pm PT** — two days early | Rules §4 |
| Judging | Mon Nov 9 – Fri Nov 20, 2026 | Rules §1 |
| Winners announced | on or around Thu Dec 3, 2026 | Rules §1 |

The gap between submission and judging is deliberate. FAQ guidance: spin resources up
only for testing and tear them down afterward; "There isn't an official offline
emulator for Bedrock, so for early development consider mocking or stubbing the
Bedrock calls." That aligns with FR11's fallback.

## Prizes

From Rules §8:

| Track | 1st | 2nd | 3rd |
|---|---|---|---|
| Fire TV | **$25,000** + $15K credits | $15,000 + $5K | $4,000 + $1K |
| Alexa+ | $25,000 + $15K credits | $15,000 + $5K | $4,000 + $1K |
| Bee | $12,000 | $8,000 | — |
| **Ring** | **$12,000** | **$8,000** | — |
| AWS Builder *(mini)* | $5,000 + $5K credits | — | — |
| Open Source *(mini)* | $5,000 + $5K credits | — | — |

Overview page: "$138,000 in cash", "$190K value of cash and AWS credits".

**Fire TV first place is $13,000 more cash than Ring, plus $15K in AWS credits that
Ring does not offer at all.** The project already builds a Fire TV app — see
[03-doc-conflicts](./03-doc-conflicts.md) conflict 2.

## Judging — two stages, and the project's criteria list is wrong

**Stage One is a pass/fail viability gate** (Rules §6):

> "The first stage will determine via **pass/fail** whether the ideas meet a
> **baseline level of viability**, in that the Project reasonably fits the theme and
> reasonably applies the required APIs/SDKs featured in the Hackathon."

This is the mechanism that triggers the friction-log bonus, and it is a cliff: a
submission that does not clearly apply the Ring API is eliminated before scoring.
Neither `prd.md` nor `ARCHITECTURE.md` mentions it.

**Stage Two — four EQUALLY WEIGHTED criteria** (Rules §6, verbatim):

1. **Tech Implementation** — how well it is built and how effectively it uses the
   required tech for the track or mini-challenge
2. **Design** — a complete, coherent product experience; intuitive interaction model
   for the target device
3. **Potential Impact** — a credible, specific case for solving customer needs
4. **Quality of the Idea** — creative use of the tools; genuine understanding of the
   developer ecosystem and end-user needs

`ARCHITECTURE.md` §14 **used to** list Innovation, Impact, Tech Implementation, Design,
Presentation. **"Innovation" and "Presentation" are not criteria** and "Quality of the Idea"
was missing. A document called "Judging Alignment" that names the wrong criteria misdirects
every prioritisation decision made against it.

**Corrected 2026-10-16.** §14 now leads with the Stage One pass/fail gate and then the four
real criteria. See [03-doc-conflicts](./03-doc-conflicts.md) conflict 3.

Track-specific "Obvious vs Creative" guidance matters here, because the rubric draws
that line explicitly:

> **Ring —** "Obvious: motion detection alert, basic doorbell live view.
> **Creative: non-security use case (accessibility aid, care-taking monitoring,
> package/delivery management), business system integration, multi-camera pipeline,
> event-based triggers for app functionality.**"

A Ring submission whose primary artifact is a fancier notification sits in the
*Obvious* bucket. The project's own caretaking and access-control framing is the
*Creative* answer, but it lives in the PRD personas rather than in the demo path.

## Friction log bonus — real, but read the mechanism

> "**Bonus Points:** During **Stage 1 downselection**, Amazon's internal review team
> assesses each submission's friction log entries (if provided) and **passes a
> recommended bonus — up to 10% — to the Stage 2 judging panel** along with the
> shortlisted projects. The Stage 2 panel applies this bonus to the submission's
> **final spreadsheet score**." — Rules §6

The 10% figure in `prd.md` and `ARCHITECTURE.md` is **correct**, with two
corrections: it is **recommended, not automatic**, and the required entry shape is an
enum of six fields — *task attempted, steps taken, expected vs actual result, severity
rating, workaround used, actionable suggestion*. The template in `ARCHITECTURE.md` §10
omits **severity rating** and **workaround used**.

## Submission requirements

From Rules §4:

| # | Requirement |
|---|---|
| 1 | A project built with the required tools, meeting the Project Requirements |
| 2 | A text description explaining features and functionality |
| 3 | **GitHub** URL, with all source, assets, and instructions for the project to be functional |
| 4 | Repo **either public and open source with a licence file, OR private** and shared with `testing@devpost.com` and the Amazon team |
| 5 | For public repos: the licence **detectable and visible in the About section** |
| 6 | For Ring, Alexa+, Bee: the repo must call the track's technology **at runtime in code** — not just name it in the README |
| 7 | Demo video: **under 3 minutes**, shows the project **functioning on the target device**, **publicly visible on YouTube or Vimeo**, no third-party trademarks or unlicensed music |
| 8 | Product feedback answers for each tool/API/SDK used |
| 9 | Identify which **Primary Track(s)** you are submitting into |
| 10 | Identify which **Mini Challenge(s)** you are participating in |
| 11 | AWS Builder: describe which AWS services you used and how, in the Product Feedback answer |
| 12 | Open Source: contribution URL, project repository URL, GitHub username, description |

Note requirement 6: Fire TV is the **exception** — any framework works as long as the
demo shows it running on a device or simulator. But Ring is not the exception, so the
Ring APIs must be genuinely called in code.

Language: all submission materials must be in English, or an English translation must
be provided. GitLab is not accepted — the rules require GitHub specifically.

## Private repos are allowed

`prd.md` §10 **used to** say "Public repo: Mandatory; private repos are not judgeable." That
is **false** — Rules §4 permits private repos shared with Devpost and the Amazon team.
**Corrected 2026-10-16**; see [03-doc-conflicts](./03-doc-conflicts.md) conflict 4.

Keep the plan to publish publicly anyway, but for the right reason. The FAQ warns
that reviewer **invitations expire after 7 days**, so add `testing@devpost.com` and the
named Amazon reviewers **around the time you submit**, not weeks in advance. The Overview
page lists the reviewers as the GitHub handles `chris-trag`, `knmeiss`, `giolaq`,
`anishamalde`, `mosesroth`, and `emersonsklar` (page read 2026-10-19 through a rendering
proxy). Public is simpler and matches the Open Source mini-challenge, so it stays the
recommendation.

## Multiple submissions

> "An Entrant may submit more than one Submission, however, each Submission must be
> **unique and substantially different**" — Rules §4

A second submission is permitted, so hedging Ring versus Fire TV as two separate
submissions is available as well as dual-track entry.

## A physical Ring device is not required

Rules §4: Ring projects must be "demonstrated through a simulator or an actual
device." The project's `prd.md` constraint that no device is needed is **correct**.

## Unresolved — stated, not guessed

| Item | Status |
|---|---|
| Whether the **primary submission repo** itself satisfies the Open Source mini-challenge | **NOT FOUND.** Rules say "additional… alongside" and require two URLs, but no source addresses this case directly. Do not bet on it |
| Which of the **three** AWS credit form URLs is live | **RESOLVED 2026-10-16.** Moot: the credit pool is exhausted. Every candidate resolves to a notice reading *"we've run out of AWS credits to distribute for this hackathon and [are] no longer able to accept any credit requests."* No credit is obtainable, so the URL no longer matters. The Oct 21 deadline is moot with it. **The $15K and $5K credits in the prize table are unaffected** — those are prize components paid to a winner, never routed through this form. |
| Body text of a **September 16, 2026 rules banner** about repository requirements | **RESOLVED 2026-10-16.** The banner exists and reads only *"September 16, 2026 UPDATE: Hackathon submission requirements: Code repository."* — a **heading with no body**. The substance it announces is the ordinary §4 code-repository requirement, which is quoted in full in the submission table above. Nothing is missing; the banner is simply a pointer. |

## Related

- [02-mini-challenges](./02-mini-challenges.md) — eligibility, verbatim
- [03-doc-conflicts](./03-doc-conflicts.md) — where the project documents disagree
