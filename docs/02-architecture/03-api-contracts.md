**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §5.1 and §5.2, read directly, including the exact request and response JSON. The optional `/mcp` endpoint reference was checked against §9.2.

# API contracts

> ## 🔴 This contract is WRONG against the real Ring API
>
> Verified against `https://developer.amazon.com/docs/ring/api-documentation.html` on
> 2026-09-28. **The payload below is wrong in 6 of 9 fields** and the snapshot call in
> §3.2 of the architecture spec does not exist. The corrected facts are in
> [04-ring-api-findings](../05-hackathon-requirements/04-ring-api-findings.md).
>
> The most dangerous single error: **webhook `sub_type` is flat** (`human`, `vehicle`,
> `motion`, `other_motion`). The `motion.human` form below belongs to the *Event
> History* query parameter — a different API surface. Code matching
> `sub_type === "motion.human"` matches nothing, ever.
>
> This page deliberately still describes **`ARCHITECTURE.md` §5 as written**, because
> rewriting the project's own spec is an author decision. Read it as a record of what
> the spec says, not as a contract to implement.

**Verified against:** `ARCHITECTURE.md` §5.1, §5.2, §9.2 and §3.5, read directly. Cross-checked against the official Ring API documentation — see the warning above. The contract below is the specification as written, not the real API.

Source: `ARCHITECTURE.md` §5. **Both endpoints are implemented** — `POST /webhook/ring`
by `src/handlers/webhookHandler.ts` and `GET /events/today` by
`src/handlers/eventQuery.ts`.

This page records the specification as written — see the warning above for which parts
of it the Ring API does not support. Two gaps between §5.2 and the implementation are
recorded as decisions rather than silently resolved:

- **§5.2 names no auth mechanism** for `GET /events/today`, and §6's mitigation table
  omits it. A static `X-Query-Key` was added — decision D022.
- **§5.2 shows `"event_type": "motion.human"`**, which is wrong twice: `motion_detected`
  is what the webhook sends for `type`, and `human` is the flat `sub_type`. The
  implementation returns both fields under their real names — decision D023.

Two endpoints are defined. Anything else referenced elsewhere in the design — the
optional MCP endpoint at `/mcp`, for example — is mentioned in passing by
`ARCHITECTURE.md` §9.2 and has no contract here.

## `POST /webhook/ring`

### Request headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Signature` | HMAC-SHA256 hex digest |

### Request body

```json
{
  "request_id": "req_xyz789",
  "event_type": "motion",
  "data": {
    "id": "evt_abc123",
    "device_id": "front_door_cam",
    "device_name": "Front Door",
    "attributes": {
      "sub_type": "motion.human"
    },
    "created_at": "2026-10-15T14:32:00Z"
  }
}
```

The `sub_type` field inside `data.attributes` is the only classification Ring sends —
no bounding boxes, no object labels. FR3 requires extracting it. The recognised values
are `motion.human`, `motion.vehicle`, `motion.other_motion`, `button_press`.

`request_id` is the idempotency key (NFR2); it is not the same field as the event `id`.

### Response (200)

```json
{
  "status": "accepted",
  "event_id": "evt_abc123"
}
```

Returned within 5 seconds (NFR1). The body echoes the event id under `data.id` from
the request.

## `GET /events/today`

### Response (200)

```json
{
  "date": "2026-10-15",
  "count": 3,
  "events": [
    {
      "event_id": "evt_abc123",
      "timestamp": "2026-10-15T14:32:00Z",
      "device_name": "Front Door",
      "event_type": "motion.human",
      "description": "Amazon delivery driver placed a medium box",
      "snapshot_url": "https://s3.amazonaws.com/.../evt_abc123.jpg"
    }
  ]
}
```

FR8 requires this endpoint to return all events for the current day. Note the field
naming difference against the stored item: the response exposes `snapshot_url`, while
the stored item in
[04-data-store](./04-data-store.md) holds `snapshot_s3_key`. The conversion happens at
the API boundary, and `ARCHITECTURE.md` §6 requires the resulting URL to be pre-signed
with a 1-hour expiry because the bucket is not public.

`count` duplicates the array length. No pagination parameters are specified for this
endpoint, because a single day of front-door events is assumed to be small.

## Related

- [02-pipeline-components](./02-pipeline-components.md) — who serves each endpoint
- [05-security-and-services](./05-security-and-services.md) — signature and URL mitigations
