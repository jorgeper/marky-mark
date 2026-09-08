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
*Amended by issue #345 (2026-09-08): the preview shows NO cue any more
and a click there scrolls nothing; the editor keeps only its caret-line
tint, bound to `--mm-active-line` and a little stronger — see the
"Amended by issue #345" section at the end.*

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
     outside any anchored block, e.g. front matter). INVARIANT: a stamp
     can cover a whole list, table, or quote — the tint always lands on
     exactly ONE innermost standard container (`li`, `p`, `h1`–`h6`,
     `pre`, `blockquote`, `td`, `th`): the one holding the caret, or —
     during a non-empty selection — the selection HEAD (mirroring the
     editor's active line, live as the drag head moves). The head
     resolves through the pure mapping layer (word mark when present,
     else source→rendered offset); the stamped element itself is only
     the last-resort fallback.
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
   only a placement when the selection stays collapsed; the annotation
   authoring flows keep priority. (Type-to-comment, named here when
   this spec shipped, is superseded by PRD 023 §6; the flows that keep
   priority are now the menu, hotkey and selection-button routes.)

## 5. Modes & lifecycle (FR-MODES)

Full edit: editor side only (§2). Split: everything. Preview-only:
§4.2 (block + word from the carried selection). Tab switches (SPEC36):
the highlights are volatile per-document view state — they re-derive
from the restored caret, never persist to disk. Docs without an
anchored block (empty, front-matter-only) show no block tint and no
word mark; no errors.

## 6. Tests (added: U76, E124–E127)

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
5. **E127** — tint granularity (the §3.1 invariant): a multi-word drag
   inside one bullet tints exactly that `li`; a drag across two bullets
   tints the head's `li` only; a collapsed caret on a punctuation run
   inside a bullet tints that `li`; a caret in a table cell tints the
   `td`; a caret in a blockquote paragraph tints the inner container,
   never the whole quote; a preview whitespace/punctuation click inside
   a bullet tints that bullet.
6. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved. The only permitted test additions are U76
   and E124–E127.

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

---

## Amended by issue #345 (2026-09-08): cues withdrawn from the preview and the editor's word

Observed on the hosted build: the darker word-under-caret tint in the
editor, and the block tint plus word mark in the preview, read as
clutter, and a preview click scrolled the panes. The preview should look
like a preview; the editor keeps one placement cue. Section by section:

- **§2.1 — rewritten.** The active-line tint stays CodeMirror's
  `cm-activeLine`, but it is now BOUND to the token: a three-class rule in
  `editor/styles.css` (`.editor-wrap .cm-editor .cm-activeLine`) paints it
  through `var(--mm-active-line, …)`, outranking CodeMirror's injected
  two-class base theme (which had painted its own hardcoded picks, so the
  token changed nothing visible). The token's default in `src/styles.css`
  rises from the accent at 5.5% to the accent at 10%. Themes overriding
  the token are unaffected (no bundled theme defines it).
- **§2.2 — withdrawn.** No `mm-active-word` decoration exists in the
  editor: not on caret moves, not on a remount restored through
  `EditorState.fromJSON`, not around the find bar. `activeWordField`,
  `setActiveWordSuppressed` and the `activeWordSuppressed` prop are gone
  from `editor/src/components/Editor.tsx`.
- **§2.3 — the word layer is gone.** `--mm-active-word` is retired (no
  definition, no use). Stacking is now find > selection > comments >
  active line; real selections, comment marks, highlight marks and find
  marks are unchanged.
- **§3 (the preview mirror) — withdrawn in full.** The preview never
  carries `.mm-active-block` or `mark.mm-active-word`: not on caret
  reports, preview clicks, re-injection (§3.2's re-derivation is gone),
  edit ↔ preview toggles, tab switches or typing. No rule in the repo
  styles either class; no synthetic mark is inserted for placement, so
  rendered text stays byte-identical and text nodes stay whole. What
  survives of §3.1 is INVISIBLE: the host still resolves the caret head to
  its rendered point through the pure mapping layer — the caret's word by
  occurrence index (`renderedHeadOffset`, `editor/src/lib/selectionMap.ts`),
  else the flat source→rendered offset — and stamps only `data-mm-head`
  (the head's text offset within its innermost standard container) on
  that container. The one-innermost-container invariant holds for the
  stamp exactly as it held for the tint. No CSS rule reads the attribute;
  it exists for the split sync controller alone (issue #310, SPEC45).
- **§4.1 (split click) — rewritten.** A plain click in the split preview
  (not on a link, image, comment mark, find mark, input, button or the
  front-matter card) resolves to the exact clicked source offset (issue
  #178) and places the editor caret there SILENTLY: a host-origin select
  without `reveal`, so the editor does not scroll, the follower does not
  run (E464's model), the editor is not focused, and neither pane's
  `scrollTop` moves. Nothing is painted.
- **§4.2 (preview-only click) — rewritten.** The same click parks the
  collapsed caret for the next ⌘E (E85 / issue #178 contract) and does
  nothing else: no cue, no scroll, nothing visible.
- **§4.3 — stands.** Click-drag selection in the preview is the ONE
  visible selection there and keeps feeding the annotation flows (PRD 023
  §13: the Marky Mark button, hotkeys, menu). The SPEC23 §1 mirrored
  selection for a non-empty editor selection is untouched.
- **§5 — rewritten.** Full edit and split: the editor's caret-line tint
  only. Preview-only: nothing. The invisible head stamp is volatile
  per-document view state that re-derives from the caret after tab
  switches and re-renders; it never persists.
- **§6 — rewritten (IDs kept).** E124 asserts the caret-line tint and the
  absence of any word/block cue in either pane on caret moves, repeats,
  selection and typing, and the position-exact invisible stamp; E125
  asserts scroll-neutral, cue-free clicks that still place (split) or
  carry (preview-only, ⌘E) the caret, links unchanged; E126 asserts
  comment anchoring across a click, find marks standing alone, no word cue
  around the find bar, the `--mm-active-line` override showing through
  `.cm-activeLine`, and a clean doc switch; E127 asserts no tint on any
  shape and the stamp on exactly one innermost container; E128 and the
  issue #310 yardstick measure the editor caret row against the head row
  read from `data-mm-head`. New: E623 (split click far below the editor
  viewport moves neither pane), E624 (preview-only click scrolls and
  paints nothing, carries into ⌘E, click-drag still authors a highlight),
  E625 (the token's raised default and its binding), U1366
  (`renderedHeadOffset`). U76 is untouched.
- **§7 — ARCHITECTURE.md's placement-cues paragraph is rewritten to this
  contract; SPEC45 carries a note that its anchor is the invisible head
  row.**

---

## Amended by issue #355 (2026-09-08): the caret-line tint is continuous through code

Observed with the caret inside an inline code span on a raw table row: the
`.mm-md-code` span's (usually opaque) `--mm-code-bg` painted above the
line's own background, so the code sat as an untinted box in the §2.1
band — the layering problem issue #123 solved for the ranged selection.

- **§2.1 — amended.** On the caret line, every code construct (inline
  code, a raw table cell holding code, a SPEC40 grid cell, a fenced-code
  body line inside the issue #157 fence card) paints the caret-line tint
  LAYERED OVER its `--mm-code-bg`: a three-class rule in
  `editor/styles.css` (`.editor-wrap .cm-editor .cm-activeLine .mm-md-code`)
  sets a two-stop `linear-gradient` of `var(--mm-active-line, …)` as the
  image layer above the code background, so the computed
  `background-image` is that gradient while `background-color` stays the
  code background and the code text is untouched. The same span on a
  non-caret line keeps `background-image: none`. Overriding the token
  recolours the code layer in step with the line. The SPEC23 §3 selection
  mark (`.mm-code-sel`, E261) is unchanged and nests inside the span as
  before; live preview's `.mm-lp-code` needs no rule because the caret
  line is always revealed raw (PRD 006 §8). E626 pins the contract.

## Amended by issue #357 (2026-09-08): click-to-place crosses the seam

- **§4.1 — amended.** The clicked caret is a CANONICAL offset resolved
  against the canonical text; it enters the editor through
  `selectSourceRange`, which translates it through the SPEC40 §2 seam — a
  click below two grids lands the caret on the clicked file character, not
  the same offset in the padded display. The head-row anchor (issue #345)
  is stamped from the report's canonical `canonHead`/`headLine` (SPEC23 §4
  as amended) — `mapOffsetByLineFlat` is no longer the report's mapper (it
  remains for §3.1's rendered-text purpose). E638 pins the placement.
