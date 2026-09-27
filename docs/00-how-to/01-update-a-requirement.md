**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` §1, §5 and §13, read directly. No implementing code exists, so no claim here is verified against a handler.

# Recipe: update a requirement

**Goal:** change what the product must do, keeping `prd.md`, the FR catalogue, and
the change log consistent.

## When this applies

A requirement is being added, reworded, split, merged, or retired. Not a technical
design change — that is
[02-change-the-architecture-spec](./02-change-the-architecture-spec.md).

## Steps

1. **Edit the requirement in `prd.md` §5.** Requirements live in the numbered
   subsections and keep the `FR<n>:` prefix, a MUST or MAY, and a trailing reference
   where the original had one. Group it under the subsection that matches its stage:
   core pipeline, AI description layer, Fire TV overlay, optional cross-track
   integration, or Friction Log.

2. **Keep IDs stable.** Never renumber. A retired requirement stays in place with a
   `~~struck-through~~` body and a `[Retired]` note, because FR and NFR IDs get cited
   in the architecture docs, the Friction Log, and judging conversations. Reusing a
   retired ID silently rewrites history.

3. **Append a change-log row in `prd.md` §1.** The table is
   `Date | Version | Description | Author`. Add a row; do not edit an existing one.

4. **Bump the version in the `prd.md` header table** to match the newest change-log
   row. It currently reads `Version | 1.0` next to `Author | [Your Name]`.

5. **Update the FR catalogue.** Open
   [01-requirements-index](../01-product/01-requirements-index.md) and mirror the
   change into the right group table. Its status column is derived from what exists on
   disk, so it is usually `Specified, not implemented` — do not write `Implemented`
   until a file is on disk and `node scripts/docs-check.mjs` agrees.

6. **Check whether the design still satisfies it.** If the change alters a data shape,
   endpoint contract, or component behaviour, the architecture subject is now wrong.
   Continue with
   [02-change-the-architecture-spec](./02-change-the-architecture-spec.md).

7. **Run the validator.**

   ```bash
   node scripts/docs-check.mjs
   ```

## Real patterns to copy

From `prd.md` §5.1, the canonical shape of a requirement line:

```markdown
- **FR1:** The system MUST receive Ring webhook events in real time via HTTP POST.
```

Note the bold ID, the colon, the system as subject, and a single MUST. Optional items
use MAY and are marked `*[Optional]*`, as FR16 and FR17 do.

## Verify

| Question | Answer when |
|---|---|
| Does the new FR appear in the catalogue? | Catalogue table matches `prd.md` §5 |
| Is the change-log row added? | `prd.md` §1 has a new row |
| Does the header version match? | Header `Version` equals newest row's version |
| Do the validator's nine checks pass? | Exit code 0 |

## Depth

- What each requirement means: [01-requirements-index](../01-product/01-requirements-index.md)
- How to retire a citation marker: [03-add-a-friction-log-entry](./03-add-a-friction-log-entry.md)
- The full docs-sync obligation: [04-run-a-docs-sync-pass](./04-run-a-docs-sync-pass.md)
