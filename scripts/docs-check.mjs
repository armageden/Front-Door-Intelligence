#!/usr/bin/env node
// scripts/docs-check.mjs
//
// Mechanical documentation validator. Reads its entire configuration from the
// contract at docs/.docsrc.json — paths, commands, globs, subject layout, secret
// patterns, and marker syntax all come from there. Nothing about this repository
// is hardcoded below.
//
//   node scripts/docs-check.mjs
//
// Checks
//   1  every code path referenced in backticks exists on disk
//   2  every subject folder has 00-overview.md; TOC targets exist and are complete
//   3  every sub-file links back to its own overview
//   4  no broken relative markdown links or dead anchors inside docs
//   5  reverse coverage: files matching routeGlobs/handlerGlobs are documented
//   6  no obvious secrets in documentation
//   7  no absolute local filesystem paths in documentation
//   8  every sub-file declares what it was verified against
//   9  the docs layout matches the contract (no silent renumbering, and every
//      subject is reachable from each configured docs index)
//
// Exits 1 on any failure.
//
// LIMITATION: this proves structure, not truth. It cannot confirm that a
// documented auth requirement, status code, or parameter matches the handler,
// because it does not read semantics. A pass is never evidence that the docs are
// correct. See docs/03-repository/03-verification-commands.md.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- load contract

const CONTRACT_PATH = join(ROOT, 'docs', '.docsrc.json');
if (!existsSync(CONTRACT_PATH)) {
  console.error('docs-check: contract not found at docs/.docsrc.json');
  console.error('Every path, command, and subject in this system is defined there.');
  process.exit(1);
}

let C;
try {
  C = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
} catch (e) {
  console.error('docs-check: contract is not valid JSON — ' + e.message);
  process.exit(1);
}

const PV = C.pathVerification;
const M = C.markers;
const IGNORED_DIRS = new Set(['.git', 'node_modules']);

// ---------------------------------------------------------------- reporting

const problems = [];
const notes = [];

/** check, file, line, message, hint — line and hint are what make this actionable. */
function fail(check, file, line, msg, hint) {
  problems.push({ check, file, line: line ?? null, msg, hint: hint ?? null });
}

// ---------------------------------------------------------------- globs

/** Minimal glob -> RegExp. Supports **, *, ?, and {a,b} alternation. */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { out += '(?:[^/]+/)*'; i += 2; }
        else { out += '.*'; i += 1; }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) { out += '\\{'; continue; }
      const alts = glob.slice(i + 1, close).split(',');
      out += '(?:' + alts.map((a) => globToRegExp(a).source.replace(/^\^|\$$/g, '')).join('|') + ')';
      i = close;
    } else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}

const compiled = (globs) => (globs || []).map(globToRegExp);
const matchesAny = (res, p) => res.some((r) => r.test(p));

/** Contract regexes may carry a leading (?i); JavaScript needs it as a flag. */
function buildRegExp(pattern, extra = '') {
  const caseInsensitive = /^\(\?i\)/.test(pattern);
  const body = pattern.replace(/^\(\?i\)/, '');
  return new RegExp(body, (caseInsensitive ? 'i' : '') + extra);
}

// ---------------------------------------------------------------- file walking

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (p) => (p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p);
const read = (p) => readFileSync(p, 'utf8');
const allFiles = walk(ROOT);

function isExcluded(p) {
  return matchesAny(compiled(C.paths.excludeGlobs), p);
}

// ---------------------------------------------------------------- documents

function expandDocGlobs(globs) {
  const res = compiled(globs);
  const wanted = allFiles.filter((f) => f.endsWith('.md') && !isExcluded(rel(f)));
  const picked = wanted.filter((f) => matchesAny(res, rel(f)));
  return picked.length > 0 ? picked : wanted;
}

const docFiles = expandDocGlobs(PV.docFilesScanned);
const secretFiles = [...new Set([...docFiles, ...expandDocGlobs(PV.secretsAlsoScan || [])])];

/**
 * Single pass classifying every line as fenced, inside a planned-skip region, or
 * live. One pass matters: a skip marker shown *inside* a fenced example is
 * documentation of the syntax, not a live marker, while a real skip region
 * wrapping a fence must still be recognised. Separate passes get one or both wrong.
 */
