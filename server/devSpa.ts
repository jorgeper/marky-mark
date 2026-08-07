// PRD 007 Req 4 + PRD 010 Req 22: the one "a built SPA to serve" step both
// offline lanes boot through — `server/local.ts` (Azurite-backed) and
// `server/e2e-github.ts` (GitHub-backed). Each serves the built bundle to a
// real browser, and PRD 007 Req 5 means neither may test a stale dist: the
// served HTML carries the hosted sign-in gate.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Newest mtime under a path (recursively for directories). */
function newestMtimeMs(p: string): number {
  const stat = statSync(p);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(p)) newest = Math.max(newest, newestMtimeMs(path.join(p, entry)));
  return newest;
}

/**
 * Build `dist/` when it is absent OR older than the SPA sources. Exits the
 * process with the build's own status when the build fails — a lane that
 * cannot produce a bundle has nothing to serve.
 */
export function ensureSpaBuilt(root: string): void {
  const distIndex = path.join(root, 'dist', 'index.html');
  const sources = ['src', 'index.html', 'vite.config.ts', 'package.json'].map((s) => path.join(root, s));
  const stale =
    !existsSync(distIndex) ||
    statSync(distIndex).mtimeMs < Math.max(...sources.filter(existsSync).map(newestMtimeMs));
  if (!stale) return;
  console.log('dist/ is missing or older than src/, building the SPA (npm run build)…');
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
