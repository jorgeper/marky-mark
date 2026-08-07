# Spec: LLM provider seam: one request/response shape, five provider implementations, and a local fake (#111)

## Goal

All acceptance criteria in issue-specs/issue-111.md are satisfied for issue
#111, with evidence visible in the session: one seam module defines a single
LLM request/response shape carrying provider-returned token usage (or its
stated absence) and a bad-key / unknown-model / unreachable-host /
rate-limited failure taxonomy; five provider implementations (OpenAI,
Anthropic, Google Gemini, OpenRouter, custom OpenAI-compatible) sit behind
that one seam with exactly one provider active at a time and no `fetch(` or
other network call site anywhere in `src/`; a local fake implements the same
seam and every new test runs against it with no real provider contacted;
nothing user-visible changes and no caller is wired up;
`npm run validate:quick` was run once at the end and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #111.

## Acceptance criteria

### Req 11 — one seam, one request/response shape

- Pure TypeScript modules under `src/lib/` (flat, following the existing
  convention — e.g. `src/lib/llmSeam.ts`, `src/lib/llmProviders.ts`,
  `src/lib/llmFake.ts`) hold the whole of this issue's work. They import no
  `react`, no `@tauri-apps/*`, and nothing from `src/components/`, and they
  touch no DOM and no filesystem, per `.sandcastle/CODING_STANDARDS.md`.
- There is **exactly one** definition of the LLM request type and **exactly
  one** definition of the LLM response type. Provider implementations do not
  each declare their own public request/response types, and no second copy of
  either shape exists in `src/`, `server/`, or `src-tauri/`. Adding a sixth
  provider is a new implementation behind the seam and no change to the seam's
  types or to callers.
- The seam is transport-agnostic: a provider implementation turns
  (provider config + request) into a plain HTTP request **descriptor**
  (method, absolute URL, headers, body string) and turns a plain HTTP
  **response** (status, body, plus whatever headers it needs) into the seam's
  response or a typed failure. Actually sending it is injected by the caller —
  a `send` function / transport parameter — so that issue #112 (Rust desktop
  transport) and issue #113 (hosted same-origin proxy) can each supply their
  own without touching provider code. The seam exposes one entry point that
  takes the transport, the active provider config and a request, and answers
  the single response/failure type.
