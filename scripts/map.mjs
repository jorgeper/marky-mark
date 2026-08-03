#!/usr/bin/env node
/**
 * npm run map (issue #35, prd/005-agent-context-hygiene.md §E): regenerate
 * docs/MAP.md — the "which file do I edit" index — from the SPEC citations
 * already in the tree. Inputs are read, never invented: docs/specs/*.md gives
 * the spec list and each spec's own `# ` title, and the `SPEC<n>` comments in
 * src/ and in the E-numbered e2e tests give the rows.
 *
 * Deterministic output: rows sorted by spec number, src files sorted within a
 * row, e2e attributions in citing-file order, no timestamps, no absolute
 * paths, byte-identical on rerun —
 * scripts/validate.mjs compares the committed file against a fresh render and
 * fails the gate (both tiers) when they differ.
 *
 * The pure core (parseSpec / citedSpecKeys / e2eCitations / buildRows /
 * renderMap) takes strings and returns strings so the unit suite can exercise
 * it without touching the filesystem; only readTree/main do I/O.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Source extensions scanned for citations under src/ (everything else is an asset). */
const SRC_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.html']);

/**
 * Word-boundary exact citation keys in a blob of source. `SPEC3` must not
 * match `SPEC30`/`SPEC34`, and a bare `SPEC` (src/platform/types.ts) buckets
 * to `SPEC.md` rather than to any numbered spec. Returned sorted + deduped.
 */
export function citedSpecKeys(text) {
  const keys = new Set();
  for (const m of text.matchAll(/\bSPEC(\d*)\b/g)) keys.add(`SPEC${m[1]}`);
  return [...keys].sort(compareSpecKeys);
}

/** `SPEC` sorts first, then numerically — never lexicographically (SPEC9 < SPEC10). */
export function compareSpecKeys(a, b) {
  return specNumber(a) - specNumber(b);
}

/** The number in a spec key; the unnumbered base spec sorts ahead of SPEC2. */
export function specNumber(key) {
  const digits = /^SPEC(\d*)$/.exec(key)?.[1];
  return digits ? Number(digits) : 0;
}

/**
 * A spec file's key and its own title, taken from the first `# ` heading.
 * A spec with no heading renders with an empty title rather than crashing.
 */
export function parseSpec(fileName, text) {
  return {
    key: path.basename(fileName, '.md'),
    file: path.basename(fileName),
    title: /^#[ \t]+(.+?)[ \t]*$/m.exec(text)?.[1] ?? '',
  };
}

/**
 * Citations in one e2e spec file, attributed to the E-numbered `test(...)`
 * whose body encloses them. A citation outside every E-test body — the file
 * header, `beforeEach` setup, module-level helpers — is attributed to the file
 * (`test: null`) rather than dropped. Returns one entry per (key, test) pair.
 */
export function e2eCitations(source) {
  const tests = eTestRanges(source);
  const found = new Map(); // `${key}\0${test}` -> {key, test}
  for (const m of source.matchAll(/\bSPEC(\d*)\b/g)) {
    const key = `SPEC${m[1]}`;
    const enclosing = tests.find((t) => m.index >= t.start && m.index < t.end);
    const test = enclosing ? enclosing.name : null;
    found.set(`${key}\0${test}`, { key, test });
  }
  return [...found.values()].sort(
    (a, b) => compareSpecKeys(a.key, b.key) || compareTestLabels(a.test, b.test),
  );
}

/** File-level attributions (null) sort after the E-numbers, which sort numerically. */
function compareTestLabels(a, b) {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return Number(a.slice(1)) - Number(b.slice(1));
}

/**
 * Byte ranges of the E-numbered `test('E12: …', …)` calls, found by matching
 * the call's parentheses while skipping strings, template literals and
 * comments. Each range is clamped at the next test's start, so a body the
 * matcher fails to close (an unbalanced paren inside a regex literal, say)
 * can never swallow the tests after it.
 */
