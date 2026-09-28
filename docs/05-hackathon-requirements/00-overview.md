**Verified against:** `https://amazonappdev2026.devpost.com/rules` (Official Rules, §1 Submission Period, §4 Project Requirements and Submission Requirements, §6 Evaluation, §8 Prizes, §11.4), the hackathon Overview page, the FAQs, the Updates feed, and two Amazon DevRel forum answers. Researched 2026-09-28. Every claim below carries the section it came from; nothing here is inferred from the project's own documents.

# 05 — Hackathon requirements

| Field | Value |
|---|---|
| **Subject** | What the hackathon officially requires, and where `prd.md` / `ARCHITECTURE.md` disagree with it |
| **Folder** | `docs/05-hackathon-requirements/` — declared as subject `hackathon-requirements`, order 5, in [`docs/.docsrc.json`](../.docsrc.json) |
| **Source of truth** | The Devpost Official Rules, not the project's own documents |
| **Status** | Verified against the rules on 2026-09-28. Rules can change; re-check before submitting |

**Read this when** you need to know what the hackathon actually requires, what is
worth points, or whether a project document is making a claim the rules do not
support.

**This subject exists because verification found real errors.** Four claims in
`prd.md` and `ARCHITECTURE.md` are contradicted by the Official Rules, and two of
them are worth money. Nothing in the project documents has been rewritten in place —
those are content decisions for the author — so the conflicts are recorded here
instead.

## Contents

| File | What it covers |
|---|---|
| [01-official-requirements](./01-official-requirements.md) | Deadline, prizes, judging criteria, the two-stage process, submission requirements |
| [02-mini-challenges](./02-mini-challenges.md) | AWS Builder and Open Source eligibility, verbatim, and what the project currently satisfies |
| [03-doc-conflicts](./03-doc-conflicts.md) | Every place `prd.md` or `ARCHITECTURE.md` misstates a requirement, with the rule text on the left and the document on the right |
| [04-ring-api-findings](./04-ring-api-findings.md) | What the real Ring API does: webhook signing confirmed, payload contract wrong in 6 of 9 fields, snapshot call wrong, mandatory watermark, E2EE blocker, no webhook sandbox |
| [05-fire-tv-vega-findings](./05-fire-tv-vega-findings.md) | What Vega OS can and cannot do: a third-party-video overlay is not available, RN `zIndex` does not work over video, and the keystrokes a dismiss button needs |

## How to read a conflict

Each row in [03-doc-conflicts](./03-doc-conflicts.md) gives the **rule text**, the
**project text**, and a **status**: `WRONG`, `FALSE`, `IMPRECISE`, `RIGHT`, or
`NOT FOUND`. `NOT FOUND` means the research could not resolve it and it needs a human
decision — it is not a synonym for "probably fine".

The two marked 🔴 are worth acting on before anything else is built:

1. **The Open Source mini-challenge does not accept the submission repo itself.** As
   planned, the project scores zero for a $5,000 prize.
2. **"One app, one primary track" is not a real rule.** It is documented in
   `ARCHITECTURE.md` as a v2 *correction*, so it is currently steering the project
   away from a track that pays **$13,000 more** for work it is already specced to do.

## Related

- What the project intends to build: [01-product](../01-product/00-overview.md),
  [02-architecture](../02-architecture/00-overview.md)
- The current repository state: [03-repository](../03-repository/00-overview.md)
