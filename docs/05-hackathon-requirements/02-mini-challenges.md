**Back:** [00-overview](./00-overview.md)

**Verified against:** Devpost Official Rules §4 (Mini Challenges) and §8 (Prizes, the Open Source row); the hackathon Overview and Resources pages; the FAQs; three Devpost forum threads including answers from hackathon Manager Janet Fang and Amazon DevRel Emerson Sklar. Read 2026-09-28.

# Mini-challenge eligibility

Both mini-challenges are "$5,000 + $5,000 AWS credits + a meeting with the Amazon
Developer team". Neither is automatic, and one of the two is currently misread in the
project documents.

## Open Source — 🔴 the project does not currently qualify

The rules, verbatim (Rules §4):

> "**Open Source (Mini Challenge):** Create a new, **additional** open-source project
> or contribute to an existing public repository during the hackathon window,
> **alongside a primary track submission.** Contributions can be a new repo (with
> open-source license), a branch, a fork, or a pull request. PRs do not need to be
> merged; share your forked version if unmerged. Required: contribution URL, project
> repository URL, GitHub username, and a description of what you did, how it works,
> and why it matters."

The Resources page words it more narrowly — "Make a contribution to an open-source
project repository" — which reads as if a third-party contribution were mandatory.
**The rules page is broader and it controls.** Rules §11.4:

> "If there is any discrepancy or inconsistency between the terms and conditions of the
> Official Rules and disclosures or other statements contained in any Hackathon
> Materials, including but not limited to, the Hackathon Submission form, Hackathon
> Website, or advertising, **the terms and conditions of the Official Rules shall
> prevail.**"

So, precisely:

| Question | Answer |
|---|---|
| Must I contribute to a third-party repo? | **No.** "a new repo (with open-source license), a branch, a fork, or a pull request" |
| Does a brand-new repo of my own count? | **Yes**, if licensed, created in the window, and **additional** to the submission |
| Does my **submission repo** count? | **NOT FOUND.** The rules say "additional… alongside", and the form demands **two distinct URLs** — which only makes sense if the artifacts differ. Nothing states the submission repo qualifies. **Do not bet on it.** |
| Must the PR be merged? | **No.** "share your forked version if unmerged" |

**The bar for a separate repo is low.** Hackathon Manager Janet Fang, asked whether a
fresh repo built for a *different* hackathon during this window would be eligible:
**"Yes that's fine!"** No theme match, no merging, no maintainer relationship.

`prd.md` §13 says "Open Source mini-challenge: repo is public + MIT licensed" and
`ARCHITECTURE.md` §14 (corrected 2026-10-16) says "Separate licensed repository alongside the
submission — the form asks for two distinct URLs". Read against the rules, **that is the
submission repo claiming to be its own contribution, and the prize is $5,000.** The fix is a
second, small, genuinely separate licensed repo or a real PR — hours, not days. **Still open.**

### Hacktoberfest is a red herring

> "October is also Hacktoberfest… **We are not affiliated with it**… Their 2026 format
> moved away from counting pull requests, so check their current rules before you plan
> around it." — Resources page

Hacktoberfest 2026 has moved away from counting PRs, but that is irrelevant here: the
Amazon rules are self-contained and do not depend on Hacktoberfest's. Do not let the
two rule sets leak into each other's planning.

## AWS Builder — ✅ the project qualifies, and the claim is correct

> "**AWS Builder (Mini Challenge):** Any primary track project that incorporates AWS
> services (i.e. Amazon Bedrock, AgentCore, Strands SDK, **Kiro Crew**, SageMaker,
> etc.) **with documented integrations**." — Rules §4

> "**Kiro Crew qualifies on its own as a development tool used during the hackathon —
> a submission does not need to also call a runtime AWS service (Bedrock, AgentCore,
> SageMaker, Strands SDK) to count for this mini-challenge.**" — Rules §4

> "Building with Kiro Crew qualifies on its own, you don't also need to call a separate
> AWS runtime service." — Overview page

**`ARCHITECTURE.md` §7 and §15 are correct and understated.** The exact tool name in
the rules is **"Kiro Crew"** — the bare "Kiro" on the Resources page is shorthand
inside a service list. Note "Kiro Crew" and "Kiro CLI" are different products; the rule
names Crew.

The bar is also lower than the project assumes. Emerson Sklar, Amazon DevRel, asked
whether Claude Code running on Bedrock counted as a development tool with no separate
runtime service: **"Yes, CC on Bedrock would count."**

Required form field: "Describe which AWS service(s) you used and how, in your Product
Feedback answer."

**A caution, though.** Relying on Kiro Crew alone would leave nothing concrete to
describe in the Product Feedback answer. The project already plans a full Bedrock +
Lambda + DynamoDB pipeline, which is a genuine multi-service integration — and the
rubric explicitly names "multi-service pipeline" as *Creative* for AWS Builder, versus
"single Bedrock call for text generation" as *Obvious*. **Run both:** use Kiro Crew for
development *and* document the Bedrock pipeline.

### AgentCore and Strands SDK

Named in the rules as examples of qualifying services, but **NOT DEFINED** anywhere in
the hackathon materials. If either is claimed, read the AWS Builder Center material
first — judges score "documented integrations", and thin documentation on an unfamiliar
service is a Tech Implementation risk.

## One prize limit, many tracks

> "**IMPORTANT NOTES ON MULTIPLE PRIZE ELIGIBILITY: A project can only win one (1) track
> prize and one (1) mini challenge prize.**" — Rules §8

The limit is on prizes **won**, not tracks **entered**. See
[03-doc-conflicts](./03-doc-conflicts.md) conflict 2 — the project's "one app, one
primary track" rule is invented, and it is expensive.

## Related

- [01-official-requirements](./01-official-requirements.md) — prizes, judging, submission
- [03-doc-conflicts](./03-doc-conflicts.md) — the Open Source misread, in context
