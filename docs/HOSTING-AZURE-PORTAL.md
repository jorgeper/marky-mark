# Installing Marky Mark on Azure — the portal walkthrough

This is the click-by-click version of [HOSTING-AZURE.md](HOSTING-AZURE.md). It
gets you from an empty Azure subscription to a running deployment where people
in your organization sign in with their work account, create workspaces, and
save documents — doing as much as possible in the **Azure portal** rather than
at a terminal.

It assumes you have used the Azure portal before (you know what a resource
group is, you can find the search bar) but not that you know App Service,
Entra ID app registrations, or Blob Storage in any depth. Every step says what
you are creating and *why the app needs it*, so that when a value doesn't match
this guide you know what it was for.

**Two things cannot be done in the portal**, and this guide is honest about
them when they arrive:

- **Building the deployment payload** (step 4) needs Node on your own machine.
  There is no portal button that builds this app.
- **Granting admin consent** (step 3.5) is a portal button, but only if you are
  a tenant admin. If you aren't, someone who is has to click it.

> ### Read this before you set aside an afternoon
>
> Skim [Known limitations](#known-limitations) now rather than after an hour
> of debugging your own configuration — it is the list of things the
> deployment deliberately does not do.

**Roughly an hour**, most of it waiting on Azure to create things.

---

## What you are building

Five Azure resources, and how they fit together:

```
        Browser (the SPA)
              │
              │  sign in ──────────────►  Microsoft Entra ID
              │                            (app registration — who may sign in)
              │
              ▼
       Azure App Service  ◄── the Node server: serves the SPA *and* the API
       (on an App Service Plan — the VM it runs on)
              │
              ▼
       Azure Storage account
       └── one blob container  ── every workspace, document and setting
```

Notable non-things: **no database**, no cache, no queue, no server-local state.
One container holds everything. A workspace is a blob prefix
(`workspaces/<uuid>/…`); user settings live under `users/`.

Also notable: **the browser and the API must be served from the same origin**.
The App Service serves both. Don't put the SPA on a CDN or static host — the
app detects that it is hosted by a marker the server injects into the HTML, and
a static copy never carries it.

---

## Before you start

You need:

1. **An Azure subscription** where you can create resource groups. A pay-as-you-go
   subscription is fine.
2. **Entra ID admin rights in your tenant** — or a friendly admin on call. One
   step (granting consent for directory permissions) is admin-only by design and
   cannot be worked around by an ordinary user.
3. **Node 22.18 or newer on your own machine**, to build the app. Check with
   `node -v`. The 22.18 floor is not arbitrary: from that version Node strips
   TypeScript types natively without a flag, which is the whole reason the server
   ships as `.ts` files with no build step.
4. **A clone of this repository** with `npm install` already run.

### Fill in your names first

Azure will ask for these one at a time over the next hour. Decide them now and
write them down — several must be globally unique across all of Azure, and
finding that out at step 5 is annoying.

| What | Rules | Example | Yours |
| --- | --- | --- | --- |
| Resource group | any name | `marky-mark-rg` | |
| Region | any; use one near your users | `West Europe` | |
| App Service plan | any name | `marky-mark-plan` | |
| **Web app name** | **globally unique**, letters/digits/dashes → becomes `https://<name>.azurewebsites.net` | `marky-mark-example` | |
| **Storage account** | **globally unique**, 3–24 chars, **lowercase letters and digits only** — no dashes | `markymarkexample` | |
| Blob container | lowercase; the app defaults to `marky-mark` | `marky-mark` | |

Two values you don't choose — Azure generates them in step 3, and you will
copy them into step 5:

| What | Where it comes from |
| --- | --- |
| Application (client) ID | the app registration's Overview page |
| Directory (tenant) ID | the same page |

---

## Step 1 — Create the resource group

A resource group is just a folder that holds the other four resources, so you
can find them together and delete them together.

1. In the portal search bar, type **Resource groups**, open it.
2. **+ Create**.
3. **Subscription**: yours. **Resource group**: your name from the table.
   **Region**: your region.
4. **Review + create** → **Create**.

> **Deleting the resource group later deletes everything in it, permanently**,
> including all stored documents. It's the clean way to tear down a trial
> deployment — just be sure that's what you mean.

---

## Step 2 — Create the App Service (the server)

Doing this before the app registration means you learn your real URL now, which
step 3 needs.

1. Search **App Services** → **+ Create** → **Web App**.
2. Fill in the **Basics** tab:

   | Field | Value | Why |
   | --- | --- | --- |
   | Resource group | yours | |
   | Name | your web app name | this becomes `https://<name>.azurewebsites.net` |
   | Publish | **Code** | not a container |
   | Runtime stack | **Node 22 LTS** (or newer) | must be ≥ 22.18 — see below |
   | Operating System | **Linux** | |
   | Region | yours | |
   | Pricing plan | **Basic B1** to start | see the note below |

3. Leave the other tabs at their defaults. On the **Deployment** tab, leave
   continuous deployment **off** — you'll upload a zip by hand.
4. **Review + create** → **Create**, and wait for deployment to finish.
5. **Go to resource**, and note the **Default domain** on the Overview page.
   That's your URL: `https://<your-app>.azurewebsites.net`.

**About the runtime version.** Node must be **22.18 or newer** on the server for
the same reason as on your laptop. "Node 22 LTS" in the portal is well past that
today. If the app later dies at startup complaining about a syntax error near a
type annotation, that's the symptom of too-old a Node — check the actual version
with the SSH console (**Development Tools → SSH**, then `node -v`).

**About the pricing tier.** B1 is the cheapest tier that runs continuously; Free
(F1) tiers go to sleep and don't support custom domains or always-on, so avoid
them here. You can change tiers later under **Settings → Scale up**. This is the
only resource in the guide with a meaningful running cost.

---

## Step 3 — Register the app in Microsoft Entra ID

This is what lets your colleagues sign in with their work account. You are
telling Entra ID: "an application called Marky Mark exists, it lives at this
URL, and people from this organization may sign in to it."

Two properties of this registration matter, and both are consequences of how the
app is built:

- **Single-tenant** — only accounts in your own organization. Personal Microsoft
  accounts and other tenants are out of scope.
- **Sign-in needs no secret; the directory does.** The sign-in happens entirely
  in the browser using auth-code + PKCE — no secret is involved in it. The
  registration still gets **one client secret** (step 3.6), used only by the
  **server** to exchange a signed-in user's token for a Microsoft Graph token
  (that's what powers member search and avatars). The browser never sees it.
- **The registration exposes one API scope of its own** (step 3.3). Signing in
  requests that scope, which is what makes Entra mint the access token the
  app uses as its session — and the only kind of token the Graph exchange
  above accepts. Without it, member search and avatars cannot work.

### 3.1 Create the registration

1. Search **Microsoft Entra ID** → in the left menu, **App registrations** →
   **+ New registration**.
2. **Name**: `Marky Mark` (any name — this is just the label users see on the
   consent screen).
3. **Supported account types**: **Accounts in this organizational directory only
   (… - Single tenant)**.
4. **Redirect URI**: leave it blank for now — the dropdown here doesn't offer the
   right platform type. You'll add it properly in the next step.
5. **Register**.

You land on the **Overview** page. Leave this tab open; step 3.7 comes back for
two values here.

### 3.2 Add the redirect URI — exactly

The redirect URI is where Entra sends the browser back after a successful
sign-in. Entra compares it **character for character** against what the app
sends, so this step is fussy in a way that's worth being deliberate about.

1. In the registration's left menu: **Authentication**.
2. **+ Add a platform** → choose **Single-page application**.

   > **It must be "Single-page application", not "Web".** They look
   > interchangeable in the portal and are not. A "Web" platform entry tells
   > Entra to expect a confidential client with a secret, and it will reject the
   > secret-less exchange this app performs. If you pick wrong, delete the
   > platform and add the right one — there's no way to convert it.

3. **Redirect URI**: your app's origin **with a trailing slash**:

   ```
   https://<your-app>.azurewebsites.net/
   ```

   > **The trailing slash is not decorative.** The app computes its redirect URI
   > as the browser's origin plus `/`, and sends that exact string twice — once
   > in the sign-in redirect, once when exchanging the code for a token. Register
   > it without the slash and *every* sign-in fails with
   > `AADSTS50011: redirect_uri mismatch`. The URL is also case-sensitive here,
   > and must be `https`.

4. Leave both "Implicit grant" checkboxes (**Access tokens**, **ID tokens**)
   **unticked**. The SPA platform doesn't need them; this app uses the auth-code
   flow.
5. **Configure**.

**Every hostname the app answers on needs its own entry in this list.** If you
add a custom domain in step 8, you must come back here and add it too — Azure
will not do it for you, and sign-in on the new domain will simply be broken
until you do.

### 3.3 Expose an API — the scope the app signs in with

When someone signs in, the app asks Entra for an access token *for itself* —
that token is the session, and it is also what the server later trades for a
Microsoft Graph token (an id_token cannot be traded; Entra refuses it with
`AADSTS240002`, and member search silently dies). For Entra to be able to
mint such a token, the registration has to declare that this app *has* an
API worth issuing tokens for:

1. In the registration's left menu: **Expose an API**.
2. Next to **Application ID URI**, click **Add** and accept the default —
   `api://<your Application (client) ID>`. **Save**.
3. **+ Add a scope**, and fill it in exactly:
   - **Scope name**: `access_as_user`
   - **Who can consent?**: **Admins and users**
   - **Admin consent display name**: `Access Marky Mark as the signed-in user`
   - **Admin consent description**: `Allows the app to call its own API as the signed-in user.`
   - **User consent display name**: `Access Marky Mark as you`
   - **User consent description**: `Allows the app to call its own API as you.`
   - **State**: **Enabled**
4. **Add scope**.

One more setting has no portal control on this page and needs the manifest:
the access token must be issued in the **v2.0 format** (the server pins the
`…/v2.0` issuer). In the registration's left menu open **Manifest**, find
`"requestedAccessTokenVersion"` (inside the `api` block on the newer
Microsoft Graph manifest view) and set it to `2` — it is `null` on a fresh
registration. **Save**.

> **Scope name and token version are exact.** The server accepts only tokens
> whose scopes include `access_as_user` and whose issuer is the v2.0 one —
> a different scope name or a `null` token version both surface as a blanket
> `401` on every API call after a successful sign-in.

### 3.4 Add the Microsoft Graph permissions

These let the app look up people in your directory, so a workspace owner can
search for a colleague by name and add them as a member.

1. Left menu: **API permissions**.
2. **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**
   ("delegated" = the app acts as the signed-in user, never on its own).
3. Tick these five (use the search box):
   - `openid`
   - `profile`
   - `email`
   - `User.ReadBasic.All`
   - `User.Invite.All`
4. **Add permissions**.

The first three are the sign-in scopes. Entra grants them implicitly, but listing
them keeps the consent screen honest about what the app asks for.
`User.ReadBasic.All` does the directory's read work — it powers three calls:
searching users, resolving a user id to a display name, and fetching a member's
photo. `User.Invite.All` powers the in-app **Invite…** actions (Management →
People, and the workspace People picker's invite row): the invitation is sent
**as the signed-in admin**, never as the app, so your tenant's own guest-invite
policy (**External collaboration settings** → who may invite) still applies on
top of the app's admin check.

### 3.5 Grant admin consent — the admin-only step

On the same **API permissions** page, click **Grant admin consent for
&lt;your organization&gt;**, then **Yes**.

The Status column should turn to green "Granted for &lt;organization&gt;" for
every row.

**If that button is greyed out, you are not a tenant admin.** `User.ReadBasic.All`
and `User.Invite.All` are permissions an ordinary user cannot consent to for
themselves on first sign-in, so there is no way around this — send the
registration to whoever administers your tenant and have them click it.

If your organization restricts directory reads more tightly than the default, an
admin may tell you they'll only approve `User.Read.All` instead. That's fine —
it covers the same three calls.

### 3.6 Create the client secret

The server exchanges each signed-in user's token for a Graph token (the
"on-behalf-of" flow), and that exchange has to prove it really is your app
calling. The proof is a client secret:

1. In the registration's left menu: **Certificates & secrets**.
2. **+ New client secret**. Description: `marky-mark-obo` (any label works);
   expiry: pick what your organization allows — 12 months is a sensible
   default.
3. **Add**, then immediately copy the **Value** column — it is shown **only
   this once**. (Not the "Secret ID" next to it; that GUID is just Azure's
   name for the entry.)

This value is the app setting `ENTRA_CLIENT_SECRET` in step 5.2. Treat it like
the storage connection string: a **secret**, never pasted anywhere but the app
settings. When it expires, member search and avatars stop working while
everything else carries on — come back here, create a new one, and update the
app setting.

### 3.7 Copy the two IDs

Back on the registration's **Overview** page, copy these two values somewhere
you can paste from in step 5:

| Portal label | You'll paste it into | What it does |
| --- | --- | --- |
| **Application (client) ID** | `ENTRA_CLIENT_ID` | pins which app tokens must be issued for |
| **Directory (tenant) ID** | `ENTRA_TENANT_ID` | pins which organization tokens must come from |

Both are GUIDs and both are on the Overview page's "Essentials" panel.

> **The classic mistake:** the Overview page also shows an **Object ID**, right
> next to the Application (client) ID and looking exactly like it. It is not the
> same value and the app will not work with it. Copy the one labelled
> **Application (client) ID**.

Neither value is a secret — the client ID is visible in the browser by design.
The connection string in the next step very much is.

---

## Step 4 — Create the storage account

This is where every document, workspace and setting is stored.

### 4.1 Create the account

1. Search **Storage accounts** → **+ Create**.
2. **Basics** tab:

   | Field | Value |
   | --- | --- |
   | Resource group | yours |
   | Storage account name | your name — lowercase letters and digits only |
   | Region | the same region as your App Service |
   | Primary service | Azure Blob Storage |
   | Performance | **Standard** |
   | Redundancy | **LRS** (locally-redundant) is fine to start |

3. Go to the **Advanced** tab and **untick "Allow enabling anonymous access on
   individual containers"**.

   > This matters. Every file is meant to be served through the app's API, behind
   > the sign-in check *and* the per-workspace permission check. Public blob
   > access would create a second, unauthenticated way to reach the same bytes.

4. **Review + create** → **Create**.

### 4.2 Create the container

1. Open the new storage account → left menu **Data storage → Containers**.
2. **+ Container**. **Name**: `marky-mark`. **Anonymous access level**:
   **Private (no anonymous access)**.
3. **Create**.

The name `marky-mark` is the app's default. If you name it something else,
you must set `MM_STORAGE_CONTAINER` to that exact string in step 5.2 — otherwise
the app looks for a container that isn't there.

### 4.3 Copy the connection string

1. Left menu → **Security + networking → Access keys**.
2. Under **key1**, click **Show** next to **Connection string**, and copy it.

> **This is a secret.** It contains an account key that grants full access to
> everything in the storage account. It goes into App Service settings in the
> next step and nowhere else — not into a file in the repo, not into a chat
> message, not into a ticket.

### 4.4 Optional but recommended: turn on soft delete

**Deletes in Marky Mark are permanent.** There is no trash and no version
history: deleting a file, a folder, or a whole workspace removes the blobs. If
you want a recovery window, Azure provides one — the app never will:

1. Storage account → **Data management → Data protection**.
2. Tick **Enable soft delete for blobs**, set a retention (14 days is
   reasonable).
3. **Save**.

---

## Step 5 — Configure the App Service

Now you tell the server about the three resources you just created.

### 5.1 Where the settings live

In the portal, App Service configuration is split across two blades, and which
one holds what has shifted over the years. Look in this order:

- **Settings → Environment variables → App settings tab** — the name/value pairs
  (newer portal layout).
- **Settings → Configuration → Application settings tab** — the same thing in
  the older layout.
- **Settings → Configuration → General settings tab** — the **Startup Command**,
  which is on its own tab either way.

### 5.2 Add the application settings

Add each of these with **+ Add**, then click **Apply** / **Save** *once* at the
end. Saving restarts the app.

| Name | Value | Notes |
| --- | --- | --- |
| `MM_MODE` | `azure` | switches the app from local mock mode to real Entra + Blob Storage. Any value other than `local`/`azure` refuses to start. |
| `ENTRA_TENANT_ID` | your Directory (tenant) ID | from step 3.7 |
| `ENTRA_CLIENT_ID` | your Application (client) ID | from step 3.7 |
| `ENTRA_CLIENT_SECRET` | the client secret's Value | from step 3.6 — **secret** |
| `AZURE_STORAGE_CONNECTION_STRING` | the connection string | from step 4.3 — **secret** |
| `MM_STORAGE_CONTAINER` | `marky-mark` | only needed if you named the container something else, but setting it explicitly is harmless |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` | tells App Service to deploy your payload as-is rather than running its own build, which would fail here |

> **Do not add a `PORT` setting.** App Service injects one, and the server listens
> on whatever it's given. Pin it to your own number and the platform's health
> probe never reaches the app — every request answers `502`, with nothing in the
> app log to explain it. This is a common and very confusing self-inflicted
> outage.

**Mark the secrets as such if you like:** you can move
`AZURE_STORAGE_CONNECTION_STRING` and `ENTRA_CLIENT_SECRET` into Azure Key
Vault and reference them here
instead of pasting the literal values. That's a good practice and entirely
optional; the app can't tell the difference.

### 5.3 Set the startup command

**Settings → Configuration → General settings → Startup Command**:

```
MM_MODE=azure node server/index.ts
```

Then **Save**.

Plain `node`, no build step, no process manager. The path is relative to
`/home/site/wwwroot`, where your zip will land.

(`MM_MODE` appears both here and in the app settings. Either alone is enough;
having both means neither a settings edit nor a startup-command edit can quietly
drop the app back into local mock mode.)

---

## Step 6 — Build the deployment payload (on your machine)

No portal path exists for this. Open a terminal in your clone of the repo.

The server needs no build; the SPA does. You build it, then stage exactly the
files the server needs at run time into a throwaway `deploy/` folder:

```sh
npm run build          # builds the SPA into dist/

rm -rf deploy && mkdir deploy
cp -R dist server package.json package-lock.json deploy/
mkdir -p deploy/src && cp -R src/lib deploy/src/lib
cd deploy
npm ci --omit=dev
```

What's in the payload and why each piece must be there:

| Path | Why it ships |
| --- | --- |
| `dist/` | the built SPA the server serves to browsers |
| `server/` | the app itself; `server/index.ts` is the entry point |
| `src/lib/` | the server imports shared pure modules from here, and those import further siblings — **copy the whole directory** or the server crashes on an import |
| `package.json`, `package-lock.json` | so `npm ci` resolves exactly the versions the repo pins |
| `node_modules/` (production only) | the server itself imports just two packages; the rest belongs to the SPA and is already bundled into `dist/` |

`--omit=dev` is what keeps Vite, Playwright and the Tauri toolchain — hundreds of
megabytes of build tooling — off your App Service.

Now zip **the contents** of `deploy/`, not the folder itself:

```sh
zip -r ../deploy.zip .    # run this from inside deploy/
```

> The zip's root must contain `server/`, `dist/`, `node_modules/` directly. If
> you zip the folder, everything lands one level too deep at
> `/home/site/wwwroot/deploy/…` and the startup command won't find
> `server/index.ts`.

`deploy/` and `deploy.zip` are throwaway build artifacts that this repo does
**not** gitignore. Delete them when you're done, or build them outside your
clone, so they never end up in a commit.

---

## Step 7 — Deploy the zip

The portal has no "upload a zip" button on the App Service blade itself, but the
built-in Kudu tool does, and it's a drag-and-drop page.

### 7.1 Upload via Kudu (portal route)

1. App Service → left menu **Development Tools → Advanced Tools** → **Go →**.
   (This opens the Kudu site at `https://<your-app>.scm.azurewebsites.net` in a
   new tab, signed in with your Azure identity.)
2. In Kudu's top menu: **Tools → Zip Push Deploy**. (Or go straight to
   `https://<your-app>.scm.azurewebsites.net/ZipDeployUI`.)
