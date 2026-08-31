# PRD 017: Deployment admins — creation and listing policies, and the Management view

**Status:** Draft
**Date:** 2026-08-30

Issue: #181.

## Problem

Hosted Marky Mark has exactly one kind of person: a signed-in tenant user.
Once past the door, two things are open to everyone by design (PRD 007
Reqs 10–11): any signed-in user — member or invited guest — may create a
workspace and become its sole Owner, and any signed-in user sees every
workspace's name and last-modified time in the Open Workspace dialog. The
only lever on either is tenant membership itself (`docs/AUTHENTICATION.md`
§ "Who can do what": *"There is currently no lever…"*).

The operator has no way to run the deployment from inside it either. There
is no view of "every workspace that exists", no way to tell which
workspaces are large, stale or ownerless, no way to delete a workspace
whose Owner has left, and no view of who the tenant's users are — the
container is one bag of blobs and the only tool is the Azure portal. Every
permission in the app is per-workspace (the fourteen-verb catalog resolved
from each manifest); nothing lets anyone act across workspaces they are
not a member of, and no route is gated on anything but a workspace verb.

This PRD introduces the one missing concept — a **deployment admin** — and
builds the two things on it: operator control over who may create and who
may see the directory, and an in-app **Management** view for admins that
lists everything, shows what is derivable about size and activity, and
takes the administrative actions. The per-workspace model is untouched;
admins are layered on top of it, and the layering is explicit about where
it crosses the membership boundary.

## Goals

- An operator can designate a small set of deployment admins, from
  configuration, with no code change and no in-app privilege escalation
  path.
- An operator (through an admin) can restrict who may create workspaces
  and whether non-members see workspace names, without touching tenant
  membership; the defaults reproduce today's behaviour exactly, so a
  deployment upgrades with no operator action.
- A signed-in admin gets a Management view no regular user ever sees: every
  workspace with its owners, membership and storage footprint; every tenant
  user; the deployment's policies. From it they can open or delete any
  workspace.
- The membership boundary is crossed in one stated way: admins can *read*
  any workspace and *administer* it (membership, roles, settings, delete)
  but never edit content without first making themselves a member — an
  act visible to that workspace's Owners in the People section.
- Everything is server-enforced. The Management view and the disabled
  affordances are UI over admin-only and policy-checked routes; a
  non-admin or a disallowed creator gets a 403 naming the missing
  permission whatever the client shows.
- The local lane (`npm run server:local`, mock auth, Azurite) has one
  seeded admin and one seeded guest so the whole feature is developed and
  e2e-tested with zero Azure resources.

## Non-goals

- **Managing admins in-app.** The admin set is configuration only
  (`MM_ADMINS`). No "make me admin" affordance, no last-admin rule, no
  admin self-service. Changing who is admin is a redeploy, deliberately —
  it keeps the escalation path outside the app.
- **Implicit write access for admins.** Admins do not get `doc.edit`,
  `file.create/delete/rename/upload`, `folder.manage` or `comment.write`
  on workspaces they are not members of. Making oneself a member is the
  audit trail.
- **An audit log.** No `deployment/audit.*` blob, no activity feed, no
  Owner notification when an admin reads or deletes a workspace. Admin
  membership changes are visible in People; deletion is visible by
  absence. A log is a follow-up if the visibility-by-membership rule
  proves insufficient.
- **A metrics store, history or time series.** Usage figures are derived on
  demand from one blob listing (sizes, counts, last-modified); nothing is
  recorded, cached or graphed over time.
- **Quotas, limits or billing.** Storage figures are informational; no
  per-workspace or per-user cap, no enforcement, no cost estimation.
- **Tenant user management.** People is read-only: creating, inviting,
  disabling or removing users stays in Entra ID (`HOSTING-AZURE.md` § 1).
- **Impersonation.** An admin never acts *as* another user; every request
  is the admin's own identity with the admin's own permissions.
- **Per-workspace visibility overrides.** No "unlisted" workspace flag;
  listing visibility is one deployment-wide policy.
