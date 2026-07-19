# SPEC38: Marky Mark v38 — the table grid becomes transient and wraps

Delta spec on top of SPEC.md–SPEC37.md as implemented. This file wins on
conflict; nothing may regress beyond the amendments named in §8. §9 is
the goal condition.

**What ships:** SPEC37's aligned table mode is reworked around two
principles the shipped version got wrong. **One: the grid never looks
out of whack.** The display fits the editor pane: column widths are
capped to the available width and long cell content WRAPS inside its
column across artificial continuation lines — a bordered character grid
(separator lines between every logical row, org-mode style) that always
reads as a table, never as soft-wrap soup. **Two: it is a MODE.** The
grid is a transient display artifact: entering transforms the table
into the grid, exiting collapses it back to a compact one-line-per-row
GFM table with no decorative padding — and while the mode is active,
**the display form never escapes the editor**: saving, the split
preview, drafts, the dirty flag, and the diff tint all see the
collapsed canonical table.

Out of scope: re-flowing on window resize mid-session (the wrap width
is measured at entry; exit/re-enter re-measures); preserving intra-cell
whitespace runs (wrapping joins fragments with single spaces — cell
whitespace normalizes, which rendering collapses anyway); CJK/emoji
display-width padding (unchanged limitation); a cell whose entire
content is dashes (it can mimic a separator line — a documented edge
the round-trip guard below turns into a safe mode-exit); everything
SPEC37 already excluded.

---

## 1. The display grammar (FR-GRID)

While the mode is active the table region holds the **bordered grid**:

```
| Head A   | Head B         |
| -------- | -------------- |
| r1a      | r1b that is    |
|          | wrapped here   |
| -------- | -------------- |
| r2a      | r2b            |
```

1. Every logical row (header included) is a block of one or more
   pipe-aligned lines; long cell content word-wraps into continuation
   lines within its column (a word longer than the column hard-breaks).
2. **Separator lines sit between every pair of logical rows.** The
   first (after the header block) carries the real GFM alignment
   markers (`:---`, `:---:`, `---:`); the rest are plain dashes. This
   makes the grammar PARSEABLE: blocks split on separator lines, block
   0 is the header, and a block's lines are per-cell fragments joined
   with single spaces.
3. Column widths: natural (widest cell), shrunk widest-first until the
   total fits the width budget, floor 8 characters per column; if even
   the floors overflow, the grid may exceed the budget (graceful).
4. The grid is NOT valid GFM — by design. It exists only inside the
   mode; §3's canonical-view rule keeps it out of every artifact.

## 2. Pure layer — `src/lib/tableEdit.ts` additions (FR-LAYOUT)

1. `serializeCompactTable(model)` — the CANONICAL form: one line per
   row, single-space gutters (`| a | b |`), minimal delimiter with
   alignment markers preserved. `insertTableAt`/`deleteTableAt` and the
   §3 collapse all use it (the starter table becomes compact too).
2. `layoutTable(model, widthBudget)` → `{ text, map }` — the §1 grid
   plus its map: per display line {kind: header|separator|row, row,
   fragment}; per cell: fragment display spans and their offsets into
   the cell's logical content. The map answers: which cell holds a
   display offset (`displayCellAt`), and where a (cell, content-offset)
   pair lands in the display (`displayPosOf`) — both exported.
3. `parseDisplay(text, region)` → model | null — the §1.2 grammar
   (escaped pipes respected, empty cells fine); null on any violation.
4. **The round-trip guard**: display text is trusted ONLY if
   `layoutTable(parseDisplay(region), width).text` equals the region
   byte-for-byte. A plain GFM table (e.g. after undoing past entry)
   fails this — its body rows lack separators and would merge — so the
   guard is what makes resynchronization safe.

## 3. The mode, reworked (FR-MODE)

1. **Entry** (Table ▸ Edit Table…, toggle as before): measure the width
   budget from the editor's content geometry (content width /
   character width, small margin), parse the GFM table, splice the §1
   grid in (one isolateHistory event, cursor mapped to its logical
   cell/offset). The field stores {span, width}.
2. **Live editing**: the transactionFilter (user doc changes touching
   the span; IME and undo/redo skipped as in SPEC37) first verifies the
   PRE-edit region passes the round-trip guard (else it lets the change
   through untouched and the watcher exits); then parses the post-edit
   display leniently, re-lays-out, and folds the fix-up into the same
   transaction with the cursor kept at its logical (cell,
   content-offset) — one undo step for the edit and its re-flow, and
   the grid re-wraps as cells grow and shrink.
