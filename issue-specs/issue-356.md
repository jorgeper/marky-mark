# Spec: Table grid: in-cell pointer selection is erratic; clamp to the anchor's cell on every drag step and never collapse (#356)

## Goal

All acceptance criteria in issue-specs/issue-356.md are satisfied for issue #356, with evidence visible in the session: the SPEC39 §2.1 clamp behind `alignFilter` in `editor/src/components/tableMode.ts` is a pure, idempotent, unit-tested function that confines a ranged selection to the ANCHOR's whole cell whenever the anchor sits in a grid cell (the anchor never moves, the head snaps to the cell's nearest content position, and the selection is never collapsed when the head is on padding, a pipe, the separator row, another cell or outside the table), clamps a head that enters a grid from an outside anchor to the grid edge nearest the anchor, and leaves whole-span and outside-only selections untouched; a real pointer drag, double-/triple-click, Shift+click/arrow/Home/End and ⌘A obey it with no collapsed transaction in a recorded `window.__mmSelLog`; new e2e tests in `tests/e2e/tables.spec.ts` and unit tests cover every clamp case; E118's final Shift+End assertion and E613 (d) are amended to the anchor rule and every other SPEC38/39/40 and #344/#346 test stays green; SPEC39 §2.1 states the anchor-cell and no-collapse rules and `docs/MAP.md` is regenerated; `npm run validate:quick` prints `QUICK VALIDATION: ALL PASSED` in the implementer's session; and a summary comment from the implementer exists on issue #356.

## Acceptance criteria

### The clamp is a pure function with the anchor-cell rule (issue Reqs 1, 2, 5, 7)

- A pure, exported, DOM-free function (suggested `clampSelectionToCell`, in
  `editor/src/lib/tableEdit.ts` or exported from `tableMode.ts`) takes the
  document text, the grid spans (or the one span plus its `parseDisplay`
  result) and an `{ anchor, head }` pair and returns the clamped pair, or
  the input unchanged. `alignFilter`'s `!tr.docChanged` branch calls only
  it; the inline pivot logic (the `pivot = headSpan ? sel.head : sel.anchor`
  block and the `return [tr, { selection: { anchor } }]` collapse) is gone.
