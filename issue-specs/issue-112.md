# Spec: Desktop LLM transport: provider requests from the Rust shell, webview CSP unchanged (#112)

## Goal

All acceptance criteria in issue-specs/issue-112.md are satisfied for issue
#112, with evidence visible in the session: a `#[tauri::command]` in
`src-tauri/src/lib.rs` performs the LLM HTTP exchange and is the only place any
provider is contacted, reached over IPC by a desktop `LlmTransport` that plugs
into the existing seam (`src/lib/llmSeam.ts`) as an optional `Platform`
capability implemented only in `src/platform/tauri.ts`; the webview CSP in
`src-tauri/tauri.conf.json` is byte-identical — `connect-src` still allows only
`ipc: http://ipc.localhost` — and `src/` gains no `fetch(`/`XMLHttpRequest`/
`WebSocket`/`sendBeacon`/`EventSource` call site, leaving `FETCH_ALLOWLIST` at
4; nothing user-visible changes and no caller is wired up; `cargo check` in
`src-tauri/` and `npm run validate:quick` were each run once at the end, the
latter printing `QUICK VALIDATION: ALL PASSED`; and a summary comment from the
implementer exists on issue #112.

## Acceptance criteria

### Req 12 — the request leaves from the Rust shell

- `src-tauri/src/lib.rs` defines one `#[tauri::command]` (snake_case, matching
  the file's `take_pending_open_files` / `print_view` / `trash_entry`
  convention — e.g. `llm_request`) that takes a plain HTTP request descriptor
  (method, absolute URL, headers map, body string) and answers either the HTTP
  exchange that happened (status, body, response headers) or a transport-level
  failure. It is registered in the existing `tauri::generate_handler![…]` list.
- The command is the **only** place a provider host is contacted. The webview
  never opens an outbound connection: after this issue, the desktop path is
  webview → IPC → Rust → provider, exactly as the updater plugin already
  reaches its endpoint from the host side.
- A non-2xx status is **not** an error at the IPC boundary: the command returns
  the status and body so `readResponse` in `src/lib/llmProviders.ts` can
  classify it (401/403 → bad key, 404 → unknown model, 429 → rate limited).
  Only a failure where no HTTP exchange happened (DNS, connection refused,
  TLS, timeout) comes back as the command's error arm, which the TypeScript
  side turns into `{ kind: 'no-response', detail }` — i.e. `unreachable-host`.
- Response header names handed back are **lower-cased**, and `retry-after` is
  among them when the provider sent it, so `llmProviders.ts:390`'s
  `headers?.['retry-after']` lookup keeps working and Req 10's rate-limit hint
  survives the round trip.
- The HTTP client is `reqwest`, which is already in `src-tauri/Cargo.lock`
  (0.13.4, pulled in by `tauri-plugin-updater`) with rustls — no new TLS
  backend and no second HTTP stack. `git diff src-tauri/Cargo.lock` adds no new
  `[[package]]` entry: the only change is the `marky-mark` package gaining a
  `reqwest` dependency edge. If `npm run licenses` regenerates a different
  `THIRD-PARTY-NOTICES.md` (it reads `cargo metadata` as well as
  `package-lock.json`), the regenerated file is committed, per
  `.sandcastle/CODING_STANDARDS.md` § Architecture.

### The command is a provider transport, not a general web proxy

- The command validates its input before sending, and a rejected input is a
  failure value rather than a request: the method is `POST`, and the URL is an
  absolute `http(s)` URL (`file:`, `data:`, and scheme-less inputs are
  rejected). `http` stays allowed because Req 5's custom OpenAI-compatible
  endpoint may be a locally-run server.
- Redirects are **not** followed (`reqwest::redirect::Policy::none()` or
  equivalent). A 3xx comes back as a status the seam classifies as
  `unexpected`. Rationale worth a comment in the code: the API key travels in
  `x-api-key` / `x-goog-api-key` as well as `Authorization`, and a followed
  cross-host redirect would carry the non-`Authorization` ones to a host the
  user never configured.
- The request carries a finite timeout, so a hung provider becomes
  `unreachable-host` rather than a permanently pending IPC call.
