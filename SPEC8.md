# SPEC8: Marky Mark v8 — scroll continuity across modes and split panes

Delta spec on top of SPEC.md–SPEC7.md (all green: U1–U15, E1–E41, W1–W4). This file
wins on conflict; nothing else may regress. §5 is the goal condition. Explicitly out
of scope (author's call): exact source↔rendered position mapping (AST/sourcemap
anchoring — proportional mapping is the accepted fidelity), smooth/animated scroll
sync, and scroll-linked highlighting — do NOT build them.

---

## 1. Position continuity when toggling preview ↔ edit (FR-P)

1. Today's ratio restore is half-wired: `toggleMode` reads the workspace's
   `scrollTop`, but in edit mode the scrolling element is CodeMirror's
   `.cm-scroller` (the workspace is `overflow: hidden`), so leaving edit stores 0
   and entering edit never applies anything. Fix it end to end: on every toggle,
   read the **outgoing** mode's real scroller and apply the fraction to the
   **incoming** mode's real scroller.
2. The mapped quantity is the scroll *fraction* `scrollTop / (scrollHeight −
   clientHeight)`, clamped to [0, 1], with 0 when the content doesn't scroll.
   Applying it to CodeMirror must happen after the view has mounted and measured
   (post-layout — rAF/`requestMeasure`), and must win over any focus-driven
   scroll-into-view.
3. The **cursor** keeps its exact document position across a toggle round-trip
   (the v7 parked `EditorState` already preserves selection — keep it working,
   now with the viewport restored independently of the cursor). The restored
   viewport follows the reading position; the cursor may legitimately be
   off-screen.
4. This applies to both full-screen edit and split edit (the editor pane's
   scroller is the same `.cm-scroller`; preview fraction maps onto it and back).
5. **E42** asserts, with a long document: scroll preview to ~50% fraction → ⌘E →
   the editor scroller's fraction is within **±0.15**; without touching the
   scroll, ⌘E back → preview fraction within **±0.10** of where it was. Then:
   click a line mid-document, type a marker, toggle to preview and back, and
   type a second marker — both markers sit adjacent in the source (the cursor
   didn't move), and the editor viewport fraction survived the round-trip
   (±0.10).

## 2. Split-mode scroll sync (FR-S)

1. With `splitEdit` on, the editor pane (`.cm-scroller`) and the preview pane
   (`.split-preview`) stay in sync **bidirectionally**: scrolling either pane
   sets the other to the same scroll fraction (same formula as §1.2).
2. No feedback loops: a programmatic sync write must not echo back (suppress
   re-entrant scroll handling — a "currently syncing" flag or last-writer guard).
   No visible jitter: dragging one pane's scrollbar produces monotonic motion in
   the other.
3. The debounced live re-render (SPEC7 §5.3) replaces the preview pane's
   innerHTML, which resets or distorts its scroll. After each re-render, restore
   the preview pane to the editor's current fraction — typing at the bottom of a
   long document must not make the preview pane jump to the top.
4. Entering split mode initializes the preview pane at the editor's fraction
   (which §1 just set from reading preview, so the chain preview → split →
   preview keeps the reading position throughout).
5. **E43** asserts: in split mode on a long document, scrolling the editor pane
   to ~60% brings the preview pane to that fraction (±0.15, polled); scrolling
   the preview pane back to ~20% brings the editor pane along (±0.15); neither
   pane oscillates (two consecutive reads 150 ms apart agree within 2 px once
   settled).
6. **E44** asserts: in split mode, scroll both panes deep into the document,
   click into the editor near the bottom, type a marker — after the live
   re-render the preview pane still shows the region around the marker (its
   fraction within ±0.15 of the editor's), not the document top.

## 3. Sanctioned test changes

Only: new **E42–E44**. No unit-test changes (no settings surface). Existing tests
must pass untouched — if the scroll work perturbs E4/E23/E31/E39–E41 timing, fix
the implementation, not the tests.

## 4. Notes

- Keep per-mode "last fraction" state in refs; no re-render per scroll event.
  Scroll listeners must be passive and cheap.
- CodeMirror scroll restore: set `scrollTop` on `view.scrollDOM` after layout;
  re-assert once after the first measure if CM's own focus/selection restore
  scrolls it (the v7 state revival calls `view.focus()`).
- The echo guard matters doubly in split mode: §1's toggle restore writes to a
  pane that §2's sync is listening to.
- The long document for E42–E44 can be built by writing a tall markdown file
  into the shim fs (fsWrite) and opening it — don't bloat the welcome fixture.

## 5. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U15, E1–E44, W1–W4**, the
   single-file check, `VALIDATION: ALL PASSED` — printed in the transcript.
2. macOS build exits 0 with `Marky Mark.app` path + size (< 25 MB) printed; Windows
   NSIS cross-build exits 0 with installer path + size (or BLOCKERS.md documents an
   honest new failure).
3. `ls dist-web/` shows exactly `index.html`, size printed.
4. `grep -rn "\.skip\|\.only\|\.todo" tests/` prints nothing; `git diff --stat
   SPEC*.md` empty.
5. `ARCHITECTURE.md` documents the fraction-mapping design (what maps, why
   proportional, where each mode's real scroller lives), the split-pane sync with
   its echo guard, and the post-re-render scroll restore.
