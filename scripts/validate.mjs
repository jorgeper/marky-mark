#!/usr/bin/env node
/**
 * Validation harness (SPEC §8 + SPEC2 §7 + SPEC10 §1.3). Runs, in order,
 * failing on the first non-zero exit:
 *   1. version lock-step check (four version files agree, valid semver)
 *   1b. docs/MAP.md freshness (matches what scripts/map.mjs derives)
 *   1c. CLAUDE.md resolves to AGENTS.md (root symlink intact)
 *   1d. desktop-shim e2e test-count floor (Playwright's own collection)
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
 * lock-step, MAP.md freshness, the CLAUDE.md symlink check, the e2e count
 * floor, typecheck, unit tests, desktop-shim e2e — and prints the
 * DISTINCT line `QUICK VALIDATION: ALL PASSED`. Only the full gate's
 * `VALIDATION: ALL PASSED` counts as release evidence. The full step list
 * below is untouched.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUICK = process.argv.includes('--quick');

// --- progress reporting ---------------------------------------------------
// Agents run this behind `| tail -25` or `> log 2>&1 &`, so a run that prints
// nothing for ten minutes is indistinguishable from a hung one. Every step is
// stamped with elapsed time, long steps emit a heartbeat, and the run ends
// with a step-by-step timing table compact enough to survive `tail`.
const startedAt = Date.now();
const HEARTBEAT_MS = 30_000;
const timings = [];

function fmt(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}
const elapsed = () => `+${fmt(Date.now() - startedAt)}`;

function record(name, ms) {
  timings.push({ name, ms });
}

function printTimeline(headline) {
  const width = Math.max(...timings.map((t) => t.name.length), 12);
  console.log(`\n${headline}`);
  for (const t of timings) console.log(`  ${t.name.padEnd(width)}  ${fmt(t.ms).padStart(7)}`);
  console.log(`  ${'TOTAL'.padEnd(width)}  ${fmt(Date.now() - startedAt).padStart(7)}`);
}

// --- cross-lane e2e mutex --------------------------------------------------
// Several Sandcastle lanes validating at once oversubscribe the 2-core VPS:
// two concurrent Playwright suites make every timing-sensitive test flaky,
// and each flake used to trigger a full gate re-run. The e2e steps therefore
// serialize machine-wide. The lock lives in the repo's COMMON git dir — the
// one host inode that the main checkout, every worktree, and every sandbox
// container share (each lane bind-mounts it or git would not work there), so
// one flock covers all of them: flock locks the inode and the kernel is
// shared across containers. flock(1) releases on process death, so a killed
// gate never wedges the lock.
function e2eLockPath() {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    execFileSync('flock', ['--version'], { stdio: 'ignore' });
    return path.join(path.resolve(root, common), 'sandcastle-e2e.lock');
  } catch {
    return null; // no git or no flock(1): run unserialized rather than fail
  }
}

/** Run one step with a live heartbeat, returning its exit status. */
function runStep(step) {
  let { cmd, args } = step;
  if (step.mutex) {
    const lock = e2eLockPath();
    if (lock) {
      // Non-blocking probe purely for the log line: a lane that has to wait
      // should say so, not sit silent behind another lane's 10-minute suite.
      try {
        execFileSync('flock', ['-n', lock, 'true'], { stdio: 'ignore' });
      } catch {
        console.log(`--- validate: ${step.name} waiting for the machine-wide e2e lock (another validation run holds it) ---`);
      }
      [cmd, args] = ['flock', [lock, cmd, ...args]];
    }
  }
  console.log(`\n=== validate: ${step.name} === (start ${elapsed()})`);
  const stepStart = Date.now();
  const child = spawn(cmd, args, { cwd: step.cwd ?? root, env, stdio: 'inherit' });
  const beat = setInterval(
    () => console.log(`--- validate: ${step.name} still running (${fmt(Date.now() - stepStart)}) ---`),
    HEARTBEAT_MS
  );
  return new Promise((resolve) => {
    child.on('exit', (code) => {
      clearInterval(beat);
      const ms = Date.now() - stepStart;
      record(step.name, ms);
      console.log(`=== validate: ${step.name} ${code === 0 ? 'OK' : `FAILED (exit ${code})`} in ${fmt(ms)} ===`);
      resolve(code ?? 1);
    });
  });
}
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
console.log(`=== validate: version lock-step === (start ${elapsed()})`);
const lockStepStart = Date.now();
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
record('version lock-step', Date.now() - lockStepStart);

