#!/usr/bin/env node
/**
 * npm run licenses (SPEC10 §4): regenerate THIRD-PARTY-NOTICES.md from the
 * real dependency graphs — every production npm package (package-lock.json)
 * and every crate in the resolved Rust graph (cargo metadata). Deterministic
 * output: sorted by name@version, no timestamps, byte-identical on rerun.
 *
 * Allowlist guard: every license expression must evaluate to permissive
 * against ALLOWED below (OR: any branch; AND: all branches). A disallowed or
 * missing license fails the run naming the offenders — copyleft can never
 * slip into the bundle silently.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Zlib',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0',
  'MPL-2.0',
  'BSL-1.0',
  'Unicode-DFS-2016',
  'Unicode-3.0',
  'NCSA',
  'OFL-1.1',
  // SPEC19: Mozilla's CA-certificate DATA (webpki-root-certs, pulled in by
  // the updater's TLS stack) — permissive data license, no copyleft terms.
  'CDLA-Permissive-2.0',
]);

/** Evaluate an SPDX expression against the allowlist (exported for U16). */
export function licenseAllowed(expr) {
  if (!expr || typeof expr !== 'string') return false;
  const tokens = expr.match(/\(|\)|[A-Za-z0-9.+-]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function factor() {
    if (peek() === '(') {
      next();
      const v = orExpr();
      if (peek() === ')') next();
      return v;
    }
    let id = next();
    if (id === undefined) return false;
    if (peek() === 'WITH') {
      next();
      id = `${id} WITH ${next()}`;
    }
    return ALLOWED.has(id);
  }
  function andExpr() {
    let v = factor();
    while (peek() === 'AND') {
      next();
      v = factor() && v;
    }
    return v;
  }
  function orExpr() {
    let v = andExpr();
    while (peek() === 'OR') {
      next();
      v = andExpr() || v;
    }
    return v;
  }
  const result = orExpr();
  return i >= tokens.length && result;
}

function normalizeNpmLicense(field) {
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) return field.map((f) => normalizeNpmLicense(f)).join(' OR ');
  if (field && typeof field === 'object' && field.type) return field.type;
  return null;
}

function main() {
  // ---- npm production packages ------------------------------------------------
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const npmPkgs = new Map(); // "name@version" -> license
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/') || entry.dev || entry.link) continue;
    const name = entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    let license = null;
    try {
      license = normalizeNpmLicense(JSON.parse(readFileSync(path.join(root, key, 'package.json'), 'utf8')).license);
    } catch {
      /* not installed (e.g. skipped optional) — leave null and let the guard decide */
    }
    npmPkgs.set(`${name}@${entry.version}`, { name, version: entry.version, license });
  }

  // ---- Rust crates --------------------------------------------------------------
  const env = { ...process.env, PATH: `${path.join(homedir(), '.cargo', 'bin')}:${process.env.PATH ?? ''}` };
  const meta = spawnSync('cargo', ['metadata', '--format-version', '1'], {
    cwd: path.join(root, 'src-tauri'),
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (meta.status !== 0) {
    console.error(meta.stderr || 'licenses: cargo metadata failed');
    process.exit(meta.status ?? 1);
  }
  const crates = new Map();
  for (const p of JSON.parse(meta.stdout).packages) {
    if (p.name === 'marky-mark') continue; // the app itself
    crates.set(`${p.name}@${p.version}`, {
      name: p.name,
      version: p.version,
      // A handful of crates declare license-file only; treat the SPDX `license`
      // as canonical and fall back to naming the file so the guard flags it for
      // a human decision rather than passing silently.
      license: p.license ?? (p.license_file ? `SEE-LICENSE-FILE:${p.license_file}` : null),
    });
  }

  // ---- guard -------------------------------------------------------------------
  const all = [
    ...[...npmPkgs.values()].map((p) => ({ ...p, eco: 'npm' })),
    ...[...crates.values()].map((p) => ({ ...p, eco: 'crate' })),
  ];
  const violations = all.filter((p) => !licenseAllowed(p.license?.replace(/\//g, ' OR ')));
  if (violations.length) {
    console.error('licenses: allowlist guard FAILED — disallowed or missing licenses:');
    for (const v of violations) console.error(`  ${v.eco} ${v.name}@${v.version}: ${v.license ?? '(none)'}`);
    process.exit(1);
  }

  // ---- write notices -------------------------------------------------------------
  const sortByName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
  const table = (rows) =>
    ['| Package | Version | License |', '| --- | --- | --- |', ...rows.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`)].join(
      '\n',
    );

  const npmSorted = [...npmPkgs.values()].sort(sortByName);
  const crateSorted = [...crates.values()].sort(sortByName);
  const out = `# Third-party notices

  Marky Mark bundles the open-source packages listed below. This file is
  generated by \`npm run licenses\` (\`scripts/licenses.mjs\`) from
  \`package-lock.json\` (production npm dependencies) and \`cargo metadata\`
  (the resolved Rust crate graph) — regenerate it after any dependency change.
  Every license passes the permissive allowlist guard in the generator.

  ## npm packages (production)

  ${table(npmSorted)}

  ## Rust crates

  ${table(crateSorted)}
  `;
  writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), out);
  console.log(
    `licenses: OK — ${npmSorted.length} npm packages + ${crateSorted.length} crates, all allowlisted; THIRD-PARTY-NOTICES.md regenerated.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
