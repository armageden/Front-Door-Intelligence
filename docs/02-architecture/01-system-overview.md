**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §1, §2, §3.1, §3.7, §4.1 and §4.2, read directly. No code implements any part of this flow, so every behavioural statement is spec-derived.

# System overview

Source: `ARCHITECTURE.md` §1, §2, §4.

## Shape

| Field | Value |
|---|---|
| Architecture style | Event-driven serverless pipeline with optional cross-track adapters |
| Cloud provider | AWS |
| Primary track | Ring |
| Mini-challenges | AWS Builder, Open Source |

The pipeline is deliberately **linear and debuggable** because the submission must be
live and demoable. Every component has a fallback so the pipeline never fails silently.

## System context

External actors: Ring camera (webhook source), Fire TV app on Vega OS, and the optional
Alexa+ and Bee integrations.

AWS components: API Gateway (HTTP API), six Lambda functions, two DynamoDB tables, S3,
Amazon Bedrock, EventBridge, and a WebSocket API for overlay delivery.

The full Mermaid source diagram is `ARCHITECTURE.md` §2. It is not duplicated here
because it will drift; read it there.

## Flow 1 — real-time event (happy path)

`ARCHITECTURE.md` §4.1. In order:

1. Ring camera detects motion.
2. Ring Partner API sends a webhook POST.
3. API Gateway routes to the webhook handler Lambda.
4. The handler verifies the HMAC-SHA256 signature, checks idempotency in DynamoDB, and
   parses the event subtype out of `data.attributes`.
5. The snapshot fetcher calls the Ring API and stores the base64 JPEG.
6. The Bedrock describer sends snapshot plus system prompt to the model and receives a
   one-sentence description.
7. The overlay pusher sends a WebSocket message to the Fire TV app, stores the event in
   DynamoDB, and uploads the snapshot to S3.
8. The Fire TV app displays the picture-in-picture overlay.

Step 4 is where NFR1 is met: the handler acknowledges, and steps 5–7 continue behind
it. The per-component detail is in
[02-pipeline-components](./02-pipeline-components.md).

## Flow 2 — query (dashboard)

`ARCHITECTURE.md` §4.2. The user opens the web dashboard, which calls
`GET /events/today`; the event query Lambda reads DynamoDB by the current date and
returns a JSON array that the dashboard renders as a timeline.

## Two constraints that shape everything

**Ring webhooks carry no object detail.** `ARCHITECTURE.md` §3.1 states that the Ring
Partner API sends only a coarse `sub_type` inside `data.attributes` — there are no
bounding boxes and no object labels. The webhook handler must normalise the payload into
a structured event object before passing it downstream.

**One app, one primary track.** `ARCHITECTURE.md` §3.7 makes Alexa+ and Bee optional
adapters within the Ring entry, never separate track entries. This is restated in the
requirements subject at
[01-requirements-index](../01-product/01-requirements-index.md#54-optional-cross-track-integration).

## Related

- [03-api-contracts](./03-api-contracts.md) — the wire formats
- [06-design-decisions](./06-design-decisions.md) — why SNS and KeplerCaptionsView were dropped
