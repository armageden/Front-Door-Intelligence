**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` §1 and §13, read directly. Every "Present in repo" value was checked against the working tree, not inferred from the checklist.

<!-- docs-check:expect-absent README.md LICENSE FRICTION_LOG.md -->

# Submission checklist and PRD change discipline

Source: `prd.md` §13 (checklist) and §1 (change log).

## Submission checklist

Reproduced from `prd.md` §13. "Present" is checked against the working tree.

| Item | Present in repo |
|---|---|
| Public GitHub repo with MIT License in About section | No — no `LICENSE` file |
| README with setup instructions and environment variable template | No — no `README.md` file |
| Demo video < 3 minutes (uploaded, public) | No — external deliverable |
| Devpost submission form filled (track: Ring) | No — external deliverable |
| Friction Log in repo root | No — no `FRICTION_LOG.md` file |
| Working demo accessible to judges | No — no implementation |
| AWS Builder mini-challenge: documented Bedrock integration | No — see `ARCHITECTURE.md` §7 |
| Open Source mini-challenge: repo is public + MIT licensed | No — no `LICENSE` file |

The remote is `https://github.com/armageden/Front-Door-Intelligence.git`. Whether it is
public is not something the working tree can tell us; the file-level gaps are real
regardless.

## PRD change log

`prd.md` §1 is a versioned change log:

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-09-28 | 1.0 | Initial PRD created | [Your Name] |

Two rules follow from the table's existence:

1. Any edit to `prd.md` gets a new row. Do not rewrite history rows.
2. The header table at the top of `prd.md` carries a `Version` field that must be
   bumped to match the newest change-log row.

The author field still reads `[Your Name]`. Replace it when making the first substantive
edit — see
[01-update-a-requirement](../00-how-to/01-update-a-requirement.md).

## Related

- [01-requirements-index](./01-requirements-index.md) — the FR catalogue
- [02-change-the-architecture-spec](../00-how-to/02-change-the-architecture-spec.md) — the same discipline for `ARCHITECTURE.md`
