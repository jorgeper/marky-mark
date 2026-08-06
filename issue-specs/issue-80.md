# Spec: Azure hosting guide: docs/HOSTING-AZURE.md (#80)

## Goal

All acceptance criteria in issue-specs/issue-80.md are satisfied for issue #80,
with evidence visible in the session: `docs/HOSTING-AZURE.md` exists and walks an
operator from a fresh Azure subscription to a working deployment (Entra app
registration with the exact redirect URI and Graph permissions, storage account,
App Service deployment and startup command, the complete environment-variable
table, custom domain), every URI, scope, command and variable it states matches
the code that consumes it — with gaps the code cannot honour recorded as
limitations rather than promised — the guide is discoverable from `README.md`,
`docs/DEVELOPING.md`-adjacent entry points and `server/README.md`,
`npm run validate:quick` passes, and a summary comment from the implementer
exists on issue #80.

## Acceptance criteria

- **The guide exists (PRD 007 Req 23).** `docs/HOSTING-AZURE.md` is a new
  operator-facing document — prose and copy-pasteable commands, not a design
  note — ordered as an end-to-end walkthrough a competent operator can follow
  top to bottom on a fresh Azure subscription with no prior knowledge of this
  repo. It names PRD 007 Req 23 as the contract it satisfies, states its
  prerequisites (an Azure subscription, tenant admin rights for consent, `az`
  CLI or portal, Node ≥ 22.18 locally for the build), and ends with a
  verification section: what the operator should see when sign-in, workspace
  creation and a file save work.

- **Entra app registration section is exact.** It covers creating a
  **single-tenant** app registration and states, verbatim and matching the code:
  - Redirect URI type **SPA** (public client, PKCE — no client secret is issued
    or configured anywhere), with the exact value `https://<your-host>/` —
    the SPA's origin **with the trailing slash**, per `redirectUri()` in
    `src/components/HostedSignIn.tsx:35`; the guide says explicitly that the
    custom-domain host and any `*.azurewebsites.net` host each need their own
    registered redirect URI.
  - The scopes the flow actually requests — `openid profile email`
    (`server/providers/azure/entra.ts` `buildAuthorizeUrl`,
    `src/lib/hostedAuth.ts` `buildTokenRequest`) — and that the session bearer
    is the **id_token**, validated against the tenant issuer
    `https://login.microsoftonline.com/<tenant>/v2.0` with audience = the
    application (client) id.
  - The delegated **Microsoft Graph** permissions the directory provider's calls
    require, with the calls they map to (`GET /users?$search=` +
    `ConsistencyLevel: eventual`, `GET /users/{id}`,
    `GET /users/{id}/photo/$value` in `server/providers/azure/graph.ts`),
    and that they need tenant-admin consent.
  - Where to copy the **Directory (tenant) ID** and **Application (client) ID**
    from, because they become `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID`.

- **Storage section is exact.** Creating the storage account and the blob
  container, the container name matching `MM_STORAGE_CONTAINER` (default
  `marky-mark`, `server/config.ts`), where the connection string comes from
  (Access keys) and that it is the value of `AZURE_STORAGE_CONNECTION_STRING`.
  It states the storage model in one breath — one container, no database, a
  prefix per workspace (`server/README.md` § Workspace storage model) — and
  notes that deletes are permanent (PRD 007 non-goals), so an operator who wants
  recovery enables blob soft delete themselves.

- **Deployment section is runnable.** App Service on **Linux**, current Node LTS
  (≥ 22.18, which strips TypeScript types natively — the server has no build
  step), the startup command exactly `MM_MODE=azure node server/index.ts`, what
  must be present in the deployed payload (the built SPA in `dist/` from
  `npm run build`, `server/`, and production dependencies — `@azure/storage-blob`
  and `jose` are runtime deps), and that App Service injects `PORT` so the
  operator must not pin it. If the guide recommends a specific deployment
  mechanism (zip deploy, `az webapp up`, GitHub Actions), the commands it gives
  are complete and self-consistent — no `<fill this in>` steps beyond the
  operator's own names.

- **Every environment variable is documented, and the table matches
  `server/config.ts`.** `MM_MODE`, `PORT`, `MM_STATIC_DIR`,
  `MM_STORAGE_CONTAINER`, `AZURE_STORAGE_CONNECTION_STRING`, `ENTRA_TENANT_ID`,
  `ENTRA_CLIENT_ID` — each with its default and whether azure mode requires it;
  no variable is invented and none of the seven is omitted. The guide notes that
  `MM_MODE=azure` refuses to start naming every missing required variable at
  once, which is the operator's first diagnostic.

