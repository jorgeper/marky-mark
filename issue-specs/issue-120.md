# Spec: Standing the feature down: cache inspection and clearing, key removal, no further calls when switched off (#120)

## Goal

All acceptance criteria in issue-specs/issue-120.md are satisfied for issue
#120, with evidence visible in the session: the LLM providers settings page
reports what the summary cache holds (entry count and a rounded size read from
`platform.summaryCache.size()`) and clears it outright in one action — dropping
the session memo with it, so a cleared cache is really empty and the next zoom
re-asks rather than serving from memory — and removes the stored API key in one
action in the same place, with the Experimental semantic-zoom row routing there;
turning the Experimental switch off leaves nothing running (outstanding
summaries abandoned, no summarization request built from any path while it is
off) and deletes nothing behind the user's back; no control is offered where it
cannot work (no key field or key removal on hosted, no cache section where the
platform has no store, a legible failure when a hosted clear is refused), and
the desktop settings window round-trips both actions to the main window exactly
as the existing test-connection action does; `npm run validate:quick` was run
once at the end and printed `QUICK VALIDATION: ALL PASSED`; and a summary
comment from the implementer exists on issue #120.

## Acceptance criteria

### Req 30 — the cache is inspectable

- The LLM providers settings page carries a **Summary cache** section that
  reports, without the reader taking any action beyond opening the page: how
  many entries the cache holds and roughly how many bytes, in a human sentence
  (e.g. `12 summaries · about 34 KB`), read from
  `platform.summaryCache.size()` (`SummaryCacheSize` in
  `src/lib/summaryCacheStore.ts`) — not from a count the view keeps itself.
- The rounding/wording is a **pure function** over `SummaryCacheSize` living in
  `src/lib/` (extend `llmSettings.ts` or add a small module beside it), so it is
  unit-tested with no DOM: zero entries reads as empty in its own words, and
  bytes render in B / KB / MB without pretending to a precision the cap
  (`SUMMARY_CACHE_MAX_BYTES`, 4 MiB) does not have.
- The size is read when the page is shown and re-read after a clear. It is
  **not** polled on a timer, and reading it makes no LLM request — PRD 011
  Req 16 is untouched by this issue: the only thing the size read touches is the
  store (a file read on desktop, the existing same-origin `GET
  /api/workspaces/<id>/summary-cache` on hosted).

### Req 30 — and clearable, in one action

- The same section carries a **Clear cache** action. One click clears: no
  multi-step wizard. A confirmation step is allowed (it is destructive and
  shared on hosted) but is not required; if one is used it is one click plus one
  confirm, and cancelling leaves the cache intact.
- After a successful clear, `platform.summaryCache.clear()` has been called, the
  displayed size updates in place to the empty wording without reopening
  Settings, and the store really is empty (a later `size()` answers zero
  entries).
