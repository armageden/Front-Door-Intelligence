#!/usr/bin/env node
// scripts/verify-bundle.mjs
//
// Asserts that everything in dist/ is self-contained, so `CodeUri: dist/` in
// template.yaml deploys a Lambda that can actually start.
//
// The failure this guards against is quiet and total: tsc emit ships bare
// `require('@aws-sdk/client-dynamodb')` calls, the Lambda starts, and the first
// webhook invocation dies on a module-not-found. Nothing in `sam build` reports it.
//
// Exits 1 if any bundled file requires a package it did not inline.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Node built-ins are always available at runtime; they are not missing dependencies.
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'https',
  'net', 'os', 'path', 'process', 'stream', 'string_decoder', 'timers', 'tls', 'url',
  'util', 'worker_threads', 'zlib',
]);

if (!existsSync(DIST)) {
  console.error('verify-bundle: dist/ does not exist. Run `npm run build` first.');
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk(DIST);
if (files.length === 0) {
  console.error('verify-bundle: dist/ contains no JavaScript. Run `npm run build` first.');
  process.exit(1);
}

const problems = [];
let checkedRequires = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const m of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1];
    checkedRequires++;
    if (spec.startsWith('.') || spec.startsWith('/')) continue;      // relative, resolved
    if (NODE_BUILTINS.has(spec)) continue;
    if (spec.startsWith('node:')) continue;
    if (existsSync(join(ROOT, 'node_modules', spec))) {
      problems.push({
        file: file.slice(ROOT.length + 1),
        spec,
        line: source.slice(0, m.index).split('\n').length,
      });
    }
  }
}

if (problems.length > 0) {
  console.error(`verify-bundle: FAIL — ${problems.length} external require(s) not bundled`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  requires "${p.spec}"`);
  }
  console.error('  These would be missing at runtime. Bundle the entry points.');
  process.exit(1);
}

console.log(
  `verify-bundle: PASS — ${files.length} file(s), ${checkedRequires} require() call(s), none external`,
);
for (const f of files) console.log(`  ${f.slice(ROOT.length + 1)} (${basename(f)})`);