3. **Resync** (undo/redo/anything foreign): map the span through the
   changes, then apply the round-trip guard; pass ⇒ the mode continues
   on the resulting display state; fail ⇒ the mode exits leaving the
   text as it is (undo history walks back to coherent states — entry,
   edits, and exit are all ordinary history events, exactly SPEC37's
   model).
4. **Exit** (Esc, menu toggle, editor unmount, doc switch): parse the
   display, splice `serializeCompactTable` over it (one isolateHistory
   event, cursor mapped) and clear the field. Unparseable display ⇒
   just clear the field (the §3.3 fail path already left honest text).
   EVERY exit path collapses — after leaving the mode the buffer holds
   the compact table, nothing else. (A table that carried decorative
   padding before entry comes out compact: entering and leaving
   canonicalizes it. Documented, intended.)
5. **Canonical view** (`SmartEditHandle.canonicalText(text)`): identity
   when the mode is off; with it on, the text with the display region
   collapsed to compact. The App routes through it everywhere the
   buffer escapes the editor: the split-preview render, save and Save
   As, the draft shadow-writer, the dirty comparison
   (`canonical !== savedText`), and the changes-since-save diff tint.
   Saving mid-mode writes the compact table and does NOT exit the mode.
6. Chips: unchanged behavior, driven by the display map — the caret in
   any fragment of a cell selects that cell; separator lines behave
   like the delimiter row (column ops only, no row chips). Structural
   ops (§SPEC37 §4.2) rebuild through model + layout.

## 4. Styling (FR-STYLE)

Unchanged classes (`mm-table-mode-line`, chips). Separator lines carry
the same line wash. `--mm-*` variables only.

## 5. Editor integration

`tableMode.ts` owns the grammar plumbing; `SmartEditHandle` gains only
`canonicalText`. The App's five §3.5 call sites are the whole App diff.
No pipeline, seam, schema, or dependency changes; src-tauri untouched.

## 6. Security & platform posture

Unchanged from SPEC37 — no new surface of any kind. The web build ships
identically.

## 7. Interactions confirmed

Comment anchors see the canonical render only (§3.5). The file watcher
already never reloads during edit mode. Find/replace operates on the
display text while the mode is on — matches inside padding are possible
and harmless (documented). Vim/Esc ordering unchanged.

## 8. Tests (added: U71–U72, E113–E114; amended: E107, E109–E112)

Amendments, by name — SPEC38 redefines the display form those tests
pinned: **E107** (Edit Table… enters the bordered grid; after Esc the
buffer holds the COMPACT table — no padding persists), **E109–E112**
(rewritten against the bordered transient display: entry/exit collapse
semantics, separator lines in expected text, otherwise the same
lifecycle, live-alignment, column-chip, and row-chip coverage). No
other existing test may be modified, weakened, skipped, or deleted;
E42–E44 stay reserved.

1. **U71** — layout: compact serializer round-trips; width fitting
   (natural, shrink-widest-first, floor 8, floor-overflow); word wrap
   and hard-break; whitespace normalization; separator placement and
   alignment markers on the first separator only; map correctness
   (`displayCellAt` over every fragment incl. padding clamp,
   `displayPosOf` inverse).
2. **U72** — grammar: `parseDisplay` round-trips every `layoutTable`
   output (property-style over varied models incl. escaped pipes and
   empty cells); the round-trip guard REJECTS a plain GFM table and
   perturbed padding; collapse(parse(layout(m))) === compact(m).
3. **E113** — wrapping end-to-end: a table far wider than the pane
   enters the mode with every display line rendering as ONE visual
   line (no soft wrap: each table `.cm-line` is single line-height);
   typing into a wrapped cell re-flows the grid (still one visual line
   per display line); exiting collapses to one line per logical row.
4. **E114** — the canonical view: with the mode active on a wrapped
   grid, ⌘S writes the COMPACT table to disk (mode stays on); the
   split preview shows a real rendered `<table>` (never the grid
   soup); entering and exiting an already-compact table without edits
   leaves the buffer byte-identical and the dirty dot off; with a real
   in-mode edit the dirty dot is on and save clears it while the mode
   persists.

## 9. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U72, E1–E41 +
   E45–E114, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` is EMPTY; no new dependencies; version files
   stay 0.4.0-alpha.1; no `.skip/.only/.todo`; the reserved-name scan
   prints nothing; `git diff --stat docs/specs` limited to this file's
   addition.
3. README's table sentence reflects the transient wrapped grid.
   ARCHITECTURE.md's SPEC37 section is updated: the display grammar,
   the round-trip guard, and the canonical-view rule.
