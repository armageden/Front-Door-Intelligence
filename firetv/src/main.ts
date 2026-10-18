/**
 * Entry point. Two modes, chosen by the page's own query string:
 *
 * - `overlay.html?endpoint=wss://…` — live. The WebSocket endpoint is the
 *   `OverlayWebSocketUrl` the template outputs; nothing is baked into the bundle, the
 *   same way the dashboard takes its base URL as an input rather than a constant.
 * - no endpoint — demo. A scripted transport cycles fixture payloads through the real
 *   client, so the overlay is demonstrable with no deployment, and a banner says the
 *   events are fixtures.
 */

import { start } from './app';
import type { OverlayMessage, SocketFactory, SocketHandlers } from './client';

function liveSocketFactory(): SocketFactory {
  return (url, handlers) => {
    const socket = new WebSocket(url);
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = (event) => handlers.onData(String(event.data));
    socket.onclose = (event) => handlers.onClose(event.code);
    return { close: () => socket.close() };
  };
}

/**
 * One scripted connection: opens instantly, delivers the first fixture **immediately**, then
 * cycles the rest forever.
 *
 * The immediate first push is the whole point of this function and it was wrong once: using
 * `setInterval` alone means the first card appears one full interval after load, so the demo
 * opened on "Waiting for the front door…" and stayed there. With the 8-second cadence that
 * is eight seconds of an apparently broken page — the worst first impression a demo can have,
 * and the exact moment a judge decides it does not work.
 */
function demoSocketFactory(messages: readonly OverlayMessage[], intervalMs: number): SocketFactory {
  let index = 0;
  const emit = (handlers: SocketHandlers): void => {
    handlers.onData(JSON.stringify(messages[index % messages.length]!));
    index += 1;
  };
  return (_url, handlers) => {
    handlers.onOpen();
    emit(handlers);
    const timer = setInterval(() => emit(handlers), intervalMs);
    return {
      close: () => clearInterval(timer),
    };
  };
}

function main(): void {
  const root = document.getElementById('overlay');
  if (root === null) return;

  const banner = document.getElementById('demo-banner');
  const endpoint = new URLSearchParams(window.location.search).get('endpoint');

  if (endpoint !== null && endpoint.length > 0) {
    if (banner !== null) banner.hidden = true;
    start(root, liveSocketFactory(), endpoint);
    return;
  }

  if (banner !== null) banner.hidden = false;
  start(root, demoSocketFactory(FIXTURE_EVENTS, 8_000), 'demo://front-door');
}

/** Fixture §3.4 payloads. Snapshots are data URLs — a demo has no bucket to sign against. */
const FIXTURE_EVENTS: readonly OverlayMessage[] = [
  {
    event_id: 'demo_overlay_0947',
    description: 'A white van parks at the kerb and a driver leaves a medium parcel at the door.',
    snapshot_url:
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
          '<rect width="320" height="180" fill="#0d1016"/>' +
    '<rect x="0.5" y="0.5" width="319" height="179" fill="none" stroke="#2b3240"/>' +
          '<rect x="60" y="100" width="120" height="50" rx="6" fill="#2b3240"/>' +
          '<circle cx="90" cy="155" r="8" fill="#9aa4b5"/><circle cx="150" cy="155" r="8" fill="#9aa4b5"/>' +
          '<text x="160" y="30" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#9aa4b5">demo snapshot placeholder</text>' +
          '</svg>',
      ),
    timestamp: '2026-10-04T09:47:02.000Z',
    device_name: 'Front Door',
  },
  {
    event_id: 'demo_overlay_0812',
    description: 'A person in a dark jacket walks up the path and rings the doorbell.',
    snapshot_url:
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
          '<rect width="320" height="180" fill="#0d1016"/>' +
    '<rect x="0.5" y="0.5" width="319" height="179" fill="none" stroke="#2b3240"/>' +
          '<circle cx="150" cy="70" r="14" fill="#2b3240"/>' +
          '<rect x="128" y="90" width="44" height="60" rx="6" fill="#2b3240"/>' +
          '<text x="160" y="30" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#9aa4b5">demo snapshot placeholder</text>' +
          '</svg>',
      ),
    timestamp: '2026-10-04T08:12:31.000Z',
    device_name: 'Front Door',
  },
  {
    event_id: 'demo_overlay_1845',
    description: 'Someone approaches the door, waits a moment, and walks away without ringing.',
    snapshot_url:
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
          '<rect width="320" height="180" fill="#0d1016"/>' +
    '<rect x="0.5" y="0.5" width="319" height="179" fill="none" stroke="#2b3240"/>' +
          '<text x="160" y="95" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#9aa4b5">demo snapshot placeholder</text>' +
          '</svg>',
      ),
    timestamp: '2026-10-04T18:45:19.000Z',
    device_name: 'Front Door',
  },
];

main();
