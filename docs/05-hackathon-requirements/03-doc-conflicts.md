**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` and `ARCHITECTURE.md` read in full, cross-checked line by line against Devpost Official Rules §1, §4, §6, §8, §11.4, the Overview and Resources pages, and the FAQs. Read 2026-09-28.

# Conflicts between the project documents and the Official Rules

Nothing in `prd.md` or `ARCHITECTURE.md` has been changed. These are content decisions
for the author, so each conflict is recorded with the rule text, the project text, and
a status.

| Status | Meaning |
|---|---|
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
| **Rule** (Rules §4) | "Identify which **Primary Track(s)** you are submitting your Project into." |
| **DevRel** (forum, 2026) | Emerson Sklar, asked whether one project may be judged in both Fire TV and Alexa+: "**Yes, your project can select and be judged for both tracks** (and, as you noted, can only win one)." |
| **Project** (`ARCHITECTURE.md` §3.7) | "**Critical rule:** One app can only be entered into **one primary track**." |
| **Project** (`ARCHITECTURE.md` §15) | Listed as a v2 **correction**: "No explicit statement that one app = one primary track \| Added explicit rule: one app, one primary track" |
| **Status** | 🔴 **WRONG, and it is an invented rule** — the v2 correction log records adding a rule that does not exist. |
| **Cost** | The project builds a Fire TV app (FR6, FR12–FR15, `prd.md` §8.1 lists it first, `ARCHITECTURE.md` §13 spends Week 3 on it) and is locked out of the track paying **$25,000** instead of **$12,000**, plus **$15K** in AWS credits Ring does not offer. The limit is on prizes *won*, not tracks *entered*. |
| **Fix** | Delete the rule from §3.7 and its row in §15. Dual-track entry is permitted. Both tracks' demo clauses must be satisfied by the same video. |

## 🔴 3. Judging criteria

| | |
|---|---|
| **Rule** (Rules §6) | Stage One is a **pass/fail viability gate**. Stage Two uses four **equally weighted** criteria: **Tech Implementation**, **Design**, **Potential Impact**, **Quality of the Idea**. |
| **Project** (`ARCHITECTURE.md` §14) | Lists Innovation, Impact, Tech Implementation, Design, Presentation |
| **Status** | 🔴 **WRONG.** "Innovation" and "Presentation" are not criteria. "Quality of the Idea" is missing. The Stage One pass/fail gate — a real elimination cliff — is not mentioned anywhere. |
| **Fix** | Rewrite §14 against the four real criteria and add the Stage One gate. Every prioritisation decision is currently being made against the wrong rubric. |

## 🟠 4. "Private repos are not judgeable"

| | |
|---|---|
| **Rule** (Rules §4) | "The repository must be either **public and open source**… **OR private** and shared with `testing@devpost.com` and the Amazon team." |
| **Project** (`prd.md` §10) | "Public repo: **Mandatory**; private repos are not judgeable." |
| **Status** | 🟠 **FALSE** as a reason. Private repos are permitted. |
| **Fix** | Keep the decision to publish publicly — it is the right call, and it also serves the Open Source mini-challenge. Correct the *justification*. Note the FAQ's 7-day reviewer-invitation expiry if the private route is ever considered. |

## 🟠 5. Friction log shape

| | |
|---|---|
| **Rule** (Rules §4, §6) | Six fields: task attempted, steps taken, expected vs actual result, **severity rating**, **workaround used**, actionable suggestion. Bonus is **recommended** at Stage 1 and applied by the Stage 2 panel. |
| **Project** (`ARCHITECTURE.md` §10, §17) | Template has four fields: What I tried / What happened / Impact / Suggested fix. "**earns** up to a 10% bonus." |
| **Status** | 🟠 **IMPRECISE.** The 10% figure is right. The template omits **two of six** required fields, and "earns" overstates it. |
| **Fix** | Add severity rating and workaround to the template; change "earns" to "recommended, assessed at Stage 1 downselection". Recipe: [03-add-a-friction-log-entry](../00-how-to/03-add-a-friction-log-entry.md) |

## 🟠 6. "Vega OS testing needs a physical device"

| | |
|---|---|
| **Rule** (FAQs) | "Fire TV: an emulator (Android TV Emulator or the Fire TV/Vega simulator) is fine – **a physical device isn't required at any stage of submission or judging.**" |
| **Project** (`prd.md` §10) | "Vega OS testing: Requires a physical Fire TV Stick running Vega OS or a virtual device" (`[reference:5]`) |
| **Project** (`ARCHITECTURE.md` §12) | Rates "Vega OS testing blocked" as **High likelihood / High impact** |
| **Status** | 🟠 **IMPRECISE.** The FAQ is more permissive than the PRD claims. A virtual device is explicitly fine. |
| **Fix** | Downgrade that risk. It is one of the two High/High risks driving the schedule, so an inflated rating costs planning capacity. |

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
| Which **AWS credit form URL** is live? | Three different links across Rules §4, Resources, and the FAQ. Use the Rules-page one; submit before Oct 21, 12pm PT. |
| Body text of the **Sept 16, 2026 rules banner** | Present on the rules page, absent from the Updates feed. Its substance appears absorbed into current Rules §4. |

## Suggested order of work

1. **Add a separate open-source artifact** — cheapest fix for a $5,000 prize; blocks nothing.
2. **Re-open the track decision** — dual-track is permitted, and the Fire TV app is
   already specced. Requires one video showing both the Ring simulator and the Fire TV
   or Vega simulator.
3. **Correct `ARCHITECTURE.md` §3.7, §14, §15, §12 and `prd.md` §10** — the track
   rule, the judging criteria, the Stage One gate, the risk rating, the private-repo
   claim.
4. **Fix the friction log template** — add the two missing fields.
5. **Request the AWS credits now** — the form deadline is Oct 21, two days before
   submission.
6. **Resolve or remove the six `[reference:N]` markers.**

## Related

- [01-official-requirements](./01-official-requirements.md) — the verified rules
- [02-mini-challenges](./02-mini-challenges.md) — mini-challenge eligibility in full
