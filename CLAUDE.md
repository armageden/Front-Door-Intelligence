# CLAUDE.md

This repository's agent configuration is [`AGENTS.md`](./AGENTS.md). It is the single
source of truth: project snapshot, the contract pointer, subject index, and the
numbered working rules — including Rule 0 (git is read-only), Rule 3 (the docs-sync
pass), and Rule 5 (a passing `docs:check` is not proof the docs are correct).

Machine-readable configuration — package manager, commands, globs, subject layout,
marker syntax, secret patterns — lives in
[`docs/.docsrc.json`](./docs/.docsrc.json). Read that rather than trusting prose.

The docs-sync runbook has exactly one home:
[`.claude/agents/docs-updater.md`](./.claude/agents/docs-updater.md). Read it after
`AGENTS.md` when finishing any task that touched code or config.

Nothing is duplicated here on purpose, so there is only one place to update.
