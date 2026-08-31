# PRD 007: Azure-hosted workspaces — the hosted flavor of Marky Mark

**Status:** Draft
**Date:** 2026-08-03

## Problem

Marky Mark ships three client-side flavors (macOS, Windows, single-file web
build); every one of them reads and writes files the user already has. There is
no way for a team to share a living set of Markdown documents: no common store,
no access control, no way to hand a reviewer a URL and a role. PRD 002 built
the layered configuration system and `.marky-workspace` format *anticipating* a
cloud/team model (its Team layer is a reserved slot) but explicitly deferred
the server, auth, and storage.

This PRD adds the fourth flavor: a hosted web app (e.g.
`markymark.jorgepereira.io`) where signed-in users create and open
**workspaces** whose files live in cloud storage, with per-user roles built on
a permission catalog. It targets Azure — App Service hosting, Blob Storage,
single-tenant Microsoft Entra ID sign-in, Microsoft Graph user search — behind
provider seams so a different stack (e.g. Supabase + Google auth) is possible
later without a rewrite.

## Goals

- A signed-in tenant user can create a workspace, name it, grant people roles,
  add/edit/organize Markdown files in it, and everything persists server-side.
- A second user with access opens the same workspace by name from any browser
  and sees the same files, comments, and workspace settings.
- Access control is real: the server enforces a permission catalog on every
  operation; roles (built-in and custom) are named permission sets.
- The hosted flavor reuses the existing app through the `Platform` seam — the
  React shell, editor, comments, and settings UI are the same code.
- A README gets a competent operator from zero to a running Azure deployment.
- The whole flavor is developable and e2e-testable locally with zero Azure
  resources (storage emulator + mock auth).

## Non-goals

- **Real-time co-editing.** Concurrent edits are handled by ETag conflict
  detection (reload-or-overwrite), not CRDTs/OT or live cursors. PRD 016
  later added merge-on-save for non-colliding concurrent edits; true
  conflicts still get the reload-or-overwrite dialog.
- **Multi-file upload/download.** v1 is single-file both ways; bulk transfer is
  a follow-up.
- **Shipping non-Azure providers.** Supabase/Google-auth alternatives are an
  architectural constraint (provider seams), not deliverables; no non-Azure
  implementation ships or is tested beyond the local dev/mock providers.
- **Multi-tenant or personal Microsoft accounts.** The app registration is
  single-tenant; outlook.com/live.com accounts are out.
- **Anonymous access.** Every hosted-flavor request requires sign-in; there are
  no public/unauthenticated workspaces.
- **Offline support / sync.** The hosted flavor requires connectivity; there is
  no local cache reconciliation.
- **Workspace trash / version history.** Deletes (files and workspaces) are
  permanent; recovery relies on Azure-level soft delete an operator may enable.
- **Quotas and billing.** No per-user storage limits beyond the max upload
  size; cost controls are the operator's problem.
- **Migrating local `.marky-workspace` files into the cloud.** No importer in
  v1.

## Requirements

### Architecture and flavors

1. A new backend lives in `server/`: a Node app that serves both the built SPA
   and a REST API from one origin, runnable locally via a single npm script and
   deployable unchanged to Azure App Service (Linux, current Node LTS).
2. The hosted front end is the existing app with a new `Platform`
   implementation (`kind: 'hosted'`) in `src/platform/` that satisfies the
   seam in `src/platform/types.ts` against the REST API. App code outside
   `src/platform/` must not branch on the hosted flavor except via the
   existing platform capability checks.
3. The backend isolates vendor services behind three provider interfaces —
   auth (token validation/sign-in), storage (files + metadata), and user
   directory (search, display names, avatars) — with Azure implementations
   (Entra ID, Blob Storage, Microsoft Graph). No Azure SDK import exists
   outside the Azure provider modules.
4. A local development mode wires the storage provider to Azurite and the auth
   + directory providers to a mock with seeded test users; `npm run
   test:e2e` covers the hosted flavor against this mode with no Azure
   resources or network access.

### Authentication and users

5. Sign-in uses single-tenant Microsoft Entra ID (auth-code flow with PKCE).
   An unauthenticated visitor sees only a sign-in page; every API endpoint
   rejects requests without a valid token for the configured tenant.
6. Membership pickers search the tenant's users via Microsoft Graph as you
   type, resolving display names and avatar photos; a user who can't be
   resolved (left tenant) renders as a plain identifier without breaking the
   member list.

### Storage model

7. Each workspace is a per-workspace prefix in Blob Storage holding its files
   plus a **workspace manifest** — a versioned JSON evolution of
   `.marky-workspace` — recording name, created/modified timestamps, members
   and their roles, custom role definitions, the everyone-access setting, and
   workspace-scoped settings. There is no database.
