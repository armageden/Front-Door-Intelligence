#!/usr/bin/env node
// scripts/build-lambda.mjs
//
// Bundles each Lambda entry point into dist/ as a self-contained CommonJS file.
//
// Why a bundler rather than plain `tsc` emit: the AWS SDK v3 is not present in the
// Node.js Lambda runtime, so a Lambda deployed as loose files needs its dependencies
// packaged alongside them. `tsc` only transpiles — it never copies node_modules — so
// `CodeUri: dist/` would ship a handler that cannot `require('@aws-sdk/...')`.
//
// Bundling makes dist/ self-contained and the correctness of that claim checkable:
// scripts/verify-bundle.mjs asserts the output has no bare external requires.
//
// Reads nothing from the docs contract; the entry points are the Lambda handlers,
// which are exactly the files under src/handlers/.

import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'handlers');
const OUT = join(ROOT, 'dist');

if (!readdirSync(SRC).some((f) => f.endsWith('.ts'))) {
  console.error('build-lambda: no entry points found in src/handlers/');
  process.exit(1);
}

const entryPoints = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => join(SRC, f));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints,
  outdir: OUT,
  // Without outbase, esbuild derives the common ancestor of the entry points as the
  // output root, which flattens src/handlers/webhookHandler.ts to
  // dist/webhookHandler.js. SAM's Handler property expects dist/handlers/…, so pin
  // the base to src/ to keep the directory structure.
  outbase: join(ROOT, 'src'),
  outExtension: { '.js': '.js' },
  bundle: true,
  platform: 'node',
  // CommonJS because the AWS SDK v3 CommonJS entry points are the stable path and SAM
  // loads .handler by default. See ADR D009.
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  minify: false,
  // Fail loudly rather than silently shipping a bundle that reaches for something
  // absent at runtime.
  external: [],
  logLevel: 'warning',
});

console.log(`build-lambda: bundled ${entryPoints.length} entry point(s) into dist/`);
for (const entry of entryPoints) {
  console.log(`  - ${entry.replace(ROOT + '/', '')}`);
}