- **Hiding workspace existence by id.** A non-member request to
  `/api/workspaces/<uuid>/…` keeps today's 403 naming the verb even under
  members-only listing; a random UUID is not treated as a secret.
- **Email- or UPN-keyed allowlists.** Every list in this PRD is keyed by the
  provider's stable user id (Entra `oid`), like workspace membership.
- **A URL route for Management.** The SPA has no router; Management is a
  dialog like Settings, not a page.
- **Changing the fourteen-verb catalog or the built-in roles.** The two new
  permission names are deployment-level, never role-grantable.
- **Rate limiting, bulk actions, export or search across contents.**
- **The desktop and static-web flavors.** Untouched; nothing here has a
  desktop or web analogue.

## Requirements

### Deployment admins

1. `server/config.ts` reads an optional `MM_ADMINS`: a comma-separated
   list of user ids (Entra object ids in azure mode, mock ids in local
   mode). Entries are trimmed and empty entries dropped; an entry
   containing whitespace makes `loadConfig` refuse to start in the
   existing all-problems-at-once style, naming the variable. Unset or
   empty means the deployment has no admins and every admin surface in
   this PRD is simply absent. The startup line reports the admin *count*;
   ids are not secrets but are not logged either.
2. Two deployment-level permission names exist beside the workspace verb
   catalog: `deployment.admin` and `deployment.create`. They are not
   members of `PERMISSIONS`, no built-in or custom role can grant them,
   and the role editors never offer them. A refusal is the existing 403
   shape, `{ error: 'forbidden', required: '<name>' }`.
3. `GET /api/me` returns additional fields beside the unchanged
   `id`/`username`/`displayName`: `admin: boolean` (the caller's id is in
   `MM_ADMINS`), `canCreateWorkspaces: boolean` (the creation policy of
   Req 8 evaluated for the caller) and, when that is `false`,
   `createRefusal: 'guest' | 'restricted'` naming why, so the client can
   word its hint (Req 10). The hosted platform fetches `/api/me` once
   after sign-in / page load and holds it for the session instead of
   re-fetching per use; the sign-out path drops it.
4. **Implicit admin permissions.** In every workspace, an admin holds
   `doc.read`, `file.download`, `comment.read`, `workspace.settings`,
   `workspace.members`, `workspace.roles` and `workspace.delete` in
   addition to whatever their explicit membership or the everyone-role
   grants (a union, never an override). This is implemented in the single
   permission-resolution path the server already uses
   (`requirePermission` → `resolvePermissions`), so every existing route
   inherits it with no per-route change, and the same pure function is
   what the client uses to predict refusals. No other verb is ever
   implicit (see Non-goals).
5. **Admin banner.** When the bound workspace's manifest grants the signed-in
   user nothing — no explicit membership and no everyone-access — and they
   are an admin, the SPA shows a persistent, non-dismissable notice in the
   workspace stating both facts: that they are viewing it as a deployment
   admin and that they are not a member. It disappears once they hold a
   role (e.g. after adding themselves in People). The predicate is a pure
   function over the manifest and `/api/me`.

### Deployment settings and the creation policy

6. A deployment-settings record lives at `deployment/settings.json` in the
   container — the only blob under a new reserved `deployment/` prefix,
   which joins `workspaces/` and `users/` in the legacy `/api/files`
   scaffold's `RESERVED_PREFIXES` (listing hides it, reads/writes 403).
   Version 1 shape:

       {
         "version": 1,
         "creation": {
           "policy": "everyone" | "members" | "restricted",
           "allow": [{ "id": string, "displayName"?: string }]
         },
         "listing": { "policy": "everyone" | "members" }
       }

   The parser and serializer are pure functions in `src/lib/` shared by
   server and client (the `hostedWorkspace.ts` pattern). An absent blob
   yields the defaults `creation.policy = "everyone"`, `allow = []`,
   `listing.policy = "everyone"` — today's behaviour, so an upgraded
   deployment changes nothing until an admin changes it.
