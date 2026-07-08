#!/usr/bin/env node
/**
 * Validation harness (SPEC §8 + SPEC2 §7). Runs, in order, failing on the
 * first non-zero exit:
 *   1. tsc --noEmit
 *   2. unit tests (Vitest, U1–U11)
 *   3. desktop e2e (Playwright, browser platform shim, E1–E16)
 *   4. single-file web build
 *   5. web e2e (Playwright against dist-web, W1–W4)
 *   6. cargo check (Rust host compiles)
 *   7. single-file check (dist-web = exactly one self-contained index.html)
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
