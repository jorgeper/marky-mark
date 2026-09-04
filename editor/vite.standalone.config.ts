import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PRD 021 Req 14 (issue #240): the standalone browser bundle — the opposite
// of vite.config.ts's externals-only ESM library. One classic-script (IIFE)
// file with React and every runtime dependency bundled in (no externals, no
// bare imports at runtime), exposed as the `MarkyMarkEditor` global, so a
// plain HTML page opened from disk (`file://`, where Chromium blocks
// cross-file module loads) can load it with one <script> tag. Emits to
// dist/standalone/ via `npm run build:standalone -w editor`; the library
// build's own dist/ output is untouched by this config.
export default defineConfig({
  plugins: [react()],
  // React's CJS entry branches on process.env.NODE_ENV at runtime; a browser
  // has no `process`, so bake the branch in.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: 'src/standalone.tsx',
      formats: ['iife'],
      name: 'MarkyMarkEditor',
      fileName: () => 'marky-mark-editor.js',
      cssFileName: 'marky-mark-editor',
    },
    outDir: 'dist/standalone',
    emptyOutDir: true,
    target: 'es2022',
    // Everything (React, CodeMirror, unified, mermaid) rides in one file by
    // design — silence the default 500kB advice.
    chunkSizeWarningLimit: 10000,
  },
});
