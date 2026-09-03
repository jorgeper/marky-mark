# Spec: Change defaults: 14px font size, Gruvbox Dark theme (#210)

## Goal

All acceptance criteria in issue-specs/issue-210.md are satisfied for issue #210, with evidence visible in the session: `DEFAULT_SETTINGS` in `src/lib/settings.ts` has `fontSize: 14` and `themeDark: 'gruvbox-dark'`, all unit/e2e tests that asserted the old defaults are updated and passing, `npm run validate:quick` passes in the implementer's session, and a summary comment from the implementer exists on issue #210.

## Acceptance criteria

- `DEFAULT_SETTINGS` in `src/lib/settings.ts` has `fontSize: 14` (was `12`) and `themeDark: 'gruvbox-dark'` (was `'one-dark'`). `themeLight` stays `'crisp'`; no other default changes.
- Saved-settings precedence is unchanged: only the fallback values change — no migration code, no new UI or settings. Out-of-range/invalid `fontSize` values now coerce to `14` (the sanitizer already falls back to the default; only its expected value changes).
- Unit tests in `tests/unit/settings.test.ts` that assert the old defaults are updated (currently lines ~17, 19, 30, 60–62: `themeDark` → `'gruvbox-dark'`, default/coerced `fontSize` → `14`) and pass.
- E2e tests that depend on the *unselected* defaults are updated and pass: E20 in `tests/e2e/settings-and-themes.spec.ts` (default doc font `12px` → `14px`; 150% zoom `18px` → `21px`) and E253 in `tests/e2e/reading-and-export.spec.ts` (fresh dark background `rgb(40, 44, 52)` / One Dark → `rgb(40, 40, 40)` / Gruvbox Dark `#282828`, comments included). Tests that explicitly `selectOption('one-dark')` first are unaffected and left alone unless they fail.
- Iteration was done with `npm run typecheck` and `npm run test:unit` (plus targeted `npx playwright test -g '<title>'` for the two e2e tests), and the full gate `npm run validate:quick` was run ONCE, right before declaring the goal met, printing `QUICK VALIDATION: ALL PASSED`. Do not run the full gate after every small change or as a starting baseline.
- A summary comment from the implementer exists on issue #210.

## Context

The issue asks for exactly two default-value changes in `DEFAULT_SETTINGS` (`src/lib/settings.ts:155–159`). Theme ids are slugified filenames from `themes/` (see `idFromFilename` in `src/lib/themes.ts`), and `themes/gruvbox-dark.css` already ships (`@name: Gruvbox Dark`, `@variant: dark`, `--mm-bg: #282828`), so the id `gruvbox-dark` resolves with no theme work. Known old-default dependents: the unit assertions in `tests/unit/settings.test.ts`, E20 (`settings-and-themes.spec.ts`), and E253 (`reading-and-export.spec.ts`); grep `one-dark` and `12px` across `tests/` to confirm nothing else relies on the fresh defaults. The stale `fontSize 12` mention in the comment at `src/App.tsx:2855` may be updated for accuracy but is cosmetic.
