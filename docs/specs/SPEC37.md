# SPEC37: Marky Mark v37 — aligned table editing in the editor pane

Delta spec on top of SPEC.md–SPEC43.md as implemented (SPEC31 remains
spec-only; SPEC28 withdrawn). This file wins on conflict; nothing may
regress beyond the two amendments named in §9. §10 is the goal condition.
(An earlier preview-pane draft of SPEC37 exists only on the parked
`feat/table-edit-preview-overlay` branch; this file replaces it.)

**What ships:** the SPEC43 stub comes alive **in the editor pane**. The
smart menu's contextual entry becomes a **Table ▸** submenu — **Edit
Table…**, **Insert Table**, **Delete Table** — and Edit Table… enters
**aligned table mode**: the table's source is re-padded so every pipe
lines up into a true monospace grid, and it STAYS aligned live — every
edit inside the table re-pads all rows in the same transaction, so the
source always looks like the table it renders as. Wherever the cursor
sits, circular chips appear on the table's margins: ⊕ at the column's
left/right edges on the top border (insert column), ⊕ at the row's
top/bottom edges on the left margin (insert row), ✕ centered above the
column and left of the row (delete). Everything is plain markdown
characters — valid GFM at every instant — and every operation or
keystroke-with-re-pad is exactly one undo step. Works identically in
full-screen and split edit; the preview needs nothing.

Out of scope: intra-cell line wrapping (a GFM row is one source line —
columns GROW instead, and a very wide table soft-wraps at the viewport
edge like any long line); display-width-aware padding for CJK/emoji
(padding counts UTF-16 code units; wide glyphs may visually misalign —
documented limitation); alignment (`:---:`) editing (preserved
verbatim); un-padding on exit (the alignment is real characters and
persists — that is the feature); tables in blockquotes/lists (top-level
pipe tables only, as SPEC43 detects); Resize Image… (still the SPEC43
stub); the web suite (pure frontend, ships by construction); any new
dependency; any src-tauri change.

---

## 1. Pure model — `src/lib/tableEdit.ts` (FR-MODEL)

New pure module, no DOM or CodeMirror imports. The model is
`{ header: string[]; align: Array<'left'|'center'|'right'|null>;
rows: string[][]; start: number; end: number }` — cells hold raw source
markdown verbatim (inline syntax and `\|` escapes included).

1. `tableRegionAt(text, offset)` — the SPEC43 pipe-table scan, extracted
   from `detectContext` (which now calls it; detection semantics
   unchanged), returning `{start, end}` (first char of first line … end
   of last line) or null.
2. `parseTable(text, region)` — unescaped-pipe splitting, edged and
   edge-less forms, trimmed cells, delimiter row → `align`, ragged body
   rows padded to the header's width.
3. `serializeTable(model)` — THE aligned form: edged, one-space gutter,
   every column padded to its widest cell (min 3), delimiter regenerated
   from `align`.
4. Operations returning `{text, start, end}` (whole document + the
   table's new span): `insertRow(at)` (empty; 0 = first body row),
   `deleteRow(at)` (header −1 refused ⇒ null), `insertCol(at)`,
   `deleteCol(at)` (1-column table refused ⇒ null),
   `setCell(row, col, raw)` (row −1 = header; pipes escaped),
   `starterTable()` (3 columns `Column 1..3`, 2 empty body rows),
   `insertTableAt(text, offset)` (blank-line managed, selection lands on
   `Column 1`), `deleteTableAt(text, offset)` (region + one separating
   blank line).
5. **Aligned-mode helpers**, the new heart:
   - `normalizeTable(text, region)` → `{text, start, end} | null` — the
     region re-serialized to §1.3's aligned form; null when already
     aligned (so live mode never churns no-op transactions).
   - `cellAt(text, region, offset)` → `{ row, col, contentStart,
     contentEnd } | null` — which cell an offset is in (row −1 header;
     the delimiter row maps to row −1 with its column) and the cell's
     trimmed-content span. Offsets in padding/pipes clamp to the nearest
     cell content edge.
   - `normalizeWithCursor(text, region, head)` → `{text, start, end,
     head}` — normalization plus the cursor mapped to the SAME logical
     place: same cell, same offset into the cell's content (clamped to
     the content edge when it sat in padding).

