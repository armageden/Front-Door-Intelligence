/**
 * Event query stage: `GET /events/today`. FR8.
 *
 * The read side of the pipeline, and the first endpoint a person rather than Ring
 * calls. `ARCHITECTURE.md` §4.2 puts it in front of a dashboard timeline; the Fire TV
 * path never reads the table, it is pushed to.
 *
 * ## What this endpoint needs that the webhook did not
 *
 * `POST /webhook/ring` is authenticated by an HMAC signature over the body — Ring holds
 * the secret and we never have to issue or check a caller identity. This endpoint has no
 * such partner, so **something has to decide who may read a homeowner's door activity**.
 * The spec is silent: §5.2 and §4.2 describe the endpoint without naming an auth
 * mechanism, and §6's mitigation table does not mention it.
 *
 * The gap is closed here with a required static key in `X-Query-Key`, checked in constant
 * time. That is the minimum that makes the endpoint safe to ship, and it is recorded as a
 * decision (D022) because it is a design choice the spec did not make. It is not good
 * enough for a real multi-user product — see the note on `authorize` below.
 *
 * ## Why "today" is UTC and overridable
 *
 * The events table is partitioned by a **UTC** `date` (D014), and that is the only
 * partition a `Query` can address cheaply. A homeowner's local day is what "today" means
 * in the product, and the two disagree for part of every day.
 *
 * Rather than guess, this endpoint takes an explicit `?date=YYYY-MM-DD` and defaults to
 * the UTC date. A client that cares about local time asks for the partition it wants.
 * Silently serving the UTC day and calling it "today" would be the kind of quiet
 * incorrectness that is much harder to notice than a documented limitation.
 *
 * ## The day's summary comes back too
 *
 * `ARCHITECTURE.md` §3.6 writes a summary into the same partition this endpoint reads, and
 * the response now carries it. That is an addition to §5.2, not a correction: without it
 * the summary would be written once a day and never read by anything.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { timingSafeEqual } from 'node:crypto';

import { isPartitionDate, queryEventsByDate, querySummary, utcDate } from '../lib/dynamoClient';
import { createSnapshotPresigner } from '../lib/overlayPush';
import { SNAPSHOT_BUCKET_ENV } from '../lib/snapshotStore';
import type { DaySummaryItem, DoorEvent } from '../types';

/** `QUERY_API_KEY`, the shared secret guarding this endpoint. D022. */
export const QUERY_KEY_ENV = 'QUERY_API_KEY';
/** `QUERY_KEY_HEADER`, sent as `X-Query-Key`. */
export const QUERY_KEY_HEADER = 'x-query-key';

/**
 * Cap on returned events, to bound the response below API Gateway's payload limit.
 *
 * Not in `ARCHITECTURE.md` §5.2. A `Query` follows `LastEvaluatedKey` to the end of the
 * partition, so without a ceiling a pathological day could produce a response API Gateway
 * rejects — turning a data problem into a 502 the caller cannot act on. When the cap
 * bites, the response says so via `truncated` rather than reporting a `count` that is
 * quietly wrong.
 */
export const MAX_EVENTS = 200;

/** One event in the §5.2 response, with the two corrections that shape needs. */
export interface TodayEvent {
  readonly event_id: string;
  readonly timestamp: string;
  readonly device_name?: string;
  /** Ring's coarse event type, e.g. `motion_detected`. */
  readonly event_type: string;
  /**
   * Ring's flat subtype, e.g. `human`.
   *
   * `ARCHITECTURE.md` §5.2 has no such field and shows `"event_type": "motion.human"`,
   * which is wrong twice: `motion_detected` is what the webhook actually sends for
   * `type`, and `human` is the `sub_type`. Conflating them loses the distinction the rest
   * of the pipeline is built on, so both are returned under their real names.
   */
  readonly sub_type?: string;
  /**
   * `null` while the describe stage is still pending.
   *
   * An event that happened is still an event, so it appears even before it has a
   * sentence. Hiding it would make the timeline disagree with reality for exactly as long
   * as the queue is behind.
   */
  readonly description: string | null;
  /** `null` when no snapshot was stored, e.g. an event whose fetch failed. */
  readonly snapshot_url: string | null;
  /** Whether the describe stage has finished. Drives a "pending" row in the UI. */
  readonly processed: boolean;
}

export interface TodaySummary {
  /** The 2-3 sentences from `ARCHITECTURE.md` §3.6. */
  readonly summary: string;
  /** `fallback` means the deterministic sentence, not the model. */
  readonly source: 'ai' | 'fallback';
  /** Events the summary was built from, which is not always `count`. */
  readonly event_count: number;
  readonly generated_at: string;
}

export interface TodayResponse {
  /** The UTC partition that was actually queried. */
  readonly date: string;
  readonly count: number;
  /** True when `MAX_EVENTS` cut the partition short. */
  readonly truncated: boolean;
  readonly events: readonly TodayEvent[];
  /**
   * The day's summary, or `null` before `ARCHITECTURE.md` §3.6 has run.
   *
   * **An addition to §5.2**, which specifies no such field. It is here because §3.6 writes
   * the summary into the same partition this endpoint reads, and nothing else in the system
   * would ever show it — a stored feature with no reader. The field is additive: a client
   * that ignores it sees exactly the §5.2 response, and `null` is the honest answer for
   * the part of every day before the schedule fires.
   */
  readonly summary: TodaySummary | null;
}

