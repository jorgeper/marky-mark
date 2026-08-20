# Spec: Tabs on top: strip foundation — presence, tab list, activation, labels, View-menu toggle (#144)

## Goal

All acceptance criteria in issue-specs/issue-144.md are satisfied for issue
#144, with evidence visible in the session: a horizontal file-tab strip spans
the top of the workspace on desktop whenever a document is open, rendering one
ellipsis-clipped, tooltipped tab per SPEC36 open file in tree order with the
active one visually distinct and clicks routed through the existing SPEC36
activation path, a persisted default-on setting plus a checked **File Tabs**
item in the View menu show/hide it without touching the open set, new e2e/unit
coverage exists, `npm run validate:quick` has been run in the implementer's
session and passes, and a summary comment from the implementer exists on issue
#144.

## Acceptance criteria

### Strip presence (PRD 013 Reqs 1–2)

- On desktop, a horizontal tab strip spans the full width of the workspace,
  above the editor, the preview and the split panes alike (all three render
  branches in `src/App.tsx`: preview, `workspace split`, full edit), whenever a
  document is open — a file from the SPEC36 open set or an untitled buffer —
  and the setting below is on. With exactly ONE document open the strip still
  renders (a single tab).
- With no document open (the splash, and the workspace-open-but-no-file state)
  the strip does not render at all — no empty bar, no reserved height.
- The strip is independent of the folder pane: hiding the sidebar
  (`toggleFolders` / `Mod+Shift+E`, or the TOC view) leaves the strip present
  and unchanged; the strip sits above the workspace only, never above the
  sidebar.
- The strip does not render in the web/hosted build, and no `tests/e2e/web.spec.ts`
  W test changes (PRD 013 non-goal). Prefer a capability seam over
  `platform.kind` for the gate — the `folderSeam` idiom in `src/App.tsx:5946`
  is the local precedent — and state in the citation comment which gate was
  chosen and why. Aux windows (Settings/About) get no strip.
- Existing layout survives: the edge clusters anchored to `.body-row`
  (`.edge-cluster-left` with `folder-expand` + the view switch, and
  `.edge-cluster` with the mode switch + preview chevron) stay visible and
  clickable and do not overlap or sit behind the strip; the divider drag, the
  folder-width resize, `.workspace` scrolling and the split ratio all behave as
  they do today. Existing e2e assertions about those affordances stay green
  without being weakened.
- The strip is chrome: it is hidden in print (`@media print` in
  `src/styles.css`, alongside the other chrome) and appears in neither exported
  HTML (`src/lib/exportDoc.ts`) nor `getDocText()`-based comment anchoring.

### The tab list, activation and labels (PRD 013 Reqs 3–4)

- Every path in the SPEC36 open set renders as exactly one tab, in the same
  tree order the sidebar's open list uses (`treeOrderCompare` in
  `src/lib/openFiles.ts`) — the strip derives its list from the existing
  `openFiles` state, holds no list of its own, and adds no new state of record.
- The active file's tab is visually distinct from the inactive ones and carries
  a state a test can assert (e.g. `aria-selected` / a `data-active` attribute /
  a stable class). The full plane-and-shadow treatment is issue #148 — a basic
  active/inactive distinction is all that is required here.
- Clicking an inactive tab activates that file through the existing SPEC36
  activation path — the same call the sidebar's open row makes
  (`openDocGuarded` / the park-and-restore switch), so the parked buffer, its
  dirty flag, scroll position, undo history and mode are restored exactly as a
  sidebar click restores them. No second activation path is written.
- Clicking the ACTIVE tab is a no-op: no re-open, no re-read from disk, no
  scroll jump, no mode change, no park/restore churn.
- Each tab shows the file's basename (via the existing `platform.basename`
  seam, as `FolderPanel` does). Duplicate basenames across folders are
  acceptable in v1.
- Tabs have a maximum width; a basename too long for it is clipped with a CSS
  ellipsis (no mid-word wrap, no strip-height growth), and hovering the tab
  reveals the full path or full file name as a tooltip (`title`), so duplicates
  are disambiguated. Assert both the ellipsis mechanism (the clipped element's
  `text-overflow`/`overflow` computed style or a bounded width) and the tooltip
  text.
