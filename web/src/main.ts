/**
 * Entry point. Nothing but a call to `start()`.
 *
 * Kept separate from `app.ts` so the shell can be imported by a test without a side effect
 * running at import time.
 */

import { start } from './app';

start();