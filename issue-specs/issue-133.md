# Spec: TOC active-section highlight follows the viewport (#133)

## Goal

All acceptance criteria in issue-specs/issue-133.md are satisfied for issue
#133, with evidence visible in the session: the TOC row for the section at the
top of the viewport is highlighted and updates as the document scrolls in both
view and edit modes, an active row buried under collapsed ancestors reveals
itself by auto-expanding them, the resolution runs through
`src/lib/tocModel.ts` (`activeTocEntryId` / `expandTocAncestors`) rather than
logic invented in the component, new `E<n>` e2e tests in `tests/e2e/toc.spec.ts`
cover scroll-driven highlight in both modes, `npm run validate:quick` passes in
the implementer's session, and a summary comment from the implementer exists on
issue #133.

## Acceptance criteria

- **The highlight tracks the viewport top** (PRD 012 Req 7). While the TOC view
  is showing, exactly one `toc-item` row is marked active: the entry for the
  deepest heading whose source range contains the line currently at the top of
  the viewport. It updates as the user scrolls — no click required — and the
  mark is an attribute/class a test can assert (e.g. `aria-current="true"` plus
  a `data-*`/class hook), styled distinctly from the folder row's `selected`
  state so it reads as "you are here", not "you picked this".
- **Both modes** (PRD 012 Req 7). The same behaviour holds in preview and in
  edit mode, including split edit: scrolling the editor pane moves the
  highlight, driven by the editor's top visible line
  (`EditorSyncHandle.topLine()` via `editorSyncRef`), and scrolling the preview
  moves it through the anchor path already used for the top line
  (`lineAtOffset(collectAnchors(...))`). Clicking a TOC row (PRD 012 Reqs 5–6)
  leaves that row as the active one once the scroll settles, in both modes.
- **Preamble means no row.** When the top of the viewport is above the first
  heading — or the document has no headings at all — no row is highlighted
  (`activeTocEntryId` returns null and nothing on screen claims to be active).
  The empty-state pane (PRD 012 Req 8) is unchanged.
- **Auto-reveal under collapsed ancestors** (PRD 012 Req 7). When the active
  entry is hidden inside a collapsed ancestor, the ancestors on its chain
  expand so the highlighted row is visible; the expansion goes through
  `expandTocAncestors` in `src/lib/tocModel.ts` and touches only that chain —
  unrelated collapsed entries elsewhere in the tree stay collapsed, and the
  collapse set of other documents is untouched. Expanding on scroll does not
  loop or re-render endlessly: a scroll that leaves the active entry already
  visible produces no collapse-set state change.
- **The module owns the rules** (PRD 012 Req 13, and the issue's third
  criterion). Active-section resolution reuses the pure resolver in
  `src/lib/tocModel.ts` (`activeTocEntryId`, `expandTocAncestors`) — the React
  component and `App.tsx` wiring supply the line and render the answer, they do
  not re-derive which entry is active. Any genuinely new pure logic (for
  example, a helper that resolves an id and the reveal set together) lands in
  that same `src/lib/` module with unit tests in `tests/unit/toc-model.test.ts`;
  no new active-section rule lives in a component.
- **Costs nothing when closed, cheap when open.** The scroll subscription
  exists only while the TOC view is actually showing (the existing `tocOpen`
  gate) and is torn down when the view closes, the sidebar hides, the mode
  switches, or the document closes. Scroll handling is throttled the way the
  neighbouring listeners are (rAF or a short timer — see the SPEC16 §3 preview
  listener and the SPEC45 split-sync block in `src/App.tsx`); it does not run a
  markdown re-parse per scroll event. Scrolling with the TOC closed adds no new
  work at all.
- **Nothing already landed regresses.** The #132 behaviours keep their
  contracts: `toc-item` / `toc-twisty` / `toc-panel` / `toc-empty` /
  `sidebar-view-toc` / `sidebar-view-folders` / `folder-panel` keep their ids
  and meanings, manual expand/collapse still works and stays per file for the
  session, click-to-navigate still uses `scrollPreviewToLine` and
  `goToLine`, and no existing e2e test (E249–E254 and the folder-tree suite) is
  weakened, renumbered, deleted or skipped. The highlight must not steal focus
  from the document or the editor, and must not fight the user's own scrolling.
- **Covered by tests.** New Playwright tests in `tests/e2e/toc.spec.ts`,
  numbered from `E255` (the next free number), assert: scrolling the preview
  moves the highlight from one heading's row to the next; scrolling in edit mode
  does the same; scrolling into a subtree whose ancestor was manually collapsed
  reveals the active row; and a viewport parked in the preamble highlights
  nothing. Unit coverage for any new pure helper goes in
  `tests/unit/toc-model.test.ts`.
- **Iteration is cheap, the gate runs once.** During implementation, iterate
  with `npm run typecheck` and `npm run test:unit` (or a single targeted test:
  `npx playwright test -g 'E255'`). Do not run the full e2e suite after every
  change and do not run it as a start-of-attempt baseline — baseline with the
  quick pair only.
- **`npm run validate:quick` passes**, run once in the implementer's session
  right before declaring the goal met, printing
  `QUICK VALIDATION: ALL PASSED`.
- **A summary comment from the implementer exists on issue #133**, describing
  what landed and pasting the `validate:quick` evidence.

## Context

The pure logic already exists and is unit-tested: `activeTocEntryId(entries,
line)` and `expandTocAncestors(entries, collapsed, id)` in
`src/lib/tocModel.ts` (both carry PRD 012 Req 7 citations, landed with #131).
This issue is almost entirely wiring plus a highlight style.

The TOC wiring lives in `src/App.tsx` around the `tocOpen` / `tocTree` /
`tocRows` / `toggleTocEntry` / `jumpToTocEntry` block (grep `tocOpen`); the view
is `src/components/TocPanel.tsx` (`TocRow` renders `data-testid="toc-item"` with
`data-toc-id` and `data-line`), and its styles sit near the `.toc-label` rules in
`src/styles.css`, under the `.folder-item` family.

For the line at the top of the viewport, `App.tsx` already has
`currentTopLine()` — mode-aware, using `editorSyncRef.current.topLine()` in edit
mode and `lineAtOffset(collectAnchors(ws, doc), ws.scrollHeight, ws.scrollTop)`
in preview. Note it returns `null` when `docPath` is null, so an untitled buffer
would never highlight; reuse it only if that guard is handled (its existing
callers record reading positions, which legitimately need a path — do not break
them). Scroll sources to subscribe to: the workspace scroller
(`workspaceRef`, `addEventListener('scroll', …)` — see the SPEC16 §3 debounced
listener) and `EditorSyncHandle.onScroll(cb)` (the split-sync effect shows the
bounded retry idiom for the lazily-mounted editor handle).

Citations follow the PRD-012 convention already used by this feature —
`PRD 012 Req 7: <what and why>` — not a `SPEC<n>` number. Existing e2e coverage
and helpers to copy from: `tests/e2e/toc.spec.ts` (E249–E254, its `TREE_DOC`
fixture with a duplicate `## Notes` pair and long filler, plus
`editorTopGutterLine` from `tests/e2e/helpers.ts`).
