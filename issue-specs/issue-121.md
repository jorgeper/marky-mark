# Spec: Close the PRD 011 verification matrix: fake-provider-only tests and the enumerated e2e coverage (#121)

## Goal

All acceptance criteria in issue-specs/issue-121.md are satisfied for issue
#121, with evidence visible in the session: every item PRD 011 Req 35
enumerates is covered by a named test — the Experimental toggle's
presence/absence effect, all five levels on excerpts with no provider, a
faked-provider run including a per-section failure and its retry,
click-to-dive and back-to-full, the cache preventing a second call for
unchanged content, and the settings area's availability state on each of the
three flavors — with the hosted and static-web gaps filled by new E-/W-numbered
tests; the no-real-provider rule is pinned mechanically, so a test that reached
an LLM vendor's host fails loudly rather than quietly succeeding; the item→test
matrix from the audit appears in the implementer's summary comment on issue
#121; `E2E_TEST_FLOOR` in `scripts/validate.mjs` is re-pinned to the freshly
collected count with a justification comment (it reads 226 against 245
collected today, and its comment claims the LLM work added no desktop-shim
e2e test); `npm run validate:quick` was run once at the end and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #121.

## Acceptance criteria

### The audit — the matrix is written down, not assumed

- The six items PRD 011 Req 35 enumerates are each mapped to the test IDs that
  cover them, and that mapping appears in the implementer's summary comment on
  issue #121 (one line per item: item → test IDs → covered before this issue /
  added by this issue). No item is left as "probably covered".
- An item counts as covered only by a test whose assertions actually exercise
  it end to end in the flavor the requirement names — not by a unit test of the
  same pure function, and not by a test that merely touches the affordance in
  passing.
- Where an enumerated item turns out to be already covered, nothing is
  duplicated: the audit records the existing test ID and moves on. Adding a
  second test for behaviour E229–E244 / E226–E228 already pin is not the work
  here.

### The no-real-provider rule is pinned mechanically

- A committed guard fails the suite if a test can reach an LLM vendor's host.
  At minimum both halves exist:
  - **Runtime.** The shared Playwright fixture (`tests/e2e/fixtures.ts`, the
    `auto` fixture pattern already used by `consoleGuard`) fails any test whose
    page issues a request to a non-loopback origin, and it applies to the
    desktop-shim config and the web config alike (both load `fixtures.ts`).
    Existing localhost traffic — the shim server on 4923, the hosted server on
    4924, the GitHub lane's ports, Azurite — keeps passing untouched, so no
    existing test changes behaviour.
  - **Source.** A unit guard (next unused `U<n>`, ≥ U651, e.g.
    `tests/unit/llm-test-isolation.test.ts`) scans the test sources and fails
    if a provider host string appears outside an explicit allowlist whose every
    entry carries a one-line justification in the same style as
    `FETCH_ALLOWLIST` / `E2E_TEST_FLOOR` in `scripts/validate.mjs`. The hosts
    come from `src/lib/llmProviders.ts` (the descriptors), not from a
    hand-copied list that can drift; today's legitimate occurrence is
    `tests/unit/llm-desktop-transport.test.ts`, where the host is inert data
    compared against a built descriptor.
- Both halves are proved to bite, not just to pass: the guard's own failure
  path is demonstrated (a temporary violation makes it fail, and the working
  tree is left clean afterwards) or asserted directly by the guard's unit test
  against a fixture string.
- Every LLM-driving test still runs against `src/lib/llmFake.ts` — the desktop
  shim's transport (`src/platform/browser.ts`, `window.__mmFakeLlm`), the
  seam's injected transport in unit tests, and the server's injected transport
  in `tests/unit/server-llm.test.ts`. No test gains a real key, a real host, or
  a network-conditional skip.

### Flavor coverage — the gap this issue fills

- **Hosted.** A new `E<n>` test (next unused, ≥ E245) in
  `tests/e2e/hosted.spec.ts` shows the LLM providers settings area in the
  hosted flavor: the `operator-unconfigured` state renders
  `NO_LLM_CONFIGURED_MESSAGE` (`src/lib/llmDeployment.ts`), and a member is
  offered **no** key field, no key removal and no control that cannot work
  (PRD 011 Reqs 8+9). If the configured state is exercised too, the
  deployment's provider is a **loopback fake** — the injected transport of
  `createLlmApi` (`server/llm.ts`) or an `MM_LLM_PROVIDER=custom` /
  `MM_LLM_BASE_URL` pointing at a local stub — never a vendor host, and wiring
  it does not change the behaviour any existing E159+ hosted test observes.
- **Static web.** A new `W<n>` test (next unused, ≥ W14) in
  `tests/e2e/web.spec.ts` shows the same area on the single-file build: the
  `no-path` state renders `NO_LLM_PLATFORM_MESSAGE` (`src/lib/llmSettings.ts`)
  and the page offers no key field, no Test connection and no cache control.
  The test keeps the web suite's zero-outbound property (W4/W5) intact.
