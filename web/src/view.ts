/**
 * Turning a `TodayResponse` into text. Pure, DOM-free, and therefore the part that gets
 * unit-tested.
 *
 * The dashboard's job is to be honest about what it does not know, and almost every string
 * below exists for that reason. An event with no description is still an event, so it is
 * shown rather than hidden; a summary written by the deterministic fallback says so, so a
 * homeowner never reads machine counts as though they were a sentence the model wrote.
 */

import type { TodayEvent, TodayResponse, TodaySummary } from './api';

/** `14:32 UTC` — the timestamp as stored. Not local time: see the note in `formatClock`. */
export function formatClock(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const hours = String(parsed.getUTCHours()).padStart(2, '0');
  const minutes = String(parsed.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes} UTC`;
}

/**
 * What this event is called in the UI.
 *
 * `sub_type` when there is one, otherwise the event type with the underscore turned into a
 * space. The dotted form the spec uses (`motion.human`) never appears, because the webhook
 * does not send it and matching it would produce an empty label for every event.
 */
export function formatSubtype(event: TodayEvent): string {
  if (event.sub_type !== undefined && event.sub_type.length > 0) return event.sub_type;
  return event.event_type.replace(/_/g, ' ');
}

/** The description, or an honest note that there is not one yet. */
export function formatDescription(event: TodayEvent): string {
  if (event.description !== null && event.description.trim().length > 0) {
    return event.description;
  }
  if (!event.processed) return 'Being described…';
  return 'No description was stored for this event.';
}

/**
 * The device, or an honest note that the pipeline never resolved one.
 *
 * `device_name` is absent on every event stored so far: the Ring API sends no device name
 * in any webhook, it has to be resolved via `GET /v1/devices/{id}`, and no stage calls that
 * yet. The response carries no device id either, deliberately, so this returns the fallback
 * rather than pretending to know which camera it was.
 */
export function formatDevice(event: TodayEvent): string {
  return event.device_name ?? 'Unknown device';
}

/** One line for the empty case, distinguishing "nothing happened" from "not asked yet". */
export function formatEmptyDay(response: TodayResponse): string {
  if (response.count === 0) {
    return `Nothing was recorded on ${response.date}.`;
  }
  return `No events to show for ${response.date}, although the day reported ${response.count}.`;
}

/**
 * The day's summary, or the reason there is not one.
 *
 * A `fallback` source is labelled as such. The deterministic sentence is a truthful count of
 * a day, and reading it as a model's account would be a small misreading that compounds —
 * a homeowner would come to trust the prose in a way the system does not promise.
 */
export function formatSummary(summary: TodaySummary | null): string | null {
  if (summary === null) {
    return 'No daily summary yet. It is generated at 9 PM.';
  }
  if (summary.source === 'fallback') {
    return `${summary.summary} (Counts only — the model was unavailable.)`;
  }
  return summary.summary;
}

/**
 * A one-line status for the header.
 *
 * `truncated` is called out whenever it is true, because a capped response otherwise looks
 * like a complete one — the same reason the response carries the flag at all.
 */
export function formatHeader(response: TodayResponse): string {
  const parts = [`${response.count} event${response.count === 1 ? '' : 's'} on ${response.date}`];
  if (response.truncated) parts.push('showing the first 200 only');
  const pending = response.events.filter((e) => !e.processed).length;
  if (pending > 0) parts.push(`${pending} still being described`);
  return parts.join(' · ');
}

/** Sort newest first, the order a timeline is read in. Does not mutate the input. */
export function timelineOrder(events: readonly TodayEvent[]): TodayEvent[] {
  return [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}