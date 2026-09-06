# Spec: View menu cleanup: rename Folders, relocate File Tabs, drop Sync Scrolling and the semantic-zoom trio (#258)

## Goal

All acceptance criteria in issue-specs/issue-258.md are satisfied for issue
#258, with evidence visible in the session: the View menu's first item reads
**Sidebar** (same `toggleFolders` command, ⌘⇧E hotkey, checkbox and
workspace gating as today); **File Tabs** is gone from both View surfaces
while the `fileTabs` setting stays togglable from the Settings dialog;
**Sync Scrolling** is gone from the View menu with the split view's corner
button left as its only toggle and still no hotkey; the three semantic-zoom
rows and their `Mod+Shift+-` / `Mod+Shift+=` / `Mod+Shift+0` accelerators are
gone unconditionally on every build while the plain Zoom In / Zoom Out /
Actual Size trio is untouched; `npm run validate:quick` has been run in the
implementer's session and prints `QUICK VALIDATION: ALL PASSED`; and a
summary comment from the implementer exists on issue #258.

## Acceptance criteria

- **Rename.** `buildViewItems` (`src/lib/menuSpec.ts`, ~line 235) labels the
  first View item **`Sidebar`** instead of `Folders`. Only the label changes:
  the `toggleFolders` command id, the `showFolders` persisted setting, the
  `hotkeys.toggleFolders` binding (default `Mod+Shift+E`), the checkbox
  mirroring `showFolders`, and the "disabled outside workspace mode" gating
  all stay exactly as they are — no settings-key rename, so no migration and
  no change to `SETTINGS_SCOPES` / `parseSettings` round-tripping. The label
  is chosen to match the code's own vocabulary for the pane
  (`SidebarView = 'folders' | 'toc' | 'search'` in `src/lib/settings.ts`),
  which is why "Folders" was wrong: the pane hosts three views, not one.
- The rename carries through every user-visible echo of that label: the
  Hotkeys tab's `HOTKEY_LABELS.toggleFolders` string in
  `src/components/SettingsPanel.tsx` (~line 121, today `Show / hide folders`)
  reads as the sidebar, and any tooltip/aria text naming the *menu item*
  follows. The `FolderPanel` header title and the Folders/TOC/Search view
  switch inside the pane are **not** renamed — those name the Folders *view*,
  which is still correct.
- **File Tabs leaves the menu.** `toggleFileTabs` no longer appears in
  `buildViewItems`, so it is absent from both the native View submenu and the
  in-app View ▸ flyout on every flavor (`menu-view-toggleFileTabs` resolves to
  zero elements everywhere). It gains no hotkey.
