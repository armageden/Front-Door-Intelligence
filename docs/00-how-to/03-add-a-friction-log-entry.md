**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §10, §14 and §15, and `prd.md` §9, §12 and §13, read directly. The `FRICTION_LOG.md` template is quoted from `ARCHITECTURE.md` §10; the file itself does not exist yet.

<!-- docs-check:expect-absent FRICTION_LOG.md -->

# Recipe: add a friction log entry

**Goal:** record a tooling problem that cost time, in the format that earns the 10%
judging bonus.

## Why this is not optional

FR18 makes the Friction Log a MUST, and `ARCHITECTURE.md` §10 states it is worth up to
a 10% bonus on the final judging score. `prd.md` §9 sets the target at **more than 10
specific, actionable items**. `prd.md` §12 lists the five categories to cover: Ring API,
Vega SDK, Bedrock, AWS setup, and documentation gaps.

The file does not exist in the working tree — see
[01-current-state](../03-repository/01-current-state.md). Creating it is this recipe's
first step, and it is the single highest-leverage thing you can add to the repo today.

## Steps

1. **Create the file at the repo root** with the structure from `ARCHITECTURE.md` §10:

   ```markdown
   # Friction Log — Front Door Intelligence

   ## Ring API

   ### Entry 1: Webhook signature verification docs incomplete
   - **What I tried:** Following Ring's webhook setup guide
   - **What happened:** The `X-Signature` header format was not documented for HMAC-SHA256
   - **Impact:** 2 hours lost reverse-engineering the signature format
   - **Suggested fix:** Add a code example for Node.js signature verification
   ```

   Four fields, in this order: **What I tried**, **What happened**, **Impact**,
   **Suggested fix**. Impact is stated concretely — hours lost, or what it blocked.

2. **Group by category.** Use the five headings from `prd.md` §12: `## Ring API`,
   `## Vega SDK`, `## Bedrock`, `## AWS Setup`, `## Documentation Gaps`. Add a
   category only when nothing above fits.

3. **Number entries sequentially within their category** and never renumber. Judges
   read this as a narrative of obstacles cleared.

4. **Be specific enough to be useful.** "Ring docs were wrong" scores nothing.
   "The `X-Signature` header format was not documented for HMAC-SHA256; the digest is
   hex, not base64" is the shape of a good entry. Name the API, the flag, the error
   text, the version.

5. **Add an entry the moment you hit friction**, not later. Reconstructed entries lose
   the impact figure, which is the part that scores.

6. **Run the validator.**

   ```bash
   node scripts/docs-check.mjs
   ```

## The planned-path marker

Until the file exists, this repository's own docs cannot reference it as a real path —
the validator fails any backticked path that is not on disk. That is the mechanism
working, not a nuisance. Wrap the reference in a skip marker:

```markdown
<!-- docs-check:skip planned -->
The Friction Log lives at the repo root as `FRICTION_LOG.md`.
<!-- docs-check:skip end -->
```

The validator prints the count and the paths of everything it skipped, so a skip is
visible on every run and cannot quietly become permanent. Remove the marker once the
file exists.

## Candidates already sitting in the repo

Two documentation defects found while building this docs set, both belonging under
`## Documentation Gaps`:

1. **`prd.md` has unresolvable citation markers.** Six markers, `[reference:0]`
   through `[reference:5]`, sit in FR3, NFR1, NFR4, NFR6 and two constraints
   entries, but no reference list exists anywhere in the repository. Impact: a judge
   following any citation finds nothing. The full placement table is in
   [01-current-state](../03-repository/01-current-state.md).
2. **`ARCHITECTURE.md` §11 contradicts the real tree.** It places the PRD, the
   architecture doc, and the Friction Log inside `docs/`, while the PRD and the
   architecture doc are in fact at the repo root.

## Verify

| Question | Answer when |
|---|---|
| Does the file exist at the repo root? | Yes |
| Does every entry have all four fields? | No entry missing one |
| Are there more than 10 entries? | `prd.md` §9 target met |
| Do all five `prd.md` §12 categories appear? | All present or explicitly noted |
| Do the validator's nine checks pass? | Exit code 0 |

## Depth

- FR18 and the NFRs: [01-requirements-index](../01-product/01-requirements-index.md)
- Checklist entry it satisfies: [03-submission-checklist](../01-product/03-submission-checklist.md)
- Why decisions get logged too: [06-design-decisions](../02-architecture/06-design-decisions.md)
