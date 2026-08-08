import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
// Imported as a namespace, not by name, because U651 asks the module what it
// publishes as well as reading the four constants it publishes today.
import * as llmProviders from '../../src/lib/llmProviders';
import { offsiteOrigin } from '../e2e/offsite';

/**
 * PRD 011 Req 35 (#121): "no test may contact a real provider" lived only in
 * comments. This is the mechanical half of pinning it, and it has two parts
 * that fail for different reasons:
 *
 *  - **Runtime** — `tests/e2e/fixtures.ts` fails any test whose page issues a
 *    request off loopback. Its classifier is `tests/e2e/offsite.ts`, and U651
 *    proves it answers "offsite" for every host `src/lib/llmProviders.ts`
 *    actually names.
 *  - **Source** — U652 reads the test sources and fails if a provider host
 *    appears anywhere outside the allowlist below, so a vendor host cannot
 *    even be typed into a test that never runs; U653 proves that scan bites.
 *
 * Every needle is derived from the provider descriptors, never hand-copied, and
 * U651 cross-checks the list against everything the module publishes — so a
 * sixth provider's endpoint fails here until it is covered too. Same rule as
 * `tests/unit/static-web-no-llm.test.ts`, which scans the shipped bundle.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The vendor hosts, straight from the descriptors that own them. */
const PROVIDER_HOSTS = [
  llmProviders.OPENAI_ENDPOINT,
  llmProviders.ANTHROPIC_ENDPOINT,
  llmProviders.GEMINI_BASE,
  llmProviders.OPENROUTER_ENDPOINT,
].map((endpoint) => new URL(endpoint).host);

/**
 * Every absolute URL `src/lib/llmProviders.ts` exports, whether or not the list
 * above names it. This is what keeps that list from going quietly stale: the
 * module is asked, rather than a reader being trusted to remember. `<unknown>`
 * because the module's exports are literal-typed, so without it the narrowing
 * below would be a type predicate over that union rather than over strings.
 */
const EXPORTED_ENDPOINTS = Object.values<unknown>(llmProviders).filter(
  (value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value),
);

/**
 * Where a provider host may legitimately appear in the test sources, and why —
 * one line each, in the voice `FETCH_ALLOWLIST` / `E2E_TEST_FLOOR` use in
 * `scripts/validate.mjs`. An entry here is a claim that the string is inert
 * data, never an address anything dials. Adding one is a decision to justify,
 * not a way to make this test go green.
 */
const HOST_ALLOWLIST: Readonly<Record<string, string>> = {
  // Inert data: the URL a fake `invoke` is handed and the URL that same fake
  // records back. The desktop transport builds no request and opens no socket —
  // the Rust side does, and no test has a Rust side (PRD 011 Req 12).
  'tests/unit/llm-desktop-transport.test.ts':
    'the request descriptor handed to a fake invoke, compared against what the fake recorded — no socket exists in this file',
};
// This guard needs no exemption of its own: it derives its needles from the
// descriptors and spells none of them out.

/** Every `.ts` file under `tests/`, repo-relative and slash-separated. */
function testSources(rel = 'tests'): string[] {
  const abs = path.join(ROOT, rel);
  if (!statSync(abs).isDirectory()) return rel.endsWith('.ts') ? [rel] : [];
  return readdirSync(abs).flatMap((entry) => testSources(`${rel}/${entry}`));
}

