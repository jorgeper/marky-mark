import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Tauri expects a fixed dev port; the browser-shim e2e server picks its own.
export default defineConfig({
  plugins: [react()],
  // Single source of truth for the app version (SPEC10 §2): package.json,
  // baked in at build time. The pre-release identifier is preserved verbatim.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    // `tauri dev` points its webview at this exact port, so it must be strict;
    // the Playwright webServer passes its own --port/--strictPort flags.
    port: 1420,
    strictPort: true,
  },
  build: {
    // SPEC11 §6.6: no fetch() call sites may ship — drop vite's modulepreload
    // polyfill (an optimization only; modern webviews preload natively).
    modulePreload: { polyfill: false },
    target: 'es2022',
    outDir: 'dist',
  },
});
