import { defineConfig, devices } from '@playwright/test';

const PORT = 4925;

// Web e2e: serves the BUILT single-file page (dist-web/index.html) statically,
// per SPEC2 §7 — the suite must exercise the production web artifact.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'web.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npx vite preview --config vite.web.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
