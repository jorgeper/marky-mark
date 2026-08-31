# Spec: PRD 017 (2/5): deployment settings record; creation and listing policies (#188)

## Goal

All acceptance criteria in issue-specs/issue-188.md are satisfied for issue #188, with evidence visible in the session: a version-1 `deployment/settings.json` record (parsed/serialized by pure shared functions in `src/lib/`, absent-blob defaults reproducing today's behaviour, corrupt blob failing closed) sits under a new reserved `deployment/` prefix; `POST /api/workspaces` enforces the creation policy (`everyone`/`members`/`restricted`, admins always allowed, guests resolved via the directory's `getUser` over OBO with fail-closed fallback) and `GET /api/workspaces` honours the listing policy, both read per request; `GET /api/me` additionally reports `admin`, `canCreateWorkspaces` and `createRefusal`, and the client renders the `newWorkspace` entries disabled-with-a-reason when creation is refused; and `npm run validate:quick` passes in the implementer's session with a summary comment posted on issue #188.

## Acceptance criteria

- **Req 3 — `/api/me` extension.** `GET /api/me` (`server/app.ts`, currently
  returns the bare user) additionally returns `admin: boolean` (from the
  existing `auth.isAdmin`), `canCreateWorkspaces: boolean` (the Req 8 creation
  policy evaluated for the caller) and, only when that is `false`,
  `createRefusal: 'guest' | 'restricted'`. The hosted platform
  (`src/platform/hosted.ts`) fetches `/api/me` once per session after
  sign-in / page load and holds it instead of re-fetching per use; the
  sign-out path drops it.
- **Req 6 — settings record.** `deployment/settings.json` is the only blob
  under a new reserved `deployment/` prefix added to `RESERVED_PREFIXES` in
  `server/app.ts` (legacy `/api/files` listing hides it; reads/writes 403).
  Version-1 shape per the PRD: `{ version: 1, creation: { policy:
  'everyone' | 'members' | 'restricted', allow: [{ id, displayName? }] },
  listing: { policy: 'everyone' | 'members' } }`. The parser and serializer
  are pure functions in a new `src/lib/` module shared by server and client
  (the `hostedWorkspace.ts` pattern). An absent blob yields the defaults
  `everyone` / `[]` / `everyone` — exactly today's behaviour, so the change
  is operator-invisible until an admin edits the policies.
- **Req 7 — fail closed.** A settings blob that exists but fails to parse
  (bad JSON, unknown version, unknown policy value) behaves as
  `creation.policy = 'restricted'` with an empty allow list and
  `listing.policy = 'members'` until rewritten. The parse result carries the
  error so `GET /api/admin/settings` (a route landing with the Management
  sub-issue, not here) can report it later. Regular users see only the
  effects — never a 500.
- **Req 8 — creation policy.** `POST /api/workspaces`
  (`server/workspaces.ts`) enforces the policy server-side: `everyone` — any
  signed-in user; `members` — tenant members but not guests; `restricted` —
  only admins and ids in `creation.allow`. Admins may create under every
  policy. A disallowed caller gets `403 { error: 'forbidden', required:
  'deployment.create' }` and nothing is written; nothing else about creation
  changes (body, manifest, sole Owner).
- **Req 9 — guest determination.** Under `members`, the server resolves the
  caller's guest status via the directory provider's
  `getUser(caller.id, auth)` (Graph `userType` through the existing OBO
  token, `server/providers/azure/`), cached per user for the same validity
  window the OBO cache uses (`server/providers/azure/obo.ts` pattern). If
  the directory cannot answer, the caller is treated as a guest (fail
  closed). In local mode the mock directory answers from `SEEDED_USERS`
  (`mock-mary` is the seeded guest).
- **Req 10 — client affordances.** When `/api/me` reports
  `canCreateWorkspaces: false`, the `newWorkspace` entries stay visible but
  disabled: the File-menu item via the menu spec's existing `disabled` flag
  (`src/lib/menuSpec.ts`), and the start-page action
  (`src/lib/startActions.ts` / its renderer) disabled with a one-line hint
  beneath it worded from `createRefusal` — `restricted`: creation is limited
  in this deployment and a deployment admin can grant it; `guest`: guests
  cannot create workspaces here. `openWorkspace` is unaffected; a stale
  client that still enables the entry gets the Req 8 refusal through the
  existing error surface.
- **Req 11 — listing policy.** `GET /api/workspaces` honours
  `listing.policy`: `everyone` returns every workspace as today; `members`
  omits every row whose `access` would be `false` for the caller, row shape
  unchanged. Admins get the same filtered listing as anyone else in the
  ordinary Open Workspace dialog.
- **Req 12 — no-access message.** The `noAccessMessage` naming Owners stays
  for `everyone` and cannot arise under `members` (inaccessible rows are
  never sent); the existing E184 tests keep passing under the default
  policy.
- **Req 15 — immediate effect.** The create and list routes read
  `deployment/settings.json` per request (one small blob read) — no restart,
  no cache to invalidate.
- **Tests.** Unit tests (next unused `U` numbers — U963+ —
  `describe('PRD 017 §…')`) cover the settings parser/serializer including
  the absent-blob defaults and the Req 7 fail-closed cases, and the
  creation-policy and listing-filter decision functions across
  admin/member/guest/allow-listed callers, plus the caller-guest lookup with
  injected fetch/cache. E2e tests (next unused `E` numbers — E360+ — in
  `tests/e2e/hosted.spec.ts`, each restoring the default settings in a
  `finally`) cover at least: under `restricted`, a regular user's start-page
  action is disabled with the restricted hint, the File-menu item is
  disabled, and `POST /api/workspaces` answers 403 `deployment.create`,
  while an allow-listed user creates normally; under `members`, `mary` is
  refused with the guest hint and a member is not; under `members` listing,
  a non-member's `GET /api/workspaces` omits the workspace and the Open
  Workspace dialog does not show it; `/api/files` refuses the `deployment/`
  prefix. `E2E_TEST_FLOOR` in `scripts/validate.mjs` (currently 346) is
  re-pinned to the new count. New code carries `SPEC<n>` citation comments
  per `.sandcastle/CODING_STANDARDS.md`, and `docs/MAP.md` is regenerated
  with `npm run map` if it changed.
- Iterate with `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code) after each change; baseline an attempt with
  the quick tier only. Run `npm run validate:quick` ONCE, right before
  declaring the goal met, and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #188.

## Context

Parent #181; PRD `prd/017-deployment-admins.md` (Reqs 3, 6–12, 15 — read
those sections; Management view, admin routes, invitations and docs updates
belong to sibling sub-issues). Blockers #187 (MM_ADMINS, `auth.isAdmin`,
deployment-level permission names, `mock-mary`) and #184 (valid OBO
assertion) are both merged — build on them. Key anchors:
`RESERVED_PREFIXES` and the `/api/me` route in `server/app.ts`; workspace
create/list in `server/workspaces.ts` (POST at the collection route, listing
derived from manifests with `access` per caller); directory contract in
`server/providers/types.ts` (`getUser`, `isGuest?`); OBO cache pattern in
`server/providers/azure/obo.ts`; mock directory in
`server/providers/mock/`. Client: `src/platform/hosted.ts` (session
`/api/me`), `src/lib/menuSpec.ts` (`disabled` flag), `src/lib/startActions.ts`.
Grep `SPEC` citations before opening files; never read `App.tsx` whole.
