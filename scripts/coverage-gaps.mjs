#!/usr/bin/env node
// scripts/coverage-gaps.mjs
//
// Prints the uncovered statements of one file, with source, so a coverage gap can be read
// rather than guessed at. Reads the v8 JSON report; runs `npm run test:coverage` itself if
// the report is missing.
//
//   node scripts/coverage-gaps.mjs src/lib/dynamoClient.ts
//   node scripts/coverage-gaps.mjs --all
//
// Exists because the JSON reporter is not in the default reporter list: the suite writes
// coverage-summary.json (the number CI reads) and nothing else, so there was no way to ask
// *which* lines were uncovered without reconfiguring the run by hand every time.
//
// Reads nothing from the docs contract, like the other build scripts.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(ROOT, 'coverage', 'coverage-final.json');

if (!existsSync(REPORT)) {
  console.error('coverage-gaps: no coverage/coverage-final.json. Running the suite\u2026');
  const run = spawnSync('npx', ['vitest', 'run', '--coverage', '--coverage.reporter=json'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  if (run.status !== 0 || !existsSync(REPORT)) {
    console.error('coverage-gaps: coverage run failed; rerun `npm run test:coverage` by hand');
    process.exit(1);
  }
}

const cov = JSON.parse(readFileSync(REPORT, 'utf8'));
const wantAll = process.argv[2] === '--all';
const wanted = process.argv[2];

const files = Object.entries(cov)
  .map(([file, data]) => {
    const rel = relative(ROOT, file);
    const uncovered = Object.entries(data.s)
      .filter(([, count]) => count === 0)
      .map(([id]) => data.statementMap[id])
      .sort((a, b) => a.start.line - b.start.line);
    const uncoveredFunctions = Object.entries(data.f)
      .filter(([, count]) => count === 0)
      .map(([id]) => data.fnMap[id])
      .sort((a, b) => a.loc.start.line - b.loc.start.line);
    const uncoveredBranches = Object.entries(data.b).flatMap(([id, counts]) =>
      counts
        .map((count, index) => ({ count, index }))
        .filter((entry) => entry.count === 0)
        .map((entry) => data.branchMap[id].locations[entry.index] ?? data.branchMap[id].loc),
    );
    return { rel, uncovered, uncoveredFunctions, uncoveredBranches };
  })
  .filter((f) => (wantAll ? true : f.rel === wanted))
  .filter((f) => f.uncovered.length > 0 || f.uncoveredFunctions.length > 0)
  .sort((a, b) => b.uncovered.length - a.uncovered.length);

if (files.length === 0) {
  console.log(wantAll ? 'every file is fully covered.' : `no gaps recorded for ${wanted}`);
  process.exit(0);
}

for (const entry of files) {
  console.log(`\n=== ${entry.rel} ===`);
  if (entry.uncovered.length > 0) {
    console.log(`  ${entry.uncovered.length} uncovered statements:`);
    for (const statement of entry.uncovered) {
      const source = readFileSync(join(ROOT, entry.rel), 'utf8').split('\n')[statement.start.line - 1];
      console.log(`  L${String(statement.start.line).padStart(4)}  ${source.trim()}`);
    }
  }
  for (const fn of entry.uncoveredFunctions) {
    const source = readFileSync(join(ROOT, entry.rel), 'utf8').split('\n')[fn.loc.start.line - 1];
    console.log(`  fn L${String(fn.loc.start.line).padStart(4)}  ${fn.name} — ${source.trim()}`);
  }
  if (entry.uncoveredBranches.length > 0) {
    console.log(`  ${entry.uncoveredBranches.length} uncovered branches.`);
  }
}