3. **Drag `deploy.zip` onto the page.** It uploads, extracts to
   `/home/site/wwwroot`, and restarts the app. Progress shows on the page.

### 7.2 Or, one command

If you have the `az` CLI signed in, this is the same thing in one line:

```sh
az webapp deploy --name <your-app> --resource-group <your-rg> \
  --src-path deploy.zip --type zip
```

### 7.3 Watch it start

App Service → **Monitoring → Log stream**. Give it a minute; the first start is
the slow one.

**A healthy start prints exactly one line naming the whole wiring:**

```
marky-mark server: mode=azure port=8080 static=dist (auth=entra, storage=blob, directory=graph)
```

Read that line carefully — it's the best diagnostic in the system:

- `mode=azure` and `auth=entra, storage=blob, directory=graph` — correct.
- `auth=mock, storage=azurite, directory=mock` — **`MM_MODE` never arrived.**
  The app is running in local mock mode and talking to nothing you created. Check
  the app setting and the startup command.
- A line starting `MM_MODE=azure requires environment variables: …` — the named
  settings are missing. It lists **all** of them at once, so there's no
  guess-and-retry loop. Add them and restart.

The app refuses to start at all rather than starting half-configured and failing
mysteriously three requests later. That's deliberate.

---

## Step 8 — Add a custom domain (optional)

