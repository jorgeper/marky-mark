import { defineConfig } from 'vitest/config';
import pkg from './package.json';

export default defineConfig({
  // Unit tests see the same build-time version constant as the app (SPEC10 §2).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // These are pure-function tests with no global state to protect: the
    // default per-file worker isolation spent ~30s of a ~35s run forking and
    // preparing 42 environments to execute ~1s of assertions. Sharing one
    // worker per thread drops the suite to ~5s, which matters because
    // QUICK_VERIFY_COMMANDS runs it after every change.
    pool: 'threads',
    poolOptions: { threads: { isolate: false } },
  },
});
