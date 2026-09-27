**Back:** [00-overview](./00-overview.md)

**Verified against:** `ARCHITECTURE.md` §5.1 and §5.2, read directly, including the exact request and response JSON. The optional `/mcp` endpoint reference was checked against §9.2.

# API contracts

Source: `ARCHITECTURE.md` §5. Both endpoints are **specified, not implemented**.

Two endpoints are defined. Anything else you find referenced elsewhere in the design —
the optional MCP endpoint at `/mcp`, for example — is mentioned in passing by
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