- Rule A, anchor in a cell: when the anchor lies inside a cells-line cell of
  a span (`displayWholeCellBounds(...).kind === 'cells'`, padding and pipes
  of that cell included), the confinement cell is the ANCHOR's whole cell
  (issue #346's `displayWholeCellBounds`). The returned anchor equals
  `snapToCell(w, anchor)` (an anchor already on content is returned as is,
  so it never moves across successive drag steps); the returned head equals
  `snapToCell(w, head)` after clamping the head into the span, whatever the
  head sits on: content of the same cell, its padding, a pipe, the gutter,
  the separator row, another cell of any row, a line outside the table, or
  past the document ends. The result is never empty unless the input was
  (anchor and head snapping to the same content position is allowed only
  when the input range already covered no cell content, e.g. an empty cell).
- Rule B, anchor outside every grid, head strictly inside a span
  (`span.from < head < span.to`): the anchor is unchanged and the head is
  clamped to the span edge nearest the anchor (`span.from` when
  `anchor < span.from`, `span.to` when `anchor > span.to`). The head never
  lands inside a cell.
- Rule C, escape hatches: both endpoints outside every span, or a range that
  encloses a whole span (`min(anchor, head) <= span.from` and
  `max(anchor, head) >= span.to`, which is what a document-wide select-all
  produces even when the table starts or ends the document), is returned
  untouched, so a second ⌘A still selects the document (SPEC39 §2.1).
- Rule D, anchor on a separator line of a span: today's collapse to a caret
  at the anchor stays (there is no selectable content); this is the only
  collapsing case and it is documented in SPEC39 §2.1.
- Stability: the function is idempotent (`clamp(clamp(x)) === clamp(x)`) and
  deterministic; when the clamped pair equals the input pair the filter
  returns the original transaction (no extra spec), so consecutive
  mousemoves at the same position produce no additional selection change.
  The filter parses only the confinement span (`parseDisplay` over that
  span's region), never every span in the document, once per transaction.

### Pointer gestures (issue Reqs 1, 2, 3)

- A pointer drag (CodeMirror's `select.pointer` transactions) whose mousedown
  landed in a cell obeys Rule A on every mousemove and on pointer-up,
  including pointer-up on padding, a pipe, the separator row, another cell,
  or outside the table. The final selection is anchor..(clamped head).
- Double-click in a cell selects the word under the pointer, clamped into
  the cell (a word abutting the cell edge or a hard-break `↩` never extends
  past the cell's content). Triple-click in a cell selects exactly that
  cell's whole content span (contentStart..contentEnd of the CLICKED cell,
  across wrapped lines), not the display line, the pipes or the first cell
  of the line. Because CodeMirror's default triple-click selects the line
  (anchor at the line start, which Rule A would resolve to the FIRST
  column), the implementer provides an `EditorView.mouseSelectionStyle`
  provider (or a `Prec.highest` mousedown handler) that, for `event.detail
  === 3` inside a grid span, yields the clicked cell's whole-cell range;
  the filter remains the backstop for it.
- Shift+click, Shift+ArrowLeft/Right/Up/Down, Shift+Home and Shift+End with
  the anchor in a cell clamp to that cell's whole content (Rule A); none
  collapses. ⌘A with the caret in a cell selects the whole cell; a second
  ⌘A selects the document (Rule C). ⌘A on a separator line stays inert.
- A drag that starts on a prose line above or below the table and enters
  the grid obeys Rule B: the head sits at the table's start (or end), never
  in a cell.
- With grid view off (raw pipes, no spans), selection is ordinary text: a
  drag across a pipe selects the raw slice including the `|`.

### Other selection producers do not fight the clamp (issue Req 7)

- No extension re-dispatches a selection in reaction to a selection update
  (an update listener that dispatches `{ selection }` would loop with the
  filter and read as flicker). The implementer checks the live-preview hide
  decorations (`editor/src/components/livePreview.ts`), the link view, the
  highlight click gesture (`highlightClick.ts`, ⌘-mousedown only, never a
  dispatch), the Smart Edit selection handle (`src/App.tsx`
  `smart-edit-selection`, driven from `onEditState`), and the mirrored
  selection seam (`selectSourceRange` in `Editor.tsx`, SPEC23 §1) and
  states the result in the summary comment. Host-placed ranges go through
  the filter like any other; that is expected.
- Vim nav mode (SPEC23 §2, `editor/src/lib/vimnav.ts`) has no visual
  selection mode today (no `v` binding); the implementer confirms this and
  notes issue Req 8 as satisfied vacuously in the summary comment. If a
  visual mode does exist, its ranges go through the same filter and one
  e2e assertion covers it.

### Copy / Highlight / Comment (issue Req 6)

- ⌘C over an in-cell selection still lands the cell's joined visible text
  on `window.__mmClipboard`; a highlight or comment over an in-cell
  selection still anchors to the canonical cell text (issues #344, #346).
  E611, E613, E615 and E616 pass; no new behaviour is required unless the
  anchor rule breaks one of them.

### Test seams

- `window.__mmEdit` (browser shim only; type in `src/platform/browser.ts`,
  setter `seamEditState` in `src/App.tsx`, producer in `Editor.tsx`'s
  update listener) gains `selAnchor: number` and `selHead: number`
  (`selection.main.anchor` / `.head`) beside `selFrom`/`selTo`.
- `window.__mmSelLog: Array<{ anchor: number; head: number }>` (browser
  shim only) receives one entry per editor update with `selectionSet`, in
  order; a test may reset it to `[]` before a gesture. Both seams are
  documented in the `Window` augmentation with a `// SPEC39 §2.1 (issue
  #356)` citation.

### Tests

- Unit tests (vitest, `editor/tests/table-edit.test.ts` for the pure
  function; optionally `editor/tests/table-mode-spans.test.ts` for the
  filter through a headless `EditorState.update({ selection })` with
  `setGridSet`, as that file already does; next free U-numbers, U1367
  onward at spec time) cover, on an unwrapped and a wrapped grid: head on a
  pipe, head in padding, head on the separator row, head in another cell of
  the same row, head in another row's cell, head outside the table (before
  and after), head past the document end, anchor outside / head inside
  (Rule B, both directions), whole-span enclosure untouched (Rule C, table
  at document start), both-outside untouched, anchor on a separator (Rule
  D), idempotence, and "anchor on content is returned unchanged".
- E2e (Playwright, `tests/e2e/tables.spec.ts`, next free E-numbers, E626
  onward at spec time; fixtures opened with `openGridDoc`, an unwrapped
  table with at least two columns and a prose line above it, plus E613's
  wrapped fixture) cover, with `page.mouse` and per-step polling of
  `__mmEdit.selAnchor` / `selHead` (one `page.mouse.move` per step):
  (a) mousedown on the second character of a cell, five moves across the
  cell's text, then over the trailing padding, the pipe, into the next
  cell, and release there: after every step `selAnchor` is unchanged and
  `selHead` ≤ the cell's content end; after release the selection is
  anchor..contentEnd (`selText` is the cell text from the second character
  on, no `|`);
  (b) the same drag leftwards over the leading pipe into the previous cell:
  head clamps to contentStart;
  (c) double-click selects one word of the cell; triple-click on a
  non-first cell selects exactly that cell's content;
  (d) Shift+End, Shift+Home and ⌘A with the caret in a cell select to the
  cell's edges (`selText` equals the cell's content); a second ⌘A selects
  the document;
  (e) a drag from the prose line above the table into a cell: `selHead`
  equals the table's start offset, `selText` contains no `|`;
  (f) on the wrapped fixture, a drag across the wrap boundary keeps the
  whole-cell clamp (union of fragments, as E613 (a));
  (g) a 20-step drag inside a cell: `__mmSelLog` after the gesture has at
  least 20 entries, none after the first move with `anchor === head` (no
  collapsed entry), and every entry's anchor equals the mousedown anchor;
  (h) grid view off: a drag across a pipe selects raw text including `|`.
- Amended existing assertions, both to the anchor rule and nothing else:
  E118's final step (`caretInto(page, '| 1   | 2   |', 2)` then Shift+End)
  now expects `selText` `'1'` (anchor at cell 1's content start); E613 (d)
  (drag from `k05` leftwards into the `zq` cell) now expects the selection
  to run from the Detail cell's content start to the anchor (`'k01 k02 k03
  k04 k0'`, no `|`, no `zq`). E611's comment about Shift+End and the head's
  cell is corrected to name the anchor's cell; its assertions are unchanged.
  Every other SPEC38/39/40 and #344/#346 test (E110, E113, E115–E120,
  E611, E613–E616 and the rest of `tests/e2e/tables.spec.ts` /
  `comments.spec.ts`) passes unmodified; no `.skip/.only/.todo`.

### Spec text and map

- `docs/specs/SPEC39.md` §2.1 ("Selection clamp") is amended: the
  confinement cell is the ANCHOR's whole cell whenever the anchor is inside
  a cell (the head's cell no longer decides), the anchor never moves, the
  head snaps to the cell's nearest content position, a head over padding,
  a pipe, the separator row, another cell or outside the table is clamped
  and never collapsed, an outside anchor with an inside head clamps the
  head to the nearest grid edge, a range enclosing the whole span passes
  through, triple-click selects the clicked cell, and only a
  separator-anchored range collapses. Changed code carries `// SPEC39
  §2.1:` (and `issue #356`) citations per `.sandcastle/CODING_STANDARDS.md`;
  `docs/MAP.md` is regenerated with `npm run map` and committed.

### Process

- The implementer iterates with `npm run typecheck` and `npm run test:unit`
  (or tests targeted at the changed code, e.g. `npx playwright test -g
  'E626'`), baselines with the quick tier only, and runs
  `npm run validate:quick` ONCE right before declaring the goal met; it
  prints `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #356.

## Context

- The clamp is inline in `alignFilter` (`editor/src/components/tableMode.ts`
  ~L152–190): `pivot = headSpan ? sel.head : sel.anchor` picks the HEAD's
  cell, and `if (!w || w.kind !== 'cells') return [tr, { selection: { anchor
  } }]` collapses whenever the pivot resolves to a separator line; #346
  patched only the same-span separator case. `displayCellBounds`
  (`editor/src/lib/tableEdit.ts` ~L824) resolves an offset before the first
  pipe to column 0 and one past the last pipe to the last column, which is
  why a line-start anchor (triple-click) maps to the first cell.
  `displayWholeCellBounds` (~L895) and `snapToCell` (~L936) already give the
  whole-cell span and the endpoint snap; Rule A is those two applied to the
  anchor's cell, Rule B is new.
- `spanAt` is inclusive at both ends; Rule C's enclosure test must be
  applied before Rule A/B so a select-all over a document that starts with
  a table is not treated as "anchor inside".
- `caretCell` (~L757) feeds `Mod-a` in `confineKeymap`; it already selects
  the whole cell (issue #346) and returns false when the cell is already
  selected so `selectAll` runs.
- CodeMirror dispatches one `select.pointer` transaction per mousemove; a
  `mouseSelectionStyle` provider (`EditorView.mouseSelectionStyle`) is the
  sanctioned seam for custom click-count behaviour (`event.detail`).
- Test helpers: `openGridDoc`, `caretInto`, `wordRect`, `dragAcrossText` in
  `tests/e2e/helpers.ts`; `editState`, `openWrappedGrid`, `WRAP_SOURCE` /
  `WRAP_CELL` and `EDITOR_PANE` in `tests/e2e/tables.spec.ts` (E613–E616
  are the models). Highest test numbers at spec time: E625, U1366.
- Commands (all in `package.json`): `npm run typecheck`, `npm run test:unit`,
  `npm run test:e2e`, `npm run map`, `npm run validate:quick`.
