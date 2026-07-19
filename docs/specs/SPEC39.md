# SPEC39: Marky Mark v39 — table mode: live re-fit, cell confinement, mode chrome

Delta spec on top of SPEC.md–SPEC38.md as implemented. This file wins on
conflict; nothing may regress beyond the amendments named in §5. §6 is
the goal condition.

**What ships:** three fixes that make SPEC38's table mode feel like the
restrictive, safe mode it claims to be. **One — live re-fit:** resizing
the window or dragging the split divider re-measures the width budget
and re-lays-out the grid, so it ALWAYS fits the pane. **Two — spaces
type again:** the re-layout's trimming was eating a space typed at the
end of a cell; such spaces now advance the caret into the padding
instead (the next word lands after them). **Three — the mode is
visible and confined:** a TABLE pill with a Done button pins to the
editor pane, the menu item reads "Exit Table Mode" while active, and
editing is CONFINED to the caret's cell — selections cannot cross
cells, Enter/Tab navigate instead of inserting, cell-edge deletions and
separator lines are inert, and typed or pasted content is flattened so
the grid cannot be damaged from inside it.

Out of scope: everything SPEC38 excluded (CJK widths, intra-cell
whitespace runs); rectangular multi-cell selection; the SPEC38
break-exit for FOREIGN changes (undo past entry, external edits) —
that safety valve is unchanged; any new dependency or src-tauri change.

---

## 1. Live re-fit (FR-REFIT)

While the mode is active, editor geometry changes (window resize, split
divider drag, sidebar toggle — anything that changes the content width)
re-measure the width budget (SPEC38 §3.1 measurement) on a short
debounce (~150 ms). A changed budget re-lays-out the grid in place: an
UNRECORDED transaction (`addToHistory: false` — a re-fit is not an
edit; history inverses map through it) carrying the mode effect with
the new span and width, cursor kept at its logical (cell,
content-offset). The grid never shows a soft-wrapped line at any pane
width the floors can satisfy.

## 2. Cell-confined editing (FR-CONFINE)

All of the following apply only while the mode is active, via a
`Prec.highest` keymap plus the transactionFilter; foreign transactions
(undo/redo, IME, effect-carrying) keep their SPEC38 handling.

1. **Selection clamp.** A selection with its head inside the grid span
   clamps — both endpoints — to the content span of the head's cell. A
   selection anchored inside the grid with its head outside clamps to
   the anchor's cell. (Both endpoints outside: allowed — deleting such
   a range breaks the grammar and exits per SPEC38, the deliberate
   escape hatch.) ⌘A with the caret in the grid selects the CURRENT
   cell's content, not the document.
2. **Spaces.** A space insertion that trimming would delete (at the
   cell content's end, or in padding) becomes a caret advance within
   the cell, clamped at the cell's inner edge — so typing
   `hello world` lands both words. Interior spaces insert normally
   (runs still normalize to one).
3. **Enter navigates.** Enter moves to the same column in the next row
   (header → first body row; no-op past the last); Shift+Enter moves
   up. Tab / Shift+Tab move to the next / previous cell row-major.
   None of them ever inserts into the document.
4. **Edge deletions are inert.** Backspace at the cell content's start
   and Delete at its end are consumed no-ops (cell and grid structure
   cannot be eaten). Within the cell they behave normally.
5. **Insertions are flattened.** Any text inserted into a cell (typed
   or pasted) passes through pure `sanitizeCellInsert`: newlines and
   carriage returns become spaces, unescaped `|` becomes `\|` (typing
   a pipe therefore yields its escaped form — rendering shows `|`).
6. **Separators and structure are read-only.** Edits whose target
   lies outside cell content — separator lines, pipes, the gutters —
   are consumed. (E110's manual delimiter mangling is therefore no
   longer possible from inside the mode; the break-exit still guards
   foreign changes.)

## 3. Mode chrome (FR-CHROME)

1. A pill pinned to the editor pane while the mode is active (the
   vim-badge family): label "TABLE", plus a **Done** button (test id
   `table-mode-done`, title mentioning Esc) that collapses and exits —
   identical to Esc.
2. The Table ▸ menu item reads **"Exit Table Mode"** while the mode is
   active (id stays `edit-table`; enabled regardless of the cursor's
   position while active — you can always leave), and "Edit Table…"
   when off, exactly as before. `SmartMenuCtx` gains `tableMode:
   boolean`; the Editor passes the field's state at menu-open.

## 4. Pure additions — `src/lib/tableEdit.ts` (FR-PURE)

`sanitizeCellInsert(text)` (§2.5) and `cellNavTarget(parsed, map,
loc, dir)` → the (cell, content-offset 0) target for Enter/Tab
navigation (`'up' | 'down' | 'next' | 'prev'`, null at the ends —
row-major for next/prev, header included). Both DOM-free and
unit-tested.

## 5. Tests (added: U73, E115–E118; amended: U65, E110)

Amendments, by name: **U65** — `SmartMenuCtx.tableMode`: with it true,
`edit-table` is labeled "Exit Table Mode" and enabled even when
`ctx.table` is false (the pinned snapshot gains the flag=false default).
**E110** — the manual grammar-break step (typing over the delimiter) is
replaced by its confinement counterpart: those keystrokes are consumed
and the grid survives; break-exit coverage remains via E109's
undo-past-entry. No other existing test may be modified, weakened,
skipped, or deleted; E42–E44 stay reserved.

1. **U73** — `sanitizeCellInsert` (newlines/CR → spaces, pipe
   escaping, already-escaped pipes untouched); `cellNavTarget` (down
   from header, down/up across rows, no-op at ends, next/prev
   row-major wrap incl. header row, single-cell tables).
2. **E115** — live re-fit: enter the mode in split edit, narrow the
   viewport (or drag the divider): the grid re-lays-out — every table
   line stays a single visual line at the new width; widen back and
   the columns relax; no history pollution (one ⌘Z after a re-fit
   still reverts the last real edit, not the re-fit).
3. **E116** — spaces: type `hello world` character by character into a
   cell; both words land (buffer contains `hello world` in that cell
   after collapse); a space at the cell's inner edge is a clamped
   no-op.
4. **E117** — chrome: the TABLE pill and Done button render while the
   mode is on and not before; clicking Done collapses byte-identically
   (like Esc) and the pill leaves; the menu shows "Exit Table Mode"
   while on and "Edit Table…" after.
5. **E118** — confinement: Enter in a cell inserts nothing and moves
   to the row below (same column); Tab moves to the next cell;
   Backspace at content start is inert (grid byte-identical); typing
   `|` lands as `\|` (and renders as `|` after collapse); ⌘A selects
   only the cell content; a pasted multi-line string flattens into the
   cell; keystrokes on a separator line are consumed.

## 6. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U73, E1–E41 +
   E45–E118, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` is EMPTY; no new dependencies; version files
   stay 0.4.0-alpha.1; no `.skip/.only/.todo`; the reserved-name scan
   prints nothing; `git diff --stat docs/specs` limited to this file's
   addition.
3. README's table sentence mentions the confined mode + Done exit.
   ARCHITECTURE.md's table section gains re-fit, confinement, and the
   chrome.