Skip this if `https://<your-app>.azurewebsites.net` is good enough.

### 8.1 Bind the domain

1. App Service → **Settings → Custom domains** → **+ Add custom domain**.
2. Enter your domain (e.g. `docs.example.com`). The portal shows you the two DNS
   records it needs:
   - a **CNAME** from your domain to `<your-app>.azurewebsites.net`
   - a **TXT** record at `asuid.<subdomain>` proving you own the domain
3. Create both at your DNS registrar, wait for propagation (usually minutes),
   then click **Validate** → **Add**.

### 8.2 Add the certificate

1. On the same **Custom domains** page, find your new domain and click
   **Add binding**.
2. Choose **Create App Service Managed Certificate** — it's free and renews
   itself — then bind it with TLS/SSL type **SNI SSL**.
3. Then go to **Settings → Configuration → General settings** and set
   **HTTPS Only** to **On**.

### 8.3 Register the new redirect URI — don't skip this

**This is the step whose omission silently breaks sign-in.** Your app now
answers on a second origin, and Entra matches redirect URIs exactly. Until you
add the new one, every user on the custom domain gets `AADSTS50011` and nothing
else.

1. **Entra ID → App registrations → Marky Mark → Authentication**.
2. Under the **Single-page application** platform, **Add URI**:

   ```
   https://docs.example.com/
   ```

   Trailing slash. Again.

