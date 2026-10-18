/**
 * The pipeline demo: one event, one system, both surfaces at once.
 *
 * ## Why this page exists
 *
 * The other two demos are separate pages that a judge has to connect by imagination. The
 * landing page promises "a Ring doorbell press becomes one sentence on your TV", and then
 * offers two links that each show half of it. The thing being built is a *chain* — webhook,
 * snapshot, Bedrock, overlay, store — and a chain is not visible when you look at its ends
 * separately.
 *
 * So this page runs the chain. Both surfaces are the production ones: the dashboard is
 * `load()` from `app.ts` over a fixture transport, and the television is
 * `createOverlayClient()` from the firetv tree over a scripted socket. **Neither surface is
 * reimplemented here.** The only fake is time and the transport, and the banner says so.
 *
 * ## The one thing this page shows that the others cannot
 *
 * The pending state, made visible. A real event arrives *before* it has a description: the
 * webhook stores it and returns inside 5 seconds, and the sentence arrives seconds later from
 * a queue. So each event here appears in the timeline as pending and is then filled in — which
 * is FR12's `processed` flag and the dashboard's honesty rule demonstrated rather than
 * asserted. A judge watching that transition learns something about the architecture that no
 * static screenshot can convey.
 *
 * ## Why the stage strip is honest
 *
 * Each stage lights up when the demo says it happened, and the demo says it happened at the
 * same moment it feeds the next surface. It is a narration of the sequence, not a trace of
 * it: nothing is measured, nothing is timed from a real system, and the page never claims
 * otherwise. It exists because the *order* is the design.
 */

import { load } from './app';
import type { FetchLike, TodayEvent, TodayResponse, TodaySummary } from './api';
import { start as startOverlay } from '../../firetv/src/app';
import type {
  OverlayMessage,
  SocketFactory,
  SocketHandlers,
} from '../../firetv/src/client';

/** The five stages, in the order the chain actually runs. */
export const STAGES = [
  { key: 'webhook', label: 'Webhook received', detail: 'HMAC verified, request_id claimed, event stored' },
  { key: 'snapshot', label: 'Snapshot fetched', detail: 'Ring Partner API, anchored to the device clock' },
  { key: 'bedrock', label: 'Described', detail: 'Claude on Bedrock, one sentence' },
  { key: 'overlay', label: 'Pushed to the TV', detail: 'WebSocket, per connected client' },
  { key: 'stored', label: 'Summary updated', detail: 'DynamoDB, on the date partition' },
] as const;

export type StageKey = (typeof STAGES)[number]['key'];

const PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
    '<rect width="320" height="180" fill="#0d1016"/>' +
    '<rect x="0.5" y="0.5" width="319" height="179" fill="none" stroke="#2b3240"/>' +
    '<text x="160" y="95" text-anchor="middle" font-family="system-ui, sans-serif" ' +
    'font-size="12" fill="#9aa4b5">demo snapshot placeholder</text>' +
    '</svg>',
)}`;

/** One event, at three moments: arrived, described, and the sentence that was written. */
export interface FixtureEvent {
  readonly id: string;
  readonly time: string;
  readonly description: string;
}

export const FIXTURE_EVENTS: readonly FixtureEvent[] = [
  {
    id: 'demo_0812',
    time: '2026-10-04T08:12:31.000Z',
    description: 'A person in a dark jacket walks up the path and rings the doorbell.',
  },
  {
    id: 'demo_0947',
    time: '2026-10-04T09:47:02.000Z',
    description: 'A white van parks at the kerb and a driver leaves a medium parcel at the door.',
  },
  {
    id: 'demo_1302',
    time: '2026-10-04T13:02:44.000Z',
    description: 'Motion on the path, but no person reached the door.',
  },
];

const SUMMARY: TodaySummary = {
  summary:
    'A quiet day with two callers: one rang the bell in the morning, and a courier left a parcel just before ten.',
  source: 'ai',
  event_count: 3,
  generated_at: '2026-10-04T21:00:05.000Z',
};

/**
 * The day so far, given which events have arrived and which are still awaiting a sentence.
 *
 * Pure, and the single source of truth for what both surfaces display. The dashboard's
 * transport and the overlay's socket both read this, which is what makes the two surfaces
 * agree — they are not two demos of one idea, they are one state rendered twice.
 */
export function daySoFar(
  arrived: readonly FixtureEvent[],
  described: ReadonlySet<string>,
): TodayResponse {
  const events: TodayEvent[] = arrived.map((event) => {
    const isDescribed = described.has(event.id);
    return {
      event_id: event.id,
      timestamp: event.time,
      device_name: 'Front Door',
      event_type: 'motion_detected',
      sub_type: 'human',
      description: isDescribed ? event.description : null,
      snapshot_url: isDescribed ? PLACEHOLDER : null,
      processed: isDescribed,
    };
  });

  return {
    date: '2026-10-04',
    count: events.length,
    truncated: false,
    events,
    // The summary only appears once every event has been described, because that is when the
    // scheduled stage would have run. Before that the dashboard says so, which is the same
    // null the live endpoint returns before 9 PM.
    summary: arrived.length > 0 && described.size >= arrived.length ? SUMMARY : null,
  };
}

/**
 * The script: what happens, in order, for one event.
 *
 * Milliseconds, and they are the *demo's* pacing rather than the system's real timings — the
  * real 8-second FR6 target is unmeasured. They are uneven on purpose so the pipeline reads as
 * a sequence of distinct steps rather than a single flash.
 *
 * **These are deliberately tight.** An earlier version spread the first event over 3.7
 * seconds, so the page opened on an empty television and an empty timeline — the same defect
 * as the standalone overlay demo, where eight seconds of "Waiting for the front door…" read as
 * a broken page. A judge decides what they think of a demo in the first three seconds, so the
 * first sentence now reaches the screen at 1.4s. Everything downstream is still visible,
 * because each stage keeps its own gap.
 */
export const TIMELINE_MS = {
  webhook: 250,
  snapshot: 600,
  bedrock: 1100,
  overlay: 1400,
  stored: 1700,
} as const;

export interface PipelineHooks {
  /** Lit a stage. Called once per stage per event. */
  readonly onStage: (stage: StageKey) => void;
  /** The event just arrived, before it has a sentence. */
  readonly onArrive: (event: FixtureEvent) => void;
  /** The sentence now exists. */
  readonly onDescribed: (event: FixtureEvent) => void;
}

/**
 * Run one event through the chain.
 *
 * Timers are injected, so a test drives the whole script with no waiting — the same reason
 * every other seam in this repository is injectable.
 */
export async function runEvent(
  event: FixtureEvent,
  hooks: PipelineHooks,
  schedule: (fn: () => void, ms: number) => () => void,
  /** Polled between stages so Replay can abandon a run mid-sequence. */
  cancelled: () => boolean = () => false,
): Promise<void> {
  // The canceller is invoked AFTER the promise settles rather than inside the callback.
  // Inside would assume the scheduler is asynchronous: a synchronous test scheduler would
  // run the callback before `cancel` is assigned, and this is a temporal-dead-zone crash
  // rather than a failure. Cancelling afterwards is what a one-shot timer wants anyway.
  const wait = async (stage: StageKey, at: number): Promise<void> => {
    let cancel: (() => void) | undefined;
    await new Promise<void>((resolve) => {
      cancel = schedule(() => resolve(), at);
    });
    cancel?.();
    // Bail before announcing a stage that a replay has already abandoned. Announcing it
    // anyway would light a stage for an event that is no longer being narrated.
    if (!cancelled()) hooks.onStage(stage);
  };

  hooks.onArrive(event);
  await wait('webhook', TIMELINE_MS.webhook);
  await wait('snapshot', TIMELINE_MS.snapshot - TIMELINE_MS.webhook);
  await wait('bedrock', TIMELINE_MS.bedrock - TIMELINE_MS.snapshot);
  await wait('overlay', TIMELINE_MS.overlay - TIMELINE_MS.bedrock);
  await wait('stored', TIMELINE_MS.stored - TIMELINE_MS.overlay);
  if (!cancelled()) hooks.onDescribed(event);
}

/** `setTimeout` returning its own canceller, which is the seam's real shape. */
const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

/**
 * Drive the whole page.
 *
 * Exported whole so a test can run the demo against the fake DOM and assert that both
 * surfaces actually changed, rather than only that the file parsed.
 */
/**
 * The loop, with no DOM in it.
 *
 * Separated from {@link startPipeline} because this is the part worth testing and the part a
 * fake DOM cannot reach: `startPipeline` wires elements, and the loop only decides *when*
 * things happen. Extracted, "the page keeps going instead of freezing" becomes an assertion
 * about a few lines rather than something a human has to sit and watch for.
 */
export async function runLoop(
  events: readonly FixtureEvent[],
  hooksFor: () => PipelineHooks,
  betweenCycles: () => void,
  clock: PipelineClock,
  cancelled: () => boolean,
): Promise<number> {
  let cycles = 0;
  while (!cancelled()) {
    for (const event of events) {
      if (cancelled()) return cycles;
      await runEvent(event, hooksFor(), clock.schedule, cancelled);
      if (cancelled()) return cycles;
      // A gap between events, so the strip resets and the day visibly grows rather than
      // everything landing at once.
      await clock.wait(GAP_MS);
      if (cancelled()) return cycles;
    }
    betweenCycles();
    if (cancelled()) return cycles;
    await clock.wait(RESTART_MS);
    cycles += 1;
  }
  return cycles;
}

export interface Pipeline {
  /** Abandon the current run and start again from the first event. */
  readonly replay: () => void;
  /** Stop for good. The Replay button's counterpart, and what a teardown test calls. */
  readonly stop: () => void;
}

/** The pause between one event finishing and the next arriving. */
export const GAP_MS = 2600;

/**
 * The pause before the whole sequence starts over.
 *
 * Longer than the gap between events, so a restart reads as a fresh run rather than as a
 * fourth event of the current one. It is not so long that the page looks dead — the first
 * version reused `GAP_MS * 2` and left ~8 seconds of an empty dashboard between cycles,
 * which is the same defect as the overlay demo's eight-second opening (Entry 21).
 */
export const RESTART_MS = 1500;

/**
 * Run the chain, on a loop, forever.
 *
 * **It loops because a frozen page reads as a broken one.** The first version ran its three
 * events once and then sat there, perfectly rendered and motionless — and a judge who looked
 * away for half a minute came back to a screenshot and reasonably concluded the demo had
 * finished or died. This is the same defect as the overlay demo's eight seconds of "Waiting
 * for the front door…", at the other end of the page: an idle demo is indistinguishable from
 * a broken one, and only a human watching for long enough can tell the difference.
 *
 * So the sequence restarts. Every cycle re-seeds the day from empty, which also means the
 * second viewing is not a page slowly filling with duplicates.
 *
 * Replay is exposed rather than left implicit so the Replay button can abandon a run
 * mid-event instead of racing it.
 *
 * The clock is a parameter. A demo that loops cannot be tested at all without one: the
 * suite would either wait fifteen real seconds per cycle or, worse, spin forever on an
 * instant timer and hang. Injecting it is what makes "the loop actually repeats" an
 * assertion rather than an assumption.
 */
/**
 * Everything time-shaped the demo does: the per-stage timers inside one event, and the
 * pauses between events and between cycles.
 *
 * Passed in as one object because they are the same concern — the demo's pacing — and
 * because injecting only the pauses leaves the stage timers on real `setTimeout`, which makes
 * the loop untestable: a suite either waits real seconds per cycle or hangs.
 */
export interface PipelineClock {
  /** Schedule one callback after `ms`. Returns a canceller. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
  /** Wait out `ms`. Used for the gaps, where nothing is scheduled. */
  readonly wait: (ms: number) => Promise<void>;
}

/** The real clock. The only one a browser ever uses. */
export const realClock: PipelineClock = { schedule: defaultSchedule, wait: sleep };

export function startPipeline(root: HTMLElement, clock: PipelineClock = realClock): Pipeline {
  const tv = document.getElementById('overlay');
  const tvScreen = document.querySelector<HTMLElement>('.tv-screen');
  const tvPane = document.querySelector<HTMLElement>('.surface--tv');

  // The television is the production overlay client, mounted for real.
  const pushOverlay = (message: OverlayMessage): void => {
    socketHandlers?.onData(JSON.stringify(message));
  };
  let socketHandlers: SocketHandlers | undefined;

  const socketFactory: SocketFactory = (_url, handlers) => {
    socketHandlers = handlers;
    handlers.onOpen();
    return {
      close: () => {
        socketHandlers = undefined;
      },
    };
  };

  if (tv !== null) startOverlay(tv, socketFactory, 'demo://pipeline');

  // Scale the television's fixed 1280x720 layout down to the pane. See pipeline.css for why
  // it is scaled rather than reflowed: at a pane width the overlay's own type sizes wrap to
  // one word per line and the card escapes its container.
  const fit = (): void => {
    if (tvScreen === null) return;
    const width = tvScreen.clientWidth;
    if (width === 0) return;
    tvScreen.style.setProperty('--tv-fit', String(Math.min(1, width / 1280)));
  };
  fit();
  // Re-fit on resize. A ResizeObserver rather than a window listener because the pane also
  // changes width when the layout wraps, with no window resize involved.
  if (tvScreen !== null && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(fit).observe(tvScreen);
  }

  // The stage strip, built once and re-lit per cycle.
  const stageRow = document.getElementById('stages');
  const stageNodes = new Map<StageKey, HTMLElement>();
  if (stageRow !== null) {
    stageRow.replaceChildren(
      ...STAGES.map((stage) => {
        const node = document.createElement('li');
        node.className = 'stage';
        const name = document.createElement('strong');
        name.textContent = stage.label;
        const detail = document.createElement('span');
        detail.textContent = stage.detail;
        node.append(name, detail);
        stageNodes.set(stage.key, node);
        return node;
      }),
    );
  }

  /**
   * Bumped by replay and stop. Each loop captures the value it started with and exits when it
   * changes, so a replay abandons the in-flight run without leaving a second loop behind —
   * which a plain boolean cannot do, because two loops would then both be live.
   */
  let runId = 0;
  const mine = (): number => runId;

  /**
   * Flash the television when a sentence lands on it.
   *
   * Both panes are dark and the new content is small, so an arriving card is easy to miss
   * — especially on a laptop at the far end of a desk. A brief border pulse is the cheapest
   * way to say "that just happened" without touching the overlay's own rendering, which this
   * demo has a strong interest in leaving alone.
   */
  const flash = (node: Element | null): void => {
    if (node === null) return;
    node.classList.remove('just-arrived');
    // Reading offsetWidth forces a reflow so the class removal actually resets the
    // animation. Without it, re-adding the class in the same frame does nothing.
    void (node as HTMLElement).offsetWidth;
    node.classList.add('just-arrived');
  };

  async function cycle(id: number): Promise<void> {
    const stopped = (): boolean => runId !== id;
    const arrived: FixtureEvent[] = [];
    const described = new Set<string>();

    const transport: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => daySoFar(arrived, described),
    });

    let lastKey = '';
    const repaint = async (): Promise<void> => {
      const key = `${arrived.length}:${described.size}`;
      if (key === lastKey) return;
      lastKey = key;
      await load(root, transport, '', '');
    };

    await runLoop(
      FIXTURE_EVENTS,
      () => ({
        onStage: (stage) => stageNodes.get(stage)?.classList.add('stage--done'),
        onArrive: (arriving) => {
          arrived.push(arriving);
          flash(document.querySelector('#app .event--pending'));
          void repaint();
        },
        onDescribed: (done) => {
          described.add(done.id);
          // FR6: the overlay carries the sentence, so it is pushed once that exists — never
          // before. Sending an empty description here would be the one thing the pusher
          // refuses to do in production.
          pushOverlay({
            event_id: done.id,
            description: done.description,
            snapshot_url: PLACEHOLDER,
            timestamp: done.time,
            device_name: 'Front Door',
          });
          flash(tvPane);
          void repaint();
        },
      }),
      // Empties the day and the stage strip, so a restart reads as a fresh run.
      //
      // It has to CLEAR THE ARRAYS, not merely invalidate the repaint cache. An earlier
      // version only reset `lastKey` and re-rendered — which repainted the same three events,
      // so the timeline grew 3, 6, 9, 12… across cycles and a judge watching long enough saw a
      // day with forty events on it. Clearing `lastKey` alone changes nothing on screen.
      () => {
        arrived.length = 0;
        described.clear();
        for (const node of stageNodes.values()) node.classList.remove('stage--done');
        lastKey = '';
        void repaint();
      },
      clock,
      stopped,
    );
  }

  const run = (): void => {
    runId += 1;
    const id = runId;
    void (async () => {
      while (mine() === id) await cycle(id);
    })();
  };

  run();

  return {
    replay: run,
    stop: () => {
      runId += 1;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
