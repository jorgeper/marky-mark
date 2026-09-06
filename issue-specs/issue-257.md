# Spec: Sidebar chrome cleanup: sidebar-not-folder wording, fixed view-switch tooltips, hide view buttons when collapsed, move file filters to the View menu (#257)

## Goal

All acceptance criteria in issue-specs/issue-257.md are satisfied for issue
#257, with evidence visible in the session: every show/hide control for the
left pane reads "Hide sidebar" / "Show sidebar", the three view-switch
buttons carry fixed tooltips and no longer hide the sidebar when the active
one is pressed, the switch renders no DOM at all while the sidebar is hidden,
the folder header keeps only "Navigate to the open file" with both file
filters reached from the View menu (both surfaces), `npm run validate:quick`
passes in the implementer's session, and a summary comment from the
implementer exists on issue #257.

## Acceptance criteria

### 1. One show/hide *sidebar* control, consistently worded

- The folder panel's collapse chevron (`folder-collapse` in
  `src/components/FolderPanel.tsx`), the TOC panel's (`toc-collapse` in
  `src/components/TocPanel.tsx`) and the Search panel's (`search-collapse`
  in `src/components/SearchPanel.tsx`) all carry `title` **and**
  `aria-label` exactly `Hide sidebar` — the folder one no longer says
  "Hide the folder panel".
- The collapsed-state control (`FolderExpandButton`, testid `folder-expand`)
  carries `title` and `aria-label` exactly `Show sidebar`.
- Test ids stay as they are (`folder-collapse`, `toc-collapse`,
  `search-collapse`, `folder-expand`) — this issue changes wording and
  behaviour, not the DOM's addressing.
