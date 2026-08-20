import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { LLM_REQUEST_COMMAND } from '../../src/lib/llmDesktopTransport';
import { ANTHROPIC_ENDPOINT, GEMINI_BASE, OPENAI_ENDPOINT, OPENROUTER_ENDPOINT } from '../../src/lib/llmProviders';
import { MERMAID_NEEDLES, ROOT, buildWhenStale } from './built-artifact';
import { effectiveCode } from './source-scan';

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

const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const DIST_WEB = path.join(ROOT, 'dist-web', 'index.html');

/** The inputs `npm run build:web` reads: a change to any of them stales the bundle. */
const BUILD_INPUTS = ['src', 'index.html', 'vite.web.config.ts', 'package.json'];

beforeAll(() => buildWhenStale(DIST_WEB, BUILD_INPUTS, 'build:web'), 300_000);

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
    expect(effectiveCode(read('src/platform/index.ts'))).toContain('m.createWebPlatform()');
    const web = effectiveCode(read('src/platform/web.ts'));
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
    // First that the needles are real strings and not empty ones, which would
    // make every "does not contain" below trivially true.
    for (const needle of [...hosts, LLM_REQUEST_COMMAND]) expect(needle.length).toBeGreaterThan(3);
    for (const host of hosts) {
      expect(html.includes(host), `dist-web/index.html reaches provider host ${host}`).toBe(false);
    }
    // The Rust command name (PRD 011 Req 12) cannot ship either: the web config
    // stubs `src/platform/tauri.ts` out of this bundle entirely.
    expect(
      html.includes(LLM_REQUEST_COMMAND),
      `dist-web/index.html names the desktop ${LLM_REQUEST_COMMAND} command`,
    ).toBe(false);
  });
});

// PRD 013 Req 8 (issue #161): the web build's mermaid story is the mirror of
// the desktop's (tests/unit/static-desktop-mermaid.test.ts). There is no lazy
// chunk to keep out here — under this page's CSP (`connect-src 'none'`,
// asserted byte-for-byte by U557 above) an un-inlined async chunk could never
// be fetched and the feature would fail silently — so mermaid must be inlined
// *into* the one self-contained file. This guard lives in this file to share
// its rebuild-when-stale `beforeAll` and `bundle()` sentinels: two fast-tier
// files rebuilding dist-web concurrently would race in the same outDir.
describe('PRD 013 Req 8 the static web build inlines mermaid into its single file', () => {
  test('U752: dist-web is exactly one self-contained index.html with mermaid inlined into it', () => {
    // Exactly one file: an emitted-but-unreferenced async chunk would sit
    // beside index.html, unreachable under the CSP.
    expect(readdirSync(path.dirname(DIST_WEB))).toEqual(['index.html']);
    const html = bundle();
    // Self-contained: the same shapes the full gate's single-file check
    // rejects (scripts/validate.mjs), here in the tier that runs without Rust.
    expect(html, 'dist-web/index.html loads an external script').not.toMatch(/<script[^>]+src=/);
    expect(html, 'dist-web/index.html loads an external stylesheet').not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href=/);
    // Mermaid is inside: the shared detector-id needles, asserted positively,
    // so a mermaid release renaming one fails loudly here rather than leaving
    // the property unchecked.
    for (const needle of MERMAID_NEEDLES) {
      expect(html.includes(needle), `mermaid's ${needle} is not inlined in dist-web/index.html`).toBe(true);
    }
  });
});