8. Comment sidecars and pasted images are stored as blobs inside the
   workspace, shared by all members: a comment written by one member is
   visible to others on next load, and pasted images render for every member
   with `doc.read`.
9. The layered configuration from PRD 002 resolves in the hosted flavor with
   the Workspace layer read from the manifest and the User layer stored
   server-side as a per-user blob, so personal settings roam across browsers
   and devices for the same signed-in user.

### Workspace lifecycle

10. **Create:** a New Workspace flow asks for a name and initial members with
    roles (or everyone-access), creates the workspace server-side, and opens
    it with the creator as Owner. PRD 017 later put "who may create" behind a
    deployment creation policy whose default reproduces this behaviour.
11. **Open:** an Open Workspace dialog lists all workspaces in the deployment
    (name + last-modified) with fuzzy search-as-you-type. Choosing one you
    can access opens it; choosing one you can't shows a no-access message
    naming the workspace's Owners. Server-side, list metadata is readable to
    any signed-in user but file contents are never returned without access.
    PRD 017 later put the listing behind a deployment listing policy whose
    default reproduces this behaviour.
12. **Delete:** Workspace settings shows Owners a destructive-styled delete
    action that requires typing the workspace's exact name to confirm, then
    deletes all server-side data and returns to the start page.

### Roles and permissions

13. A fixed permission catalog defines the verbs the server enforces:
    `doc.read`, `doc.edit`, `file.create`, `file.delete`, `file.rename`,
    `file.upload`, `file.download`, `folder.manage`, `comment.read`,
    `comment.write`, `workspace.settings`, `workspace.members`,
    `workspace.roles`, `workspace.delete`. Every REST operation documents and
    checks exactly one required permission.
14. Five built-in roles ship as named permission sets: **Owner** (all),
    **Editor** (all `doc.*`/`file.*`/`folder.*`/`comment.*`), **Contributor**
    (Editor minus `file.delete`, `file.rename`, `folder.manage`),
    **Commenter** (`doc.read`, `file.download`, `comment.read`,
    `comment.write`), **Viewer** (`doc.read`, `file.download`,
    `comment.read`). Built-ins are not editable or deletable.
15. Workspace settings (for holders of `workspace.roles`) includes a custom
    roles editor: create, rename, edit, and delete named roles as subsets of
    the permission catalog, persisted in the manifest; a role in use by a
    member cannot be deleted.
16. Workspace settings (for holders of `workspace.members`) includes user
    management: add members via the Graph search picker, remove members,
    change a member's role, and toggle everyone-in-tenant access with an
    Owner-chosen default role (default Viewer). Explicit membership overrides
    the everyone-role. A workspace always retains at least one Owner.
17. Enforcement is server-side: an API call without the required permission
    returns 403 regardless of what the UI shows, and the UI hides or disables
    affordances the current user's permissions don't allow.

### Files and editing

18. The folder sidebar in a hosted workspace supports the full management set
    — create, rename, and delete files and folders, and move items between
    folders — via both drag-and-drop and a right-click context menu,
    mirroring the existing client folder-view interactions.
19. Single-file upload (File menu, folder context menu, and drag-a-file onto
    the folder sidebar) and single-file download (File menu and file context
    menu) work for members with `file.upload`/`file.download`. Uploads are
    capped at 20 MB and restricted to Markdown and the asset types the app
    renders; oversized or disallowed files are rejected with a clear message.
20. Saves use ETag optimistic concurrency: a save carries the ETag from load,
    and if the file changed on the server the save is rejected and the app
    prompts the user to reload the newer version or overwrite it. No save
    silently loses another member's write.

### Start page and local-file mode

21. The hosted start page offers exactly: drag a file here, Open File, New
    Workspace, Open Workspace — no Open Folder. Dragging or opening a local
    file works fully client-side, like the existing web build: the file is
    never uploaded and no workspace is required.
22. The client (desktop/web) start page gains the same action list where it
    applies — drag a file, Open File, Open Folder, New Workspace, Open
    Workspace (the PRD 002 local kind) — with the equivalent entries in the
    File menu, so the four flavors present one consistent entry surface.

### Operations

23. A hosting guide (`docs/HOSTING-AZURE.md`) walks an operator end-to-end:
    Entra app registration (with exact redirect URIs and Graph permissions),
    storage account creation, App Service deployment, every required
    environment variable, and custom-domain setup. Following only the guide
    on a fresh Azure subscription yields a working deployment.

## Open questions

- None — decisions above were settled in the issue #13 grilling session
  (2026-08-03).
