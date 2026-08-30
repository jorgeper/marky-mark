import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json';

// SPEC11 §3.2: the single-file page carries its own CSP. The inlined bundle
// needs 'unsafe-inline' for its one module script and injected styles; the
// load-bearing directives are connect-src 'none' and local-only img-src.
const WEB_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; " +
  "frame-src 'none'; base-uri 'none'; form-action 'none'";

function injectCsp(): Plugin {
  return {
    name: 'mm-inject-csp',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => ({
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: WEB_CSP },
            injectTo: 'head-prepend',
          },
        ],
      }),
    },
  };
}

/**
 * SPEC16 §1.5: the web build must NOT carry the Tauri platform — browsers
 * never take that branch, and tauri.ts embeds dist-web/index.html via
 * import.meta.glob, so inlining it would nest a stale copy of the viewer
 * inside itself (doubling the single file). Resolve it to a throwing stub.
 */
function stubTauriPlatform(): Plugin {
  const STUB = '\0mm-tauri-stub';
  return {
    name: 'mm-stub-tauri-platform',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.includes('platform/tauri') || (source === './tauri' && !!importer?.includes('platform/'))) {
        return STUB;
      }
      return null;
    },
    load(id) {
      if (id === STUB) {
        return 'export function createTauriPlatform() { throw new Error("tauri platform is not part of the web build"); }';
      }
      return null;
    },
  };
}

/**
 * PRD 011 Req 14 / SPEC11 §3.2 (amended, issue #114): the static web build has
 * **no LLM path at all**. `src/platform/web.ts` declares neither the hosted
 * `llm` capability nor the desktop `llmTransport`, so every provider adapter in
 * `src/lib/llmProviders.ts` is already dead code here — but dead code still
 * ships. This page is a single inlined file, so code splitting cannot help:
 * `vite-plugin-singlefile` inlines every dynamic chunk, and both importers of
 * that module are reachable (`llmSeam.ts` from `App.tsx`'s test-connection
 * path, `llmFake.ts` from the `?shim` dev platform). Without this stub the four
 * provider hosts land in dist-web/index.html — which is exactly what
 * `tests/unit/static-web-no-llm.test.ts` U558 fails on.
 *
 * So resolve the module away for this target only, the same move
 * `stubTauriPlatform` makes above. Desktop and hosted (`vite.config.ts`) keep
 * the real adapters. The stub keeps the module's shape for its two importers:
 * `providerFor` answers the seam's own typed `invalid-config` failure rather
 * than throwing, so a `?shim` page on a deployed static build degrades to "no
 * LLM path" — Req 14's stated behaviour — instead of crashing. Its endpoint
 * constants exist only so `llmFake.ts`'s provider labelling still resolves;
 * they name no host, and nothing in this build can reach one anyway
 * (`connect-src 'none'`).
 */
function stubWebLlmProviders(): Plugin {
  const STUB = '\0mm-llm-providers-stub';
  const NO_LLM = 'The static web build has no LLM path.';
  return {
    name: 'mm-stub-web-llm-providers',
    enforce: 'pre',
    resolveId(source, importer) {
      // src/lib imports carry explicit `.ts` extensions (issue #177), so
      // match the specifier with and without one.
      if (/\/llmProviders(\.ts)?$/.test(source) && !!importer?.includes('/src/lib/')) return STUB;
      return null;
    },
    load(id) {
      if (id !== STUB) return null;
      return [
        // Not the real hosts: `llmFake.ts` only compares a request URL against
        // these to label which provider a fake call went to.
        "export const OPENAI_ENDPOINT = 'llm-disabled:openai';",
        "export const OPENROUTER_ENDPOINT = 'llm-disabled:openrouter';",
        `const unavailable = { kind: 'invalid-config', message: ${JSON.stringify(NO_LLM)} };`,
        'export function providerFor() {',
        '  return { buildRequest: () => unavailable, readResponse: () => ({ ok: false, failure: unavailable }) };',
        '}',
      ].join('\n');
    },
  };
}

// The static-web target (SPEC2 §3): everything — JS, CSS, themes, fixtures —
// inlined into one self-contained dist-web/index.html with zero external
// requests. Dynamic imports (the lazy CodeMirror chunk) are inlined too.
export default defineConfig({
  plugins: [stubTauriPlatform(), stubWebLlmProviders(), react(), viteSingleFile(), injectCsp()],
  // Same build-time version constant as the desktop config (SPEC10 §2).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    // SPEC11 §6.6: no fetch() call sites may ship — drop vite's modulepreload
    // polyfill (an optimization only; modern webviews preload natively).
    modulePreload: { polyfill: false },
    target: 'es2022',
    outDir: 'dist-web',
  },
});
