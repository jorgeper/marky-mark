# Spec: PRD 017 (4/5): in-app guest invitations — route, Management and People-picker surfaces, Pending badge (#190)

## Goal

All acceptance criteria in issue-specs/issue-190.md are satisfied for issue #190, with evidence visible in the session: `POST /api/admin/invitations` exists behind `deployment.admin`, validates its body with a shared pure parser in `src/lib/`, invites through Graph `POST /v1.0/invitations` on behalf of the signed-in admin over the OBO exchange (scope set grown by `User.Invite.All`) and answers `201 { id, email, displayName, pending: true }`, with an optional same-request workspace role grant; both surfaces work — Management → People's **Invite…** form and the workspace People picker's admin-only **Invite <email> as <role>** row — and both People surfaces render a **Pending** badge from Graph `externalUserState`; the mock directory supports invitations so the whole flow is e2e-tested offline; both hosting guides, `docs/AUTHENTICATION.md` and `server/README.md` cover the permission and the route; and `npm run validate:quick` passes in the implementer's session with a summary comment posted on issue #190.

## Acceptance criteria

- **Req 29 — route.** `POST /api/admin/invitations` exists in the admin
  router (`server/admin.ts`, `handleAdminApi`), requiring `deployment.admin`
  with the Req 2 refusal shape (`403 { error: 'forbidden', required:
  'deployment.admin' }`) for everyone else. The body
  `{ email, note?, workspace?: { id, role } }` is validated by a shared pure
  parser in `src/lib/` used by both server and client (400 for a malformed
  email, an unknown role, or a note over 500 characters). The server calls
  Graph `POST /v1.0/invitations` on behalf of the signed-in admin through
  the OBO exchange: `invitedUserEmailAddress`, `inviteRedirectUrl` = the
  deployment's origin with a trailing slash, `sendInvitationMessage: true`,
  and a `customizedMessageBody` built by a pure template function naming the
  inviter's display name and Marky Mark, followed by the optional note.
  `GRAPH_OBO_SCOPE` (`server/providers/azure/obo.ts`) grows by
  `User.Invite.All`. Success answers `201 { id, email, displayName,
  pending: true }` where `id` is Graph's `invitedUser.id`; Graph refusals
  (already in tenant, blocked domain, missing consent) map to `502` carrying
  Graph's `error.code` and message — never a silent success — and no log
  line or response ever contains a token. The client reaches the route
  through the existing hosted fetch wrapper — no new call site outside
  `FETCH_ALLOWLIST`.
