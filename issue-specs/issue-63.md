# Spec: line right to the number strip (#63)

## Goal

All acceptance criteria in issue-specs/issue-63.md are satisfied for issue #63, with evidence visible in the session: the line-number gutter's right border reads the theme's `--mm-border` token in the flush (non-inset) state too, so CodeMirror's hardcoded gray `#ddd` rule never shows through on any theme; an e2e assertion covers the flush-state right border following the theme; `npm run validate:quick` passes; and a summary comment from the implementer exists on issue #63.

## Acceptance criteria

- In the flush state (no `.gutter-inset` class on `.editor-wrap` — e.g. split view, folder panel open at narrow margins, or a narrow window), the gutter's right border is `1px solid` in the active theme's `--mm-border` color, not CodeMirror's base-theme hardcoded `#ddd` / `rgb(221, 221, 221)`. It follows theme changes (light vs dark themes yield different border colors).
- The issue #10 behavior is unchanged: with `.gutter-inset` present, the gutter carries identical left and right rules off the same `--mm-border` token; in the flush state the LEFT border stays absent (`0px`) so it never doubles the `.folder-panel::after` seam hairline. Existing test E136 in `tests/e2e/settings-and-themes.spec.ts` still passes.
- An e2e assertion (extending E136 or a new numbered test in `tests/e2e/settings-and-themes.spec.ts`) verifies the flush-state right border: it is `1px solid`, it is not `rgb(221, 221, 221)`, and it changes with the theme (e.g. via `page.emulateMedia({ colorScheme: 'dark' })` as E136 already does for the inset state).
- The stale comment above the `.gutter-inset` rule in `src/styles.css` (currently ending "Flush keeps CodeMirror's single right border, untouched.") is updated to describe the new contract, per `docs/COMMENT-FORMAT.md`.
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted e2e runs like `npx playwright test -g 'E136'`) while developing; run `npm run validate:quick` ONCE, right before declaring the goal met — not after every small change and not as a full-suite baseline — and it prints `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #63.

## Context

Issue text: "the border to the right of the number strip still shows up in gray on all themes sometimes." This is fallout from issues #10 and #52. `src/styles.css:766-793` holds the relevant rules: the issue #10 rule themes BOTH gutter borders but is gated on `.gutter-inset` (a geometry class Editor.tsx toggles at `src/components/Editor.tsx:1244-1255` only while the pane has centering slack), and the issue #52 rule themes the gutter surface/digits unconditionally but not the border. So whenever the gutter sits flush, CodeMirror's base theme's `border-right: 1px solid #ddd` (from `&light .cm-gutters` in @codemirror/view) wins — gray on every theme. The natural fix is moving `border-right: 1px solid var(--mm-border, ...)` into the unconditional `.editor-wrap .cm-editor .cm-gutters` rule (keeping `border-left` gated on `.gutter-inset`), but any approach meeting the criteria is fine. E136 (`tests/e2e/settings-and-themes.spec.ts:260`) already measures both borders via computed style and is the template for the new assertion.
