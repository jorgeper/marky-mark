import { cpus } from 'node:os';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4923;

// All 136 tests live in one file, so `fullyParallel` is what lets `workers`
// matter at all. The count was pinned at 2 for the smallest host that runs
// this suite; scale it with the machine instead, and let a Sandcastle sandbox
// that shares its cores with sibling lanes pin it back down with PW_WORKERS.
const WORKERS = process.env.PW_WORKERS
  ? Number(process.env.PW_WORKERS)
  : Math.max(2, Math.min(6, Math.floor(cpus().length / 2)));

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'app.spec.ts',
  fullyParallel: true,
  workers: WORKERS,
  // A timing-sensitive test that flakes under load used to cost a full ~9min
  // gate re-run, because the agent's only recourse was `npm run
  // validate:quick` again (issue #32's lane did that 16 times). One retry
  // costs seconds and still reports the test as "flaky", not "passed", so the
  // gate evidence stays honest.
  retries: 1,
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
