# Spec: Scratchpad workspace semantics: personal listing and delete protection (#214)

## Goal

All acceptance criteria in issue-specs/issue-214.md are satisfied for issue
#214, with evidence visible in the session: a scratchpad workspace never
appears in another user's `GET /api/workspaces` listing under any deployment
listing policy, while the owner's own listing carries it flagged so the Open
Workspace dialog labels it "My scratchpad" with a distinguishing badge or
icon; `DELETE /api/workspaces/<id>` refuses to delete a scratchpad
server-side (for every caller, Owner included) and the UI hides the delete
affordance for it while every other workspace verb behaves unchanged; and
`npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- (PRD 019 Req 8) **Excluded from other users' listings.** The
  `GET /api/workspaces` listing in `server/workspaces.ts` never returns a
  row for a scratchpad workspace the caller does not own — under both the
  `everyone` and `members` listing policies, and for admins the same as
  anyone else. A unit test proves it: user B (and an admin) list workspaces
  after user A's scratchpad exists and A's scratchpad is absent from both
  results, while a regular workspace of A's is listed per policy as today.
- (PRD 019 Req 8) **Flagged in the owner's listing.** The owner's own
  listing includes their scratchpad, marked by a new field on the listing
  row (`WorkspaceListing` in `src/lib/workspaceLifecycle.ts`, e.g.
  `scratchpad?: true`; absent/falsy for every other row). A unit test
  asserts the owner's row carries the flag and a non-scratchpad row does
  not.
- (PRD 019 Req 8) **Labeled in the Open Workspace dialog.** In the Open
  Workspace dialog (`src/components/WorkspaceSwitcher.tsx`), the flagged
  row reads "My scratchpad" (or shows that label alongside the name) with
  a distinguishing icon or badge, styled per `docs/STYLE-GUIDE.md`.
  Covered by a test — an e2e in `tests/e2e/hosted.spec.ts` (next free
  `E<n>` number) or a unit test if the rendering logic is extracted.
- (PRD 019 Req 9) **Delete refused server-side.** The
  `DELETE /api/workspaces/<id>` branch in `server/workspaces.ts` rejects a
  scratchpad workspace with a 4xx and an error naming why, for every
  caller — including its Owner and admins — and no blob under the
  workspace prefix is deleted. A unit test proves the refusal and that the
  manifest and pointer (`users/<id>/scratchpad.json`) survive; deleting a
  regular workspace still works.
- (PRD 019 Req 9) **Delete affordance hidden in the UI.** The delete
  section (`src/components/WorkspaceDangerZone.tsx`, rendered from
  Workspace settings) does not render for a scratchpad workspace, even
  though the caller holds `workspace.delete`. Covered by a unit or e2e
  test.
- (PRD 019 Req 9) **Everything else unchanged.** Members, roles, sharing,
  files, and every other verb on a scratchpad behave exactly as on any
  workspace the user Owns — no new special-casing beyond listing and
  delete. At least one test exercises a non-delete verb (e.g. adding a
  member or writing a file) against a scratchpad and it succeeds normally.
- New behavior carries citation comments in the existing style
  (`PRD 019 Req 8: …` / `Req 9: …`), per `.sandcastle/CODING_STANDARDS.md`.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or tests targeted at the changed code) after each change, and ran
  `npm run validate:quick` ONCE, right before declaring the goal met — not
  after every small change and not as a full-suite baseline at the start.
  It prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #214.

## Context

PRD: `prd/019-personal-scratchpad.md` (this issue is Reqs 8–9). Parent:
#211. Blocked-by #213 is already implemented on this branch:
`POST /api/me/scratchpad` (`handleScratchpadResolve` in
`server/workspaces.ts`) creates the scratchpad via
`buildNewWorkspaceManifest` and records its id at
`users/<id>/scratchpad.json` (`scratchpadPointerBlob`).

The key design decision is **how the server (and the listing row)
identifies a scratchpad manifest** — today nothing marks one. The clean
route is a marker on the manifest itself (an optional field added to
`WorkspaceManifest` + `validateWorkspaceManifest` in
`src/lib/hostedWorkspace.ts`, written at scratchpad creation), which the
listing loop, the delete branch, and the listing flag can all read without
extra blob reads per row. No migration concern: #213 has never shipped, so
no real deployment holds an unmarked scratchpad — but parsing of manifests
without the field must stay valid (it's the common case).

Listing: the `GET` branch of `handleWorkspaceApi` builds rows then applies
`filterListedWorkspaces` (`src/lib/deploymentSettings.ts`); exclude
non-owned scratchpads before/independent of that policy filter. The
`WorkspaceDangerZone` component already finds its row via
`lifecycle.list()`, so the listing flag can drive the UI hiding too.
Server unit tests: `tests/unit/server-scratchpad.test.ts` and
`tests/unit/server-workspaces.test.ts` show the handler-vs-mock-provider
pattern. E2e hosted flows live in `tests/e2e/hosted.spec.ts` (numbered
`E<n>`; last used is around E388 — take the next free number).