7. A settings blob that exists but fails to parse (bad JSON, unknown
   version, unknown policy value) **fails closed**: the server behaves as
   `creation.policy = "restricted"` with an empty allow list and
   `listing.policy = "members"` until it is rewritten, and
   `GET /api/admin/settings` (Req 15) reports the parse error so the
   Management Settings tab can show it and let an admin save over it.
   Regular users see only the effects; no 500.
8. **Creation policy semantics**, evaluated server-side on
   `POST /api/workspaces` and reported in `/api/me`:
   - `everyone` — any signed-in user may create (PRD 007 Req 10, unchanged).
   - `members` — tenant members may create; guests may not.
   - `restricted` — only admins and users whose id is in `creation.allow`.
   Admins may create under every policy. A disallowed caller gets
   `403 { error: 'forbidden', required: 'deployment.create' }` and nothing
   is written. Nothing else about creation changes (body, manifest, sole
   Owner).
9. **Guest determination for the caller.** Under `members`, the server
   asks the directory provider for the caller's own entry
   (`getUser(caller.id, auth)`, i.e. Graph `userType` via the existing OBO
   token) and caches the answer per user for the same validity window
   the OBO cache uses. If the directory cannot answer, the caller is
   treated as a guest (fail closed). In local mode the mock directory
   answers from the seeded list (Req 22).
10. **Client affordances.** When `/api/me` reports
    `canCreateWorkspaces: false`, the `newWorkspace` entries stay visible
    but **disabled with a reason**: the File-menu item is rendered
    disabled through the menu spec's existing `disabled` flag (native
    menus carry no tooltip, so the menu item alone says nothing more),
    and the start-page action is rendered disabled with a one-line hint
    beneath it worded from `createRefusal` — for `restricted`, that
    workspace creation is limited in this deployment and a deployment
    admin can grant it; for `guest`, that guests cannot create
    workspaces here. `openWorkspace` is unaffected. Because the server
    decides, a stale client that still enables the entry gets the Req 8
    refusal and the existing error surface.

### Listing policy

11. `GET /api/workspaces` honours `listing.policy`: under `everyone` it
    returns every workspace as today (PRD 007 Req 11); under `members` it
    omits every row whose `access` would be `false` for the caller. Row
    shape is unchanged. Admins get the same filtered listing as anyone
    else in the ordinary Open Workspace dialog — cross-membership browsing
    lives in Management only, so the everyday UI never depends on who you
    are.
12. The no-access message naming Owners (`noAccessMessage`, PRD 007
    Req 11) stays for `everyone`; under `members` it cannot arise because
    inaccessible rows are never sent. The existing tests for it (E184)
    keep passing under the default policy.

### The Management view

13. **Entry.** A `management` command exists beside `newWorkspace` /
    `openWorkspace`: a File-menu item **Management…** and a start-page
    action of the same name, both present only when `/api/me` reports
    `admin: true`. It opens a near-full-window dialog in the Settings
    dialog's style (`data-testid="management-panel"`) with three tabs —
    **Workspaces**, **People**, **Settings** — and closes back to wherever
    the user was. It is available whether or not a workspace is bound.
    **Size:** the dialog fills the window minus a small uniform inset (on
    the order of 2–3% per side, so roughly 95% of the viewport in each
    dimension), the inset shrinking to zero on narrow windows; the tab
    content scrolls inside the dialog and tables use its full width. It
    must not inherit the Settings dialog's fixed maximum width.
14. **Admin routes.** Four routes exist, each requiring `deployment.admin`
    (403 per Req 2 for everyone else, including non-admins who are Owners
    of every workspace):
    - `GET /api/admin/workspaces` — every workspace with statistics (Req 16);
    - `GET /api/admin/users` — every tenant user (Req 19);
    - `GET /api/admin/settings` — the parsed settings of Req 6 plus, when
      Req 7 applies, the parse error;
    - `PUT /api/admin/settings` — replaces the record after validating it
      with the shared parser (400 on an invalid body). Last write wins;
      no ETag negotiation.
    The client reaches them through the existing hosted fetch wrapper (no
    new call site outside `FETCH_ALLOWLIST`).
