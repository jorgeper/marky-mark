# Spec: marky mark icon (#23)

## Goal

All acceptance criteria in specs/issue-23.md are satisfied for issue #23, with evidence visible in the session: the smart-edit formatting button renders inside the editor content area next to the cursor line's text instead of inside the line-number gutter strip, its icon uses the theme accent color (`var(--mm-accent)`) at rest, `npm run validate:quick` passes in the implementer's session, and a summary comment from the implementer exists on issue #23.

## Acceptance criteria

- The Marky Mark hash button (the SPEC43 smart-edit button, currently `data-testid="smart-edit-gutter"`) no longer renders inside the CodeMirror gutter strip: it is not a descendant of `.cm-gutters`, and with line numbers on, the gutter area contains only the line numbers — so the gutter is narrower than before (the extra 26px `mm-smart-gutter` column is gone).
- The button renders inside the editor content area, vertically aligned with the cursor line and horizontally adjacent to (immediately left of) that line's text, and it follows the caret as the selection moves. The document text does not shift or reflow because of the button — line text starts at the same x-position whether or not the button is present on that line.
- The button's icon is the theme accent color at rest, i.e. `var(--mm-accent)` (crisp's light blue `#0969da`, matching icons like the folder-panel toggle), not the muted line-number color it uses today.
- Existing behavior is preserved: exactly one button, on the cursor's line only; clicking it opens the smart-edit menu anchored at the button; Esc and outside pointer-down dismiss the menu; the tooltip title still follows live key rebinds; the button does not appear in preview mode; it remains visible and clickable with line numbers hidden (both full-screen edit and the split-edit pane).
- The e2e coverage still holds: E105 (and any other tests touching the button, e.g. E106 and later menu tests in `tests/e2e/app.spec.ts`) are updated where their geometry assertions encode the old gutter placement, and assert the new placement (button inside the editor/content area, right of the line numbers) — keep `data-testid="smart-edit-gutter"` unless there is a strong reason to rename, in which case update every test that uses it.
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted Playwright tests such as `npx playwright test -g "E105"` when touching the geometry). Baseline an attempt with the quick tier only.
- `npm run validate:quick` has been run ONCE in the implementer's session, right before declaring the goal met — not after every small change — and passes.
- A summary comment from the implementer exists on issue #23.

## Context

The button lives in `src/components/Editor.tsx`: `HASH_SVG`, `SmartGutterMarker`, and `smartGutter()` (~lines 346–398) build a `gutter()` extension wired in via `smartComp` (~lines 917–920, reconfigured on rebind ~line 1302). Moving it into the content area likely means replacing the gutter extension with a CodeMirror line/widget decoration or an absolutely positioned overlay driven by the cursor line's coordinates — implementer's choice, as long as text never reflows. CSS is the SPEC43 block in `src/styles.css` (~1902–1936); the `.workspace:not(.split)` zero-width special-case there exists only because the button was a gutter and can likely be deleted. Themes define `--mm-accent` (e.g. `themes/crisp.css:12`). E2e coverage of the button starts at E105 (`tests/e2e/app.spec.ts` ~3800) and continues through the smart-edit menu tests.
