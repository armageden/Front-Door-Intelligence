**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §6 and §7, read directly. The Kiro Crew note was checked against both §7 and §15. The service table and the cost-guard claims were re-read against the working tree on 2026-10-02: `template.yaml` for what is and is not declared, `src/lib/bedrockClient.ts` for the token and temperature levers, and `src/lib/daySummary.ts` for the two summary caps. The three documented facts behind D027 — that `EstimatedCharges` must be enabled per account from the Billing console, that the metric lives only in us-east-1, and that it is estimated and published several times daily — were each read from the AWS CloudWatch billing-alarm documentation on 2026-10-02. No IAM role has been exercised and no budget has been created: there is no AWS account.

# Security and AWS services

Source: `ARCHITECTURE.md` §6 and §7. The mitigations are a mix: several are implemented,
and the two that are not are named below rather than left for the reader to guess.

## Security mitigations

| Concern | Mitigation | Status |
|---|---|---|
| Webhook forgery | HMAC-SHA256 signature verification on every request | **implemented** — `src/lib/signatureVerifier.ts` |
| Replay attacks | Idempotency table keyed on `request_id`, with TTL | **implemented** — `claimRequestId()` in `src/lib/dynamoClient.ts` |
| API key exposure | Environment variables; `.env.example` in repo; no secrets committed | **implemented** — `.env.example` exists with placeholder values only |
| Ring token expiration | Refresh token flow with retry logic | **implemented** — `src/lib/ringClient.ts`, unverified against the live API |
| Bedrock cost runaway | Max tokens = 80; temperature = 0.2; CloudWatch billing alarm | **implemented, as an AWS Budget** — the levers in `src/lib/bedrockClient.ts` and `src/lib/daySummary.ts`, the detection in `CostAlarmBedrockBudget`. §6 named a CloudWatch alarm; D027 records why a Budget instead |
| S3 snapshot privacy | Pre-signed URLs with 1-hour expiry; bucket not public | **implemented** — `PRESIGNED_URL_TTL_SECONDS = 3600` in `src/lib/overlayPush.ts` |
| IAM least privilege | Each Lambda has its own role with only the required permissions | **never verified** — no AWS account, so no role has been exercised |

Four of the seven map onto specific requirement IDs: signature verification is FR2,
the idempotency table is NFR2, environment variables are NFR3, and the pre-signed URL
rule is why
[03-api-contracts](./03-api-contracts.md) exposes `snapshot_url` rather than a raw key.

The Bedrock row is the only one with a cost dimension, and it now has both halves. The
levers: `MAX_TOKENS = 80` and `TEMPERATURE = 0.2` in `src/lib/bedrockClient.ts`, plus two
caps of the summary's own — `SUMMARY_MAX_TOKENS = 400` and `MAX_CONTEXT_EVENTS = 200` —
because a second kind of call on the same model needs its own ceiling and §3.6's 2-3
sentences do not fit inside 80 tokens. The detection half is
`CostAlarmBedrockBudget` in `template.yaml`.

§6 named "CloudWatch billing alarm"; **an AWS Budget is declared instead**, which is a
deviation recorded as D027 rather than a substitution made quietly. The short reason is
that `EstimatedCharges` is off until a person enables it from the Billing console, which a
template cannot do — so the alarm this project would have shipped would sit permanently in
`INSUFFICIENT_DATA`. The budget is filtered to `Service: Amazon Bedrock` (an account-wide
budget would fire on the NAT gateway and tell the operator nothing), has no end date (AWS
deletes a budget *and its notifications* once one is set), and notifies on a **forecast**
crossing 80% as well as an actual crossing 100% — the forecast is the half that turns a
bill into a warning.

Its notifications sit behind a CloudFormation `Condition` on `CostAlarmEmail` being
non-empty, because AWS rejects an empty subscriber address. Deploy without the parameter and
the budget still exists and still tracks; it simply has nobody to tell. AWS also requires a
subscriber to confirm its address before delivery, so the first notification will not arrive
until that confirmation happens — worth knowing before concluding the alarm is broken. NFR7
asks for free-tier discipline; the default threshold of $10/month is well inside it.

**Not verified:** no account and no SAM CLI, so the budget has never been created and no
notification has ever been sent.

**The daily summary's role is read-and-write, and narrower than every other stage.** It
gets `dynamodb:Query` and `dynamodb:PutItem` on the events table and nothing else — no
`UpdateItem`, no `DeleteItem`, no `Scan`. A compromised summary job can therefore write one
row per day and cannot rewrite or remove an event. `GET /events/today` was narrowed the
same way when it gained the summary read: `dynamodb:Query` plus `dynamodb:GetItem`.

The repository **does** have a `.env.example`, with placeholder values only — NFR3 is
satisfied as a scaffold. An earlier version of this page said it did not exist; that
was true when written and was retired by the tooling phase. See
[01-current-state](../03-repository/01-current-state.md).

## AWS services in scope

| Service | Purpose | Mini-challenge |
|---|---|---|
| API Gateway (HTTP API) | Webhook ingress and REST endpoints | — |
| Lambda | All compute. Six functions in the plan, five handler files, **seven functions in `template.yaml`** — `bedrockDescriber` was folded into the describe stage by D018, and `$connect` / `$disconnect` are separate functions on the same source file | — |
| DynamoDB | Event store and idempotency | — |
| Amazon Bedrock | AI description generation | AWS Builder |
| S3 | Snapshot storage | — |
| EventBridge | Scheduled daily summary. **Declared** in `template.yaml` as a `ScheduleV2` event | — |
| AWS Budgets | Bedrock spend guard — §6's cost-runaway detection half. **Declared**, filtered to the Bedrock service | — |
| CloudWatch | Logs and metrics. Alarms are **not** used for the cost guard, for three mechanical reasons — see D027 | — |
| SES | Optional daily summary email. **Not implemented**; §3.6 calls it optional and it needs a verified identity this stack does not have | — |
| WebSocket API | Real-time overlay push to Fire TV | — |

Amazon Bedrock is the single service carrying a mini-challenge, so it is the one that
must be documented for the AWS Builder qualification.

### Kiro Crew note

`ARCHITECTURE.md` §7 states that if Kiro Crew is used during development, it must be
documented in the Friction Log and the README, and that building with Kiro Crew alone
qualifies for the AWS Builder mini-challenge.

## Related

- [04-data-store](./04-data-store.md) — what is being protected
- [02-pipeline-components](./02-pipeline-components.md) — where the mitigations live