- **Custom domain section.** Adding a custom domain to the App Service, the
  managed TLS certificate, and — called out as the step that silently breaks
  sign-in when skipped — adding the new origin's `https://<domain>/` to the app
  registration's SPA redirect URIs.

- **Honest about what the code does not yet do.** Any behaviour the guide cannot
  truthfully promise on a real tenant is recorded in a short "Known limitations"
  section with a code pointer, not asserted as working. In particular the
  member-picker path: `server/providers/azure/graph.ts` forwards the caller's
  session bearer (the id_token, `openid profile email`) straight to Microsoft
  Graph with no on-behalf-of exchange, so tenant user search and avatars are
  expected to fail against real Graph until that exchange lands — the guide says
  so plainly, and the rest of the deployment (sign-in, workspaces, files,
  comments, permissions) is what "a working deployment" means here. This
  criterion is documentation only: **do not** implement the OBO exchange under
  this issue.

- **A troubleshooting section** covers at least the failure modes the code
  produces: server exits naming missing env vars (config), 401 on every API call
  (wrong tenant/audience, i.e. `ENTRA_CLIENT_ID` mismatch), Entra
  `redirect_uri` mismatch (missing trailing slash or unregistered host), sign-in
  page never appearing (SPA served from a static host without the server's
  `marky-mark-hosted` meta marker, `server/app.ts` `injectHostedMarker`), and
  403 with a named permission verb (roles, not deployment).

- **Local mode is pointed at, not re-documented.** The guide references
  `npm run server:local` and `server/README.md` for the offline
  Azurite + mock-auth development mode instead of duplicating it, and
  `server/README.md`'s line that defers the operator walkthrough to "PRD 007
  Req 23, a separate issue" is updated to link `docs/HOSTING-AZURE.md`.

- **Discoverable.** `README.md`'s docs list links the hosting guide, and
  `AGENTS.md`'s one-line inventory of `docs/` mentions it (that file is the
  root `CLAUDE.md` symlink target and carries a ~150-line budget — a word or two,
  not a paragraph). Every relative link added resolves to a file that exists.

- **No behaviour change.** This issue ships documentation. No file under `src/`,
  `server/`, `src-tauri/` or `tests/` changes behaviour; `docs/MAP.md` is not
  hand-edited.

- **Verification, cheap tier first.** The implementer iterates with
  `npm run typecheck` and `npm run test:unit` (or tests targeted at anything
  touched), and runs the full quick gate `npm run validate:quick` **once**,
  right before declaring the goal met — not after every edit and not as a
  starting baseline. The session shows it printing
  `QUICK VALIDATION: ALL PASSED`.

- **A summary comment from the implementer exists on issue #80**, naming the
  branch, the guide, and the quick-gate result.

## Context

Everything the guide documents already exists and is the source of truth for its
exact strings — read these before writing a line:

- `server/config.ts` — the env-var contract: `MM_MODE`, `PORT`,
  `MM_STATIC_DIR`, `MM_STORAGE_CONTAINER`, `AZURE_STORAGE_CONNECTION_STRING`,
  `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, their defaults, and the
  fail-fast-naming-all-missing behaviour.
- `server/README.md` — the backend reference: modes table, env-var table, blob
  layout, manifest shape, the full API/permission table, and the sign-in
  description. The hosting guide is the *operator* complement to it: do not
  copy the API table across; link it.
- `server/providers/azure/entra.ts` (authorize URL, issuer, audience),
  `server/providers/azure/graph.ts` (the three Graph calls the app registration
  must be consented for), `src/lib/hostedAuth.ts` (PKCE, token endpoint, scopes),
  `src/components/HostedSignIn.tsx:35` (the redirect URI is the origin **with**
  a trailing slash).
- `server/index.ts` — the production entry point and start command;
  `package.json` — `build`, `server:local`, `validate:quick` are the real script
  names, and `@azure/storage-blob` + `jose` are the runtime deps App Service
  needs installed.
- `prd/007-azure-hosted-workspaces.md` Req 23 is the contract; Reqs 5, 6, 7 and
  the non-goals list (no trash, no version history, no multi-tenant, no
  anonymous access) constrain what the guide may promise.

There is no Azure subscription in this environment: correctness here means the
guide agrees with the code, so verify each stated URI, scope, variable and
command by grepping the file that consumes it. Prose style follows the existing
docs (`docs/WINDOWS.md`, `docs/RELEASING.md`) — direct second person, tables
where they earn their space, commands in fenced blocks.
