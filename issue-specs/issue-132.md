# Spec: TOC sidebar view: switchable pane, heading tree, click-to-navigate (#132)

## Goal

All acceptance criteria in issue-specs/issue-132.md are satisfied for issue
#132, with evidence visible in the session: the sidebar renders exactly one of
two mutually exclusive views (the unchanged Folders tree, or a new TOC view
built from `src/lib/tocModel.ts`), the TOC shows the active document's H1–H6
tree with expand/collapse and click-to-navigate in both view and edit modes, a
TOC button next to the folders button shows/hides the sidebar in that view,
`npm run validate:quick` passes in the implementer's session, and a summary
comment from the implementer exists on issue #132.

## Acceptance criteria

- **One pane, two views** (PRD 012 Req 1). The sidebar shows either the Folders
  tree (the existing SPEC34/SPEC36 `FolderPanel`, behaviour unchanged) or the
  TOC — never both, never side by side. Folder-tree state survives a round-trip
  through the TOC view: roots, per-directory expansion, the selected row and the
  only-open-files view are exactly what they were before switching away and
  back. The folder pane's slide, width (`settings.folderWidth`), divider drag
  and `settings.showFolders` visibility keep their current meaning, and
  `data-testid="folder-panel"` still means "the folders view is on screen"
  (it is absent while the TOC view shows).
