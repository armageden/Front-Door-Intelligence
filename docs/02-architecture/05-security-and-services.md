**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §6 and §7, read directly. The Kiro Crew note was checked against both §7 and §15.

<!-- docs-check:expect-absent .env.example -->

# Security and AWS services

Source: `ARCHITECTURE.md` §6 and §7. All mitigations below are **specified, not
implemented**.

## Security mitigations

| Concern | Mitigation |
|---|---|
| Webhook forgery | HMAC-SHA256 signature verification on every request |
| Replay attacks | Idempotency table keyed on `request_id`, with TTL |
| API key exposure | Environment variables; `.env.example` in repo; no secrets committed |
| Ring token expiration | Refresh token flow with retry logic |
| Bedrock cost runaway | Max tokens = 80; temperature = 0.2; CloudWatch billing alarm |
| S3 snapshot privacy | Pre-signed URLs with 1-hour expiry; bucket not public |
| IAM least privilege | Each Lambda has its own role with only the required permissions |

Four of the seven map onto specific requirement IDs: signature verification is FR2,
the idempotency table is NFR2, environment variables are NFR3, and the pre-signed URL
rule is why
[03-api-contracts](./03-api-contracts.md) exposes `snapshot_url` rather than a raw key.

The Bedrock row is the only one with a cost dimension — 80 max tokens and temperature
0.2 are the two levers, and the CloudWatch billing alarm is the detection half. NFR7
asks for free-tier discipline, which this satisfies.

The repository has no `.env.example` yet, though the design calls for one. NFR3 is
therefore not yet satisfied even as a scaffold. See
[01-current-state](../03-repository/01-current-state.md).

## AWS services in scope

| Service | Purpose | Mini-challenge |
|---|---|---|
| API Gateway (HTTP API) | Webhook ingress and REST endpoints | — |
| Lambda | All compute, 6 functions | — |
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
