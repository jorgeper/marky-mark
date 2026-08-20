import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';

/**
 * PRD 013 Req 7 (issue #161), the build-shape half: mermaid's weight stays
 * out of the desktop entry chunk and out of `dist/index.html`'s load set, so
 * a session that never meets a mermaid fence never downloads or evaluates
 * the library. The runtime half — the adapter reaches mermaid only through
 * `import('mermaid')` on first render — is U730–U735
 * (tests/unit/mermaid-renderer.test.ts); this file checks what a fresh
 * `npm run build` actually emits, because rollup keeping the split is
 * otherwise an accident no fast-tier gate would notice breaking (the full
 * gate's bundle steps need Rust on PATH).
 *
 * Same shape as tests/unit/static-web-no-llm.test.ts: never assert against a
 * stale or absent artifact (`beforeAll` rebuilds `dist/` when it is missing
 * or older than its inputs), prove the files read are the real bundle before
 * reading anything out of them, and derive needles from the code that owns
 * them where possible — mermaid's own internals have no importable constant
 * to derive from, so those needles are instead proven present in the built
 * mermaid chunks before their absence from the entry chunk means anything.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST_HTML = path.join(ROOT, 'dist', 'index.html');
const ASSETS = path.join(ROOT, 'dist', 'assets');

/** Newest mtime under a path, so a stale bundle is rebuilt rather than trusted. */
function newestMtime(rel: string): number {
  const abs = path.join(ROOT, rel);
  const stat = statSync(abs);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of readdirSync(abs)) newest = Math.max(newest, newestMtime(path.join(rel, entry)));
  return newest;
}

/** The inputs `npm run build` reads: a change to any of them stales the bundle. */
const BUILD_INPUTS = ['src', 'index.html', 'vite.config.ts', 'package.json'];

beforeAll(() => {
  const newestInput = Math.max(...BUILD_INPUTS.map(newestMtime));
  if (existsSync(DIST_HTML) && statSync(DIST_HTML).mtimeMs >= newestInput) return;
  // ~5s, and only when the artifact is missing or behind its sources — the
  // alternative (assert only when it happens to exist) is a guard that goes
  // quiet exactly when someone has just changed the code it guards.
  try {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`npm run build failed:\n${stderr ?? ''}${stdout ?? ''}`);
  }
}, 300_000);

/** dist/index.html, proven to be the real shell page before anything is read out of it. */
function shellHtml(): string {
  expect(existsSync(DIST_HTML), 'dist/index.html is absent — the guard has nothing to check').toBe(true);
  const html = readFileSync(DIST_HTML, 'utf8');
  expect(html, 'dist/index.html is not the Marky Mark shell page').toContain('<title>Marky Mark</title>');
  expect(html, 'dist/index.html lost the app mount point').toContain('<div id="root">');
  return html;
}

/**
 * Strings that live only inside mermaid's own code (diagram-type detector
 * ids); nothing under src/ mentions them. Their presence in the lazy chunks
 * is asserted first, so a mermaid release renaming one fails the sentinel
 * loudly instead of leaving the entry-chunk assertion vacuously green.
 */
const MERMAID_NEEDLES = ['sequenceDiagram', 'classDiagram', 'flowchart-v2'];

describe('PRD 013 Req 7 — desktop build keeps mermaid out of the startup load set (issue #161)', () => {
  test('U750: dist/index.html loads the entry script and stylesheet only — nothing preloads a mermaid chunk', () => {
    const html = shellHtml();
    // The whole load set: one module script (the entry) plus one stylesheet.
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts, 'dist/index.html must load exactly one script').toHaveLength(1);
    expect(scripts[0]).toMatch(/src="\/assets\/index-[^"]+\.js"/);
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
    expect(links.filter((l) => l.includes('rel="stylesheet"'))).toHaveLength(1);
    // No <link rel="modulepreload"> at all: startup neither downloads nor
    // evaluates a lazy chunk, mermaid's included (vite.config.ts also drops
    // the preload polyfill — SPEC11 §6.6).
    expect(html, 'dist/index.html preloads a chunk').not.toContain('modulepreload');
    expect(html, 'dist/index.html references a mermaid chunk').not.toMatch(/mermaid/i);
  });

  test('U751: the entry chunk carries no mermaid library code — only the rewritten dynamic-import site', () => {
    const html = shellHtml();
    const entryName = /src="\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1];
    expect(entryName, 'dist/index.html names no entry chunk').toBeTruthy();
    const entry = readFileSync(path.join(ASSETS, entryName as string), 'utf8');
    // Sentinel: the real app entry — the adapter's diagram id prefix, whose
    // owner is src/lib/mermaidRenderer.ts (statically imported by App.tsx).
    const idPrefix = 'mm-diagram-';
    expect(readFileSync(path.join(ROOT, 'src/lib/mermaidRenderer.ts'), 'utf8')).toContain(idPrefix);
    expect(entry, 'not the Marky Mark entry chunk — the mermaid adapter is missing').toContain(idPrefix);

    // The library needles are real for the installed mermaid: each appears in
    // at least one chunk other than the entry (the lazy mermaid graph).
    const otherChunks = readdirSync(ASSETS).filter((f) => f.endsWith('.js') && f !== entryName);
    expect(otherChunks.some((f) => /^mermaid\.core-.+\.js$/.test(f)), 'no mermaid.core-*.js lazy chunk was emitted').toBe(
      true,
    );
    const others = otherChunks.map((f) => readFileSync(path.join(ASSETS, f), 'utf8'));
    for (const needle of MERMAID_NEEDLES) {
      expect(
        others.some((text) => text.includes(needle)),
        `needle ${needle} is in no lazy chunk — stale needle, the entry assertion below would be vacuous`,
      ).toBe(true);
      expect(entry.includes(needle), `mermaid library code (${needle}) reached the entry chunk`).toBe(false);
    }

    // Stricter: every mention of mermaid in the entry is either the fence tag
    // literal ('mermaid', the registration in src/lib/mermaidRenderer.ts) or
    // the chunk specifier rollup rewrote `import('mermaid')` into.
    for (const match of entry.matchAll(/mermaid/g)) {
      const context = entry.slice(Math.max(0, match.index - 2), match.index + 40);
      expect(
        /["']mermaid["']/.test(context) || /mermaid\.core-[\w-]+\.js/.test(context),
        `unexpected mermaid mention in the entry chunk: …${context}…`,
      ).toBe(true);
    }
  });
});
