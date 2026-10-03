#!/usr/bin/env node
// scripts/build-firetv.mjs
//
// Bundles the Fire TV overlay client into firetv/dist/ as a static page: one JS file,
// one CSS file, one HTML file. Mirrors scripts/build-web.mjs — the overlay is a browser
// surface (it is what loads inside a Vega WebView or a Fire OS Android WebView), so the
// line that matters is the same: platform 'browser', or esbuild would leave a require()
// a browser cannot execute.
//
// Reads nothing from the docs contract: the entry point is the one file in firetv/src
// whose job is to be an entry point. Not validated by scripts/verify-bundle.mjs — the
// overlay has no dependencies to inline and its output is not a Lambda.

import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIRETV = join(ROOT, 'firetv');
const OUT = join(FIRETV, 'dist');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const result = await build({
  entryPoints: [join(FIRETV, 'src', 'main.ts')],
  outfile: join(OUT, 'overlay.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  external: [],
  logLevel: 'warning',
  metafile: true,
});

writeFileSync(join(OUT, 'overlay.html'), readFileSync(join(FIRETV, 'overlay.html')));
writeFileSync(join(OUT, 'overlay.css'), readFileSync(join(FIRETV, 'overlay.css')));

const inputs = Object.keys(result.metafile.inputs);
const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`build-firetv: bundled ${inputs.length} module(s) into firetv/dist/`);
for (const input of inputs) console.log(`  - ${input.replace(ROOT + '/', '')}`);
console.log(`build-firetv: ${bytes} bytes total, no dependencies to inline`);
console.log('build-firetv: serve firetv/dist/ as static files; open overlay.html for the');
console.log('build-firetv: fixture demo, or overlay.html?endpoint=wss://… to go live');
