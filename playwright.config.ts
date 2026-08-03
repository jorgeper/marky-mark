import { defineConfig, devices } from '@playwright/test';

const PORT = 4923;

export default defineConfig({
  testDir: 'tests/e2e',
  // The desktop-shim suite is every *.spec.ts under tests/e2e except web.spec.ts,
  // which belongs to playwright.web.config.ts. Matching by glob (issue #31) means
  // a new feature file is collected without a config edit; scripts/validate.mjs
  // holds a committed floor on the collected count so a miss here is loud.
  testMatch: '*.spec.ts',
  testIgnore: 'web.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