- PRD 011 Req 7: the command never logs, prints, or panics with request
  headers or the request body — no `println!`/`eprintln!`/`dbg!` of either —
  and the error string it returns is the transport error's own description
  (which names at most the URL, never a header). The key is never written to
  disk or to any Rust-side state.
- The command answers only the main window: it takes the calling
  `tauri::WebviewWindow` (as `print_view` does) and refuses a call whose label
  is not `main`. The settings/about windows are the `aux` capability's dumb
  views (`src-tauri/capabilities/auxiliary.json`), and PRD 011 Req 10 already
  says test-connection round-trips through the main window.
- `src-tauri/capabilities/default.json` and `auxiliary.json` gain **no** new
  permission (app-defined commands are not capability-gated; the window check
  above is what scopes this one), and no new Tauri plugin is added.

### The CSP and the no-network-call-site rule are untouched

- The `csp` string in `src-tauri/tauri.conf.json:27` is byte-identical to its
  current value — `connect-src ipc: http://ipc.localhost`, no provider origin,
  no `https:` source beyond `asset.localhost`. A unit test pins this: it reads
  `src-tauri/tauri.conf.json` and asserts `connect-src` names only `ipc:` and
  `http://ipc.localhost`, so a later attempt to widen it fails a test rather
  than passing quietly.
- `grep -rn 'fetch\s*(\|XMLHttpRequest\|new WebSocket\|sendBeacon\|new EventSource' src/`
  finds nothing new, and `FETCH_ALLOWLIST` in `scripts/validate.mjs:321` stays
  at `4`. Amending SPEC11 and re-pinning the gate's counters is issue #114's
  work and is not done here.