- **Heading tree from the model** (PRD 012 Reqs 2, 3, 13). The TOC view renders
  every H1–H6 of the active document in document order, each entry indented
  under its nearest shallower heading, derived by `src/lib/tocModel.ts`
  (`buildTocTree` / `visibleTocEntries`, landed in #131) from
  `parseSections()` output — never by scraping rendered HTML or `data-mm-line`
  anchors. Consequences that must hold on screen: a `#` line inside a fenced
  code block is not an entry; content before the first heading produces no
  entry; two headings with identical text are two distinct rows and each
  navigates to its own occurrence (row identity is the `SectionNode` id, not
  the text).
- **Expand / collapse** (PRD 012 Req 4). An entry with children carries the same
  disclosure interaction as a folder row. Entries default to expanded; a
  collapsed entry hides its descendants and stays visible itself. Collapse state
  is per file and lives in memory for the app session only — switching to another
  open file and back keeps it, a reload/restart discards it, and no new
  persistence file (nothing like `foldertree.json`) is written or read. The
  collapse set is held by the owner and threaded through `tocModel.ts`
  (`toggleTocCollapsed`, `visibleTocEntries`); the component invents no rules.
- **Click to navigate, view mode** (PRD 012 Req 5). Clicking a TOC entry while
  in preview scrolls the document so that heading sits at the top of the
  viewport, through the one existing scroll path — `scrollPreviewToLine` in
  `src/App.tsx` (SPEC16 §4, the heading palette's). No second scroll
  implementation is added.
- **Click to navigate, edit mode** (PRD 012 Req 6). Clicking a TOC entry while
  in edit mode scrolls the editor to the heading's source line **and** places
  the cursor on that line. Today `EditorSyncHandle.scrollToLine` only scrolls;
  the caret move is new work on that seam (extend the handle or add a sibling
  method) and must not change what existing `scrollToLine` callers do. In split
  edit the same click works from the editor pane.
- **Live re-derivation and empty state** (PRD 012 Req 8). While editing, the TOC
  re-derives from the buffer on a debounce (the SPEC16 §2 / SPEC30 §1.2 debounce
  idiom already in `App.tsx`), so a heading typed, renamed or deleted appears or
  disappears without saving. Typing is not made janky: the parse does not run
  synchronously on every keystroke. A document with no headings shows an
  empty-state message in the TOC view (its own `data-testid`), not a blank pane.
- **The buttons** (PRD 012 Req 9). A TOC button sits next to the existing
  folders affordance. Pressing it shows the sidebar in TOC view, opening the
  sidebar if it was hidden; pressing it while the TOC view is already showing
  hides the sidebar. The folders affordance behaves symmetrically for its view:
  pressing it while the TOC shows switches the sidebar to Folders; pressing it
  while Folders shows hides the sidebar. Each button indicates when its view is
  the one on screen (an `aria-pressed` / `data-*` state a test can assert), and
  each carries a `title` and `aria-label`. The folders route keeps its existing
  seams: the View-menu `toggleFolders` checkbox and `Mod+Shift+E` still reflect
  and drive sidebar visibility for the folders view exactly as they do today.
- **Existing test ids and assertions survive.** `folder-expand` keeps its
  current id, labels and visibility contract (present only while the sidebar is
  hidden, on the folder seam) — no existing e2e assertion about it, about
  `folder-panel`, or about the `toggleFolders` menu checkbox is weakened,
  renumbered, deleted or skipped. New buttons ship new `data-testid`s.
- **Platform and workspace independence** (PRD 012 Req 12). The TOC view depends
  only on an open document, never on `folderSeam` (`readDirEntries` +
  `openFolderDialog` + `appMode === 'workspace'`): it renders in `file` mode
  with no folder root open and in the web build, where the folders view and its
  DOM stay absent. With no document open (splash) there is no TOC pane. The
  folders view's existing gating is untouched.
- **The component is a pure view.** The TOC lives in a component in the
  `src/components/FolderPanel.tsx` mold — props in, callbacks out, no
  `@tauri-apps/*`, no platform access, no `console.*` — with tree derivation,
  visibility, collapse and ancestor logic delegated to `src/lib/tocModel.ts`.
  Any genuinely new pure rule goes into `tocModel.ts` with unit tests, not into
  the component. Styling reuses the existing sidebar/`.folder-*` treatment so
  the two views look like one pane.
- **Out of scope** (do not implement here): PRD 012 Req 7 (active-section
  highlight following the viewport, and its auto-reveal) is issue #133;
  Reqs 10–11 (the `toggleToc` hotkey and persisting which view the sidebar last
  showed) are issue #134. In this issue the current view is session state, not a
  persisted setting, and no new hotkey or `HotkeyMap` entry lands.
- **Tests.** New desktop e2e coverage lives in `tests/e2e/` (a new
  `tests/e2e/toc.spec.ts` is fine), driven by `getByTestId` and set up through
  `fixtures.ts` / `helpers.ts` (`freshApp`, `fsWrite`, …), covering at least:
  switching views without losing folder state; the heading tree's shape and
  indentation including a fenced-code-block `#` line that must not appear;
  duplicate heading text as two rows navigating to different places; collapse
  and re-expand; click-to-navigate in preview and in edit (cursor line asserted);
  live re-derivation while typing; the empty-state message; and the button
  show/switch/hide cycle with its active indication. Titles start with `E<n>:`
  taking the next unused numbers (E248 is the current highest, so start at
  E249); any new unit tests for `tocModel.ts` additions go in
  `tests/unit/toc-model.test.ts` starting at U666. Numbers are never reused, and
  no existing test is weakened, deleted, renumbered or marked
  `.skip`/`.only`/`.fixme`.
- **Citations.** New or changed behaviour carries a citation comment in the
  `PRD 012 Req <n>: <what and why>` form already used by `src/lib/tocModel.ts`
  and `src/lib/sectionModel.ts`, per `.sandcastle/CODING_STANDARDS.md` and
  `docs/COMMENT-FORMAT.md`. If any `SPEC<n>` citation is added or removed,
  `npm run map` has been run and the regenerated `docs/MAP.md` is committed.
- **Test economy.** Iteration during the attempt uses `npm run typecheck` and
  `npm run test:unit` (or tests targeted at the changed code, e.g.
  `npx playwright test -g '<title>'` for a single e2e). `npm run validate:quick`
  is run **once**, right before declaring the goal met — not after every change,
  and not as a start-of-attempt baseline (baseline with the quick tier only) —
  and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #132, naming the files
  touched, the E/U numbers added, and the `validate:quick` result.

## Context

- **PRD:** `prd/012-table-of-contents.md` (on this branch). This issue is Reqs
  1–6, 8, 9, 12, 13-for-the-view; Req 7 → #133, Reqs 10–11 → #134. Non-goals
  worth re-reading: no depth setting, no insert-TOC command, no filter box, no
  multi-file TOC, no new persistence file, no side-by-side panes.
- **The model already exists** (#131, merged): `src/lib/tocModel.ts` exports
  `TocEntry`, `VisibleTocEntry`, `buildTocTree(doc)`, `flattenToc`,
  `findTocEntry`, `tocAncestorIds`, `toggleTocCollapsed`, `expandTocAncestors`,
  `visibleTocEntries` and `activeTocEntryId`, with tests in
  `tests/unit/toc-model.test.ts`. Feed it `parseSections(canonicalOf(buffer))`
  from `src/lib/sectionModel.ts` — `App.tsx:3950` (`zoomSections`) is the
  existing memoized example of exactly that call.
- **Where the sidebar is wired:** `src/App.tsx` — `folderSeam` (~:5606),
  `folderSlide` / `slideMounted` (~:5613), the `<FolderPanel …>` render inside
  `.body-row` (~:5700), the `FolderExpandButton` (~:5790), and the
  `toggleFolders` command (~:3709) plus its `Mod+Shift+E` binding (~:4714).
  `src/components/FolderPanel.tsx` (769 lines) holds the panel, the row/twisty
  markup to mirror, and the edge-tab pattern (`FolderExpandButton`,
  `PreviewToggleButton`, `ModeSwitchButton` — the issue #125 two-segment button
  is the closest model for a view indicator). Styling lives under `.folder-*`
  in `src/styles.css` (from ~:1905).
- **Navigation seams:** `scrollPreviewToLine` (`src/App.tsx:3526`, SPEC16 §4)
  is the preview path — the heading palette's `onJump` at ~:6111 shows both
  branches, including the `pendingScrollLineRef` reset the edit branch needs.
  `EditorSyncHandle.scrollToLine` is implemented in
  `src/components/Editor.tsx:1231` and only scrolls; the caret placement Req 6
  asks for is the new bit.
- **Grep first, don't read `App.tsx` whole** (CLAUDE.md): `rg 'SPEC34' src`,
  `rg 'SPEC16' src`, `rg 'PRD 012' src` land on the exact functions.
  `docs/MAP.md` maps specs → files and E-numbered tests.
- Commands: `npm run typecheck`, `npm run test:unit`, `npx playwright test -g
  '<title>'` for one e2e, and `npm run validate:quick` as the single end-of-work
  gate (the full `npm run validate` — which is what runs the web e2e suite — is
  release evidence and is not required here).