- The tab is a real, keyboard-reachable control (a `<button>`, or an element
  with an appropriate role and accessible name) carrying a stable
  `data-testid` per tab plus one for the strip itself, so e2e can drive it.
- **Out of scope here — do not implement:** the dirty ●/✕ swap, middle-click
  close, and the right-click Close / Close Others / Close All menu (issue
  #145); the ephemeral untitled-tab semantics — dirty dot, ✕, the dirty-untitled
  guard, Save As replacement (issue #146); overflow arrows, wheel scrolling and
  scroll-active-into-view (issue #147); the plane/shadow visual treatment
  mirroring the sidebar (issue #148). With an untitled buffer open, this issue
  requires only that the strip renders with a tab labeled `Untitled` as the
  active tab; its close affordance and Save-As replacement land in #146.

### The setting and the View menu (PRD 013 Reqs 13–14)

- A new persisted boolean setting (suggested name `fileTabs`) defaults to
  **true** and is added to `Settings`, `DEFAULT_SETTINGS`, the `VALIDATORS`
  map and `SETTINGS_SCOPES` in `src/lib/settings.ts`, with the chosen scope
  justified in a comment (`'M'`, matching its layout neighbours `showFolders`
  / `folderWidth` / `sidebarView`, is the expected answer). The resolver
  completeness test — `SETTINGS_SCOPES` keys must equal `DEFAULT_SETTINGS` keys
  (`tests/unit/settings-resolver.test.ts`) — stays green.
- The setting round-trips through `settings.json`: absent ⇒ true, explicit
  `false` honored, malformed (`"off"`, `0`) falls back to the default, and it
  survives serialize→parse. A unit test in `tests/unit/settings.test.ts` covers
  this in the shape of U676 (`codeSyntax`) / U673 (`sidebarView`).
- A **File Tabs** item exists in the View menu, checked when the strip is on,
  added once in `buildViewItems` (`src/lib/menuSpec.ts`) so the native menu bar
  and the in-app View flyout (`src/lib/appMenu.ts`) both get it with no second
  copy. It rides a new `CommandId` (`src/lib/commands.ts`) handled in
  `dispatchCommand` in `src/App.tsx`, in the shape of `toggleFolders`.
- Choosing it flips the persisted setting through the existing settings write
  path (`updateSettings`), so the strip appears/disappears immediately and the
  checkmark follows. The toggle NEVER alters the open set, the active file, the
  park map, dirty state or `foldertree.json`: turning the strip off and on
  again leaves the same files open, the same one active, and the same buffers
  parked (assert this with a dirty parked file in the set).
- Gating and placement follow the View menu's existing rules: the item is
  grouped with the other workspace/layout rows, gray/absent exactly where the
  strip cannot exist (mirror what `toggleFolders` / `toggleOpenOnly` do for
  workspace mode, and the `WORKSPACE_VIEW_COMMANDS` omission set in
  `src/lib/appMenu.ts` for flavors with no such seam). Frozen menu expectations
  in `tests/unit/menu-spec.test.ts` and `tests/unit/app-menu.test.ts` are
  updated to include the new row rather than loosened.
- No new hotkey and no `HotkeyMap` entry lands (PRD 013 non-goal: the menu item
  and the setting suffice for v1).
- The setting persists across a restart: with it off, a relaunch still has the
  strip hidden and the View item unchecked; with it on, the strip returns.

### Fit with existing behavior (PRD 013 Req 15)

- Ctrl+Tab / Ctrl+Shift+Tab cycling, the sidebar's open-file rows, only-open-files
  mode, dirty tracking, the file watcher, rename/delete remapping
  (`remapOpen` / `pruneOpen`), `OPEN_CAP`, the quit walk and open-set
  persistence are unchanged in behaviour and in code paths.
- The strip is a pure view and reflects every open-set change immediately:
  Ctrl+Tab moves the active tab, a sidebar click moves it, closing a file from
  the sidebar removes its tab, opening a file adds its tab at the right
  tree-order position, a rename updates the tab's label AND its position in the
  strip, and a delete prunes the tab.
- The strip component lives in `src/components/` in the `FolderPanel.tsx` mold
  — props in, callbacks out, no `@tauri-apps/*`, no platform access beyond the
  passed seams, no `console.*` — and any genuinely new pure rule goes into
  `src/lib/openFiles.ts` (or a sibling lib module) with unit tests, not into
  the component.

### Tests, citations, economy

- New desktop-shim e2e coverage lives in `tests/e2e/` (a new
  `tests/e2e/file-tabs.spec.ts` is fine; `tests/e2e/tabs-and-workspace.spec.ts`
  is the alternative home), driven by `getByTestId` and set up through
  `fixtures.ts` / `helpers.ts` (`freshApp`, `fsWrite`, …), covering at least:
  strip presence with one file open and with several; absence on the splash;
  presence with the sidebar hidden; tab order matching the sidebar's open list;
  click-to-activate (parked content restored) and the active-tab no-op; the
  ellipsis + tooltip on a long name; the View-menu toggle hiding and showing
  the strip with the open set intact; persistence of the setting across a
  restart; and the strip following a Ctrl+Tab switch, a rename and a delete.
- Test titles start with `E<n>:` taking the next unused numbers — E265 is the
  current highest, so start at **E266**; new unit tests take **U678** onward
  (U677 is the current highest). Numbers are never reused, and no existing test
  is weakened, deleted, renumbered or marked `.skip` / `.only` / `.fixme`.
- New or changed behaviour carries a citation comment in the
  `PRD 013 Req <n>: <what and why>` form (per `.sandcastle/CODING_STANDARDS.md`
  and `docs/COMMENT-FORMAT.md`), cross-referencing `SPEC36 §<x>` where it rides
  that contract. If any `SPEC<n>` citation is added or removed, `npm run map`
  has been run and the regenerated `docs/MAP.md` is committed (validate:quick
  checks MAP is up to date).
- **Test economy.** Iteration during the attempt uses `npm run typecheck` and
  `npm run test:unit` (or tests targeted at the changed code, e.g.
  `npx playwright test -g '<title>'` for a single e2e). `npm run validate:quick`
  is run **once**, right before declaring the goal met — not after every change,
  and not as a start-of-attempt baseline (baseline with the quick tier only) —
  and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #144, naming the files
  touched, the E/U numbers added, and the `validate:quick` result.

## Context

Parent issue #139, PRD `prd/013-tabs-on-top.md` (this issue is Reqs 1–4, 13–15;
siblings #145–#149 take close affordances, the untitled tab, overflow, the
visual treatment and the e2e sweep). The open-set model is SPEC36
(`docs/specs/SPEC36.md`); grep `SPEC36` for its ~50 cited sites. Key files:
`src/lib/openFiles.ts` (pure open-set logic, `treeOrderCompare`),
`src/App.tsx` (`openFiles` state ~line 423, `commitOpenSet` ~1599, `dirtyOpenFiles`
~715, the `FolderPanel` props block ~6074 for the prop shape to mirror, the
`.body-row` / `workspace` render branches ~6069–6400, `folderSeam` ~5946,
`dispatchCommand` handlers ~3840/4021), `src/components/FolderPanel.tsx` (the
sidebar's open-file tabs — the component mold and the row semantics to mirror),
`src/lib/menuSpec.ts` (`ViewMenuState` + `buildViewItems`), `src/lib/appMenu.ts`
(the in-app View flyout and `WORKSPACE_VIEW_COMMANDS`), `src/lib/commands.ts`,
`src/lib/settings.ts` (`Settings`, `DEFAULT_SETTINGS`, `VALIDATORS`,
`SETTINGS_SCOPES`), `src/styles.css` (`.body-row` ~2069, `.workspace` ~273, the
sidebar tab planes `.folder-item.selected` / `.folder-item.open` ~2335–2385 —
useful reference even though the mirrored treatment is #148). Never read
`App.tsx` end to end; citation-grep into it.
