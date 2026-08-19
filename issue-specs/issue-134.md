# Spec: toggleToc hotkey and persisted last sidebar view (#134)

## Goal

All acceptance criteria in issue-specs/issue-134.md are satisfied for issue
#134, with evidence visible in the session: a `toggleToc` hotkey (default
`Mod+Shift+T`) is a standard, remappable entry in the hotkeys map that performs
exactly the TOC toolbar button's action, the sidebar's last view (folders or
TOC) is a persisted setting the app reopens in after a restart, unit + new
E-numbered e2e tests cover both, `npm run validate:quick` passes, and a summary
comment from the implementer exists on issue #134.

## Acceptance criteria

- `toggleToc` is a key of `HotkeyMap` in `src/lib/hotkeys.ts` with default
  `Mod+Shift+T` in `DEFAULT_HOTKEYS`, and that default collides with no other
  shipped default binding (PRD 012 Req 10).
- The new binding rides the existing hotkeys machinery with no special-casing:
  it has a label in `HOTKEY_LABELS` (`src/components/SettingsPanel.tsx`) so it
  is listed, rebindable and reset-to-default in Settings; it is
  conflict-checked against other bindings by the same code path as every other
  row; and it persists through the existing `settings.hotkeys` sanitiser
  (an absent or invalid stored value falls back to the default).
- Pressing the hotkey performs exactly the action of the TOC toolbar button
  from #132 — it goes through the same one view rule (`showSidebarView('toc')`
  / `toggleTocView` in `src/App.tsx`), not a second copy of the logic:
  - sidebar hidden → the sidebar opens showing the TOC;
  - sidebar showing folders → the pane switches to the TOC and stays put
    (no slide, no width change);
  - sidebar already showing the TOC → the sidebar hides.
- The hotkey is inert when no document is open — the state in which the TOC
  toolbar button does not exist (PRD 012 Req 12: it never consults the folder
  seam, so it works with no folder root open and on web).
- `Mod+Shift+E` / `toggleFolders` keeps its existing meaning and gating
  (platform seam + workspace mode) unchanged.
- Which view the sidebar last showed is a persisted setting (a new field on
  `Settings` in `src/lib/settings.ts`, default `'folders'`) with: a sanitiser
  that accepts only the two known views and falls back to `'folders'` for
  anything else, and a scope letter consistent with the sidebar's other
  machine-scoped keys (`showFolders`, `folderWidth` are `'M'`) (PRD 012 Req 11).
- On restart the sidebar reopens in the persisted view: with the setting at
  `toc` and `showFolders` true, a reload shows the TOC view rather than the
  folder tree; with it at `folders` the existing behaviour is unchanged.
- `showFolders` and `folderWidth` keep their existing SPEC34 persistence
  untouched, no new persistence file is written (the setting lives in the
  existing settings store), and TOC collapse state stays session-only —
  discarded on restart as #132 left it.
- Behaviour that #132 established still holds: opening a folder route puts the
  sidebar in the folders view, and folder-tree state (roots, expansion,
  selection) survives a round trip through the TOC view.
- Unit tests in `tests/unit/` cover the hotkey and settings changes: the new
  default binding, defaults having no duplicate combos, and the new setting's
  default + sanitiser (unknown/garbage value → `'folders'`).
- E2E tests in `tests/e2e/toc.spec.ts` (new `E<n>` numbers continuing from the
  current maximum, E254) cover the hotkey's three outcomes above and the
  restart-in-the-last-view behaviour.
- Touched code carries `PRD 012 Req 10` / `Req 11` citation comments in the
  house format (`docs/COMMENT-FORMAT.md`, `.sandcastle/CODING_STANDARDS.md`);
  if any `SPEC<n>` citation moved to a new file, `docs/MAP.md` is regenerated
  with `npm run map` and committed.
- Iteration used `npm run typecheck` and `npm run test:unit` (or targeted tests,
  e.g. `npx playwright test -g 'E255'`); the full gate was NOT run as a
  baseline or after every change.
- `npm run validate:quick` has been run once in the implementer's session,
  right before declaring the goal met, and printed
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #134.

## Context

The sidebar's two views landed in #132: `src/App.tsx` holds
`sidebarView` (React state, `useState<SidebarView>('folders')` near line 523),
the shared rule `showSidebarView` (~line 3392) with its `toggleTocView`
wrapper, the `toggleFolders` command entry (~line 3812), the keydown chain
(~line 4890, where `eventMatches(e, hk.toggleFolders)` dispatches), and
`sidebarShown` / `sidebarSwitch` (~line 5796). `SidebarViewSwitch` and
`TocPanel` live in `src/components/TocPanel.tsx`, which also exports
`SidebarView`; the TOC button renders only when a document is open, which is
the gate the hotkey should match.

Making the view persistent means moving it from component state to
`src/lib/settings.ts` (field declaration ~line 81, defaults ~line 158, scope
letters ~line 223, sanitisers ~line 320 — follow `showFolders`/`folderWidth`
in all four) and seeding/writing it through the existing `updateSettings`
path. `src/lib/hotkeys.ts` (map + defaults) and `HOTKEY_LABELS` in
`src/components/SettingsPanel.tsx` are typed against each other, so the
compiler names anything missed.

Adding a View-menu row for the TOC is **out of scope** — the PRD gives the
feature a toolbar button and a hotkey, and `src/lib/menuSpec.ts` /
`src/lib/appMenu.ts` carry exhaustive command lists asserted in
`tests/unit/menu-spec.test.ts` and `tests/unit/app-menu.test.ts`. Whether the
hotkey needs its own `CommandId` in `src/lib/commands.ts` or can call
`toggleTocView` directly is the implementer's call; if a command id is added,
those menu tests must stay green.

E2E patterns worth copying: `tests/e2e/toc.spec.ts` (E249–E254) for the
sidebar switch and its test ids (`sidebar-view-toc`, `sidebar-view-folders`),
and `tests/e2e/folder-tree.spec.ts` for the `page.reload()` restart shape.
