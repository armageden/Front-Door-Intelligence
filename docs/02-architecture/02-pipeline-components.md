**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §3.1–§3.4, §3.6 and §3.7, read directly. Section numbers are the source's own, not renumbered. Both prompts are quoted verbatim from §3.3 and §3.6. §3.5 is in `04-data-store.md` because it is a data contract, not a handler.

# Pipeline components

Source: `ARCHITECTURE.md` §3.1–§3.4, §3.6 and §3.7. All six functions are
**specified, not implemented** — the file layout they will occupy is recorded as
planned in [04-planned-structure](../03-repository/04-planned-structure.md).

§3.5, the DynamoDB event store, is documented separately in
[04-data-store](./04-data-store.md) because it is a data contract rather than a
handler. The section numbers below are the source's, not renumbered.

## 3.1 Webhook handler

| Property | Value |
|---|---|
| Trigger | Ring Partner API webhook |
| Endpoint | `POST /webhook/ring` |
| Auth | HMAC-SHA256 signature verification via `X-Signature` header |
| Idempotency | Store `request_id` in DynamoDB with TTL; reject duplicates |
| Response SLA | HTTP 200 within 5 seconds to avoid Ring retry storms |
| Event subtypes | `motion.human`, `motion.vehicle`, `motion.other_motion`, `button_press` |

This component enforces NFR1 and NFR2 — see
[02-non-functional-requirements](../01-product/02-non-functional-requirements.md).

## 3.2 Snapshot fetcher

| Property | Value |
|---|---|
| Trigger | Direct Lambda invoke from the webhook handler |
| Ring API call | `GET /camera/{id}/snapshot` with an OAuth bearer token |
| Token source | Ring Developer Playground (short-lived, ~30 min) or refresh token flow |
| Timeout | 4 seconds — must complete before the webhook response |
| Output | Base64-encoded JPEG in ephemeral Lambda storage, plus S3 (optional) |

The 4-second timeout is the tightest budget in the pipeline: it must finish inside the
5-second webhook SLA (NFR1) so the snapshot is available to the description step.

## 3.3 Bedrock describer

| Property | Value |
|---|---|
| Model | `anthropic.claude-3-haiku` or `amazon.nova-lite-v1` (cost-efficient) |
| Input | Base64 snapshot plus system prompt |
| Max tokens | 80 |
| Temperature | 0.2 (low creativity, factual) |
| Fallback | `"Person detected at Front Door"` or `"Motion detected at Front Door"` |

The system prompt, quoted verbatim from `ARCHITECTURE.md` §3.3:

> Describe only what is visible in this security camera snapshot. Use one sentence.
> Focus on: people, packages, vehicles, animals. Do not judge or label people. If
> nothing is identifiable, say 'Nothing identifiable.'

This prompt is the implementation of FR9 and FR10, and the fallback string is the
implementation of FR11.

**Safety boundary.** The model must not make judgments about people — no "suspicious
person". It describes actions and objects only. `ARCHITECTURE.md` §3.3 ties this to
Ring's priority categories of access control and caretaking.

## 3.4 Overlay pusher

| Property | Value |
|---|---|
| Protocol | WebSocket API (preferred), or the Fire TV app polling a local HTTP endpoint |
| Payload | `event_id`, `description`, `snapshot_url`, `timestamp`, `device_name` |
| Overlay behaviour | PiP appears, auto-dismiss after 15s, dismissible via remote |
| Vega OS API | Custom React Native overlay component; must not pause or interrupt playback |
| Vega compatibility | Vega OS is Linux-based, uses React Native with New Architecture (Turbo Native Modules), and does not recognise Android files |

"Does not recognise Android files" is the load-bearing constraint for anyone porting
an existing Android overlay — it is the correction noted in
[06-design-decisions](./06-design-decisions.md).

The 15-second auto-dismiss is FR14; "must not pause or interrupt current playback" is
FR12.

## 3.6 Daily summary generator

| Property | Value |
|---|---|
| Trigger | EventBridge scheduled rule, daily at 9:00 PM local |
| Input | All events for the current day from the events table |
| Output | Written to the events table as a `summary` item, plus optional SES email |

Bedrock prompt, quoted from `ARCHITECTURE.md` §3.6:

> Summarize today's front door activity in 2-3 sentences for a homeowner. Include:
> number of events, types (deliveries, visitors, vehicles), and any notable patterns.

## 3.7 Optional cross-track adapters

| Adapter | Technology | Purpose |
|---|---|---|
| Alexa+ MCP server | Self-hosted MCP server (spec 2025-11-25+, Streamable HTTP) | Expose `get_latest_door_event` as a voice tool |
| Bee context ingest | Bee CLI / MCP / Agent Skill | Trigger a "check front door" reminder when the user arrives home |

These are supporting integrations, not separate primary-track submissions.

## Related

- [03-api-contracts](./03-api-contracts.md) — the webhook payload this parses
- [04-data-store](./04-data-store.md) — where the events land
