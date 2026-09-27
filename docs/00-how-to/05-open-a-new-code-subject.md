**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §11 read directly, and checks 2, 3 and 5 of `scripts/docs-check.mjs` read in its source. Every source path in the examples on this page is illustrative and sits in a fenced block, so the validator does not treat it as a real path.

# Recipe: open a new code subject

**Goal:** when the first file of a subsystem is created, start its subject folder in
the same commit-worth of work, so the documentation never lags behind the code.

## The problem this solves

This repository currently holds two spec documents, this documentation set, and its
validator — and no code. See [01-current-state](../03-repository/01-current-state.md)
for the exact inventory. Without a rule for the moment code appears, the natural
failure is a repo full of code and a `docs/` tree that still describes the plan.

The rule: **code first, its subject folder in the same pass, never a follow-up task.**

## Steps

1. **Take the next free order from the contract.** Open
   [`docs/.docsrc.json`](../.docsrc.json) and add a `subjects` entry with a **stable
   `id`**, an `order`, the `folder`, `title`, `covers`, and `readWhen`. Existing ids
   are `how-to`, `product`, `architecture`, `repository`; never reuse or renumber one.
   The `order` value must equal the `NN` prefix on the folder name, and the validator
   fails if they disagree — that is what makes silent renumbering impossible.

   ```json
   {
     "id": "handlers",
     "order": 4,
     "folder": "04-handlers",
     "title": "Lambda request handlers",
     "covers": "What each handler receives, returns, and delegates to",
     "readWhen": "You are changing a handler or tracing an event through the pipeline"
   }
   ```

   Never reuse a number from a deleted folder. Relative links in siblings would
   silently repoint.

2. **Create `docs/NN-<subject-name>/00-overview.md`.** The overview is mandatory and
   the validator fails without it. It needs the subject name, the folder path, a
   **Read this when** purpose, and a table of contents linking every sub-file with a
   one-line description.

   ```markdown
   # 04 — Handlers

   | Field | Value |
   |---|---|
   | **Subject** | Lambda request handlers |
   | **Folder** | `docs/04-handlers/` |
   | **Source of truth** | `src/handlers/` |
   | **Status** | Implemented |

   **Read this when** you need to know what each handler receives, what it returns,
   and where it delegates next.

   ## Contents

   | File | What it covers |
   |---|---|
   | [01-webhook-handler](./01-webhook-handler.md) | Signature check, idempotency, response SLA |
   ```

3. **Create one sub-file per meaningful unit.** Start with one per handler or module,
   not one giant page. Each sub-file opens with the backlink:

   ```markdown
   **Back:** [00-overview](./00-overview.md)

   **Verified against:** `src/handlers/webhookHandler.ts` → `handleWebhook()` and
   `requireSignature()`, read on <date>. Unverified: none — every claim below was
   checked against the file.
   ```

   The backlink is what the validator checks; the provenance line is what makes the
   claim auditable by a later reader. State plainly when something could not be
   verified rather than leaving the line vague.

4. **Write sub-files against the real source, not the spec.** Read the file, then
   document its actual exported names, actual parameters, and actual behaviour. If the
   implementation diverged from the design, the doc records the implementation and the
   divergence goes to
   [02-change-the-architecture-spec](./02-change-the-architecture-spec.md).

5. **Reference every real path in backticks.** This is what makes the validator's
   check 1 and check 5 work. Once the file exists, cite the concrete path, not a vague
   description of it. Before it exists, use an angle-bracket placeholder. Both forms
   are shown here because the fence is illustrative, not a path assertion:

   ```text
   exists      src/handlers/webhookHandler.ts
   not yet     src/handlers/<handlerName>.ts
   not yet     template.yaml is planned in ARCHITECTURE.md §11
   ```

   A backticked path that is neither on disk nor a placeholder is a validator failure,
   which is the intended behaviour: it is the difference between documenting a file and
   imagining one.

6. **Cross-link.** Link to the subject that explains the design behind the code, and
   from that subject back to the code. A subject nobody links into is as invisible as
   one that does not exist.

7. **Update the two indexes.** Add the new folder to the subject table in
   [00-how-to/00-overview.md](../00-how-to/00-overview.md) and to the subject index
   in `AGENTS.md`. The `AGENTS.md` index is the router every agent reads first, so a
   folder missing from it is effectively undocumented.
8. **Shrink the plan.** Remove the created paths from
   [04-planned-structure](../03-repository/04-planned-structure.md). Once a path is
   real, it no longer belongs on the planned page — that page is only for what is
   unwritten.

9. **Run the validator.**

   ```bash
   node scripts/docs-check.mjs
   ```

   Check 5 will now be live for the first time: it fails if any file under the new
   subject's source directory is not referenced by path in a document.

## Naming the subject

Derive the list from the code that exists, not from a template. For this project the
planned tree in `ARCHITECTURE.md` §11 already suggests candidates — handlers, library
clients, shared types, the Fire TV app, the web dashboard, tests — but a subject is
only opened once a file for it exists, and merged or renamed if the real code clusters
differently.

## Verify

| Question | Answer when |
|---|---|
| Does the folder have a `00-overview.md`? | Yes |
| Does the overview link every sub-file, and do they all exist? | Yes |
| Does every sub-file backlink to its overview and declare its evidence? | Yes, or checks 3 and 8 fail |
| Is every real file in the subsystem referenced by path? | Yes, or check 5 fails |
| Is the folder declared in the contract, with `order` matching its `NN` prefix? | Yes, or check 9 fails |
| Is the folder in both indexes? | `AGENTS.md` and the how-to overview |
| Do the validator's nine checks pass? | Exit code 0 |

## Depth

- The validator in detail: [03-verification-commands](../03-repository/03-verification-commands.md)
- Where the planned paths come from: [04-planned-structure](../03-repository/04-planned-structure.md)
- The subject to cross-link: [02-architecture](../02-architecture/00-overview.md)
