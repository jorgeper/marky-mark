# PRD 001 — Cast-shadow seam between editor and preview

## Problem

In dual-pane (split) mode the editor and the live preview are separated by a
thick 5px vertical bar (`.split-divider`, filled with `--mm-border`, turning
accent-blue on hover). It reads as a flat, heavy rule that fights the app's
otherwise soft, layered look.

The app already has a nicer separator language elsewhere: the folder navigation
pane's right edge (`.folder-panel::after`) carries a 1px hairline plus a subtle
inset cast shadow (`--mm-panel-shadow`), making the workspace look like it
*floats in front of* the folder pane. The owner wants that same depth cue
between the editor and preview — the preview (right pane) casting a soft shadow
onto the editor (left pane) — so the panes read as stacked in 3D rather than
divided by a bar.

## Goals

- Replace the thick split divider with the folder-pane seam treatment: a 1px
  hairline + soft cast shadow, so the preview appears to float in front of the
  editor.
- Keep the two seams visually identical and in sync by default (one shared
  theme variable).
- Preserve today's resize interaction (drag to move the split, double-click to
  reset to 50/50) with a comfortable, if now-invisible, grab target.

## Success criteria (observable)

- In split mode the 5px solid bar is gone; at rest the user sees only a hairline
  + soft shadow, matching the folder→workspace seam side-by-side.
- The shadow darkens the editor near its right edge (cast leftward by the
  preview), mirroring how the workspace shadows the folder pane.
- Dragging anywhere on the seam still resizes the split; double-click still
  snaps to 50/50; the cursor still shows `col-resize` over it.

## Non-goals

- No change to the folder-pane seam itself.
- No new theme variable — the split seam reuses `--mm-panel-shadow`.
- No change to split layout order (editor left / preview right), the resize
  math, persistence of the split ratio, or the double-click-reset behavior.
- No depth/shadow treatment added to any other boundary (toolbar, cards, tabs,
  single-pane modes).
- No shadow in single-pane editor-only or preview-only views (there is no
  divider there).

## Requirements

1. In split mode, the editor↔preview separator renders as the folder-pane seam
   treatment: a 1px hairline (`--mm-border`) plus an inset cast shadow,
   replacing the current 5px `--mm-border` bar.
2. The shadow is cast leftward — an inset shadow on the editor pane's right edge
   — so the preview appears to float in front of the editor, geometrically
   mirroring `.folder-panel::after`.
3. The shadow reads from the existing `--mm-panel-shadow` variable with the same
   default value as the folder seam. No new theme variable is introduced;
   theming both seams stays a single knob.
4. Resizing is preserved via an invisible grab zone over the seam (~8px wide)
   that keeps a `col-resize` cursor and drag-to-resize; double-click still
   resets the split to 50/50.
5. At rest the seam shows only the hairline + shadow. A subtle accent tint
   appears **only** while hovering or dragging the grab zone (replacing today's
   full accent-blue bar).
6. The effect applies only in split (dual-pane) mode. Single-pane editor-only
   and preview-only views are unchanged.
7. The seam and its depth cue read correctly in both light and dark themes,
   consistent with the folder seam.
8. The resize handle element keeps its `data-testid="split-divider"` and
   pointer/double-click behavior so existing interaction tests continue to
   target it.

## Open questions

- Grab-zone width: default ~8px (comfortable, unobtrusive). Flag only if QA
  finds it too easy/hard to grab.
- The editor's text nearest the seam picks up a faint shadow gradient (same as
  the folder tree today). Treated as acceptable, matching the existing
  folder-pane precedent.
