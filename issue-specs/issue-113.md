# Spec: Hosted LLM path: same-origin server proxy with the operator-configured credential (#113)

## Goal

All acceptance criteria in issue-specs/issue-113.md are satisfied for issue
#113, with evidence visible in the session: a hosted deployment reads one
operator-configured LLM credential from the server environment
(`server/config.ts`), the browser reaches a provider only through a
same-origin `/api/llm` route that runs the #111 seam server-side and answers
its `LlmResponse` — adding no new client-side network call site
(`FETCH_ALLOWLIST` stays 4) and never handing the key, or the ability to
change it, to a member; both operator hosting guides document the new
environment knobs with a unit test that fails if they drift;
`npm run validate:quick` was run once at the end and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #113.

## Acceptance criteria

### Req 8 — the credential is the operator's, configured at deploy time

- `server/config.ts` parses an **optional** LLM section from the environment,
  in the style of `loadGitHubConfig`: which provider kind (the five of
  `LlmProviderKind`), which model, the key, and — for the custom
  OpenAI-compatible kind only — the base URL. Names follow the file's existing
  convention (`MM_LLM_*`, e.g. `MM_LLM_PROVIDER`, `MM_LLM_MODEL`,
  `MM_LLM_API_KEY`, `MM_LLM_BASE_URL`); the exact set is the implementer's
  call as long as one deployment configures exactly one active provider.
- The section is **absent unless configured**: a deployment that sets none of
  the variables starts exactly as it does today and reports itself as having
  no LLM configured. No default provider, no default key, no fabricated model.
- A **partial or malformed** configuration is refused at startup by name — the
  same stance `loadGitHubConfig` takes: every missing variable named at once,
  an unknown provider kind named with the value it got, a custom kind without
  an absolute `http(s)` base URL rejected. No refusal message, and no log line
  anywhere in `server/`, ever contains the key value.
- The parsed value is assignable to the seam's `LlmProviderConfig`
  (`src/lib/llmSeam.ts`) — the server declares **no second copy** of the
  provider-config, request or response shapes. `server/` importing `src/lib/*`
  with an explicit `.ts` specifier is the established pattern (see
  `server/workspaceConnection.ts`).
- Members cannot change the credential: no route accepts a key, provider kind,
  model or base URL from a client, and none is introduced by this issue. The
  configuration is read-only to the browser.

### Req 13 — the browser calls the app's own server, and nothing else

- The server gains routes under `/api/llm` (the exact sub-paths are the
  implementer's call), inside the existing bearer-auth guard in
  `server/app.ts`: an unauthenticated request gets the same `401` every other
  `/api/` route gives, before any provider is contacted.
  - A **GET** answers what a member is allowed to know: whether an LLM is
    configured for this deployment, and when it is, the provider kind and
    model in use. It never carries the key, and it makes no outbound request.
  - A **POST** takes the seam's `LlmRequest` (trigger, prompt, optional
    system, max output tokens), runs `runLlmRequest` from `src/lib/llmSeam.ts`
    with the operator's config, and answers the seam's `LlmResponse` as JSON —
    success with text and usage, or one typed failure from the taxonomy.
  - When the deployment has **no LLM configured**, the POST answers a legible,
    typed refusal (a named status plus a reader-facing sentence that the
    operator has not configured a provider) rather than a bare 500 or a
    generic 404, so #116's availability copy has something honest to render.
  - A body that is not the seam's request — malformed JSON, a missing prompt,
    a missing or unrecognized `trigger` — is a `400` and **no** provider call
    is made. `LlmTrigger` is the allowed set; nothing widens it and no default
    silently supplies one (Req 16).
- The outbound provider call is made in `server/` only, through an
  **injectable** transport that defaults to the platform `fetch` — the
  `fetchImpl` precedent in `server/providers/github/auth.ts:197` — so every
  test drives a fake and no test performs real network I/O.
- **No new client-side network call site.** The hosted browser path reaches
  `/api/llm` through the existing single wrapper in `src/platform/hosted.ts`
  (`api(...)`, same-origin and bearer-authenticated). `grep -rn 'fetch\s*(\|XMLHttpRequest\|new WebSocket\|sendBeacon\|new EventSource' src/`
  finds no new occurrence, and `FETCH_ALLOWLIST` in `scripts/validate.mjs`
  stays at `4`. No provider host string (`api.openai.com`,
  `api.anthropic.com`, `generativelanguage.googleapis.com`,
  `openrouter.ai`, or a custom base URL) is reachable from browser code.
- The client-side seam is one optional `Platform` capability declared in
  `src/platform/types.ts` (alongside `workspaces?` / `signOut?` / `updates?`)
  and implemented **only** by the hosted platform, per
  `.sandcastle/CODING_STANDARDS.md` § Architecture: read the deployment's LLM
  availability, and run one `LlmRequest`. It reuses the seam's types; it does
  not redefine them. `src/platform/web.ts` (static web) and
  `src/platform/tauri.ts` leave it undefined — desktop is #112's — and app
  code that later consumes it tests the capability, never the flavor.

### Key confinement and attribution

