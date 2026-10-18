/**
 * Demo entry point: the dashboard rendering fixture data, with no backend.
 *
 * Everything on the page is the production path — `load()` from `app.ts`, the response
 * validation in `api.ts`, every string from `view.ts`. The only fake thing is the
 * transport, which returns a fixed `TodayResponse` instead of touching the network: the
 * same substitution the tests make.
 *
 * It exists because nothing in this repository is deployed, and the submission checklist's
 * "working demo accessible to judges" otherwise has nothing to point at. The page says the
 * data is a fixture; the code underneath it is not.
 */

import { load } from './app';
import type { FetchLike, TodayResponse } from './api';

/**
 * A placeholder frame, drawn rather than fetched. The real thing is a Ring JPEG from a
 * private bucket; a demo page with no backend has nothing to sign a URL against, so the
 * fixture carries an image that renders without one.
 */
const SNAPSHOT_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
    // Deliberately NOT the panel colour. An earlier version filled this #181d27, which is
    // exactly the card background, so the snapshot rendered as an empty box with a thin
    // artefact in it and read as a broken image on the demo page.
    '<rect width="320" height="180" fill="#0d1016"/>' +
    '<rect x="0.5" y="0.5" width="319" height="179" fill="none" stroke="#2b3240"/>' +
    '<rect x="144" y="66" width="32" height="76" rx="2" fill="#2b3240"/>' +
    '<circle cx="170" cy="106" r="2.5" fill="#7fd1c1"/>' +
    '<text x="160" y="30" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#9aa4b5">demo snapshot placeholder</text>' +
    '</svg>',
)}`;

/** A fixed day, shaped exactly like `GET /events/today` returns. */
export const demoResponse: TodayResponse = {
  date: '2026-10-04',
  count: 4,
  truncated: false,
  summary: {
    summary:
      'A quiet day with two callers: one rang the bell in the morning, and a courier left a parcel just before ten. The afternoon motion is still being described.',
    source: 'ai',
    event_count: 4,
    generated_at: '2026-10-04T21:00:05.000Z',
  },
  events: [
    {
      event_id: 'demo_0812',
      timestamp: '2026-10-04T08:12:31.000Z',
      device_name: 'Front Door',
      event_type: 'motion_detected',
      sub_type: 'human',
      description: 'A person in a dark jacket walks up the path and rings the doorbell.',
      snapshot_url: SNAPSHOT_PLACEHOLDER,
      processed: true,
    },
    {
      event_id: 'demo_0947',
      timestamp: '2026-10-04T09:47:02.000Z',
      device_name: 'Front Door',
      event_type: 'motion_detected',
      sub_type: 'vehicle',
      description: 'A white van parks at the kerb and a driver leaves a medium parcel at the door.',
      snapshot_url: SNAPSHOT_PLACEHOLDER,
      processed: true,
    },
    {
      event_id: 'demo_1302',
      timestamp: '2026-10-04T13:02:44.000Z',
      event_type: 'motion_detected',
      sub_type: 'other_motion',
      description: null,
      snapshot_url: null,
      processed: false,
    },
    {
      event_id: 'demo_1845',
      timestamp: '2026-10-04T18:45:19.000Z',
      event_type: 'motion_detected',
      sub_type: 'human',
      description: 'Someone approaches the door, waits a moment, and walks away without ringing.',
      snapshot_url: null,
      processed: true,
    },
  ],
};

/**
 * The demo transport. It ignores the URL and the key entirely: there is no endpoint behind
 * this page, so there is nothing for a key to unlock and nothing for a URL to select.
 */
export const demoFetch: FetchLike = async () => ({
  ok: true,
  status: 200,
  json: async () => demoResponse,
});

/** The whole entry point. Exported so a test can drive it against the fake DOM. */
export function startDemo(): void {
  const root = document.getElementById('app');
  if (root === null) return;
  void load(root, demoFetch, '', '');
}

startDemo();
