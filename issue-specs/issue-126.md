# Spec: dont indent open files in folder pane (#126)

## Goal

All acceptance criteria in issue-specs/issue-126.md are satisfied for issue
#126, with evidence visible in the session: an open-but-inactive file row in
the folder pane sits at the SAME horizontal label position as a closed sibling
at the same tree depth and as the active (`.selected`) row — the extra ~20px
that `.folder-item.open` currently adds (`margin-left: 14px` plus
`padding-left: calc(var(--mm-depth) + 6px)`, uncompensated) is gone, in both
the tree view and the only-open-files flat view; the tab pill's visual
treatment (surface tint, rounded left corners, flush-right geometry, shadow,
hover states, dirty ●/✕ slot) is otherwise unchanged and no new theme key is
introduced; new e2e coverage measures the row label x-positions and asserts
they match; `npm run validate:quick` has been run in the implementer's session
and passes; and a summary comment from the implementer exists on issue #126.

## Acceptance criteria

### The alignment

- An open-but-inactive file row (class `folder-item open`) in the folder tree
  has its glyph and label at the same x-position as a closed file row at the
  same depth in the same directory — within ~1px, measured as
  `boundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft)`.
  Today it is ~20px to the right of them.
- The active row (`folder-item selected`) keeps its current position, which
  already matches an unopened sibling; open, closed and active rows at the
  same depth all line up on one column. Opening a file must not make its row
  appear to indent, and closing it must not shift the label back.
- Depth indent still comes from the tree only: a file at depth 2 stays
  indented relative to depth 1 regardless of open/closed/active state, driven
  by the `--mm-depth` inline variable set in
  `src/components/FolderPanel.tsx` (`FileRow`).
- In the only-open-files flat view (SPEC36 §5.3, `depth={null}`, so
  `--mm-depth` falls back to its 10px default) every row — active and
  inactive alike — sits on one flush left column; the list reads as flat, with
  no row indented relative to the others.

### What must NOT change

- The open row is still a tab pill on its own plane: same background tint /
  `color-mix` surface, `border-radius: 7px 0 0 7px`, `z-index: 1`, drop
  shadows, and the `:hover` variants for plain / open / selected rows. Only
  the horizontal position of the row's content changes. The pill may keep a
  left gap from the panel edge, but it must be the SAME gap the active tab
  uses so the labels agree — this is what SPEC36 §4.1 already requires ("the
  same left gap and flush-right geometry as `.selected`"), so no spec
  amendment is needed.
- The pill stays flush against the right edge and does not widen the
  horizontal scroll range of `.folder-list` — keep the `min-width:
  calc(100% - <gap>)` compensation that `.folder-item.selected` documents,
  matched to whatever left gap ships, so the reveal's `scrollIntoView` does
  not chase overflow.
- At depth 0 the label must not end up left of a plain row's 10px padding
  (no negative/clipped padding): use the `max(0px, …)` guard the
  `.selected` rule already uses.
- Everything else that reuses `.folder-item` and `--mm-depth` is untouched:
  directory rows and chevrons, dim non-markdown rows, TOC rows
  (`.folder-item.toc-active`, PRD 012), search-result rows, drop-target
  outlines, the dirty ● / hover ✕ swap (`folder-tab-slot`), and the
  `folder-open-empty` line.

### Tests and gate

- New e2e coverage lands in `tests/e2e/folder-tree.spec.ts` at the next free
  E number (E305+; verify uniqueness across `tests/e2e/` before numbering)
  and covers at least: (a) in tree view with a file open but not active, its
  label x equals a closed sibling's at the same depth and the active row's;
  (b) a nested (depth ≥ 1) open file still indents relative to its parent
  level; (c) in only-open mode (`folder-open-only`) all rows share one label
  x. The measurement pattern is `tests/e2e/toc.spec.ts:105` /
  `tests/e2e/shell-and-menus.spec.ts:274`.
- Existing folder-pane and tab e2e tests (E27, E96, E98, E175, E267+, E271,
  E272, E274, E275, E292, E296, E298 and the rest) keep passing unchanged.
- The changed CSS site carries / keeps a citation comment per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`, and the
  existing `.folder-item.open` comment is updated so it describes the
  geometry that actually ships (it currently claims the plane treatment
  without mentioning the offset).
- `docs/MAP.md` is regenerated with `npm run map` if citation sites changed
  (the validation gate diffs it against the generator's output); it is never
  hand-edited.
- Iterate with `npm run typecheck` and `npm run test:unit` (or a single
  targeted e2e via `npx playwright test -g '<title>'`) — not the full suite,
  and not a full-suite baseline at the start of the attempt. Run
  `npm run validate:quick` ONCE, right before declaring the goal met, and it
  prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #126.

## Context

This is a CSS-geometry fix, almost certainly a few lines. `src/styles.css`
holds the three rules that matter: `.folder-item` (~line 2551,
`padding: 3px 16px 3px var(--mm-depth, 10px)`), `.folder-item.selected`
(~line 2575, `margin-left: 10px` + `min-width: calc(100% - 10px)` +
`padding-left: max(0px, calc(var(--mm-depth, 10px) - 10px))` — the gap is
given back so the label does not move), and `.folder-item.open` (~line 2604,
`margin-left: 14px` + `padding-left: calc(var(--mm-depth, 10px) + 6px)` —
14 + 6 = 20px of *uncompensated* offset, which is the reported indent).
Making `.open` mirror `.selected`'s compensation is the obvious fix; matching
the 10px gap exactly is the simplest way to get all three states on one
column at every depth, but any solution that satisfies the criteria is fine.

`src/components/FolderPanel.tsx` sets `--mm-depth` in `FileRow` (~line 396)
and renders both views: the only-open flat list passes `depth={null}` (~line
666) so no variable is set and the 10px fallback applies; the tree passes a
numeric depth. `docs/specs/SPEC36.md` §4.1 (sidebar visuals) and §5.3
(only-open mode, "no depth indent") are the contract the code cites — read
those two short sections rather than the whole spec. Grep `SPEC36` / `SPEC34`
to find cited sites; never read `src/App.tsx` end-to-end.

The issue body links a screenshot that is not fetchable from the sandbox
(private-repo attachment), but the CSS arithmetic above reproduces the report
exactly: in the only-open view the active file sits flush while every other
open file is pushed 20px right, and in the tree an open file is pushed 20px
right of its unopened siblings.