describe('PRD 011 Req 35 no test can reach a real provider', () => {
  test('U651: the e2e loopback guard calls every provider host offsite, and the suite’s own servers loopback', () => {
    // The needles are real hosts, not empty strings that would make the
    // assertions below trivially true.
    expect(PROVIDER_HOSTS).toHaveLength(4);
    for (const host of PROVIDER_HOSTS) expect(host.length).toBeGreaterThan(3);

    // …and they are ALL of them: a sixth provider arrives as a sixth endpoint
    // constant, which a hand-kept needle list would never hear about. Asking
    // the module what it exports turns that into a failure here — right where
    // someone is already editing the provider set — instead of a guard that
    // silently stops covering the newest vendor.
    expect(EXPORTED_ENDPOINTS.length).toBeGreaterThanOrEqual(PROVIDER_HOSTS.length);
    for (const endpoint of EXPORTED_ENDPOINTS) {
      expect(PROVIDER_HOSTS, `${endpoint} is exported but not scanned for`).toContain(
        new URL(endpoint).host,
      );
    }

    // Reached by the app, by a fulfilled `page.route`, or by an evaluated
    // script — the classifier only ever sees the URL, and it refuses all four.
    for (const host of PROVIDER_HOSTS) {
      expect(offsiteOrigin(`https://${host}/v1/chat/completions`), host).toBe(`https://${host}`);
    }
    // …and anything else off-machine, which is the property that actually
    // holds: an allowlist of vendor hosts would go stale, this does not.
    expect(offsiteOrigin('http://example.com/x')).toBe('http://example.com');
    expect(offsiteOrigin('wss://example.com/socket')).toBe('wss://example.com');

    // The suite's own origins keep passing untouched: the shim's vite (4923),
    // the hosted server (4924), the web preview (4925), the GitHub lane and
    // Azurite. No existing test changes behaviour.
    for (const url of [
      'http://localhost:4923/#open=/docs/zoom.md',
      'http://localhost:4924/api/llm',
      'http://localhost:4925/',
      'http://127.0.0.1:10000/devstoreaccount1',
      'ws://localhost:4923/@vite/client',
    ]) {
      expect(offsiteOrigin(url), url).toBeNull();
    }
    // Schemes that reach nothing are not requests to judge — the shim serves
    // images as data URIs and saves through blob downloads.
    for (const url of ['data:image/png;base64,AAAA', 'blob:http://localhost:4923/abc', 'about:blank']) {
      expect(offsiteOrigin(url), url).toBeNull();
    }
    // An http(s) URL that will not parse is reported, not trusted.
    expect(offsiteOrigin('https://')).toBe('https://');
  });

  test('U652: no provider host appears in the test sources outside the justified allowlist', () => {
    const sources = testSources();
    // A glob that stopped matching would leave this guard scanning nothing and
    // passing vacuously.
    expect(sources.length).toBeGreaterThan(30);
    expect(sources).toContain('tests/e2e/semantic-zoom.spec.ts');
    expect(sources).toContain('tests/unit/llm-desktop-transport.test.ts');

    const violations: string[] = [];
    for (const rel of sources) {
      if (rel in HOST_ALLOWLIST) continue;
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      for (const host of PROVIDER_HOSTS) {
        if (source.includes(host)) violations.push(`${rel} names the provider host ${host}`);
      }
    }
    expect(violations, 'a test source names an LLM vendor host (PRD 011 Req 35)').toEqual([]);

    // Every allowlist entry is live and carries a real justification: a stale
    // exemption is deleted rather than left standing.
    for (const [rel, why] of Object.entries(HOST_ALLOWLIST)) {
      expect(sources, `${rel} is allowlisted but no longer exists`).toContain(rel);
      expect(why.length, `${rel} carries no justification`).toBeGreaterThan(30);
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(
        PROVIDER_HOSTS.some((host) => source.includes(host)),
        `${rel} is allowlisted but names no provider host — drop the entry`,
      ).toBe(true);
    }
  });

  test('U653: the source scan bites — a provider host in a fixture source is reported', () => {
    // The scan's own failure path, asserted directly rather than trusted. Same
    // needles, same `includes`, against a string that stands in for a test
    // someone might write.
    const offending = `await page.route('https://${PROVIDER_HOSTS[0]}/**', (route) => route.fulfill({ body: 'ok' }));`;
    const found = PROVIDER_HOSTS.filter((host) => offending.includes(host));
    expect(found).toEqual([PROVIDER_HOSTS[0]]);

    // And the runtime half would have caught that same line at its other end.
    expect(offsiteOrigin(`https://${PROVIDER_HOSTS[0]}/v1/x`)).not.toBeNull();

    // A test that names no vendor host is clean by the same reading.
    const innocent = "await page.goto('http://localhost:4923/#open=/docs/zoom.md');";
    expect(PROVIDER_HOSTS.filter((host) => innocent.includes(host))).toEqual([]);
  });
});
