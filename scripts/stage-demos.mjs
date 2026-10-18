#!/usr/bin/env node
// scripts/stage-demos.mjs
//
// Stages the hosted demo site into site/: the dashboard under dashboard/, the overlay
// client under overlay/, and scripts/demo-landing.html as the site root. This is the
// exact staging .github/workflows/demos.yml performs in CI, extracted so the same code
// runs locally — the hosted experience is previewable, and the staging itself is
// exercised, without a push:
//
//   node scripts/stage-demos.mjs
//   npx serve site        # or any static server; the root is the landing page
//
// The landing page's links are relative to the staged root (./dashboard/, ./overlay/),
// which is why opening scripts/demo-landing.html straight from the repository 404s:
// the sibling directories only exist after this staging. site/ is gitignored — it is
// assembled output, like dist/, and CI rebuilds it on every push.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');

const SOURCES = [
  { from: join(ROOT, 'web', 'dist'), to: join(SITE, 'dashboard'), label: 'web/dist (dashboard)' },
  { from: join(ROOT, 'firetv', 'dist'), to: join(SITE, 'overlay'), label: 'firetv/dist (overlay)' },
];

for (const source of SOURCES) {
  if (!existsSync(source.from)) {
    console.error(`stage-demos: ${source.label} does not exist. Build first:`);
    console.error('stage-demos:   npm run build:web && npm run build:firetv');
    process.exit(1);
  }
}

rmSync(SITE, { recursive: true, force: true });
for (const source of SOURCES) {
  mkdirSync(source.to, { recursive: true });
  cpSync(source.from, source.to, { recursive: true });
}
cpSync(join(ROOT, 'scripts', 'demo-landing.html'), join(SITE, 'index.html'));

function count(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) n += count(full);
    else n += 1;
  }
  return n;
}

console.log(`stage-demos: staged ${count(SITE)} files into site/`);
console.log('stage-demos: serve site/ with any static server — the root is the landing page');
console.log('stage-demos: start at /dashboard/pipeline.html (the whole chain), then /dashboard/demo.html and /overlay/overlay.html');
