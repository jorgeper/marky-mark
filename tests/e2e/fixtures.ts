import { expect, test as base } from '@playwright/test';
import { offsiteOrigin } from './offsite';

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
export const test = base.extend<{ consoleGuard: void; loopbackGuard: void }>({
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

  /**
   * PRD 011 Req 35: no test may contact a real provider. Stated as the
   * property that actually protects the suite — every request the page issues
   * stays on loopback — so an LLM vendor's host fails here loudly whether it
   * was reached by the app, by a `page.route` fulfilled offsite, or by a
   * script a test evaluated. Both configs load this file
   * (`playwright.config.ts` and `playwright.web.config.ts`), so the rule
   * covers the desktop shim, the hosted lane and the built web page alike.
   *
   * SPEC11: the app is local-only, so this changes no existing test — the
   * suite's own servers are loopback and the one remote reference in it
   * (E116's `evil.example.com` image) is a URL the app refuses to load rather
   * than a request it makes.
   *
   * The event fires when the page ISSUES the request, so a host that never
   * resolves is caught just as squarely as one that answers.
   */
  loopbackGuard: [
    async ({ page }, use) => {
      const offsite: string[] = [];
      page.on('request', (req) => {
        const origin = offsiteOrigin(req.url());
        if (origin !== null && !offsite.includes(origin)) offsite.push(origin);
      });
      await use();
      expect(offsite, 'every request this test made stayed on loopback (PRD 011 Req 35)').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
