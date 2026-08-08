// PRD 011 Req 35: no test may contact a real provider. The rule is enforced in
// its safe general form — no test's page may reach ANY origin that is not
// loopback — because a provider host is only one of the ways a suite can start
// depending on the internet, and an allowlist of vendor hosts would go stale
// the day a sixth provider is added.
//
// The classifier lives here, in a module `fixtures.ts` imports rather than
// inside it, for one reason: a unit test can then prove it bites
// (`tests/unit/llm-test-isolation.test.ts`) without pulling the Playwright
// runner into the vitest suite. It is not a `*.spec.ts`, so it collects no
// tests and moves no floor.

/**
 * The loopback host names a browser can be pointed at. The suite's own servers
 * are all here: the shim's vite on 4923, the hosted server on 4924, the web
 * preview on 4925, the GitHub lane's ports and Azurite
 * (`playwright.config.ts`, `server/e2eGithubLane.ts`).
 */
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i;

/**
 * The origin a request leaves the machine for, or `null` when it does not.
 *
 * Only network schemes are judged: `data:`, `blob:`, `about:` and `file:` URLs
 * carry no origin and reach nothing, and the suite makes plenty of them (the
 * shim serves images as data URIs, saves go through blob downloads). An
 * `http(s)`/`ws(s)` URL that will not parse is reported rather than trusted —
 * "could not prove it is loopback" is not "it is loopback".
 */
export function offsiteOrigin(url: string): string | null {
  if (!/^(?:https?|wss?):/i.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  return LOOPBACK.test(parsed.hostname) ? null : parsed.origin;
}