- **Static web, Req 22.** The web build's only semantic-zoom behaviour is
  covered: with the Experimental feature on, the five levels work on
  deterministic excerpts and the view says they are excerpts — no summary
  claim, no provider affordance that cannot work.
- **Desktop.** The desktop states stay covered by E226/E227/E228 as they are;
  if the audit finds a desktop item from the enumeration genuinely uncovered
  (for example the cache preventing a second call across a document *reopen*,
  as distinct from re-entering the same level in one session, which E235
  already pins), a test is added for exactly that gap.
- New tests follow the house rules in `.sandcastle/CODING_STANDARDS.md`: stable
  `U<n>:` / `E<n>:` / `W<n>:` prefix, next unused number, `getByTestId`
  selectors, setup through `fixtures.ts` / `helpers.ts`, and a citation comment
  naming the contract (`PRD 011 Req 35`, plus the requirement the test
  exercises).
- No existing test is weakened, renamed, deleted, or marked
  `.skip` / `.only` / `.fixme`, and no existing `data-testid` is renamed. Any
  new interactive UI (there should be little to none — this is a test issue)
  ships a `data-testid`.

### Counters and docs stay honest

- `E2E_TEST_FLOOR` in `scripts/validate.mjs` equals the count
  `npx playwright test --list` collects after this issue's tests land, and its
  comment block explains the move in the file's existing voice: the standing
  226 predates E226–E244, and the "the LLM work added no desktop-shim e2e
  test" note is stale.
- Any other committed counter this work touches (`FETCH_ALLOWLIST`, the web
  bundle scan) is either unchanged or re-pinned with the same kind of written
  justification. A counter is never adjusted silently to make a run go green.
- `docs/MAP.md` is regenerated with `npm run map` if the generator's output
  changes (the gate's pre-step diffs it in the quick tier too); it is never
  hand-edited.

### Verification (test economy)

- Iteration ran on `npm run typecheck` and `npm run test:unit`, plus single
  Playwright tests targeted at the changed code
  (`npx playwright test -g '<title>'`, and
  `npx playwright test --config playwright.web.config.ts -g '<title>'` for the
  web suite) — not the full e2e suite after each change.
- `npm run validate:quick` was run **once**, at the end, right before declaring
  the goal met, and printed `QUICK VALIDATION: ALL PASSED`. It was not run as a
  baseline at the start beyond the quick tier itself, and `npm run validate`
  (the full gate) is not required here.
- A summary comment from the implementer exists on issue #121, carrying the
  Req 35 item→test matrix, what was added versus already covered, how the
  no-real-provider rule is now pinned, the old and new `E2E_TEST_FLOOR`, and
  the `QUICK VALIDATION: ALL PASSED` evidence.

## Context

The behaviour under audit already ships: `tests/e2e/semantic-zoom.spec.ts`
(E229–E244) covers the Experimental toggle, the five excerpt levels,
click-to-dive and back-to-full, the faked-provider run with a per-section
failure and retry, cache reporting/clearing and cost transparency;
`tests/e2e/settings-and-themes.spec.ts` (E226–E228) covers the desktop LLM
providers page and Test connection. Unit coverage is broad
(`tests/unit/llm-*.test.ts`, `summary-*.test.ts`, `zoom-*.test.ts`,
`server-llm.test.ts`). The gaps this issue is most likely to find are the
**hosted** and **static-web** availability states in e2e (neither
`tests/e2e/hosted.spec.ts` nor `tests/e2e/web.spec.ts` mentions the LLM area
today) and the absence of any mechanical guard for "no test contacts a real
provider" — the rule lives only in comments right now.

Key files: `src/lib/llmFake.ts` (the local fake and its scripting surface),
`src/platform/browser.ts` (~line 520: the shim wires the fake and exposes
`window.__mmFakeLlm`), `src/lib/llmSettings.ts` (`llmAreaState` and the five
states with their sentences), `src/lib/llmDeployment.ts` (hosted availability),
`server/llm.ts` + `server/config.ts` (`MM_LLM_*`, injected transport),
`server/local.ts` (the hosted e2e server booted by `playwright.config.ts`),
`tests/e2e/fixtures.ts` (the shared `auto` fixture both configs load), and
`scripts/validate.mjs` (~line 200: the floor and its justification block,
~line 320: the bundle scan).

Grep `PRD 011 Req 35` for the existing no-real-provider citations before
adding a new one. PRD 011 §Requirements Req 35 is the contract; Reqs 9, 22 and
28 name the flavor sentences, the excerpt-only web behaviour and the cache
invariant the enumerated items refer to.
