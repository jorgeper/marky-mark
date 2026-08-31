# Spec: PRD 017 (3/5): the Management view — admin routes, Workspaces/People/Settings tabs, admin banner (#189)

## Goal

All acceptance criteria in issue-specs/issue-189.md are satisfied for issue #189, with evidence visible in the session: four `deployment.admin`-gated routes exist (`GET /api/admin/workspaces`, `GET /api/admin/users`, `GET /api/admin/settings`, `PUT /api/admin/settings`, 403 for everyone else); an admin-only `management` command (File menu + start page) opens a near-full-window `data-testid="management-panel"` dialog whose Workspaces tab lists every workspace with owner/member/size statistics and working Open/Delete actions, whose read-only People tab lists every tenant user via a new `DirectoryProvider.listUsers`, and whose Settings tab edits and saves both deployment policies; a non-member admin bound to a workspace sees the persistent Req 5 banner; and `npm run validate:quick` passes in the implementer's session with a summary comment posted on issue #189.

## Acceptance criteria

- **Req 5 — admin banner.** When the bound workspace's manifest grants the
  signed-in user nothing (no explicit membership, no everyone-access) and
  `/api/me` says `admin: true`, the SPA shows a persistent, non-dismissable
  banner stating both facts — viewing as a deployment admin, not a member —
  and it disappears once they hold a role (e.g. after adding themselves in
  People). The predicate is a pure function (in `src/lib/`, beside the
  Req 4 union in `src/lib/hostedWorkspace.ts`) over the manifest and the
  `/api/me` payload.
- **Req 13 — entry and dialog.** A `management` command exists beside
  `newWorkspace` / `openWorkspace` (`src/lib/menuSpec.ts`,
  `src/lib/startActions.ts`): File-menu item **Management…** and a
  start-page action, both present only when `/api/me` reports
  `admin: true`, available whether or not a workspace is bound. It opens a
  near-full-window dialog in the Settings dialog's style
  (`SettingsPanel.tsx` is the model) with `data-testid="management-panel"`
  and **Workspaces**, **People**, **Settings** tabs. The dialog fills the
  window minus a small uniform inset (~2–3% per side, zero on narrow
  windows), content scrolls inside, tables use its full width, and it does
  NOT inherit the Settings dialog's fixed maximum width.
- **Req 14 — admin routes.** Four routes exist, each requiring
  `deployment.admin` (`auth.isAdmin` from `server/app.ts`; refusal is the
  Req 2 shape `403 { error: 'forbidden', required: 'deployment.admin' }`
  for everyone else, including Owners): `GET /api/admin/workspaces`
  (Req 16 rows), `GET /api/admin/users` (Req 19 rows),
  `GET /api/admin/settings` (parsed settings plus the Req 7 parse error
  when present), `PUT /api/admin/settings` (validates with the shared
  parser from issue #188's `src/lib/` module, 400 on invalid body, last
  write wins, no ETag). The client reaches them through the existing
  hosted fetch wrapper — no new call site outside `FETCH_ALLOWLIST`.
- **Req 16 — Workspaces tab.** One row per workspace regardless of the
  admin's membership: name, created, modified, Owners (ids resolved via
  the existing `resolveMembers` in `src/lib/membership.ts`, so
  display-name snapshots and guest badges apply), member count,
  everyone-access (off, or the default role), file count, total size.
  Sorted modified-newest-first with the existing fuzzy filter; a header
  shows totals (workspaces, files, bytes). Figures are aggregated from ONE
  `storage.list('workspaces/')` call, grouped by workspace prefix, by a
  pure function over `FileStat[]` (file count = blobs under `files/`, size
  = every blob under the prefix). A workspace with a corrupt manifest
  still appears, flagged as such, with its blob figures.
- **Req 17 — Open.** Each row's Open action binds to the workspace exactly
  as the Open Workspace dialog does (`navigateTo` on the hosted workspaces
  platform, `src/platform/hostedWorkspaces.ts`). Req 4's implicit grants
  make it readable, Req 5 shows the banner, and a content edit gets the
  ordinary 403 until the admin adds themselves in People.
- **Req 18 — Delete.** Each row's destructive-styled Delete action reuses
  the Owner-facing pattern: `WorkspaceDangerZone` wording, the
  `deleteConfirmationMatches` exact-name gate
  (`src/lib/workspaceLifecycle.ts`), then the existing
  `DELETE /api/workspaces/<id>` (authorised by Req 4). Row and totals
  update on success; deleting the currently bound workspace unbinds it
  exactly as Owner-deletion does today.