function eTestRanges(source) {
  const starts = [...source.matchAll(/\btest(?:\.\w+)*\s*\(/g)].map((m) => ({
    open: m.index + m[0].length - 1,
    name: /^\s*['"`](E\d+)[:\s]/.exec(source.slice(m.index + m[0].length))?.[1] ?? null,
    from: m.index,
  }));
  const ranges = [];
  for (const [i, s] of starts.entries()) {
    if (!s.name) continue;
    const nextStart = starts[i + 1]?.from ?? source.length;
    ranges.push({ name: s.name, start: s.open, end: Math.min(matchParen(source, s.open), nextStart) });
  }
  return ranges;
}

/** Index just past the `)` closing the `(` at `open`, or the end of the source. */
function matchParen(source, open) {
  let depth = 0;
  const templates = []; // brace depth at each open `${` — a template can nest
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) return source.length;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return source.length;
      i = end + 1;
    } else if (c === "'" || c === '"') {
      i = skipQuoted(source, i, c);
    } else if (c === '`') {
      const stop = skipTemplate(source, i);
      if (stop.interpolated) {
        templates.push(depth);
        i = stop.index; // sits on the `{` of `${` — resume scanning code
      } else {
        i = stop.index;
      }
    } else if (c === '}' && templates.length && depth === templates[templates.length - 1]) {
      templates.pop();
      const stop = skipTemplate(source, i); // resume the enclosing template
      if (stop.interpolated) templates.push(depth);
      i = stop.index;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      if (--depth === 0) return i + 1;
    }
  }
  return source.length;
}

/** Index of the closing quote of the literal opened at `i` (escapes honoured). */
function skipQuoted(source, i, quote) {
  for (let j = i + 1; j < source.length; j++) {
    if (source[j] === '\\') j++;
    else if (source[j] === quote) return j;
  }
  return source.length;
}

/**
 * Scan a template literal from its opening (or resuming) backtick/brace to
 * either its closing backtick or the `{` of the next `${` interpolation.
 */
function skipTemplate(source, i) {
  for (let j = i + 1; j < source.length; j++) {
    if (source[j] === '\\') j++;
    else if (source[j] === '`') return { index: j, interpolated: false };
    else if (source[j] === '$' && source[j + 1] === '{') return { index: j + 1, interpolated: true };
  }
  return { index: source.length, interpolated: false };
}

/**
 * One row per spec file — including specs nothing cites yet, which render an
 * explicit "none" so an uncited spec never looks like a missing row.
 * Citations naming a spec with no file in docs/specs/ (SPEC28 was withdrawn,
 * SPEC47/48 were removed) are reported back to the caller, not turned into
 * rows and not fatal.
 *
 * @param {{specs: {path: string, text: string}[], srcFiles: {path: string, text: string}[], e2eFiles: {path: string, text: string}[]}} tree
 */
export function buildRows(tree) {
  const rows = new Map();
  for (const spec of tree.specs) {
    const parsed = parseSpec(spec.path, spec.text);
    rows.set(parsed.key, { ...parsed, src: [], tests: [] });
  }
  const unknown = new Set();
  const record = (key, apply) => {
    const row = rows.get(key);
    if (row) apply(row);
    else unknown.add(key);
  };

  for (const file of tree.srcFiles) {
    for (const key of citedSpecKeys(file.text)) record(key, (row) => row.src.push(file.path));
  }
  for (const file of tree.e2eFiles) {
    // Files with no E-numbered test contribute nothing: tests/e2e/web.spec.ts
    // carries W-numbers, which this map does not index.
    const citations = e2eCitations(file.text);
    if (!citations.some((c) => c.test !== null)) continue;
    for (const { key, test } of citations) record(key, (row) => row.tests.push(test ?? file.path));
  }

  for (const row of rows.values()) {
    row.src = [...new Set(row.src)].sort();
    // Deduped but not re-sorted: e2e files are visited in name order and each
    // file's citations arrive sorted, so the cell is already deterministic —
    // E-numbers group by citing file rather than sorting globally.
    row.tests = [...new Set(row.tests)];
  }
  return { rows: [...rows.values()].sort((a, b) => compareSpecKeys(a.key, b.key)), unknown: [...unknown].sort(compareSpecKeys) };
}

