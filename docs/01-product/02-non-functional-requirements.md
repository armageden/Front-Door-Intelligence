**Back:** [00-overview](./00-overview.md)

**Verified against:** `prd.md` §6, §9 and §10, read directly. Cross-references to `ARCHITECTURE.md` §3.5, §3.6, §6 and §13 confirmed against that file. The status column was added on 2026-09-28 and every row read from the working tree — `template.yaml` for NFR1 and NFR7, `src/lib/dynamoClient.ts` for NFR2, `.env.example` and `.gitignore` for NFR3, and a `find` sweep for the two files. NFR4 and NFR5 moved from not-implemented to implemented when `LICENSE` and `README.md` were created on 2026-10-02; their `expect-absent` declarations were removed at that moment, so the validator itself flagged the change.



# Non-functional requirements, metrics, constraints

Source: `prd.md` §6 (NFR1–NFR7), §9 (success metrics), §10 (constraints).

## NFR1–NFR7

| ID | Requirement | Enforced by | Status |
|---|---|---|---|
| NFR1 | Webhook endpoint MUST return HTTP 200 within 5 seconds to avoid Ring retry storms | API Gateway + Lambda timeout config | **Implemented** — a 5s `Timeout` in the `Globals` block of `template.yaml`, and the handler enqueues before responding. Never measured against Ring |
| NFR2 | Webhook handling MUST be idempotent — duplicate `request_id` values MUST not create duplicate events | `IdempotencyTable` with 24h TTL | **Implemented** — a conditional put in `claimRequestId()`; a duplicate returns 200 and is not reprocessed |
| NFR3 | All API keys and tokens MUST be stored as environment variables, never committed to the repository | `.env.example` + gitignore | **Implemented** — `.env.example` holds placeholder values only, and the validator's secret check scans `prd.md` and `ARCHITECTURE.md` too |
| NFR4 | The public GitHub repository MUST include an MIT License visible in the About section | `LICENSE` at repo root | **Implemented** — MIT `LICENSE` at the repo root, matching the manifest's `"license": "MIT"` |
| NFR5 | The README MUST include complete setup instructions so judges can run the project locally | `README.md` | **Implemented** — `README.md` carries setup, the env template, deploy steps, every command, and an explicit statement that nothing has run against live AWS |
| NFR6 | The demo video MUST be under 3 minutes, leading with the user problem before the solution | External deliverable | Not implemented — nothing to record yet |
| NFR7 | Total AWS resource usage SHOULD stay within free-tier limits where feasible | Model choice, max tokens | **Partly** — `MAX_TOKENS = 80` and `TEMPERATURE = 0.2` are in place; the CloudWatch billing alarm that would *detect* a runaway does not |

NFR1 and NFR2 are the two that shape the code most: they force the webhook handler to
acknowledge fast and to be idempotent, which is why the design makes the webhook
handler return before the pipeline finishes. See
[01-system-overview](../02-architecture/01-system-overview.md).

NFR3 is the reason secrets appear only as environment variable names in
[02-toolchain](../03-repository/02-toolchain.md), never as values.

## Success metrics

| Metric | Target |
|---|---|
| End-to-end latency (Ring event → TV overlay) | < 8 seconds |
| Webhook response time | < 5 seconds |
| Bedrock description accuracy (human eval) | > 80% "describes what's visible" |
| Demo video length | < 3 minutes |
| Friction Log entries | > 10 specific, actionable items |
| Public repo completeness | README + LICENSE + setup instructions + env template |

The "Bedrock description accuracy" target is the measurable form of FR9/FR10. Human
evaluation is required; there is no automated judge in the spec.

The "< 8 seconds" and "< 5 seconds" numbers are consistent with each other: the
webhook must answer inside 5s (NFR1) and the whole pipeline must finish inside 8s
(FR6), so roughly 3s of headroom is available to snapshot fetch plus Bedrock.

## Constraints

| Constraint | Detail |
|---|---|
| Time | ~26 days to deadline, 24 October 2026 |
| Solo developer | No team; must prioritise ruthlessly |
| Ring physical device | Not required; simulators acceptable |
| Public repo | Mandatory; private repos are not judgeable |
| Vega OS testing | Requires a physical Fire TV Stick running Vega OS, or a virtual device |

The deadline and timeline live in `prd.md` §10 and `ARCHITECTURE.md` §13. The README and
the MIT `LICENSE` required by NFR4 and NFR5 now both exist. See
[01-current-state](../03-repository/01-current-state.md).

## Related

- [01-requirements-index](./01-requirements-index.md) — functional requirements
- [05-security-and-services](../02-architecture/05-security-and-services.md) — security posture
