/**
 * Tests for the pipeline demo's sequence and its shared state.
 *
 * The demo is the one page a judge is most likely to open, and it is the one with the most
 * moving parts. What matters is that the two surfaces cannot disagree — they read one
 * `daySoFar()` call — and that an event is visible as *pending* before its sentence exists,
 * because that gap is the architectural claim the page makes.
 *
 * The clock is injected, so the whole three-event script runs in zero real milliseconds.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  daySoFar,
  FIXTURE_EVENTS,
  runEvent,
  STAGES,
  TIMELINE_MS,
  type FixtureEvent,
  type StageKey,
} from '../src/pipeline';
import { timelineOrder } from '../src/view';
import {
  GAP_MS,
  RESTART_MS,
  runLoop,
  startPipeline,
  type PipelineClock,
  type PipelineHooks,
} from '../src/pipeline';

/** A scheduler that runs every callback immediately, recording the order they fired in. */
function instantScheduler(): {
  schedule: (fn: () => void, ms: number) => () => void;
  fired: number[];
} {
  const fired: number[] = [];
  const schedule = (fn: () => void, ms: number): (() => void) => {
    fired.push(ms);
    fn();
    return () => undefined;
  };
  return { schedule, fired };
}

const described = (ids: string[]): ReadonlySet<string> => new Set(ids);

describe('the stage strip', () => {
  it('names the five stages in the order the chain runs', () => {
    expect(STAGES.map((s) => s.key)).toEqual([
      'webhook',
      'snapshot',
      'bedrock',
      'overlay',
      'stored',
    ]);
  });

  it('has a distinct delay for each stage, so it reads as a sequence and not a flash', () => {
    const times = STAGES.map((s) => TIMELINE_MS[s.key]);
    expect(new Set(times).size).toBe(times.length);
  });

  it('puts bedrock before overlay, because the overlay carries the sentence', () => {
    // The reverse order would be a demo that shows a television displaying text the model
    // has not written yet.
    expect(TIMELINE_MS.bedrock).toBeLessThan(TIMELINE_MS.overlay);
  });
});

