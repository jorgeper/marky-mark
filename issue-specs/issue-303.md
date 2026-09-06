# Spec: Resolve former-name URLs client-side and rewrite to the canonical URL (#303)

## Goal

All acceptance criteria in issue-specs/issue-303.md are satisfied for issue
#303, with evidence visible in the session: the hosted name match in
`src/lib/hostedPaths.ts` resolves a visited name against current unique names
across the whole listing first and only then against the `formerNames` each
row carries (case-insensitively), a visit to `/<former-name>[/<file…>][#<heading>]`
opens the same workspace, file and heading as the current-name URL and the
address bar is rewritten in place to the canonical URL with file path and
fragment preserved (no banner; the unauthenticated case continues to the
canonical URL after sign-in), the not-found hint reads "It may have been
deleted or shared by mistake.", new unit tests (`tests/unit/hosted-paths.test.ts`)
and e2e tests (`tests/e2e/hosted.spec.ts`, E403 updated) cover it,
`npm run validate:quick` passes in the implementer's session, and a summary
comment from the implementer exists on issue #303.

## Acceptance criteria

- **Current beats former (PRD 024 Req 7).** The listing-row name match
  (`findWorkspaceByUniqueName` in `src/lib/hostedPaths.ts`, or a successor it
  delegates to) resolves a visited name in two passes: every row's current
  `uniqueName` across the whole listing first, and only if none matches, the
  rows' `formerNames`. A former name held by one row therefore never shadows
  the same name held as the current name of another row, whatever the row
  order. Both passes compare through `uniqueNameKey` (case-insensitive), and
  rows without a `uniqueName` (pre-migration) stay unaddressable exactly as
  today. `formerNames` is optional/readonly in the helper's row constraint so
  existing callers and U1060's minimal rows keep typechecking.
- **A former-name URL resolves like a current one (PRD 024 Req 14).** In
  `resolveHostedVisit` (`src/components/HostedSignIn.tsx`), a signed-in visit to
  `/<former-name>`, `/<former-name>/<path…>/<file>`, or either with a
  `#<heading-slug>` binds the workspace, opens the file and scrolls to the
  heading exactly as the equivalent current-name URL (PRD 020 Reqs 5, 18, 19),
  and the existing `history.replaceState` rewrite puts the address bar on
  `buildAppPath(row.uniqueName, file) + hash` — the canonical current name,
  with the file segments and the fragment preserved. Nothing is rendered to
  announce the redirect (no banner, no toast). A missing file under a
  former-name URL renders the not-found page naming the *current* unique name
  and the file, as it does for a current-name visit.
- **Unauthenticated former-name visits continue after sign-in (PRD 020
  Req 9).** Visiting a former-name URL while signed out goes through hosted
  sign-in and lands on the canonical URL afterwards, workspace, file and
  fragment honoured — the stored visit intent already carries the visited
  path, so this should need no new plumbing, but it is asserted in e2e.
- **Reclaim ends the redirect, client-side.** Because the match prefers
  current names and the server (#301, Req 8) strips a reclaimed name from the
  other workspace's `formerNames`, creating a workspace under a former name
  makes `/<that-name>` open the new workspace. No client-side special case is
  added for this; it falls out of the two-pass match and is proven in e2e.
- **The not-found hint no longer blames renames (PRD 024 Req 15).** The
  not-found page's hint paragraph (`HostedSignIn.tsx`, the
  `hosted-signin-hint` under `hosted-not-found`) reads exactly "It may have
  been deleted or shared by mistake." Every other element of that page — the
  message naming what was looked for, the `hosted-not-found-home` link — is
  unchanged.
- **Scope.** Hosted (cloud) client only: no `server/` change, no change to
  desktop, dev-shim or single-file builds, no new UI, no new storage or
  request (the `formerNames` already on `WorkspaceListing` rows is the only
  data source). Scratch routes, reserved words and the legacy
  `/?workspace=<uuid>` form behave as before. The pure logic stays in
  `src/lib/hostedPaths.ts` (no DOM, no React); new or changed behaviour
  carries a citation comment naming the contract, e.g.
  `// PRD 024 Req 7+14 (issue #303): …`.
