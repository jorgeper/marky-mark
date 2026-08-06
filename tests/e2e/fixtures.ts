import { expect, test as base } from '@playwright/test';

/**
 * PRD 007 Req 20: the ONE browser log that is not an app error. A save the
 * server refuses (412) is the feature working — the app catches it and
 * prompts — but Chromium still writes the failed request to the console, and
 * no page code can suppress that. Nothing else is exempt.
 */
const EXPECTED_NETWORK_LOG = /Failed to load resource:.*412 \(Precondition Failed\)/;

/**
 * Shared test fixture: any browser console error or uncaught page error
 * fails the test (SPEC §4 — zero console errors during any e2e run).
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !EXPECTED_NETWORK_LOG.test(msg.text())) errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(String(err)));
      await use();
      expect(errors, 'no console errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
