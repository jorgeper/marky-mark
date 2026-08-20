# Spec: Tabs on top: close affordances — dirty ●/✕ swap, middle-click, context menu (#145)

## Goal

All acceptance criteria in issue-specs/issue-145.md are satisfied for issue
#145, with evidence visible in the session: every file tab in the strip carries
the SPEC36 trailing slot — a dirty ● that swaps for a ✕ on tab hover — whose ✕
closes through the existing SPEC36 §3.4–3.5 path (clean ⇒ remove; dirty ⇒
activate then the Save / Don't Save / Cancel modal; the active tab's close
activates `closeOpen(...).nextActive`; the last close lands on the splash)
without the ✕'s pointer events activating the tab, middle-click on a tab closes
it through that same path, right-click opens a tab context menu with **Close**,
**Close Others** and **Close All** that closes one file at a time through that
path with Cancel stopping the remaining sequence, new e2e coverage from E272
exists, `npm run validate:quick` has been run in the implementer's session and
passes, and a summary comment from the implementer exists on issue #145.

## Acceptance criteria

### The trailing slot: dirty ● / hover ✕ (PRD 013 Req 5)

- Each open-set tab in `src/components/FileTabStrip.tsx` carries a trailing
  slot in the SPEC36 §3.4/§3.6 mold: a ● when that file's buffer is dirty —
  **active or parked**, read from the `dirtyOpenFiles` set App already computes
  (`src/App.tsx` ~line 715) and already passes to `FolderPanel` as
  `dirtyFiles` — swapped for a ✕ while the pointer is over the tab. A clean,
  unhovered tab shows neither.
- The slot reserves its own width so the label does not reflow or re-clip when
  ● and ✕ swap, and the tab's max-width / ellipsis behaviour from #144 (E268)
  stays green: a long basename still clips inside the bounded tab, now with the
  slot accounted for.
