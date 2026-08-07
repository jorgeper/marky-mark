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
| `ENTRA_TENANT_ID` | azure (required) | Entra ID tenant (single-tenant app registration). |
| `ENTRA_CLIENT_ID` | azure (required) | Entra ID application (client) id — also the expected token audience. |
| `MM_GITHUB_APP_ID` | both (optional) | Numeric id of the deployment's GitHub App (PRD 010 Req 4). Required only alongside `MM_GITHUB_PRIVATE_KEY`; nothing uses it yet. |
| `MM_GITHUB_PRIVATE_KEY` | both (optional) | That App's PEM private key (PKCS#1 or PKCS#8), literal or `\n`-escaped newlines — the App Service app-setting shape. The **only** GitHub credential the server accepts: no PAT, no long-lived repo token. |
| `MM_GITHUB_API_BASE` | both (optional) | GitHub REST root, for GitHub Enterprise. Defaults to the public API (`GITHUB_API_BASE` in `providers/github/auth.ts`, the one place a GitHub host is named). |

`MM_MODE=azure` refuses to start with any of its required variables missing,
naming them all at once.

## Workspace storage model (PRD 007 Req 7)

Everything about a workspace lives in blobs inside the one container
(`MM_STORAGE_CONTAINER`) — no database, no server-local state. Each
workspace owns a prefix keyed by a server-generated UUID:

