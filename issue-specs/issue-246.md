# Spec: Settings dialog: slightly larger, and a pinned Save / Cancel footer instead of a scrolling Done button (#246)

## Goal

All acceptance criteria in issue-specs/issue-246.md are satisfied for issue
#246, with evidence visible in the session: the Settings dialog renders
~15–20% larger in both dimensions with its `vw`/`vh` caps intact, a pinned
bottom-right **Save** / **Cancel** footer sits outside the scrolling tab
content in both the overlay and the frameless aux window (the scrolling
**Done** button is gone), settings edits are held pending until Save while
Cancel/Esc/scrim/aux-close confirm before discarding unsaved changes,
`npm run validate:quick` prints `QUICK VALIDATION: ALL PASSED`, and a summary
comment from the implementer exists on issue #246.

## Acceptance criteria

- **The dialog is a little bigger, caps intact.** `.settings-modal` in
  `src/styles.css` renders at roughly 640–660 px wide and 540–560 px tall
  (from `min(560px, 94vw)` / `min(480px, 85vh)` today), still written as
  `min(<px>, 94vw)` / `min(<px>, 85vh)` so small viewports still clamp it.
  The size stays identical on every tab and in both scopes — E35's
  "same `boundingBox()` on every tab" assertion still passes.

- **The action buttons are a pinned footer, not tab content.** The footer is
  a child of `.settings-modal` and a *sibling* of the scrolling region — not
  rendered inside `.tab-content`, and not inside any single tab's fragment.
  It is bottom-right aligned, always visible without scrolling on the
  longest tab (Editor / Experimental), and stays put when switching tabs or
  scopes. `.tab-content` remains the only scrolling region; the footer never
  scrolls out of view. The footer uses the PRD 018 primitives (`.dialog-actions`
  / the `Button` component / chrome tokens) so `validate:quick`'s style-lint
  step passes with no literal inline chrome styles.

- **Two buttons replace Done.** `Save` (primary) and `Cancel` sit side by
  side in the footer with stable test ids (`settings-save` /
  `settings-cancel`). The `settings-close` test id and the `Done` label no
  longer appear anywhere in `src/` or `tests/`.

- **The footer renders in the frameless aux window too.** The `frameless`
  branch (SPEC13 §1.3) gets the same footer as the overlay — the aux window
  no longer relies on OS chrome alone. `src/platform/tauri.ts`'s settings
  aux-window size (`{ width: 620, height: 560 }`) grows enough that the
  enlarged panel and its footer are not clipped and the window still opens
  `resizable: false`.

- **Edits are pending, not live.** While the dialog is open no row fires
  `onEdit` — nothing is written to `settings.json`, the workspace layer, or
  the aux bus until Save. Pending edits are accumulated per scope
  (`user` / `workspace`) and overlaid on the incoming `layers` prop so that:
  a row the user edited shows its pending value; every other row shows
  exactly what the props supply (including props that update live while the
  dialog is open, such as the LLM usage tally); and the §E19 override
  indicators / row locking read from the pending-overlaid layers, not stale
  ones. The existing free-typing drafts (image folder, pane-min width,
  custom font size) keep working on top of this.

- **Save commits and closes.** Save flushes the accumulated pending patches —
  one `onEdit(scope, patch)` per non-empty scope, carrying only changed keys
  (`diffSettings` semantics) — and then closes the dialog. After Save the
  values are persisted and applied exactly as a live edit was before
  (settings.json / workspace layer on the main window, the `EV_SETTINGS_EDIT`
  bus emit from the aux window), and reopening the dialog shows them.

- **Cancel discards, with a confirmation only when it would lose work.**
  With pending changes, Cancel shows an in-dialog confirmation
  ("Discard your unsaved settings changes?" or similar) offering confirm and
  go-back: confirm fires no `onEdit` and closes; go-back keeps the dialog
  open with the pending edits and the current tab/scope intact. With no
  pending changes, Cancel closes immediately with no prompt.

- **Every other close route behaves like Cancel.** Esc and a scrim mousedown
  on the overlay, and Esc / `⌘W` in the aux window, run the same Cancel path
  (same confirmation when there are pending changes). The aux window's OS
  close button is guarded through the existing
  `platform.registerCloseGuard(shouldBlock, onBlocked)` seam so it does not
  silently drop pending edits either.

- **Pure logic is unit-tested.** The pending-overlay / dirty-detection logic
  lives in a testable module (e.g. helpers in `src/lib/settings.ts` beside
  `resolveSettings` / `diffSettings`) with unit tests covering: no pending
  edits ⇒ not dirty; an edit back to the original value; per-scope
  accumulation; and the overlay resolving through the layer precedence.

