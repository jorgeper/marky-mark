#!/usr/bin/env node
/**
 * Validation harness (SPEC §8 + SPEC2 §7 + SPEC10 §1.3). Runs, in order,
 * failing on the first non-zero exit:
 *   1. version lock-step check (four version files agree, valid semver)
 *   1b. docs/MAP.md freshness (matches what scripts/map.mjs derives)
 *   1c. CLAUDE.md resolves to AGENTS.md (root symlink intact)
 *   1d. test-ID uniqueness (no U/E/W title ID appears twice under tests/)
 *   1e. style lint (PRD 018 §E26–§E27: styles.css + TSX chrome stay on the
 *       token/primitive layer; rules in docs/STYLE-GUIDE.md)
 *   1f. editor package boundary (PRD 021 Req 10: editor/ imports no app
 *       code; app imports only @marky-mark/editor entry points)
 *   1g. desktop-shim e2e test-count floor (Playwright's own collection)
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
 * lock-step, MAP.md freshness, the CLAUDE.md symlink check, test-ID
 * uniqueness, the style lint, the e2e count floor, typecheck, unit tests,
 * desktop-shim e2e — and prints the DISTINCT line `QUICK VALIDATION: ALL
 * PASSED`.
 * Only the full gate's `VALIDATION: ALL PASSED` counts as release
 * evidence. The full step list below is untouched.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countFetchCallSites } from './bundle-scan.mjs';

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

// Test-ID uniqueness (issue #185): every test title starts with a stable
// `U<n>:`/`E<n>:`/`W<n>:` ID, and parallel implementers each taking "next
// unused" simultaneously left duplicates that nothing gated. Scans tests/
// recursively, each file read once, no spawns — so it sits with the file
// checks above, ahead of the `steps` array, and runs in the quick tier too.
// The match is line-anchored like a real `it(`/`test(` call so fixture
// strings that merely contain one (tests/unit/map.test.ts embeds
// `test('E1: …` as generator input) don't count as titles.
console.log(`\n=== validate: test-ID uniqueness === (start ${elapsed()})`);
const idScanStart = Date.now();
const idFiles = new Map(); // 'E141' -> ['tests/e2e/a.spec.ts', ...]
// PRD 021 (issue #237): the editor package's own suite joins the scan — a
// U-number stays unique across the whole repo, wherever the test lives.
const idDirs = [path.join(root, 'tests'), path.join(root, 'editor/tests')];
while (idDirs.length > 0) {
  const dir = idDirs.pop();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) idDirs.push(p);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/^[ \t]*(?:it|test)(?:\.\w+)*\(\s*['"`]([UEW]\d+):/gm)) {
        if (!idFiles.has(m[1])) idFiles.set(m[1], []);
        idFiles.get(m[1]).push(path.relative(root, p));
      }
    }
  }
}
const duplicatedIds = [...idFiles].filter(([, files]) => files.length > 1);
if (duplicatedIds.length > 0) {
  // Prefix first (E < U < W in ASCII), then numerically within a prefix.
  duplicatedIds.sort(([a], [b]) => a.charCodeAt(0) - b.charCodeAt(0) || Number(a.slice(1)) - Number(b.slice(1)));
  for (const [id, files] of duplicatedIds) console.error(`  ${id} appears ${files.length} times: ${files.join(', ')}`);
  console.error('  Test IDs are stable and unique — keep the older test\'s number and bump the newer one to the next unused number for its prefix.');
  console.error('\nVALIDATION FAILED at step: test-ID uniqueness');
  process.exit(1);
}
console.log(`${idFiles.size} test IDs across tests/ — no U/E/W ID appears twice`);
record('test-ID uniqueness', Date.now() - idScanStart);

// Style lint (PRD 018 §E26–§E27, issue #205): src/styles.css and the TSX
// chrome stay on the chrome-token/primitive layer — no colour literals
// outside token definitions, no undefined var(--mm-…), no bare descendant
// button/input rules, scale properties through tokens, raw <button> only
// with a primitive class, no literal inline chrome styles. The rules are
// the lint-enforced entries of docs/STYLE-GUIDE.md's Do / Don't list; the
// implementation is the importable scripts/style-lint.mjs (unit-tested in
// tests/unit/style-lint.test.ts). Reads files synchronously, no spawns —
// so it sits with the file checks above and runs in the quick tier too.
console.log(`\n=== validate: style lint === (start ${elapsed()})`);
const styleLintStart = Date.now();
const { runStyleLint } = await import('./style-lint.mjs');
const styleFindings = runStyleLint(root);
if (styleFindings.length > 0) {
  for (const f of styleFindings) console.error(`  ${f.file}:${f.line}  ${f.message}`);
  console.error("  The rules and their fixes are in docs/STYLE-GUIDE.md (Do / Don't list).");
  console.error('\nVALIDATION FAILED at step: style lint');
  process.exit(1);
}
console.log('style lint: chrome styling in src/styles.css and src TSX resolves through the PRD 018 token/primitive layer');
record('style lint', Date.now() - styleLintStart);

// Editor package boundary (PRD 021 Req 10, issue #239): modules under
// editor/ (the embeddable @marky-mark/editor package — sources, tests,
// configs) never import app code (src/, server/, src-tauri/), whether by a
// relative path escaping the package or by any alias resolving there; and
// app code (src/, server/) imports the package only as `@marky-mark/editor`
// (its exported entry points per editor/package.json `exports`), never a
// deep path. The implementation is the importable scripts/editor-boundary.mjs
// (unit-tested in tests/unit/editor-boundary.test.ts). Reads files
// synchronously, no spawns — so it sits with the file checks above, ahead
// of the `steps` array, and runs in the quick tier too.
console.log(`\n=== validate: editor package boundary === (start ${elapsed()})`);
const boundaryStart = Date.now();
const { runEditorBoundary } = await import('./editor-boundary.mjs');
const boundaryFindings = runEditorBoundary(root);
if (boundaryFindings.length > 0) {
  for (const f of boundaryFindings) console.error(`  ${f.file}:${f.line}  ${f.message}`);
  console.error('  The boundary rules live in editor/AGENTS.md — new app-flavored needs become seams/props, never reverse imports.');
  console.error('\nVALIDATION FAILED at step: editor package boundary');
  process.exit(1);
}
console.log('editor package boundary: editor/ imports no app code; src/ and server/ import only @marky-mark/editor entry points');
record('editor package boundary', Date.now() - boundaryStart);

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
// 226 as of issue #107: the floor had drifted far below the suite it guards
// (221 collected before this issue). Re-pinned to the collected count so it
// means "this many tests exist" again.
// 226 still, re-verified for PRD 011 (issue #114): `npx playwright test --list`
// collects exactly 226. The LLM work added no desktop-shim e2e test — the
// desktop transport (#112) is Rust-side plus a pure mapping module, and the
// hosted proxy (#113) and summary cache (#115) are server routes; all three
// are covered by unit tests (U490+, U536+) and the hosted lane, none of which
// this floor counts. Unchanged, not stale.
// 247 as of issue #121: that #114 note went stale the moment the LLM work
// reached the UI. The reader-facing halves of PRD 011 landed as desktop-shim
// tests after it — E226–E228 (the LLM providers page, #116) and E229–E244 (the
// semantic zoom view, #117–#120) — leaving the floor 19 behind the 245 the
// suite already collected. This issue's audit added the two the enumeration in
// Req 35 was still missing: E245 (the cache survives a document reopen,
// tests/e2e/semantic-zoom.spec.ts) and E246 (the hosted flavor's LLM
// availability state, tests/e2e/hosted.spec.ts). Re-pinned to the collected
// count so it means "this many tests exist" again. The web suite's new W14/W15
// are not counted here — `testIgnore` keeps web.spec.ts to
// playwright.web.config.ts, as it always has.
// 346 as of PRD 016 (issue #176): the GitHub storage backend is removed —
// its spec file went with it, E221–E223 (the storage choice, the
// connect-your-repo wizard, the abandoned round trip) are gone because the
// flows they exercised no longer exist, and E224/E225 (merged concurrent
// save; conflicting concurrent save) are rewritten against the local hosted
// lane in tests/e2e/hosted.spec.ts, keeping their numbers — merge-on-save is
// a blob capability now. Re-pinned to the collected count.
// 353 as of PRD 017 (issue #188): E360–E363 — the deployment creation and
// listing policies (restricted / members refusals with their hints, the
// filtered listing, the reserved deployment/ prefix) — re-pinned to the
// collected count (which had grown to 349 since the last pin).
// 362 as of PRD 017 (issue #189): E367–E372 — the Management view (the
// deployment.admin route refusals, the Workspaces tab's statistics, the
// admin open/banner/self-add flow, the exact-name delete, the Settings tab
// round trip with the corrupt-blob parse error, and the People tab's badged
// tenant) — re-pinned to the collected count (which had grown to 356 with
// issue #183's E364–E366 since the last pin).
// 369 as of PRD 017 (issues #190+#191, Reqs 28+34): E375–E379 — in-app guest
// invitations (both surfaces, the Pending badge, the non-admin refusal, the
// Graph-refusal surface) — plus issue #178's E373–E374; issue #191 extended
// E362/E369/E371 (admin listing filtered under members, the doc.edit verb,
// the corrupt-blob fail-closed behaviour) rather than adding tests.
// 374 as of issues #192+#193: E380 (shared primary invite styling) and
// E381–E384 — rescinding invitations (the Management flow, the manifest
// scrub, the non-admin 403, the accepted-guest 409).
// 378 as of issue #195: E385–E388 — copy-invite-link (the Pending-row copy
// with its clipboard fallback, the form's Get invite link + Send surfacing
// the URL, the non-admin 403, the non-pending 409).
// 379 as of issue #194: E389 — sidebar New File lands in edit mode on both
// christening exits (SPEC35 §4.2 as amended). Renumbered from E385 at merge:
// issues #194 and #195 both minted E385 on their branches; #195 landed first.
// 380 as of issue #196: E390 — the hosted sign-in page's splash restyle (no
// card box, no title, the badge at the splash's 132px).
// 386 as of issue #206 (PRD 018 Reqs 30–33): E392–E396 — computed-style
// agreement of the chrome primitives across surfaces, under a light and a
// dark bundled theme, and the chrome-token override proof.
const E2E_TEST_FLOOR = 386;
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
const PRE_STEPS = ['version lock-step', 'docs/MAP.md up to date', 'CLAUDE.md resolves to AGENTS.md', 'test-ID uniqueness', 'style lint', 'editor package boundary', 'e2e test-count floor (desktop shim)'];
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

// SPEC11 §6.6 (amended, issue #114) — static bundle scan: the shipped JS may
// contain no network call site the allowlist below has not audited. The
// FORBIDDEN APIs must not appear at all; fetch( call sites must equal
// FETCH_ALLOWLIST exactly, so a new one — in either direction — fails here.
// What counts as a call site is defined (and unit-tested) in
// scripts/bundle-scan.mjs: a call to the global `fetch`. A `foo.fetch(...)`
// member call on some other object, or a `fetch(params){…}` method
// definition, is not one — mermaid (PRD 013, issue #161) pulls in katex,
// whose *parser method* is named `fetch` (~27 member calls plus one
// definition per bundle), none of which can reach the network. A call
// written `window.fetch(...)` still counts: it is the global.
console.log('\n=== validate: static bundle scan (network call sites) ===');
// Three call sites, each of them a single same-origin wrapper, counted once per
// bundle (dist/ and dist-web/) — 3 × 2 = 6. All three are reachable only when
// the served HTML carries the hosted marker; the static web build resolves to
// src/platform/web.ts, which reaches none of them (U556–U558 guard that).
//   1. PRD 007 Req 5 — the hosted sign-in gate funnels every request (sign-in,
//      session validation, the PKCE token exchange) through the single wrapper
//      in src/components/HostedSignIn.tsx.
//   2. PRD 007 Req 2 — the hosted Platform implementation funnels every API
//      call through the single wrapper in src/platform/hosted.ts.
//   3. PRD 009/010 — the workspace lifecycle (create/bind/unbind, the BYO
//      GitHub connection) has its own copy of that wrapper in
//      src/platform/hostedWorkspaces.ts.
// 4 → 6 as of issue #114. Site 3 landed with the workspace work (#90/#104/#105)
// without re-pinning this number: the scan only runs in the full `npm run
// validate`, which needs Rust on PATH, so the drift went unseen. Re-pinned to
// the count two fresh builds actually produce (dist-web/index.html 3,
// dist/assets/*.js 3).
// PRD 011 added no site of its own, in either flavor: desktop sends from the
// Rust shell through the `llm_request` IPC command (no webview fetch at all),
// and the hosted LLM client (src/platform/hostedLlm.ts) plus the hosted summary
// cache (src/platform/hostedSummaryCache.ts) are handed the `api(...)` wrapper
// of site 2 rather than opening their own. SPEC11 §6.6 (amended): this number
// is the count of same-origin wrappers that ship, not a claim of zero.
// PRD 013 (issue #161) added no site either: mermaid renders offline (Req 12)
// — audited over both fresh mermaid-carrying bundles, its chunks contain no
// bare fetch( call and none of the FORBIDDEN tokens below; katex's `fetch`
// parser method is excluded by the counting rule, not by widening this number.
const FETCH_ALLOWLIST = 6;
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
  fetchCount += countFetchCallSites(text);
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
