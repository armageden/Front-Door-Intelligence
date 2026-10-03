/**
 * Daily summary stage: one day of door activity in 2-3 sentences. `ARCHITECTURE.md` §3.6.
 *
 * The only pipeline stage with no upstream trigger. Ingress is a webhook, the describe and
 * overlay stages are queues, and the query is an HTTP endpoint; this one is a clock. It
 * runs once a day, reads a date partition, and writes one row back into it.
 *
 * ## Which day it summarises, and why that is the hard part
 *
 * §3.6 says "daily at 9:00 PM local" over "all events for the current day". Two halves of
 * that sentence pull in opposite directions:
 *
 * - The **trigger** is genuinely local, and EventBridge Scheduler can say so —
 *   `ScheduleExpressionTimezone` evaluates the cron in a named zone, so
 *   `cron(0 21 * * ? *)` in `Europe/Berlin` really is 9 PM in Berlin.
 * - The **data** is a UTC partition (D014), and the read path already serves that
 *   partition (D023). For a zone at or ahead of UTC, 9 PM local lands inside the same UTC
 *   day, so the two agree. For a zone **behind** UTC — every US timezone — 9 PM local is
 *   the following UTC date, so the schedule would summarise a partition holding the first
 *   few hours of the local evening and file it under tomorrow's date.
 *
 * Rather than hide that, the deployed rule defaults to `UTC` — where the two agree — and
 * exposes the zone as a parameter whose description says what setting it to a western zone
 * costs. A caller can also name the partition outright with the rule's `Input`. The
 * residual problem is D025, not something this handler can fix: it is a stored-data
 * question, and answering it needs the account's timezone, which arrives with
 * `meta.account_id` and not with the webhook.
 *
 * ## Every run ends with a sentence
 *
 * The describe stage's rule holds here too: a silent failure produces an alert nobody
 * sees. If Bedrock is unavailable, the model returns nothing, or the day has no described
 * events to summarise, the deterministic sentence from `src/lib/daySummary.ts` is written
 * instead, with `summary_source: 'fallback'` and the reason. The row is overwritten on
 * every run, so a later successful run replaces it without a repair job.
 *
 * ## SES is not implemented
 *
 * §3.6's output line is "written to `EventsTable` as a `summary` item + optional email via
 * SES". The email is not built. It needs a verified SES identity, a destination address,
 * and an unsubscribe path, none of which the specification names and none of which can be
 * faked honestly in a repo with no account. The summary is readable through
 * `GET /events/today`, which is where the dashboard would read it from anyway.
 */

import type { EventBridgeEvent } from 'aws-lambda/trigger/eventbridge';

import {
  BEDROCK_MODEL_ENV,
  BedrockError,
  createBedrockClient,
} from '../lib/bedrockClient';
import { isPartitionDate, putSummary, queryEventsByDate, utcDate } from '../lib/dynamoClient';
import {
  buildSummaryContext,
  countDay,
  deterministicDaySummary,
  SUMMARY_MAX_TOKENS,
  SUMMARY_SYSTEM_PROMPT,
} from '../lib/daySummary';
import type { DaySummaryRecord, DoorEvent, SummarySource } from '../types';

/**
 * The invocation as the schedule delivers it.
 *
 * The EventBridge envelope, plus one field the envelope does not carry: `date`.
 * EventBridge Scheduler's `Input` property replaces the event text entirely, so a rule
 * configured with `Input: {"date": "2026-10-15"}` arrives as that object — which is how a
 * day the schedule missed, or one that predates a fix, is re-summarised. The deployed rule
 * sets no `Input`, so the field is absent in normal operation and the partition is derived
 * from the clock.
 */
export type SummaryInvocation = EventBridgeEvent<'Scheduled Event', Record<string, never>> & {
  readonly date?: string;
};

export interface SummaryDeps {
  /** Every event in one UTC partition, oldest first. */
  readonly loadEvents: (date: string) => Promise<DoorEvent[]>;
  readonly saveSummary: (record: DaySummaryRecord) => Promise<void>;
  /** Ask the model about the rendered day. Injected so no test needs a model. */
  readonly summarise: (text: string) => Promise<string>;
  /** For `generated_at`. Injected so the row's timestamp is assertable. */
  readonly now: () => Date;
  /** Recorded on the row when the model answered. */
  readonly modelId?: string;
}

export interface SummaryOutcome {
  readonly date: string;
  readonly source: SummarySource;
  readonly eventCount: number;
  /** Set when the deterministic path ran, and why. Absent on an AI summary. */
  readonly reason?: string;
}

