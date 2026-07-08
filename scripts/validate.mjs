#!/usr/bin/env node
/**
 * Validation harness (SPEC §8 + SPEC2 §7 + SPEC10 §1.3). Runs, in order,
 * failing on the first non-zero exit:
 *   1. version lock-step check (three version files agree, valid semver)
 *   2. tsc --noEmit
 *   3. unit tests (Vitest, U1–U16)
 *   4. desktop e2e (Playwright, browser platform shim, E1–E41 + E45)
 *   5. single-file web build
 *   6. web e2e (Playwright against dist-web, W1–W4)
 *   7. cargo check (Rust host compiles)
 *   8. single-file check (dist-web = exactly one self-contained index.html)
 * Prints VALIDATION: ALL PASSED as the final line only if all steps passed.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  PATH: `${path.join(homedir(), '.cargo', 'bin')}:${process.env.PATH ?? ''}`,
};

// Version lock-step (SPEC10 §1.3): the three release files must agree on one
// valid semver, pre-release identifier intact.
console.log('=== validate: version lock-step ===');
const versions = {
  'package.json': JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  'src-tauri/tauri.conf.json': JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version,
  'src-tauri/Cargo.toml': /^version = "([^"]*)"/m.exec(readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8'))?.[1],
};
const { isValidSemver } = await import('./release-prepare.mjs');
const distinct = new Set(Object.values(versions));
if (distinct.size !== 1 || !isValidSemver(versions['package.json'])) {
  for (const [f, v] of Object.entries(versions)) console.error(`  ${f}: ${v}`);
  console.error('\nVALIDATION FAILED at step: version lock-step');
  process.exit(1);
}
console.log(`version ${versions['package.json']} in lock-step across package.json, tauri.conf.json, Cargo.toml`);

const steps = [
  { name: 'typecheck', cmd: 'npx', args: ['tsc', '--noEmit'] },
  { name: 'unit tests', cmd: 'npm', args: ['run', 'test:unit'] },
  { name: 'e2e tests (desktop shim)', cmd: 'npm', args: ['run', 'test:e2e'] },
  { name: 'web single-file build', cmd: 'npm', args: ['run', 'build:web'] },
  { name: 'e2e tests (web, dist-web)', cmd: 'npm', args: ['run', 'test:e2e:web'] },
  { name: 'cargo check', cmd: 'cargo', args: ['check'], cwd: path.join(root, 'src-tauri') },
];

for (const step of steps) {
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

console.log('\nVALIDATION: ALL PASSED');
