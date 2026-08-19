# Spec: Edit bug fixes (#125)

## Goal

All acceptance criteria in issue-specs/issue-125.md are satisfied for issue
#125, with evidence visible in the session: an edit/preview switch sits in the
workspace's top-right edge cluster immediately left of the show/hide-preview
chevron and flips the mode through the existing `toggleMode` command; the last
chosen view mode is a persisted setting, so a newly opened document — and a
restarted app — lands in that mode (split view included) instead of always in
preview; new U- and E-numbered tests cover both; `npm run validate:quick`
passes; and a summary comment from the implementer exists on issue #125.

## Acceptance criteria

### 1. The edit/preview switch (issue item 1)

- A switch control renders in the workspace's top-right edge cluster,
  immediately to the LEFT of the show/hide-preview chevron
  (`PreviewToggleButton` in `src/components/FolderPanel.tsx`, testids
  `preview-collapse` / `preview-expand`), styled as a sibling of the existing
  `.preview-edge` tab and not overlapping it in either mode.
- The control carries a stable `data-testid`, a `title` and an `aria-label`
  that name what it does, and it visibly indicates the CURRENT mode (not only
  the target) — an active/`on` state or two labelled segments, so a reader can
  tell edit from preview without clicking.
- Clicking it switches preview → edit and edit → preview by dispatching the
  existing `toggleMode` command (never by calling `setMode` directly), so
  selection carry-over, reading-position carry-over, autosave-on-toggle and the
  `docGrants.edit` / no-document guards in `toggleMode` (`src/App.tsx`) behave
  exactly as they do for the toolbar button and Mod+E.
- The control is present in BOTH modes when a document is open (a file or an
  untitled buffer) and the reader may edit it (`docGrants.edit`), and absent on
  the splash and for a read-only document — the same gate the toolbar's
  `edit-toggle` uses (PRD 007 Req 17).
- Nothing about the existing preview chevron changes: same testids, same
  edit-mode-only visibility, same `toggleSplit` dispatch. The existing e2e
  tests that click it (E84 in `tests/e2e/split-view.spec.ts`, the
  `preview-collapse` / `preview-expand` uses in
  `tests/e2e/shell-and-menus.spec.ts`) still pass unmodified.

### 2. The remembered view mode (issue item 2)

- `Settings` (`src/lib/settings.ts`) gains one key recording the last chosen
  document view mode (`'preview' | 'edit'`), complete across all four
  inventories the file requires: the interface, `DEFAULT_SETTINGS`
  (defaulting to `'preview'`, today's behaviour), `SETTINGS_SCOPES` and
  `VALIDATORS`. It is `'M'` (machine/session-local), like its neighbours
  `splitEdit`, `splitRatio` and `showFolders`, so no workspace or team layer
  can force a reader's view mode; a hand-edited garbage value falls back to the
  default rather than reaching the app.
- Every route that changes the mode writes that setting through the existing
  `updateSettings` seam: the toolbar `edit-toggle`, the new switch, the Mod+E
  hotkey and the app/native menu row. They all already funnel through
  `toggleMode`, so one write there is enough — verify no other route sets the
  mode without recording it.
- Opening a document lands in the remembered mode instead of the hard-coded
  `setMode('preview')` at the open path in `src/App.tsx` (~line 1943). This
  holds for every open route that goes through it: a fresh file open, a pick in
  the folder panel, a switch to an already-open (parked) tab, a recent-file
  open, and the boot restore of the previous session.
- The remembered mode never wins over a guard: a document the reader may not
  edit (`docGrants.edit` false) opens in preview, and the splash (no document)
  stays preview-only.
- Dual pane keeps working as the issue asks: `settings.splitEdit` already
  persists, so with the remembered mode `'edit'` and split on, a newly opened
  document shows editor + live preview — demonstrated by a test, not assumed.
- ⌘N (new untitled) still opens in edit mode, and closing a document still
  resets cleanly — the two other `setMode` sites keep their current behaviour.
- No new row appears in the Settings panel: this is remembered state, not a
  preference the reader configures.

### 3. Tests, docs and the gate

- New unit coverage in `tests/unit/` for the settings key — default value,
  invalid value rejected, scope tag, and a `serializeSettings` →
  `parseSettings` round trip — numbered from U654 (U653 is the current high
  water mark) and following the existing `describe`/`test` naming.
- New Playwright coverage in `tests/e2e/` numbered from E247 (E246 is the
  current high water mark), covering at least: (a) the switch renders left of
  the preview chevron and flips edit ↔ preview, and (b) after choosing edit,
  opening a different file lands in edit mode (split view when split is on).
  Put them in the spec file whose area they belong to (`split-view.spec.ts` or
  `shell-and-menus.spec.ts`).
- New or changed behaviour carries a citation comment in the repo's format
  (`.sandcastle/CODING_STANDARDS.md`): `PRD 003 Req 6/7` for the edge-tab
  cluster, `PRD 007 Req 17` for the edit-grant gate, and `issue #125` for the
  new behaviour itself.
- `docs/MAP.md` matches what `scripts/map.mjs` derives — run `npm run map` and
  commit the result if any `SPEC<n>` citation moved or was added; the quick
  gate fails on a stale map.
- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx playwright test -g '<title>'` for one e2e), NOT the full suite after
  every change; the baseline at the start of the attempt, if any, was the quick
  tier only.
- `npm run validate:quick` has been run ONCE, at the end, right before
  declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #125, naming what
  changed and quoting the quick-gate result line.

## Context

The two items are separate changes in the same area.

Item 1's "show/hide preview button" is `PreviewToggleButton`
(`src/components/FolderPanel.tsx:216`), the edge chevron rendered at
`src/App.tsx:5761` under `{mode === 'edit' && ...}`; its CSS is `.preview-edge`
in `src/styles.css` (~line 1903, absolutely positioned `right: 0; top: 9px`,
sharing a rule with `.folder-expand`). "To the left of" therefore means a
second tab in that top-right cluster — either a shared flex container or a
second absolutely-positioned tab offset by the chevron's width. Note the
`.theme-root.toolbar-static` override that pushes the tabs down to `top: 51px`
in the web/shim static toolbar; the new control needs the same treatment.

Item 2: `mode` is plain `useState<Mode>('preview')` (`src/App.tsx:384`) and is
reset to `'preview'` on every document open (~1943) and on close (~2056);
`toggleMode` (~3169) is the single gated switch point, and ⌘N sets `'edit'`
(~3273). Adding a settings key is mechanical but exhaustive by construction —
`src/lib/settings.ts` will fail the typecheck if the key is missing from
`SETTINGS_SCOPES` or `VALIDATORS`; `tests/unit/settings-scope.test.ts` pins the
scope invariants (an `'M'` key must stay out of the workspace-eligible lists).
`updateSettings` in `src/App.tsx` (~2543) is the write seam and already
broadcasts to the desktop settings window.

Grep before opening files: `rg 'SPEC7' src` for the mode/split contract,
`rg 'PRD 003' src` for the edge chevrons. Never read `src/App.tsx`
end-to-end. The issue has no PRD and no parent issue, and its screenshot could
not be fetched from the sandbox — the placement above is derived from the code.