function classify(markdown) {
  const out = [];
  let fence = null;
  let planned = false;
  markdown.split('\n').forEach((line, i) => {
    const at = i + 1;
    if (fence === null) {
      const bare = line.replace(/`{1,3}[^`\n]*?`{1,3}/g, '');
      if (bare.includes(M.skipPlanned)) { planned = true; out.push({ line, at, fenced: false, planned: true }); return; }
      if (bare.includes(M.skipPlannedEnd)) { planned = false; out.push({ line, at, fenced: false, planned: true }); return; }
    }
    const fm = line.match(/^\s*(`{3,}|~{3,})/);
    if (fm) {
      if (fence === null) fence = fm[1][0];
      else if (fm[1][0] === fence) fence = null;
      out.push({ line, at, fenced: true, planned });
      return;
    }
    out.push({ line, at, fenced: fence !== null, planned });
  });
  return { lines: out, unterminated: planned };
}

const codeSpans = (line) => [...line.matchAll(/`{1,3}([^`\n]+?)`{1,3}/g)].map((m) => m[1].trim());
// Links inside inline code spans are illustrations of syntax, not live references —
// same reasoning as fenced blocks. Path existence is still checked for them by
// check 1, so nothing is lost.
const linksOn = (line) =>
  [...line.replace(/`{1,3}[^`\n]*?`{1,3}/g, ' ').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);

function declaredAbsent(markdown) {
  const set = new Set();
  const esc = M.expectAbsent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of markdown.matchAll(new RegExp(esc + '\\s+([\\s\\S]*?)-->', 'g'))) {    for (const tok of m[1].trim().split(/\s+/)) if (tok) set.add(tok);
  }
  return set;
}

const cleanTarget = (raw) => raw.trim().replace(/^<|>$/g, '').replace(/[.,;:)]+$/, '');

// ------------------------------------------------------- path verification

const allBaseNames = new Set(allFiles.map((f) => basename(f)));

function looksLikePath(token) {
  if (!token) return false;
  if (/\s/.test(token)) return false;                 // command or prose
  if (token.includes('<') || token.includes('>')) return false; // <placeholder>
  if (token.includes('*')) return false;               // glob
  if (token.includes('://')) return false;             // url
  if (token.includes('=')) return false;               // assignment
  if (token.startsWith('-')) return false;             // flag
  if (token.endsWith('/')) return false;               // bare directory mention
  if (token.includes('(') || token.includes(')')) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(token)) return false;   // ENV_VAR

  const ext = extname(token);
  if (PV.extensions.includes(ext)) return true;
  if (!ext && (PV.extensionless.includes(token) || token.startsWith('.'))) return true;
  return false;
}