- The View menu row that drives the same visibility already reads **Sidebar**
  (`cmd('toggleFolders', 'Sidebar', …)` in `src/lib/menuSpec.ts`, landed with
  issue #258): it is verified to still read that way and is left alone, along
  with its command, hotkey, checkbox and workspace-only gating.

### 2. The three view buttons are stateless mode switches

- In `SidebarViewSwitch` (`src/components/TocPanel.tsx`) each button's
  `title` and `aria-label` are constants — identical whether or not that view
  is the one showing:
  - `sidebar-view-folders` → `Show workspace files`
  - `sidebar-view-toc` → `Show the table of contents`
  - `sidebar-view-search` → `Search in workspace`
- Pressing a button whose view is **not** showing switches the sidebar to
  that view (opening it if hidden), exactly as today.
- Pressing the button whose view **is** showing does nothing observable: the
  sidebar stays open on the same view, `aria-pressed` stays `true`, the pane
  does not slide, and no settings write flips `showFolders`. (Re-focusing the
  Search query box on a press of the already-active Search button is
  acceptable; hiding the sidebar is not.)
- The pressed/active affordances are unchanged: `aria-pressed`, `data-active`
  and the accented `.on` class still mark the live view.
- Hiding stays the job of the §1 control, the View ▸ Sidebar row and the
  hotkeys. The `toggleFolders` / `toggleToc` / `toggleSearch` **commands**
  keep their existing toggle semantics for the hotkey and menu routes, so the
  buttons take a non-toggling path rather than the shared toggle being
  changed underneath the hotkeys.

### 3. No view buttons while the sidebar is hidden

- With the sidebar hidden, the switch renders nothing: `sidebar-switch`,
  `sidebar-view-folders`, `sidebar-view-toc` and `sidebar-view-search` all
  resolve to zero elements (both with the file tab strip up — the
  `FileTabStrip` `leading` slot — and with it hidden — `.edge-cluster-left`).
- Showing the sidebar again brings the switch back with the same buttons and
  gating it has today.
- Exactly one "Show sidebar" control remains in the collapsed state, and it
  exists wherever the sidebar itself could show — including a platform
  without the folder seam but with a document open (today `FolderExpandButton`
  is `folderSeam`-gated while the switch carried the TOC route, so removing
  the switch must not leave the TOC reachable only by hotkey). Pressing it
  shows the sidebar on the view it was last showing.
- A collapsed state with nothing to show still renders no empty cluster
  wrapper, as today.

### 4. A one-button folder header; both filters live in the View menu

- The folder header's right-side cluster keeps only `folder-sync`
  ("Navigate to the open file", same disabled rule). `folder-open-only` and
  `folder-filter` are gone from the DOM in every state — no hidden or
  disabled remnant.
- `buildViewItems` (`src/lib/menuSpec.ts`) gains a new checkbox item for the
  existing `showNonMd` setting, placed immediately after **Only Open Files**,
  backed by a new `CommandId` (`src/lib/commands.ts`). Suggested phrasing
  **Show All Files**, checked when `showNonMd` is true — whichever phrasing is
  chosen, the checked state must read truthfully against the setting.
- The new item is grayed outside workspace mode like its neighbours, and also
  while Only Open Files is on (the filter is inert in that mode — the removed
  button was disabled there too). `ViewMenuState` gains whatever it needs for
  that (it already carries `openOnly`); any new field is optional so existing
  call sites and frozen fixtures stay valid.
- Both View surfaces show it: the native menu bar and the in-app View ▸
  flyout (`src/lib/appMenu.ts`, row testid `menu-view-<command>`). The new
  command joins `WORKSPACE_VIEW_COMMANDS` so flavors with no workspace seam
  omit it rather than showing a permanently dead row.
- Dispatching the new command flips `showNonMd` through the same path the
  removed button used (the `onToggleNonMd` handler in `src/App.tsx`), so
  persistence in the workspace session, the tree's `displayEntries`
  filtering and the Only Open Files interaction are all unchanged. Both
  commands are silent no-ops where the folder seam or workspace is absent,
  following the `toggleFolders` discipline.
- **Only Open Files** keeps its existing command, hotkey, label and position.

### 5. Tests, citations and the gate

- Unit tests cover the new View item on both surfaces: `tests/unit/menu-spec.test.ts`
  (presence, label, position after Only Open Files, checked state both ways,
  disabled gating) and `tests/unit/app-menu.test.ts` (the in-app row, and its
  absence without the workspace seam).
- Every e2e test asserting the old chrome is updated to the new contract, not
  deleted wholesale: the old tooltips (`folder-tree.spec.ts` E-tests around
  the header buttons, `toc.spec.ts`, `search.spec.ts`), the "click the active
  view button hides the sidebar" behaviour, and each use of
  `folder-open-only` / `folder-filter` (in `folder-tree.spec.ts`,
  `tabs-and-workspace.spec.ts`, `file-tabs.spec.ts`) — the filter flips those
  tests need now go through the View menu. New coverage exists for: the fixed
  tooltips, the active-button press being a no-op, and the switch's absence
  while the sidebar is hidden.
- The desktop-shim e2e collection stays at or above `E2E_TEST_FLOOR` in
  `scripts/validate.mjs`; if a net drop is unavoidable the constant is
  lowered with a justification comment in the house style there.
- Citations agree with the code: the comments on these buttons in
  `FolderPanel.tsx`, `TocPanel.tsx`, `SearchPanel.tsx`, `App.tsx`,
  `menuSpec.ts` and `appMenu.ts` name what they now do, and the contracts they
  contradict carry an amendment note in the house form
  (`> **Amended (issue #257, 2026-09-06):** …`) — at least PRD 012 Req 9
  ("pressing it while the TOC is already showing hides the sidebar"),
  SPEC36 §5 (the `folder-open-only` header button and the "# filter button is
  disabled while in this mode" clause) and the PRD 014 Req 2 / SPEC34
  statements about the header's filter buttons.
- `docs/MAP.md` matches what `npm run map` derives (regenerate and commit if
  citations or E-numbers moved) — the quick gate diffs it.
- Chrome styling follows `docs/STYLE-GUIDE.md`: no new one-off button class or
  raw colour/size literals; the header keeps its existing `.icon-btn`
  primitives.
- Both builds behave: desktop (Tauri/shim) and hosted alike; the single-file
  web build still ships zero folder-pane DOM.
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` runs for the touched e2e tests). Run
  `npm run validate:quick` **once**, right before declaring the goal met — not
  after every change, and not as a start-of-attempt baseline beyond that same
  quick tier — and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #257 describing what
  changed and the gate evidence.

## Context

The switch lives in `SidebarViewSwitch` (`src/components/TocPanel.tsx`,
~line 180) and is built once in `src/App.tsx` (~line 7650) and handed to
whichever surface is up — the open panel's header, or the collapsed
`leftCluster` (~line 7717), which also mounts `FolderExpandButton`
(`src/components/FolderPanel.tsx` ~line 268). All three view routes funnel
through `showSidebarView` in `src/App.tsx` (~line 4012), which writes
`sidebarView` + `showFolders` as one settings update and arms the pane slide
only when visibility flips; the toggle-if-already-showing decision is made
there and in the three command handlers (~lines 4666–4722), so that is where
the button-vs-hotkey split belongs.

The folder header's four buttons are in `src/components/FolderPanel.tsx`
(~lines 690–745). View menu items are built once by `buildViewItems` in
`src/lib/menuSpec.ts` (~line 199) and mapped to in-app rows by
`src/lib/appMenu.ts` (`WORKSPACE_VIEW_COMMANDS`, `viewRow`, `buildViewRows`).
Issue #258 has already landed on this branch: the View row is labelled
`Sidebar` and the file-tab-strip row has moved to Settings, so §1's menu
relabel is a verification, not an edit.

Grep before opening files (`rg 'SPEC36' src`, `rg 'PRD 012' src`) and never
read `src/App.tsx` end-to-end.
