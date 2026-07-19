# SPEC40: Marky Mark v40 — the grid is how tables look: no mode, one global view

Delta spec on top of SPEC.md–SPEC39.md as implemented. This file wins on
conflict; nothing may regress beyond the amendments named in §6. §7 is
the goal condition.

**What ships:** the per-table mode dies. **Every valid table in the
editor renders as the SPEC38 grid by default** — opening a document in
edit mode shows all its tables as fitted, bordered, wrapped grids;
typing a new table snaps it into a grid the moment its delimiter row
completes; everything SPEC38/39 built (live re-fit, cell confinement,
chips, spaces, canonical view) applies to every table at once. One
**global setting** — `tableGridView`, default ON — switches between
grid view and raw view for ALL tables, from Settings and from the
Table ▸ submenu. The per-table ceremony is removed: no Edit
Table…/Exit Table Mode item, no TABLE pill, no Done, no Esc exit (Esc
returns to the vim layer untouched).

Out of scope: per-table overrides (the view is global by design);
everything SPEC38/39 excluded (CJK widths, whitespace runs, rectangular
selection); any new dependency or src-tauri change.

---

## 1. The setting and its two switches (FR-VIEW)

1. `Settings.tableGridView: boolean`, default **true**; persisted and
   parsed with the standard per-key fallback. UI: a checkbox on
   Settings → Editor — "Show tables as grids in the editor"
   (test id `settings-table-grid`).
2. The Table ▸ submenu replaces `edit-table` with **`toggle-grid`**:
   labeled **"Show Raw Tables"** while the view is on and **"Show Table
   Grid"** while off; always enabled; invoking flips the setting (all
   tables at once, persisted). `SmartMenuCtx.tableMode` becomes
   `gridView: boolean`. Insert Table / Delete Table stay as they are.
3. Flipping OFF collapses every grid to its compact table; flipping ON
   transforms every valid table to a grid — both directions history-
   transparent (`addToHistory: false`; view flips are not edits) with
   the cursor kept at its logical cell/offset when inside a table.

## 2. Grid-for-all (FR-ALL)

1. The mode field becomes the **grid set**: `{spans: Array<{from,to}>,
   width}` — every tracked table, one shared width budget. Spans map
   through every transaction; the SPEC38 filter/guard/watcher logic
   applies PER SPAN (an edit re-lays-out its own table; a foreign
   change failing a span's guard drops THAT span to raw text, leaving
   the others).
2. **Detection**: with the view on, any valid top-level GFM table not
   currently tracked transforms to a grid — at editor mount and
   whenever a transaction leaves one in the document (so a hand-typed
   table snaps to grid the moment its delimiter row completes, and a
   raw-dropped span re-grids once it parses again). Mount and
   detection transforms are history-transparent; the canonical dirty
   comparison (SPEC38 §3.5) keeps the dot off — opening a document
   changes nothing observable.
3. **Unmount/doc switch** collapses every grid (history-transparent)
   and reports the canonical buffer, exactly generalizing SPEC38 §3.4.
4. `canonicalText` collapses ALL tracked spans; the five SPEC38 §3.5
   App call sites are unchanged in shape.
5. Re-fit (SPEC39 §1) re-lays-out every grid on geometry changes;
   confinement, chips, Enter/Tab navigation, the space rules, and
   separator read-onlyness (SPEC39 §2) apply within whichever grid
   holds the caret. Chips render for the caret's table only.

## 3. Removed surface (FR-GONE)

The TABLE pill, `table-mode-done`, the Esc exit handler, and
`enterTableMode`/`exitTableMode` as user-facing operations are gone
(internal transform helpers may remain). Esc passes to the vim layer
directly again. Nothing else about Smart Edit changes.

## 4. Pure additions (FR-PURE)

`allTableRegions(text)` — every top-level GFM table region in document
order (the tableRegionAt scan, exhaustively). DOM-free, unit-tested.

## 5. Interactions confirmed

Insert Table drops the compact starter, which detection immediately
grids (the selection lands on `Column 1` in the GRID). Delete Table
removes its table; the span drops from the set. Find, diff tint,
drafts, comments, and the web build behave per the canonical view as
before.

## 6. Tests (added: U74, E119–E120; amended: U65, E107, E109–E118)

Amendments, by name: **U65** — the Table submenu pins
`toggle-grid`/`insert-table`/`delete-table` with the §1.2 labels per
`gridView`. **E107** — the table-context steps use the always-on grid
(no entry click). **E109–E118** — rewritten to the global-view world,
preserving their coverage: lifecycle asserts become view-flip asserts
(E109), live re-flow/chips/wrapping/canonical/confinement tests enter
via the DEFAULT grid instead of a menu click (E110–E116, E118), and
E117's chrome coverage becomes the two toggle switches. No other
existing test may be modified, weakened, skipped, or deleted; E42–E44
stay reserved.

1. **U74** — `allTableRegions`: none/one/many tables, adjacency and
   ordering, offsets exact, non-tables skipped; setting parse fallback
   for `tableGridView` (default true).
2. **E119** — grid by default: opening a document with TWO tables
   shows both as grids (separators present, all lines single visual
   height), dirty dot OFF; saving writes both compact; typing a new
   raw table snaps it to a grid when the delimiter completes; deleting
   one grid's source leaves the other grid intact.
3. **E120** — the global toggle: Table ▸ "Show Raw Tables" collapses
   BOTH tables to compact raw text (labels flip, setting persists
   across reload); Settings → Editor checkbox does the same and stays
   in sync; flipping back re-grids both; neither flip pollutes undo or
   the dirty dot.

## 7. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U74, E1–E41 +
   E45–E120, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` is EMPTY; no new dependencies; version files
   stay 0.4.0-alpha.1; no `.skip/.only/.todo`; the reserved-name scan
   prints nothing; `git diff --stat docs/specs` limited to this file's
   addition.
3. README's table passage describes the default grid view + the global
   toggle. ARCHITECTURE.md's table section is updated: grid set,
   detection, the removed mode surface.
