import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The static-web target (SPEC2 §3): everything — JS, CSS, themes, fixtures —
// inlined into one self-contained dist-web/index.html with zero external
// requests. Dynamic imports (the lazy CodeMirror chunk) are inlined too.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist-web',
  },
});
