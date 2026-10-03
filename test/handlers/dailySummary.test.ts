/**
 * Tests for the daily-summary stage, `ARCHITECTURE.md` §3.6.
 *
 * The three behaviours that carry the most weight:
 *
 * 1. **A run always writes a row.** Bedrock erroring, the model returning nothing, the
 *    day being empty, the day being entirely undescribed — each of those ends in a stored
 *    sentence with `summary_source: 'fallback'` and a reason, never in silence. A summary
 *    that failed to generate is indistinguishable from a day that was not summarised.
 * 2. **The model is not called when it has nothing to work with.** An empty day, or a day
 *    where no event has a description yet, costs no tokens and says so instead of being
 *    narrated as a quiet day.
 * 3. **The partition is the one asked for, and a malformed date fails loudly.** A retried
 *    or hand-run invocation names its date; summarising a different day than the operator
 *    requested is the quiet wrongness this repository keeps refusing to write.
 *
 * No AWS, no network, no clock. Every dependency is injected.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  generateDaySummary,
  handler,
  resolveSummaryDate,
  type SummaryDeps,
  type SummaryInvocation,
} from '../../src/handlers/dailySummary';
import { BEDROCK_MODEL_ENV } from '../../src/lib/bedrockClient';
import { deterministicDaySummary } from '../../src/lib/daySummary';
import type { DaySummaryRecord, DoorEvent } from '../../src/types';

const DATE = '2026-02-13';
const MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
const SENTENCE = 'Three events today: one delivery, one visitor, and a car at the kerb.';

const EVENT: DoorEvent = {
  date: DATE,
  event_id: 'evt_abc123',
  timestamp: `${DATE}T13:39:57.200Z`,
  device_id: 'front_door_cam',
  device_name: 'Front Door',
  event_type: 'motion_detected',
  sub_type: 'human',
  description: 'A person places a medium box by the door',
  processed: true,
};

interface Harness {
  readonly deps: SummaryDeps;
  readonly saved: DaySummaryRecord[];
  readonly summarised: string[];
}

/**
 * An event with no `sub_type` key at all.
 *
 * Ring omits the key on `button_press` rather than sending null, and
 * `exactOptionalPropertyTypes` makes that difference load-bearing — so the fixture omits it
 * the same way instead of assigning `undefined`.
 */
function withoutSubType(overrides: Partial<DoorEvent> = {}): DoorEvent {
  const { sub_type: _omitted, ...rest } = { ...EVENT, ...overrides };
  return rest;
}

function harness(events: DoorEvent[], answer: string | Error = SENTENCE): Harness {
  const saved: DaySummaryRecord[] = [];
  const summarised: string[] = [];
  return {
    saved,
    summarised,
    deps: {
      loadEvents: async () => events,
      saveSummary: async (record) => {
        saved.push(record);
      },
      summarise: async (text) => {
        summarised.push(text);
        if (answer instanceof Error) throw answer;
        return answer;
      },
      now: () => new Date(`${DATE}T21:00:00.000Z`),
      modelId: MODEL,
    },
  };
}

describe('a successful run', () => {
  it('writes the model sentence and records that the model wrote it', async () => {
    const h = harness([EVENT]);
    const outcome = await generateDaySummary(DATE, h.deps);

    expect(outcome).toEqual({ date: DATE, source: 'ai', eventCount: 1 });
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]?.summary).toBe(SENTENCE);
    expect(h.saved[0]?.summary_source).toBe('ai');
    expect(h.saved[0]?.model).toBe(MODEL);
    expect(h.saved[0]?.event_count).toBe(1);
    expect(h.saved[0]?.generated_at).toBe(`${DATE}T21:00:00.000Z`);
  });

  it('gives the model the day, not the raw partition', async () => {
    const h = harness([EVENT, { ...EVENT, event_id: 'evt_2', sub_type: 'vehicle' }]);
    await generateDaySummary(DATE, h.deps);

    expect(h.summarised).toHaveLength(1);
    expect(h.summarised[0]).toContain('UTC date: 2026-02-13');
    expect(h.summarised[0]).toContain('Events recorded: 2');
  });

  it('stores the counts beside the sentence, so a client can see what it covered', async () => {
    const h = harness([EVENT, { ...withoutSubType({ event_id: 'evt_2' }), event_type: 'button_press' }]);
    await generateDaySummary(DATE, h.deps);

    expect(h.saved[0]?.counts_by_sub_type).toEqual({ human: 1, button_press: 1 });
    expect(h.saved[0]?.event_count).toBe(2);
  });

  it('trims the model answer and records no reason', async () => {
    const h = harness([EVENT], `  ${SENTENCE}\n`);
    const outcome = await generateDaySummary(DATE, h.deps);

    expect(h.saved[0]?.summary).toBe(SENTENCE);
    expect(outcome.reason).toBeUndefined();
  });
});