- **Unit coverage (PRD 024 Req 18).** `tests/unit/hosted-paths.test.ts`
  gains tests, alongside U1060 with the next unused `U<n>` ids (≥ U1278,
  check `grep -rhoE "'U[0-9]+" tests/unit` first), proving: a former name
  resolves to its row case-insensitively (`Old-Name` matches `/old-name`);
  a name that is current on one row and former on another resolves to the
  current row regardless of row order; rows with no `formerNames` and rows
  with an empty array behave as today; an unknown name still yields
  `undefined`. U1060 stays as it is.
- **End-to-end coverage (PRD 024 Req 19, this slice).** `tests/e2e/hosted.spec.ts`
  gains tests with the next unused `E<n>` ids (≥ E569, check
  `grep -rhoE "'E[0-9]+" tests/e2e` first), using the existing `signIn`,
  `pathWorkspace`, `dropDraft`, and API-driven rename (a manifest PUT with a
  new `uniqueName`, the way U1235+ / #301 tests do; or the Names UI as E536
  does): after a rename, `goto` of the old `/<old>`, `/<old>/<dir>/<file.md>`
  and `/<old>/<dir>/<file.md>#<heading>` URLs each end with `page.url()` on the
  canonical `/<new>…` form with file and fragment preserved, the document open
  and the heading in view (the E400 pattern); at least one of these starts
  signed out and passes through sign-in first; a missing file under the old
  name renders `hosted-not-found`; creating a second workspace with the old
  name (`POST /api/workspaces`) makes `/<old>` open that new workspace and not
  the renamed one. E403 additionally asserts the not-found page contains the
  new hint copy "It may have been deleted or shared by mistake." (and not
  "renamed"); nothing else in E403 changes.
- **Test economy.** Iterate with `npm run typecheck` and `npm run test:unit`
  (and, for one behaviour, `npx playwright test -g '<title>'`); baseline with
  the quick tier only. Run `npm run validate:quick` ONCE, right before
  declaring the goal met — not after every change and not as a starting
  baseline.
- **`npm run validate:quick` passes** in the implementer's session, printing
  `QUICK VALIDATION: ALL PASSED`. That gate includes the `docs/MAP.md`
  freshness check, so if a citation change alters the map, `npm run map` has
  been run and the regenerated file committed.
- **A summary comment from the implementer exists on issue #303**, describing
  what changed and the gate evidence.

## Context

PRD `prd/024-rename-redirects.md` (Reqs 7, 14, 15, 18, 19) is the contract;
parent issue is #251. #301 (merged) already put `formerNames: string[]` on
listing rows (`WorkspaceListing` in `src/lib/workspaceLifecycle.ts`, served by
`server/workspaces.ts`) and handles reclaim on the server; #302 (merged) moved
the renaming tab itself (E536/E537, `renamedWorkspaceUrl`). This slice is only
the client-side match and the copy change.

The pieces: `findWorkspaceByUniqueName` in `src/lib/hostedPaths.ts` is the
single name match; its one production caller is `resolveHostedVisit` in
`src/components/HostedSignIn.tsx` (≈ line 263), which already rewrites the bar
from `row.uniqueName` and the visit's hash, so resolving a former name to its
row is what makes the redirect happen. The not-found hint is the
`<p className="hosted-signin-hint">` at ≈ line 670 of the same file.
`uniqueNameKey` (`src/lib/workspaceNames.ts`) is the case-insensitive key.

Prior art for the tests: E400–E403 (path deep links, fragment, sign-in
pass-through, not-found) and E536/E537 (rename via the Names section) in
`tests/e2e/hosted.spec.ts`; U1060 in `tests/unit/hosted-paths.test.ts`. Coding
rules live in `.sandcastle/CODING_STANDARDS.md` — test ids are never reused,
`src/lib/` stays pure, `getByTestId` is the default selector, and behaviour
lands cited.
