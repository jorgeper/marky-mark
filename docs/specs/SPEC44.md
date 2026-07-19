# SPEC44: Marky Mark v44 — where am I? (active line & word, both panes)

Delta spec on top of SPEC.md–SPEC43.md as implemented (SPEC31 remains
spec-only). This file wins on conflict; nothing may regress. §8 is the
goal condition.

**What ships:** the editor's active-line tint gets a mirror in the
preview, and both panes gain a darker **active-word** highlight under
the caret. Clicking anywhere in the preview — split **or** preview-only
mode — selects the word under the pointer the same way, and in split
mode moves the editor caret to it. One glance at either pane answers
"where am I in this file?".

Out of scope: highlight-all-occurrences, multi-caret, touch/pen
pointers, a settings toggle (always on), persistence of the active word
across restarts (reading positions already cover the scroll), the
find/replace and comment highlight systems (unchanged), the web build
diverging (same behavior there — this is pure webview UI).

---

## 1. Pure logic (FR-LOGIC)

`src/lib/activePosition.ts` (new, pure, no DOM):

1. `wordAt(text, offset): { start, end } | null` — the Unicode-aware
   word (`\p{L}\p{N}_`) containing or immediately left of `offset`;
   null on whitespace/punctuation runs and empty lines.
2. `blockLineFor(anchors, line): number | null` — given the sorted
   `data-mm-line` anchor list and a 1-based source line, the anchor
   line of the block containing it (the greatest anchor ≤ line); null
   before the first anchor.
3. Reuses `selectionMap.ts` for offset mapping — no new mapping code.
   Any extension needed there lands as new pure exports with U-tests.

## 2. The editor side (FR-EDITOR)

1. The active-line highlight stays exactly as it is (CodeMirror
   `cm-activeLine`, themed `--mm-active-line`).
2. NEW: the word under the primary caret carries a darker tint — a
   CodeMirror decoration (class `mm-active-word`), recomputed on
   selection change, cleared while a non-empty selection exists (a real
   selection outranks the word cue) and during find/replace input focus.
3. Styling: `--mm-active-word` (fallback: the active-line color at
   roughly double strength, e.g. `rgba(9, 105, 218, 0.16)`); themes may
   override both variables. Never obscures the selection color, comment
   marks, or find marks — stacking order: find > selection > comments >
   active word > active line.

## 3. The preview mirror (FR-PREVIEW)

1. While the editor pane has focus (full edit and split modes), the
   preview marks:
   - **the active block** — the `[data-mm-line]` element whose range
     contains the caret's source line (§1.2) gets `mm-active-block`,
     tinted `--mm-active-line`. Exactly one block, or none (caret
     outside any anchored block, e.g. front matter). A stamp can cover
     a whole list or table; when the word mark exists, the tint moves
     to the word's INNERMOST standard container (list item, paragraph,
     heading, cell) — the stamped element is the fallback.
   - **the active word** — the same word (§2.2), located by mapping the
     caret's source offsets through the existing selectionMap plumbing
     (the E83 synthetic-mark pipeline), wrapped in a synthetic
     `mm-active-word` mark. Position-exact: the caret's word, never a
     text search for the same string elsewhere.
2. Both marks re-anchor on render (typing), and clear when the document
   closes or the caret leaves any word (block tint stays).
3. Rendered text stays byte-identical (sanitize schema untouched —
   marks are synthetic DOM like the E83 selection mirror, never part of
   the markdown pipeline). Exports and the comment coordinate space
   never see them.

## 4. Click-to-place in the preview (FR-CLICK)

1. **Split mode:** a plain click in the preview (not on a link, image,
   comment mark, or inside the find bar) resolves the clicked text
   position to source offsets (the E80 preview→source selection
   mapping), moves the editor caret there (no scroll jump beyond the
   existing sync), and both panes show the block + word highlight per
   §2–§3. Clicks that resolve to no word still move the caret and the
   block tint.
2. **Preview-only mode:** the same click places a collapsed selection
   through the existing SPEC25 carry-over, so the preview shows block +
   word immediately and a later ⌘E lands the editor caret on that word
   (E85's survival contract extends to this collapsed case).
3. Text selection in the preview (click-drag) is untouched — a click is
   only a placement when the selection stays collapsed; type-to-comment
   and comment-add flows keep priority.

## 5. Modes & lifecycle (FR-MODES)

Full edit: editor side only (§2). Split: everything. Preview-only:
§4.2 (block + word from the carried selection). Tab switches (SPEC36):
the highlights are volatile per-document view state — they re-derive
from the restored caret, never persist to disk. Docs without an
anchored block (empty, front-matter-only) show no block tint and no
word mark; no errors.

## 6. Tests (added: U76, E124–E126)

1. **U76** — `activePosition`: `wordAt` (interior, word-start/end,
   left-affinity at boundaries, Unicode letters/digits/underscore,
   whitespace/punctuation ⇒ null, empty text); `blockLineFor` (between
   anchors, exact hit, before-first ⇒ null, after-last).
2. **E124** — split mode, editor-driven: caret in a word ⇒
   `mm-active-word` decoration in the editor AND the preview's matching
   block carries `mm-active-block` with exactly one `mm-active-word`
   mark on the right word (position-exact — a doc with the same word
   twice marks the caret's occurrence); moving the caret re-targets
   both; a non-empty selection clears the word marks but not the block
   tint; typing keeps the marks anchored.
3. **E125** — preview clicks: in split mode a click on a preview word
   moves the editor caret to it (both-pane highlights follow); a click
   on whitespace moves the caret with block tint only; link and
   comment-mark clicks keep their existing behaviors. In preview-only
   mode a click shows block + word, and ⌘E lands the caret on that
   word (E85 contract).
4. **E126** — hygiene: exports (SPEC17) and the comment anchor space
   ignore the marks (byte-identical rendered text); find marks and the
   active word coexist per §2.3's stacking; tab switch (SPEC36)
   re-derives highlights from the restored caret; the themed variables
   override (theme fixture sets both, computed styles follow).
5. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved. The only permitted test additions are U76
   and E124–E126.

## 7. Docs

README: one bullet under the editing section. ARCHITECTURE.md: the
activePosition module and the two synthetic-mark consumers (selection
mirror, active word) sharing the E83 pipeline.

## 8. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U76, E1–E41 +
   E45–E126, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` empty; no dependency changes; no version-file
   changes; no `.skip/.only/.todo`; the sanitize-schema diff is empty
   (synthetic marks only); the Windows-reserved-name scan prints
   nothing.
3. README + ARCHITECTURE.md updated per §7.
