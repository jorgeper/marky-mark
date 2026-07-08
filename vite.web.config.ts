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

// The static-web target (SPEC2 §3): everything — JS, CSS, themes, fixtures —
// inlined into one self-contained dist-web/index.html with zero external
// requests. Dynamic imports (the lazy CodeMirror chunk) are inlined too.
export default defineConfig({
  plugins: [react(), viteSingleFile(), injectCsp()],
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
