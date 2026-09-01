# Spec: style: remove the small marky mark icon next to the menu burger (#197)

## Goal

All acceptance criteria in issue-specs/issue-197.md are satisfied for issue #197, with evidence visible in the session: the toolbar's title slot no longer renders the small `app-badge` Marky Mark icon next to the hamburger in any state or platform flavor (the slot is simply empty when nothing is named there); the `AppBadge` component and its other call sites (splash, About dialog, hosted sign-in) are untouched; the affected e2e assertions (E1/E28) and the governing spec text (SPEC5 §1, SPEC27) are updated to the amended contract; and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- The toolbar never renders the small Marky Mark badge: the `{showBadge && <AppBadge />}` render in the `docname` slot (`src/components/Toolbar.tsx:244`, gated by `showBadge` at line 192) is removed, along with the now-dead `showBadge` computation. `data-testid="app-badge"` no longer appears anywhere in the toolbar DOM, in any mode (empty state, document open, workspace open, cloud/hosted — the issue's screenshot is cloud mode, but the removal is unconditional per the issue title).
- The `AppBadge` component itself stays exported from `src/components/Toolbar.tsx` and its other call sites keep working unchanged: the empty-state splash (`src/App.tsx` ~line 7153, `splash-badge`), the About dialog (`src/components/AboutDialog.tsx`, `about-badge`), and the hosted sign-in page (`src/components/HostedSignIn.tsx`, `hosted-sign-in-badge`).
- The contract is amended, not silently contradicted: `docs/specs/SPEC5.md` §1 (badge in the title slot) and the `docs/specs/SPEC27.md` lines that say the toolbar `app-badge` renders carry a short amendment note referencing issue #197 (follow the existing amendment style, e.g. SPEC35 §9 / issue #194). Citation comments at the touched sites reference the amended contract.
- Existing e2e tests are updated to assert the new contract, not deleted or skipped: in `tests/e2e/shell-and-menus.spec.ts`, E1 (line ~43) and E28 (lines ~211–228) currently assert `app-badge` is visible in `docname` when empty; flip those assertions to `toHaveCount(0)` (E28's "filename replaces the badge" half collapses into: the badge is never there), keeping test IDs and titles' stable `E<n>:` prefixes. No other suite references the toolbar `app-badge` (frozen tests do not).
- If any `SPEC<n>` citation set in `src/` or `tests/` changes files, `docs/MAP.md` is regenerated with `npm run map` (never hand-edited); if nothing moved, no MAP change is expected.
- `npm run validate:quick` passes, run once in the implementer's session right before declaring the goal met (it prints `QUICK VALIDATION: ALL PASSED`). Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted e2e via `npx playwright test -g 'E28'` / `-g 'E1:'`) after each change — do not run the full gate repeatedly or as a starting baseline.
- A summary comment from the implementer exists on issue #197.

## Context

Owner report with a cloud-mode screenshot: a ~20 px Marky Mark tile sits immediately right of the hamburger. That is `AppBadge` filling the toolbar's title slot under SPEC5 §1 ("the badge fills the title slot when nothing is named there") — in hosted/cloud mode the managed workspace name loads asynchronously (`src/App.tsx` ~4916–4941 blanks it until the lifecycle listing answers), so the badge shows next to the burger. The fix is deletion of that one render site, not a conditional. Note `.sandcastle/CODING_STANDARDS.md`: tests are never weakened or deleted — E1/E28 must be updated to assert the amended contract, and behavior changes carry citation comments. Read CODING_STANDARDS before writing code.