15. **Settings take effect immediately.** The create and list routes read
    `deployment/settings.json` per request (one small blob read); no
    restart, no cache to invalidate.
16. **Workspaces tab.** One row per workspace in the deployment, whether
    or not the admin is a member: name, created, modified, Owners (ids
    resolved through the existing `resolveMembers`, so display-name
    snapshots and guest badges apply), member count, everyone-access
    (off, or the default role), file count and total size. Rows sort
    modified-newest-first with the existing fuzzy filter; a header shows
    totals (workspaces, files, bytes). Figures come from one
    `storage.list('workspaces/')` call aggregated by workspace prefix by
    a pure function over `FileStat[]`: *file count* is the number of blobs
    under `files/`, *size* is the sum of every blob under the prefix
    (documents, sidecars, images, summary cache), and a workspace whose
    manifest is corrupt still appears, flagged as such, with its blob
    figures — Management is where an operator finds broken things.
17. **Open.** Each row has an Open action that binds to the workspace
    exactly as the Open Workspace dialog does (`navigateTo`). Req 4 makes
    it readable; Req 5 shows the banner; any content edit attempt gets
    the ordinary 403 until the admin adds themselves in People.
18. **Delete.** Each row has a destructive-styled Delete action reusing
    the Owner-facing pattern: the same warning sentence and copy as
    `WorkspaceDangerZone` (PRD 016 Req 13 wording), the same exact-name
    gate (`deleteConfirmationMatches`), then the existing
    `DELETE /api/workspaces/<id>` (which Req 4 authorises). The row and
    the totals update on success. Deleting the workspace currently bound
    in this page unbinds it as Owner-deletion does today.
19. **People tab.** Every tenant user: display name, username, the
    existing Guest badge, an **Admin** badge for ids in `MM_ADMINS`, and
    the count of workspaces in which the user is an explicit member
    (derived from the manifests the Workspaces tab already loads). Sorted
    by display name, with the fuzzy filter. Read-only (see Non-goals).
    This needs one new `DirectoryProvider` method, `listUsers(auth)`: the
    Graph implementation pages
    `GET /users?$select=id,displayName,userPrincipalName,userType&$top=999`
    through `@odata.nextLink` with the OBO token (delegated
    `User.ReadBasic.All` already covers it — no new registration
    permission), the mock returns the seeded list. A directory failure
    shows an error state in the tab, not an empty list.
20. **Settings tab.** Controls for the two policies: the creation policy
    as three exclusive choices with the semantics of Req 8 spelled out,
    the allow list (shown and editable only under `restricted`) using the
    existing `MembershipPicker` to add users — with a display-name
    snapshot taken at add time, the issue #180 pattern — and remove them,
    and the listing policy as two exclusive choices. A Save action PUTs
    the whole record; the tab shows the parse error of Req 7 when there
    is one. The client validates with the shared parser before sending so
    refusals are predicted, never discovered.

### Documentation

21. `docs/AUTHENTICATION.md` § "Who can do what" replaces the *"no
    lever"* paragraph: the two open-to-everyone items become
    policy-controlled, the levers table gains rows for deployment admins
    (`MM_ADMINS`), the creation policy and the listing policy, a short
    "Deployment admins" passage states the implicit permission set of
    Req 4 and the visibility-by-membership rule in plain language, and
    the "Where the pieces live" table gains the admin routes, the
    settings module and the Management component.