- **A cleared cache is really cleared.** `src/App.tsx`'s session memo
  (`summaryMemoRef`, the `Map` `runSummaries` is handed as `memo`) is dropped by
  the same action, and so is any rendered summary state that would otherwise
  survive it. Without this, clearing is a lie until restart: re-entering a
  zoomed level would still be served from memory. Evidence: after clearing,
  re-entering the same level with the fake provider issues fresh requests
  (the fake's `calls` count grows) instead of filling from memory.
- Clearing the cache **issues no LLM request of its own** — it does not
  re-summarize the open document, and it does not start a run. If the reader is
  sitting at a zoomed level when they clear, the level's blocks may empty or
  re-request only through the ordinary run rules the code already has; nothing
  new is invented to refill them eagerly.
- A clear that fails is reported in place, in the reader's words, and the
  displayed size is **not** reset to empty. This is real on hosted: `DELETE
  /api/workspaces/<id>/summary-cache` requires the `workspace.settings`
  permission (`server/workspaces.ts:138`), and `createHostedSummaryCache.clear`
  deliberately throws rather than swallowing — a member without that permission
  sees why, and no key material or raw server internals appear in the message.

### Req 3 — the key comes out in one action, in the same place

- The Credential area of the same LLM providers page carries a **Remove key**
  action that clears `llmApiKey` to `''` in the user layer in one click, through
  the existing settings-edit path (`onChange`/`onEdit`) — no new persistence
  route, and nothing workspace-scoped (`llmApiKey` stays `U!`).
- After removal the key field is empty, `llmAreaState` answers `unconfigured`
  with the existing `NO_KEY_MESSAGE`, `Test connection` is disabled with that
  same sentence as its reason, and no summarization request can be built. If a
  document is open at a zoomed level, the view falls back to #117's excerpts and
  its excerpt notice — no error state, no empty view.
- The action is offered **only where a key of the reader's own exists**: it is
  absent in the `hosted` and `operator-unconfigured` states (the credential is
  the operator's) and absent in `no-path`. It is present, and disabled or
  absent, when there is no key to remove — either is acceptable, as long as it
  never claims to have removed something it did not.
- Removing the key does **not** clear the cache, and clearing the cache does not
  remove the key: two actions, one click each, side by side. Neither is
  triggered as a side effect of the other or of the Experimental toggle.
- The key's value is still rendered nowhere but the masked field — not in the
  removal control, its confirmation, a hint, a notice or a log (PRD 011 Req 7).
- **Discoverability:** the Experimental section's semantic-zoom row names where
  the key and cached summaries are removed and routes there in one click,
  reusing the existing `SettingsPanel` `initialTab` / tab-switch mechanism (the
  precedent is the excerpt notice's route to the LLM area, E234). A reader
  turning the feature off does not have to hunt for the stand-down actions.

### Req 3 — off means stood down

- With `settings.semanticZoom` false, the app builds **no summarization
  request** from any path: no `trigger: 'summarize'` request is constructed on
  app start, document open, typing, saving, a settings change, a mount or a
  timer, and none can be provoked from the zoom accelerators, the View menu or a
  command, because the feature is absent (PRD 011 Req 2, already E229).
  Evidence in e2e: with the fake provider configured and the feature off, the
  fake's `calls` count stays where it was across open, type, save and every
  semantic-zoom accelerator.
- Turning the switch off **while summaries are in flight** abandons them: the
  run identity ends (`summaryRunId` / `acceptsSummaryResult`), no further
  request leaves, and no late result is rendered anywhere. This is #118's
  existing rule — this issue's job is to prove it holds for the toggle
  specifically, not to re-implement it. If it does not hold, fix it here.
- Turning the switch off **deletes nothing on its own**: the stored key and the
  cached summaries survive, because an accidental toggle must not destroy a
  pasted key or a paid-for cache. Standing down is offered, not imposed — which
  is exactly why the two one-click actions exist.
- Turning the switch back on restores the feature with no restart and with the
  cache still serving (unless the reader cleared it), which is the honest
  counterpart of the sentence above.
- The `Test connection` action stays available with the feature off: the LLM
  providers area is unconditional (PRD 011 Req 4) and serves future LLM
  features. Nothing in this issue gates that page, its tab or its controls on
  `settings.semanticZoom`.

### Availability: never a control that cannot work (Req 9's stance)

- The cache section branches on the **capability** the window was handed —
  whether a `SummaryCacheStore` is reachable — never on `platform.kind`. Where
  no store exists (`src/platform/web.ts`, the static web build, which also has
  the `no-path` LLM state), the section is not rendered at all: no dead size
  line, no disabled Clear button.
- On the desktop, Settings is the aux window and holds no capabilities of its
  own (PRD 011 Req 10). Size and clear therefore **round-trip to the main
  window over the existing bus**, exactly like `llmTestConnection`: new
  `AuxRequest` variants and a result event in `src/lib/auxProtocol.ts`, each
  with a sanitizer in the shape of `sanitizeLlmTestResult` (an untrusted payload
  that is not the expected shape is rejected, never rendered), and whether a
  store exists travels in the aux init beside `llm: LlmCapabilities`.
  `src/AuxWindow.tsx` calls no store and no IPC command directly.
- Both mount points — the inline `SettingsPanel` in `src/App.tsx` and the aux
  window — render the same page from the same props, so the section behaves
  identically in each.
- Hosted: the cache is workspace-scoped and shared, so the section says plainly
  that clearing throws away every member's summaries, not just the caller's.
- No new outbound call site is introduced anywhere: desktop goes through the
  existing store over the Rust file commands, hosted through
  `platform/hosted.ts`'s `api(...)` wrapper. The validation gate's committed
  fetch/allowlist counters and `tests/unit/static-web-no-llm.test.ts` pass
  unchanged.

### Scope

- This issue adds **no** cost/usage display, no per-entry cache browser, no
  eviction policy change, no export of cached summaries, and no new provider
  behaviour. "Inspectable" here is the aggregate the PRD asks for — how much it
  holds — not a table of rows. (#119 owns cost transparency; #121 owns the
  verification matrix.)
- `SummaryCacheStore`'s interface is used as it stands (`get` / `put` / `size` /
  `clear`); no second keying scheme, no browser-side mirror of the cache, and no
  change to `SUMMARY_CACHE_MAX_BYTES` or the eviction rule.
- No existing unit or e2e test is weakened, skipped, renumbered or deleted, and
  no existing `data-testid` is renamed.

### Tests

- New unit tests live in `tests/unit/`, matching the kebab-case name of the
  module under test. New test titles start with the next unused stable id —
  unit ids continue from **U621**, desktop e2e from **E238** — and `describe`
  blocks name the contract (e.g. `describe('PRD 011 Req 30 — cache size and
  clear')`).
- Unit coverage lands, at minimum: the size wording for zero / small / large
  caches and its rounding; whichever pure rule decides that the cache section
  and the Remove-key action are offered (capability present, area state) answers
  correctly for `no-path`, `operator-unconfigured`, `hosted`, `unconfigured` and
  `ready`; and the new aux request/result sanitizers accept the real shape and
  reject junk (wrong type, missing field, hostile extra payload).
- **No test contacts a real provider** (PRD 011 Req 35). Unit tests drive
  `createFakeLlm()`; e2e drives the fake the desktop shim already installs and
  the shim's `window.__mmFakeLlm` handle.
- Desktop-shim e2e coverage lands, at minimum, in `tests/e2e/semantic-zoom.spec.ts`
  (or a sibling suite): with a provider configured and a level summarized, the
  LLM page reports a non-empty cache; Clear empties the report and a re-entered
  level asks the fake again (proving the memo went too); Remove key empties the
  field, flips availability to the no-key sentence and drops the zoom view back
  to excerpts with no request made; and with the feature off, opening, typing,
  saving and pressing the zoom accelerators leave the fake's call count
  unchanged while the key and the cache report survive the toggle.
- Every new interactive control ships a `data-testid` and is driven by it; new
  e2e setup reuses `tests/e2e/helpers.ts` / `fixtures.ts`.
- Every new module, exported type and rendered state carries a `PRD 011 Req
  <n>: <what and why>` citation comment per `docs/COMMENT-FORMAT.md` and
  `.sandcastle/CODING_STANDARDS.md`.

### Verification

- The inner loop is `npm run typecheck` plus `npm run test:unit` (or tests
  targeted at the changed code — `npx vitest run tests/unit/<file>.test.ts`,
  `npx playwright test -g '<title>'`). The e2e suite is **not** run after every
  small change, and the full gate is **not** run as a baseline at the start of
  an attempt — any baseline uses the quick tier only.
- `npm run validate:quick` has been run **once**, at the end, immediately before
  declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`. The full
  `npm run validate` is release evidence and is not run here.
- If any `SPEC<n>` citation is added or removed, `npm run map` has been run and
  the regenerated `docs/MAP.md` is committed (the gate diffs it). `PRD 011 Req
  <n>` comments do not affect the map.
- A summary comment from the implementer exists on issue #120, naming where the
  two actions live, how the session memo is dropped on clear, how the desktop
  aux round trip is shaped, the `U<n>` / `E<n>` ids covering inspect, clear,
  key removal and the feature-off silence, and the gate result.

## Context

The contract is `prd/011-semantic-zoom-and-llm-providers.md` Reqs 3 and 30
(with 7, 9, 16 and 29 as the constraints around them); the parent is #108, and
#118 is the predecessor this builds on. Almost everything needed already
exists — this is wiring plus two buttons:

- **The store** (#115): `platform.summaryCache` (`src/platform/types.ts:294`)
  already presents `size()` and `clear()` on both flavors —
  `src/platform/summaryCacheFiles.ts` (desktop and the e2e shim) and
  `src/platform/hostedSummaryCache.ts`, whose `clear()` deliberately throws on
  failure "so #120 can tell them it did not happen". `SummaryCacheSize` in
  `src/lib/summaryCacheStore.ts` is `{ bytes, entries }`, and the server routes
  (`server/workspaces.ts:137–138`) are already in place with their permissions.
  `src/platform/web.ts` installs no store at all.
- **The settings page** (#116): `src/components/LlmSettings.tsx` renders the LLM
  tab and holds no rules — every rule comes from `src/lib/llmSettings.ts`
  (`llmAreaState`, `canTestConnection`, `NO_KEY_MESSAGE`). `SettingsPanel.tsx`
  mounts it as `llmTab` (`:858`) and owns `EXPERIMENTAL_FEATURES` / the
  Experimental tab (`:158`, `:869`) plus the `initialTab` routing (`:83`).
- **The desktop round trip** (#116): `src/lib/auxProtocol.ts` has
  `EV_AUX_REQUEST` / `EV_LLM_TEST_RESULT`, the `AuxRequest` union,
  `sanitizeAuxRequest` and `sanitizeLlmTestResult`; `src/AuxWindow.tsx:105`
  (`testLlm`) is the promise-over-the-bus pattern to copy, and `src/App.tsx:4290`
  is where the main window answers such a request.
- **The run rules** (#118): `src/App.tsx` computes `summaryRun`
  (`summaryRunId`, ~`:4180`), holds `summaryMemoRef` (~`:4160`) and starts the
  only run in the effect below it; `settings.semanticZoom` already gates
  `zoomActive` and resets the level to full when it flips off (~`:3897`).
  `acceptsSummaryResult` (`src/lib/summaryPlan.ts`) is the cancellation rule.
  The memo is the thing a naive "clear" forgets.
- **Tests to read first**: `tests/e2e/semantic-zoom.spec.ts` — `setSemanticZoom`,
  `configureProvider`, `fakeCalls` and `scriptFake` are already written there
  (E229–E237), and E234 shows the route-to-the-LLM-area precedent.

Read `.sandcastle/CODING_STANDARDS.md` before writing code, and grep
`PRD 011 Req` across `src/` rather than reading `src/App.tsx` whole. Costs, per
CLAUDE.md: `npm run typecheck` + `npm run test:unit` are the seconds-long inner
loop; `npm run validate:quick` adds the minutes-long, machine-serialized
Playwright suite — run it once, at the end.
