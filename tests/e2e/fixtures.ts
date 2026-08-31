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
 * Issue #183 §3: the second exemption, scoped by URL instead of message —
 * E361 forces `/api/directory/search` to fail to prove the picker's inline
 * error state, and Chromium logs that failed request just like the 412.
 * The URL rides in the log's location, not its text.
 */
const EXPECTED_DIRECTORY_FAILURE = /\/api\/directory\/search/;

/**
 * PRD 017 Req 29 (issue #190): the third exemption, same shape — E379 drives
 * an invitation the directory refuses to prove the inline 502 lane, and
 * Chromium logs that failed POST like the two above.
 */
const EXPECTED_INVITATION_REFUSAL = /\/api\/admin\/invitations/;

/**
 * Shared test fixture: any browser console error or uncaught page error
 * fails the test (SPEC §4 — zero console errors during any e2e run).
 */
export const test = base.extend<{ consoleGuard: void; loopbackGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() !== 'error' || EXPECTED_NETWORK_LOG.test(msg.text())) return;
        if (/Failed to load resource/.test(msg.text()) && EXPECTED_DIRECTORY_FAILURE.test(msg.location().url ?? '')) {
          return;
        }
        if (/Failed to load resource/.test(msg.text()) && EXPECTED_INVITATION_REFUSAL.test(msg.location().url ?? '')) {
          return;
        }
        errors.push(msg.text());
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