- `docs/specs/SPEC11.md`, `docs/ARCHITECTURE.md` and `README.md` are left
  alone for the same reason (#114 owns the amendment). No `SPEC<n>` token is
  added to `src/` or `tests/e2e/`, so `npm run map` leaves `docs/MAP.md`
  unchanged; if one is added anyway, the regenerated `docs/MAP.md` is
  committed so the gate's MAP diff check passes.

### The TypeScript side: one pure mapping, one platform capability

- A pure module under `src/lib/` (flat, e.g. `src/lib/llmDesktopTransport.ts`)
  builds an `LlmTransport` from an injected `invoke`-shaped function: it
  converts an `LlmHttpRequest` into the command's argument shape, converts the
  command's answer into `LlmTransportResult`, and turns a rejected invoke into
  `{ kind: 'no-response' }`. Per `.sandcastle/CODING_STANDARDS.md` it imports
  no `react`, no `@tauri-apps/*` and nothing from `src/components/`, so it is
  unit-testable with a fake invoke and no Tauri runtime.
- `src/platform/types.ts` gains **one optional** capability (e.g.
  `sendLlmHttpRequest?(request: LlmHttpRequest): Promise<LlmTransportResult>`
  or an `llmTransport?: LlmTransport`), documented with a `PRD 011 Req 12`
  citation stating what its absence means: no LLM path on that host.
- Only `src/platform/tauri.ts` implements it — it is the sole file in `src/`
  allowed to import `@tauri-apps/*`, and it wires the real `invoke` into the
  pure module above. `web.ts` does not implement it (PRD 011 Req 14: the
  static web build has no LLM path at all), `hosted.ts` does not (issue #113
  supplies the same-origin one), and `browser.ts` does not either — the e2e
  shim gets its fake-backed wiring in #116/#121, when there is UI to drive.
- Every new module, exported type and Rust item carries a `PRD 011 Req <n>`
  citation comment naming the requirement it implements.

### Scope: internal only, nothing user-visible

- No caller is wired up and nothing renders: no settings UI, no menu item, no
  command in `src/lib/commands.ts`, no change to `src/App.tsx` or
  `src/components/`. A user running this build sees and can do exactly what
  they could before, and no request is made — PRD 011 Req 16 holds trivially
  because there is still no trigger.
- Every existing unit and e2e test still passes unmodified; none is weakened,
  skipped, or renumbered. The e2e test-count floor (226) is unaffected.

### Tests and verification

- New unit tests live in `tests/unit/`, one file per module with the matching
  kebab-case name (`src/lib/llmDesktopTransport.ts` →
  `tests/unit/llm-desktop-transport.test.ts`), every title prefixed with the
  next unused `U<n>` id — the suite is at **U521** today, so start at **U522**
  and never reuse a number — and `describe` blocks naming the contract (e.g.
  `describe('PRD 011 Req 12 — the desktop transport')`). Tests must not depend
  on per-file isolation (`isolate: false`).
- The unit tests cover, against a fake invoke: a 200 mapping to
  `{ kind: 'http', … }` with the body and lower-cased headers intact; a 429
  with `retry-after` surviving far enough that `runLlmRequest` (real seam, real
  provider adapters) yields a `rate-limited` failure carrying
  `retryAfterSeconds`; a 401 yielding `bad-key`; a rejected invoke yielding
  `unreachable-host`; and that a sentinel API key never appears in any string
  the transport returns. No test performs real network I/O and no test
  contacts a provider host.
- Rust-side validation (scheme/method rejection, and the main-window check if
  it is expressed as a testable predicate) is covered by a `#[cfg(test)]`
  module in `src-tauri/src/lib.rs`, run once with `cargo test` from
  `src-tauri/`. Rust tests that would need a live HTTP server are out of scope
  — the pure validation is what gets tested.
- The implementer iterates with `npm run typecheck` and `npm run test:unit`
  (or `npx vitest run tests/unit/llm-*.test.ts` targeted at the changed code)
  — seconds each. Any baseline taken uses that quick pair only.
- `cargo check` is run **once** from `src-tauri/` and exits 0. It is a full-gate
  step (`scripts/validate.mjs:255`) that `validate:quick` does **not** run, so
  Rust changes are otherwise unverified. `src-tauri/target/` is cold in this
  sandbox, so budget several minutes for the first build; the crate registry is
  already populated (`cargo fetch --locked` succeeded).
- `npm run validate:quick` is run **once**, right at the end, immediately
  before declaring the goal met — not after every change — and prints
  `QUICK VALIDATION: ALL PASSED`. The full `npm run validate` is not required.
- A summary comment from the implementer exists on issue #112, naming the Rust
  command and the modules added, stating that the CSP string is unchanged, and
  carrying the `cargo check` and `QUICK VALIDATION: ALL PASSED` evidence.

## Context

Issue #111 landed the seam this issue plugs into: read `src/lib/llmSeam.ts`
first — `LlmHttpRequest`, `LlmHttpResponse`, `LlmTransportResult` and
`LlmTransport` are already defined there and are exactly the shapes that cross
the IPC boundary, so this issue adds a transport implementation and defines no
new request/response type (U490 asserts only `lib/llmSeam.ts` declares them).
`src/lib/llmProviders.ts` shows what the classifier expects from a response
(notably the `retry-after` read at line 390); `src/lib/llmFake.ts` is the
existing fake, and `tests/unit/llm-seam.test.ts` is the house style for driving
the real seam through a substituted transport.

The contract is `prd/011-semantic-zoom-and-llm-providers.md` Req 12 (with Reqs
7, 10, 14 and 16 as the constraints it must not break); the parent is #108 and
the sibling that owns the SPEC11 amendment and the gate's counters is #114.

On the Rust side, `src-tauri/src/lib.rs` is 86 lines — read it whole.
`print_view` is the precedent for a command that takes the calling
`tauri::WebviewWindow`; `trash_entry` is the precedent for a command whose only
dependency is one crate and whose errors are `Result<_, String>`. The CSP lives
at `src-tauri/tauri.conf.json:27`, the main window has no explicit label (so it
is `main`) and the aux windows are `settings` / `about`
(`src/platform/tauri.ts:54`).

`src/platform/types.ts` documents the optional-capability convention this issue
follows (`writeBinaryFile?`, `readClipboardText?`, `setAppMenu?` — each says
what an absent implementation means). `src/platform/tauri.ts:41` shows the
`await import('@tauri-apps/api/core')` pattern for reaching `invoke`.
