import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import { LLM_REQUEST_COMMAND } from '../../src/lib/llmDesktopTransport';
import { ANTHROPIC_ENDPOINT, GEMINI_BASE, OPENAI_ENDPOINT, OPENROUTER_ENDPOINT } from '../../src/lib/llmProviders';

/**
 * PRD 011 Req 14 / SPEC11 §3.2 (amended, issue #114): the static web build has
 * **no LLM path at all**. Desktop sends from the Rust shell and hosted sends to
 * its own origin, but the single-file build keeps the unconditional property it
 * shipped with: nothing in it can reach any network at all.
 *
 * Nothing enforced that. The bundle scan in `scripts/validate.mjs` counts
 * `fetch(` sites but runs only in the full gate (which needs Rust on PATH), and
 * the CSP is a build-config line one edit away from widening. This guard is the
 * fast-tier check that bites first, in the shape the suite already uses for
 * this kind of property (`tests/unit/zoom-purity.test.ts`,
 * `tests/unit/docs-hosting-llm.test.ts`): read the real sources and the real
 * artifact, and derive every needle from the code that owns it rather than
 * hand-copying a provider host into a test.
 *
 * The dist-level assertions must never pass because the artifact was missing or
 * stale, so `beforeAll` rebuilds `dist-web/index.html` whenever it is absent or
 * older than any input to it, and the assertions start by proving the file they
 * read is a real Marky Mark web bundle.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const DIST_WEB = path.join(ROOT, 'dist-web', 'index.html');

/** Newest mtime under a path, so a stale bundle is rebuilt rather than trusted. */
function newestMtime(rel: string): number {
  const abs = path.join(ROOT, rel);
  const stat = statSync(abs);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of readdirSync(abs)) newest = Math.max(newest, newestMtime(path.join(rel, entry)));
  return newest;
}

/** The inputs `npm run build:web` reads: a change to any of them stales the bundle. */
const BUILD_INPUTS = ['src', 'vite.web.config.ts', 'package.json'];

beforeAll(() => {
  const newestInput = Math.max(...BUILD_INPUTS.map(newestMtime));
  if (existsSync(DIST_WEB) && statSync(DIST_WEB).mtimeMs >= newestInput) return;
  // ~2s, and only when the artifact is missing or behind its sources — the
  // alternative (assert only when it happens to exist) is a guard that goes
  // quiet exactly when someone has just changed the code it guards.
  execFileSync('npm', ['run', 'build:web'], { cwd: ROOT, stdio: 'pipe' });
}, 300_000);

/** Blank out comments and string literals, so prose can neither mask nor fake a reference. */
function code(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = raw;
    if (inBlock) {
      const close = line.indexOf('*/');
      if (close === -1) {
        out.push('');
        continue;
      }
      line = line.slice(close + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, ' ');
    const open = line.indexOf('/*');
    if (open !== -1) {
      inBlock = true;
      line = line.slice(0, open);
    }
    line = line.replace(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g, "''");
    line = line.replace(/\/\/.*$/, '');
    out.push(line);
  }
  return out.join('\n');
}

/** The built page, proven to be the real bundle before anything is read out of it. */
function bundle(): string {
  expect(existsSync(DIST_WEB), 'dist-web/index.html is absent — the guard has nothing to check').toBe(true);
  const html = readFileSync(DIST_WEB, 'utf8');
  // Sentinels: an empty or truncated file must fail here, not sail through the
  // "does not contain" assertions below.
  expect(html, 'dist-web/index.html carries no CSP meta — not a Marky Mark web bundle').toContain(
    'http-equiv="Content-Security-Policy"',
  );
  expect(html.length, 'dist-web/index.html is too small to be the inlined single-file build').toBeGreaterThan(100_000);
  return html;
}

describe('PRD 011 Req 14 the static web build has no LLM path', () => {
  test('U556: the static-web Platform declares neither llm nor llmTransport', () => {
    // `src/platform/index.ts` resolves a browser without the hosted marker to
    // this module, so this file is the whole of the static flavor's seam.
    expect(code(read('src/platform/index.ts'))).toContain("m.createWebPlatform()");
    const web = code(read('src/platform/web.ts'));
    // Both seam capabilities by name (SPEC11 §3.2 amended: hosted has `llm`,
    // desktop has `llmTransport`, static web has neither) — and, stricter, no
    // mention of an LLM at all in effective code.
    expect(web, 'src/platform/web.ts declares the hosted LLM capability').not.toMatch(/\bllm\s*:/);
    expect(web, 'src/platform/web.ts declares the desktop LLM transport').not.toMatch(/\bllmTransport\s*:/);
    expect(web, 'src/platform/web.ts has grown an LLM reference').not.toMatch(/llm/i);
  });

  test('U557: the web build CSP still forbids every outbound connection', () => {
    const config = read('vite.web.config.ts');
    const policy = /const WEB_CSP =\s*([\s\S]*?);\n/.exec(config)?.[1];
    expect(policy, 'vite.web.config.ts no longer declares WEB_CSP').toBeTruthy();
    // The declaration is a `+`-concatenation of double-quoted literals whose
    // own single quotes are part of the policy: join the literals, keep them.
    const csp = [...(policy as string).matchAll(/"([^"]*)"/g)]
      .map((m) => m[1])
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    expect(csp.length, 'WEB_CSP parsed as empty').toBeGreaterThan(50);
    // Req 14: byte-unchanged. `connect-src 'none'` is the load-bearing line —
    // no fetch/XHR/WebSocket/EventSource/beacon can leave the page — and no
    // remote origin may appear in any directive.
    expect(csp).toContain("connect-src 'none'");
    expect(csp, 'a remote origin reached the web CSP').not.toMatch(/https?:|\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    // The policy the built page actually carries is that same policy.
    const injected = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(bundle())?.[1];
    expect(injected, 'dist-web/index.html carries no CSP content').toBeTruthy();
    // The injector HTML-escapes the policy's own single quotes into the attribute.
    const shipped = (injected as string).replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    expect(shipped).toBe(csp);
  });

  test('U558: no provider endpoint and no desktop LLM command reach the built page', () => {
    const html = bundle();
    // Derived from `src/lib/llmProviders.ts`, so a sixth provider's host is
    // covered here the day it is added — never a hand-copied list.
    const hosts = [OPENAI_ENDPOINT, ANTHROPIC_ENDPOINT, GEMINI_BASE, OPENROUTER_ENDPOINT].map(
      (endpoint) => new URL(endpoint).host,
    );
    for (const host of hosts) {
      expect(html.includes(host), `dist-web/index.html reaches provider host ${host}`).toBe(false);
    }
    // The Rust command name (PRD 011 Req 12) cannot ship either: the web config
    // stubs `src/platform/tauri.ts` out of this bundle entirely.
    expect(
      html.includes(LLM_REQUEST_COMMAND),
      `dist-web/index.html names the desktop ${LLM_REQUEST_COMMAND} command`,
    ).toBe(false);
    // Sanity that the needles are real strings and not empty ones, which would
    // make every assertion above trivially true.
    for (const needle of [...hosts, LLM_REQUEST_COMMAND]) expect(needle.length).toBeGreaterThan(3);
  });
});
