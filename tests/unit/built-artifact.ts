import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared by the fast-tier guards that assert over a *built* artifact —
// `static-web-no-llm.test.ts` (PRD 011 Req 14, dist-web) and
// `static-desktop-mermaid.test.ts` (PRD 013 Req 7, issue #161, dist). Both
// must never pass because their artifact was missing or stale, and both look
// for the same mermaid needles. One copy, so the two guards can never
// disagree about either.

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Strings that live only inside mermaid's own code (diagram-type detector
 * ids); nothing under `src/` mentions them. Each guard proves its needles are
 * present somewhere first, so a mermaid release renaming one fails loudly
 * instead of leaving the property it guards vacuously green.
 */
export const MERMAID_NEEDLES = ['sequenceDiagram', 'classDiagram', 'flowchart-v2'];

/** Newest mtime under a repo-relative path, so a stale bundle is rebuilt rather than trusted. */
function newestMtime(rel: string): number {
  const abs = path.join(ROOT, rel);
  const stat = statSync(abs);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of readdirSync(abs)) newest = Math.max(newest, newestMtime(path.join(rel, entry)));
  return newest;
}

/**
 * Run `npm run <script>` when `artifact` is missing or older than any of the
 * repo-relative `inputs` that build reads — seconds, and only then. The
 * alternative (assert only when the artifact happens to exist) is a guard
 * that goes quiet exactly when someone has just changed the code it guards.
 */
export function buildWhenStale(artifact: string, inputs: string[], script: string): void {
  const newestInput = Math.max(...inputs.map(newestMtime));
  if (existsSync(artifact) && statSync(artifact).mtimeMs >= newestInput) return;
  try {
    // NODE_ENV explicitly: vitest sets it to `test`, and vite leaves an
    // already-set value alone — the artifact would then be a *development*
    // bundle (unminified, React's dev build) rather than the one that ships,
    // which is the same "you are asserting over the wrong file" failure this
    // helper exists to prevent.
    execFileSync('npm', ['run', script], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } });
  } catch (error) {
    // Captured output, or a failing build reads as a bare "Command failed".
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`npm run ${script} failed:\n${stderr ?? ''}${stdout ?? ''}`);
  }
}
