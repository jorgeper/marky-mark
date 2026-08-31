# Marky Mark hosted backend (`server/`)

The Node backend for the hosted flavor (PRD 007). One origin serves both the
REST API (under `/api/`) and the built SPA (everything else, `index.html`
fallback). Vendor services sit behind three provider seams —
`providers/types.ts`: auth, storage, user directory — with Azure
implementations (Entra ID, Blob Storage, Microsoft Graph) under
`providers/azure/` and offline dev implementations under `providers/mock/`.
No Azure SDK is imported outside `providers/azure/`.

## Modes (PRD 007 Req 3+4)

`MM_MODE` selects the provider wiring:

| Mode | Auth | Storage | Directory |
| --- | --- | --- | --- |
| `local` (default) | Mock, seeded users (`providers/mock/users.ts`) | Azure Blob Storage code against **Azurite** at the well-known dev endpoint (`127.0.0.1:10000`, `devstoreaccount1`) | Mock, same seeded users |
| `azure` | Microsoft Entra ID (single tenant, JWKS token validation) | Azure Blob Storage | Microsoft Graph |

## Local development

```sh
npm run server:local
```

One command, no prerequisites: it builds the SPA if `dist/` is missing, boots
Azurite from `node_modules` (reusing one that is already listening), and
starts the server at <http://localhost:4924>. Sign in via
`POST /api/auth/sign-in` with `{"username": "ada"}` (see the seeded users in
`providers/mock/users.ts`). Everything runs offline — no Azure resources.

The auto-started Azurite persists its store in `node_modules/.cache/azurite`,
so your files, drafts and workspaces survive restarts; delete that directory
(with the server stopped) to wipe all local hosted state. The Playwright e2e
lane keeps its store separate: `playwright.config.ts` launches this same
script with `MM_AZURITE_IN_MEMORY=1`, which runs Azurite with
`--inMemoryPersistence` so every gate run starts from an empty, RAM-only
store (issue #179 — a killed test's crash-safe draft must not poison the
next run). One caveat: a server or Azurite already listening is reused as-is
(Playwright's `reuseExistingServer`, this script's port probe), so stop a
hand-run stack before the gate if the lanes must be truly disjoint.

## Production (Azure App Service, Linux)

The server starts under plain `node` on current Node LTS (≥ 22.18, which
strips TypeScript types natively — no build step):

```sh
MM_MODE=azure node server/index.ts
```

Point App Service's startup command at exactly that. The full operator
walkthrough — app registration, storage account, deployment, custom domain
— is [docs/HOSTING-AZURE.md](../docs/HOSTING-AZURE.md) (PRD 007 Req 23);
the environment reference is below.

## Environment variables

| Variable | Modes | Meaning |
| --- | --- | --- |
| `MM_MODE` | both | `local` (default) or `azure` — provider wiring. |
| `PORT` | both | Listen port. Default `4924`; App Service injects its own. |
| `MM_STATIC_DIR` | both | Directory of the built SPA. Default `dist`. |
| `MM_STORAGE_CONTAINER` | both | Blob container for files. Default `marky-mark`. |
| `AZURE_STORAGE_CONNECTION_STRING` | azure (required); local (optional) | Storage connection string. Local default: Azurite's well-known dev connection string. |
| `MM_AZURITE_IN_MEMORY` | local (dev script only) | `1` makes `npm run server:local` start its Azurite with `--inMemoryPersistence` — a fresh, RAM-only store per boot. Set by the e2e lane; hand-run servers persist by default. |
| `ENTRA_TENANT_ID` | azure (required) | Entra ID tenant (single-tenant app registration). |
| `ENTRA_CLIENT_ID` | azure (required) | Entra ID application (client) id — also the expected token audience. |
| `ENTRA_CLIENT_SECRET` | azure (required) | Client secret of the same registration — authenticates the on-behalf-of Graph token exchange (`providers/azure/obo.ts`). Secret: never logged, never sent to the browser. |
| `MM_ADMINS` | both (optional) | PRD 017 Req 1: comma-separated user ids of the deployment admins (Entra object ids in azure mode, mock ids in local mode). Entries are trimmed, empty entries dropped; an entry with interior whitespace refuses to start. Unset: no admins in azure mode; local mode defaults to `mock-katherine` (set it — even to empty — to override). Startup logs the admin *count*, never the ids. |

