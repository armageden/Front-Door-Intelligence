**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §6 and §7, read directly. The Kiro Crew note was checked against both §7 and §15.

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
| Bedrock cost runaway | Max tokens = 80; temperature = 0.2; CloudWatch billing alarm | **half** — the two levers are in `src/lib/bedrockClient.ts`; no alarm is declared in `template.yaml` |
| S3 snapshot privacy | Pre-signed URLs with 1-hour expiry; bucket not public | **implemented** — `PRESIGNED_URL_TTL_SECONDS = 3600` in `src/lib/overlayPush.ts` |
| IAM least privilege | Each Lambda has its own role with only the required permissions | **never verified** — no AWS account, so no role has been exercised |

Four of the seven map onto specific requirement IDs: signature verification is FR2,
the idempotency table is NFR2, environment variables are NFR3, and the pre-signed URL
rule is why
[03-api-contracts](./03-api-contracts.md) exposes `snapshot_url` rather than a raw key.

The Bedrock row is the only one with a cost dimension — 80 max tokens and temperature
0.2 are the two levers, and the CloudWatch billing alarm is the detection half. NFR7
asks for free-tier discipline, which this satisfies.

The repository **does** have a `.env.example`, with placeholder values only — NFR3 is
satisfied as a scaffold. An earlier version of this page said it did not exist; that
was true when written and was retired by the tooling phase. See
[01-current-state](../03-repository/01-current-state.md).

## AWS services in scope

| Service | Purpose | Mini-challenge |
|---|---|---|
| API Gateway (HTTP API) | Webhook ingress and REST endpoints | — |
| Lambda | All compute. Six functions in the plan, five in `template.yaml` — `bedrockDescriber` was folded into the describe stage by D018 | — |
| DynamoDB | Event store and idempotency | — |
| Amazon Bedrock | AI description generation | AWS Builder |
| S3 | Snapshot storage | — |
| EventBridge | Scheduled daily summary | — |
| CloudWatch | Logs, metrics, alarms | — |
| SES | Optional daily summary email | — |
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
