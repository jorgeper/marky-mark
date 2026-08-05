# Spec: Release cut failed: W8 web e2e — before-snapshot of .cm-content races CodeMirror viewport rendering (#69)

## Goal

All acceptance criteria in issue-specs/issue-69.md are satisfied for issue #69, with evidence visible in the session: the W8 baseline capture in tests/e2e/web.spec.ts no longer races CodeMirror's lazy viewport rendering, the web e2e suite (`npm run test:e2e:web` against a fresh `npm run build:web`) passes including W8, `npm run validate:quick` passes, and a summary comment from the implementer exists on issue #69.

## Acceptance criteria

- The W8 test (`tests/e2e/web.spec.ts`, currently lines 280–298) no longer
  compares a racy DOM snapshot: the "buffer unchanged" check is immune to
  CodeMirror's lazy viewport rendering. Acceptable shapes (implementer's
  call): poll the baseline until the text is stable across consecutive
  reads before capturing it, or compare full document text on both the
  capture and assert sides via a source that is not the virtualized
  `.cm-content` DOM. Note the web build has no `__mmEdit` dev seam (W10
  asserts its absence), so any state-based read must work without it.
- The test's assertions are not weakened: it still verifies the
  needs-desktop notice appears after an image paste AND that the editor
  buffer text after the paste equals the pre-paste text. The check must
  still be capable of failing if a paste actually mutated the buffer (no
  tautological post-paste self-comparison, no removed assertion).
- The web e2e suite passes in the implementer's session against a fresh
  web artifact: `npm run build:web` followed by `npm run test:e2e:web`
  reports all 12 W-tests green (during iteration, target just W8 with
  `npx playwright test --config playwright.web.config.ts -g 'W8'`).
- Changes are confined to test code (`tests/e2e/web.spec.ts`, optionally
  shared helpers in `tests/e2e/helpers.ts`); no `src/` behaviour changes.
- `npm run validate:quick` has been run in the implementer's session,
  once, right before declaring the goal met, and prints
  `QUICK VALIDATION: ALL PASSED`. Iterate with `npm run typecheck` and
  `npm run test:unit` (or the targeted W8 run above) after each change —
  do not run the full gate after every small change, and do not run it as
  a baseline at the start of the attempt.
- A summary comment from the implementer exists on issue #69 describing
  the fix and the verification evidence.

## Context

CI failure during the v0.5.0-alpha.2 Windows append (release #68):
release-windows.yml's `npm run validate` failed at the web e2e step on W8.
The diff in the failure shows "Expected" (the `before` snapshot taken at
`tests/e2e/web.spec.ts:285`) is a strict prefix of "Received" — CodeMirror
renders the viewport lazily, so the tail of the welcome doc wasn't in the
DOM yet when `textContent()` ran on the slower macOS runner. The paste
itself was correctly a no-op. Suite is green locally, so reproduce by
reasoning + the targeted run, not by chasing the race. `tests/e2e/helpers.ts`
already has a stability-polling precedent (`stableBox`, ~line 173) worth
following stylistically. The web suite runs the BUILT artifact
(`dist-web/index.html`, see `playwright.web.config.ts`) — rebuild with
`npm run build:web` if `dist-web/` is stale or missing. Timeouts may be
raised; assertions never weakened.