`MM_MODE=azure` refuses to start with any of its required variables missing,
naming them all at once.

## Workspace storage model (PRD 007 Req 7)

Everything about a workspace lives in blobs inside the one container
(`MM_STORAGE_CONTAINER`) — no database, no server-local state. Each
workspace owns a prefix keyed by a server-generated UUID:

```
workspaces/<id>/manifest.json     the workspace manifest (below)
workspaces/<id>/summary-cache/    cached LLM summaries (PRD 011 Req 29)
workspaces/<id>/files/<path>      its Markdown documents and assets
deployment/settings.json          the deployment settings record (PRD 017 Req 6)
```

`summary-cache/` holds one blob per content-hash key (`server/summaryCache.ts`).
It lives **outside** `files/`, so it is never listed as a workspace file.

`deployment/settings.json` is the only blob under the reserved `deployment/`
prefix: a versioned record (`src/lib/deploymentSettings.ts`) holding the
creation policy (`everyone` / `members` / `restricted` plus an allow list) and
the listing policy (`everyone` / `members`), read per request by the create and
list routes. An absent blob yields the defaults (`everyone` / `everyone` —
pre-PRD-017 behaviour); a blob that exists but fails to parse **fails closed**
(`restricted` creation, `members` listing) until an admin saves over it
(PRD 017 Req 7). Like `workspaces/` and `users/`, the prefix is refused by the
legacy `/api/files*` scaffold (403, filtered from listings).

When a conditional save arrives against a version the file has moved on from,
and the save carried the text the client loaded (the `{content, base}` body
below, PRD 016 Req 7+8), the server three-way merges it and saves when the
merge is clean — answering 200 with the merged text — and 412s when it
conflicts. The client is the source of the merge base, so no storage feature
and no extra variable is involved; a save without a base answers the plain
412.

The manifest sits *outside* the `files/` prefix, so workspace file listings
never surface it; the workspace-agnostic `/api/files*` scaffold refuses the
whole `workspaces/` prefix (403, filtered from listings), so workspace data
is reachable only through the permission-checked endpoints below.

### The workspace manifest

A versioned JSON evolution of the local `.marky-workspace` format
(`src/lib/workspace.ts`): it keeps that format's `version` and `settings`
slots, drops `folders` (the workspace *is* its blob prefix), and adds the
hosted fields. Parse/serialize/validate are pure functions in
`src/lib/hostedWorkspace.ts`; an unsupported `version` or malformed field
is rejected with a named error, never silently coerced.

```jsonc
{
  "version": 1,                       // schema version; this build reads exactly 1
  "name": "Design docs",
  "created": "2026-08-05T12:00:00Z",  // ISO 8601; immutable after creation
  "modified": "2026-08-05T12:00:00Z", // restamped server-side on manifest updates
  "members": [{ "id": "<user id>", "role": "Owner" }],
  "roles": [                          // custom roles: named catalog subsets
    { "name": "Reviewer", "permissions": ["doc.read", "comment.read", "comment.write"] }
  ],
  "everyone": { "enabled": false, "role": "Viewer" },  // everyone-in-tenant access
  "settings": {}                      // the PRD 002 Workspace settings layer
}
```

## Roles and permissions (PRD 007 Req 13+14)

`src/lib/hostedWorkspace.ts` defines the fixed fourteen-verb permission
catalog (`doc.read`, `doc.edit`, `file.create`, `file.delete`,
`file.rename`, `file.upload`, `file.download`, `folder.manage`,
`comment.read`, `comment.write`, `workspace.settings`,
`workspace.members`, `workspace.roles`, `workspace.delete`) and the five
built-in roles — Owner (all), Editor, Contributor, Commenter, Viewer.
Built-ins live in code, never in a manifest: they cannot be edited or
deleted, and a custom role may not reuse a built-in name (validation
rejects it). A member whose role name resolves to nothing fails closed —
no permissions.

