# Spec: Table grid: preview↔editor selection, caret and scroll sync use raw offsets; translate canonical↔display at every seam (#357)

## Goal

All acceptance criteria in issue-specs/issue-357.md are satisfied for issue #357, with evidence visible in the session: the editor package exposes ONE canonical↔display translation seam for offsets and 1-based lines (total functions, identity with no grid spans, built on `editor/src/lib/gridOffsets.ts`' span geometry) and every crossing in the audit table goes through it — `selectSourceRange` translates canonical→display before dispatching, the `EditStateReport` carries canonical `selFrom`/`selTo`/`canonHead`/`headLine`, and `topLine`/`scrollToLine`/`goToLine`/`goToHeading` speak canonical lines; with two grid tables (one wrapped cell) above prose in split mode, a preview phrase selection selects exactly that phrase in the editor, a word selected in a preview cell selects it in the matching grid cell, a two-cell preview selection clamps to the first cell, an editor phrase selection mirrors as `mark.mm-mirror-sel` over exactly that phrase, a preview click lands the caret on the clicked canonical offset, `#heading` / `#hl-` fragments and sync scroll land on the same text in both panes, and the Table ▸ grid toggle preserves the selection text; new e2e tests (E634+) and unit tests cover these, every SPEC23/25/40/44 and #260/#300/#310/#344/#345 test stays green, the affected specs are amended and `docs/MAP.md` regenerated; `npm run validate:quick` prints `QUICK VALIDATION: ALL PASSED` in the implementer's session; and a summary comment from the implementer exists on issue #357.

## Acceptance criteria

### Process (read first)

- Iterate with `npm run typecheck` and `npm run test:unit` (or `npx vitest run
  <file>` / `npx playwright test -g '<title>'` targeted at what changed).
  Baseline an attempt with the quick pair only. Run `npm run validate:quick`
  ONCE, right before declaring the goal met — never after each small change —
  and it prints `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #357 (what changed,
  which seams were audited, test IDs added, the gate output).
- Rules of `.sandcastle/CODING_STANDARDS.md` hold: every new behaviour carries
  a `// SPEC<n> §x.y (issue #357): …` citation; new tests take the next unused
  IDs (e2e from E634, unit from U1371 — re-check with grep before numbering);
  no existing test is weakened, skipped or renumbered.

### The one mapping seam (issue Req 1, 7)