function pathExists(token) {
  const clean = token.replace(/#.*$/, '');
  if (PV.projectFiles.includes(clean)) return true;
  if (clean.includes('/')) {
    if (matchesAny(compiled(PV.roots), clean)) return existsSync(join(ROOT, clean));
    // A path outside the declared roots can only be satisfied by existing outright.
    return existsSync(join(ROOT, clean));
  }
  if (PV.basenameFallback && allBaseNames.has(clean)) return true;
  return existsSync(join(ROOT, clean));
}

/** Best-effort suggestion so a failure tells you what to type instead. */
function suggest(token) {
  const base = basename(token.replace(/#.*$/, ''));
  const sameBase = allFiles
    .map(rel)
    .filter((p) => basename(p) === base && p !== token)
    .slice(0, 3);
  if (sameBase.length) return 'did you mean ' + sameBase.join(', ') + '?';
  const dir = token.includes('/') ? token.slice(0, token.lastIndexOf('/')) : '';
  if (dir && !existsSync(join(ROOT, dir))) return 'no such directory: ' + dir;
  return null;
}

const referencedPaths = new Set();
const skipReport = [];
const absentReport = [];

// ---- check 1: referenced paths exist, or are declared absent / marked planned

for (const file of docFiles) {
  const markdown = read(file);
  const r = rel(file);
  const declared = declaredAbsent(markdown);
  const { lines, unterminated } = classify(markdown);
  if (unterminated) {
    fail(1, r, null, 'unterminated ' + M.skipPlanned + ' marker',
      'add ' + M.skipPlannedEnd + ' before the end of the file');
  }

  for (const p of declared) {
    if (pathExists(p)) {
      fail(1, r, markdown.split('\n').findIndex((l) => l.includes(p)) + 1,
        'declared absent but the path now exists: `' + p + '`',
        'remove ' + p + ' from the ' + M.expectAbsent + ' declaration');
    } else {
      absentReport.push({ file: r, token: p });
    }
  }

  for (const { line, at, fenced, planned } of lines) {
    for (const token of codeSpans(line)) {
      if (!looksLikePath(token)) continue;
      if (planned) { skipReport.push({ file: r, token }); continue; }
      if (fenced) continue;
      const clean = token.replace(/#.*$/, '');
      if (pathExists(token)) { referencedPaths.add(clean); continue; }
      if (declared.has(clean)) continue;
      const hint = suggest(token) || 'create the file, use a <placeholder>, or add it to the ' + M.expectAbsent + ' declaration';
      fail(1, r, at, 'referenced path does not exist: `' + token + '`', hint);
    }
  }
}

// ------------------------------------------------ subject layout + overview

const subjectFolders = (C.subjects || []).map((s) => s.folder);
const docsRoot = join(ROOT, C.paths.docsRoot);

const actualFolders = existsSync(docsRoot)
  ? readdirSync(docsRoot).filter((e) => statSync(join(docsRoot, e)).isDirectory()).sort()
  : [];

// ---- check 9: layout matches the contract (forbids silent renumbering)

if (subjectFolders.length === 0) {
  fail(9, rel(CONTRACT_PATH), null, 'contract defines no subjects', 'add a subjects array');
}
const seenOrders = new Set();
for (const s of C.subjects || []) {
  if (seenOrders.has(s.order)) {
    fail(9, rel(CONTRACT_PATH), null, 'duplicate order ' + s.order + ' for subject id "' + s.id + '"', 'orders must be unique');
  }
  seenOrders.add(s.order);
  if (!/^\d\d-/.test(s.folder)) {
    fail(9, rel(CONTRACT_PATH), null, 'subject folder "' + s.folder + '" is not NN-prefixed', 'use a two-digit prefix, e.g. 04-thing');
  }
  if (Number(s.folder.slice(0, 2)) !== s.order) {
    fail(9, rel(CONTRACT_PATH), null,
      'subject "' + s.id + '" has folder ' + s.folder + ' but order ' + s.order,
      'the NN prefix must equal order, or change both together');
  }
  if (!existsSync(join(docsRoot, s.folder))) {
    fail(9, rel(CONTRACT_PATH), null, 'contract subject "' + s.id + '" has no folder at ' + s.folder + '/',
      'create the folder with a 00-overview.md, or remove the subject');
  }
}
for (const folder of actualFolders) {
  if (!subjectFolders.includes(folder)) {
    fail(9, rel(join(docsRoot, folder)), null, 'folder is not declared in the contract',
      'add a subjects entry with order ' + Number(folder.slice(0, 2)) + ', or remove the folder');
  }
}

// ---- check 9: every subject must be reachable from each configured docs index
for (const indexRel of C.docsIndexes || []) {
  const indexPath = join(ROOT, indexRel);
  if (!existsSync(indexPath)) {
    fail(9, indexRel, null, 'docs index declared in the contract does not exist',
      'create it, or remove it from docsIndexes in the contract');
    continue;
  }
  const body = read(indexPath);
  const resolved = new Set();
  for (const { line, fenced } of classify(body).lines) {
    if (fenced) continue;
    for (const raw of linksOn(line)) {
      const t = cleanTarget(raw);
      if (!t || t.includes('://') || t.includes('<')) continue;
      resolved.add(resolve(dirname(indexPath), t.split('#')[0]));
    }
  }
  for (const s of C.subjects || []) {
    const literal = body.includes('docs/' + s.folder + '/');
    const byLink = [...resolved].some((p) => p.startsWith(join(ROOT, C.paths.docsRoot, s.folder) + '/'));
    if (!literal && !byLink) {
      fail(9, indexRel, null, 'subject "' + s.id + '" is not reachable from this index',
        'add a row pointing at docs/' + s.folder + '/00-overview.md');
    }
  }
}

for (const folder of subjectFolders) {
  const dir = join(docsRoot, folder);
  if (!existsSync(dir)) continue;
  const overview = join(dir, '00-overview.md');

  // ---- check 2: the overview must exist
  if (!existsSync(overview)) {
    fail(2, rel(dir) + '/', null, 'subject folder has no 00-overview.md',
      'create it with subject name, folder path, "read this when" purpose, and a TOC');
    continue;
  }
  const overviewText = read(overview);

  // ---- check 2: every link in the overview resolves
  for (const { line, at, fenced } of classify(overviewText).lines) {
    if (fenced) continue;
    for (const raw of linksOn(line)) {
      const target = cleanTarget(raw);
      if (!target || target.startsWith('#') || target.includes('://')) continue;
      if (target.includes('<') || target.includes('>')) continue;
      const resolved = resolve(dir, target);
      if (resolved !== ROOT && !resolved.startsWith(ROOT + '/')) {
        fail(2, rel(overview), at, 'overview link escapes the repository root: ' + target, 'use a path inside the repo');
      } else if (!existsSync(resolved)) {
        fail(2, rel(overview), at, 'overview links to a missing file: ' + target,
          suggest(target) || 'create it, or drop it from the TOC');
      }
    }
  }

  const subFiles = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== '00-overview.md').sort();

  // ---- check 2: the TOC must list every sibling
  for (const sib of subFiles) {
    if (!overviewText.includes('./' + sib)) {
      fail(2, rel(overview), null, 'sub-file missing from the overview TOC: ./' + sib,
        'add a row to the contents table with a one-line description');
    }
  }

  for (const sib of subFiles) {
    const body = read(join(dir, sib));
    const r = rel(join(dir, sib));
    const head = body.split('\n').slice(0, 6).join('\n');

    // ---- check 3: backlink to the overview
    if (!/\*\*Back:\*\*\s*\[00-overview\]\(\.\/00-overview\.md\)/.test(head)) {
      fail(3, r, 1, 'missing backlink to 00-overview.md',
        'the first line should be: **Back:** [00-overview](./00-overview.md)');
    }

    // ---- check 8: provenance line
    if (C.provenance.requireLine) {
      const ok = C.provenance.linePatterns.some((p) => head.includes(p));
      if (!ok) {
        fail(8, r, 1, 'no ' + C.provenance.linePatterns[0] + ' line',
          'add a line starting "' + C.provenance.linePatterns[0] + '" naming the file and section (plus symbol if any), and say plainly if it is unverified against code');
      }
    }
  }
}

// ------------------------------------------------ check 4: relative links

const headingCache = new Map();
function slugsFor(file) {
  if (headingCache.has(file)) return headingCache.get(file);
  const slugs = new Set();
  const { lines } = classify(read(file));
  for (const { line, fenced } of lines) {
    if (fenced) continue;
    const m = line.match(/^#{1,6}\s+(.*?)\s*$/);
    if (!m) continue;
    slugs.add(
      m[1].toLowerCase().replace(/[`*_~]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'),
    );
  }
  headingCache.set(file, slugs);
  return slugs;
}

for (const file of docFiles) {
  const r = rel(file);
  const { lines } = classify(read(file));
  for (const { line, at, fenced } of lines) {
    if (fenced) continue;
    for (const raw of linksOn(line)) {
      const target = cleanTarget(raw);
      if (!target || target.includes('://') || target.startsWith('mailto:')) continue;
      if (target.includes('<') || target.includes('>')) continue;

      const [pathPart, anchor] = target.split('#');
      const resolved = pathPart ? resolve(dirname(file), pathPart) : file;

      if (resolved !== ROOT && !resolved.startsWith(ROOT + '/')) {
        fail(4, r, at, 'link escapes the repository root: ' + target,
          'a link that climbs out of the repo can resolve on one machine and break on another');
        continue;
      }
      if (!existsSync(resolved)) {
        fail(4, r, at, 'broken link: ' + target, suggest(target) || 'fix the relative path or drop the link');
        continue;
      }
      if (anchor && resolved.endsWith('.md')) {
        if (!slugsFor(resolved).has(anchor.toLowerCase())) {
          fail(4, r, at, 'link anchor not found in target: ' + target,
            'valid headings: ' + [...slugsFor(resolved)].slice(0, 6).join(', '));
        }
      }
    }
  }
}

// ------------------------------------------------ check 5: reverse coverage

const coverageGlobs = [...(C.paths.routeGlobs || []), ...(C.paths.handlerGlobs || [])];
const allowlist = C.reverseCoverage.intentionallyUndocumented || [];
const allowSet = new Map(allowlist.map((e) => [e.path, e.reason]));

let coverageApplicable = coverageGlobs.length > 0;
const coverageFiles = coverageGlobs.length
  ? allFiles
      .map(rel)
      .filter((p) => matchesAny(compiled(coverageGlobs), p) && !isExcluded(p))
  : [];

if (!coverageApplicable) {
  notes.push([
    'check 5  reverse coverage is NOT APPLICABLE',
    '          ' + (C.paths.routeGlobsNote || 'no routeGlobs or handlerGlobs configured'),
    '          This is not a pass. It becomes a real check once code lands and the',
    '          globs are filled in. See docs/00-how-to/05-open-a-new-code-subject.md',
  ].join('\n'));
} else {
  for (const p of coverageFiles) {
    if (allowSet.has(p)) {
      skipReport.push({ file: p, token: 'allowlisted: ' + allowSet.get(p) });
      continue;
    }
    const covered = [...referencedPaths].some((rp) => rp === p || rp.endsWith('/' + basename(p)));
    if (!covered) {
      fail(5, p, null, 'file matches routeGlobs/handlerGlobs but is not referenced by path in any doc',
        'add `' + p + '` to the relevant subject, or list it in reverseCoverage.intentionallyUndocumented with a reason');
    }
  }
}

// ------------------------------------------------ checks 6 and 7

const hints = (C.secrets.placeholderHints || []).map((h) => h.toLowerCase());

for (const file of secretFiles) {
  const r = rel(file);
  const text = read(file);
  const { lines } = classify(text);

  for (const [name, pattern] of (C.secrets.providerPatterns || []).map((p) => [p.name, buildRegExp(p.regex, 'g')])) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const at = text.slice(0, m.index).split('\n').length;
      const around = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
      if (hints.some((h) => around.includes(h) || m[0].toLowerCase().includes(h))) continue;
      fail(6, r, at, 'possible ' + name + ' committed in documentation',
        'remove the value; if it is a placeholder, make it obviously fake (e.g. your_token_here)');
    }
  }

  const generic = buildRegExp(C.secrets.genericAssignment.regex, 'g');
  let g;
  while ((g = generic.exec(text)) !== null) {
    const value = g[2] || '';
    const at = text.slice(0, g.index).split('\n').length;
    if (hints.some((h) => value.toLowerCase().includes(h))) continue;
    if (C.secrets.genericAssignment.requireMixedEntropy) {
      const hasUpper = /[A-Z]/.test(value);
      const hasLower = /[a-z]/.test(value);
      const hasDigit = /[0-9]/.test(value);
      if (!(value.length >= 16 && hasUpper && hasLower && hasDigit)) continue;
    }
    fail(6, r, at, 'possible credential assigned inline: ' + g[1],
      'never commit a real value; name the variable and point at the env template instead');
  }

  for (const { line, at } of lines) {
    for (const prefix of C.absolutePathPrefixes.prefixes) {
      const idx = line.indexOf(prefix);
      if (idx === -1) continue;
      const snippet = line.slice(idx, idx + 60).split(/[\s`"')|]+/)[0];
      fail(7, r, at, 'absolute local filesystem path: ' + snippet,
        'use a repo-relative path so the doc works on every machine');
    }
  }
}

// ---------------------------------------------------------------- report

const out = [];
const say = (s = '') => out.push(s);

say();
say('  docs-check  ' + rel(ROOT) || '.');
say();
say('  contract    ' + rel(CONTRACT_PATH) + '  (v' + C.contractVersion + ')');
say('  documents   ' + docFiles.length + ' scanned, ' + secretFiles.length + ' scanned for secrets');
say('  subjects    ' + (C.subjects || []).length + ' declared in the contract');
say();
say('  1  referenced code paths exist (or are declared absent)');
say('  2  every subject folder has 00-overview.md; TOC complete and resolvable');
say('  3  every sub-file backlinks to its overview');
say('  4  relative markdown links and anchors resolve');
say('  5  reverse coverage of routeGlobs/handlerGlobs');
say('  6  no obvious secrets in documentation');
say('  7  no absolute local filesystem paths');
say('  8  every sub-file declares what it was verified against');
say('  9  docs layout matches the contract');
say();
for (const n of notes) { say('  ' + n); say(); }

if (skipReport.length) {
  say('  exemptions honoured (' + skipReport.length + '):');
  for (const s of skipReport) say('    - ' + s.token + '   (' + s.file + ')');
  say('  Every exemption is listed on every run, so none can become permanent.');
  say();
}
if (absentReport.length) {
  say('  declared absent, confirmed missing (' + absentReport.length + '):');
  for (const s of absentReport) say('    - ' + s.token + '   (' + s.file + ')');
  say('  Each declaration fails automatically once the file is created.');
  say();
}

if (problems.length) {
  const byCheck = new Map();
  for (const p of problems) {
    if (!byCheck.has(p.check)) byCheck.set(p.check, []);
    byCheck.get(p.check).push(p);
  }
  say('  FAIL — ' + problems.length + ' problem(s)');
  say();
  for (const [check, list] of [...byCheck.entries()].sort((a, b) => a[0] - b[0])) {
    say('  check ' + check + '  (' + list.length + ')');
    for (const p of list) {
      say('    ' + p.file + (p.line ? ':' + p.line : ''));
      say('      ' + p.msg);
      if (p.hint) say('      fix: ' + p.hint);
    }
    say();
  }
  say('  Structure does not hold. Note that this validator cannot tell whether the');
  say('  docs are TRUE — only whether they are well-formed and refer to real files.');
  say('');
  console.log(out.join('\n'));
  process.exit(1);
}

say('  PASS — documentation structure holds.');
say('  This is not a correctness check. Read the source, and get the docs reviewed.');
say('');

console.log(out.join('\n'));
