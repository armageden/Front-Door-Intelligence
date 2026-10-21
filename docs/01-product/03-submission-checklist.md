**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` §1 and §13, read directly. Every "Present in repo" value was re-checked against the working tree on 2026-10-04, and re-verified on 2026-10-21: `README.md`, `LICENSE`, and `FRICTION_LOG.md` exist and are readable; `web/dist/` contains a built demo page; the demo video was recorded and published to YouTube on 2026-10-21; the companion repository `ring-webhook-verifier-` was published to GitHub.

# Submission checklist and PRD change discipline

Source: `prd.md` §13 (checklist) and §1 (change log).

## Submission checklist

Reproduced from `prd.md` §13. "Present" is checked against the working tree and live submission deliverables.

| Item | Present in repo / live |
|---|---|
| Public GitHub repo with MIT License in About section | **Yes** — public at `https://github.com/armageden/Front-Door-Intelligence` with MIT License detected |
| README with setup instructions and environment variable template | **Yes** — `README.md` covers setup, the command table, and every variable; `.env.example` is the committed template |
| Demo video < 3 minutes (uploaded, public) | **Yes** — uploaded to YouTube: [https://youtu.be/Pg0fJis0g5o](https://youtu.be/Pg0fJis0g5o) (2:55) |
| Devpost submission form filled (tracks: Ring, Fire TV) | **Ready** — complete submission text prepared in submission package |
| Friction Log in repo root | **Yes** — `FRICTION_LOG.md`, 27 entries in the six-field shape |
| Working demo accessible to judges | **Yes, locally and live on GitHub Pages** — `web/dist/demo.html` and `firetv/dist/overlay.html` render fixture data through production code; published to GitHub Pages at `https://armageden.github.io/Front-Door-Intelligence/` |
| AWS Builder mini-challenge: documented Bedrock integration | **Partly** — `src/lib/bedrockClient.ts` is written and documented in [04-bedrock-client](../04-libraries/04-bedrock-client.md), but the integration has never run against live Bedrock |
| Open Source mini-challenge: repo is public + MIT licensed | **Yes** — standalone companion repository published and public: [`ring-webhook-verifier-`](https://github.com/armageden/ring-webhook-verifier-) (0 dependencies, 8 passing tests, MIT) |

The remote is `https://github.com/armageden/Front-Door-Intelligence.git`. Whether it is
public is not something the working tree can tell us; the file-level gaps are real
regardless.

## PRD change log

`prd.md` §1 is a versioned change log:

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-09-28 | 1.0 | Initial PRD created | farhan |
| 2026-10-16 | 1.1 | Corrected against the Devpost Official Rules: FR3 subtype values (flat, not dotted), NFR1/NFR4/NFR6 citations, private-repo constraint (private repos are judgeable), Vega OS testing constraint (emulator sufficient). All six dead `[reference:N]` markers removed. Evidence: `docs/05-hackathon-requirements/03-doc-conflicts.md`. | farhan |
| 2026-10-16 | 1.2 | Primary Track set to **Ring, Fire TV**, re-verified against the live Rules: §4 imposes no entry limit and §8 caps only prizes *won*. Goals §2 and Background §3 updated to match. Evidence: `docs/05-hackathon-requirements/03-doc-conflicts.md` conflict 2. | farhan |

Two rules follow from the table's existence:

1. Any edit to `prd.md` gets a new row. Do not rewrite history rows.
2. The header table at the top of `prd.md` carries a `Version` field that must be
   bumped to match the newest change-log row.

## Related

- [01-requirements-index](./01-requirements-index.md) — the FR catalogue
- [02-change-the-architecture-spec](../00-how-to/02-change-the-architecture-spec.md) — the same discipline for `ARCHITECTURE.md`
