# Spec: Table grid: drag selection inside a wrapped cell only covers the caret's line; the cell clamp must span the whole cell (#346)

## Goal

All acceptance criteria in issue-specs/issue-346.md are satisfied for issue
#346, with evidence visible in the session: a ranged selection with an endpoint
inside a SPEC40 grid cell clamps to the WHOLE cell — the union of that cell's
content fragments across every display line it wraps onto (first fragment's
content start through the last non-empty fragment's content end), not the
fragment on the pivot's display line — for pointer drag, Shift+click,
Shift+arrow (up/down included), Shift+Home/End and ⌘A, while SPEC39 §2.1's
one-cell confinement and pivot rule stand and every existing SPEC39/#344
assertion (E118, E611) stays green; ⌘A with the caret in a wrapped cell selects
the whole cell and a second ⌘A selects the document; ⌘C over a whole-cell
selection lands the cell's joined visible text (wrap joins as single spaces, no
pipes or padding) on the clipboard shim; a highlight made over a whole-cell
selection anchors to the canonical cell text and survives reload in editor and
preview; a new pure whole-cell helper in `editor/src/lib/tableEdit.ts` has
unit tests for wrapped cells; SPEC39 §2.1 says "whole cell across wrapped
lines" and `docs/MAP.md` is regenerated; `npm run validate:quick` passes in
the implementer's session; and a summary comment from the implementer exists
on issue #346.

## Acceptance criteria

### The whole-cell span (issue Reqs 2, 3)