// docs/MAP.md freshness (issue #35, prd/005-agent-context-hygiene.md §E): the
// map is derived from the SPEC citations in src/ and tests/e2e/, so a citation
// added — or a line hand-edited into the map — without running `npm run map`
// fails the gate. A pure file comparison, no spawn, so it sits with the
// version check ahead of the `steps` array: it runs in the quick tier too and
// costs milliseconds instead of failing after the e2e step.
console.log(`\n=== validate: docs/MAP.md up to date === (start ${elapsed()})`);
const mapStart = Date.now();
const { mapFromTree } = await import('./map.mjs');
const mapPath = path.join(root, 'docs/MAP.md');
const committedMap = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : null;
if (committedMap !== mapFromTree(root).markdown) {
  console.error(`  ${path.relative(root, mapPath)} ${committedMap === null ? 'is missing' : 'differs from what scripts/map.mjs derives from the current tree'}.`);
  console.error('  docs/MAP.md is generated and never hand-edited — run `npm run map` and commit the result.');
  console.error('\nVALIDATION FAILED at step: docs/MAP.md up to date');
  process.exit(1);
}
console.log('docs/MAP.md matches the SPEC citations in src/ and tests/e2e/ (regenerate with `npm run map`)');
record('docs/MAP.md up to date', Date.now() - mapStart);

// CLAUDE.md → AGENTS.md (issue #37, prd/005-agent-context-hygiene.md §A):
// AGENTS.md is the single source of truth for agent orientation and CLAUDE.md
// is a root symlink to it, so both harnesses load the same map. A Windows
// checkout without core.symlinks materialises the link as a regular text file
// containing "AGENTS.md" — caught here, alongside a missing CLAUDE.md or a
// symlink pointing elsewhere. A spawn-free file check, so it sits with the
// checks above, ahead of the `steps` array, and runs in the quick tier too.
console.log(`\n=== validate: CLAUDE.md resolves to AGENTS.md === (start ${elapsed()})`);
const linkStart = Date.now();
const agentsMd = path.join(root, 'AGENTS.md');
const claudeMd = path.join(root, 'CLAUDE.md');
const linkStat = lstatSync(claudeMd, { throwIfNoEntry: false });
const linkTarget = linkStat?.isSymbolicLink() ? readlinkSync(claudeMd) : null;
const agentsMdExists = existsSync(agentsMd);
const resolvesToAgentsMd = linkTarget !== null && path.resolve(root, linkTarget) === agentsMd;
if (!agentsMdExists || !resolvesToAgentsMd) {
  if (!agentsMdExists) console.error('  AGENTS.md is missing from the repository root.');
  if (!linkStat) console.error('  CLAUDE.md is missing from the repository root.');
  else if (!linkStat.isSymbolicLink())
    console.error('  CLAUDE.md is a regular file, not a symlink (a Windows checkout without core.symlinks materialises it this way).');
  else if (!resolvesToAgentsMd)
    console.error(`  CLAUDE.md is a symlink to ${linkTarget}, not AGENTS.md.`);
  console.error('  Fix: rm CLAUDE.md && ln -s AGENTS.md CLAUDE.md (on Windows: git config core.symlinks true, then re-checkout CLAUDE.md).');
  console.error('\nVALIDATION FAILED at step: CLAUDE.md resolves to AGENTS.md');
  process.exit(1);
}
console.log('CLAUDE.md is a symlink resolving to AGENTS.md — both harnesses load the same map');
record('CLAUDE.md resolves to AGENTS.md', Date.now() - linkStart);

