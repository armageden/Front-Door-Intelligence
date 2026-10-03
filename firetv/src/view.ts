/**
 * Every string the TV shows. Pure, DOM-free, unit-tested — the same rule as the
 * dashboard's `view.ts`.
 *
 * The overlay shows one moment, not a day, so its honesty obligations are narrower than
 * the dashboard's but just as load-bearing: a homeowner glancing up from the couch reads
 * exactly one sentence, one device line, and one connection state. If the socket is down,
 * the screen says so — a silent overlay reads as "nothing is at the door", which is a
 * confident false statement about someone's home.
 */

import type { ClientStatus, OverlayMessage } from './client';

/** `18:45 UTC` — the timestamp as pushed, not localized. Same rule as the dashboard. */
export function formatClock(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const hours = String(parsed.getUTCHours()).padStart(2, '0');
  const minutes = String(parsed.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes} UTC`;
}

/** The connection line, always visible. A TV that stopped trying must not look live. */
export function formatStatus(status: ClientStatus): string {
  switch (status.kind) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Live';
    case 'reconnecting':
      return `Reconnecting (attempt ${status.attempt})…`;
  }
}

/**
 * The device line. §3.4 makes `device_name` required and the push stage already falls
 * back to the device id when the name never resolved, so there is no unknown case here —
 * whatever arrives is shown verbatim rather than second-guessed.
 */
export function formatDevice(message: OverlayMessage): string {
  return message.device_name;
}
