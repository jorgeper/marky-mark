# Spec: LLM providers settings area: provider and model selection, desktop key storage, availability, test connection (#116)

## Goal

All acceptance criteria in issue-specs/issue-116.md are satisfied for issue
#116, with evidence visible in the session: Settings has its own User-scope
**LLM providers** tab where one of the seam's five provider kinds and a model
are chosen (a curated per-provider list plus free text for any model id); on
desktop the API key is a `U!` user-layer setting that no workspace layer can
supply, masked in the UI and absent from every message, notice, log and draft;
the area states its availability and the reason it is unavailable (no key
configured on desktop, operator has not configured one on hosted, unavailable
on static web), branching on Platform capabilities rather than on flavor and
offering no control that cannot work; a user-invoked **Test connection** makes
exactly one `trigger: 'test-connection'` seam request — on desktop routed
through the main window over the aux bus, never from the settings window —
and reports success or the specific failure kind; every new test runs
against `src/lib/llmFake.ts` with no real provider contacted;
`npm run validate:quick` was run once at the end and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #116.

## Acceptance criteria

### Req 4 — an LLM providers area of its own

- `src/components/SettingsPanel.tsx`'s `SettingsTab` union gains one new tab
  (e.g. `llm`, labelled "LLM providers") in the existing `TABS` rail — a page
  of its own, not a row appended to General, Editor or Appearance. It renders
  from **both** mount points unchanged in structure: the inline panel in
  `src/App.tsx` (hosted, dev shim, static web) and the aux settings window in
  `src/AuxWindow.tsx` (desktop).
- The tab is **User-scope only**, following the Hotkeys precedent already in
  the file: it is not offered on the Workspace scope tab, and landing on it
  while the Workspace scope is selected bounces back to General.
- It is written for LLM configuration in general, not for semantic zoom: no
  copy in it presents summarization as the only consumer, it renders no
  zoom-level control, and nothing it imports comes from `src/lib/zoomLevels.ts`,
  `src/lib/sectionModel.ts`, `src/lib/sectionExcerpt.ts` or
  `src/lib/summaryCache*.ts`.