// Issue #31 — committed test-count floor for the desktop-shim e2e suite. The
// count is Playwright's OWN collection (`playwright test --list`, which honours
// the config's testMatch/testIgnore), never a grep over the spec sources: after
// tests/e2e/app.spec.ts was split into one file per feature area, a glob that
// stops matching a file — or a file that fails to load — would otherwise leave
// the suite green while running a fraction of the tests. Same rule as
// FETCH_ALLOWLIST below: any future change to this number must be justified
// here. It rises when tests are added; a drop means a file went missing.
// 135, not 136: E135 (pane-slide easing-curve sampling) was removed on main
// (cd37b03, owner call — chronically load-flaky) after the split was specced.
// 161 as of issue #70: the suite had grown to 155 collected, and the hosted
// backend scaffold added E159–E164 (tests/e2e/hosted.spec.ts).
const E2E_TEST_FLOOR = 161;
console.log(`\n=== validate: e2e test-count floor (desktop shim) === (start ${elapsed()})`);
const floorStart = Date.now();
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
record('e2e test-count floor (desktop shim)', Date.now() - floorStart);

const steps = [
  { name: 'typecheck', cmd: 'npx', args: ['tsc', '--noEmit'] },
  { name: 'unit tests', cmd: 'npm', args: ['run', 'test:unit'] },
  { name: 'e2e tests (desktop shim)', cmd: 'npm', args: ['run', 'test:e2e'], mutex: true },
  { name: 'web single-file build', cmd: 'npm', args: ['run', 'build:web'] },
  { name: 'e2e tests (web, dist-web)', cmd: 'npm', args: ['run', 'test:e2e:web'], mutex: true },
  { name: 'desktop bundle build', cmd: 'npm', args: ['run', 'build'] },
  { name: 'cargo check', cmd: 'cargo', args: ['check'], cwd: path.join(root, 'src-tauri') },
];

// SPEC33 §1.1: the quick tier runs the first three steps only; the `steps`
// array above (the full gate's step list) is deliberately untouched.
const QUICK_STEPS = new Set(['typecheck', 'unit tests', 'e2e tests (desktop shim)']);
const runSteps = QUICK ? steps.filter((s) => QUICK_STEPS.has(s.name)) : steps;

// The pre-`steps` checks that already ran above, in order — named here so the
// step-count summary can't drift from the list.
const PRE_STEPS = ['version lock-step', 'docs/MAP.md up to date', 'CLAUDE.md resolves to AGENTS.md', 'e2e test-count floor (desktop shim)'];
console.log(
  `\nvalidate${QUICK ? ':quick' : ''} — ${PRE_STEPS.length + runSteps.length} steps: ${[...PRE_STEPS, ...runSteps.map((s) => s.name)].join(' → ')}`
);

for (const step of runSteps) {
  const status = await runStep(step);
  if (status !== 0) {
    printTimeline(`VALIDATION FAILED at step: ${step.name} — timeline:`);
    // Point the reader (usually an agent) at the cheap next move: iterate on
    // just the failures, and re-run the whole gate only once they pass.
    if (step.name === 'e2e tests (desktop shim)') {
      console.error(
        '\nTip: `npm run test:e2e:failed` re-runs ONLY the tests that just failed.' +
          ' Iterate there; re-run the full gate once they are green.'
      );
    }
    console.error(`\nVALIDATION FAILED at step: ${step.name}`);
    process.exit(status);
  }
}

if (QUICK) {
  printTimeline('QUICK VALIDATION timeline:');
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

printTimeline('VALIDATION timeline:');
console.log('\nVALIDATION: ALL PASSED');