- **E2E covers the new contract.** New Playwright tests assert: the footer is
  visible without scrolling on every tab and does not move when tabs change;
  Save persists a changed setting and closes; Cancel with pending changes
  prompts, go-back keeps the dialog open, confirm discards (the setting is
  unchanged after reopening); Cancel with no changes closes with no prompt;
  Esc and a scrim click take the Cancel path. New ids are minted from
  next-unused on this branch (E486+, U1166+) and the gate's test-ID
  uniqueness step passes.

- **The existing e2e suite is migrated, not just renamed.** All 107
  `settings-close` call sites across `tests/e2e/` are updated — tests that
  changed a setting before closing must now click **Save**, or their setting
  will not apply. A shared close helper next to `openSettings` in
  `tests/e2e/helpers.ts` (e.g. `saveSettings` / `cancelSettings`) is the
  preferred route rather than 107 raw locators.

- **The shipped contract text matches the code.** `docs/specs/SPEC7.md` §1's
  pinned `min(560px, 94vw)` / `min(480px, 85vh)` numbers and
  `docs/specs/SPEC13.md` §1.1 (~620×560), §1.3 ("no in-page close button")
  and §1.4 (a theme picked in the Settings window restyles it live — now true
  only after Save) are updated or carry a supersession note naming issue
  #246, following the repo's existing `superseded by` idiom. New/changed
  behaviour carries citation comments per `.sandcastle/CODING_STANDARDS.md`.

- **Generated artefacts are regenerated and committed.** `docs/MAP.md` is
  `npm run map`'s own output after the citation/spec edits, and
  `E2E_TEST_FLOOR` in `scripts/validate.mjs` is re-pinned to the count
  `npx playwright test --list` collects with a changelog comment naming issue
  #246, in the style of the existing entries.

- **Test economy.** The implementer iterates with `npm run typecheck` and
  `npm run test:unit` (or `npx playwright test -g '<title>'` for a single
  behaviour) and runs the full `npm run validate:quick` gate **once**, right
  before declaring the goal met — not after every change and not as a
  baseline at the start.

- **`npm run validate:quick` passes** in the implementer's session, printing
  `QUICK VALIDATION: ALL PASSED`.

- **A summary comment from the implementer exists on issue #246**, naming the
  chosen dialog dimensions, the new test ids, and the verification evidence.

## Context

- `src/components/SettingsPanel.tsx` (~1166 lines) is the whole dialog. The
  `doneButton` at ~line 1080 is rendered *inside* `.tab-content` at ~line
  1150 — that is the bug. `frameless` (SPEC13 §1.3) returns the bare `body`;
  the overlay branch wraps it and closes on a scrim mousedown.
- Every row builds a whole-`Settings` value and goes through the local
  `onChange` (~line 316), which diffs and calls `onEdit(scope, patch)`. That
  single funnel is where pending should be intercepted — including
  `LlmSettings`'s `onChange={(patch) => onChange({ ...settings, ...patch })}`.
  Non-settings actions in the dialog (People-tab membership writes, theme
  reload/import, LLM test connection, summary-cache clear) are server/host
  actions, not settings edits: they stay immediate and are not part of the
  pending set.
- Known wrinkle to note in the summary comment rather than solve: `runLlmTest`
  in `src/App.tsx` reads the *committed* settings, so a Test connection with
  a pending, unsaved API key tests the saved values. Either keep it as-is and
  say so, or gate/hint it.
- Mount points: `src/App.tsx` ~line 8299 (overlay, `onEdit={applySettingsEdit}`,
  `onClose` clears `settingsOpen`) and `src/AuxWindow.tsx` ~line 152
  (frameless, `onEdit` emits `EV_SETTINGS_EDIT`, `onClose={close}` →
  `platform.closeNow()`; Esc/`⌘W` handled at ~line 75).
- Styles: `.settings-modal` at `src/styles.css:1188`, `.dialog-actions` at
  `:427`. `docs/STYLE-GUIDE.md` has the chrome token / primitive rules the
  style-lint step enforces.
- `resolveSettings`, `diffSettings`, `winningLayer` and `settingsRowStatus`
  in `src/lib/settings.ts` are the pure pieces to build the overlay on; note
  the effective `settings` prop also carries App's session overrides, which
  a naive `resolveSettings(mergedLayers)` would drop.
- Sequencing: the owner's comment marks #246 as first in the settings-dialog
  cluster (#246 → #248 → #247 → #249) because all four touch
  `SettingsPanel.tsx`.