export interface QueryDeps {
  readonly loadEvents: (date: string) => Promise<DoorEvent[]>;
  readonly loadSummary: (date: string) => Promise<DaySummaryItem | undefined>;
  readonly presign: (key: string) => Promise<string>;
  readonly today: () => string;
  readonly maxEvents?: number;
  /** Injected in tests. Defaults to comparing against `QUERY_API_KEY`. */
  readonly authorize?: (presented: string | undefined) => boolean;
}

/**
 * Constant-time comparison of the presented key.
 *
 * `timingSafeEqual` throws on a length mismatch, so a wrong-length key is rejected
 * before the call rather than inside it — otherwise a short key would take a different
 * path and leak its own length. Comparing a digest instead would avoid the branch
 * entirely; at this size, rejecting on length first is enough to remove the leak.
 */
function matchesKey(expected: string, presented: string | undefined): boolean {
  if (presented === undefined || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

function defaultAuthorize(presented: string | undefined): boolean {
  const expected = process.env[QUERY_KEY_ENV];
  if (!expected) {
    // Misconfiguration, not an attack. Fail closed: an endpoint that cannot decide who
    // is allowed must not decide that everyone is.
    throw new Error(`Missing required environment variable: ${QUERY_KEY_ENV}`);
  }
  return matchesKey(expected, presented);
}

/**
 * Build the §5.2 response from stored events.
 *
 * Split out from the handler so the response shape is testable with no API Gateway event
 * and no AWS, matching how `ingest` and `deliverEvent` are separated from their handlers.
 */
export async function buildTodayResponse(
  date: string,
  events: readonly DoorEvent[],
  presign: (key: string) => Promise<string>,
  maxEvents: number = MAX_EVENTS,
  summary: DaySummaryItem | null = null,
): Promise<TodayResponse> {
  const truncated = events.length > maxEvents;
  const page = truncated ? events.slice(0, maxEvents) : events;

  const mapped = await Promise.all(
    page.map(async (event): Promise<TodayEvent> => {
      // An event whose snapshot was never stored has no key to sign. Reporting `null` is
      // the honest answer; a signed URL to a missing object would 404 in the client.
      const snapshot_url =
        event.snapshot_s3_key === undefined ? null : await presign(event.snapshot_s3_key);
      return {
        event_id: event.event_id,
        timestamp: event.timestamp,
        ...(event.device_name !== undefined ? { device_name: event.device_name } : {}),
        event_type: event.event_type,
        ...(event.sub_type !== undefined ? { sub_type: event.sub_type } : {}),
        description: event.description ?? null,
        snapshot_url,
        processed: event.processed,
      };
    }),
  );

  return {
    date,
    count: mapped.length,
    truncated,
    events: mapped,
    summary:
      summary === null
        ? null
        : {
            summary: summary.summary,
            source: summary.summary_source,
            event_count: summary.event_count,
            generated_at: summary.generated_at,
          },
  };
}

/**
 * `YYYY-MM-DD`, or `undefined` when the parameter is not that shape.
 *
 * The rule itself lives in `isPartitionDate`, shared with the daily-summary backfill, so
 * a date that is well formed but impossible is rejected the same way everywhere rather
 * than in one call site.
 */
function parseDateParam(raw: string | undefined): string | undefined {
  if (raw === undefined || !isPartitionDate(raw)) return undefined;
  return raw;
}

/** Header lookup. API Gateway lowercases header names, but be tolerant of either casing. */
function headerValue(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const source = event.headers ?? {};
  return Object.entries(source).find(([key]) => key.toLowerCase() === name)?.[1];
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Run the query. Returns a status and a body rather than throwing, for testability. */
export async function queryToday(
  presentedKey: string | undefined,
  params: { date?: string },
  deps: QueryDeps,
): Promise<{ statusCode: number; body: TodayResponse | { status: string } }> {
  const authorize = deps.authorize ?? defaultAuthorize;
  if (!authorize(presentedKey)) return { statusCode: 401, body: { status: 'unauthorized' } };

  // An explicit but malformed `?date=` is a client bug and is reported as one. Falling
  // back to today would hide it behind a plausible-looking response.
  const requested = params.date === undefined ? undefined : parseDateParam(params.date);
  if (params.date !== undefined && requested === undefined) {
    return { statusCode: 400, body: { status: 'invalid_date' } };
  }

  const date = requested ?? deps.today();
  const events = await deps.loadEvents(date);
  // Read alongside the events rather than instead of them: the summary is a Get on a
  // known key, so a failure to read it is a missing convenience field, not a failed query.
  let summary = null;
  try {
    summary = (await deps.loadSummary(date)) ?? null;
  } catch (error) {
    console.warn('could not read the daily summary', {
      date,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const body = await buildTodayResponse(date, events, deps.presign, deps.maxEvents, summary);
  return { statusCode: 200, body };
}

/** Lambda entry point for `GET /events/today`. */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const bucket = process.env[SNAPSHOT_BUCKET_ENV] ?? '';
  const deps: QueryDeps = {
    loadEvents: (date) => queryEventsByDate(date),
    loadSummary: (date) => querySummary(date),
    presign: createSnapshotPresigner(bucket),
    today: () => utcDate(),
  };

  try {
    const result = await queryToday(headerValue(event, QUERY_KEY_HEADER), event.queryStringParameters ?? {}, deps);
    return json(result.statusCode, result.body);
  } catch (error) {
    // A missing table variable or an unreachable DynamoDB is a 5xx, not a 4xx: the
    // caller did nothing wrong and retrying is reasonable.
    console.error('event query failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(500, { status: 'error' });
  }
}