- **Req 30 — role at invite.** When `workspace` is present the server, in
  the same request and before answering, adds `{ id: invitedUser.id, role,
  displayName: <the email> }` (the issue #180 display-name snapshot pattern)
  to that workspace's manifest through the existing `addWorkspaceMember`
  path (`server/workspaces.ts` / `src/lib/hostedWorkspace.ts`); the caller
  must hold `workspace.members` there (implicit for admins per Req 4). If
  the membership write fails after the invitation succeeded, the answer is
  still `201` with `membership: { error }`, the UI says so, and the
  invitation is not rolled back.
- **Req 31 — Management → People.** The People tab
  (`src/components/ManagementPanel.tsx`) gains an **Invite…** action opening
  a small form — email, optional note, Send — calling Req 29 without
  `workspace`. Success appends the user row with the Pending badge; a Graph
  refusal shows Graph's message inline.
- **Req 32 — workspace picker.** In a workspace's People section
  (`src/components/WorkspaceMembers.tsx` / `MembershipPicker.tsx`), when the
  signed-in user is an admin and the typed query is a syntactically valid
  email with no directory match, the picker offers one extra row — **Invite
  <email> as <role>**, with the role select — as the empty state's action
  under issue #183's autocomplete, calling Req 29 with `workspace` set; on
  success the member row appears with the Pending badge. Non-admins never
  see the row; the predicate is a pure function (in `src/lib/`) over the
  `/api/me` payload, the query and the search results.
- **Req 33 — Pending badge.** `DirectoryEntry` (`src/lib/membership.ts`)
  and the server's `DirectoryUser` (`server/providers/types.ts`) gain
  `pending?: boolean`, derived from Graph
  `externalUserState === 'PendingAcceptance'` — the `$select` in
  `server/providers/azure/graph.ts` is extended with `externalUserState` in
  search, `getUser` and `listUsers`. Both People surfaces (workspace
  members and Management → People) render a **Pending** badge beside the
  existing Guest badge until acceptance. The mock directory
  (`server/providers/mock/directory.ts`) supports invitations — a POST
  creates an in-memory pending guest (`isGuest: true, pending: true`) and a
  test helper can mark it accepted — so the whole flow is e2e-tested
  offline.
- **Req 34 — docs and registration.** `docs/HOSTING-AZURE.md` and
  `docs/HOSTING-AZURE-PORTAL.md` both add `User.Invite.All` (delegated,
  admin consent) to their Graph permissions step and state that invitations
  are sent as the signed-in admin, so Entra's `allowInvitesFrom` policy
  applies on top. `docs/AUTHENTICATION.md` § "Adding people" gains an
  "Inviting from the app" passage noting that with Entra Google federation
  configured (an operator step, no app change) gmail invitees sign in with
  Google. `server/README.md` documents the route.
- **Tests.** Unit tests (next unused `U` numbers — U981+ —
  `describe('PRD 017 §…')`) cover at least: the body parser (valid,
  malformed email, unknown role, over-long note), the message template, the
  invite-row predicate (admin vs non-admin, matching vs non-matching query),
  and the mock directory's invitations (create-pending, mark-accepted). E2e
  tests (next unused `E` numbers — E375+ — in `tests/e2e/hosted.spec.ts`,
  each restoring state in a `finally`) cover at least: an invite from
  Management → People appending a row with the Pending badge; an
  invite-with-role from a workspace's People section landing the guest as a
  member at that role with the Pending badge; the badge clearing once the
  helper marks the guest accepted; a non-admin seeing no invite row in the
  picker and getting 403 `deployment.admin` from the route; and a mock
  Graph refusal surfacing its message inline. The `E2E_TEST_FLOOR` re-pin
  is NOT this issue's job — it folds into the final gate issue (the floor
  in `scripts/validate.mjs` is a lower bound, so added tests keep it
  passing). New code carries `SPEC<n>` citation comments per
  `.sandcastle/CODING_STANDARDS.md`, and `docs/MAP.md` is regenerated with
  `npm run map` if it changed.
- Iterate with `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code) after each change; baseline an attempt with
  the quick tier only. Run `npm run validate:quick` ONCE, right before
  declaring the goal met, and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #190.

## Context

Parent #181; PRD `prd/017-deployment-admins.md` § Invitations (Reqs 29–34 —
read that section; the Management view is #189's, settings are #188's, the
final gate is the sibling 5/5 issue — do not re-pin the e2e floor here).
Blockers #189 (Management view, `listUsers`, admin routes) and #184 (working
OBO exchange) are already on this branch — build on them. Key anchors: admin
router `server/admin.ts` (`handleAdminApi`); `GRAPH_OBO_SCOPE` in
`server/providers/azure/obo.ts`; Graph directory calls with their `$select`
in `server/providers/azure/graph.ts`; mock directory in
`server/providers/mock/directory.ts`; `addWorkspaceMember` in
`src/lib/hostedWorkspace.ts` with its server path in `server/workspaces.ts`;
client `DirectoryEntry` and Guest badge in `src/lib/membership.ts` /
`src/components/MembershipPicker.tsx`; the two surfaces in
`src/components/ManagementPanel.tsx` and
`src/components/WorkspaceMembers.tsx`. In local mode `katherine` is the one
admin and `mary` the seeded guest. Grep `SPEC` citations before opening
files; never read `App.tsx` whole.