- **File Tabs lands in Settings.** The Settings dialog's **Appearance** tab
  carries a checkbox bound to `settings.fileTabs` (suggested testid
  `settings-file-tabs`; label in the panel's existing voice, e.g. "Show the
  file tab strip above the document"), with `scopeNote('fileTabs')` beside it
  like its neighbours. It renders only where the tab-strip seam exists —
  gated on `platform.multiFileSession` threaded in as a prop following the
  existing `autoHideAvailable` precedent (`SettingsPanel.tsx` ~line 51,
  passed from `src/App.tsx` ~line 8307) — so the static web build, which has
  no strip (PRD 013 Req 14, issue #149), shows no row. Toggling it persists
  `fileTabs` and shows/hides the strip live, exactly as the menu item did;
  `DEFAULT_SETTINGS.fileTabs` stays `true` and its `'M'` scope is unchanged.
  (Appearance is this spec's call between the two the issue offered; it sits
  with the other chrome-visibility rows.)
- **Sync Scrolling leaves the menu.** `toggleSyncScroll` no longer appears in
  `buildViewItems`; `menu-view-toggleSyncScroll` resolves to zero elements on
  both menu surfaces. The `toggleSyncScroll` command, the `syncScroll`
  setting and the split view's corner `SyncScrollButton` are untouched and
  still work, and the command still has **no** hotkey. The `ViewMenuState`
  `syncScroll` field, added by issue #167 solely to feed that row, is removed
  along with the state that fed it (`src/App.tsx` ~line 5200) unless it has
  another reader.
- Because the menu row was issue #167's answer to "the state stays reachable
  when `showSyncScrollButton` hides the button", the copy around that setting
  is corrected rather than left contradictory: the `settings-sync-scroll-button`
  row's comment/label in `SettingsPanel.tsx` (~line 789) no longer promises a
  `View ▸ Sync Scrolling` route. Whether hiding the button now leaves sync
  scrolling unreachable is the owner's accepted consequence of "the toolbar
  icon … remains the one way to toggle it" — do **not** add a replacement
  route, and do not change `showSyncScrollButton`'s default.
- **The semantic-zoom trio is gone, unconditionally.** `buildViewItems`
  contains no `semanticZoomOut` / `semanticZoomIn` / `semanticZoomReset`
  rows and no separator that existed only to precede them, in **either**
  build and with `settings.semanticZoom` on **or** off — the `semanticZoom`
  branch in the builder goes away, and with it the `ViewMenuState.semanticZoom`
  field if nothing else reads it.
- The three accelerators are gone with them: the `SEMANTIC_ZOOM_KEYS` loop in
  the global key handler (`src/App.tsx` ~lines 450–453 and ~5894) is removed,
  so `Mod+Shift+-`, `Mod+Shift+=` and `Mod+Shift+0` fire nothing anywhere,
  with the experiment on or off. `SEMANTIC_ZOOM_COMBOS`
  (`src/lib/semanticZoom.ts` ~line 270) and the three `CommandId`s are either
  deleted or left with no reachable dispatch route; no unreferenced dead code
  is left behind (`.sandcastle/CODING_STANDARDS.md`).
- Semantic zoom itself still works on the builds where the experiment can be
  enabled, driven by its non-menu controls only: the docked
  `SemanticZoomControl` (`semantic-zoom-out` / `semantic-zoom-slider` /
  `semantic-zoom-in`), the zoomed view's **Full document** button
  (`semantic-zoom-full`) and heading dives. The two control tooltips in
  `src/components/SemanticZoomView.tsx` (~lines 48 and 69) no longer advertise
  the removed `Mod+Shift+-` / `Mod+Shift+=` accelerators.
- **Untouched, and demonstrably so:** `zoomIn` / `zoomOut` / `zoomReset`
  ("Zoom In" `Mod+=`, "Zoom Out" `Mod+-`, "Actual Size" `Mod+0`) keep their
  labels, accelerators and position, and every other View item — Only Open
  Files, Next/Previous Open File, Edit Mode, Split Edit, the Comments group,
  Changes Since Save, Go to Heading…, Word Count, Front Matter, Line Numbers,
  the mac Fullscreen tail — keeps its label, order, hotkey and gating. The
  File/Edit/Help menus are not touched.
- **Test sweep.** Every test that asserted a removed row, label or
  accelerator is amended rather than left red or silently deleted. At least:
  `tests/unit/menu-spec.test.ts` (U942's Sync Scrolling row ~line 195, the
  `toggleFolders` label ~line 405, the File Tabs ordering ~lines 590–609, the
  `SEMANTIC` block ~lines 546–567), `tests/unit/app-menu.test.ts` (the View
  command arrays ~lines 259–358 and the File Tabs absent-state case ~line
  320), `tests/e2e/shell-and-menus.spec.ts` (E214's row list ~lines 969–1002),
  `tests/e2e/file-tabs.spec.ts` (its View ▸ File Tabs helpers ~lines 29–43
  and the flows that use them), `tests/e2e/hosted.spec.ts` (E359 ~line 2895),
  `tests/e2e/web.spec.ts` (W16 ~lines 603–622), and
  `tests/e2e/semantic-zoom.spec.ts` (the `Control+Shift+…` presses at ~lines
  54, 115 and 586–588, which must drive the docked control instead — E229's
  "off means absent" check becomes "the accelerator does nothing on any
  build"). Grep `toggleFileTabs`, `toggleSyncScroll`, `semanticZoom(In|Out|Reset)`,
  `menu-view-`, `Sync Scrolling`, `Semantically` and `Shift+0` across `tests/`
  before declaring the sweep done.
- Positive coverage exists for the new state, not just deletions: unit
  assertions that View carries `Sidebar` with the live `toggleFolders`
  accelerator, that `buildViewItems` yields none of the four removed commands
  with `fileTabs` / `syncScroll` / `semanticZoom` supplied *and* absent, and
  an e2e assertion that the Settings → Appearance File Tabs checkbox hides
  and restores the strip and persists. New tests take the next free `U####` /
  `E###` ids (`scripts/validate.mjs` scans test-id uniqueness); if the net
  collected e2e count drops below `E2E_TEST_FLOOR` (currently 473 in
  `scripts/validate.mjs`), re-pin it with the usual changelog comment naming
  issue #258.
- **Docs and citations.** Every doc statement the change falsifies carries the
  repo's amendment idiom (`> **Amended (issue #258, 2026-09-06):** …`):
  `docs/specs/SPEC34.md` (~line 11 and §4.1, "toggled from **View → Folders**"),
  `prd/013-tabs-on-top.md` Req 13 (~line 127, the View menu item), and
  `prd/011-semantic-zoom-and-llm-providers.md` Req 23 (~line 195, "its own
  View menu entries … and its own accelerators"). `README.md` (~line 109,
  "⌘⇧E (or View → Folders)") is updated in place. Changed and new behaviour
  sites carry citation comments in the repo format naming the amended
  contract and this issue, e.g. `// SPEC34 §4.1 (issue #258): …`,
  `// PRD 013 Req 13 (issue #258): …`, `// PRD 011 Req 23 (issue #258): …`.
- `docs/MAP.md` matches what the generator derives — if citations moved,
  `npm run map` has been run and its output committed (the validation gate
  diffs it).
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or `npx playwright test -g '<title>'` for a single behaviour), and ran the
  full gate `npm run validate:quick` **once**, right before declaring the goal
  met — not after every change, and not as a baseline at the start. That run
  printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #258, naming what
  changed and quoting the `QUICK VALIDATION: ALL PASSED` line.

## Context

Everything menu-shaped funnels through one builder: `buildViewItems` in
`src/lib/menuSpec.ts` (~line 225) feeds both the native menu bar
(`buildMenuSpec`) and the in-app View ▸ flyout (`buildAppMenu` in
`src/lib/appMenu.ts`, which derives rows with testids `menu-view-<command>`),
so each of the four changes is one edit there, not two. `src/App.tsx` holds
the `ViewMenuState` it passes (~line 5198) and the command handlers
(`toggleFolders` ~4528, `toggleFileTabs` ~4546, `toggleSyncScroll` ~4676,
`semanticZoom*` ~4733); citation-grep into it — never read it end to end.

The optional-field idiom in `ViewMenuState` (`fileTabs?`, `syncScroll?`,
`semanticZoom?`) exists so a row is *absent*, not disabled, where its seam
does not exist; two of those three fields lose their only reader here, and
removing a field means fixing the fixtures at the top of
`tests/unit/menu-spec.test.ts` and `tests/unit/app-menu.test.ts`.

For the Settings relocation, `src/components/SettingsPanel.tsx` is the whole
dialog: `appearanceTab` starts ~line 618 (font size, zoom, themes, margins,
minimum pane width), and the `autoHideAvailable`-gated row ~line 757 is the
pattern for a platform-gated checkbox. The tab-strip seam is
`platform.multiFileSession` (`src/platform/types.ts` ~line 116; true on
tauri, hosted and the e2e browser shim, absent on the static web build).

Issue #247 (semantic zoom on web, LLM settings nesting) is open and touches
the same experiment, but per the owner's 2026-09-05 note this issue removes
the trio from the View menu on **both** builds regardless of how #247
proceeds — don't couple the two.

Read `.sandcastle/CODING_STANDARDS.md` before writing code, and
`docs/STYLE-GUIDE.md` before adding the Settings checkbox (use the existing
`checkbox-row` / `field` primitives and the shared `Button`, not new chrome).