```
workspaces/<id>/manifest.json     the workspace manifest (below)
workspaces/<id>/files/<path>      its Markdown documents and assets
```

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
| `POST /api/workspaces` | — (signed-in, pre-permission by design: PRD 007 Req 10 — any user may create; the creator is always retained as Owner) | `{name, members?: [{id, role}], everyone?: {enabled, role?}}` → `201 {id, manifest}`. A name-only body is the original behaviour. Role names are validated against the built-ins and the manifest's own custom roles (400 for an unknown one); everyone-access defaults to `Viewer` (Req 16). |
| `GET /api/workspaces` | — (signed-in, pre-permission by design: PRD 007 Req 11 — metadata is listable by any signed-in user; contents stay permission-checked) | `[{id, name, created, modified, owners, access}]`. `owners` are the Owner-role member ids (whoever can grant membership, when no Owner role is used) and `access` is whether the caller resolves `doc.read` — enough for an Open dialog to tell "open it" from "ask for access" without attempting a forbidden read. Never file contents or workspace-scoped settings. |
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
| `PUT /api/workspaces/<id>/files/<path>` | `file.create` when the blob does not exist yet, `doc.edit` when it does (a comment sidecar: `comment.write`) | Write body as content → `{path, etag}`. With `?raw=1` the body is stored as raw bytes. A PUT of a path that holds nothing is a **create** and a PUT over one that does is a **save**: a custom role may grant either verb without the other (Req 15), so they cannot share one. PRD 007 Req 20: an `If-Match` header makes the write conditional on the ETag the client read — a stale one answers **412** with the stored content untouched, so another member's save is never silently lost. No `If-Match` is a deliberate unconditional write (a first save, or the user's Overwrite answer to the conflict prompt). |
| `DELETE /api/workspaces/<id>/files/<path>` | `file.delete` (a comment sidecar: `comment.write`) | Delete; 404 when absent. |
| `POST /api/workspaces/<id>/move-file` | `file.rename` | `{from, to}` → move or rename ONE file (PRD 007 Req 18). 409 when the destination is occupied (the target is never silently destroyed), 404 for an unknown source. |
| `POST /api/workspaces/<id>/move-folder` | `folder.manage` | `{from, to}` → move or rename a folder, re-keying every blob under its prefix (contents follow). 409 when the destination prefix already holds anything, 404 when the source is empty, 400 for a folder into its own descendant. |
| `POST /api/workspaces/<id>/folders` | `folder.manage` | `{path}` → create an EMPTY folder as a `.mmkeep` marker blob under its prefix (blob storage has no directories), so a new folder survives a reload. Idempotent. |
| `DELETE /api/workspaces/<id>/folders/<path>` | `folder.manage` | Delete a folder and everything under it. PERMANENT — there is no trash and no version history (PRD 007 non-goals). 404 when empty/absent. |
| `PUT /api/workspaces/<id>/upload/<path>` | `file.upload` | Single-file upload of raw bytes (PRD 007 Req 19). The shared rule in `src/lib/fileTransfer.ts` is applied here independently of the client: 415 for a type outside the Markdown + rendered-asset allowlist, 413 past the 20 MB cap, 409 when the path is taken (an upload never silently overwrites). → `201 {path, etag, size}`. |
| `GET /api/workspaces/<id>/download/<path>` | `file.download` | Single-file download: the blob's bytes with a `Content-Disposition` naming its basename. Bulk transfer is out of scope. 404 when absent. |
| `GET /api/me/files` | — (signed-in; scoped to the token's user) | List the caller's own blobs, user-relative paths (PRD 007 Req 9: the roaming User settings layer). |
| `GET /api/me/files/<path>` | — (signed-in; scoped to the token's user) | Read: `{path, content, etag}`, or 404. |
| `PUT /api/me/files/<path>` | — (signed-in; scoped to the token's user) | Write body as content → `{path, etag}`. |
| `DELETE /api/me/files/<path>` | — (signed-in; scoped to the token's user) | Delete; 404 when absent. |
| `GET /api/files` (`?prefix=`) | — (signed-in; legacy workspace-agnostic scaffold — never lists `workspaces/` or `users/`) | List stored files (path, size, lastModified, etag). |
| `GET /api/files/<path>` | — (signed-in; legacy scaffold — 403 on any `workspaces/` or `users/` path) | Read: `{path, content, etag}`, or 404. |
| `PUT /api/files/<path>` | — (signed-in; legacy scaffold — 403 on any `workspaces/` or `users/` path) | Write body as content → `{path, etag}`. |
| `DELETE /api/files/<path>` | — (signed-in; legacy scaffold — 403 on any `workspaces/` or `users/` path) | Delete; 404 when absent. |
| `GET /api/directory/search?q=` | — (signed-in) | Directory user search. Results carry a same-origin `avatarUrl` when the user has a photo. |
| `GET /api/directory/users/<id>` | — (signed-in) | One directory user, or 404. |
| `GET /api/directory/users/<id>/photo` | — (signed-in) | Profile photo bytes (avatar). 404 when the user has no photo or is unknown. |

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
bearer is the **id_token** — with the scaffold's `openid profile email`
scopes it is the token whose issuer and audience match what
`providers/azure/entra.ts` pins (tenant issuer + client-id audience).

## Tests

- Unit (`npm run test:unit`): config parsing, provider selection, mock
  auth/directory, Entra URL/token-shape logic, Graph request mapping
  (injected fetch) — `tests/unit/server-*.test.ts`.
- GitHub (PRD 010 Req 4): `providers/github/auth.ts` mints App JWTs and
  cached installation tokens against an injected `fetch`;
  `providers/github/fake.ts` is the local fake of the GitHub REST API
  (installations, contents, refs, commits) every GitHub test runs against —
  injectable as a `fetch`, or mountable on a `node:http` listener. No test
  reaches github.
- GitHub storage (PRD 010 Req 2+7–11): `providers/github/storage.ts` is a
  `StorageProvider` over a repo branch — one commit per mutation, authored by
  the signed-in user and committed by the app, blob shas as ETags. It is
  **not selectable by configuration yet** (`MM_MODE` still wires `local` and
  `azure` only); the backend knob is #101. `tests/unit/storage-contract.ts`
  is the shared seam contract both it and the in-memory reference provider
  pass.
- E2E (`npm run test:e2e`): `tests/e2e/hosted.spec.ts` boots this server in
  local mode via Playwright's `webServer` (E159+) — real HTTP against
  Azurite, zero Azure resources or network beyond localhost.
