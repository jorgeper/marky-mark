# Spec: Land the renaming tab on the new unique-name URL without a reload (#302)

## Goal

All acceptance criteria in issue-specs/issue-302.md are satisfied for issue
#302, with evidence visible in the session: a successful unique-name save in
settings → Names updates the page's workspace binding and rewrites the address
bar in place (`history.replaceState`) to `/<new-name>[/<open file path>]` with
any `#<heading>` fragment preserved, every later address-bar rewrite by that tab
uses the new name and a reload stays at the new URL, new unit tests
(`tests/unit/hosted-paths.test.ts`) and e2e tests (`tests/e2e/hosted.spec.ts`)
cover it, `npm run validate:quick` passes in the implementer's session, and a
summary comment from the implementer exists on issue #302.

## Acceptance criteria

- **The renaming tab lands on the new URL (PRD 024 Req 11).** On a successful
  unique-name save through settings → Names for the workspace this page is
  bound to, the hosted binding's `uniqueName` becomes the name the server
  stored, and the address bar is rewritten in place with
  `window.history.replaceState` to `/<new-name>` plus the path of the currently
  open workspace file, preserving any `#<heading>` fragment already on the URL.
  No navigation, no reload: `window.location.assign`/`reload` are not used on
  this path.
- **Later rewrites use the new name.** After the rename, the PRD 020 Req 6
  address-bar rewrite (`reflectDocumentPath` in `src/platform/hosted.ts`, driven
  by document switches) emits `/<new-name>/…`; the old name is never written to
  the bar again by that tab. Because the copy-link surfaces read
  `window.location.pathname` at call time, the share URLs follow with no extra
  work — do not add a second source of truth for the name.
- **Nothing else about the tab is disturbed (PRD 024 Req 11).** The settings
  dialog stays open on the Workspace tab, the open document stays open and
  active, and unsaved editor state survives the rename — asserted in the e2e
  test, not just argued.
- **Friendly-name-only saves leave the bar alone (PRD 024 Req 12).** A save that
  changes only the display name leaves `window.location.pathname` and
  `window.location.hash` exactly as they were. A save the server refuses (the
  E535 taken-name path) likewise leaves the binding and the bar untouched, and
  E535 still passes unchanged.
- **A scratch binding is never moved to a unique-name path.** When the bound
  workspace is a scratchpad (`scratchOwner` set on the binding, PRD 020
  Req 10/13), a unique-name save leaves the bar on `/<username>/scratchpad[/…]`.
- **Reload after rename stays put (PRD 024 Req 13).** Reloading the renaming tab
  opens the same workspace and the same file at `/<new-name>/…` without passing
  through the not-found page. (This needs no server change: the listing already
  carries the new current name.)
- **Placement.** The URL derivation is a pure function in `src/lib/hostedPaths.ts`
  (no DOM, no React — it is `src/lib/`), reusing `parseAppPath`/`buildAppPath`;
  the binding update and the `replaceState` call live in the hosted platform
  layer (`src/platform/hostedWorkspaces.ts` / `src/platform/hosted.ts`), so
  `src/components/WorkspaceNames.tsx` gains no `platform.kind === 'hosted'`
  branch. New or changed behaviour carries a citation comment naming the
  contract, e.g. `// PRD 024 Req 11 (issue #302): …`.
- **Scope.** Client only: no `server/` change (`formerNames` and former-name
  resolution are #301 and its dependent), no change to desktop, dev-shim or
  single-file behaviour, and no new UI control — the existing Save names button is
  the whole trigger.
- **Unit coverage.** `tests/unit/hosted-paths.test.ts` gains tests with the next
  unused `U<n>` ids (≥ U1235) for the new pure helper: a workspace path with a
  nested file and a fragment, the workspace-only path, per-segment
  percent-encoding of the new name and file segments, and the paths that must
  yield no rewrite (home, `/<username>/scratchpad…`, `/scratchpad`).
- **End-to-end coverage (PRD 024 Req 19, this slice).** `tests/e2e/hosted.spec.ts`
  gains tests with the next unused `E<n>` ids (≥ E536) that drive the real
  Names section (`workspace-unique-name`, `workspace-names-save`, via the
  existing `pathWorkspace` / `signInTo` / `openWorkspaceSettings` /
  `openFromSidebar` helpers): with a file open, renaming lands the tab on
  `/<new-name>/<file>` with the document still open and the dialog still up; a
  later document switch writes the new name; and `page.reload()` stays at
  `/<new-name>/<file>` with no not-found page. A friendly-name-only save
  asserting the unchanged bar belongs here too (or in the unit tier if the
  helper carries the decision).
- **Test economy.** Iterate with `npm run typecheck` and `npm run test:unit`
  (and, for one behaviour, `npx playwright test -g '<title>'`); baseline with
  the quick tier only. Run `npm run validate:quick` ONCE, right before
  declaring the goal met — not after every change.
- **`npm run validate:quick` passes** in the implementer's session, printing
  `QUICK VALIDATION: ALL PASSED`. That gate includes the `docs/MAP.md`
  freshness check, so if a new SPEC citation changes the map, `npm run map` has
  been run and the regenerated file committed.
- **A summary comment from the implementer exists on issue #302**, describing
  what changed and the gate evidence.

## Context

PRD `prd/024-rename-redirects.md` (Reqs 11–13, 19) is the contract; parent issue
is #251. Siblings own the server half (`formerNames`, redirects) — do not build
them here.

The pieces: `src/components/WorkspaceNames.tsx` is the Names section (its save
calls `lifecycle.putManifest`); `src/platform/hostedWorkspaces.ts` holds
`WorkspaceLifecycle`, `putManifest`, and the mutable `HostedBinding`
(`{ id, uniqueName, scratchOwner }`) that `unbind` already rewrites the bar
from; `src/platform/hosted.ts` `reflectDocumentPath` (≈ line 611) is the PRD 020
Req 6 `replaceState` pattern to mirror and the reader of `binding.current.uniqueName`;
`src/lib/hostedPaths.ts` has `parseAppPath`, `buildAppPath`, `buildScratchPath`
and `findWorkspaceByUniqueName`. `useWorkspaceAccess`
(`src/components/WorkspaceAccessSettings.tsx`) always passes
`lifecycle.currentId()`, so the settings dialog only ever renames the bound
workspace — but keep the guard explicit rather than assumed.

Prior art for the tests: E400/E401 (path deep links and bar tracking) and E535
(the taken-name refusal in the Names section) in `tests/e2e/hosted.spec.ts`;
U1058–U1063 in `tests/unit/hosted-paths.test.ts`. Coding rules live in
`.sandcastle/CODING_STANDARDS.md` — test ids are never reused, `src/lib/` stays
pure, and behaviour lands cited.