## 2. The menu (FR-MENU)

1. `buildSmartMenu`'s contextual section becomes **`table` ▸** (always
   present, first): `edit-table` "Edit Table…" (enabled iff
   `ctx.table`), `insert-table` "Insert Table" (enabled iff
   `!ctx.table`), `delete-table` "Delete Table" (enabled iff
   `ctx.table`); then `resize-image` iff `ctx.image` (unchanged stub);
   then the separator. Test ids stay `smart-edit-<id>`.
2. Insert Table and Delete Table splice via §1.4 exactly like the other
   format ops — one undo step, silent no-ops in preview mode.
3. Edit Table… enters aligned table mode (§3) on the cursor's table.
   Invoking it while the mode is already active on that table exits it
   (a toggle).

## 3. Aligned table mode (FR-MODE)

1. The mode lives in the Editor component (it is pure CodeMirror): state
   is the table's span, tracked precisely through every transaction via
   the changeset's position mapping — no heuristics.
2. **Entry**: one splice applying `normalizeWithCursor` (cursor kept in
   its logical cell), `isolateHistory('full')`. Works in full-screen and
   split edit alike; nothing toggles, nothing scrolls beyond keeping the
   cursor in view.
3. **Live alignment**: while active, any user transaction that changes
   text inside the span gets the re-normalization FOLDED INTO THE SAME
   transaction (CodeMirror transactionFilter), cursor logically mapped —
   so the buffer is aligned after every keystroke, paste, or menu op,
   and one undo step reverts the user's edit and its re-pad together.
   Typing in a cell narrower than its column changes nothing else;
   typing past the column's width re-pads every row in that column.
   IME composition is never interrupted: normalization stands down
   during composition and catches up on the first post-composition
   transaction.
4. **Grid dressing**: every line of the table carries a line decoration
   (`mm-table-mode-line`) — a subtle themed background wash so the mode
   is visibly on. Attribute/decoration only; the text is exactly the
   markdown.
5. **Exit**: Esc (a `Prec.highest` keydown ahead of the vim layer —
   with vimNav on, the FIRST Esc leaves table mode, the next one enters
   nav mode); the region ceasing to parse as a table (the user broke
   the delimiter — the mode exits rather than fight); Edit Table…
   re-invoked (§2.3); editor unmount (mode toggle, doc switch). Exit
   removes decorations and chrome; the padding stays — it is real,
   valid markdown. The cursor merely LEAVING the table hides the chips
   (§4) but keeps the mode armed.

## 4. The margin chips (FR-CHIPS)

1. While the mode is active AND the cursor is inside the table, chips
   render for the cursor's cell (row r, column c; the delimiter row
   acts as the header row for column ops and shows no row chips) —
   circular, the SPEC43 theme-menu aesthetic, absolutely positioned in
   the editor pane from CodeMirror coordinates, tracking cursor moves,
   edits, scroll, and resize:
   - **Top border, column edges**: ⊕ `table-add-col-left` at the
     column's left pipe, ⊕ `table-add-col-right` at its right pipe;
     ✕ `table-del-col` centered above the column (disabled on a
     1-column table).
   - **Left margin, row edges**: ⊕ `table-add-row-above` at the row's
     top edge (hidden for the header row — nothing can precede the
     header), ⊕ `table-add-row-below` at its bottom edge; ✕
     `table-del-row` centered on the row (hidden for the header row).
2. Chip actions call §1.4 ops and place the cursor in the first cell of
   the inserted column/row (content position — you add a column to type
   in it), or clamp to the same cell index after a delete. Each is one
   splice, one undo step; the result is already aligned (§1.3), so the
   live filter has nothing to add.
3. The chips are UI overlay only (a positioned layer in `.editor-wrap`,
   like the vim badge) — never CodeMirror content, never document text.

