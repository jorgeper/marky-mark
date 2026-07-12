# SPEC24: Marky Mark v24 — mirrored selection, both ways

Delta spec on top of SPEC.md–SPEC23.md as implemented (all green: U1–U51,
E1–E41 + E45–E82, W1–W10; SPEC8 still pending, E42–E44 reserved). This
file wins on conflict; nothing may regress. §5 is the goal condition.

**What ships:** the SPEC23 §1 mirror gains the reverse direction —
selecting in the **editor** (split edit) highlights the corresponding
**rendered text** in the split preview. Together: select in either pane,
see it in both.

Out of scope: mirroring in full-screen edit (no preview pane), copying
from the preview-side highlight (it is a visual mirror; ⌘C serves the
editor selection the user is actually making), cross-block exact mapping
(block boundaries render without separators — such selections use the
region fallback), scrolling the preview to the highlight (split
scroll-sync already keeps the panes aligned).

---

## 1. Editor → preview (FR-REV)

1. Scope: split edit only; **non-collapsed** editor selections while the
   **editor has focus**. A collapsed selection (or leaving split edit)
   clears the preview highlight.
2. The preview side is a **synthetic highlight, never the native DOM
   selection** — a focused CodeMirror re-asserts the native selection
   (SPEC23's pointerdown-blur exists because of this), so the reverse
   mirror wraps the mapped text in `<mark class="mm-mirror-sel">`
   elements via the existing `highlightRange` machinery (restyled: not
   `hl`, no `data-cid` — comment click handling must never see them),
   styled from the theme's selection color. Document plain text is
   unchanged (comment anchors unaffected); marks are unwrapped (with
   text-node normalization) before each re-apply and on clear.
3. Mapping is the SPEC23 inverse, pure in `selectionMap.ts`:
   - `visibleTextForRange(source, from, to): string` — the selection's
     rendered-visible text (stripInline maps filtered to [from,to),
     lines joined with a space).
   - `findNormalized(haystack, needle): { start; end } | null` — locate
     the whitespace-normalized needle in a raw haystack, returning raw
     offsets; null when absent or ambiguous.
   The app searches the preview's `getDocText` **within the region
   bounded by the covered blocks' `data-mm-line` stamps** and highlights
   the unique hit; no/ambiguous hit ⇒ **fallback: highlight the whole
   covered block region**. Never a wrong guess.
4. **Loop-freedom (by construction):** the reverse mirror writes marks
   only — no `selectionchange` fires, so the SPEC23 forward mirror
   cannot bounce. The forward mirror's CM dispatch happens with the
   editor **unfocused**, and the reverse mirror ignores unfocused
   selection reports — so forward cannot bounce either. The Editor's
   `onEditState` report gains a `focused: boolean` field (also exposed
   on the `__mmEdit` seam) to carry this.
5. Debounce ≤ 200 ms, matching the forward direction.

## 2. Docs

ARCHITECTURE.md's mirrored-selection section covers both directions and
the loop-freedom argument; README's Edit-mode bullet says "select in
either pane".

## 3. Tests (added: U52, E83)

1. **U52** — `visibleTextForRange` strips markers/prefixes and respects
   offset bounds (mid-marker selections included); `findNormalized`
   exact, whitespace-collapsed, ambiguous ⇒ null, absent ⇒ null.
2. **E83** — split edit: keyboard-select a full source line containing
   bold text → the preview shows `mm-mirror-sel` marks whose joined text
   is the rendered sentence (markers stripped); no mark carries `hl` or
   `data-cid`; collapsing the selection clears the marks; a preview
   drag-select afterwards still mirrors into the editor (forward path
   intact, no feedback loop); an ambiguous selection (duplicated
   paragraph) falls back to highlighting its whole block.
3. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved.

## 4. Platforms

No Platform/Tauri/Rust changes; no new dependencies.

## 5. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U52, E1–E41 +
   E45–E83, W1–W10 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` empty; no dependency or version-file changes;
   `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing;
   Windows-reserved-name scan prints nothing.