- A sentinel key string configured on the server appears **nowhere** a browser
  can see it: not in the availability payload, not in a success response, not
  in any failure `message` or `providerMessage`, not in a status line. A unit
  test asserts this across the success path and every failure kind, driving
  the fake from `src/lib/llmFake.ts`.
- Req 16 holds on the hosted path: no request is made on server start, on
  sign-in, on page load, or by the availability GET. A unit test asserts the
  injected transport records **zero** calls for everything except an explicit
  POST carrying a `trigger`.

### Operator documentation

- `docs/HOSTING-AZURE.md` and `docs/HOSTING-GITHUB.md` both document every new
  `MM_LLM_*` variable in their environment-variable tables (name, default,
  required/optional, what it does), and both state plainly that the key is
  **deployment-wide**: one credential, shared by every member of that
  deployment, never shown to members and not changeable by them, and that
  leaving it unset means the deployment simply has no LLM features.
- A unit test enforces this against the code rather than trusting the prose,
  in the style of the existing guard in
  `tests/unit/docs-hosting-github.test.ts` (U478/U479): every `MM_LLM_*`
  variable `server/config.ts` reads is named in **both** guides, and no guide
  names an `MM_*` variable the loader does not read. (U478 already fails if a
  guide invents a variable — extend or mirror it so the Azure guide is covered
  too.)

### Scope

- Nothing user-visible changes: no settings page, no menu item, no command, no
  new UI copy. The settings area that renders provider/model/availability is
  #116's; summaries are #118's; the workspace-scoped summary cache is #115's.
- SPEC11, the README, the architecture doc and the gate's committed counters
  are **not** touched — issue #114 owns amending them. The static web build's
  zero-outbound property is unchanged by construction here.
- Every existing unit and e2e test still passes unmodified — none weakened,
  skipped or renumbered — and `npm run map` leaves `docs/MAP.md` unchanged
  (this issue's citations are `PRD 011 Req <n>`, not `SPEC<n>`); if a
  `SPEC<n>` citation is added after all, the regenerated `docs/MAP.md` is
  committed.
- Every new module, route handler and exported type carries a
  `PRD 011 Req <n>` citation comment naming what it implements, per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`.

### Tests and verification

- New unit tests live in `tests/unit/`, following the existing server-test
  shape: `createApp` on a loopback port with the mock auth provider and an
  in-memory storage seam (`tests/unit/server-workspaces.test.ts`) for the
  route behaviour, and `loadConfig`-style pure parsing tests
  (`tests/unit/server-config.test.ts`) for the environment knobs. Every test
  title is prefixed with the next unused `U<n>` id — the suite is at **U521**
  today, so start at **U522** and never reuse a number — and `describe` blocks
  name the contract (e.g. `describe('PRD 011 Req 13 — the hosted LLM
  proxy')`). Tests must not depend on per-file isolation (`isolate: false`).
- **No test contacts a real provider.** The server's outbound transport is the
  injected fake in every test; provider hosts appear only as inert strings
  compared against a built descriptor.
- No e2e test is required by this issue — the enumerated e2e matrix is #121's.
  If one is added it starts at `E226` (the suite is at E225) in
  `tests/e2e/hosted.spec.ts`, which already runs against `npm run server:local`.
- The implementer iterates with `npm run typecheck` and `npm run test:unit`
  (or a targeted `npx vitest run tests/unit/server-*.test.ts`) — seconds each.
  Any baseline taken at the start uses the quick tier only.
- `npm run validate:quick` is run **once**, right at the end, immediately
  before declaring the goal met — not after every change — and prints
  `QUICK VALIDATION: ALL PASSED`. The full `npm run validate` is not required
  for this issue.
- A summary comment from the implementer exists on issue #113, naming the
  environment knobs added, the `/api/llm` routes and the client capability,
  and the `QUICK VALIDATION: ALL PASSED` evidence.

## Context

The contract is `prd/011-semantic-zoom-and-llm-providers.md` — Reqs 8 and 13
are this issue's, and Reqs 7, 9, 12, 14, 16 explain the constraints it must
not foreclose. The parent is #108; #111 (merged) already landed the seam.

Read `src/lib/llmSeam.ts` first: `LlmProviderConfig`, `LlmRequest`,
`LlmResponse`, `LlmTransport` and `runLlmRequest` are the only shapes this
issue may use, and `redactKey` is why a failure cannot carry the key.
`src/lib/llmProviders.ts` holds the five implementations and
`src/lib/llmFake.ts` the scriptable fake every test drives.

The asymmetry that decides the design: on hosted the browser has no key, so it
cannot build a provider descriptor. `runLlmRequest` therefore runs **on the
server**, which owns the config and the transport; the browser posts the
seam's request and reads back the seam's response. That is also what keeps
Req 13's "no provider host is ever contacted from the browser" true.

Routing lives in `handleApi` in `server/app.ts` (auth guard at
`server/app.ts:94`); `server/http.ts` has `readBody`/`sendJson`.
`server/config.ts` is pure parsing with no I/O, which is why its tests can pin
every branch. The hosted client wrapper is `src/platform/hosted.ts:117` — the
one allowed browser call site, counted by `FETCH_ALLOWLIST = 4` at
`scripts/validate.mjs:321`.
