**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` and `ARCHITECTURE.md` read in full, cross-checked line by line against Devpost Official Rules §1, §4, §6, §8, §11.4, the Overview and Resources pages, and the FAQs. Read 2026-09-28. Both source documents re-read after the 2026-10-16 corrections, which are recorded in the status rows below. The rules pages could **not** be re-fetched for this pass — `amazonappdev2026.devpost.com` returns 403 to automated requests — so every rule quotation below still rests on the 2026-09-28 read.

# Conflicts between the project documents and the Official Rules

Originally nothing in `prd.md` or `ARCHITECTURE.md` was changed — each conflict was recorded
with the rule text, the project text, and a status, as a content decision for the author.
**Conflicts 2–6 were corrected on 2026-10-16** — conflict 2 in both source documents, the rest
as recorded below; the rows are kept as the record of what was wrong and why. **Conflict 1
remains open and still costs money** — $5,000 in the Open Source mini-challenge.

| Status | Meaning |
|---|---|
| ✅ **FIXED** | Corrected in the source document on 2026-10-16. The rule text and project text below are kept as the record of what was wrong and why. |
| 🔴 **WRONG** | The claim contradicts the rules. Costs eligibility or money. |
| 🟠 **FALSE / IMPRECISE** | The conclusion may be fine; the stated reason is not. |
| 🟢 **RIGHT** | Verified correct — keep it. |
| ⚪ **NOT FOUND** | Research could not resolve it. Needs a human decision. |

---

## 🔴 1. The Open Source mini-challenge

| | |
|---|---|
| **Rule** (Rules §4) | "Create a new, **additional** open-source project or contribute to an existing public repository during the hackathon window, **alongside a primary track submission**… Required: **contribution URL, project repository URL**" |
| **Project** (`prd.md` §13) | "Open Source mini-challenge: repo is public + MIT licensed" |
| **Project** (`ARCHITECTURE.md` §14) | "Open Source \| MIT-licensed public repo with complete setup instructions" |
| **Project** (`prd.md` §3) | "shipping as open source for the **Open Source** mini-challenge" |
| **Status** | 🔴 **WRONG.** The submission repo is not "additional" to itself, and the form asks for two distinct URLs. As planned this scores **zero** on a **$5,000** prize. |
| **Fix** | Ship a second, separate, licensed repo, or land a real PR/branch/fork. The bar is low — the hackathon Manager confirmed an unrelated fresh repo qualifies, and PRs need not be merged. |

## 🔴 2. "One app, one primary track"

| | |
|---|---|
| **Rule** (Rules §8) | "A project can only win one (1) track prize and one (1) mini challenge prize." |
| **Rule** (Rules §4) | "Entrants must build or significantly update working applications using Amazon developer tools into **the following primary tracks** (each a 'Project')" — followed by all four listed. **No entry limit anywhere.** |
| **Rule** (Rules §4) | "The Sponsor and Administrator reserve the right to **reassign** an Project from one Category or Mini Challenge Prize to another if applicable." |
| **Hackathon page** | Submission requirement reads "**Which track(s)** and mini challenge(s) you're entering" — plural. |
| **DevRel** (forum, 2026) | Emerson Sklar, asked whether one project may be judged in both Fire TV and Alexa+: "**Yes, your project can select and be judged for both tracks** (and, as you noted, can only win one)." |
| **Project** (`ARCHITECTURE.md` §3.7) | "**Critical rule:** One app can only be entered into **one primary track**." |
| **Project** (`ARCHITECTURE.md` §15) | Listed as a v2 **correction**: "No explicit statement that one app = one primary track \| Added explicit rule: one app, one primary track" |
| **Status** | ✅ **FIXED 2026-10-16.** Was 🔴 **WRONG, and an invented rule** — the v2 correction log records adding a rule that does not exist. **Re-verified against the live Rules on 2026-10-16** (the page 403s to plain automated requests and needed a rendering proxy). Four independent sources now agree that entry is unlimited and only the *prize* is capped. |
| **Cost** | The project builds a Fire TV app (FR6, FR12–FR15, `prd.md` §8.1 lists it first, `ARCHITECTURE.md` §13 spends Week 3 on it) and was locked out of the track paying **$25,000 + $15K credits** instead of Ring's **$12,000**. The limit is on prizes *won*, not tracks *entered*. |
| **Fix** | **Done.** `ARCHITECTURE.md` §3.7 now states the real rule with the §8 quote; the §15 correction-log row is corrected rather than deleted, so the record shows the error was caught; `prd.md` now lists Ring **and** Fire TV as primary tracks. Both tracks' demo clauses must be satisfied by the same video. |

## 🔴 3. Judging criteria

| | |
|---|---|
| **Rule** (Rules §6) | Stage One is a **pass/fail viability gate**. Stage Two uses four **equally weighted** criteria: **Tech Implementation**, **Design**, **Potential Impact**, **Quality of the Idea**. |
| **Project** (`ARCHITECTURE.md` §14) | Lists Innovation, Impact, Tech Implementation, Design, Presentation |
| **Status** | ✅ **FIXED 2026-10-16.** Was 🔴 **WRONG** — "Innovation" and "Presentation" were not criteria and "Quality of the Idea" was missing. `ARCHITECTURE.md` §14 now opens with the Stage One pass/fail viability gate, then the four equally weighted criteria (Tech Implementation, Design, Potential Impact, Quality of the Idea), with the Ring rubric's Obvious/Creative line recorded so the demo path is built against the Creative list. The bonus and the two mini-challenges moved to a **Not criteria** table so they cannot be read as rubric weights. |
| **Fix** | **Done.** Every prioritisation decision is now being made against the correct rubric. |

## 🟠 4. "Private repos are not judgeable"

| | |
|---|---|
| **Rule** (Rules §4) | "The repository must be either **public and open source**… **OR private** and shared with `testing@devpost.com` and the Amazon team." |
| **Project** (`prd.md` §10) | "Public repo: **Mandatory**; private repos are not judgeable." |
| **Status** | ✅ **FIXED 2026-10-16.** Was 🟠 **FALSE** as a reason. `prd.md` §10 now states that Rules §4 permits either a public open-source repo **or** a private repo shared with `testing@devpost.com` and the Amazon team, records the FAQ's 7-day reviewer-invitation expiry, and keeps publishing publicly as the choice — for the reason that it also serves the Open Source mini-challenge. |
| **Fix** | **Done.** The decision is unchanged; only the justification was wrong. |

## 🟠 5. Friction log shape

| | |
|---|---|
| **Rule** (Rules §4, §6) | Six fields: task attempted, steps taken, expected vs actual result, **severity rating**, **workaround used**, actionable suggestion. Bonus is **recommended** at Stage 1 and applied by the Stage 2 panel. |
| **Project** (`ARCHITECTURE.md` §10, §17) | Template has four fields: What I tried / What happened / Impact / Suggested fix. "**earns** up to a 10% bonus." |
| **Status** | ✅ **FIXED 2026-10-16.** Was 🟠 **IMPRECISE**. `ARCHITECTURE.md` §10 now carries the full six-field template — task attempted, steps taken, expected vs actual, severity rating, workaround used, actionable suggestion — with the High/Medium/Low scale defined, and "earns" is replaced by the accurate mechanism: **recommended**, assessed at Stage 1 downselection and applied by the Stage 2 panel. Note `FRICTION_LOG.md` was already written in the six-field shape; only the template and the wording were stale. |
| **Fix** | **Done.** Recipe: [03-add-a-friction-log-entry](../00-how-to/03-add-a-friction-log-entry.md) |

## 🟠 6. "Vega OS testing needs a physical device"

| | |
|---|---|
| **Rule** (FAQs) | "Fire TV: an emulator (Android TV Emulator or the Fire TV/Vega simulator) is fine – **a physical device isn't required at any stage of submission or judging.**" |
| **Project** (`prd.md` §10) | "Vega OS testing: Requires a physical Fire TV Stick running Vega OS or a virtual device" (`[reference:5]`) |
| **Project** (`ARCHITECTURE.md` §12) | Rates "Vega OS testing blocked" as **High likelihood / High impact** |
| **Status** | ✅ **FIXED 2026-10-16.** Was 🟠 **IMPRECISE**. `prd.md` §10 now states that an emulator or simulator is sufficient at every stage of submission and judging and that a physical stick is not required. `ARCHITECTURE.md` §12 no longer carries the inflated High/High row: it is split into the risk that is real — *no documented Vega OS overlay API exists*, High/High, tracked as D021 — and *device testing blocked*, downgraded to Low/Medium with the emulator mitigation. One of the two High/High risks driving the schedule is gone. |
| **Fix** | **Done.** |

## 🟠 7. NFR1's "retry storms" citation

| | |
|---|---|
| **Rule** | Nothing in the rules concerns Ring webhook retry timing. |
| **Project** (`prd.md` NFR1) | "Webhook endpoint MUST return HTTP 200 within 5 seconds to avoid Ring retry storms[reference:1]." |
| **Status** | 🟠 **NOT VERIFIED.** The 5-second target is sound engineering, but `[reference:1]` resolves to nothing — see the citation defect below. |

## 🔵 8. The `[reference:N]` markers

`prd.md` contains six inline markers, `[reference:0]`–`[reference:5]`, with **no
reference list anywhere in the file**. Confirmed by searching for a references,
bibliography, or sources section. All six point at nothing.

Full placement table: [01-current-state](../03-repository/01-current-state.md). Two of
them overreach: `[reference:1]` (NFR1, above) and `[reference:5]` (the Vega device
requirement, contradicted by the FAQ).

## 🟢 9. Claims that verified correct

Keep these — several are load-bearing and were checked properly.

| Claim | Location | Note |
|---|---|---|
| Deadline Oct 24, 2026, 3:00 AM GMT+8 | `prd.md` §1 | Same instant as Oct 23 12:00pm PDT |
| Demo video < 3 min, on YouTube or Vimeo | `prd.md` NFR6 | Rules §4 match |
| MIT licence visible in the About section | `prd.md` NFR4 | Required for the public-repo route |
| Ring simulators accepted, no device needed | `prd.md` §10 | Rules §4 match |
| Friction log up to 10% bonus | `prd.md` §2, `ARCHITECTURE.md` §17 | Figure correct, mechanism misdescribed |
| Ring priority category: access control, caretaking | `prd.md` §3 | Matches Rules §4 |
| Kiro Crew alone qualifies for AWS Builder | `ARCHITECTURE.md` §7, §15 | Near-verbatim in the rules |
| Bedrock + Lambda + DynamoDB documented integration suffices | `ARCHITECTURE.md` §14 | Rules §4 "documented integrations" |

## ⚪ 10. Unresolved — needs a human decision

| Question | Why it is not answered here |
|---|---|
| Does the **submission repo** itself satisfy the Open Source mini-challenge? | The rules say "additional… alongside" and require two URLs, but no source addresses this case. The safe reading is **no**. Do not bet $5,000 on the generous reading. |
| ~~Which **AWS credit form URL** is live?~~ | **Resolved 2026-10-16 — moot.** The credit pool is exhausted and the form accepts no requests. Recorded as Friction Log Entry 27. The $15K/$5K prize credits are unaffected. |
| Body text of the **Sept 16, 2026 rules banner** | Present on the rules page, absent from the Updates feed. Its substance appears absorbed into current Rules §4. |

## Suggested order of work

Updated 2026-10-16. Submission closes **Fri Oct 23, 12:00pm PT**. The AWS credit form's
Oct 21 deadline is **moot** — the credit pool is exhausted and the form accepts no requests,
so the only remaining hard deadline is submission itself.

1. ✅ **Dual-track eligibility re-verified, and the invented rule removed.** Done 2026-10-16:
   `ARCHITECTURE.md` §3.7 and §15 now state the real rule and `prd.md`'s Primary Track is
   **Ring + Fire TV**. Worth **$13K cash plus $15K in prize credits** — which is why it was the
   highest-value item on the board.
2. ✅ **Correct the judging criteria, friction log template, risk rating, private-repo claim and
   dead citations.** Done 2026-10-16 — conflicts 3–6 above, plus `prd.md` FR3's subtype values
   and all six `[reference:N]` markers, which pointed at nothing.
3. ⏳ **Ship the separate open-source repository.** Cheapest fix per dollar remaining — $5,000
   for a new standalone repo, per the hackathon Manager's confirmation recorded in conflict 1.
   Blocks nothing else.
4. ⏳ **Deploy the stack at least once**, now that no credits are available. Free tier plus a
   deliberate teardown immediately after testing, which is what the FAQ advises anyway. Until
   this happens the submission cannot honestly claim a working deployment.
5. ⏳ **Re-shoot the demo video** so one video satisfies both tracks' clauses: the Ring APIs
   called at runtime in code, and the Fire TV client running on a device or emulator.
6. ⚠️ **Fix the describe → overlay queue hop** before recording. Nothing enqueues for overlay
   delivery, so the chain is two hops, not the three every document claims — and a video that
   asserts end-to-end delivery would be asserting something false.

## Related

- [01-official-requirements](./01-official-requirements.md) — the verified rules
- [02-mini-challenges](./02-mini-challenges.md) — mini-challenge eligibility in full