describe('every run ends in a sentence', () => {
  it('falls back when Bedrock errors, and says why', async () => {
    const h = harness([EVENT], new Error('bedrock: access denied'));
    const outcome = await generateDaySummary(DATE, h.deps);

    expect(outcome.source).toBe('fallback');
    expect(outcome.reason).toContain('bedrock');
    expect(h.saved[0]?.summary).toBe(deterministicDaySummary(DATE, [EVENT]));
  });

  it('falls back when the model returns nothing at all', async () => {
    const h = harness([EVENT], '   ');
    const outcome = await generateDaySummary(DATE, h.deps);

    expect(outcome.source).toBe('fallback');
    expect(outcome.reason).toBe('model returned no text');
    expect(h.saved[0]?.summary).not.toBe('');
  });

  it('writes an empty day without calling the model', async () => {
    const h = harness([]);
    const outcome = await generateDaySummary(DATE, h.deps);

    expect(h.summarised).toHaveLength(0);
    expect(outcome).toEqual({ date: DATE, source: 'fallback', eventCount: 0, reason: 'no events recorded' });
    expect(h.saved[0]?.summary).toBe('No activity was recorded on 2026-02-13 (UTC).');
  });

  it('does not narrate a day whose descriptions have not arrived', async () => {
    // The model would be given timestamps and nothing else, and would still produce a
    // confident paragraph. The counts are the honest answer here.
    const { description: _d, ...bare } = EVENT;
    const h = harness([{ ...bare, processed: false }]);
    const outcome = await generateDaySummary(DATE, h.deps);

    expect(h.summarised).toHaveLength(0);
    expect(outcome.reason).toBe('no event had a description yet');
    expect(h.saved[0]?.summary).toContain('still being described');
  });

  it('names no model on a fallback row', async () => {
    const h = harness([]);
    await generateDaySummary(DATE, h.deps);

    expect(h.saved[0]).not.toHaveProperty('model');
  });

  it('propagates a storage failure so the schedule retries', async () => {
    const h = harness([EVENT]);
    const failing: SummaryDeps = {
      ...h.deps,
      saveSummary: async () => {
        throw new Error('ProvisionedThroughputExceeded');
      },
    };

    await expect(generateDaySummary(DATE, failing)).rejects.toThrow(/Throughput/);
  });
});

describe('which partition gets summarised', () => {
  function invocation(overrides: Partial<SummaryInvocation> = {}): SummaryInvocation {
    return {
      id: 'evt-rule',
      version: '0',
      account: '123456789012',
      time: `${DATE}T21:00:00Z`,
      region: 'us-east-1',
      resources: ['arn:aws:events:us-east-1:123456789012:rule/summary'],
      source: 'aws.events',
      'detail-type': 'Scheduled Event',
      detail: {},
      ...overrides,
    };
  }

  it('uses the clock when the schedule says nothing', () => {
    expect(resolveSummaryDate(undefined, DATE)).toBe(DATE);
    expect(resolveSummaryDate(invocation(), DATE)).toBe(DATE);
  });

  it('uses an explicitly named date, so a missed day can be re-run', () => {
    expect(resolveSummaryDate(invocation({ date: '2026-02-11' } as Partial<SummaryInvocation>), DATE)).toBe(
      '2026-02-11',
    );
  });

  it('throws on a malformed date rather than summarising a different day', () => {
    // Falling back to today would produce a plausible row for the wrong partition, and the
    // operator would have no way to tell.
    expect(() => resolveSummaryDate(invocation({ date: '13/02/2026' } as Partial<SummaryInvocation>), DATE)).toThrow(
      /malformed date/,
    );
  });

  it('rejects a well-formed date that does not exist', () => {
    expect(() => resolveSummaryDate(invocation({ date: '2026-02-31' } as Partial<SummaryInvocation>), DATE)).toThrow(
      /malformed date/,
    );
  });
});

describe('the handler', () => {
  // The handler builds its own DynamoDB and Bedrock dependencies, so it cannot be driven
  // with fakes. What is asserted here is only the behaviour that lives in the wiring
  // itself: which partition it asks for, and what it does with a bad date. The whole
  // decision tree is covered above, through `generateDaySummary`.
  it('derives today from the clock when invoked with no event', async () => {
    // A manual console invocation sends nothing. With no table configured the run fails on
    // the table lookup, which is exactly what proves it got past date resolution.
    await expect(handler()).rejects.toThrow(/DYNAMODB_EVENTS_TABLE/);
  });

  it('rejects a malformed date from the schedule before touching DynamoDB', async () => {
    await expect(handler({ date: 'yesterday' } as unknown as SummaryInvocation)).rejects.toThrow(
      /malformed date/,
    );
  });

  it('rejects a well-formed date that does not exist', async () => {
    await expect(handler({ date: '2026-02-31' } as unknown as SummaryInvocation)).rejects.toThrow(
      /malformed date/,
    );
  });
});
