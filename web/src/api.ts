/**
 * The web dashboard's data layer: talking to `GET /events/today`.
 *
 * ## Why this file has no `fetch` in it
 *
 * `fetchToday` takes its transport as an argument rather than calling the global. That is
 * what lets the whole file be unit-tested with no network, no browser, and no DOM — and it
 * is also what keeps the decision about how this app is rendered (plain DOM today, React
 * later) out of the file that decides what the data means.
 *
 * The types here are a **hand-mirrored copy** of `TodayResponse` in
 * `src/handlers/eventQuery.ts`, not an import: the handler runs on Node and this runs in a
 * browser, and a browser bundle must not pull in the AWS SDK to learn a field name. The
 * mirror is the cost of that separation, and it is a real one — if the handler's response
 * changes, this file does not know. The mitigation is `parseTodayResponse()`, which
 * validates the fields the rest of the UI depends on and throws naming which one was
 * wrong — `web/test/dashboard.test.ts` asserts those messages, and the demo fixture in
 * `web/src/demo.ts` re-parses through the same function, so drift surfaces as a failing
 * test rather than as an `undefined` in the browser.
 */

export interface TodayEvent {
  readonly event_id: string;
  readonly timestamp: string;
  readonly device_name?: string;
  readonly event_type: string;
  readonly sub_type?: string;
  readonly description: string | null;
  readonly snapshot_url: string | null;
  readonly processed: boolean;
}

export interface TodaySummary {
  readonly summary: string;
  readonly source: 'ai' | 'fallback';
  readonly event_count: number;
  readonly generated_at: string;
}

export interface TodayResponse {
  readonly date: string;
  readonly count: number;
  readonly truncated: boolean;
  readonly events: readonly TodayEvent[];
  readonly summary: TodaySummary | null;
}

/** The minimum of a fetch response this file uses. Keeps `lib: ["ES2022"]` sufficient. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<FetchResponseLike>;

/** Raised for any non-200, so the caller never has to inspect a status code. */
export class QueryError extends Error {
  readonly status: number;

  constructor(status: number, body: unknown) {
    // The server's own message is safe to surface and useful: a 401 says the key is wrong,
    // which is the single most likely thing to be wrong here.
    const detail =
      typeof body === 'object' && body !== null && 'status' in body
        ? String((body as { status: unknown }).status)
        : `HTTP ${status}`;
    super(`GET /events/today failed: ${detail}`);
    this.name = 'QueryError';
    this.status = status;
  }
}

/**
 * The endpoint URL for a base and an optional UTC date.
 *
 * The date is validated here rather than interpolated blindly, because a malformed value
 * produces a 400 whose message is far less clear than a local one. Mirrors
 * `isPartitionDate()` in `src/lib/dynamoClient.ts` — the same rule, deliberately, because a
 * client that accepts a date the server will reject has learned nothing.
 */
export function buildTodayUrl(base: string, date?: string): string {
  const root = base.replace(/\/+$/, '');
  if (date === undefined) return `${root}/events/today`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Date must be YYYY-MM-DD, got: ${date}`);
  }
  return `${root}/events/today?date=${encodeURIComponent(date)}`;
}

/** Narrow an unknown payload to `TodayResponse`, or explain why it is not one. */
export function parseTodayResponse(body: unknown): TodayResponse {
  if (typeof body !== 'object' || body === null) {
    throw new Error('GET /events/today returned a non-object body');
  }
  const candidate = body as Partial<TodayResponse>;
  if (typeof candidate.date !== 'string' || !Array.isArray(candidate.events)) {
    // The most likely cause by far is a body that never came from this project: a login
    // page, a proxy's 502 page, or an API Gateway error document. Naming the fields that
    // were missing turns "the dashboard is blank" into a diagnosable message.
    throw new Error(
      `GET /events/today body is not the expected response (date=${typeof candidate.date}, events=${Array.isArray(candidate.events) ? 'array' : typeof candidate.events})`,
    );
  }
  return {
    date: candidate.date,
    count: typeof candidate.count === 'number' ? candidate.count : candidate.events.length,
    truncated: candidate.truncated === true,
    events: candidate.events as readonly TodayEvent[],
    summary: (candidate.summary ?? null) as TodaySummary | null,
  };
}

/**
 * Fetch one day.
 *
 * The key goes in `X-Query-Key` and **never** in a query string, because a URL lands in
 * browser history, proxy logs, and `Referer` headers. This endpoint guards a homeowner's
 * door activity with that key (D022), so where it travels is a security property, not a
 * style choice.
 */
export async function fetchToday(
  fetchImpl: FetchLike,
  baseUrl: string,
  apiKey: string,
  date?: string,
): Promise<TodayResponse> {
  const response = await fetchImpl(buildTodayUrl(baseUrl, date), {
    headers: { 'X-Query-Key': apiKey },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new QueryError(response.status, body);
  return parseTodayResponse(body);
}