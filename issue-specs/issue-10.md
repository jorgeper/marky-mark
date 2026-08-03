# Spec: line numbers fixes (#10)

## Goal

All acceptance criteria in issue-specs/issue-10.md are satisfied for issue #10, with
evidence visible in the session: the line-number gutter is toggled from a
checkbox item in the **View** menu (no accelerator) instead of the Settings
panel, the "Show line numbers" checkbox is gone from Settings while the
persisted `lineNumbers` key keeps working exactly as before, the gutter strip
carries a left border matching its existing right border whenever it is inset
from the editor pane's left edge, automated coverage asserts both changes,
`npm run validate:quick` prints `QUICK VALIDATION: ALL PASSED`, and a summary
comment from the implementer exists on issue #10.

## Acceptance criteria

- The **View** menu contains a checkbox item for the line-number gutter —
  labelled "Line Numbers" (or equally plain wording) — built by
  `buildMenuSpec()` in `src/lib/menuSpec.ts` as a `CommandItemSpec` with
  `checked` mirroring the persisted `settings.lineNumbers` and **no**
  `accelerator`. It sits with the other view-chrome toggles (near Word Count /
  Front Matter), and its `checked` value flips as soon as the setting changes.
- The item is driven by a new `CommandId` (e.g. `toggleLineNumbers`) registered
  in `src/lib/commands.ts` and handled in `src/App.tsx`'s command registry the
  way `toggleWordCount` is: activating it inverts `settings.lineNumbers` through
  `updateSettings`, the editor gutter reconfigures live (the existing
  `Compartment` in `src/components/Editor.tsx`), and the new value persists to
  `settings.json`.
- No hotkey is introduced: `HotkeyMap` / `DEFAULT_HOTKEYS` in
  `src/lib/hotkeys.ts` are unchanged, the Settings → Hotkeys tab grows no new
  recorder row, and the window hotkey listener gains no binding for the new
  command. The issue explicitly says a hotkey is not needed.
- The "Show line numbers" checkbox is gone from the Settings panel: no
  `settings-line-numbers` input, label, or `scopeNote('lineNumbers')` row
  remains in `src/components/SettingsPanel.tsx`, and no `data-testid` of that
  name is rendered anywhere.
- The persisted setting itself is untouched: `lineNumbers` stays a `Settings`
  key with default `true`, keeps its `'U'` entry in `SETTINGS_SCOPES`, keeps
  parsing/round-tripping through `parseSettings` and the layered resolver, and
  a user's existing `settings.json` value still takes effect on launch. U-level
  settings tests (`tests/unit/settings*.test.ts`) stay green unmodified.
- The line-number strip gains a left border: whenever `.cm-gutters` is inset
  from the editor pane's left edge (the centered-column case the issue
  describes — non-split edit mode with margins), a 1px border of the same
  darker shade and width as the gutter's existing right border is visible on
  its left side, in both light and dark themes. Today only the right border
  exists, and it comes from CodeMirror's own `&light/&dark .cm-gutters` base
  theme — style the pair together (e.g. in `src/styles.css`, scoped through
  `.editor-wrap .cm-editor .cm-gutters`) so left and right always match rather
  than drifting apart.
- The new border introduces no artifact where the gutter is flush against
  another edge — in split mode the editor pane hugs the folder seam (issue #7),
  so the result must not read as a doubled or mismatched rule there. Either
  suppressing the left border in that case or making it coincide cleanly with
  the seam is acceptable; state which was chosen and why in the summary
  comment.
- Everything else about the gutter is unchanged: the Smart Edit button still
  sits in the content area right of the line numbers (SPEC43 §2, E135-era
  assertions), `.cm-gutters` width still tracks the line-number gutter alone,
  hiding line numbers still leaves the smart button standing alone, and the
  preview/edit column alignment (SPEC6) is not shifted by the added border.
- Automated coverage exists for both halves:
  - a unit test in `tests/unit/menu-spec.test.ts` (U124 is the next free id)
    asserting the View menu carries the line-numbers command, that it is a
    checkbox item tracking `MenuState`, and that it has no accelerator;
  - a desktop e2e in `tests/e2e/app.spec.ts` (E136 is the next free id)
    asserting the menu item toggles `.cm-lineNumbers` live and persists to
    `settings.json`, and that the gutter's rendered left border matches its
    right border when the gutter is inset.
- Every existing test that reached line numbers through the removed checkbox is
  re-pointed at the new command rather than weakened, skipped, or deleted —
  `tests/e2e/app.spec.ts` E49, E51 and the SPEC43 smart-gutter test all use
  `getByTestId('settings-line-numbers')` today. Native-menu runs drive it via
  the `__mmMenu.click(...)` seam (the `menuClick` helper); menu-less shim runs
  via `window.__mmDispatch`. Where a test only needed *some* User-scope key to
  force a settings write (E49), any other U-scope setting is a fine substitute.
- `docs/ARCHITECTURE.md` describes the toggle's new home (its "Show line
  numbers" bullet currently frames it as a Settings option). Frozen spec
  documents under `docs/specs/` are not edited — `git diff --stat docs/specs`
  is empty.
- The implementer iterated with `npm run typecheck`, `npm run test:unit`, and
  e2e targeted at the changed behavior (e.g. `npm run test:e2e -- -g "E136"`),
  and ran the full gate below exactly once, right before declaring the goal met
  — not after every change. Any baseline at the start of the attempt used the
  quick tier only.
- `npm run validate:quick` has been run in the implementer's session and
  printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #10, naming the files
  changed, how the View item and the border were implemented, and the gate
  evidence.

## Context

Two independent fixes from the issue body. (1) Relocation: `settings.lineNumbers`
is defined in `src/lib/settings.ts` (interface, `DEFAULT_SETTINGS`,
`SETTINGS_SCOPES`, parser), consumed by `src/App.tsx` (passed to `<Editor
lineNumbers=…>` at two call sites) and reconfigured live via a CodeMirror
`Compartment` in `src/components/Editor.tsx`. The checkbox to delete is in
`src/components/SettingsPanel.tsx`'s General tab (~line 517). Follow
`toggleWordCount` end to end as the template: `CommandId` in
`src/lib/commands.ts`, `MenuState` field + `cmd(...)` row in the View submenu of
`src/lib/menuSpec.ts`, handler in the `App.tsx` command registry, and the
`MenuState` build + its `useMemo` dependency list (~`src/App.tsx:2944`).
`toggleFrontmatter` is the precedent for a menu toggle with no accelerator.

(2) The border: nothing in this repo styles `.cm-gutters` today — the single
right-hand rule comes from `@codemirror/view`'s base theme
(`&light .cm-gutters` / `&dark .cm-gutters`), which is why there is no left
one. `--mm-border` is the app's theme-wide border token if a theme-aware color
is wanted; check the result against both a light theme (crisp) and a dark one
(one-dark). `src/styles.css` around line 740 explains the centered
gutter+content column, and the `.split-editor` override just below it is the
flush-left case to sanity-check.

Note the browser/web build has no native menu bar (`Toolbar.tsx`'s overflow
menu carries only File/Help/Settings), so after this change the toggle is not
reachable from the UI in plain web mode — the persisted key still applies. That
is the direct consequence of "remove it from the settings"; do not re-add a
Settings row to work around it. Web e2e (`tests/e2e/web.spec.ts`) does not touch
line numbers.
