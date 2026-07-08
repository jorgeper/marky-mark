import { expect, test as base } from '@playwright/test';

/**
 * Shared test fixture: any browser console error or uncaught page error
 * fails the test (SPEC §4 — zero console errors during any e2e run).
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(String(err)));
      await use();
      expect(errors, 'no console errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
