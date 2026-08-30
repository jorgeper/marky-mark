import { cpus } from 'node:os';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4923;

// PRD 007 Req 4: the hosted backend the E159+ tests exercise — a separate
// port so it never clashes with the shim server above.
const HOSTED_PORT = 4924;

// `fullyParallel` interleaves tests across files, so `workers` is what sets
// the concurrency. The count was pinned at 2 for the smallest host that runs
// this suite; scale it with the machine instead, and let a Sandcastle sandbox
// that shares its cores with sibling lanes pin it back down with PW_WORKERS.
const WORKERS = process.env.PW_WORKERS
  ? Number(process.env.PW_WORKERS)
  : Math.max(2, Math.min(6, Math.floor(cpus().length / 2)));

export default defineConfig({
  testDir: 'tests/e2e',
  // The desktop-shim suite is every *.spec.ts under tests/e2e except web.spec.ts,
  // which belongs to playwright.web.config.ts. Matching by glob (issue #31) means
  // a new feature file is collected without a config edit; scripts/validate.mjs
  // holds a committed floor on the collected count so a miss here is loud.
  testMatch: '*.spec.ts',
  testIgnore: 'web.spec.ts',
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
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    // PRD 007 Req 4: the hosted server in local dev mode for the E159+ suite
    // (tests/e2e/hosted.spec.ts). The command arranges everything itself —
    // SPA build if dist/ is missing, Azurite from node_modules, then the
    // server — all offline; the generous timeout covers that cold build. The
    // URL probe is the served SPA, which only answers once the whole chain is
    // up.
    {
      command: 'npm run server:local',
      url: `http://localhost:${HOSTED_PORT}/`,
      reuseExistingServer: true,
      timeout: 180_000,
      // Issue #179: the e2e lane's Azurite holds its store in RAM, so every
      // gate run starts from an empty store — no crash-safe draft or
      // workspace leftovers from a previous run (hand-run `server:local`
      // still persists; see server/README.md § Local development).
      env: { MM_AZURITE_IN_MEMORY: '1' },
    },
  ],
});
