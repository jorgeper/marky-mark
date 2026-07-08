import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json';

// The static-web target (SPEC2 §3): everything — JS, CSS, themes, fixtures —
// inlined into one self-contained dist-web/index.html with zero external
// requests. Dynamic imports (the lazy CodeMirror chunk) are inlined too.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // Same build-time version constant as the desktop config (SPEC10 §2).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2022',
    outDir: 'dist-web',
  },
});