- The editor package (`editor/src/lib/gridOffsets.ts`, or a sibling pure
  module re-exported from `editor/src/index.ts`) exports a canonical↔display
  translation built from one `SpanGeometry[]` (the geometry
  `gridGeometry(state)` in `Editor.tsx` already builds; move or export that
  builder so nothing re-derives it):
  - offsets: `canonicalToDisplay(offset)` and `displayToCanonical(offset)`
    — TOTAL functions (a number, never null) used for selections, carets and
    scroll targets. Outside every span they are the shift the existing
    `canonToDocOffset` / `docToCanonOffset` compute. Inside a span they resolve
    through the cell (`displayCellAt` / `displayPosOf`, wrapped-cell fragments
    included); an offset with no honest cell home (a canonical delimiter line,
    display padding, a pipe, a separator line, an untrusted display) snaps to
    the nearest content position of that row (or, for a delimiter line, the
    corresponding separator line's start) rather than returning null. The
    existing nullable `canonToDocRanges` / `docToCanonOffset` painting API and
    its PRD 022 Req 12 skip rule are unchanged; the total functions are
    layered on them, not a rewrite.
  - lines (1-based, fractional allowed): `canonicalLineToDisplay(line)` and
    `displayLineToCanonical(line)` consistent with the existing
    `canonicalLineAt` / `canonicalLineMapper` (a canonical row of a wrapped
    grid row maps to that row's FIRST display line; every display line of a
    wrapped row maps back to the one canonical row; the fractional part is
    carried through).
  - identity, and allocation-free, when no grid span is tracked (issue Req 7:
    grid view off is byte-identical to today — existing tests prove it).
- Every crossing in the audit table below uses this seam; no caller does its
  own delta arithmetic, and `mapOffsetByLineFlat` is no longer used as a
  canonical-offset mapper for the report seam (it may stay for SPEC44 §3.1's
  rendered-text purpose; if nothing uses it any more, delete it and its test).
- Unit tests (`editor/tests/grid-offsets.test.ts` or a new
  `editor/tests/grid-seam.test.ts`, `describe('SPEC40 §2 canonical ↔ display
  seam (issue #357)')`) cover offsets AND lines: before / inside / after one
  grid, inside a wrapped cell (each fragment), two grids (the delta
  accumulates), the delimiter/separator/padding/pipe fallbacks, both
  directions round-trip on content positions, and identity with no spans.

### Audit table — every seam that crosses, and its fix

The implementer verifies each row against the code (line numbers are
approximate) and fixes it through the seam; a row found already correct is
left alone but noted in the issue comment.

| Crossing | Where today | Direction | Fix |
|---|---|---|---|
| Preview→editor mirror (SPEC23 §1) | `src/App.tsx` mirror effect (~L7140) → `editorSelectRef` → `selectSourceRange` (`Editor.tsx` ~L1145) uses canonical `from`/`to` raw | canon→display | `selectSourceRange` translates both ends before clamping/dispatching; the SPEC39 §2.1 clamp then applies (a two-cell range becomes one clamped cell). |
| Preview click → caret (SPEC44 §4 / #345) | `placeFromPreviewClick` (~L1554) → `editorSelectRef(caret, caret)` | canon→display | same `selectSourceRange` path. |
| SPEC25 §1 carry into edit | `pendingSelectionRef` applied at mount (`Editor.tsx` ~L2415) | canon→display | same path (translate AFTER the grid mounts/adopts, so the geometry exists). |
| Editor→preview mirror (SPEC23 §1 / SPEC24) | update listener (`Editor.tsx` ~L2336) and mount seed (~L2540) report raw `selFrom`/`selTo`; `handleEditState` (~L1600) slices the canonical buffer with them | display→canon | `EditStateReport.selFrom/selTo` (and `canonHead`, `headLine`) become CANONICAL; raw `head`/`selAnchor`/`selHead` stay raw and documented as such (the #356 drag tests read them). `window.__mmEdit` gains `canonFrom`/`canonTo` (typed in `src/platform/browser.ts`) so tests can assert them. |
| SPEC25 §2 carry into preview | `lastEditorSelRef` ← `s.selFrom/selTo` (~L1605) | display→canon | falls out of the report being canonical. |
| Head-row anchor / follow (#310, SPEC45) | `stampHeadAnchor(pane, s.canonHead, s.headLine)` uses `mapOffsetByLineFlat` and a RAW `headLine` | display→canon | canonical `canonHead` via the seam; `headLine` canonical via the line seam. |
| Sync scroll, editor leads (SPEC15) | `SplitView.tsx` `offsetForLine(anchors, …, ed.topLine())` — anchors are canonical, `topLine()` raw | display→canon | `topLine()` returns the canonical fractional line. |
| Sync scroll, preview leads | `ed.scrollToLine(lineAtOffset(…))` — canonical line into raw `doc.line(n)` | canon→display | `scrollToLine`, `goToLine`, `goToHeading` translate the line first (a canonical row inside a wrapped grid row lands on its first display line). |
| Mode-switch scroll carry + reading positions (SPEC16 §3, PRD 012) | `pendingScrollLineRef ← editorSyncRef.topLine()` (~L4129, ~L4164); restore via `ed.scrollToLine(line)` (~L6685) and the `topLine()` landing check | both | falls out of the two handle fixes; verify a position recorded in edit below a grid restores to the same block in preview. |
| `#heading` / `#hl-` landings (PRD 020 Req 19, #260, #300) | `landOnFragment` (~L4640): `ed.rawLinesOf(line)` (already mapped) + `ed.goToHeading(line)` + `now.topLine() - line` check | canon→display | `goToHeading` and `topLine` fixes; `rawLinesOf` stays. `#hl-` uses `revealHighlight` / painted marks (already canonical via `docHighlightRanges`): verify, do not rewrite. |
| Comment navigator (SPEC14) in edit | `revealHighlight(id)` | — | already mapped through `docHighlightRanges`; verify E421/E445/E568 stay green. |
| Search landing (SPEC40 / #313) | `landSearchMatch` → `rawLinesOf` + `landSearchHit` (raw offsets) | — | already correct by design; keep E548 green. `landSearchHit`'s contract is documented as RAW/display offsets. |
| Annotation seam (#344) | `annotationSelection` (`Editor.tsx` ~L1690) uses `docToCanonOffset` with a `mapOffsetByLineFlat` fallback | display→canon | the fallback becomes the seam's total `displayToCanonical`; painting is unchanged. E608–E612, E616 stay green. |
| Grid toggle (SPEC40 §1.2) | `tableMode.ts` detect/adopt `mapPoint` (~L540) and the collapse path map the caret only | both | a RANGED selection survives the toggle in canonical terms (both ends mapped, then clamped per SPEC39 §2.1 when inside a cell). |

### Observable behaviour, e2e (issue acceptance list)

Each test below is a new numbered test (E634 onward) in `tests/e2e/split-view.spec.ts`
or `tests/e2e/tables.spec.ts` (the implementer's choice, one file per
behaviour area), written to FAIL before the fix. The fixture is written by the
test (via `bootEditorOn` / `openGridDoc` / `splitApp` in `tests/e2e/helpers.ts`):
two GFM tables — the second with a cell long enough to wrap at the split
width — followed by a heading and at least two prose paragraphs, opened in
split edit with grid view on (the SPEC40 default). Canonical offsets in
assertions are computed from the fixture string in the test, never hard-coded.

- Preview prose → editor: selecting a phrase in the preview's prose below both
  tables (`selectPhraseInPane`) yields an editor selection whose `selText`
  (`window.__mmEdit`) equals the phrase and whose `canonFrom`/`canonTo` equal
  the phrase's offsets in the canonical buffer.
- Preview cell → editor: selecting one word inside a preview table cell (first
  table; then a word in the second table's wrapped cell) yields an editor
  selection whose text is that word and whose range lies inside the matching
  grid cell (`__mmEdit.selFrom/selTo` raw range within the cell's display
  bounds on the expected `.mm-table-mode-line`).
- Preview across two cells → editor: selecting from the end of one cell into
  the next yields an editor selection clamped to the FIRST cell's content
  (SPEC39 §2.1 rule A/B as applicable), non-empty, no page error (`pageerror`
  listener asserts none), and no stray range in `window.__mmSelLog`.
- Editor → preview mirror: selecting the prose phrase in the editor (below
  the tables) wraps `mark.mm-mirror-sel` around exactly that phrase in the
  split preview (joined mark text equals the phrase, no other mirror marks).
  A selection inside a grid cell mirrors onto that cell's text in the
  preview table.
- Preview click → caret: a plain click on a word below the tables in the split
  preview places the editor caret with `__mmEdit.canonHead` equal to the
  clicked canonical offset (`wordRect` + `clickCharBoundary` pattern from
  E623), neither pane scrolls (E623's model); in preview-only mode the same
  click then ⌘E lands the caret at the same canonical offset (E624's model).
- Fragment landings: booting on `#<slug-of-heading-below-tables>` in edit and
  in split lands the editor with the heading line at the viewport top and the
  caret on its text (`editorCaret` helper; extends E576's assertions) — and
  the split preview shows the heading; booting on `#hl-<id>` of a highlight
  below the tables (sidecar written by the test, E430/E451 pattern) centres
  and flashes it in both surfaces.
- Sync scroll into a wrapped row: with sync scrolling on, scrolling the editor
  so the second table's wrapped row is at the viewport top puts the preview's
  second table row in view (`previewTopAnchorLines` brackets the table's
  canonical line); and scrolling the preview to the paragraph below the tables
  brings the editor's top gutter line to that paragraph's DISPLAY line (the
  canonical line plus the grids' extra rows).
- Grid toggle: with the prose phrase selected, Table ▸ toggle grid off then on
  leaves `__mmEdit.selText` equal to the phrase both times; with a word
  selected inside a cell, the same toggle keeps that word selected both times.
- Grid view off (issue Req 7): with raw tables, the preview→editor mirror of
  the prose phrase and of a cell word select exactly the raw text (E80's
  assertions hold with a table above the phrase).
- Regression: E80, E146, E464, E555–E559, E576, E411, E430, E451, E608–E612,
  E616, E623–E624, E626–E633 and the SPEC40/SPEC25 suites pass unchanged.

### Documentation

- SPEC23 §1, SPEC25 §1–2, SPEC40 §2 and SPEC44 §4 each gain a dated
  amendment (issue #357) naming the seam: every canonical offset or line
  entering the editor, and every editor offset or line leaving it, translates
  through it; `EditStateReport`'s canonical fields are named. `SPEC15`/`SPEC45`
  (sync scroll) get one line stating `topLine`/`scrollToLine` are canonical.
- `docs/MAP.md` is regenerated with `npm run map` and committed.
- If `docs/ARCHITECTURE.md` describes the report seam or the sync handle, its
  sentence is corrected; no new architecture prose otherwise.

## Context

Behaviour is found by citation-grep (`rg 'SPEC23 §1|SPEC44 §4|issue #310|issue #344' src editor`), never by reading `src/App.tsx` whole. The pieces already in place: `editor/src/lib/gridOffsets.ts` (issue #344) holds the per-span geometry and the nullable painting-grade offset mappers in both directions, with tests in `editor/tests/grid-offsets.test.ts`; `Editor.tsx`'s private `gridGeometry(state)` builds that geometry; `tableMode.ts` has `canonicalizeAll`, `canonicalLineAt` (raw line → canonical) and `canonicalLineMapper` (canonical line → raw lines), and `tableEdit.ts` has `displayCellAt` / `displayPosOf` / `displayWholeCellBounds`. The two broken primitives are `selectSourceRange` (canonical in, dispatched raw) and the `EditStateReport` (raw `selFrom`/`selTo`, a same-line-index `mapOffsetByLineFlat` for `canonHead`, a raw `headLine`), plus the `EditorSyncHandle` line methods (`topLine`, `scrollToLine`, `goToLine`, `goToHeading`) which take/return raw line numbers while every App caller and `SplitView.tsx` (`offsetForLine` / `lineAtOffset` over canonical `data-mm-line` anchors) speaks canonical lines. `rawLinesOf` / `landSearchHit` / `revealHighlight` are already canonical-aware and are the model to follow. The SPEC39 §2.1 clamp (`clampSelectionToCell` behind `alignFilter`, issue #356) runs on every selection transaction, so a translated preview range inside a table is clamped for free; the seam only has to land the ends in the right cell. Test seams: `window.__mmEdit` / `__mmSelLog` (browser shim, `src/platform/browser.ts`), helpers `bootEditorOn`, `openGridDoc`, `splitApp`, `selectPhraseInPane`, `wordRect`, `editorCaret`, `editorTopGutterLine`, `previewTopAnchorLines` in `tests/e2e/helpers.ts`; E623/E624 (preview click), E80/E146 (mirror), E555–E559 (follow), E576 (fragment in edit), E626–E633 (drag clamp) show the assertion patterns. The e2e suite is minutes and machine-serialized: run single tests with `npx playwright test -g 'E634'` while iterating.