/**
 * Which partition to summarise.
 *
 * An explicit `date` wins, because re-running one day is a real operation. A malformed one
 * **throws** rather than falling back to today: the only way this field is ever set is a
 * person editing the schedule, and quietly summarising a different day than the one they
 * asked for is the failure this repository keeps refusing to allow — the same reasoning as
 * `GET /events/today` returning 400 `invalid_date` instead of guessing.
 */
export function resolveSummaryDate(
  invocation: SummaryInvocation | undefined,
  fallback: string,
): string {
  const requested = invocation?.date;
  if (requested === undefined) return fallback;
  if (!isPartitionDate(requested)) {
    throw new Error(`Summary invocation carried a malformed date: ${requested}`);
  }
  return requested;
}

/**
 * Summarise one partition and write the row.
 *
 * Exported separately from the handler so the whole decision tree — model, no model, no
 * events, no descriptions, storage failure — is testable with no schedule, no table, and
 * no model. Mirrors `describeEvent()` in the describe stage.
 */
export async function generateDaySummary(
  date: string,
  deps: SummaryDeps,
): Promise<SummaryOutcome> {
  const events = await deps.loadEvents(date);
  const counts = countDay(events);

  let text: string;
  let source: SummarySource;
  let reason: string | undefined;

  if (counts.described === 0) {
    // The model would be given timestamps, event types, and nothing else — and the
    // deterministic sentence already states those counts exactly. Skipping the call is
    // both cheaper and more honest than letting a model narrate an empty list.
    text = deterministicDaySummary(date, events);
    source = 'fallback';
    reason = counts.total === 0 ? 'no events recorded' : 'no event had a description yet';
  } else {
    try {
      const answer = await deps.summarise(buildSummaryContext(date, events));
      if (answer.trim().length === 0) {
        text = deterministicDaySummary(date, events);
        source = 'fallback';
        reason = 'model returned no text';
      } else {
        text = answer.trim();
        source = 'ai';
      }
    } catch (error) {
      const why = error instanceof BedrockError ? 'bedrock unavailable' : `bedrock error: ${messageOf(error)}`;
      text = deterministicDaySummary(date, events);
      source = 'fallback';
      reason = why;
    }
  }

  const record: DaySummaryRecord = {
    date,
    summary: text,
    summary_source: source,
    event_count: counts.total,
    counts_by_sub_type: { ...counts.bySubType },
    generated_at: deps.now().toISOString(),
    // Absent rather than undefined on a fallback: `exactOptionalPropertyTypes` makes the
    // difference load-bearing, and "which model wrote this" must have no answer there.
    ...(source === 'ai' && deps.modelId !== undefined ? { model: deps.modelId } : {}),
  };

  // A failed write propagates. EventBridge Scheduler retries on a thrown error, and a
  // summary that was computed but not stored has to be recomputed rather than lost — the
  // whole run is one read plus one write, so there is nothing expensive to repeat.
  await deps.saveSummary(record);

  return {
    date,
    source,
    eventCount: counts.total,
    ...(reason !== undefined ? { reason } : {}),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Scheduled entry point.
 *
 * Returns nothing and throws on failure, which is what EventBridge Scheduler needs: a
 * failed invocation is retried, and a returned value is discarded.
 */
export const handler = async (invocation?: SummaryInvocation): Promise<void> => {
  const date = resolveSummaryDate(invocation, utcDate());
  const modelId = process.env[BEDROCK_MODEL_ENV];

  const deps: SummaryDeps = {
    loadEvents: (target) => queryEventsByDate(target),
    saveSummary: (record) => putSummary(record),
    now: () => new Date(),
    // Omitted rather than passed as undefined, so the throw below names the missing
    // variable instead of failing as an unrelated model-not-found error.
    ...(modelId !== undefined ? { modelId } : {}),
    summarise: (text) =>
      createBedrockClient({
        modelId: modelId ?? requireEnv(BEDROCK_MODEL_ENV),
        region: process.env['AWS_REGION'] ?? 'us-east-1',
      }).summariseText(text, { system: SUMMARY_SYSTEM_PROMPT, maxTokens: SUMMARY_MAX_TOKENS }),
  };

  const outcome = await generateDaySummary(date, deps);
  console.log('daily summary written', {
    date: outcome.date,
    source: outcome.source,
    event_count: outcome.eventCount,
    // A fallback is a degraded result, not an error, so it is logged at warn level and
    // still counts as a successful run.
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
  });
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
