#!/usr/bin/env node
/**
 * Validation harness (SPEC §8 + SPEC2 §7 + SPEC10 §1.3). Runs, in order,
 * failing on the first non-zero exit:
 *   1. version lock-step check (four version files agree, valid semver)
 *   1b. desktop-shim e2e test-count floor (Playwright's own collection)
 *   2. tsc --noEmit
 *   3. unit tests (Vitest, U1–U21)
 *   4. desktop e2e (Playwright, browser platform shim, E1–E41 + E45–E50)
 *   5. single-file web build
 *   6. web e2e (Playwright against dist-web, W1–W5)
 *   7. desktop bundle build (vite → dist/, scanned below)
 *   8. cargo check (Rust host compiles)
 *   9. single-file check (dist-web = exactly one self-contained index.html)
 *  10. static bundle scan (SPEC11 §6.6: no network call sites ship)
 * Prints VALIDATION: ALL PASSED as the final line only if all steps passed.
 *
 * SPEC33 §1.1: `--quick` runs the inner-loop subset only — version
 * lock-step, the e2e count floor, typecheck, unit tests, desktop-shim e2e —
 * and prints the
 * DISTINCT line `QUICK VALIDATION: ALL PASSED`. Only the full gate's
 * `VALIDATION: ALL PASSED` counts as release evidence. The full step list
 * below is untouched.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUICK = process.argv.includes('--quick');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  PATH: `${path.join(homedir(), '.cargo', 'bin')}:${process.env.PATH ?? ''}`,
};

// Version lock-step (SPEC10 §1.3, extended by issue #22): the three release
// files and the README's alpha banner must agree on one valid semver,
// pre-release identifier intact. The banner is read with release:prepare's own
// `readmeVersion`, so the gate checks exactly what the release path writes —
// and a README with no recognisable banner extracts as null, which fails the
// set-of-one check rather than passing vacuously.
console.log('=== validate: version lock-step ===');
const { isValidSemver, readmeVersion } = await import('./release-prepare.mjs');
const versions = {
  'package.json': JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  'src-tauri/tauri.conf.json': JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version,
  'src-tauri/Cargo.toml': /^version = "([^"]*)"/m.exec(readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8'))?.[1],
  'README.md': readmeVersion(readFileSync(path.join(root, 'README.md'), 'utf8')),
};
const distinct = new Set(Object.values(versions));
if (distinct.size !== 1 || !isValidSemver(versions['package.json'])) {
  for (const [f, v] of Object.entries(versions)) console.error(`  ${f}: ${v}`);
  console.error('\nVALIDATION FAILED at step: version lock-step');
  process.exit(1);
}
console.log(`version ${versions['package.json']} in lock-step across package.json, tauri.conf.json, Cargo.toml, README.md`);

// Issue #31 — committed test-count floor for the desktop-shim e2e suite. The
// count is Playwright's OWN collection (`playwright test --list`, which honours
// the config's testMatch/testIgnore), never a grep over the spec sources: after
// tests/e2e/app.spec.ts was split into one file per feature area, a glob that
// stops matching a file — or a file that fails to load — would otherwise leave
// the suite green while running a fraction of the tests. Same rule as
// FETCH_ALLOWLIST below: any future change to this number must be justified
// here. It rises when tests are added; a drop means a file went missing.
const E2E_TEST_FLOOR = 136;
console.log('\n=== validate: e2e test-count floor (desktop shim) ===');
const listed = spawnSync('npx', ['playwright', 'test', '--list'], {
  cwd: root,
  env,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
const listing = `${listed.stdout ?? ''}${listed.stderr ?? ''}`;
// A missing or garbled listing is red, never a silent zero: parse failure and a
// non-zero exit both fail here rather than passing vacuously.
const collected = /^Total:\s+(\d+)\s+tests?\b/m.exec(listing)?.[1];
if (listed.status !== 0 || collected === undefined) {
  process.stdout.write(listing);
  console.error(
    listed.status !== 0
      ? `\`playwright test --list\` exited ${listed.status ?? 'with a signal'} — the collected count is unknown`
      : '`playwright test --list` produced no parsable `Total: N tests` line — the collected count is unknown'
  );
  console.error('\nVALIDATION FAILED at step: e2e test-count floor (desktop shim)');
  process.exit(1);
}
const e2eCollected = Number(collected);
if (e2eCollected < E2E_TEST_FLOOR) {
  console.error(
    `Playwright collected ${e2eCollected} desktop-shim tests, below the committed floor of ${E2E_TEST_FLOOR}.`
  );
  console.error('A spec file under tests/e2e/ is missing or no longer matches playwright.config.ts.');
  console.error('\nVALIDATION FAILED at step: e2e test-count floor (desktop shim)');
  process.exit(1);
}
console.log(`Playwright collected ${e2eCollected} desktop-shim tests (floor ${E2E_TEST_FLOOR})`);

const steps = [
  { name: 'typecheck', cmd: 'npx', args: ['tsc', '--noEmit'] },
  { name: 'unit tests', cmd: 'npm', args: ['run', 'test:unit'] },
  { name: 'e2e tests (desktop shim)', cmd: 'npm', args: ['run', 'test:e2e'] },
  { name: 'web single-file build', cmd: 'npm', args: ['run', 'build:web'] },
  { name: 'e2e tests (web, dist-web)', cmd: 'npm', args: ['run', 'test:e2e:web'] },
  { name: 'desktop bundle build', cmd: 'npm', args: ['run', 'build'] },
  { name: 'cargo check', cmd: 'cargo', args: ['check'], cwd: path.join(root, 'src-tauri') },
];

// SPEC33 §1.1: the quick tier runs the first three steps only; the `steps`
// array above (the full gate's step list) is deliberately untouched.
const QUICK_STEPS = new Set(['typecheck', 'unit tests', 'e2e tests (desktop shim)']);
const runSteps = QUICK ? steps.filter((s) => QUICK_STEPS.has(s.name)) : steps;

for (const step of runSteps) {
  console.log(`\n=== validate: ${step.name} ===`);
  const res = spawnSync(step.cmd, step.args, {
    cwd: step.cwd ?? root,
    env,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    console.error(`\nVALIDATION FAILED at step: ${step.name}`);
    process.exit(res.status ?? 1);
  }
}

if (QUICK) {
  console.log('\nQUICK VALIDATION: ALL PASSED');
  process.exit(0);
}

console.log('\n=== validate: single-file check ===');
const distWeb = path.join(root, 'dist-web');
const entries = readdirSync(distWeb);
if (entries.length !== 1 || entries[0] !== 'index.html') {
  console.error(`dist-web must contain exactly index.html, found: ${entries.join(', ')}`);
  process.exit(1);
}
const html = readFileSync(path.join(distWeb, 'index.html'), 'utf8');
const externalRef =
  /<script[^>]+src=/.test(html) ||
  /<link[^>]+rel="stylesheet"[^>]+href=/.test(html) ||
  /<link[^>]+href=["']https?:\/\//.test(html);
if (externalRef) {
  console.error('dist-web/index.html references external assets — not self-contained');
  process.exit(1);
}
const bytes = statSync(path.join(distWeb, 'index.html')).size;
console.log(`dist-web/index.html is self-contained (single file, no external script/style refs), ${bytes} bytes`);

// SPEC11 §6.6 — static bundle scan: the shipped JS may contain no network
// call sites. fetch( occurrences must equal the committed allowlist below.
console.log('\n=== validate: static bundle scan (network call sites) ===');
const FETCH_ALLOWLIST = 0; // no fetch() call sites are expected; justify any future entry here
const FORBIDDEN = ['XMLHttpRequest(', 'new WebSocket', 'sendBeacon', 'new EventSource'];
const bundleTargets = [
  path.join(distWeb, 'index.html'),
  ...readdirSync(path.join(root, 'dist', 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(root, 'dist', 'assets', f)),
];
let fetchCount = 0;
const scanViolations = [];
for (const t of bundleTargets) {
  const text = readFileSync(t, 'utf8');
  for (const token of FORBIDDEN) {
    if (text.includes(token)) scanViolations.push(`${path.relative(root, t)}: ${token}`);
  }
  fetchCount += (text.match(/\bfetch\s*\(/g) ?? []).length;
}
if (scanViolations.length || fetchCount !== FETCH_ALLOWLIST) {
  for (const v of scanViolations) console.error(`  forbidden network call site: ${v}`);
  if (fetchCount !== FETCH_ALLOWLIST)
    console.error(`  fetch( call sites: ${fetchCount}, allowlist expects ${FETCH_ALLOWLIST}`);
  console.error('\nVALIDATION FAILED at step: static bundle scan');
  process.exit(1);
}
console.log(
  `static bundle scan: ${bundleTargets.length} bundle files — no XMLHttpRequest/WebSocket/sendBeacon/EventSource call sites; fetch( count ${fetchCount} matches allowlist (${FETCH_ALLOWLIST})`,
);

console.log('\nVALIDATION: ALL PASSED');