3. **Keep the `azurewebsites.net` URI in the list too**, unless you've decided
   that hostname should stop working. Both origins can be live at once and each
   needs its own entry.

---

## Step 9 — Verify the deployment

Open your URL in a browser and walk these four things in order. Each one proves
a different piece of the wiring, so when one fails you know exactly which step
to revisit.

**1. The sign-in page appears** — not the editor.

The hosted build renders nothing but a sign-in page until a session exists, with
a sign-in-with-Microsoft button. It knows it's hosted because the server injects
a marker into the HTML as it serves it.

*If you see the editor immediately:* you are looking at a static copy of `dist/`
rather than at the server — a CDN, a static host, something bypassing the app.
The API and the SPA must share one origin. (A `dist/` folder on disk
deliberately never carries the marker.)

**2. Sign-in completes.**

The button sends you to `login.microsoftonline.com`, you authenticate with a work
account in your tenant, and you land back on the app — signed in, editor visible.
Reload the page: you should stay signed in.

*This proves* the app registration, the redirect URI, and the tenant/client IDs
in step 5.2.

**3. A workspace can be created.**

Use **New Workspace** from the menu (or the button on the initial page). You are
its Owner. To confirm it reached storage, go to the storage account →
**Containers → marky-mark**, and look for `workspaces/<uuid>/manifest.json`.

