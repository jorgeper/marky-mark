// PRD 021 Req 10 (issue #239): the editor package boundary check — the
// spawn-free static import scan that keeps `editor/` (the embeddable
// @marky-mark/editor package) from importing app code (`src/`, `server/`,
// `src-tauri/`) and keeps the app importing the package only through its
// exported entry points (`@marky-mark/editor`, never a deep path). Pure
// functions over file text, imported by scripts/validate.mjs (both tiers)
// and unit-tested directly (tests/unit/editor-boundary.test.ts) — the same
// split scripts/style-lint.mjs uses.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// The app roots the editor package may never import from. `src-tauri/` has
// no importable TS, but an import naming it is still a coupling — banned.
const APP_DIRS = new Set(['src', 'server', 'src-tauri']);
// The workspace root package name: a bare specifier resolving straight into
// app code via the node_modules self-link, so it counts as an app import.
const APP_PACKAGE = 'marky-mark';
const EDITOR_PACKAGE = '@marky-mark/editor';

// Every statically visible module specifier: `import … from 'x'`,
// `export … from 'x'`, side-effect `import 'x'`, dynamic `import('x')`,
// `require('x')`. Regex-based like scripts/style-lint.mjs — a string that
// merely looks like an import only fires if it also names a forbidden path.
const IMPORT_SPEC = /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*(['"])([^'"\n]+)\1/g;

/** 1-indexed line number of `index` in `text`. */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/** Static import specifiers in a source text: [{ line, spec }]. */
export function importSpecifiers(source) {
  return [...source.matchAll(IMPORT_SPEC)].map((m) => ({ line: lineOf(source, m.index), spec: m[2] }));
}

/** First path segment of a posix-style relative path ('..' when escaping the repo root). */
function firstSegment(p) {
  return p.split('/', 1)[0];
}

/**
 * PRD 021 Req 10: why `spec`, imported from a module whose directory is
 * `fileDirRel` (repo-relative, posix separators, e.g. 'editor/src/lib'),
 * crosses the editor→app boundary — or null when it doesn't. Catches a
 * relative path escaping the package into an app root, a bare specifier
 * for the root package, and any baseUrl/alias-style specifier whose first
 * segment is an app root.
 */
export function editorImportViolation(spec, fileDirRel) {
  if (spec.startsWith('.')) {
    const resolved = path.posix.normalize(path.posix.join(fileDirRel, spec));
    const target = firstSegment(resolved);
    if (APP_DIRS.has(target)) {
      return `imports app code (\`${spec}\` resolves to \`${resolved}\`) — the editor package never imports from ${target}/`;
    }
    return null;
  }
  if (spec === APP_PACKAGE || spec.startsWith(`${APP_PACKAGE}/`)) {
    return `imports the app package \`${spec}\` — the editor package never imports app code`;
  }
  if (APP_DIRS.has(firstSegment(spec))) {
    return `imports \`${spec}\`, an alias into ${firstSegment(spec)}/ — the editor package never imports app code`;
  }
  return null;
}

/**
 * PRD 021 Req 10: why `spec`, imported from app code, violates the
 * entry-point rule — or null. The app imports the package only through the
 * `exports` map of editor/package.json: the bare `@marky-mark/editor`, plus
 * the subpaths that map names (issues #240/#231: `./styles.css`, which
 * #238's main.tsx import uses — an exported entry point, not a sealed
 * internal). Any other deep path (`@marky-mark/editor/src/...`) reaches
 * into internals the package does not export. `exported` is the specifier
 * set from `exportedSpecifiers`; absent means "no subpath exports" (the
 * frozen unit fixtures), which seals every deep path.
 */
export function appImportViolation(spec, exported = new Set()) {
  if (spec.startsWith(`${EDITOR_PACKAGE}/`) && !exported.has(spec)) {
    return `deep-path import \`${spec}\` — app code imports the package only as \`${EDITOR_PACKAGE}\` (its exported entry points)`;
  }
  return null;
}

/**
 * The full import specifiers the editor package's `exports` map admits
 * beyond the bare entry point, e.g. `@marky-mark/editor/styles.css` from
 * the map key `./styles.css`.
 */
export function exportedSpecifiers(packageJsonText) {
  let map = {};
  try {
    map = JSON.parse(packageJsonText).exports ?? {};
  } catch {
    /* unreadable manifest → no subpath exports */
  }
  return new Set(
    Object.keys(map)
      .filter((k) => k.startsWith('./'))
      .map((k) => `${EDITOR_PACKAGE}/${k.slice(2)}`)
  );
}

/** Findings for one editor-package source: [{ line, message }]. */
export function lintEditorSource(source, fileDirRel) {
  const findings = [];
  for (const { line, spec } of importSpecifiers(source)) {
    const message = editorImportViolation(spec, fileDirRel);
    if (message !== null) findings.push({ line, message });
  }
  return findings;
}

/** Findings for one app-side source: [{ line, message }]. */
export function lintAppSource(source, exported = new Set()) {
  const findings = [];
  for (const { line, spec } of importSpecifiers(source)) {
    const message = appImportViolation(spec, exported);
    if (message !== null) findings.push({ line, message });
  }
  return findings;
}

/** Recursively list script/module files under `dir`, skipping node_modules. */
function listModuleFiles(dir) {
  const out = [];
  const dirs = [dir];
  while (dirs.length > 0) {
    const d = dirs.pop();
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') dirs.push(p);
      } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) out.push(p);
    }
  }
  return out.sort();
}

/**
 * PRD 021 Req 10: the whole boundary check over a checkout. Scans every
 * module under editor/ (sources, tests, configs) for app imports, and every
 * module under src/ and server/ for deep-path package imports. Returns
 * findings [{ file, line, message }] with repo-relative paths, ordered by
 * file then line.
 */
export function runEditorBoundary(root) {
  const findings = [];
  const relPosix = (file) => path.relative(root, file).split(path.sep).join('/');
  for (const file of listModuleFiles(path.join(root, 'editor'))) {
    const rel = relPosix(file);
    for (const f of lintEditorSource(readFileSync(file, 'utf8'), path.posix.dirname(rel))) {
      findings.push({ file: rel, ...f });
    }
  }
  let exported = new Set();
  try {
    exported = exportedSpecifiers(readFileSync(path.join(root, 'editor', 'package.json'), 'utf8'));
  } catch {
    /* no manifest → no subpath exports */
  }
  for (const appDir of ['src', 'server']) {
    for (const file of listModuleFiles(path.join(root, appDir))) {
      for (const f of lintAppSource(readFileSync(file, 'utf8'), exported)) {
        findings.push({ file: relPosix(file), ...f });
      }
    }
  }
  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}
