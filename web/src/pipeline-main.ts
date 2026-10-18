/**
 * Entry point for the pipeline demo. Nothing but wiring the Replay button.
 *
 * Separate from `pipeline.ts` so a test can import the module without the sequence starting
 * as a side effect of the import — the same split `app.ts` and `main.ts` use.
 */

import { startPipeline } from './pipeline';

const root = document.getElementById('app');
if (root !== null) {
  const pipeline = startPipeline(root);
  document.getElementById('replay')?.addEventListener('click', () => {
    pipeline.replay();
  });
}
