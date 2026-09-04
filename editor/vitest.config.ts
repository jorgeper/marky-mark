import { defineConfig } from 'vitest/config';

// PRD 021 Req 2 (issue #237): the package's own unit suite — `npm test` inside
// editor/ runs exactly the tests that moved here with their modules, in
// isolation from the app's root suite.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Same worker-sharing rationale as the root suite: these are pure-function
    // tests with no global state to protect, and per-file isolation would
    // spend the run forking environments instead of asserting.
    pool: 'threads',
    poolOptions: { threads: { isolate: false } },
  },
});
