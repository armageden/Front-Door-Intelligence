/**
 * The dashboard's DOM shell. Everything here is rendering; nothing here decides anything.
 *
 * The split is deliberate and is what makes this app replaceable. All interpretation lives
 * in `./view.ts` and all transport in `./api.ts`, both pure and both unit-tested with no
 * browser. Swapping plain DOM for React is then a change to this file and to the build
 * step, with no logic moving and no test changing — see decision D029.
 */

import {
  fetchToday,
  QueryError,
  type FetchLike,
  type TodayResponse,
} from './api';
import {
  formatClock,
  formatDescription,
  formatDevice,
  formatEmptyDay,
  formatHeader,
  formatSubtype,
  formatSummary,
  timelineOrder,
} from './view';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
}

function renderSummary(response: TodayResponse): HTMLElement {
  const box = el('section', undefined, 'summary');
  box.append(el('h2', 'Day in review'));
  const text = formatSummary(response.summary);
  box.append(el('p', text ?? 'No summary.', 'summary-text'));
  return box;
}

function renderEvent(event: TodayResponse['events'][number]): HTMLElement {
  const item = el('article', undefined, event.processed ? 'event' : 'event event--pending');

  const header = el('header', undefined, 'event-header');
  header.append(el('time', formatClock(event.timestamp), 'event-time'));
  header.append(el('span', formatSubtype(event), 'event-subtype'));
  header.append(el('span', formatDevice(event), 'event-device'));
  item.append(header);

  item.append(el('p', formatDescription(event), 'event-description'));

  // A null snapshot_url is rendered as absent, not as a broken image: the URL would 404.
  if (event.snapshot_url !== null) {
    const figure = el('figure', undefined, 'event-snapshot');
    const img = el('img');
    img.src = event.snapshot_url;
    img.alt = formatDescription(event);
    figure.append(img);
    item.append(figure);
  }

  return item;
}

function renderTimeline(response: TodayResponse): HTMLElement {
  const section = el('section', undefined, 'timeline');
  section.append(el('h2', 'Timeline'));
  if (response.count === 0) {
    section.append(el('p', formatEmptyDay(response), 'empty'));
    return section;
  }
  const list = el('ol', undefined, 'event-list');
  for (const event of timelineOrder(response.events)) list.append(renderEvent(event));
  section.append(list);
  return section;
}

function renderError(message: string, detail?: string): HTMLElement {
  const box = el('section', undefined, 'error');
  box.append(el('h2', 'Could not load events'));
  box.append(el('p', message));
  if (detail !== undefined) box.append(el('p', detail, 'error-detail'));
  return box;
}

/** One load. Exported so a test can drive the shell without a browser. */
export async function load(
  root: HTMLElement,
  fetchImpl: FetchLike,
  baseUrl: string,
  apiKey: string,
  date?: string,
): Promise<void> {
  root.replaceChildren(el('p', 'Loading…', 'loading'));
  try {
    const response = await fetchToday(fetchImpl, baseUrl, apiKey, date);
    root.replaceChildren(
      el('h1', 'Front Door Intelligence'),
      el('p', formatHeader(response), 'header-line'),
      renderSummary(response),
      renderTimeline(response),
    );
  } catch (error) {
    // A 401 is a configuration problem and says so; anything else is reported as what it
    // is rather than as a generic failure. The key is never included in either message.
    if (error instanceof QueryError && error.status === 401) {
      root.replaceChildren(
        renderError(
          'The query key was rejected.',
          'This dashboard needs the same X-Query-Key as GET /events/today. See decision D022.',
        ),
      );
      return;
    }
    root.replaceChildren(renderError(error instanceof Error ? error.message : String(error)));
  }
}

export function start(): void {
  const root = document.getElementById('app');
  if (root === null) return;

  // Two values, both operator-supplied at deploy time. The key is typed into a password
  // field and held in memory only — never in the URL, never in localStorage.
  const baseInput = document.getElementById('base-url') as HTMLInputElement | null;
  const keyInput = document.getElementById('api-key') as HTMLInputElement | null;
  const dateInput = document.getElementById('date') as HTMLInputElement | null;
  const refresh = document.getElementById('refresh');

  const run = (): void => {
    const base = baseInput?.value.trim() ?? '';
    const key = keyInput?.value ?? '';
    const date = dateInput?.value.trim() || undefined;
    void load(root, (url, init) => fetch(url, init), base, key, date);
  };

  refresh?.addEventListener('click', run);
  run();
}