# Spec: Replace split divider with hairline + cast-shadow seam (#7)

## Goal

All acceptance criteria in specs/issue-7.md are satisfied for issue #7, with evidence visible in the session: in split mode the editor↔preview separator renders as a 1px `--mm-border` hairline plus an inset `--mm-panel-shadow` cast leftward (no 5px bar), resize/double-click-reset behavior is preserved on the `data-testid="split-divider"` element via an ~8px invisible grab zone, `npm run typecheck` and `npm run test` pass, and a summary comment from the implementer exists on issue #7.

## Acceptance criteria

- In split mode, the editor↔preview separator renders as the folder-pane seam treatment: a 1px hairline (`--mm-border`) plus an inset cast shadow, replacing the current 5px `--mm-border` bar (`.split-divider` no longer fills a 5px `--mm-border` background).
- The shadow is cast leftward — an inset shadow on the editor pane's right edge — so the preview appears to float in front of the editor, geometrically mirroring `.folder-panel::after`.
- The shadow reads from the existing `--mm-panel-shadow` variable with the same default value as the folder seam; no new theme variable is introduced.
- Resizing is preserved via an invisible grab zone over the seam (~8px wide) that keeps a `col-resize` cursor and drag-to-resize; double-click still resets the split to 50/50.
- At rest the seam shows only the hairline + shadow; a subtle accent tint appears **only** while hovering or dragging the grab zone (replacing today's full accent-blue bar).
- The effect applies only in split (dual-pane) mode; single-pane editor-only and preview-only views are unchanged.
- The seam and its depth cue read correctly in both light and dark themes, consistent with the folder seam.
- The resize handle element keeps its `data-testid="split-divider"` and pointer/double-click behavior so existing interaction tests continue to target it.
- `npm run typecheck` and `npm run test` have been run in the implementer's session and pass.
- A summary comment from the implementer exists on issue #7.

## Context

Parent: #6. PRD: `prd/001-split-seam-cast-shadow.md`.

The split divider lives in two places. Markup: `src/App.tsx` around line 3469 — the `<div className="split-divider" data-testid="split-divider">` with `onPointerDown={dragDivider}` and `onDoubleClick` that sets `splitRatio: 0.5`; keep this element and its handlers. Styling: `src/styles.css` — `.split-divider` (currently `width: 5px; background: var(--mm-border)`) and `.split-divider:hover` (accent background) starting near line 760, inside the `.workspace.split` block. Reuse the folder-pane seam recipe at `.folder-panel::after` (~line 1534) which layers `inset -1px 0 0 var(--mm-border, …)` plus `var(--mm-panel-shadow, inset -12px 0 14px -12px rgba(0,0,0,0.28))`.

Approach: make the visible seam a hairline + inset cast-shadow (cast leftward, onto the editor's right edge) while keeping the `.split-divider` element as an ~8px-wide invisible `col-resize` grab zone (e.g. via a pseudo-element for the shadow, or a wider transparent handle overlapping a thin hairline). Do not change split layout order, resize math, ratio persistence, or double-click reset. Verify light/dark themes and that single-pane modes are untouched. Interaction tests live in `tests/e2e/app.spec.ts` and target `data-testid="split-divider"`.
