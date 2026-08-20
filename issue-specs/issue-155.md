# Spec: searchAllFiles hotkey (Mod+Shift+F) (#155)

## Goal

All acceptance criteria in issue-specs/issue-155.md are satisfied for issue
#155, with evidence visible in the session: a `searchAllFiles` hotkey
(default `Mod+Shift+F`) is a standard, remappable row of the hotkeys map that
dispatches the same `toggleSearch` command as the Search toolbar button —
opening/switching the sidebar to Search with the query box focused, hiding it
when Search is already showing — `Mod+F`, `Mod+Shift+E` and `Mod+Shift+T`
keep their existing meanings, unit and e2e coverage exercise the toggle, and
`npm run validate:quick` passes.

## Acceptance criteria

- (PRD 014 Req 3) `HotkeyMap` in `src/lib/hotkeys.ts` has a `searchAllFiles`
  entry and `DEFAULT_HOTKEYS.searchAllFiles` is `'Mod+Shift+F'`. It is an
  ordinary row of the map: `parseSettings('{}')` yields the default, a
  settings file written before this issue gains it without disturbing the
  bindings already stored, a rebind round-trips through
  `serializeSettings`/`parseSettings`, and a blank or non-string stored value
  falls back to the default — exactly the `toggleToc` behaviour asserted in
  `tests/unit/settings.test.ts` (U671).
- (PRD 014 Req 3) `HOTKEY_LABELS` in `src/components/SettingsPanel.tsx` gains
  a row for `searchAllFiles` with a label in the file's voice (e.g. "Search
  all files"), so the binding is listed, rebindable, reset-to-default and
  conflict-checked in Settings → Hotkeys by the existing generic machinery —
  no per-row special casing added.
- (PRD 014 Req 3) The global hotkey listener in `src/App.tsx` matches
  `hk.searchAllFiles` with the same `eventMatches(e, hk.<action>)` shape as
  the branches around it and dispatches the existing `toggleSearch` command id
  with the `'hotkey'` source — no second copy of the show/hide/focus logic.
  A rebind in Settings therefore moves the hotkey with no code change, and the
  command's existing gates (folder seam present, a workspace open) apply to
  the hotkey unchanged.
- (PRD 014 Req 3) The hotkey performs exactly the Search toolbar button's
  action from #151: with the sidebar hidden it opens it in Search view with
  the query box (`search-input`) focused; with the sidebar showing Folders or
  TOC it switches the pane to Search in place, focuses the query box, and
  loses no folder-tree or TOC state; with Search already showing it hides the
  sidebar — including when focus is inside the query box, since the listener
  runs in the capture phase.
- (PRD 014 Req 3) No shipped binding changes meaning: `find` stays `Mod+F`,
  `toggleFolders` stays `Mod+Shift+E`, `toggleToc` stays `Mod+Shift+T`, and no
  two entries of `DEFAULT_HOTKEYS` collide as chords — asserted with
  `combosConflict` over every pair (the U672 pattern), with `searchAllFiles`
  in the set. `Mod+F` must not fire the Search view and `Mod+Shift+F` must not
  fire the in-document find bar.
- (PRD 014 Req 3) Where the Search view cannot exist — no folder seam, or no
  workspace/folder root open — the hotkey is inert: nothing opens and no
  settings write happens (`showFolders` / `sidebarView` unchanged in the
  stored settings), the inertness E258 asserts for `toggleToc`.
- Unit coverage in `tests/unit/` (new `U<n>` numbers above the current
  highest, `U701`) covers the default, the merge into an older settings file,
  the rebind round-trip, the invalid-value fallback, and the all-pairs
  conflict check.
- E2e coverage in `tests/e2e/search.spec.ts` (new `E<n>` numbers above the
  current highest, `E279`; `seedFolders` / `openFolderRoot` in
  `tests/e2e/helpers.ts` give the tree) exercises the hotkey's toggle
  behaviour: hidden → opens Search with the query box focused, showing Search
  → hides, switching in place from the Folders view, and the inert case with
  no folder root open. Follow `E258`/`E259` in `tests/e2e/toc.spec.ts` as the
  model, including the SPEC12 §1.3 exactly-once window when a click and a
  keypress dispatch the same command id.
- New and changed code carries citation comments in the repo's format
  (`PRD 014 Req 3: …`), per `.sandcastle/CODING_STANDARDS.md` and
  `docs/COMMENT-FORMAT.md`. If any `SPEC<n>` citation is added or moved,
  `docs/MAP.md` is regenerated with `npm run map` and committed.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or targeted tests such as `npx playwright test -g '<title>'`) and ran the
  full quick gate `npm run validate:quick` ONCE at the end — not after every
  change and not as a starting baseline — and it printed
  `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #155 describing what
  landed and the gate evidence.

## Context

- Blocker #151 is merged: the Search view, its `SidebarViewSwitch` button and
  the `toggleSearch` command already exist. `toggleSearch` in `src/App.tsx`
  (~line 3969) is the whole action — seam/workspace gate, `showSidebarView('search')`,
  and the `setSearchFocusTick` bump that focuses the query box when the press
  is not a hide. This issue only adds a second surface that dispatches it.
- The pattern to copy end-to-end is `toggleToc` (PRD 012 Req 10): grep
  `toggleToc` across `src/lib/hotkeys.ts`, `src/components/SettingsPanel.tsx`,
  `src/App.tsx` (the keydown `else if` chain, ~line 5160) and
  `tests/unit/settings.test.ts` / `tests/e2e/toc.spec.ts`. Four small edits
  plus tests; do not read `App.tsx` whole.
- `eventMatches` compares Shift strictly, so `Mod+F` and `Mod+Shift+F` cannot
  cross-fire; `eventKey` resolves shifted letters through `KeyboardEvent.code`,
  so the e2e press is `Control+Shift+F`.
- There is no View-menu row for the TOC or Search views (`src/lib/menuSpec.ts`
  lists only Folders), so no menu work is in scope here.
- The e2e suite is slow and serialized — debug single tests with
  `npx playwright test -g '<title>'` and run `npm run validate:quick` once at
  the end.
