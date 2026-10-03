/**
 * Shared types for the Front Door Intelligence pipeline.
 *
 * The webhook types below are modelled on the **real** Ring Partner API, not on
 * `ARCHITECTURE.md` §5.1, which is wrong in six of nine fields. Verified against
 * https://developer.amazon.com/docs/ring/api-documentation.html on 2026-09-28; see
 * docs/05-hackathon-requirements/04-ring-api-findings.md.
 *
 * Where the two disagree, this file follows the API and the docs record the conflict.
 * Do not "fix" this file to match the architecture document.
 */

/* ------------------------------------------------------------------ Ring webhook */

/**
 * `meta` object. Version is `"1.1"` normatively, but the official documentation's
 * own example and the reference starter's simulator both emit `"1.0"` — and `1.0`
 * carries **no** `account_id`. Accept both and never assume the field is present.
 */
export interface RingWebhookMeta {
  version: string;
  /** ISO 8601 event time. */
  time: string;
  /** Idempotency key. Sits at `meta.request_id`, not at the top level. */
  request_id: string;
  /**
   * The Ring account this event belongs to. Absent in `1.0`. Required to look up
   * that user's tokens and to key storage per user.
   */
  account_id?: string;
}

/**
 * Webhook `sub_type`, **flat**.
 *
 * The documented values are `motion`, `human`, `vehicle`, `other_motion`. The
 * dotted forms seen elsewhere in Ring's API (`motion.human`, `motion.vehicle`) are
 * `event_types` values for the **Event History** query parameter — a different
 * surface. Matching `"motion.human"` here matches nothing, ever.
 *
 * Typed as `string` rather than a union on purpose: the webhook table and the
 * Event History table disagree about whether `animal` exists, so this is an open set.
 */
export type RingSubType = string;

export const KNOWN_SUB_TYPES = ['motion', 'human', 'vehicle', 'other_motion'] as const;

export interface RingWebhookAttributes {
  /** **Device id.** This is the field the architecture document calls `device_id`. */
  source: string;
  /** Always `"devices"` for device-originated events. */
  source_type: string;
  /** Epoch milliseconds. Use this, not `timestamp_readable`, for any calculation. */
  timestamp: number;
  /** Human-readable local time with **no timezone offset**. Logging only. */
  timestamp_readable?: string;
  /** Flat classification. Absent on `button_press`. */
  sub_type?: RingSubType;
  /** Which camera module. Needed for multi-camera devices. */
  component_ids?: string[];
}

export interface RingWebhookRelationships {
  devices?: { links?: { self?: string } };
}

/** Event types Ring actually sends. `person_detected` is not among them. */
export const RING_EVENT_TYPES = [
  'motion_detected',
  'button_press',
  'device_added',
  'device_removed',
  'device_online',
  'device_offline',
  'app_integration_added',
  'app_integration_removed',
  'subscription_activated',
  'subscription_deactivated',
] as const;

export type RingEventType = (typeof RING_EVENT_TYPES)[number];

export interface RingWebhookData {
  /**
   * Composite **event** id, shaped `<device_id>_<sub_type>_<timestamp>`.
   * This is not a device id — using it in a device API call produces a 404.
   */
  id: string;
  type: RingEventType | string;
  attributes: RingWebhookAttributes;
  relationships?: RingWebhookRelationships;
}

export interface RingWebhookPayload {
  meta: RingWebhookMeta;
  data: RingWebhookData;
}

/* --------------------------------------------------- normalised internal event */

/**
 * The project's own event shape, stored in the events table.
 *
 * Field names and the table key design come from `ARCHITECTURE.md` §3.5 and are
 * unchanged by the API corrections. `description`, `snapshot_s3_key`, and
 * `bedrock_model` are filled in by later pipeline stages, so they are optional
 * here and absent at ingress.
 */
export interface DoorEvent {
  /** Partition key, `YYYY-MM-DD`, **UTC**. See the D014 note in the decision log. */
  date: string;
  event_id: string;
  /** ISO 8601, from `meta.time`. */
  timestamp: string;
  /**
   * Epoch milliseconds from `data.attributes.timestamp`.
   *
   * This is what a snapshot request must be anchored to, and it is **not** derivable
   * from `timestamp`: Ring's `timestamp_readable` carries no timezone offset, and
   * re-deriving epoch ms from an ISO string risks an off-by-hours window. Carried
   * explicitly so the media request uses the device's own clock.
   */
  occurred_at_ms?: number;
  device_id: string;
  /** Resolved via `GET /v1/devices/{id}`; not present in the webhook payload. */
  device_name?: string;
  event_type: string;
  /** Flat `sub_type` when Ring supplied one. */
  sub_type?: RingSubType;
  /** The Ring account, needed to call the API on the user's behalf. */
  account_id?: string;
  description?: string;
  snapshot_s3_key?: string;
  bedrock_model?: string;
  latency_ms?: number;
  /** `false` until the description stage completes. */
  processed: boolean;
}

/* ----------------------------------------------------------------- daily summary */

/**
 * `ai` when the model wrote the sentence, `fallback` when the deterministic local path
 * ran. The same two values the describe stage records in `description_source`, kept
 * separate because they describe different text.
 */
export type SummarySource = 'ai' | 'fallback';

/**
 * What the daily-summary stage produces, before it becomes a table item.
 *
 * `ARCHITECTURE.md` §3.6 specifies the output as "written to `EventsTable` as a
 * `summary` item" and nothing else, so the counts and the provenance are this
 * repository's addition: without them a stored sentence cannot be told apart from a
 * deterministic one, and the homeowner cannot see how complete the day was.
 */
export interface DaySummaryRecord {
  /** The UTC partition that was summarised, `YYYY-MM-DD`. */
  date: string;
  /** The 2-3 sentences. Never empty — the fallback always produces a sentence. */
  summary: string;
  summary_source: SummarySource;
  /** How many events the summary was built from, before any cap. */
  event_count: number;
  /**
   * Counts per Ring `sub_type`, plus two buckets: `unspecified` for an event with no
   * `sub_type`, and `button_press` for the one event type that has none by design. The
   * values add up to `event_count`. See `countDay()` in `src/lib/daySummary.ts`.
   */
  counts_by_sub_type: Record<string, number>;
  /** ISO 8601, from the handler's own clock. */
  generated_at: string;
  /** The model that produced the text. Absent when the fallback ran. */
  model?: string;
}

/**
 * The stored row.
 *
 * `sort_key` is the fixed string `summary`, which puts this row **after** every event
 * in the same partition — ISO timestamps start with a digit, `s` sorts last — so a
 * chronological query does not have to filter it out to stay ordered.
 */
export interface DaySummaryItem extends DaySummaryRecord {
  sort_key: string;
  /** Literal, for a human reading the table. `isDoorEvent` is the actual guard. */
  item_type: 'summary';
}

/* ------------------------------------------------------------- ingress results */

export type IngressOutcome =
  | 'accepted'
  | 'duplicate'
  | 'unverified_signature'
  | 'malformed_payload'
  | 'unsupported_event';

/** What the handler resolves, before it is turned into an HTTP response. */
export interface IngressResult {
  outcome: IngressOutcome;
  statusCode: number;
  event?: DoorEvent;
  /** Human-readable reason. Log this; never echo it back to Ring. */
  detail?: string;
}