- The ✕ is **not** a nested `<button>` — the tab itself is one (#144). Follow
  the SPEC36 §3.4 idiom the sidebar uses: a `span[role="button"]` with a
  `title` and its own stable `data-testid`, distinct from the sidebar's
  `folder-tab-close` / `folder-dirty` ids (which are never renamed and whose
  existing e2e locators must not start matching two elements). Same for the ●.
- The ✕'s pointer events do not activate the tab: `pointerdown` and `click` are
  stopped so a close on an INACTIVE tab does not first switch to it (dirty
  files still activate, but through the §3.4 close path below, not through the
  tab's activation handler). Clicking the ✕ on the active tab does not
  re-activate or re-read it.
- Closing routes through App's existing `closeOpenFile` (`src/App.tsx` ~2134) —
  the very callback `FolderPanel`'s row ✕ gets (`onCloseFile`). No second close
  path, no duplicated dirty check, no new copy of `finishCloseFile`. The
  observable consequences, unchanged:
  - clean file ⇒ removed from the open set immediately, no modal;
  - dirty file ⇒ it is **activated first** (visible behind the modal), then the
    existing unsaved-changes modal (`data-testid="open-prompt"`) names it —
    Save ⇒ save then close, Don't Save ⇒ close, Cancel ⇒ the file stays open,
    active and dirty;
  - closing the ACTIVE file activates `closeOpen(...).nextActive` (SPEC36 §3.5);
  - closing the last open file lands on the splash;
  - closing an inactive file leaves the active file, its buffer, scroll, undo
    history and mode untouched.

### Middle-click (PRD 013 Req 6)

- A middle-click (`button === 1`) anywhere on a tab closes it through exactly
  the same call the ✕ makes — clean removes, dirty activates and prompts, the
  active tab hands off to `nextActive`, the last one lands on the splash.
- Middle-click never activates the tab as a side effect, and never triggers the
  browser/webview middle-click autoscroll or paste (suppress the default on the
  middle `mousedown`/`auxclick`, not only on the click).
- A left click keeps its #144 behaviour exactly (activate an inactive tab;
  no-op on the active one), and a right click never closes.

### The tab context menu (PRD 013 Req 7)

- Right-click (`contextmenu`) on a tab opens a menu with exactly three items in
  this order: **Close**, **Close Others**, **Close All**. The OS/webview's own
  context menu does not appear (`preventDefault`), and the right-click does not
  activate the tab.
- The menu follows the SPEC35 §3.2 idiom the folder tree already implements
  (`src/components/FolderPanel.tsx:551–580`): positioned at the pointer and
  clamped to the viewport, dismissed by Escape, any outside pointer-down,
  scroll or resize, and by choosing an item. It carries a stable
  `data-testid` for the menu and one per item (distinct from the
  `folder-menu*` ids).
- **Close** on the right-clicked tab is identical to that tab's ✕.
- **Close Others** closes every other open-set file, one at a time, through the
  ✕ path, in a deterministic order (the strip's tree order). Each clean file
  goes immediately; each dirty file is activated and prompts in turn (Save /
  Don't Save / Cancel), and the next file's turn only begins once the previous
  prompt resolves. On completion the right-clicked file is the only open file
  and is the active one.
- **Close All** closes every open-set file the same way, ending on the splash
  (SPEC4 clean start) with an empty open set and the tree selection cleared.
- **Cancel stops the remaining sequence**: files already closed stay closed,
  the file whose prompt was cancelled stays open, active and dirty, and every
  file after it in the sequence stays open, still parked, still dirty where it
  was. No further prompt appears until the user asks again.
- The sequence is driven by real modal resolutions, not by fire-and-forget
  calls: exactly ONE unsaved-changes modal is on screen at a time. The existing
  queue-walk precedent is `quitQueueRef` / `processQuitWalk` (`src/App.tsx`
  ~3428) — reuse or mirror it rather than inventing a third walk, and cite
  whichever choice is made. `Save` inside the sequence uses the existing
  `saveDoc` path, and a cancelled Save As aborts that file's close and the
  remaining sequence exactly as Cancel does (SPEC22 §2.3).
- The menu operates on the SPEC36 open set only. With an untitled buffer also
  open, Close All closes the open-set files and leaves the untitled buffer
  alone.

### Scope boundaries

- **Out of scope — do not implement:** the untitled tab's own ✕, dirty ● and
  dirty-untitled guard, and the Save-As replacement (issue #146) — the untitled
  tab keeps the inert appearance #144 gave it, with no close affordance and no
  context menu; overflow arrows, wheel scrolling and scroll-active-into-view
  (issue #147); the plane/shadow visual treatment mirroring the sidebar (issue
  #148); the final e2e sweep (issue #149).
- The sidebar's open rows, `openFiles.ts`, `closeOpen`, `commitOpenSet`,
  `finishCloseFile`, `closeOpenFile`, the quit walk, Close Workspace, only-open
  mode, dirty tracking, the file watcher, `remapOpen` / `pruneOpen` and open-set
  persistence keep their current behaviour; existing e2e assertions about them
  stay green without being weakened. If `closeOpenFile` / `processQuitWalk` are
  refactored to be reusable, the sidebar ✕ and the quit walk still behave
  identically and their tests still pass unchanged.
- The strip stays desktop-only behind the `tabStripSeam` capability gate
  (`src/App.tsx` ~5971) and no `tests/e2e/web.spec.ts` W test changes.
- The strip remains a pure view with props in and callbacks out, no new state
  of record beyond transient menu/hover UI state, no `@tauri-apps/*` and no
  `console.*` in `src/`; any genuinely new pure rule (e.g. the menu item model,
  or the "others" ordering) lands in a `src/lib/` module with unit tests, not
  inside the component.
- The strip and its menu are chrome: hidden in `@media print`, absent from
  exported HTML (`src/lib/exportDoc.ts`) and from `getDocText()` anchoring.

### Tests, citations, economy

- New desktop-shim e2e coverage lands in `tests/e2e/file-tabs.spec.ts`, driven
  by `getByTestId` through `fixtures.ts` / `helpers.ts`, covering at least: the
  dirty ● on an active and on a parked dirty tab and its hover swap to ✕; ✕ on
  a clean inactive tab (removed, active file untouched, no modal); ✕ on the
  active tab (`nextActive` activates) and on the last open file (splash); ✕ on
  a dirty parked tab (it activates, the modal names it, Cancel keeps it open
  and dirty, Don't Save closes it, Save writes then closes); middle-click close
  on a clean and on a dirty tab; the context menu's three items, its dismissal,
  and Close; Close Others with a dirty file in the set where Cancel stops the
  remaining sequence (assert exactly which files are still open afterwards);
  and Close All reaching the splash.
- Test titles start with `E<n>:` taking the next unused numbers — E271 is the
  current highest, so start at **E272**; new unit tests take **U696** onward
  (U695 is the current highest). Numbers are never reused, and no existing test
  is weakened, deleted, renumbered or marked `.skip` / `.only` / `.fixme`.
- New or changed behaviour carries a citation comment in the
  `PRD 013 Req <n>: <what and why>` form (per `.sandcastle/CODING_STANDARDS.md`
  and `docs/COMMENT-FORMAT.md`), cross-referencing `SPEC36 §3.4`–`§3.6` and
  `SPEC35 §3.2` where it rides those contracts. If any `SPEC<n>` citation is
  added or removed, `npm run map` has been run and the regenerated
  `docs/MAP.md` is committed (validate:quick checks MAP is up to date).
- **Test economy.** Iteration during the attempt uses `npm run typecheck` and
  `npm run test:unit` (or tests targeted at the changed code, e.g.
  `npx playwright test -g '<title>'` for a single e2e). `npm run validate:quick`
  is run **once**, right before declaring the goal met — not after every change,
  and not as a start-of-attempt baseline (baseline with the quick tier only) —
  and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #145, naming the files
  touched, the E/U numbers added, and the `validate:quick` result.

## Context

Parent issue #139, PRD `prd/013-tabs-on-top.md` (this issue is Req 5–7;
sibling #144 shipped the strip itself and is merged on this branch, #146–#149
take the untitled tab, overflow, the visual treatment and the e2e sweep). The
open-set contract is SPEC36 (`docs/specs/SPEC36.md` §3.4–§3.6 for the close
affordance, the dirty marker and `nextActive`); the context-menu contract is
SPEC35 §3.2. Citation-grep `SPEC36` / `PRD 013` rather than reading `App.tsx`
end to end.

Key sites: `src/components/FileTabStrip.tsx` (the whole component — ~85 lines,
its `Tab` sub-component is where the slot, middle-click and `onContextMenu`
belong), `src/components/FolderPanel.tsx` (the sidebar's `folder-tab-slot` /
`folder-dirty` / `folder-tab-close` row markup ~line 430–465, and the context
menu state, viewport clamp and dismissal ~519–580 / render ~768–800),
`src/App.tsx` (`dirtyOpenFiles` ~715, `finishCloseFile` ~2120, `closeOpenFile`
~2134, `dirtyDocsQueue` ~2177, `finishCloseFiles` ~2881, `processQuitWalk`
~3428, the `openPrompt` modal ~6705, the `FolderPanel` props block ~6117, the
`FileTabStrip` render ~6249, `tabStripSeam` / `showFileTabs` ~5971),
`src/lib/openFiles.ts` (`closeOpen`, `treeOrderCompare`), `src/lib/folderOps.ts`
(`folderContextMenu` — the model-in-lib pattern for a menu's item list),
`src/styles.css` (`.file-tab*` ~2226–2290, the sidebar slot `.folder-tab-slot`
/ `.folder-dirty` / `.folder-tab-close` ~2474–2515, `.theme-menu`/`.folder-menu`
for menu chrome), `tests/e2e/file-tabs.spec.ts` (E266–E271, the helpers to
extend).
