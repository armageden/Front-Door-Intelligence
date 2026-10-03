#!/usr/bin/env node
// scripts/build-web.mjs
//
// Bundles the dashboard into web/dist/ as a static site: two JS files (the live page and
// the demo page), one CSS file, two HTML files. No framework, no bundler plugin, no
// dependencies beyond the esbuild the Lambda build already uses.
//
// Why a build step at all, for four source files:
//
//   - The browser needs one module URL, not three. `src/main.ts` imports `app.ts`, which
//     imports `api.ts` and `view.ts`, and the browser cannot resolve those bare specifiers
//     itself. esbuild inlines them.
//   - It gives a single mechanical answer to "did it still parse", which is the same
//     reasoning behind scripts/build-lambda.mjs.
//
// Reads nothing from the docs contract, exactly like build-lambda.mjs: the entry point is
// the one file in web/src whose job is to be an entry point.
//
// Not validated by scripts/verify-bundle.mjs, which asserts the Lambda bundles in dist/
// carry their dependencies. The dashboard has no dependencies to inline, and its output is
// not a Lambda.

import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const OUT = join(WEB, 'dist');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const result = await build({
  // Two entry points, one bundle each: app.js for the live page, demo.js for the fixture
  // demo. The object form pins the output names — plain entryPoints with outdir would emit
  // main.js and break index.html's ./app.js reference.
  entryPoints: [
    { in: join(WEB, 'src', 'main.ts'), out: 'app' },
    { in: join(WEB, 'src', 'demo.ts'), out: 'demo' },
  ],
  outdir: OUT,
  bundle: true,
  // Browser, not node. The single most important line in this file: with platform: 'node'
  // esbuild would happily leave a require() that a browser cannot execute.
  platform: 'browser',
  format: 'esm',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  external: [],
  logLevel: 'warning',
  metafile: true,
});

// The HTML and CSS are copied rather than inlined, so index.html keeps relative
// references and the page needs no server-side templating.
writeFileSync(join(OUT, 'index.html'), readFileSync(join(WEB, 'index.html')));
writeFileSync(join(OUT, 'demo.html'), readFileSync(join(WEB, 'demo.html')));
writeFileSync(join(OUT, 'app.css'), readFileSync(join(WEB, 'app.css')));

const inputs = Object.keys(result.metafile.inputs);
const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`build-web: bundled ${inputs.length} module(s) into web/dist/`);
for (const input of inputs) console.log(`  - ${input.replace(ROOT + '/', '')}`);
console.log(`build-web: ${bytes} bytes total, no dependencies to inline`);
console.log('build-web: serve web/dist/ as static files (any static host, or `npx serve`)');
console.log('build-web: open demo.html for the fixture demo — no backend needed');