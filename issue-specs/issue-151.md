# Spec: Search sidebar view: switchable pane, folder-wide scan, grouped results, click-to-open (#151)

## Goal

All acceptance criteria in issue-specs/issue-151.md are satisfied for issue
#151, with evidence visible in the session: the sidebar has a third,
mutually exclusive **Search** view reachable from a button beside Folders and
TOC, a query scans every markdown file in the folder tree (unsaved buffers
included) and shows results grouped by file with per-file counts and
highlighted line context, clicking a result opens the file at the match
without losing the result list, and `npm run validate:quick` passes.

## Acceptance criteria

- (PRD 014 Req 1) `SidebarView` in `src/lib/settings.ts` includes a `search`
  value, its settings validator accepts and persists it, and the sidebar
  renders exactly one view at a time: switching to Search and back leaves the
  folder tree's roots, expansion and selection intact and the TOC's state
  intact (nothing is re-fetched or reset by the round trip).
- (PRD 014 Req 2) `SidebarViewSwitch` (`src/components/TocPanel.tsx`) has a
  third, Search button beside the folders and TOC buttons, carrying the same
  `aria-pressed` / `data-active` / title semantics as the existing two and its
  own stable `data-testid`. Pressing it while the sidebar is hidden or showing
  another view puts the sidebar in Search view (opening it if hidden) and the
  query box has focus; pressing it while Search is showing hides the sidebar.
  The button reflects when Search is the view on screen. It goes through the
  same `showSidebarView` path in `src/App.tsx` that Folders and TOC use, so
  the slide behaviour and the single settings write are unchanged.
- (PRD 014 Req 4) With a query entered, the scope scanned is the markdown
  files visible in the folder tree — every open root, recursively, with
  dotfiles and dot-directories excluded and non-markdown files (binaries,
  images, sidecars) never read — using the existing seams
  (`platform.readDirEntries` / `platform.readTextFile` in
  `src/platform/types.ts`) and the existing predicates (`visibleEntries`,
  `isMarkdownFile` in `src/lib/folderTree.ts`), so it works on desktop, the
  browser virtual fs and hosted workspaces alike. An unreadable file or
  directory is skipped rather than failing the whole scan.
- (PRD 014 Req 4) With no folder root open, the Search view states that
  plainly in the panel (a message the e2e test can assert) instead of
  rendering an empty result list.
- (PRD 014 Req 5) A file that is open with unsaved edits is searched in its
  in-memory content — the active document's buffer, and a parked open file's
  parked buffer (see `parkedDirty` / the park map in `src/App.tsx`) — not its
  stale on-disk text: an edit made but not saved is findable, and text deleted
  but not yet saved is not.
- (PRD 014 Req 7) Results update live as the user types, debounced rather than
  scanning on every keystroke, and are grouped by file: filename matches list
  before content matches (the order `groupResults` already returns), each file
  group showing its file name and its match count, and each match row showing
  its line's text with the hit visually highlighted in context. A file group
  collapses and expands with the same disclosure interaction the folder rows
  use, and its collapsed/expanded state survives while the query is unchanged.
- (PRD 014 Req 8) Clicking a content match opens that file and lands on the
  match — scrolled to and highlighted in the pane it opens in (edit mode via
  the editor handle's `goToLine`-style path, preview via the preview scroll
  path, as `jumpToTocEntry` in `src/App.tsx` already distinguishes) — and
  clicking a filename match opens the file. In both cases the Search view
  still shows the same query and the same results afterwards; the results
  change only when the user changes the query.
- All query compilation, match extraction and grouping come from
  `src/lib/searchCore.ts` (#150) — `compileQuery`, `findMatches`/`searchFile`,
  `groupResults`/`searchFiles`. The panel is a view in the
  `src/components/FolderPanel.tsx` / `TocPanel.tsx` mold (header with the view
  switch, width divider, close button) and contains no matching logic of its
  own. The query runs with the module's default options
  (`caseSensitive: false, wholeWord: false, regex: false`).
- Out of scope, left to their own issues: the option toggles and the
  invalid-regex surface (#152), the match totals, loud no-results state and
  scanning indicator (#153), and the `searchAllFiles` hotkey (#155). Whatever
  scan plumbing lands here is shaped so those can be added without a rewrite,
  but no criterion above depends on them.
- New e2e coverage in `tests/e2e/` (new `E<n>` numbers above the current
  highest, `E271`; `seedFolders` / `openFolderRoot` in `tests/e2e/helpers.ts`
  give the multi-file tree) exercises: a multi-file search showing grouped
  results, click-to-open on a content match landing at the match, and
  click-to-open on a filename match. Any pure state added alongside the panel
  (e.g. group collapse, debounce/scan input building) is unit-tested under
  `tests/unit/`.
- New and changed code carries citation comments in the repo's format
  (`PRD 014 Req <n>: …` as `src/lib/searchCore.ts` already does), per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`. If any
  `SPEC<n>` citation is added or moved, `docs/MAP.md` is regenerated with
  `npm run map` and committed.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or targeted tests such as `npx playwright test -g '<title>'`) and ran the
  full quick gate `npm run validate:quick` ONCE at the end — not after every
  change and not as a starting baseline — and it printed
  `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #151 describing what
  landed and the gate evidence.

## Context

- Blocker #150 is merged: `src/lib/searchCore.ts` holds the pure search core
  (`compileQuery`, `findMatches`, `searchFile`, `groupResults`, `searchFiles`,
  types `SearchOptions` / `SearchFile` / `LineMatch` / `FileSearchResult` /
  `SearchResults`). Its unit tests live beside the other `tests/unit/` specs.
  Read it first — it decides line numbering, highlight offsets and group order.
- The mutually-exclusive-views pattern is PRD 012: `SidebarView` and its
  validator in `src/lib/settings.ts` (lines ~17, ~97, ~179, ~357),
  `SidebarViewSwitch` in `src/components/TocPanel.tsx`, and in `src/App.tsx`
  the `showSidebarView` callback, `sidebarShown` / `sidebarMounted`, the
  `sidebarSwitch` element and the two `sidebarView === '…'` render blocks in
  the `body-row`. Grep `PRD 012` and `sidebarView` rather than reading
  `App.tsx` whole.
- Folder scope helpers: `visibleEntries` and `isMarkdownFile` in
  `src/lib/folderTree.ts`; roots live in `folderRoots`, the seam checks are the
  existing `platform.readDirEntries` guards. Opening a file goes through
  `openDocGuarded(platform, path)`; landing on a line follows the
  `jumpToTocEntry` / `pendingScrollLineRef` path.
- Dirty in-memory content: the active doc is `buffer`/`docPath`; other open
  files park their buffers (see `parkRef`, `parkedDirty`, `dirtyOpenFiles`).
- E2e suites are split per feature area; a new `tests/e2e/search.spec.ts`
  alongside `toc.spec.ts` fits, following that file's header-comment style.
  The e2e suite is slow and serialized — debug single tests with
  `npx playwright test -g '<title>'`.
