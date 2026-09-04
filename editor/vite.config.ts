import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PRD 021 Req 2 (issue #237): the package's own build — an ESM library with
// react/react-dom as peer dependencies and every runtime dependency external
// (consumers install those; only this package's own modules are bundled).
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    // Bare specifiers (react, @codemirror/*, unified, …) stay external; only
    // relative/absolute ids — this package's own sources — are bundled.
    rollupOptions: { external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0') },
    outDir: 'dist',
    target: 'es2022',
  },
});