- The tab is unconditional — it does not gate on any experimental flag (the
  Experimental section is issue #117's, and does not exist yet).
- Every new interactive control ships a `data-testid`, per
  `.sandcastle/CODING_STANDARDS.md`; no existing test id is renamed. The
  `openSettings(page, tab)` helper in `tests/e2e/helpers.ts` has its tab union
  **widened** to include the new tab rather than being replaced or duplicated.
- Every new module, exported type and settings key carries a `PRD 011 Req <n>`
  citation comment naming the requirement it implements.

### Reqs 5 + 6 — one active provider, a curated model list plus free text

- The provider chooser offers exactly the five kinds of `LlmProviderKind`
  (`src/lib/llmSeam.ts`) and no sixth. The labels/curated data are held in a
  `Record<LlmProviderKind, …>` (or an equivalent exhaustive-by-construction
  shape), so adding a kind to the seam fails the typecheck until it is named
  here and naming one the seam does not have fails too. There is no second
  hand-written list of provider kinds anywhere in `src/`.
- **Exactly one provider is active at a time**: what the settings persist
  resolves, through one pure function, to a single `LlmProviderConfig` — the
  seam's discriminated union — and never to a set, list or map of live
  providers. Remembering per-provider models or keys across switches is the
  implementer's call, but the resolution must still yield one active config.
- For each provider a **short curated list** of known-good model ids for
  summarization is offered (a handful per provider, not an exhaustive
  catalogue), **plus** a free-text field: any model id the provider accepts can
  be typed, is persisted, and survives a save/reload round trip unchanged. No
  validation rejects a model id merely for being absent from the curated list —
  a new model must never require an app release.
- An empty or whitespace-only model is not a valid configuration: it makes the
  area report itself unavailable (Req 9) rather than sending a request that
  cannot work.
- The **custom** kind additionally takes a base URL. An unusable base URL is
  reported using the seam's existing `customEndpoint` /
  `INVALID_BASE_URL_MESSAGE` (`src/lib/llmProviders.ts`), not a second
  hand-written URL validator or a second sentence.
- The curated model ids are real, currently-offered ids for each provider (for
  the Anthropic entries, take the ids from the `claude-api` skill rather than
  from memory).

### Req 7 — the desktop key is a user-layer setting, masked and never leaked

- The new persisted keys are added to `Settings` in `src/lib/settings.ts`
  (e.g. `llmProvider`, `llmModel`, `llmApiKey`, `llmBaseUrl` — the exact set is
  the implementer's call) with entries in `DEFAULT_SETTINGS`, `SETTINGS_SCOPES`
  and `VALIDATORS`; the defaults leave the app **unconfigured** (empty key, no
  fabricated model).
- `llmApiKey` is scoped **`U!`** — user-only identity, honored at the User
  layer and ignored at Global/Team/Workspace. A unit test proves that a
  workspace-layer (and global-layer) value for the key never wins resolution.
- None of the new keys are workspace-editable: they appear in neither
  `WORKSPACE_ELIGIBLE_KEYS` nor `WORKSPACE_PINNABLE_KEYS`, and a unit test
  proves `sanitizeSettingsEdit` (`src/lib/auxProtocol.ts`) drops a
  workspace-scoped patch carrying `llmApiKey`. The key therefore cannot be
  written into a `.marky-workspace` file, committed, or shared by opening a
  workspace.
- The key field is **masked** in the UI (a password-style input; whether a
  deliberate reveal affordance exists is the implementer's call). The effective
  key value is never rendered anywhere else — not in another row, a `title`
  attribute, a tooltip, the panel's `hint` text, an override indicator, or a
  scope note.
- The key never reaches a log, notice, error message or crash draft: `src/`
  gains no `console.*` call site, no string handed to `showNotice` or a dialog
  is built from the key value, and every provider failure the area renders is
  the seam's `LlmFailure` — already redacted through `redactKey` in
  `src/lib/llmSeam.ts` — rather than raw response text.
- On hosted there is **no key field at all** (Req 8): the credential is the
  operator's, and the panel offers no control that would write one.

### Req 9 — availability, and its reason, in the reader's words

- A pure module under `src/lib/` (flat, e.g. `src/lib/llmSettings.ts`; no
  `react`, no `@tauri-apps/*`, no `src/components/` import, no DOM, no I/O)
  computes availability from plain inputs — whether a desktop transport exists,
  whether a hosted client exists and what its `LlmAvailability` says, and the
  user's configured provider/model/key — and answers a discriminated union
  carrying a reader-facing sentence for each state:
  - **no LLM path at all** (neither capability, i.e. the static web build):
    LLM features are unavailable on this platform.
  - **desktop, nothing configured**: no key configured (and likewise for a
    missing model / an unusable custom base URL), phrased so the reader knows
    what to do next.
  - **hosted, `configured: false`**: reuses `NO_LLM_CONFIGURED_MESSAGE` from
    `src/lib/llmDeployment.ts` — the operator has not configured one — rather
    than declaring a second sentence.
  - **hosted, `configured: true`**: the provider kind and model in use, shown
    read-only.
  - **available**: says so.
- "It never offers a control that cannot work" is concrete: with no LLM path
  the area renders the sentence and **no** provider/model/key/test controls;
  on hosted the key field is absent and provider/model are read-only; the test
  connection action is absent or disabled-with-its-reason whenever availability
  is not the available state.
- The branch is on **Platform capabilities** (`platform.llm`,
  `platform.llmTransport` in `src/platform/types.ts`), never on
  `platform.kind`, per `.sandcastle/CODING_STANDARDS.md` § Architecture.
- Unit tests cover every availability state, driven purely as data.

### Req 10 — test connection, and where it runs from

- A user-invoked **Test connection** action issues **exactly one** request
  through the existing seam — `runLlmRequest` (`src/lib/llmSeam.ts`) with the
  active `LlmProviderConfig` on desktop, `platform.llm.run(...)` on hosted —
  with `trigger: 'test-connection'`, a minimal prompt and a small
  `maxOutputTokens` so it is cheap. No second request-building path is
  introduced.
- Req 16 holds: no request is made on import, on mount, on a settings change,
  on window open or at startup. A unit test proves the transport/client is not
  called until the action fires, and that one action produces exactly one call.
- The result reports success, or the **specific** failure from the seam's
  taxonomy — bad key, unknown model, unreachable host, rate limited, plus
  `invalid-config` / `unexpected` — rendering `LlmFailure.message` (and
  `retryAfterSeconds` when the provider sent one) rather than a new sentence
  per call site.
- **Desktop round trip**: the aux settings window holds no capability of its
  own. The action travels to the main window over the existing bus protocol in
  `src/lib/auxProtocol.ts` (a new `AuxRequest` variant and a main→aux result
  event, or an equivalent pair), the main window runs the request, and the
  result comes back for the aux window to render. `src/AuxWindow.tsx` and the
  settings panel never call `runLlmRequest`, never read `platform.llmTransport`
  and never invoke an IPC command.
- The new protocol values are validated like their neighbours: a unit test in
  `tests/unit/aux-protocol.test.ts` proves a request and a result round-trip,
  and that a malformed payload is refused rather than trusted (the
  `sanitizeSettingsEdit` precedent).
- No payload crossing the bus carries key material: the result is the seam's
  `LlmResponse` or a narrowed form of it, already redacted.
- Where the panel is mounted inline and the platform capability is right there
  (hosted, dev shim), running it directly is fine — the aux round trip is the
  desktop path, not a new indirection for everyone.

### Tests, and no real provider

- New pure modules under `src/lib/` are unit-tested one file per module with
  the matching kebab-case name (`llmSettings.ts` →
  `tests/unit/llm-settings.test.ts`); existing files (`settings.test.ts`,
  `settings-scope.test.ts`, `settings-resolver.test.ts`,
  `aux-protocol.test.ts`) take the criteria that belong to them.
- Every new test title starts with the next unused stable id — unit ids
  continue from **U555**, desktop e2e from **E225** — and no existing test is
  renumbered, weakened, deleted or skipped. `describe` blocks name the contract
  (e.g. `describe('PRD 011 Req 9 LLM availability')`).
- No test contacts a real provider: anything exercising a request runs against
  `src/lib/llmFake.ts` (PRD 011 Req 35). Wiring the fake into the dev/e2e shim
  as `browser.ts`'s `llmTransport` is allowed and expected if the e2e needs it
  (the `summaryCache` shim wiring is the precedent); `web.ts` gains no LLM
  capability, and no fake reaches `tauri.ts` or `hosted.ts`.
- At least one new E-numbered desktop-shim e2e opens the new tab through the
  widened `openSettings` helper and asserts the availability sentence with
  nothing configured, plus the test-connection path if the shim can answer it.
  The full enumerated availability-per-flavor matrix stays issue #121's work.
- The gate's `E2E_TEST_FLOOR` (226) is not lowered or edited by this issue —
  added tests keep the collected count at or above it.

### The network exception stays where it is

- `src/` gains no `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or
  `EventSource` call site, and `FETCH_ALLOWLIST` in `scripts/validate.mjs`
  stays at **4** — re-pinning the gate's counters and amending SPEC11 is issue
  #114's work, not this one.
- No provider host string is introduced outside `src/lib/llmProviders.ts`.

### Scope fence

- This issue ships provider configuration and its test connection, and nothing
  downstream of it: no Experimental section or semantic-zoom view (#117), no
  summarization (#118), no pricing or measured-usage display (#119), no cache
  inspection/clearing or key-removal-on-stand-down UI (#120), no SPEC11
  amendment or docs/counter re-pin (#114), no enumerated e2e matrix (#121).
  The area is complete on its own: a user can configure a provider and test it.

### Verification

- The inner loop is `npm run typecheck` plus `npm run test:unit` (or tests
  targeted at the changed code — `npx vitest run tests/unit/<file>`,
  `npx playwright test -g '<title>'`). The e2e suite is not run after every
  small change, and the gate is **not** run as a baseline at the start.
- `npm run validate:quick` has been run **once**, at the end, right before
  declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`. The full
  `npm run validate` is release evidence and is not run here.
- If any `SPEC<n>` citation is added or removed, `npm run map` has been run and
  the regenerated `docs/MAP.md` is committed (the gate diffs it). `PRD 011 Req
  <n>` comments do not affect the map.
- A summary comment from the implementer exists on issue #116, naming the
  decisions taken and the files touched.

## Context

The seam this builds on already exists and must not be re-declared:
`src/lib/llmSeam.ts` owns the only `LlmProviderConfig` / `LlmRequest` /
`LlmResponse` / `LlmFailure` definitions, `redactKey`, and the single entry
point `runLlmRequest(transport, config, request)`; `src/lib/llmProviders.ts`
holds the five adapters, their messages and `customEndpoint`;
`src/lib/llmDeployment.ts` holds `LlmAvailability` and
`NO_LLM_CONFIGURED_MESSAGE`; `src/lib/llmFake.ts` is the local fake. The
Platform seam (`src/platform/types.ts`) already carries `llmTransport?`
(desktop, IPC into the Rust `llm_request` command) and `llm?` (hosted,
same-origin `/api/llm` client in `src/platform/hostedLlm.ts`); the static web
build defines neither, which is exactly the "unavailable on this platform"
state.

Settings plumbing: `src/lib/settings.ts` holds `Settings`,
`DEFAULT_SETTINGS`, the `SETTINGS_SCOPES` inventory (`U` / `U!` / `W` / `M`,
exhaustive by construction), `VALIDATORS`, and `WORKSPACE_ELIGIBLE_KEYS`.
`src/components/SettingsPanel.tsx` (~863 lines) has the tab rail, the
User/Workspace scope selector and the Hotkeys User-only precedent; it is
mounted twice — inline at `src/App.tsx:5472` and in the desktop aux window at
`src/AuxWindow.tsx:103`. The aux window is a deliberately dumb view (SPEC13):
it talks to the main window only through the events in
`src/lib/auxProtocol.ts` (`EV_AUX_REQUEST`, `EV_SETTINGS_EDIT`,
`EV_SETTINGS_CHANGED`), which is where the test-connection round trip belongs.
`App.tsx`'s `workspaceActions` prop shows how a capability-bearing section is
injected into the panel from the window that actually holds the capability.

Grep `PRD 011 Req` across `src/` before opening anything, and read `prd/011-
semantic-zoom-and-llm-providers.md` §§ Reqs 4–10 for the exact wording. Do not
read `src/App.tsx` end-to-end.
