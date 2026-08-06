# Hosting Marky Mark on Azure

This is the operator walkthrough for the hosted flavor: from an empty Azure
subscription to a running deployment where your tenant's users sign in with
their work account, create workspaces, and save files. It satisfies
`prd/007-azure-hosted-workspaces.md` Req 23.

Follow it top to bottom. Every value it tells you to type is pinned by code in
this repo, and each step names the file that consumes it, so you can check the
source when something disagrees. The backend reference — API surface, the
permission catalog, the manifest shape — is `server/README.md`; this guide does
not repeat it.

Read [Known limitations](#known-limitations) before you set aside an afternoon
for this: the documented start command does not get past its own imports yet,
and tenant user search and avatars do not work against a real tenant.

## Before you start

- An **Azure subscription** you can create resource groups in.
- **Entra ID tenant admin rights** — the Microsoft Graph permissions the member
  picker needs require tenant-wide admin consent, which a non-admin cannot
  grant.
- The **`az` CLI** signed in (`az login`), or the Azure portal. This guide gives
  `az` commands; every one has an obvious portal equivalent and the portal path
  is named where the CLI is awkward.
- **Node ≥ 22.18 locally** to build the SPA. The same floor applies on the
  server: from 22.18 Node strips TypeScript types natively with no flag, which
  is why `server/` has no build step (`server/index.ts`).
- A clone of this repo with `npm install` run.

Pick your names once and export them — the rest of the guide reuses these
variables verbatim:

```sh
export RG=marky-mark-rg                 # resource group
export LOCATION=westeurope              # any region you like
export PLAN=marky-mark-plan             # App Service plan
export APP=marky-mark-example           # web app name → https://$APP.azurewebsites.net
export STORAGE=markymarkexample         # storage account: 3–24 chars, lowercase letters/digits, globally unique
export CONTAINER=marky-mark             # blob container; the default MM_STORAGE_CONTAINER expects this name
```

`$APP` and `$STORAGE` must be globally unique. Create the resource group:

```sh
az group create --name "$RG" --location "$LOCATION"
```

## 1. Register the application in Microsoft Entra ID

The app registration is **single-tenant** (PRD 007 non-goals: no multi-tenant,
no personal Microsoft accounts) and a **public client**: the SPA runs the
auth-code + PKCE flow in the browser, so **no client secret is ever issued or
configured** — there is nowhere in `server/config.ts` to put one.

### 1.1 Create it

```sh
az ad app create --display-name "Marky Mark" --sign-in-audience AzureADMyOrg

export APP_ID="$(az ad app list --display-name 'Marky Mark' --query '[0].appId' -o tsv)"
export APP_OBJECT_ID="$(az ad app list --display-name 'Marky Mark' --query '[0].id' -o tsv)"
```

`AzureADMyOrg` is single-tenant. Portal equivalent: **Entra ID → App
registrations → New registration**, "Accounts in this organizational directory
only".

### 1.2 The redirect URI, exactly

Add the redirect URI under the **Single-page application** platform. `az ad app
create` has no flag for the SPA platform, so patch it through Graph (or use the
portal: **Authentication → Add a platform → Single-page application**):

```sh
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$APP_OBJECT_ID" \
  --headers 'Content-Type=application/json' \
  --body "{\"spa\":{\"redirectUris\":[\"https://$APP.azurewebsites.net/\"]}}"
```

The redirect URI type must be **SPA** (not "Web" — a Web platform entry expects
a confidential client and will reject the secret-less PKCE exchange), and its
value is the SPA's origin **with a trailing slash**:

```
https://$APP.azurewebsites.net/
```

The trailing slash is not decorative. `redirectUri()` in
`src/components/HostedSignIn.tsx:35` returns `` `${window.location.origin}/` ``,
and that exact string is sent both in the authorize redirect and again in the
code-for-token exchange (`buildTokenRequest` in `src/lib/hostedAuth.ts`), where
Entra compares it character for character against the registered list. Register
`https://marky-mark-example.azurewebsites.net` without the slash and every
sign-in fails with `AADSTS50011: redirect_uri mismatch`.

**Every host the app is reachable on needs its own registered redirect URI.**
The `*.azurewebsites.net` default host and a custom domain are different
origins; adding the custom domain later (step 5) does not update the app
registration for you.

### 1.3 What the flow requests, and what the session bearer is

The scopes are `openid profile email` and nothing else. They are pinned in two
places that must agree: `buildAuthorizeUrl` in
`server/providers/azure/entra.ts` (the authorize URL the server hands the SPA)
and `buildTokenRequest` in `src/lib/hostedAuth.ts` (the token exchange). You do
not configure scopes anywhere in Azure — the app requests them at run time.

The session bearer the SPA stores and sends on every API call is the
**id_token**, not an access token. The server validates it against the tenant's
published JWKS with two pinned claims (`createEntraAuthProvider`,
`server/providers/azure/entra.ts`):

| Claim | Must equal | Comes from |
| --- | --- | --- |
| `iss` (issuer) | `https://login.microsoftonline.com/<tenant>/v2.0` | `ENTRA_TENANT_ID` |
| `aud` (audience) | the application (client) id | `ENTRA_CLIENT_ID` |

That is why a tenant or client id typo shows up as a blanket `401` on every API
call rather than as a sign-in failure: the sign-in itself succeeds and the
token is then rejected.

### 1.4 Microsoft Graph permissions

The directory provider (`server/providers/azure/graph.ts`) makes exactly three
calls, all **delegated** (as the signed-in user), all against
`https://graph.microsoft.com/v1.0`:

| Graph call | What it powers | Delegated permission |
| --- | --- | --- |
| `GET /users?$search="displayName:…" OR "userPrincipalName:…"` with the `ConsistencyLevel: eventual` header | the member picker's user search | `User.ReadBasic.All` |
| `GET /users/{id}` | resolving a member id to a display name | `User.ReadBasic.All` |
| `GET /users/{id}/photo/$value` | member avatars (a 404 means "no photo" and falls back to initials) | `User.ReadBasic.All` |

Add them in the portal — **App registrations → Marky Mark → API permissions →
Add a permission → Microsoft Graph → Delegated permissions** — selecting
`openid`, `profile`, `email` and `User.ReadBasic.All`. The first three are the
sign-in scopes; listing them keeps the consent screen honest even though Entra
grants them implicitly.

Then click **Grant admin consent for &lt;tenant&gt;**, or:

```sh
az ad app permission admin-consent --id "$APP_ID"
```

`User.ReadBasic.All` requires tenant-admin consent — an ordinary user cannot
consent to it on first sign-in. If your tenant restricts directory reads more
tightly than the default, it may insist on `User.Read.All` instead; both cover
all three calls.

Consent is necessary but not sufficient today: see
[Known limitations](#known-limitations) for why these three calls still fail
against real Graph.

### 1.5 Copy the two ids

```sh
export ENTRA_CLIENT_ID="$APP_ID"      # the Application (client) ID from 1.1
export ENTRA_TENANT_ID="$(az account show --query tenantId -o tsv)"
echo "client=$ENTRA_CLIENT_ID tenant=$ENTRA_TENANT_ID"
```

In the portal both sit on the registration's **Overview** blade: **Application
(client) ID** → `ENTRA_CLIENT_ID`, **Directory (tenant) ID** → `ENTRA_TENANT_ID`.
These are the app settings of the same name in step 4. Neither is secret — the
client id ends up in the browser by design — but the storage connection string
in the next step very much is.

## 2. Create the storage account and container

```sh
az storage account create \
  --name "$STORAGE" --resource-group "$RG" --location "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 --allow-blob-public-access false

export AZURE_STORAGE_CONNECTION_STRING="$(az storage account show-connection-string \
  --name "$STORAGE" --resource-group "$RG" --query connectionString -o tsv)"

az storage container create \
  --name "$CONTAINER" --account-name "$STORAGE" \
  --connection-string "$AZURE_STORAGE_CONNECTION_STRING"
```

The container name must match `MM_STORAGE_CONTAINER`, whose default is
`marky-mark` (`server/config.ts`). Name the container something else and you
must set that variable to the same string in step 4.

Public blob access stays off: every byte is served through the API, behind the
auth guard and the workspace permission check.

In the portal the connection string lives under **Storage account → Security +
networking → Access keys → key1 → Connection string**. It contains an account
key: treat it as a secret, keep it in App Service application settings (step 4),
and never commit it.

**The storage model, in one breath:** one container, no database, no
server-local state. Each workspace owns a prefix keyed by a server-generated
UUID — `workspaces/<id>/manifest.json` for its manifest and
`workspaces/<id>/files/<path>` for its documents and assets — and per-user
roaming settings live under `users/`. `server/README.md` § Workspace storage
model is the full picture.

**Deletes are permanent.** There is no trash and no version history (PRD 007
non-goals): deleting a file, a folder or a workspace removes the blobs. If you
want recovery, turn on Azure's own **blob soft delete** — the app never does it
for you:

```sh
az storage account blob-service-properties update \
  --account-name "$STORAGE" --resource-group "$RG" \
  --enable-delete-retention true --delete-retention-days 14
```

## 3. Build the deployment payload

The server has no build step; the SPA does. Build it, then stage exactly what
the app needs at run time:

```sh
npm run build          # → dist/ (vite.config.ts outDir)

rm -rf deploy && mkdir deploy
cp -R dist server package.json package-lock.json deploy/
mkdir -p deploy/src && cp -R src/lib deploy/src/lib
(cd deploy && npm ci --omit=dev)
```

What is in there and why:

| Path | Why it must ship |
| --- | --- |
| `dist/` | the built SPA the server serves (`MM_STATIC_DIR`, default `dist`) |
| `server/` | the app itself; `server/index.ts` is the entry point |
| `src/lib/` | `server/workspaces.ts` imports the shared pure modules from here (`hostedWorkspace.ts`, `sidecar.ts`, `fileTransfer.ts`, `workspaceLifecycle.ts`), and those pull in further siblings (`commentFormat.ts`, `fuzzy.ts`, …) — copy the whole directory, or the server crashes on an import |
| `package.json`, `package-lock.json` | so `npm ci --omit=dev` resolves the same versions |
| `node_modules/` (production only) | whatever `dependencies` resolves to — of which the server itself imports exactly two, **`@azure/storage-blob`** and **`jose`**; the rest is the SPA's own dependency block, already bundled into `dist/` and along for the ride |

Staging into `deploy/` rather than building in place keeps your working copy's
devDependencies intact, and installing with `--omit=dev` there means Vite,
Playwright and the Tauri toolchain never travel to App Service. `deploy/` and
the `deploy.zip` of step 4 are throwaway build artifacts the repo does not
ignore — delete them when the deployment is up, or stage them outside your
clone, so they never end up in a commit.

## 4. Create the App Service and deploy

App Service on **Linux**, current Node LTS:

```sh
az appservice plan create --name "$PLAN" --resource-group "$RG" \
  --location "$LOCATION" --is-linux --sku B1

az webapp create --name "$APP" --resource-group "$RG" \
  --plan "$PLAN" --runtime "NODE:22-lts"
```

The runtime must resolve to **Node ≥ 22.18**, which is where native TypeScript
type stripping stopped needing a flag — that is the whole reason `server/` ships
as `.ts` with no build step. `NODE:22-lts` on App Service is well past that
floor today; confirm with `az webapp ssh --name "$APP" --resource-group "$RG"`
and `node -v` if the app dies at startup with a syntax error on a type
annotation. (`az webapp list-runtimes --os linux | grep NODE` lists what the
platform currently offers.)

Set the application settings (these become the server's environment):

```sh
az webapp config appsettings set --name "$APP" --resource-group "$RG" --settings \
  MM_MODE=azure \
  ENTRA_TENANT_ID="$ENTRA_TENANT_ID" \
  ENTRA_CLIENT_ID="$ENTRA_CLIENT_ID" \
  AZURE_STORAGE_CONNECTION_STRING="$AZURE_STORAGE_CONNECTION_STRING" \
  MM_STORAGE_CONTAINER="$CONTAINER" \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false
```

`SCM_DO_BUILD_DURING_DEPLOYMENT=false` tells App Service to deploy the payload
as-is instead of running its own build — you already built and installed in
step 3, and its build would try to run this repo's Vite build without
devDependencies.

Set the startup command to exactly:

```sh
az webapp config set --name "$APP" --resource-group "$RG" \
  --startup-file "MM_MODE=azure node server/index.ts"
```

That is the same command `server/README.md` documents:

```sh
MM_MODE=azure node server/index.ts
```

Plain `node`, no build, no process manager, relative to `/home/site/wwwroot`
where the payload lands. **That command does not currently survive its own
imports** — read [Known limitations](#known-limitations) before you start
hunting for a configuration mistake. (`MM_MODE` is both in the startup command and in the
app settings above; either alone is enough, and keeping both means neither a
settings edit nor a startup-command edit can silently drop the app into local
mode.)

**Do not set `PORT`.** App Service injects it and the server listens on
whatever it finds (`server/config.ts`); pinning it to anything else means the
platform's health probe never reaches the app and every request answers 502.

Now deploy the staged folder as a zip:

```sh
(cd deploy && zip -r ../deploy.zip .)
az webapp deploy --name "$APP" --resource-group "$RG" --src-path deploy.zip --type zip
```

Watch it come up:

```sh
az webapp log tail --name "$APP" --resource-group "$RG"
```

A healthy start logs one line naming the wiring:

```
marky-mark server: mode=azure port=8080 static=dist (auth=entra, storage=blob, directory=graph)
```

`auth=entra`, `storage=blob`, `directory=graph` is the confirmation that azure
mode really is in effect — `mock`/`azurite` there means `MM_MODE` never
arrived.

### Environment variables

The complete contract, straight from `server/config.ts`. Seven variables; there
are no others.

| Variable | Default | azure mode | Meaning |
| --- | --- | --- | --- |
| `MM_MODE` | `local` | **required** (`azure`) | Provider wiring: `local` (mock auth + Azurite) or `azure` (Entra ID + Blob Storage + Graph). Any other value refuses to start. |
| `PORT` | `4924` | do not set | Listen port. App Service injects it. Must parse as a TCP port (1–65535). |
| `MM_STATIC_DIR` | `dist` | optional | Directory the built SPA is served from, relative to the working directory. |
| `MM_STORAGE_CONTAINER` | `marky-mark` | optional | The one blob container everything lives in. Must match the container you created in step 2. |
| `AZURE_STORAGE_CONNECTION_STRING` | Azurite's dev string (local mode only) | **required** | Storage account connection string, from the account's Access keys. Secret. |
| `ENTRA_TENANT_ID` | — | **required** | Directory (tenant) id. Pins the accepted token issuer. |
| `ENTRA_CLIENT_ID` | — | **required** | Application (client) id. Pins the accepted token audience. |

`MM_MODE=azure` **refuses to start** when any required variable is missing, and
names every missing one at once:

```
MM_MODE=azure requires environment variables: ENTRA_CLIENT_ID, AZURE_STORAGE_CONNECTION_STRING
```

That message in the log stream is your first diagnostic: no partial start, no
vendor error three requests later.

## 5. Add a custom domain

```sh
export DOMAIN=docs.example.com
```

Create the DNS records your registrar needs — a `CNAME` from `$DOMAIN` to
`$APP.azurewebsites.net`, plus the `asuid.<subdomain>` TXT record App Service
asks for to prove ownership — then bind and secure it:

```sh
az webapp config hostname add --webapp-name "$APP" --resource-group "$RG" \
  --hostname "$DOMAIN"

# free App Service managed certificate: issue it, then bind it to the hostname
az webapp config ssl create --name "$APP" --resource-group "$RG" --hostname "$DOMAIN"

export CERT_THUMBPRINT="$(az webapp config ssl list --resource-group "$RG" \
  --query "[?subjectName=='$DOMAIN'].thumbprint | [0]" -o tsv)"

az webapp config ssl bind --name "$APP" --resource-group "$RG" \
  --certificate-thumbprint "$CERT_THUMBPRINT" --ssl-type SNI

az webapp update --name "$APP" --resource-group "$RG" --https-only true
```

`ssl create` issues the free managed certificate (it renews itself); `ssl bind`
is the separate step that actually puts it in front of the hostname. The portal
path is **App Service → Custom domains → Add custom domain**, then **Add
binding → Create App Service Managed Certificate**.

**Then register the new origin's redirect URI — this is the step whose omission
silently breaks sign-in.** The app now answers on a second origin, and Entra
matches redirect URIs exactly, so `https://$DOMAIN/` must be on the SPA list
alongside the `azurewebsites.net` one. Users on the custom domain get
`AADSTS50011` and nothing else until you add it:

```sh
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$APP_OBJECT_ID" \
  --headers 'Content-Type=application/json' \
  --body "{\"spa\":{\"redirectUris\":[\"https://$APP.azurewebsites.net/\",\"https://$DOMAIN/\"]}}"
```

The PATCH **replaces** the SPA redirect-uri list, so pass every host you want to
keep — including the `azurewebsites.net` one, unless you have decided that host
should stop working. Portal equivalent: **App registrations → Marky Mark →
Authentication → Single-page application → Add URI**. Trailing slash, again, on
both.

## 6. Verify the deployment

Open `https://$DOMAIN/` (or `https://$APP.azurewebsites.net/`) in a browser and
walk these four things:

1. **The sign-in page appears.** Not the editor — the hosted build renders
   nothing but a sign-in page until a session exists. It shows a
   sign-in-with-Microsoft button, because the server injected
   `<meta name="marky-mark-hosted" content="azure">` into the HTML
   (`injectHostedMarker`, `server/app.ts`). Seeing the editor straight away
   means you are looking at a static copy of `dist/`, not at the server.
2. **Sign-in completes.** The button sends you to
   `login.microsoftonline.com`, you authenticate with a work account in the
   tenant, and you land back on the app's root URL — signed in, with the editor
   visible. Reload the page: you stay signed in.
3. **A workspace can be created.** Create one from the menu's New Workspace
   row (or the initial page's New Workspace… button). It is yours as Owner.
   `az storage blob list --account-name "$STORAGE"
   --container-name "$CONTAINER" --connection-string
   "$AZURE_STORAGE_CONNECTION_STRING" --prefix workspaces/ -o table` now shows a
   `workspaces/<uuid>/manifest.json` blob.
4. **A file saves.** Create a document in that workspace, type, save. The blob
   list gains `workspaces/<uuid>/files/<name>.md`. Reload the page and reopen
   it: the content is there.

Those four are what "a working deployment" means here. Adding members by
directory search is not on the list — see below.

## Known limitations

- **`node server/index.ts` does not start yet.** The documented start command —
  step 4's, and `server/README.md`'s — exits immediately with
  `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/lib/commentFormat'
  imported from …/src/lib/sidecar.ts`. Three of the shared modules the server
  pulls in name a sibling without its file extension (`src/lib/sidecar.ts` →
  `./commentFormat`, `src/lib/workspaceLifecycle.ts` → `./fuzzy` and
  `./hostedWorkspace`), and Node's ESM resolver does not guess extensions.
  `npm run server:local` never trips over it because it runs under `tsx`, which
  does — so this only bites the production path. Until those specifiers carry
  `.ts`, a payload staged exactly as in step 3 comes up 502 with that error in
  the log stream; shipping `tsx` with the payload and starting
  `npx tsx server/index.ts` gets past the imports, but it is a stopgap nothing
  in this repo documents or tests.
- **Tenant user search and avatars do not work against real Graph yet.**
  `server/providers/azure/graph.ts` forwards the caller's session bearer — the
  **id_token**, issued for `openid profile email` with the application's own
  client id as its audience — straight to Microsoft Graph. Graph only accepts
  access tokens minted for `https://graph.microsoft.com`, so it answers 401
  (`InvalidAuthenticationToken`) regardless of how thoroughly you consented to
  the permissions in step 1.4. In practice: the member picker's user search
  returns an error instead of results, and member avatars fall back to
  initials. The fix is an on-behalf-of token exchange in the auth/directory
  seam; it is not implemented, and granting more Graph permissions will not
  substitute for it. Everything else — sign-in, workspaces, files, comments,
  roles and permission enforcement — is unaffected, because none of it talks to
  Graph.
- **No trash, no version history.** Deletes are permanent (PRD 007 non-goals).
  Blob soft delete (step 2) is the only recovery path, and you opt into it.
- **Single tenant only.** The registration is `AzureADMyOrg`; guests and
  personal Microsoft accounts are out of scope, as is anonymous access — every
  request requires a signed-in user.
- **One deployment, one container.** There is no sharding, no quota enforcement
  beyond the 20 MB per-upload cap, and no billing controls.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The app never starts; the log says `ERR_MODULE_NOT_FOUND: Cannot find module '…/src/lib/commentFormat'` (or `'./fuzzy'`, `'./hostedWorkspace'`) | not your deployment: extensionless imports in the shared `src/lib` modules, which Node's ESM resolver rejects — see [Known limitations](#known-limitations) | nothing to configure; it is a code gap |
| The app never starts; the log says `MM_MODE=azure requires environment variables: …` | exactly the named app settings are missing (`loadConfig`, `server/config.ts`) | set them (step 4); the message lists all of them at once, so there is no second round |
| The log says `MM_MODE must be 'local' or 'azure', got '…'` or `PORT must be a TCP port number, got '…'` | a malformed app setting | fix the value; never set `PORT` yourself |
| Startup line reads `auth=mock, storage=azurite, directory=mock` | `MM_MODE` did not arrive — the startup command was overwritten | re-apply the startup command from step 4 |
| Sign-in works, then **every** API call answers `401` | the id_token's issuer or audience does not match what the server pins — normally an `ENTRA_CLIENT_ID` that is not this registration's Application (client) ID (an Object ID pasted by mistake is the classic), or an `ENTRA_TENANT_ID` from another tenant | re-copy both from the registration's Overview blade (step 1.5) and restart |
| Entra shows `AADSTS50011: The redirect URI … does not match` | the origin is not registered, or is registered without the trailing slash, or was registered under the **Web** platform instead of **Single-page application** | register `https://<host>/` — slash included — as a **SPA** redirect URI for *every* host the app answers on (steps 1.2 and 5) |
| The editor appears immediately, no sign-in page | the SPA is being served by something other than this server (a static host, a CDN origin bypassing it), so the `marky-mark-hosted` meta marker was never injected (`injectHostedMarker`, `server/app.ts`) — `dist/` on disk deliberately never carries it | serve the app from the App Service origin; the API and the SPA must share one origin |
| `403` naming a permission verb, e.g. `{"error":"forbidden","required":"file.create"}` | working as designed: the signed-in user's role in that workspace lacks the verb. Not a deployment fault | change the member's role in the workspace's member settings; the verb-to-role mapping is `server/README.md` § Roles and permissions |
| Member search returns an error; avatars never load | the on-behalf-of exchange is missing — see [Known limitations](#known-limitations) | nothing to configure; it is a code gap |
| `502` from the platform, nothing in the app log | the app is not listening on App Service's `PORT`, usually because it was pinned as an app setting | delete the `PORT` app setting |

`az webapp log tail --name "$APP" --resource-group "$RG"` is where all of the
above shows up. For a shell on the instance (to check `node -v` is ≥ 22.18, for
example): `az webapp ssh --name "$APP" --resource-group "$RG"`.

## Running it locally instead

You do not need any of the above to develop against the hosted flavor:

```sh
npm run server:local
```

One command, no Azure resources — Azurite for storage, mock auth and a seeded
user directory, at <http://localhost:4924>. `server/README.md` § Local
development covers it, and is also the reference for the API surface, the
workspace manifest and the permission catalog this guide points at throughout.
