# Spec: line number strip isn't being themed (#52)

## Goal

All acceptance criteria in issue-specs/issue-52.md are satisfied for issue #52, with evidence visible in the session: the line-number gutter's background and digit colors are driven by `--mm-*` theme tokens so they change with the active theme instead of staying CodeMirror's default gray, an e2e test asserts the gutter's computed colors follow a theme switch, existing gutter behaviour (E136 border rules) still passes, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- The line-number strip (`.cm-gutters` / `.cm-lineNumbers` inside `.editor-wrap .cm-editor`) has its background and text color set from the theme's `--mm-*` custom-property contract (sensible picks: background matching the editor surface — `var(--mm-bg)` — or a subtle offset like `var(--mm-code-bg)`; digits in `var(--mm-fg-muted)`), overriding CodeMirror's hardcoded base-theme grays. Switching themes visibly changes the gutter's computed colors.
- `.cm-activeLineGutter` no longer shows CodeMirror's hardcoded light-blue highlight on dark themes: it is either themed off a token or neutralized so it can't clash with any theme.
- The issue #10 inset-gutter border rules (`.editor-wrap.gutter-inset .cm-editor .cm-gutters`, `src/styles.css:779`) still work — existing e2e E136 in `tests/e2e/settings-and-themes.spec.ts` passes unmodified.
- A new e2e test (next free number is E156; `tests/e2e/settings-and-themes.spec.ts` is the natural home) exists and passes: with line numbers on, it reads the gutter's computed background/color, switches to a theme with a very different palette (the E2 test's Monokai switch is the pattern to copy), and asserts the gutter's computed colors changed to match the theme rather than staying the default gray.
- Changed code carries citation comments per `docs/COMMENT-FORMAT.md` (issue-driven rules in `src/styles.css` use the `Issue #<n>:` prose style already present at lines 753/766).
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (plus targeted `npx playwright test -g '<title>'` runs for the new/affected e2e tests), and ran `npm run validate:quick` exactly ONCE, right before declaring the goal met — not after every small change and not as a full-suite baseline at the start. `npm run validate:quick` passes (`QUICK VALIDATION: ALL PASSED`).
- A summary comment from the implementer exists on issue #52.

## Context

The issue: "it looks the same gray per theme it needs to follow the themes." `src/styles.css:737` themes `.cm-editor` (background/fg from `--mm-bg`/`--mm-fg`) and line 779 themes the gutter *borders* off `--mm-border`, but nothing overrides the gutter's own background/foreground, so CodeMirror's base theme (light: `#f5f5f5` bg, `#6c6c6c` digits; plus `.cm-activeLineGutter` light-blue) wins in every theme. The fix is CSS-only in `src/styles.css` next to the existing `.cm-*` rules — no Editor.tsx changes expected (`src/components/Editor.tsx` line ~935 mounts `lineNumbers()` behind a compartment; toggle via View → Line Numbers). Theme token vocabulary is visible in any `themes/*.css` file (e.g. `themes/monokai.css`). E2e color-assertion patterns: E2 (theme switch, computed backgroundColor via `expect.poll`) and E136 (reads gutter computed styles) in `tests/e2e/settings-and-themes.spec.ts`.
