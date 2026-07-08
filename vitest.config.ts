import { defineConfig } from 'vitest/config';
import pkg from './package.json';

export default defineConfig({
  // Unit tests see the same build-time version constant as the app (SPEC10 §2).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