- **Req 19 — People tab.** Every tenant user: display name, username, the
  existing Guest badge, an **Admin** badge for ids in `MM_ADMINS`, and each
  user's explicit-membership workspace count (derived from the manifests
  the Workspaces tab already loads). Sorted by display name, with the
  fuzzy filter, read-only. One new `DirectoryProvider` method
  `listUsers(auth)` (`server/providers/types.ts`): the Graph
  implementation pages
  `GET /users?$select=id,displayName,userPrincipalName,userType&$top=999`
  through `@odata.nextLink` with the OBO token (delegated
  `User.ReadBasic.All` suffices); the mock returns the seeded five-user
  list. A directory failure shows an error state in the tab, never an
  empty list.
- **Req 20 — Settings tab.** Edits both policies: creation policy as three
  exclusive choices with Req 8's semantics spelled out, the allow list
  (shown and editable only under `restricted`) using the existing
  `MembershipPicker` with add-time display-name snapshots (the issue #180
  pattern), listing policy as two exclusive choices. Save PUTs the whole
  record; the Req 7 parse error is shown when present; the client
  validates with the shared parser before sending so refusals are
  predicted, never discovered.
- **Tests.** Unit tests (next unused `U` numbers — U971+ —
  `describe('PRD 017 §…')`) cover at least: the Req 5 banner predicate;
  the Req 16 statistics aggregation over a synthetic `FileStat[]`
  (including a corrupt-manifest workspace); Graph `listUsers` paging with
  injected fetch; and the mock directory's `listUsers`. E2e tests (next
  unused `E` numbers — E364+ — in `tests/e2e/hosted.spec.ts`, each
  restoring default settings and any created workspaces in a `finally`)
  cover at least: a non-admin's `/api/me` says `admin: false`, they have
  no Management entry, and every one of the four admin routes answers 403
  `deployment.admin`; the admin's Workspaces tab lists a workspace they
  are not a member of with owners, member count, file count and size
  matching what was created; the admin opens it, reads a document, sees
  the banner, gets 403 `doc.edit` on save, adds themself as Owner in
  People, saves, and the banner is gone; the admin deletes a non-member
  workspace behind the exact-name gate and every blob under its prefix is
  gone; settings saved from the Settings tab are returned by
  `GET /api/admin/settings` after a reload, and a hand-corrupted settings
  blob produces the visible parse error; the People tab lists all five
  seeded users with the Guest badge on `mary` and the Admin badge on
  `katherine`. `E2E_TEST_FLOOR` in `scripts/validate.mjs` (currently 353)
  is re-pinned to the new count. New code carries `SPEC<n>` citation
  comments per `.sandcastle/CODING_STANDARDS.md`, and `docs/MAP.md` is
  regenerated with `npm run map` if it changed.
- Iterate with `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code) after each change; baseline an attempt
  with the quick tier only. Run `npm run validate:quick` ONCE, right
  before declaring the goal met, and it prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #189.

## Context

Parent #181; PRD `prd/017-deployment-admins.md` Reqs 5, 13, 14, 16–20 (read
those; policies/record are #188's, invitations and docs are sibling
sub-issues — do not implement Reqs 29–34 or 21–24 here). Blockers #187
(`MM_ADMINS`, `auth.isAdmin`, `deployment.admin`, seeded `mock-mary`), #188
(settings parser/record, policies, extended `/api/me` held per session in
`src/platform/hosted.ts`) and #184 (working OBO exchange) are all on this
branch — build on them. Key anchors: admin stamping and `RESERVED_PREFIXES`
in `server/app.ts`; workspace routes and `DELETE` in `server/workspaces.ts`;
directory contract in `server/providers/types.ts` with Graph and mock
implementations under `server/providers/azure/` and `server/providers/mock/`;
Req 4 union in `src/lib/hostedWorkspace.ts:665`; dialog model in
`src/components/SettingsPanel.tsx`; reusable pieces
`src/components/WorkspaceDangerZone.tsx`, `src/components/MembershipPicker.tsx`,
`src/lib/membership.ts` (`resolveMembers`), `src/lib/workspaceLifecycle.ts`
(`deleteConfirmationMatches`). In local mode `katherine` is the one admin
and `mary` the guest. Grep `SPEC` citations before opening files; never
read `App.tsx` whole.