*This proves* the storage connection string and container name.

**4. A file saves and survives a reload.**

Create a document in that workspace, type something, save. The container gains
`workspaces/<uuid>/files/<name>.md`. Reload the page and reopen it — your text is
there.

Those four are what "a working deployment" means here. A fifth worth thirty
seconds: open a workspace's settings and type a colleague's name into the
People picker — tenant users (members and guests, the latter badged) appear
as you type, with photos where they have one. An error there points at the
client secret or the admin consent — see Troubleshooting.

---

## Known limitations

Read these before concluding that something you configured is wrong.

- **No trash, no version history.** Deletes are permanent. Blob soft delete
  (step 4.4) is the only recovery path, and you have to opt into it.

- **Single tenant only.** Guests and personal Microsoft accounts are out of
  scope, as is anonymous access — every request requires a signed-in user.

- **One deployment, one container.** No sharding, no quotas beyond a 20 MB
  per-upload cap, and no billing controls.

---

## Troubleshooting

**Log stream** (App Service → **Monitoring → Log stream**) is where nearly all of
this shows up. For a shell on the instance — to check `node -v`, or look at what
actually landed in `/home/site/wwwroot` — use **Development Tools → SSH**.

| What you see | What it means | What to do |
| --- | --- | --- |
| Log says `MM_MODE=azure requires environment variables: …` | exactly the named app settings are missing | add them (step 5.2). The message lists all of them at once |
| Log says `MM_MODE must be 'local' or 'azure', got '…'` or `PORT must be a TCP port number, got '…'` | a malformed app setting — typo, stray quote, trailing space | fix the value; never set `PORT` yourself |
| Startup line reads `auth=mock, storage=azurite, directory=mock` | `MM_MODE` didn't arrive — usually the startup command was overwritten | re-apply the startup command (step 5.3) and the app setting |
| `502` from the platform, nothing at all in the app log | the app isn't listening on App Service's port, almost always because `PORT` was set as an app setting | delete the `PORT` app setting |
| Sign-in works, then **every** API call returns `401` | the token's issuer, audience or scopes don't match what the server expects — an **Object ID** pasted into `ENTRA_CLIENT_ID` instead of the Application (client) ID, a tenant ID from a different directory, or the **Expose an API** step (3.3) skipped or done with a different scope name / a `null` token version | re-copy both IDs from the registration's Overview page (step 3.7), re-check step 3.3's exact values, and restart |
| `AADSTS50011: The redirect URI … does not match` | the origin isn't registered, or is registered without the trailing slash, or was added under the **Web** platform instead of **Single-page application** | register `https://<host>/` — slash included — as a **SPA** redirect URI for *every* host the app answers on (steps 3.2 and 8.3) |
| The editor appears immediately, no sign-in page | the SPA is being served by something other than this server, so the hosted marker was never injected | serve the app from the App Service origin; the API and SPA must share one origin |
| `403` naming a permission, e.g. `{"error":"forbidden","required":"file.create"}` | **working as designed** — that user's role in that workspace lacks that verb | change their role in the workspace's member settings; not a deployment fault |
| Member search errors; avatars never load; everything else works | the server's Graph token exchange is failing — an expired or mistyped `ENTRA_CLIENT_SECRET`, or admin consent (step 3.5) was never granted. The log stream shows the cause, e.g. `Graph token exchange failed: 401 (invalid_client): AADSTS7000215 …` — the `AADSTS…` sentence is Entra naming the actual problem | create a fresh secret (step 3.6), update the `ENTRA_CLIENT_SECRET` app setting, save (which restarts); or have an admin grant the consent |
| App is very slow to respond after being idle | a Free/Shared tier put the app to sleep | move to Basic B1 or above (**Settings → Scale up**) |

---

## Try it locally first — no Azure required

You don't need any of the above to see the hosted flavor working. From your
clone:

```sh
npm run server:local
```

One command, zero Azure resources: local storage emulation, mock sign-in, and a
seeded directory of fake users, at <http://localhost:4924>. It's a genuinely
useful way to understand what you're deploying before you deploy it — and, since
the directory is mocked, it's also the configuration where the member picker's
user search actually works.

---

## Where to go next

- [HOSTING-AZURE.md](HOSTING-AZURE.md) — the same deployment as `az` CLI
  commands. Better if you want to script it or put it in CI.
- `server/README.md` — the backend reference: the API surface, the workspace
  storage layout, and the role-to-permission catalog behind those `403`s.