- A pure helper in `editor/src/lib/tableEdit.ts` (suggested name
  `displayWholeCellBounds`, or an added `wholeContentStart` /
  `wholeContentEnd` pair on `displayCellBounds`'s result — the implementer's
  call) resolves a display offset inside a grid region to its cell's
  whole-cell content span: absolute `contentStart` of the cell's first
  fragment (row block's first display line) and `contentEnd` of the cell's
  LAST non-empty fragment, across every display line of that row block. It
  also exposes the per-line fragments of the cell (each fragment's
  content start/end and display line) so callers can snap endpoints (below)
  and join text for copy. For a cell that does not wrap it equals the
  existing per-line `displayCellBounds` content span. For an empty cell it
  is the cell's content position on the row block's first line (start ==
  end). Separator lines keep reporting `kind: 'separator'` and never yield a
  whole-cell span. Hard-break fragments (SPEC38's `↩` marker) count as
  content up to and including the marker for display offsets; the marker is
  dropped from joined text (below).
- The SPEC39 §2.1 clamp in `editor/src/components/tableMode.ts`
  (`alignFilter`, the `!tr.docChanged` branch) clamps both endpoints of a
  ranged selection into the pivot cell's WHOLE-cell span, not the pivot
  line's fragment. The pivot rule is unchanged from SPEC39 §2.1 and today's
  code: the head's cell when the head is inside a cells-line cell of a grid
  span; the anchor's cell when the head is outside every grid. One
  extension: when the anchor is inside a cells-line cell of a span and the
  head sits on a SEPARATOR line of that same span (Shift+ArrowDown/Up off
  the cell's last/first line), the selection clamps to the anchor's
  whole-cell span instead of collapsing to a caret, so the head lands at the
  cell's content end (down) or content start (up). Head on a separator with
  no in-cell anchor keeps today's collapse.
- After clamping into the whole-cell span, an endpoint that does not lie on
  one of the cell's own fragments (it sits in padding, a gutter, a pipe, the
  newline, or another column's fragment on an intermediate display line)
  snaps to the nearest content position of the cell: the cell's fragment on
  that endpoint's own display line when there is one (its content end when
  the endpoint is past it, its content start when before it), else the
  nearest fragment edge. Dragging past the cell's last fragment therefore
  clamps to the cell's content end; dragging before its first fragment
  clamps to its content start. `selection.main.from/to` of a drag from the
  cell's first line to its last line equal the union of the fragments'
  content offsets (first fragment content start, last fragment content end).
- The selection is one contiguous CodeMirror range (no multi-range /
  rectangular selection is introduced): the tint renders across every
  wrapped display line of the cell.
- ⌘A (`Mod-a` in `confineKeymap`) with the caret in a cells-line cell selects
  the whole-cell span. When the main selection ALREADY equals the whole-cell
  span, `Mod-a` is not consumed (returns false) so CodeMirror's `selectAll`
  runs and the SPEC38 escape hatch (both endpoints outside the grid) lets
  the document-wide selection through. On a separator line ⌘A stays inert.
- Shift+Home/Shift+End with the head in a wrapped cell produce a selection
  within that cell's whole-cell span (snapped per the rule above); E118's
  existing Shift+End assertion (`selText` === `'2'` in the unwrapped
  fixture) is unchanged.
- Confinement stays (issue Req 1): a ranged selection whose pivot cell
  differs from the other endpoint's cell still clamps to exactly one cell's
  content; cross-boundary selections remain clamped; both-endpoints-outside
  selections remain allowed (SPEC38 escape hatch). E118 and E611 stay green
  as written (E611's comment documents the head-pivot rule; keep it true).

### Edits over a whole-cell selection never break the grid (SPEC39 §2.6)

- A single-range document change whose replaced range equals, or lies
  within, a multi-line whole-cell selection (typing a character, Backspace,
  Delete, Cut, paste) replaces the cell's LOGICAL content covered by the
  selection with the sanitized insert (`sanitizeCellInsert`) and re-lays the
  grid out — it never splices pipes, gutters or newlines, the row's other
  cells are untouched, the grid survives, and it is one undo step. The
  simplest acceptable shape: rewrite the transaction in `alignFilter` to
  replace the cell's content (the fragments joined per SPEC38's rule) in
  the compact model and re-layout, mirroring what the existing single-line
  path does. Whole-cell + type `X` over the three-line fixture cell yields a
  row whose cell reads `X`; ⌘Z restores the three lines.

### Copy (issue Req 4)

- ⌘C / ⌘X and the menu `copy` / `cut` commands over a selection confined to
  one grid cell put the cell's VISIBLE text for the selected range on the
  clipboard: the selected parts of the cell's fragments joined with single
  spaces (SPEC38's join rule), hard-break `↩` pieces joined with no space
  and the marker dropped, no pipes, no padding, no newlines. A pure helper
  in `editor/src/lib/tableEdit.ts` (suggested `cellSelectionText(text,
  region, parsed, from, to)`) computes it and is unit-tested. In the e2e
  shim the text is observable as the last entry of `window.__mmClipboard`
  (the SPEC35 `copyText` seam in `src/platform/browser.ts`); a keyboard copy
  in the editor must reach that seam (a `copy`/`cut` DOM handler that sets
  `clipboardData` text/plain and forwards to the platform `copyText`, or
  an equivalent route the implementer can justify). Selections outside every
  grid keep today's copy behaviour byte-for-byte.

### Highlight / Comment (issue Req 5)

- A highlight or comment made over a whole-cell (multi-line) selection or a
  partial-cell selection anchors to the canonical file text of that cell
  through the existing issue #344 seam (`docToCanonOffset` in
  `editor/src/lib/gridOffsets.ts`): one sidecar record whose `anchor.exact`
  is the selected canonical cell text; after save + reload it paints as
  `.mm-hl[data-cid]` over the cell in the editor grid (every wrapped line
  the range covers) and over the cell in the preview. Issue #344 Req 5's
  "refused or clipped" for cross-cell ranges stands.

### Unchanged behaviour (issue Req 6)

- Enter / Shift+Enter / Tab / Shift+Tab cell navigation (SPEC39 §2.3), edge
  deletions (§2.4), pipe self-escape (§2.5), the pending edge-space (§2.2)
  and the SPEC38 escape hatch for selections wholly outside the grid behave
  exactly as before; E110, E113, E115, E118, E119, E119b, E120 and E611 pass
  unmodified.

### Tests, spec text and map

- Unit tests (vitest, `editor/tests/table-edit.test.ts`, next free U-numbers —
  U1359 onward at spec time) cover the whole-cell helper and the join helper
  on a `layoutTable` display whose cell wraps over at least three display
  lines: whole-cell start/end from an offset on each of the three lines;
  unwrapped cell equals `displayCellBounds`; empty cell; separator line; a
  hard-break (`↩`) cell; the endpoint snap rule for an offset in padding /
  another column's fragment on an intermediate line; `cellSelectionText`
  for the full cell, a partial range within one fragment, a range spanning
  the wrap join, and a hard-break join (no space, marker dropped).
- E2e (Playwright, `tests/e2e/tables.spec.ts`, next free E-numbers — E613
  onward at spec time) on a fixture opened with `openGridDoc` whose one cell
  wraps over exactly three display lines (long cell content plus, if needed,
  `page.setViewportSize` as E115 does; assert the row block has three
  `.mm-table-mode-line` lines before the checks). Covered: (a) a real
  pointer drag (`page.mouse` as `dragAcrossText` does) from line 1 to line 3
  of the cell selects the full content — `window.__mmEdit.selFrom`/`selTo` equal the
  fragments' union and the tint covers all three lines (e.g. at least three
  `.cm-selectionBackground` rects, or a selection rect intersecting each
  line's box); (b) Shift+ArrowDown from line 1 extends within the cell to
  line 2, then to line 3, then stays clamped at the cell's content end; (c)
  ⌘A with the caret on line 2 selects the whole cell (`selText` spans all
  three fragments), a second ⌘A selects the document; (d) a drag from the
  wrapped cell into the neighbouring cell yields a selection confined to
  exactly one cell (no `|` in `selText`, from/to inside one cell's
  whole-cell span — the pivot cell per SPEC39 §2.1); (e) ⌘C over the
  whole-cell selection lands the joined text on `window.__mmClipboard`
  (last entry), no pipes; (f) highlight over the whole-cell selection
  (`smartEditAnnotation(page, 'highlight', 'hl-yellow')` as E611) creates one
  sidecar record with `anchor.exact` equal to the cell's canonical text,
  and after reload it paints in the editor grid and in the preview
  (`restoredInPreview`-style round trip); (g) typing over the whole-cell
  selection replaces the cell content and one ⌘Z restores it.
- `docs/specs/SPEC39.md` §2.1 ("Selection clamp") is clarified to say the
  clamp target is the whole cell across its wrapped display lines (first
  fragment's content start through last fragment's content end), that a
  head on a separator line with an in-cell anchor clamps to the anchor's
  cell, that copy over a cell selection yields the joined visible text, and
  that ⌘A selects the current cell and a second ⌘A the document. New or
  changed behaviour carries `// SPEC39 §2.1:` citations per
  `.sandcastle/CODING_STANDARDS.md`; `docs/MAP.md` is regenerated with
  `npm run map` and committed (the gate diffs it).

### Process

- The implementer iterates with `npm run typecheck` and `npm run test:unit`
  (or tests targeted at the changed code, e.g.
  `npx playwright test -g 'E613'`), baselines with the quick tier only, and
  runs `npm run validate:quick` ONCE right before declaring the goal met — it
  prints `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #346.

## Context

- The clamp lives in `editor/src/components/tableMode.ts` `alignFilter`
  (the `!tr.docChanged` branch, ~L154–176) and calls `displayCellBounds`
  (`editor/src/lib/tableEdit.ts` ~L824), which resolves the cell on the
  offset's DISPLAY LINE only — in a SPEC38 wrapped grid the cell's other
  fragments sit on following lines of the same row block, so the clamp cuts
  a multi-line selection to one fragment. `caretCell` (~L694) feeds the
  same per-line bounds to the `Mod-a`, Backspace, Delete and Space keys.
- The display map already knows fragments: `layoutTable` emits
  `DisplayMap.fragments` (row, col, frag, contentOffset, length, from/to)
  and `parseDisplay` gives `lineInfo` per physical line (kind, row, frag);
  `displayCellAt` walks prior fragments of the same (row, col) — the same
  walk yields the whole-cell union. `lineCellSpans` gives per-line cell
  spans. `displayPosOf` maps (row, col, contentOffset) back to a display
  offset. `HARD_BREAK` (`↩`) marks hard-broken fragments (no joining space).
- Do NOT flip the pivot to the anchor for same-line cross-cell selections:
  the issue text says "clamps to the origin cell", but SPEC39 §2.1, E118's
  Shift+End assertion (`'2'`, the head's cell) and E611's comment all pin
  the head's cell. The spec keeps that rule and only extends the
  separator-line case; the issue's "origin cell" criterion is satisfied by
  confinement to exactly one cell.
- Copy: keyboard ⌘C goes through CodeMirror's native copy today; only the
  menu `copy` command (`editor/src/components/Editor.tsx` ~L1817,
  `sp.onCopyText`) reaches the platform `copyText` seam that records
  `window.__mmClipboard` (`src/platform/browser.ts` ~L499). The e2e
  criterion reads that array, so the keyboard path must reach it.
- Annotation seam: `Editor.tsx` ~L1543–1565 maps `sel.from`/`sel.to` through
  `docToCanonOffset` (`editor/src/lib/gridOffsets.ts` ~L262); both ends of a
  whole-cell range resolve to the same canonical cell, so the existing seam
  should already anchor correctly once the clamp allows the range — verify,
  do not assume. E608/E611 in `tests/e2e/comments.spec.ts` are the models
  (`GRID_SOURCE`, `gridRecords`, `smartEditAnnotation`).
- Out of scope: Backspace at the start of a continuation fragment (per-line
  "edge" today) and Delete at a fragment's end; SPEC39 §2.4 stays as is.
- Helpers: `openGridDoc`, `caretInto`, `dragAcrossText` in
  `tests/e2e/helpers.ts`; `window.__mmEdit` exposes `selText`, `selFrom`, `selTo` (and the
  rest of the edit-state seam) from `Editor.tsx`. Highest test numbers at spec time:
  E612, U1358.
- Commands: `npm run typecheck`, `npm run test:unit`, `npm run test:e2e`,
  `npm run map`, `npm run validate:quick` (all in `package.json`).
