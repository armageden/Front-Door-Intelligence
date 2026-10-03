/**
 * The overlay's DOM shell: full-screen, ten-foot, one event at a time. Everything here is
 * rendering; every decision lives in `./client.ts` and every string in `./view.ts` — the
 * same three-layer split as the dashboard, for the same reason.
 *
 * The dismiss button (FR13) is a real `<button>`, so a remote's D-pad can reach it by
 * focus: on a TV the button is either in the focus order or it does not exist.
 */

import {
  createOverlayClient,
  type OverlayClient,
  type OverlayMessage,
  type SocketFactory,
} from './client';
import { formatClock, formatDevice, formatStatus } from './view';

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

function renderOverlay(message: OverlayMessage): HTMLElement {
  const card = el('article', undefined, 'overlay-card');
  card.append(el('p', message.description, 'overlay-description'));

  const meta = el('footer', undefined, 'overlay-meta');
  meta.append(el('span', formatDevice(message), 'overlay-device'));
  meta.append(el('time', formatClock(message.timestamp), 'overlay-time'));
  card.append(meta);

  // The snapshot is required by §3.4, so there is no absent case to render — but a URL
  // that fails to load still must not look like a broken app. alt is the description,
  // because a snapshot with no alt is unreadable to a screen reader, same as the
  // dashboard.
  const img = el('img');
  img.src = message.snapshot_url;
  img.alt = message.description;
  card.append(img);

  return card;
}

function renderIdle(): HTMLElement {
  const idle = el('div', undefined, 'overlay-idle');
  idle.append(el('p', 'Waiting for the front door…', 'overlay-waiting'));
  return idle;
}

/** One paint of the whole screen. Exported so a test can drive the shell. */
export function paint(root: HTMLElement, client: OverlayClient): void {
  const statusLine = el('p', formatStatus(client.status()), 'overlay-status');
  const screen = client.current() === null ? renderIdle() : renderOverlay(client.current()!);

  const dismiss = el('button', 'Dismiss', 'overlay-dismiss');
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => client.dismiss());

  root.replaceChildren(screen, dismiss, statusLine);
}

/**
 * Build the client, wire it to the screen, connect. Exported so a test can drive the
 * shell without a browser and the entry point stays four lines.
 */
export function start(
  root: HTMLElement,
  socketFactory: SocketFactory,
  url: string,
): OverlayClient {
  const client = createOverlayClient({ url, socket: socketFactory });
  const repaint = (): void => paint(root, client);
  client.onEvent(repaint);
  client.onDismiss(repaint);
  client.onStatus(repaint);
  paint(root, client);
  client.start();
  return client;
}
