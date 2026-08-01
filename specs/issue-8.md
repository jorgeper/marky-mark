# Spec: dual pane behavior (#8)

## Goal

All acceptance criteria in specs/issue-8.md are satisfied for issue #8, with
evidence visible in the session: in split mode the seam between editor and
preview is reliably draggable to resize the two panes side by side (matching
the pre-#7 interaction), double-click resets to a 50/50 split, the #7 hairline
+ cast-shadow aesthetic is retained, `npm run validate:quick` passes in the
implementer's session, and a summary comment from the implementer exists on
issue #8.

## Acceptance criteria

- In split (dual-pane) edit mode, pressing/dragging on the visible seam between
  the editor and preview resizes the two panes side by side and the live split
  ratio follows the pointer — restoring the interaction as it worked before
  issue #7 (commit `a6549c9`).
- The grab/hit target for the resize is at least as forgiving as the pre-#7 5px
  bar: a user aiming at the visible seam (the hairline and its soft cast
  shadow) reliably starts a drag rather than clicking through into the editor.
  In particular the draggable zone is not narrower than, or offset away from,
  the pixels the user perceives as the seam.
- Double-clicking the seam resets the split to an even 50/50 (`splitRatio` 0.5).
- The resized split ratio persists: it survives leaving and re-entering edit
  mode and is written to `settings.json` (`splitRatio`), and the drag clamps
  between the existing `SPLIT_RATIO_MIN`/`SPLIT_RATIO_MAX` bounds.
- The issue #7 aesthetic is unchanged: at rest the seam still shows only the 1px
  `--mm-border` hairline plus the inset `--mm-panel-shadow` cast leftward onto
  the editor's right edge (no return of the 5px solid `--mm-border` bar), with
  the subtle accent tint appearing only while hovering/dragging. No new theme
  variable is introduced.
- The seam element keeps `data-testid="split-divider"` and its
  pointer/double-click handlers so the existing E40 interaction test continues
  to target it.
- The effect applies only in split mode; single-pane editor-only and
  preview-only views are unchanged, in both light and dark themes.
- The existing split-divider e2e coverage (test E40 in `tests/e2e/app.spec.ts`:
  drag-to-30%, clamp-at-floor, ratio persistence, double-click reset) passes.
- `npm run validate:quick` has been run in the implementer's session and passes
  (prints `QUICK VALIDATION: ALL PASSED`).
- A summary comment from the implementer exists on issue #8.

## Context

Issue #7 (commit `a6549c9`, PRD `prd/001-split-seam-cast-shadow.md`) replaced
the old 5px solid `.split-divider` bar with an invisible ~8px transparent
`col-resize` grab zone whose visible seam (hairline + inset cast shadow) lives
on a `pointer-events: none` `.split-divider::before` overlay. That commit
touched only `src/styles.css` — the resize JS is untouched. The owner reports
that the drag-to-resize interaction now feels broken and wants the pre-#7
dual-pane behavior back while keeping the shadow as a purely aesthetic change.

Likely root cause: the visible seam (`::before` at `right: 50%`, `width: 16px`
extending leftward with a soft shadow) is offset from and visually wider than
the 8px grab zone, so pointer-downs aimed at the perceived seam land in the
editor and never start a drag. Reconcile the grab target with the visible seam
(e.g. widen/recenter the `.split-divider` hit zone, or align the overlay with
the zone) so grabbing the seam always resizes — without reintroducing the solid
bar or changing the shadow look.

Relevant files: `src/styles.css` (`.split-divider`, `.split-divider::before`,
`.split-divider:hover::before`, `.split-editor`/`--mm-split` around lines
745–803); `src/App.tsx` (`dragDivider` ~line 1831 with `--mm-split` +
`splitRatio` persistence, the `.split-divider` element ~line 3469 and its
double-click reset, `SPLIT_RATIO_MIN`/`SPLIT_RATIO_MAX`). Interaction test:
`tests/e2e/app.spec.ts` E40 (~line 1055). Compare against the pre-#7 divider at
git ref `a6549c9^` if you need the old geometry. Verify with
`npm run validate:quick`.
