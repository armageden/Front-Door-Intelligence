**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` §1 and §13, read directly. Every "Present in repo" value was re-checked against the working tree on 2026-10-04: `README.md`, `LICENSE`, and `FRICTION_LOG.md` exist and are readable; `web/dist/` contains a built demo page; the five gates were run that day. The three self-invalidating declarations that used to head this page were retired as each file was created. Still unknowable from the working tree: whether the GitHub repo is public, and every external deliverable.



# Submission checklist and PRD change discipline

Source: `prd.md` §13 (checklist) and §1 (change log).

## Submission checklist

Reproduced from `prd.md` §13. "Present" is checked against the working tree.

| Item | Present in repo |
|---|---|
| Public GitHub repo with MIT License in About section | **Partly** — `LICENSE` exists; whether the repo is public and the license is set in the About section is a GitHub setting, not a file |
| README with setup instructions and environment variable template | **Yes** — `README.md` covers setup, the command table, and every variable; `.env.example` is the committed template |
| Demo video < 3 minutes (uploaded, public) | No — external deliverable |
| Devpost submission form filled (track: Ring) | No — external deliverable |
| Friction Log in repo root | **Yes** — `FRICTION_LOG.md`, 20 entries in the six-field shape |
| Working demo accessible to judges | **Yes, locally and by pipeline** — `web/dist/demo.html` and `firetv/dist/overlay.html` render fixture data through the production code with no backend (D032, D034); both were rendered and exercised in a real browser on 2026-10-04. `.github/workflows/demos.yml` publishes both, with a landing page, to GitHub Pages on every push to `main` (D035) — one manual Pages enable plus a push away from a public URL. The backend itself is not deployed, so the demos carry fixture data by design |
| AWS Builder mini-challenge: documented Bedrock integration | **Partly** — `src/lib/bedrockClient.ts` is written and documented in [04-bedrock-client](../04-libraries/04-bedrock-client.md), but the integration has never run against Bedrock |
| Open Source mini-challenge: repo is public + MIT licensed | **Partly** — `LICENSE` exists; the rules require a *second*, distinct repository alongside the primary submission, and none exists (Friction Log Entry 18) |

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