Two deployment-level permission names exist beside the catalog (PRD 017
Req 2): `deployment.admin` and `deployment.create`. They are not members
of `PERMISSIONS`, so no built-in or custom role can grant them and the
role editor never offers them; a refusal naming one uses the same 403
shape as the workspace verbs, `{ "error": "forbidden", "required":
"<name>" }`. In every workspace, a deployment admin (`MM_ADMINS`)
implicitly holds `doc.read`, `file.download`, `comment.read`,
`workspace.settings`, `workspace.members`, `workspace.roles` and
`workspace.delete` — a union with whatever the manifest grants them,
never an override, resolved in the same `resolvePermissions` path every
route already uses (PRD 017 Req 4). No other verb is ever implicit:
admins without membership cannot edit, create, upload, rename or delete
files, manage folders, or write comments.

## API surface

All endpoints except sign-in require `Authorization: Bearer <token>` and
answer `401` without it. Workspace-scoped endpoints then check exactly
**one** required permission, resolved from the workspace manifest for the
calling user, and answer `403` (naming the verb) when it is missing. The
table below is the same mapping `WORKSPACE_ROUTE_PERMISSIONS` declares in
`server/workspaces.ts`, which the unit tests enumerate against the live
routes — every one of the fourteen catalog verbs is required by some
operation here, so none can be added and left dead.

A **comment sidecar** — the term three `files/<path>` rows below use — is a
`<doc>.comments.json` blob (`isSidecarPath` in `src/lib/sidecar.ts`: one
definition, shared by the server and the client that writes them). Those
requests require the comment verbs instead of the doc/file ones, which is
what lets a Commenter — who holds no `doc.edit` — actually write a comment
on a document they may not change. Pasted images and every other blob stay
on the doc/file verbs.