22. `docs/HOSTING-AZURE.md` § 4 (environment variables) and
    `docs/HOSTING-AZURE-PORTAL.md` § 5.2 add `MM_ADMINS` as an optional
    setting, with how to find a user's object id (`az ad user show --id
    <upn> --query id -o tsv`; portal: Entra ID → Users → Object ID), and a
    short "Deployment admins and policies" subsection pointing at the
    Management view for everything else. The existing
    `tests/unit/docs-hosting-llm.test.ts` parity check keeps passing
    (`MM_ADMINS` is read by `server/config.ts`).
23. `server/README.md` documents `MM_ADMINS`, the `deployment/` prefix and
    settings record, the two deployment-level permission names, the
    implicit admin set, and the four admin routes in the API surface with
    their required permission, in the same style as the workspace routes.
24. `prd/007-azure-hosted-workspaces.md` Reqs 10 and 11 each gain one
    sentence noting that PRD 017 put the behaviour behind a deployment
    policy whose default is the original behaviour.

### Local mode and tests

25. `SEEDED_USERS` gains a fifth user, `mock-mary` / `mary` / Mary Jackson,
    with `isGuest: true`; the four existing users are unchanged and remain
    non-admins so no existing test changes meaning. In local mode
    `MM_ADMINS` defaults to `mock-katherine` when unset (so
    `npm run server:local` and the Playwright hosted lane have exactly one
    admin); azure mode has no default.
26. Unit tests (`U805+`, `describe('PRD 017 §…')`) cover: `MM_ADMINS`
    parsing and the whitespace refusal; the settings parser/serializer
    including the fail-closed defaults of Req 7; the creation-policy and
    listing-filter decision functions across admin/member/guest/allow-listed
    callers; the implicit-permission union of Req 4; the banner predicate
    of Req 5; the statistics aggregation of Req 16 over a synthetic
    `FileStat[]`; Graph `listUsers` paging and the caller-guest lookup
    with injected fetch; and the mock directory's `listUsers`.
27. E2e tests (`E326+`, `tests/e2e/hosted.spec.ts`), each restoring the
    default settings in a `finally` so the shared lane stays
    order-independent:
    - a non-admin's `/api/me` says `admin: false`, has no Management
      entry, and every admin route answers 403 `deployment.admin`;
    - the admin's Workspaces tab lists a workspace they are not a member
      of, with owners, member count, file count and size matching what
      was created;
    - the admin opens that workspace, reads a document, sees the banner,
      gets 403 `doc.edit` on save, adds themself as Owner in People, and
      then saves;
    - the admin deletes a non-member workspace from Management behind the
      exact-name gate and every blob under its prefix is gone;
    - under `restricted`, a regular user's start-page New Workspace
      action is disabled with the restricted hint, the File-menu item is
      disabled, and `POST /api/workspaces` answers 403
      `deployment.create`; an allow-listed user creates normally; under
      `members`, `mary` is refused with the guest hint and `ada` is not;
    - under `members` listing, a non-member's `GET /api/workspaces` omits
      the workspace and the Open Workspace dialog does not show it, while
      the admin's ordinary listing is filtered the same way;
    - settings saved from the Settings tab are returned by
      `GET /api/admin/settings` after a reload, and a hand-corrupted
      settings blob produces the fail-closed behaviour and the visible
      parse error;
    - the People tab lists all five seeded users with the Guest badge on
      `mary` and the Admin badge on `katherine`;
    - `/api/files` refuses the `deployment/` prefix.
28. `E2E_TEST_FLOOR` in `scripts/validate.mjs` is re-pinned to the new
    count with this PRD as the rationale; `npm run typecheck`,
    `npm run test:unit` and `npm run validate:quick` pass
    (`QUICK VALIDATION: ALL PASSED`); `docs/MAP.md` is regenerated with
    `npm run map` and committed if it changed. A deployment running the
    PRD 016 build upgrades to this build with no operator action and
    behaves identically until `MM_ADMINS` is set.

## Open questions

- None — decisions above were settled in the issue #181 interview
  (2026-08-30): admins come from `MM_ADMINS` only, never managed in-app;
  admin god mode is read + administer, never implicit write, with
  membership as the visible trail and no audit log; creation policy is
  `everyone` / `members` / `restricted` + allow list, managed in
  Management and stored in `deployment/settings.json`; listing policy is
  two values and filters admins' ordinary listing too; disallowed creators
  see New Workspace disabled with a hint, not hidden; corrupt settings
  fail closed; statistics are on-demand aggregates of one blob listing;
  Management is a near-full-window dialog (not a route) with Workspaces /
  People (read-only) / Settings tabs; the local lane seeds `katherine` as
  admin and `mary` as a guest.