describe('daySoFar — one state, rendered twice', () => {
  const first = FIXTURE_EVENTS[0]!;

  it('shows an arrived event as pending, with no description and no snapshot', () => {
    const day = daySoFar([first], described([]));
    const event = day.events[0]!;

    // FR12's processed flag, demonstrated rather than asserted.
    expect(event.processed).toBe(false);
    expect(event.description).toBeNull();
    // A pending event has no snapshot yet, so the UI must not render an <img> for it.
    expect(event.snapshot_url).toBeNull();
  });

  it('fills the event in once the sentence exists', () => {
    const day = daySoFar([first], described([first.id]));
    const event = day.events[0]!;

    expect(event.processed).toBe(true);
    expect(event.description).toBe(first.description);
    expect(event.snapshot_url).not.toBeNull();
  });

  it('counts only the events that have arrived, not the whole day', () => {
    const day = daySoFar([FIXTURE_EVENTS[0]!, FIXTURE_EVENTS[1]!], described([]));
    expect(day.count).toBe(2);
  });

  it('has no summary while any event is still undescribed', () => {
    const arrived = [FIXTURE_EVENTS[0]!, FIXTURE_EVENTS[1]!];
    const partial = daySoFar(arrived, described([arrived[0]!.id]));

    // One sentence cannot summarise a day whose later events are still blank.
    expect(partial.summary).toBeNull();
  });

  it('shows the summary once every arrived event is described', () => {
    const arrived = [FIXTURE_EVENTS[0]!, FIXTURE_EVENTS[1]!];
    const complete = daySoFar(arrived, described(arrived.map((e) => e.id)));

    expect(complete.summary).not.toBeNull();
    expect(complete.summary?.source).toBe('ai');
  });

  it('has no summary on an empty day, which is the pre-9pm state', () => {
    expect(daySoFar([], described([])).summary).toBeNull();
  });

  it('keeps arrival order, which is the order a partition is read in', () => {
    // Not the display order: DynamoDB returns the day oldest-first, and the view layer is
    // what reverses it. Asserting newest-first here would pin the wrong layer.
    const day = daySoFar(FIXTURE_EVENTS, described(FIXTURE_EVENTS.map((e) => e.id)));
    const times = day.events.map((e) => e.timestamp);

    expect([...times].sort()).toEqual(times);
  });

  it('renders newest-first once the view layer sees it', () => {
    const day = daySoFar(FIXTURE_EVENTS, described(FIXTURE_EVENTS.map((e) => e.id)));
    const rendered = timelineOrder(day.events).map((e) => e.timestamp);

    expect([...rendered].sort().reverse()).toEqual(rendered);
  });

  it('gives every fixture a distinct id, since the dashboard keys on it', () => {
    const ids = FIXTURE_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('runEvent — the sequence, with no real waiting', () => {
  it('fires the stages in chain order', async () => {
    const stages: StageKey[] = [];
    const { schedule } = instantScheduler();

    await runEvent(
      FIXTURE_EVENTS[0]!,
      {
        onStage: (s) => stages.push(s),
        onArrive: () => undefined,
        onDescribed: () => undefined,
      },
      schedule,
    );

    expect(stages).toEqual(['webhook', 'snapshot', 'bedrock', 'overlay', 'stored']);
  });

  it('announces the arrival before the first stage and the description after the last', async () => {
    // This ordering is the whole point: a viewer must see the event exist before it is
    // described, or the pending state is invisible.
    const order: string[] = [];
    const { schedule } = instantScheduler();

    await runEvent(
      FIXTURE_EVENTS[0]!,
      {
        onStage: () => order.push('stage'),
        onArrive: () => order.push('arrive'),
        onDescribed: () => order.push('described'),
      },
      schedule,
    );

    expect(order[0]).toBe('arrive');
    expect(order.at(-1)).toBe('described');
    expect(order.filter((o) => o === 'stage')).toHaveLength(STAGES.length);
  });

  it('never schedules a negative delay, whatever the timeline says', async () => {
    // runEvent computes each delay as a difference from the previous stage. If the
    // constants were ever reordered that difference could go negative, and setTimeout treats
    // a negative as zero — which would fire two stages at once without any error.
    const { schedule, fired } = instantScheduler();
    await runEvent(
      FIXTURE_EVENTS[0]!,
      { onStage: () => undefined, onArrive: () => undefined, onDescribed: () => undefined },
      schedule,
    );

    expect(fired.every((ms) => ms >= 0)).toBe(true);
  });

  it('waits the configured span in total, not the sum of the stages', async () => {
    const { schedule, fired } = instantScheduler();
    await runEvent(
      FIXTURE_EVENTS[0]!,
      { onStage: () => undefined, onArrive: () => undefined, onDescribed: () => undefined },
      schedule,
    );

    // Each delay is a delta from the previous stage, so they must sum to the whole span
    // rather than to a multiple of it — otherwise the loop would take 4x as long as stated.
    const total = fired.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBe(TIMELINE_MS.stored);
  });
});

describe('cancellation — what Replay has to do', () => {
  it('stops announcing stages once the run is abandoned', async () => {
    // A replay clicked mid-event must not go on lighting stages for an event that is no
    // longer being narrated. This is the whole reason runEvent takes a cancel check.
    let live = true;
    const stages: StageKey[] = [];
    const { schedule } = instantScheduler();

    await runEvent(
      FIXTURE_EVENTS[0]!,
      {
        onStage: (stage) => stages.push(stage),
        onArrive: () => {
          live = false;
        },
        onDescribed: () => undefined,
      },
      schedule,
      () => !live,
    );

    expect(stages).toHaveLength(0);
  });

  it('does not push the sentence for an abandoned run', async () => {
    // The overlay must never show text for an event the dashboard has dropped: the two
    // surfaces agreeing is this page’s entire claim.
    let live = true;
    const described: string[] = [];
    const { schedule } = instantScheduler();

    await runEvent(
      FIXTURE_EVENTS[0]!,
      {
        onStage: () => {
          live = false;
        },
        onArrive: () => undefined,
        onDescribed: (event) => described.push(event.id),
      },
      schedule,
      () => !live,
    );

    expect(described).toHaveLength(0);
  });

  it('behaves identically when nothing cancels it', async () => {
    const stages: StageKey[] = [];
    const { schedule } = instantScheduler();

    await runEvent(
      FIXTURE_EVENTS[0]!,
      { onStage: (stage) => stages.push(stage), onArrive: () => undefined, onDescribed: () => undefined },
      schedule,
    );

    expect(stages).toEqual(['webhook', 'snapshot', 'bedrock', 'overlay', 'stored']);
  });
});

const noHooks = (): PipelineHooks => ({
  onStage: () => undefined,
  onArrive: () => undefined,
  onDescribed: () => undefined,
});

describe('runLoop — the page stays alive', () => {
  // The defect this guards: the first version ran its three events once and then stopped, so
  // a judge who looked away for half a minute came back to a motionless page and reasonably
  // concluded the demo had finished or died. Same class as the overlay demo's eight-second
  // opening (Entry 21), at the other end of the page.
  function instantClock(): { clock: PipelineClock; waits: number[] } {
    const waits: number[] = [];
    return {
      waits,
      clock: {
        schedule: (fn) => {
          fn();
          return () => undefined;
        },
        wait: async (ms) => {
          waits.push(ms);
        },
      },
    };
  }

  /**
   * A budget counted in EVENTS narrated, not in cycles.
   *
   * Cycles were tried first and were a bad unit: the loop increments its own cycle counter
   * after the restart pause, while a test's cancel has to fire before that, so the two
   * counters sit one step apart and the assertions read as off-by-one bugs that are not.
   * Events are unambiguous — "narrate four full days' worth" is exactly three cycles.
   */
  function budgetOf(events: number): { cancel: () => boolean; hooks: () => PipelineHooks } {
    let narrated = 0;
    return {
      cancel: () => narrated >= events,
      hooks: () => ({
        onStage: () => undefined,
        onArrive: () => {
          narrated += 1;
        },
        onDescribed: () => undefined,
      }),
    };
  }

  it('keeps going after the last fixture, rather than freezing', async () => {
    // Without a bound this loop never returns — which is what makes a test of it necessary
    // rather than decorative. Narrating twelve events is four complete cycles.
    const { clock } = instantClock();
    const budget = budgetOf(FIXTURE_EVENTS.length * 4);

    const cycles = await runLoop(FIXTURE_EVENTS, budget.hooks, () => undefined, clock, budget.cancel);

    expect(cycles).toBeGreaterThanOrEqual(3);
  });

  it('runs every fixture on each cycle, in order', async () => {
    const seen: string[] = [];
    const { clock } = instantClock();
    let narrated = 0;
    await runLoop(
      FIXTURE_EVENTS,
      () => ({
        onStage: () => undefined,
        onArrive: (event) => {
          seen.push(event.id);
          narrated += 1;
        },
        onDescribed: () => undefined,
      }),
      () => undefined,
      clock,
      () => narrated >= FIXTURE_EVENTS.length * 2,
    );

    expect(seen).toEqual([
      ...FIXTURE_EVENTS.map((e) => e.id),
      ...FIXTURE_EVENTS.map((e) => e.id),
    ]);
  });

  it('clears the day between cycles, so it does not fill with duplicates', async () => {
    // The callback exists precisely for this; without it a second viewing would show six
    // rows where three belong.
    let clears = 0;
    const { clock } = instantClock();
    const budget = budgetOf(FIXTURE_EVENTS.length * 2);
    await runLoop(FIXTURE_EVENTS, budget.hooks, () => { clears += 1; }, clock, budget.cancel);

    expect(clears).toBe(1);
  });

  it('waits the inter-event gap once per event, and the restart pause once per cycle', async () => {
    const { clock, waits } = instantClock();
    const budget = budgetOf(FIXTURE_EVENTS.length * 2);
    await runLoop(FIXTURE_EVENTS, budget.hooks, () => undefined, clock, budget.cancel);

    const gaps = waits.filter((ms) => ms === GAP_MS).length;
    const restarts = waits.filter((ms) => ms === RESTART_MS).length;

    // One gap per narrated event, less one: the cancel is checked immediately after an
    // event completes and before its gap, so the final gap never happens. That is the
    // behaviour Replay depends on — an abandoned event must not also wait out its pause.
    expect(gaps).toBe(FIXTURE_EVENTS.length * 2 - 1);
    // A restart pause only after a FULL cycle. After the last event of the run there is no
    // pause at all, or the page would sit empty for a beat nobody asked for.
    expect(restarts).toBe(1);
  });

  it('stops immediately when already cancelled, narrating nothing', async () => {
    let narrated = 0;
    const { clock } = instantClock();
    const cycles = await runLoop(
      FIXTURE_EVENTS,
      () => ({ onStage: () => undefined, onArrive: () => { narrated += 1; }, onDescribed: () => undefined }),
      () => undefined,
      clock,
      () => true,
    );

    expect(cycles).toBe(0);
    expect(narrated).toBe(0);
  });

  it('abandons a run part-way rather than finishing the current event', async () => {
    // What the Replay button needs: a cancel mid-event must not go on to push the sentence.
    let described = 0;
    const { clock } = instantClock();
    await runLoop(
      FIXTURE_EVENTS,
      () => ({ onStage: () => undefined, onArrive: () => undefined, onDescribed: () => { described += 1; } }),
      () => undefined,
      clock,
      // Cancels once the first description lands, i.e. part-way through the first event's
      // teardown — which is exactly what clicking Replay mid-event does.
      () => described >= 1,
    );

    expect(described).toBe(1);
  });
});

describe('the pacing constants', () => {
  it('has a restart pause that does not leave the page looking dead', () => {
    // The bug this guards: RESTART_MS was GAP_MS * 2, giving ~8s of empty page between
    // cycles. Anything approaching a minute reads as a hang.
    expect(RESTART_MS).toBeLessThan(2000);
    expect(RESTART_MS).toBeGreaterThan(0);
  });

  it('keeps the restart pause longer than half the inter-event gap', () => {
    // Otherwise the loop restart is indistinguishable from just another event arriving.
    expect(RESTART_MS).toBeGreaterThan(GAP_MS / 2);
  });
});

describe('the fixture stream', () => {
  it('describes events a homeowner would recognise, not lorem ipsum', () => {
    for (const event of FIXTURE_EVENTS satisfies readonly FixtureEvent[]) {
      expect(event.description.length).toBeGreaterThan(20);
      expect(event.description).toMatch(/\.$/);
    }
  });

  it('uses one camera, so nothing on screen contradicts anything else', () => {
    const day = daySoFar(FIXTURE_EVENTS, described(FIXTURE_EVENTS.map((e) => e.id)));
    expect(new Set(day.events.map((e) => e.device_name))).toEqual(new Set(['Front Door']));
  });

  it('is short enough to watch twice inside a judge\u2019s attention span', () => {
    // Three events at ~3.7s plus a 2.6s gap is under 20 seconds for the whole loop.
    expect(FIXTURE_EVENTS.length).toBeLessThanOrEqual(4);
  });
});

describe('runLoop, when cancelled', () => {
  /**
   * An instant clock.
   *
   * `runLoop` checks `cancelled()` at three checkpoints, and this is the only way to reach
   * the middle and last ones without waiting real seconds: the pause between cycles is
   * `RESTART_MS`, and under real timers reaching it would make the suite slower than the
   * build it guards.
   */
  const instant = {
    schedule: (fn: () => void): (() => void) => {
      fn();
      return () => undefined;
    },
    wait: async (): Promise<void> => undefined,
  };

  it('returns immediately when already cancelled, narrating nothing', async () => {
    const cycles = await runLoop(FIXTURE_EVENTS, noHooks, () => undefined, instant, () => true);
    expect(cycles).toBe(0);
  });

  it('still counts a cycle when the fixture list is empty', async () => {
    // Nothing to narrate, so a cycle completes trivially — but it still counts, and the loop
    // still reaches its restart pause. Bounded here by a cancel rather than left to run
    // forever: an empty list with a never-cancelling predicate is an infinite loop by
    // construction, which is exactly how this test first hung the suite.
    let clears = 0;
    const cycles = await runLoop(
      [],
      noHooks,
      () => {
        clears += 1;
      },
      instant,
      () => clears >= 3,
    );
    expect(cycles).toBeGreaterThanOrEqual(2);
  });

  it('does not count a cycle it abandoned part-way', async () => {
    let narrated = 0;
    const cycles = await runLoop(
      FIXTURE_EVENTS,
      () => ({
        onStage: () => undefined,
        onArrive: () => {
          narrated += 1;
        },
        onDescribed: () => undefined,
      }),
      () => undefined,
      instant,
      () => narrated >= FIXTURE_EVENTS.length,
    );

    // Cancelling during the LAST event means the cycle never finished, so the count is
    // zero. An earlier version of this test expected 1 and was wrong: reporting a cycle as
    // complete when its last event was abandoned is how a demo would claim a day it did
    // not finish narrating.
    expect(narrated).toBe(FIXTURE_EVENTS.length);
    expect(cycles).toBe(0);
  });

  it('clears the day only after a completed cycle, never after an abandoned one', async () => {
    let narrated = 0;
    let clears = 0;
    await runLoop(
      FIXTURE_EVENTS,
      () => ({
        onStage: () => undefined,
        onArrive: () => {
          narrated += 1;
        },
        onDescribed: () => undefined,
      }),
      () => {
        clears += 1;
      },
      instant,
      () => narrated >= FIXTURE_EVENTS.length,
    );

    // Cancelled during the final event, so the cycle never reached its clear: an abandoned
    // run must not reset the stage strip on its way out, or the last thing a viewer sees is
    // a demo that blanked itself mid-sequence.
    expect(clears).toBe(0);
  });
});