| Endpoint | Required permission | Meaning |
| --- | --- | --- |
| `POST /api/auth/sign-in` | — (unauthenticated) | Local: `{username}` → `{kind:'token', token, user}`. Azure: `{kind:'redirect', authorizeUrl}` for the SPA's PKCE flow. The only unauthenticated endpoint. |
| `GET /api/me` | — (signed-in) | The authenticated user. |
| `POST /api/workspaces` | — (signed-in, gated by the deployment creation policy: PRD 017 Req 8 — under the default `everyone` any user may create as PRD 007 Req 10 always allowed; `members` excludes guests; `restricted` allows only admins and the allow list; a refused caller gets 403 `deployment.create`. The creator is always retained as Owner) | `{name, members?: [{id, role}], everyone?: {enabled, role?}}` → `201 {id, manifest}`. A name-only body is the original behaviour. Role names are validated against the built-ins and the manifest's own custom roles (400 for an unknown one); everyone-access defaults to `Viewer` (Req 16). |
| `GET /api/workspaces` | — (signed-in, gated by the deployment listing policy: PRD 017 Req 11 — under the default `everyone` metadata is listable by any signed-in user as PRD 007 Req 11 always allowed; under `members` rows the caller cannot open are omitted, for admins like anyone else) | `[{id, name, created, modified, owners, access}]`. `owners` are the Owner-role member ids (whoever can grant membership, when no Owner role is used) and `access` is whether the caller resolves `doc.read` — enough for an Open dialog to tell "open it" from "ask for access" without attempting a forbidden read. Never file contents or workspace-scoped settings. |
| `DELETE /api/workspaces/<id>` | `workspace.delete` | Delete the workspace: every blob under `workspaces/<id>/` — manifest, `files/`, comment sidecars and pasted images alike (PRD 007 Req 12). 404 for an unknown id. |
| `GET /api/workspaces/<id>/manifest` | `doc.read` | `{id, manifest}`. |
| `PUT /api/workspaces/<id>/manifest` | `workspace.settings` | Validate + store the full manifest (`created` preserved, `modified` restamped server-side). The finer-grained member and role endpoints below are what settings UI uses. |
| `POST /api/workspaces/<id>/members` | `workspace.members` | `{id, role}` → add one member (PRD 007 Req 16). 400 for an unknown role name or an id already on the list. |
| `PUT /api/workspaces/<id>/members/<userId>` | `workspace.members` | `{role}` → change that member's role. 400 for an unknown role, a non-member, or demoting the last `Owner`. |
| `DELETE /api/workspaces/<id>/members/<userId>` | `workspace.members` | Remove that member. 400 for a non-member or for the last `Owner` — a workspace always keeps one. |
| `PUT /api/workspaces/<id>/everyone` | `workspace.members` | `{enabled, role?}` → everyone-in-tenant access and the role it grants (omitting `role` keeps the stored one; a fresh manifest starts at `Viewer`). Explicit membership still overrides it. 400 for an unknown role. |
| `POST /api/workspaces/<id>/roles` | `workspace.roles` | `{name, permissions[]}` → create a custom role as a catalog subset (PRD 007 Req 15). 400 for a blank or `/`-bearing name, a built-in name, a duplicate, or an unknown verb. |
| `PUT /api/workspaces/<id>/roles/<name>` | `workspace.roles` | `{name, permissions[]}` → rename and/or re-scope that custom role; members holding it and a matching everyone-grant carry over in the same update. 400 for a built-in target or name, a duplicate name, an unknown role, or an unknown verb. |
| `DELETE /api/workspaces/<id>/roles/<name>` | `workspace.roles` | Delete that custom role. 400 for a built-in, an unknown role, or one still held by a member or by live everyone-access. |
| `GET /api/workspaces/<id>/files` | `doc.read` | List the workspace's files, workspace-relative paths. |
| `GET /api/workspaces/<id>/files/<path>` | `doc.read` (a comment sidecar: `comment.read`) | Read: `{path, content, etag}`, or 404. With `?raw=1` the blob's bytes, typed from its extension (PRD 007 Req 8: pasted images). A GET may also authenticate with `?access_token=` — an `<img>` cannot send a header; writes never can. |
| `PUT /api/workspaces/<id>/files/<path>` | `file.create` when the blob does not exist yet, `doc.edit` when it does (a comment sidecar: `comment.write`) | Write body as content → `{path, etag}`. With `?raw=1` the body is stored as raw bytes. A PUT of a path that holds nothing is a **create** and a PUT over one that does is a **save**: a custom role may grant either verb without the other (Req 15), so they cannot share one. PRD 007 Req 20: an `If-Match` header makes the write conditional on the ETag the client read — a stale one answers **412** with the stored content untouched, so another member's save is never silently lost. No `If-Match` is a deliberate unconditional write (a first save, or the user's Overwrite answer to the conflict prompt). PRD 016 Req 7: a `Content-Type: application/json` body `{content, base?}` is the same save carrying the text the client loaded — on a stale `If-Match` the server three-way merges base/content/stored and commits conditionally (Req 8), answering `{path, etag, merged: true, content}`; a conflict, a guard refusal, or exhausted retries answer the same 412, stored content untouched. |
| `DELETE /api/workspaces/<id>/files/<path>` | `file.delete` (a comment sidecar: `comment.write`) | Delete; 404 when absent. |
| `POST /api/workspaces/<id>/move-file` | `file.rename` | `{from, to}` → move or rename ONE file (PRD 007 Req 18). 409 when the destination is occupied (the target is never silently destroyed), 404 for an unknown source. |
| `POST /api/workspaces/<id>/move-folder` | `folder.manage` | `{from, to}` → move or rename a folder, re-keying every blob under its prefix (contents follow). 409 when the destination prefix already holds anything, 404 when the source is empty, 400 for a folder into its own descendant. |
| `POST /api/workspaces/<id>/folders` | `folder.manage` | `{path}` → create an EMPTY folder as a `.mmkeep` marker blob under its prefix (blob storage has no directories), so a new folder survives a reload. Idempotent. |
| `DELETE /api/workspaces/<id>/folders/<path>` | `folder.manage` | Delete a folder and everything under it. There is no trash, no undelete and no version browsing (PRD 007 non-goals): the bytes are gone. 404 when empty/absent. |
| `PUT /api/workspaces/<id>/upload/<path>` | `file.upload` | Single-file upload of raw bytes (PRD 007 Req 19). The shared rule in `src/lib/fileTransfer.ts` is applied here independently of the client: 415 for a type outside the Markdown + rendered-asset allowlist, 413 past the 20 MB cap, 409 when the path is taken (an upload never silently overwrites). → `201 {path, etag, size}`. |
| `GET /api/workspaces/<id>/download/<path>` | `file.download` | Single-file download: the blob's bytes with a `Content-Disposition` naming its basename. Bulk transfer is out of scope. 404 when absent. |
| `GET /api/workspaces/<id>/summary-cache/entry?key=` | `doc.read` | PRD 011 Req 28: read one cached summary by #110's content-hash key → `{entry}`. A key nothing wrote — or a blob that no longer parses as an entry — is `{entry: null}` at **200**, never a 404 or a 500: a miss is an ordinary answer. |
| `PUT /api/workspaces/<id>/summary-cache/entry` | `doc.read` | PRD 011 Req 29: store `{key, summary, providerId, modelId, promptVersion, usage?}` → `{key}`. The server stamps `at`. Storing a summary the caller just generated is not a change to any document, so it stays on the read verb. |
| `GET /api/workspaces/<id>/summary-cache` | `doc.read` | PRD 011 Req 30: roughly what this workspace's cache holds → `{bytes, entries}`, from the blob listing with no read. |
| `DELETE /api/workspaces/<id>/summary-cache` | `workspace.settings` | PRD 011 Req 30: Clear → `{cleared}`. It discards summaries every member shares, so it takes the workspace-wide authority rather than the reader's. |
| `GET /api/me/files` | — (signed-in; scoped to the token's user) | List the caller's own blobs, user-relative paths (PRD 007 Req 9: the roaming User settings layer). |
| `GET /api/me/files/<path>` | — (signed-in; scoped to the token's user) | Read: `{path, content, etag}`, or 404. |
| `PUT /api/me/files/<path>` | — (signed-in; scoped to the token's user) | Write body as content → `{path, etag}`. |
| `DELETE /api/me/files/<path>` | — (signed-in; scoped to the token's user) | Delete; 404 when absent. |
| `GET /api/files` (`?prefix=`) | — (signed-in; legacy workspace-agnostic scaffold — never lists `workspaces/`, `users/` or `deployment/`) | List stored files (path, size, lastModified, etag). |
| `GET /api/files/<path>` | — (signed-in; legacy scaffold — 403 on any `workspaces/`, `users/` or `deployment/` path) | Read: `{path, content, etag}`, or 404. |
| `PUT /api/files/<path>` | — (signed-in; legacy scaffold — 403 on any `workspaces/`, `users/` or `deployment/` path) | Write body as content → `{path, etag}`. |
| `DELETE /api/files/<path>` | — (signed-in; legacy scaffold — 403 on any `workspaces/`, `users/` or `deployment/` path) | Delete; 404 when absent. |
| `GET /api/directory/search?q=` | — (signed-in) | Directory user search. Results carry a same-origin `avatarUrl` when the user has a photo. |
| `GET /api/directory/users/<id>` | — (signed-in) | One directory user, or 404. |
| `GET /api/directory/users/<id>/photo` | — (signed-in) | Profile photo bytes (avatar). 404 when the user has no photo or is unknown. |
| `GET /api/admin/workspaces` | `deployment.admin` | PRD 017 Req 16: every workspace in the deployment — member or not — with owners, member count, everyone-access, file count, total bytes and timestamps, aggregated from one `workspaces/` blob listing. A workspace with a corrupt manifest still appears, flagged, with its blob figures. |
| `GET /api/admin/users` | `deployment.admin` | PRD 017 Req 19: every tenant user via the directory provider's `listUsers` (Graph pages `/users` with the OBO token; the mock returns the seeded list). A directory failure is an error answer, never an empty list. |
| `GET /api/admin/settings` | `deployment.admin` | PRD 017 Req 15: the parsed deployment settings plus, when the blob fails to parse (Req 7), the parse error so Management can show it. |
| `PUT /api/admin/settings` | `deployment.admin` | PRD 017 Req 14: replace the settings record after validating with the shared parser (400 on an invalid body). Last write wins; takes effect on the next request — no restart. |
| `POST /api/admin/invitations` | `deployment.admin` | PRD 017 Req 29+30 (issue #190): invite a guest through Graph `POST /v1.0/invitations` **as the signed-in admin** (OBO exchange, delegated `User.Invite.All`), redirecting redemption to this deployment's origin. Body `{email, note?, workspace?: {id, role}, sendEmail?}`, validated by the shared parser in `src/lib/invitations.ts` (400 for a malformed email, an unknown role, a note over 500 characters, or a non-boolean `sendEmail`). Issue #195: `sendEmail: false` creates the invitation without Microsoft's mail (Graph `sendInvitationMessage: false`). Success: `201 {id, email, displayName, pending: true, redeemUrl}` — `redeemUrl` is Graph's creation-time `inviteRedeemUrl`, which works without any email and never appears in a log line. With `workspace`, the guest is added to that manifest at the role in the same request (the #180 display-name snapshot is the email); a grant that fails after the invitation landed keeps the 201 and carries `membership: {error}`. A Graph refusal maps to **502** with Graph's `error.code` and message — never a silent success, and never a token in a response or log line. |
| `DELETE /api/admin/invitations/<userId>` | `deployment.admin` | Issue #193: rescind an invitation. The directory is asked first: unless the target is a guest with `externalUserState = PendingAcceptance`, the route refuses with **409** and a sentence naming why (members, accepted guests and admins are never deletable from the app). Otherwise Graph `DELETE /v1.0/users/{id}` runs **as the signed-in admin** (OBO exchange, delegated `User.ReadWrite.All`), and in the same operation any membership recorded for the id is scrubbed from every workspace manifest. Success: `200 {id}` (plus `membership: {error}` if a manifest write failed after the deletion). A Graph refusal maps to **502** with Graph's `error.code` and message — never a token in a response or log line. |
| `POST /api/admin/invitations/<userId>/link` | `deployment.admin` | Issue #195: a fresh redeem URL for a **pending** guest — Management's per-row **Copy invite link**. The directory is asked first: unless the target is a guest with `externalUserState = PendingAcceptance`, the route refuses with **409** and a sentence naming why (the #193 eligibility decision). Otherwise the invitation is re-POSTed to Graph for the guest's own mail address with `sendInvitationMessage: false` — Graph only yields `inviteRedeemUrl` at creation, and a re-POST answers a fresh valid one without disturbing the pending user. Success: `200 {id, email, redeemUrl}`; the redeem URL never appears in a log line. A Graph refusal maps to **502** with Graph's `error.code` and message. |
| `POST /api/directory/invitations/<id>/accept` | — (signed-in; local mock directory only — 404 on Azure) | Test hook: mark an invited guest accepted, clearing the Pending badge, so the flow is e2e-testable offline. |
| `DELETE /api/directory/invitations/<id>` | — (signed-in; local mock directory only — 404 on Azure) | Test hook: withdraw an in-memory invitation, restoring the seeded directory. |
| `GET /api/directory/invitations/<id>` | — (signed-in; local mock directory only — 404 on Azure) | Test hook (issue #195): whether the last invite for the id sent Microsoft's mail — `{id, sendEmail}` — so the offline lane proves the link flows suppressed it. Never the redeem URL. |

## Sign-in (PRD 007 Req 5)

The server injects `<meta name="marky-mark-hosted" content="<mode>">` into
every HTML document it serves (`server/app.ts` `injectHostedMarker`).
That marker — never present in `dist/` on disk, in the Tauri shell, in the
dev shim, or on a static host — is how the unmodified SPA build knows to
gate behind the sign-in page (`src/components/HostedSignIn.tsx`). No
pre-auth probe endpoint exists; the marker's content also tells the SPA
which sign-in UI to show (`local`: seeded-username form, `azure`: a
sign-in-with-Microsoft redirect).

In azure mode the SPA drives the auth-code + PKCE flow
(`src/lib/hostedAuth.ts`): S256 challenge, state-checked callback, then a
public-client code exchange at the tenant's token endpoint. The session
bearer is the **access token for the app's own API** (issue #184 — the
`api://<client id>/access_as_user` scope, requested because the OBO
exchange refuses an id_token as its assertion): issuer, audience and scp
match what `providers/azure/entra.ts` pins (tenant v2.0 issuer, client-id
audience, `access_as_user` in scp).

## Tests

- Unit (`npm run test:unit`): config parsing, provider selection, mock
  auth/directory, Entra URL/token-shape logic, Graph request mapping
  (injected fetch) — `tests/unit/server-*.test.ts`.
  `tests/unit/storage-contract.ts` is the shared seam contract the in-memory
  reference provider passes.
- E2E (`npm run test:e2e`): `tests/e2e/hosted.spec.ts` boots this server in
  local mode via Playwright's `webServer` (E159+) — real HTTP against
  Azurite, zero Azure resources or network beyond localhost.