- No new network call site is introduced: `grep -rn 'fetch\s*(\|XMLHttpRequest\|new WebSocket\|sendBeacon\|new EventSource' src/` finds nothing new,
  and `FETCH_ALLOWLIST` in `scripts/validate.mjs` is left at its current value
  (re-pinning the gate's counters belongs to issue #114, not here).
- Every new module and exported type carries a `PRD 011 Req <n>` citation
  comment naming the requirement it implements, per
  `.sandcastle/CODING_STANDARDS.md`.

### Req 5 — five providers, exactly one active

- Five provider kinds are implemented behind the seam: **OpenAI**,
  **Anthropic**, **Google Gemini**, **OpenRouter**, and a **custom
  OpenAI-compatible endpoint**. Each builds the request its provider actually
  accepts:
  - OpenAI — chat/completions-shaped body against the OpenAI base URL, key in
    an `Authorization: Bearer` header.
  - Anthropic — messages-shaped body (`model`, `max_tokens`, system + user
    content), key in `x-api-key` alongside the required `anthropic-version`
    header.
  - Google Gemini — `generateContent` for the configured model, key in a
    header (`x-goog-api-key`), **never** in the URL or query string.
  - OpenRouter — the OpenAI-compatible shape against OpenRouter's base URL.
  - Custom OpenAI-compatible — the OpenAI-compatible shape against a
    user-supplied base URL, with a user-supplied key and model id; the base URL
    is normalized (trailing slash, path joining) so both
    `https://host/v1` and `https://host/v1/` produce the same endpoint, and a
    URL that is not absolute `http(s)` is rejected as a configuration failure
    rather than producing a request.
- The provider config type makes "exactly one provider is active at a time"
  structural: it is a single active-provider value (a discriminated union on
  provider kind), not a list, set, or map of enabled providers. The model id is
  a free-text string on every kind, so a new model never requires a code change
  (Req 6's curated lists are issue #116's, not this one's).
- The API key appears only in request headers — never in a URL, never in a
  request body, never in any string the seam returns. A unit test asserts, for
  every provider kind and every failure path, that a distinctive sentinel key
  string does not appear anywhere in the produced URL, in a serialized failure,
  or in any human-readable message the seam yields (Req 7's "never appears in
  logs, error messages, notices").

### Response shape: usage and the failure taxonomy

- The success response carries the generated text plus the
  **provider-returned token usage** — input and output token counts read from
  each provider's own field names (OpenAI/OpenRouter `usage.prompt_tokens` /
  `completion_tokens`, Anthropic `usage.input_tokens` / `output_tokens`,
  Gemini `usageMetadata.promptTokenCount` / `candidatesTokenCount`). When the
  provider returns no usage, the response says so explicitly (a distinguishable
  absent value, not `0` and not a guess), so Req 32's reporting can later say
  "no usage data" rather than inventing a number. Unit tests cover both the
  present and the absent case for each provider.
- Failures are a single typed taxonomy on the seam's response, with at minimum
  the four kinds Reqs 10/27 later render — **bad key**, **unknown model**,
  **unreachable host**, **rate limited** — plus a distinct catch-all for
  anything else (an unexpected status, or a 200 whose body does not parse into
  the expected shape). Each failure carries a short reader-facing message and
  enough detail (status code, provider-supplied message when safe) for #116/#118
  to render it; no failure is a bare thrown string and none leaks the key.
- Classification is per provider and unit-tested from real-shaped payloads:
  401/403 → bad key; 404 (and each provider's model-not-found body) → unknown
  model; 429 (honouring a `retry-after`-style hint where the provider sends
  one) → rate limited; a transport-level failure (DNS/connection/timeout, i.e.
  the injected `send` rejecting or reporting no HTTP response) → unreachable
  host. A malformed-but-200 body is the catch-all, never a silent empty
  summary.

### Req 16 — every request attributable to a user action

- The seam performs no work on import: importing any new module registers no
  timer, no listener, no startup hook, and issues no request. No new module has
  side-effecting top-level code, and a unit test asserts that importing the
  seam with a fake transport installed results in zero calls to that transport.
- The request type requires the caller to name the user action that caused it
  (e.g. a `trigger` / `cause` field with a small set of allowed values such as
  `'test-connection'` and `'summarize'`), so an unattributable request cannot
  be constructed. No default value silently supplies one.

### Req 35 — the local fake

- A local fake implements the same seam and is what all tests exercise. It is
  scriptable: canned successes (text + usage present, and usage absent), each
  failure kind, and a way for a test to assert what was requested (how many
  calls, with which model, prompt, and provider kind).
- The fake makes no network call, needs no key material beyond a dummy string,
  and is deterministic — no clock or randomness that would make a test flaky.
  It is placed so that later siblings (#116 test connection, #118 summaries,
  #121 the e2e matrix) can drive it from both unit tests and the e2e shim
  without moving it.
- **No test contacts a real provider.** No new test performs real network I/O,
  and no provider host string is reachable from a test path except as inert
  data compared against a built descriptor.

### Scope: internal only

- Nothing user-visible changes. No settings UI, no menu item, no command, no
  `Platform` capability, and no caller is wired up: `src/App.tsx`,
  `src/components/`, `src/platform/`, `src-tauri/` and `server/` need no
  behavioural change for this issue. (If a type-only export needs to be
  reachable from `server/` later, that is an import in a later issue, not a
  runtime change here.)
- Every existing unit and e2e test still passes unmodified — no existing test
  is weakened, skipped, or renumbered.
- `npm run map` leaves `docs/MAP.md` unchanged (or the regenerated file is
  committed if a `SPEC<n>` citation was in fact added), so the validation
  gate's MAP diff check passes.

### Tests and verification

- New unit tests live in `tests/unit/`, one file per module with the matching
  kebab-case name (`src/lib/llmProviders.ts` → `tests/unit/llm-providers.test.ts`),
  every test title prefixed with the next unused `U<n>` id (the suite is at
  U479 today, so start at U480 and never reuse a number), and `describe` blocks
  naming the contract (e.g. `describe('PRD 011 Req 5 — provider request
  descriptors')`). Tests must not depend on per-file isolation (`isolate: false`).
- The implementer iterates with `npm run typecheck` and `npm run test:unit`
  (or `npx vitest run tests/unit/llm-*.test.ts` targeted at the changed code)
  — these are seconds each. Baseline, if any is taken, uses the quick tier only.
- `npm run validate:quick` is run **once**, right at the end, immediately
  before declaring the goal met — not after every change — and prints
  `QUICK VALIDATION: ALL PASSED`. The full `npm run validate` is not required
  for this issue.
- A summary comment from the implementer exists on issue #111, naming the
  modules added, the seam's request/response shape, and the
  `QUICK VALIDATION: ALL PASSED` evidence.

## Context

Green field: `grep -ril 'openrouter\|anthropic\|gemini\|llm' src/ server/` finds
nothing today. The parent is #108 and the contract is
`prd/011-semantic-zoom-and-llm-providers.md` — read Reqs 5, 11, 16, 32 and 35
there; Reqs 7, 10, 12, 13, 27 explain the constraints this issue must not
foreclose.

The transport split is why the adapters must stay pure request-builders:
PRD 011 Req 12 puts desktop calls in the Rust shell (issue #112) without
widening the webview CSP, and Req 13 puts hosted calls behind the app's own
same-origin server (issue #113). `server/` already imports `src/lib/*`
directly (see `server/workspaceConnection.ts:21`), so a TypeScript seam serves
the hosted path as-is; the desktop path gets the descriptor handed to a Rust
executor. Either way `.sandcastle/CODING_STANDARDS.md` § Architecture is
absolute: shipped code contains no `fetch(`, `XMLHttpRequest`, `WebSocket`,
`sendBeacon` or `EventSource` call site, and `scripts/validate.mjs:321`
(`FETCH_ALLOWLIST = 4`) fails the full gate on a new one. Issue #114 owns
amending SPEC11 and re-pinning those counters — do not touch them here.

For house style on a pure lib module with PRD citations and its unit test, read
`src/lib/workspaceConnection.ts` and `tests/unit/workspace-connection.test.ts`;
`src/lib/githubConnectWizard.ts` is the closest analogue for "the pure half of
something whose I/O lives elsewhere". `src/platform/types.ts` documents the
Platform seam this issue deliberately does **not** extend.
