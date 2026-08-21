# Spec: can't select text inside of a table when in preview mode (#164)

## Goal

All acceptance criteria in issue-specs/issue-164.md are satisfied for issue
#164, with evidence visible in the session: dragging (or shift-arrowing, or
⌘A-ing) inside a cell of a rendered table grid in the edit pane paints a
visible selection band over the grid wash instead of nothing, the SPEC39 §2.1
cell clamp and every other table behaviour are unchanged, `npm run
validate:quick` passes in the implementer's session, and a summary comment
from the implementer exists on issue #164.

## Acceptance criteria

- **A selection inside a rendered table cell is visible.** With
  `tableGridView` on (the default), selecting text inside a cell of a table
  that is showing as the bordered grid — the state the issue calls "preview
  mode", as opposed to the raw pipe text — paints the editor's selection tint
  over the selected characters, by mouse drag, by `Shift+Arrow`, and by the
  SPEC39 §2.1 ⌘A-selects-the-cell path (E118). The reporter's symptom is gone:
  it is no longer possible to have a non-empty selection inside a grid with no
  "darker block" drawn anywhere.
- **The fix is the paint order, not the clamp.** Today
  `.editor-wrap .cm-line.mm-table-mode-line` (`src/styles.css`, the SPEC37
  §3.4 block near line 3263) puts an opaque `--mm-code-bg` background directly
  on the `.cm-line`; `drawSelection()` paints into a `.cm-layer` that the view
  numbers *below* the content (z-index −2 in this configuration), so the line's
  own background covers the band completely — the same defect issue #163 fixed
  for fenced-code cards. The grid wash ends up below the selection layer
  (the `::before` at z-index −3 that `.mm-fence-card` uses is the precedent
  and the obvious shape), the `.cm-line` itself is transparent, and the wash
  still reads identically at rest in both light and dark themes.
- **Cell confinement still holds.** A drag whose two endpoints land in
  different cells (or one inside the grid and one outside) still clamps to a
  single cell exactly as SPEC39 §2.1 / `alignFilter` in
  `src/components/tableMode.ts` does today — the clamped range is what gets
  tinted. No change to `alignFilter`, `displayCellBounds`, or any selection
  arithmetic is needed to satisfy the criterion above; if the implementer
  finds a second, genuinely separate cause inside that logic, fixing it is in
  scope, but weakening or removing the clamp is not.
- **Nothing else in the grid moves.** Text geometry is unchanged — no caret
  offset, no reflow, no re-fit, and the grid's own borders/wrapping still line
  up character-for-character (SPEC38/SPEC40 live re-fit, E110/E113/E115 keep
  passing). The `.table-chip-layer` chips and the `.table-badge` pill still
  draw above the wash and stay clickable; flipping `tableGridView` off leaves
  the edit pane exactly as it is today; the fenced-code card chrome
  (`.mm-fence-card`, issue #163) and the PRD 013 diagram view are unaffected;
  document text, dirty state, undo history, save output, preview rendering and
  export (`src/lib/exportDoc.ts`) are all byte-identical.
- **Preview-pane tables stay selectable too.** Text inside a `<table>` in the
  preview pane (`.doc`) remains selectable by mouse — if the implementer finds
  the reporter actually meant the preview pane, that path is covered by the
  same criterion set and must end up working; either way both panes are
  verified in the session.
- **One new Playwright test** in `tests/e2e/tables.spec.ts` (next free number:
  `E324`) covers the end-to-end behaviour in the style of the stacking +
  band-coverage assertions in `E317`
  (`tests/e2e/editor.spec.ts`): with a grid rendered, a selection inside a
  cell produces a `.cm-selectionBackground` rect that covers the selected
  glyphs, and the grid line's own `background-color` is transparent while its
  wash paints below `.cm-selectionLayer`.
- **Unit coverage** exists for any pure logic the change adds or extends —
  most likely none, since this is expected to be a CSS/decoration paint-order
  fix; if `src/lib/tableEdit.ts` or the span core changes, add cases to
  `tests/unit/table-edit.test.ts` or `tests/unit/table-mode-spans.test.ts` in
  the existing `U<n>`-titled style (next free number: `U792`).
- New or changed behaviour carries citation comments in the repo's format
  (`docs/COMMENT-FORMAT.md`, `.sandcastle/CODING_STANDARDS.md`); the header
  comment on the `.mm-table-mode-line` rule is updated to state the new
  stacking and why. If any `SPEC<n>` citations are added or moved,
  `docs/MAP.md` is regenerated with `npm run map` and committed
  (validate:quick diffs it).
- Iteration used `npm run typecheck` and `npm run test:unit` (or a single
  targeted e2e via `npx playwright test -g '<title>'`); the full gate was run
  ONCE, right before declaring the goal met — not after every change and not
  as a start-of-attempt baseline (baseline with the quick tier only).
- `npm run validate:quick` has been run in the implementer's session and
  prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #164.

## Context

"Preview mode" in the issue means the edit pane's rendered table grid, not the
preview pane: SPEC40 makes every valid GFM table render as the SPEC38 bordered
grid while `tableGridView` is on, dropping to raw pipe text only where the
caret sits — that is the "raw mode" the reporter contrasts against. The wash is
one CSS rule, `.editor-wrap .cm-line.mm-table-mode-line` in `src/styles.css`
(SPEC37 §3.4, ~line 3263), applied by `tableModeDecos` in
`src/components/tableMode.ts` as a `Decoration.line`.

Issue #163 hit the identical defect on fenced-code cards and its fix is two
screens below in the same file: read the header comment on
`.editor-wrap .cm-line.mm-fence-card` (the "Issue #163: the chrome lives on a
::before at z-index -3" paragraph) — it explains the `.cm-layer` numbering and
why an opaque background on the line hides the selection band. Reuse that
shape rather than inventing a second one. `E317` in `tests/e2e/editor.spec.ts`
shows how to assert it without depending on the exact z-index numbers.

Selection clamping lives in `alignFilter` (`src/components/tableMode.ts`,
SPEC39 §2.1) and is working as specified — it is the behaviour the reporter
says they *want*. Confirm a clamped selection is non-empty in state before
concluding anything about the paint.

Grep `SPEC37`, `SPEC39`, `SPEC40` and `Issue #163` to land on the exact sites;
`tests/e2e/tables.spec.ts` (E109–E120) is the existing table suite and
`npx playwright test -g 'E118'` is the cheap confinement check. Never read
`src/App.tsx` end to end.