## 5. Editor integration (FR-EDITOR)

The mode's extensions ride one compartment (filter + decorations +
Esc keymap), reconfigured on entry/exit — undo history intact, parked
history (SPEC7 §6) untouched: a remount always starts with the mode
off. `SmartEditHandle` is unchanged; the menu paths run inside the
Editor. Find/replace, diff tint, selection mirroring, and the SPEC43
formatting hotkeys all continue to work inside an aligned table —
formatting a cell's text re-pads like any other edit.

## 6. Styling (FR-STYLE)

`styles.css` only, `--mm-*` variables only: `.mm-table-mode-line`
(background wash), the chip family (`.table-chip`, accent ⊕ / danger ✕,
`.table-chip:disabled`), and the chip layer. Dark themes work for free.

## 7. Security & platform posture

No new dependencies, no src-tauri diff, no new seams, no schema or
pipeline changes — the render pipeline is untouched (padding is
whitespace GFM already ignores). SPEC11's guarantees are unaffected.

## 8. Interactions confirmed unchanged

Comment anchors (preview text never changes shape from padding —
rendered cells trim), scroll sync, SPEC23/24/25 mirrors and carries,
vim nav (§3.5 ordering aside), drafts, and the watcher.

## 9. Tests (added: U69–U70, E109–E112; amended: U65, E107)

Amendments, by name: **U65** — the pinned contextual section becomes
the always-present `table` submenu (children + enabled flags), with
`resize-image` contextual as before. **E107** — the table assertions
open the Table ▸ flyout first, and Edit Table… now enters aligned mode
(the buffer changes only by the normalization padding). No other
existing test may be modified, weakened, skipped, or deleted; E42–E44
stay reserved.

1. **U69** — model basics: parse/serialize round-trips (edged,
   edge-less, ragged, all four alignment forms, `\|` escapes);
   `tableRegionAt` boundaries; serialize idempotence.
2. **U70** — ops and aligned-mode helpers: insert/delete row/col at
   every edge with guards; `setCell` escaping; spans track; starter,
   `insertTableAt`/`deleteTableAt` blank-line rules; `normalizeTable`
   (aligns a ragged table; null on an aligned one); `cellAt` (every
   cell incl. header and delimiter mapping, padding/pipe clamping);
   `normalizeWithCursor` (cursor stays at the same content offset,
   clamps from padding); the amended menu model.
3. **E109** — mode lifecycle: Table ▸ Edit Table… aligns the table
   (pipes line up: every table line same length), cursor still in its
   cell, decorations on; padding persists after exit AND in the saved
   file; entry is one undo step; Esc exits (with vimNav on, first Esc
   exits the mode, second enters nav); re-invoking Edit Table… toggles
   off; works in full-screen edit (no split flip).
4. **E110** — live alignment: typing inside a narrow cell leaves other
   rows untouched; typing past the column width re-pads every row in
   ONE undo step with the keystroke; deleting shrinks back; breaking
   the delimiter row exits the mode; a paste into a cell re-pads.
5. **E111** — column chips: appear at the cursor's column, follow
   cursor moves across cells; add-left/add-right insert an aligned
   empty column with the cursor in its first cell; ✕ deletes (disabled
   at one column); one undo step each.
6. **E112** — row chips + menu ops: add-above/add-below; header row
   hides above-insert and delete; ✕ deletes the row; Insert Table
   drops the starter (selection on `Column 1`, item disabled inside a
   table); Delete Table removes table + separator blank line, one undo
   restores.

## 10. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U70, E1–E41 +
   E45–E112, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` is EMPTY. No new dependencies; version files
   stay 0.4.0-alpha.1; no `.skip/.only/.todo`; the Windows-reserved-name
   scan prints nothing; `git diff --stat docs/specs` limited to this
   file's addition.
3. README: the Smart Edit bullet's table sentence describes aligned
   editing in the editor. ARCHITECTURE.md: an aligned-table-mode
   section — the pure helpers, the transaction-folded re-pad, span
   mapping, the Esc/vim ordering, and the persistence of padding.