/** The committed markdown for a set of rows. Pure: same rows in, same bytes out. */
export function renderMap(rows) {
  const cell = (items) => (items.length ? items.map((i) => `\`${i}\``).join(', ') : '_none_');
  // E-numbers render bare; a file-level attribution renders as a code-quoted path.
  const testCell = (tests) => (tests.length ? tests.map((t) => (t.startsWith('E') ? t : `\`${t}\``)).join(', ') : '_none_');
  const body = rows.map(
    (row) => `| [${row.key}](specs/${row.file}) | ${row.title} | ${cell(row.src)} | ${testCell(row.tests)} |`,
  );
  return `# Spec → code map

<!-- GENERATED FILE — DO NOT EDIT BY HAND -->

This file is **generated** by \`npm run map\` (\`scripts/map.mjs\`) from the
\`SPEC<n>\` citations already in the tree — \`docs/specs/*.md\` for the spec list
and titles, \`src/\` and the E-numbered tests in \`tests/e2e/\` for the rows. It
is **never hand-edited**: any manual change is overwritten by the next run, and
\`npm run validate\` (and \`npm run validate:quick\`) fails while the committed
file differs from what the generator produces from the current tree. After
adding or moving a citation, run \`npm run map\` and commit the result.

Use it to answer "which file do I edit": find the spec that owns the behaviour,
then read off its \`src/\` files and the e2e tests that cover it. A spec with no
citations yet shows \`_none_\`. Files listed under **e2e** rather than an
E-number cite the spec outside any test body (file header or shared setup).

| Spec | Title | src files | e2e |
| --- | --- | --- | --- |
${body.join('\n')}
`;
}

/** Read the generator's inputs from a checkout. */
export function readTree(dir) {
  const rel = (p) => path.relative(dir, p).split(path.sep).join('/');
  const read = (p) => ({ path: rel(p), text: readFileSync(p, 'utf8') });
  const walk = (start) => {
    const out = [];
    const visit = (d) => {
      for (const entry of readdirSync(d).sort()) {
        const full = path.join(d, entry);
        if (statSync(full).isDirectory()) visit(full);
        else if (SRC_EXTENSIONS.has(path.extname(entry))) out.push(full);
      }
    };
    visit(start);
    return out;
  };
  const specsDir = path.join(dir, 'docs/specs');
  const e2eDir = path.join(dir, 'tests/e2e');
  return {
    specs: readdirSync(specsDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => read(path.join(specsDir, f))),
    srcFiles: walk(path.join(dir, 'src')).map(read),
    e2eFiles: readdirSync(e2eDir)
      .filter((f) => f.endsWith('.spec.ts'))
      .sort()
      .map((f) => read(path.join(e2eDir, f))),
  };
}

/** The markdown docs/MAP.md should contain for the tree rooted at `dir`. */
export function mapFromTree(dir) {
  const { rows, unknown } = buildRows(readTree(dir));
  return { markdown: renderMap(rows), rows, unknown };
}

function main() {
  const { markdown, rows, unknown } = mapFromTree(root);
  writeFileSync(path.join(root, 'docs/MAP.md'), markdown);
  const cited = rows.filter((r) => r.src.length || r.tests.length).length;
  if (unknown.length) console.log(`map: ignored citations with no spec file: ${unknown.join(', ')}`);
  console.log(`map: OK — docs/MAP.md regenerated, ${rows.length} specs (${cited} cited, ${rows.length - cited} spec-only).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
