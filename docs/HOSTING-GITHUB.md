# Hosting Marky Mark on the GitHub backend

<!-- PRD 010 Req 20: the operator walkthrough for the github storage backend,
     the sibling of HOSTING-AZURE.md. Every value here is pinned by code in
     this repo and each step names the file that consumes it. The environment
     REFERENCE is server/README.md § Environment variables; this is the
     walkthrough around it, not a second copy of the table. -->

This is the operator walkthrough for running the hosted flavor with its files
in a **Git repository** instead of Azure Blob Storage: from no GitHub App at
all to a deployment where every document is a commit, and where a team admin
can point a new workspace at a repo of their own. It satisfies
`prd/010-github-repo-storage.md` Req 20.

The backend knob is **orthogonal to `MM_MODE`** — [§ 5](#5-the-knob-is-not-the-mode)
is the section operators most often need. This guide covers only the GitHub
half; sign-in, the App Service, the custom domain and the deployment payload
are [HOSTING-AZURE.md](HOSTING-AZURE.md)'s, and it is named at each step where
you need it. The backend reference — API surface, permission catalog, manifest
shape, the full environment-variable table — is
[`server/README.md`](../server/README.md); this guide does not repeat it.

## Before you start

- A **GitHub account or organization** you can create a GitHub App under, and
  admin rights on the repository the deployment will store into. GitHub
  Enterprise Server works too — every host string is a variable
  (`MM_GITHUB_API_BASE`, `MM_GITHUB_WEB_BASE`).
- Somewhere to run the server. This guide's app-settings commands are App
  Service's, exactly as the Azure guide's are; any Node ≥ 22.18 host works, the
  settings are just environment variables.
- **The App private key is the only GitHub credential the server accepts.**
  There is nowhere to put a personal access token or a long-lived repo token —
  `loadGitHubConfig` in `server/config.ts` reads an App id and a PEM and
  nothing else, and no other file in `server/` reads a GitHub credential.

Pick your names once and export them; the rest of the guide reuses them:

```sh
export APP=marky-mark-example                   # the deployment; origin below
export ORIGIN="https://$APP.azurewebsites.net"  # or your custom domain
export GH_OWNER=example-org                     # who owns the default repo
export GH_REPO=marky-mark-storage               # the default repo itself
export GH_APP_SLUG=marky-mark-example           # the App's URL slug (step 1.5)
```

## 1. Register the GitHub App

**Settings → Developer settings → GitHub Apps → New GitHub App** (for an
organization: **Organization settings → Developer settings → GitHub Apps**).
There is no `az`-style CLI step here; the App registration is a web form.

### 1.1 The identity fields

| Field | Value | Why |
| --- | --- | --- |
| **GitHub App name** | anything, e.g. `Marky Mark (example)` | it decides the slug — see 1.5 |
| **Homepage URL** | `$ORIGIN` | required by the form; nothing reads it |
| **Webhook → Active** | **unchecked** | the server has no webhook endpoint: it reads the repo when it serves a request and never waits to be told (PRD 010 Req 10 is a re-check of the branch head, not a hook) |

### 1.2 The one permission

**Repository permissions → Contents: Read and write.** That is the whole
permission set. Leave every other repository permission, every organization
permission and every account permission at **No access**.

Contents is read *and* write because a save is a commit: `server/providers/github/storage.ts`
writes one commit per mutation, authored by the signed-in user and committed by
the app. A read-only installation is not "degraded" — the server refuses to
start against it and names it (step 4's fail-fast check).

Do **not** enable *Request user authorization (OAuth) during installation*: the
server acts as the App and its installation, never as the visitor's own GitHub
account, so no user-to-server token exists anywhere in `server/`.

### 1.3 The Setup URL

Set **Setup URL** to your deployment's origin, and tick **Redirect on update**:

```
$ORIGIN/
```

This is where GitHub returns an admin who has just installed the App from the
connect-your-repo wizard (§ 6). GitHub appends three query parameters to it,
and `readGitHubReturn` in `src/lib/githubConnectWizard.ts` is what reads them:

| Parameter | What the app does with it |
| --- | --- |
| `installation_id` | the installation to list repos and branches from |
| `setup_action` | what the admin did — a `cancel` return abandons the wizard with a reason rather than resuming into a half-made connection |
| `state` | echoed back verbatim — the wizard session id it put in the install URL (`server/githubByo.ts` builds `…/apps/<slug>/installations/new?state=<session>`); a return that does not match the saved session restarts the wizard rather than resuming into someone else's |

The Setup URL is the SPA's origin, so the return lands on the app itself, which
re-enters the New Workspace flow. **Every origin the app answers on needs the
App's Setup URL to be one of them** — a GitHub App holds exactly one Setup URL,
so a deployment reachable on both `*.azurewebsites.net` and a custom domain
should set it to the one users actually use.

If you only ever want the deployment-default repo and no BYO connections at
all, the Setup URL is unused: leave it at the origin anyway, and simply do not
set `MM_GITHUB_APP_SLUG` (§ 6).

### 1.4 Where the App may be installed

- **Only on this account** — enough for a github default backend alone.
- **Any account** — required if you want the BYO story of § 6 to reach repos
  in other organizations or in members' personal accounts.

### 1.5 Generate the key and copy the three values

On the App's **General** page, scroll to **Private keys → Generate a private
key**. The download is a PKCS#1 PEM (`-----BEGIN RSA PRIVATE KEY-----`);
PKCS#8 (`BEGIN PRIVATE KEY`) is accepted too — `normalizeGitHubPrivateKey`
(`server/providers/github/auth.ts`) reads both. **The file is shown once.**

Three values leave this page:

| Value | Where on the page | Becomes |
| --- | --- | --- |
| **App ID** | General → About, a number | `MM_GITHUB_APP_ID` |
| the `.pem` you just downloaded | your Downloads folder | `MM_GITHUB_PRIVATE_KEY` |
| the **slug** | the tail of the App's public page, `github.com/apps/<slug>` | `MM_GITHUB_APP_SLUG` |

The slug is the App name lowercased with spaces turned into dashes, but read it
off the URL rather than deriving it — GitHub disambiguates collisions by
appending digits.

**Carrying the PEM as an app setting.** App Service application settings cannot
hold literal newlines, so the value is `\n`-escaped there; anywhere that can
hold a real multi-line value (a container secret, a `.env` for local work), the
literal PEM is fine. Both are accepted, and the choice is invisible to the rest
of the server:

```sh
# \n-escaped, for an App Service app setting:
export MM_GITHUB_PRIVATE_KEY="$(awk '{printf "%s\\n", $0}' marky-mark-example.private-key.pem)"

# literal newlines, for a local shell:
export MM_GITHUB_PRIVATE_KEY="$(cat marky-mark-example.private-key.pem)"
```

Treat it exactly as the Azure guide treats the storage connection string: it is
the credential for every byte the deployment stores. It is never echoed — a
malformed value is refused as `MM_GITHUB_PRIVATE_KEY is not a readable PEM
private key (expected a BEGIN [RSA] PRIVATE KEY block)`, naming the variable
and never the value.

## 2. Install the App on the default repo

Create the repository the deployment stores into (private, and empty is fine —
the server writes what it needs on first use):

```sh
gh repo create "$GH_OWNER/$GH_REPO" --private
```

Then **App → Install App → Install** on `$GH_OWNER`, choosing **Only select
repositories → `$GH_REPO`**. Installing on *All repositories* also works and is
what BYO admins will often choose for themselves, but the deployment itself
needs exactly this one.

**What the default repo then holds.** The same layout the blob backend uses,
at repo-relative paths under `MM_GITHUB_DEFAULT_ROOT`, on the one configured
branch:

```
workspaces/<uuid>/manifest.json     the workspace manifest
workspaces/<uuid>/backend.json      which backend backs that workspace
workspaces/<uuid>/files/<path>      its documents and assets
users/<id>/…                        per-user roaming settings and themes
```

That repo is **app storage, not intended for human browsing**: the paths carry
opaque workspace UUIDs and a `files/` segment, and hand-editing them is not a
supported workflow. The repo laid out *for* humans is the BYO case of § 6,
which is the other way round on purpose.

The branch is a single configured branch for the whole deployment
(`MM_GITHUB_DEFAULT_BRANCH`, default `main`); there is no per-workspace branch
anywhere in this backend. If you protect that branch, the App installation must
still be able to push to it — a branch-protection rule the App cannot satisfy
shows up as a failed save, not as a queued one.

## 3. Configure the server for a github default backend

One variable turns the backend on; three are then required, five are optional.
The complete table is `server/README.md` § Environment variables — these are
the GitHub ones, with the defaults `server/config.ts` really applies:

| Variable | Required? | Default | What it is |
| --- | --- | --- | --- |
| `MM_STORAGE_BACKEND` | to use this backend at all | `blob` | `github` selects it (PRD 010 Req 1). |
| `MM_GITHUB_APP_ID` | **required** on the github backend | — | The App's numeric id (step 1.5). Non-numeric is refused by name. |
| `MM_GITHUB_PRIVATE_KEY` | **required** on the github backend | — | Its PEM, literal or `\n`-escaped (step 1.5). **Secret.** |
| `MM_GITHUB_DEFAULT_REPO` | **required** on the github backend | — | The default repo as `owner/repo` — exactly one pair, **never a URL**. |
| `MM_GITHUB_DEFAULT_BRANCH` | optional | `main` | The one branch everything is stored on. |
| `MM_GITHUB_DEFAULT_ROOT` | optional | the repo root | Repo-relative prefix to store under. |
| `MM_GITHUB_APP_SLUG` | optional | — | The App's URL slug. Only the connect-your-repo wizard needs it (§ 6): without it the New Workspace dialog reports the GitHub choice unavailable rather than offering a dead end. |
| `MM_GITHUB_WEB_BASE` | optional | the public GitHub web host | Host the wizard's install URL is built on, for GitHub Enterprise Server. Needs `MM_GITHUB_APP_SLUG`. |
| `MM_GITHUB_API_BASE` | optional | the public GitHub REST root | REST root, for GitHub Enterprise Server. |

There are no other `MM_GITHUB_*` variables. In particular there is no client
secret, no token, no installation id: the installation is looked up per repo
from the App credentials.

On App Service (the Azure guide's steps 3–5 build the payload, create the app
and add the custom domain — all of that is unchanged, `$RG` included: it is the
resource group you exported there):

```sh
az webapp config appsettings set --name "$APP" --resource-group "$RG" --settings \
  MM_STORAGE_BACKEND=github \
  MM_GITHUB_APP_ID="$MM_GITHUB_APP_ID" \
  MM_GITHUB_PRIVATE_KEY="$MM_GITHUB_PRIVATE_KEY" \
  MM_GITHUB_DEFAULT_REPO="$GH_OWNER/$GH_REPO" \
  MM_GITHUB_DEFAULT_BRANCH=main \
  MM_GITHUB_APP_SLUG="$GH_APP_SLUG" \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false
```

Two refusals to expect, both at startup and both naming every gap at once
(`loadConfig`, `server/config.ts`):

```
MM_STORAGE_BACKEND=github requires environment variables: MM_GITHUB_PRIVATE_KEY, MM_GITHUB_DEFAULT_REPO
MM_GITHUB_DEFAULT_REPO must be one 'owner/repo' pair, got 'https://github.com/example-org/marky-mark-storage'
```

### The deployment's LLM provider (optional)

Orthogonal to the storage backend, and identical on both: Marky Mark's LLM
features run against **one provider that you configure here**. Set none of
these four and the deployment starts exactly as it does today and reports
itself as having no LLM: no provider is contacted, no LLM affordance appears.
That is a supported configuration, not a broken one — there is no default
provider, no default model and no default key.

| Variable | Required? | Default | What it is |
| --- | --- | --- | --- |
| `MM_LLM_PROVIDER` | optional; **required** to configure a provider at all | — | Which provider: `openai`, `anthropic`, `gemini`, `openrouter`, or `custom` for any OpenAI-compatible endpoint. Any other value refuses to start, naming the value it got. |
| `MM_LLM_MODEL` | **required** once a provider is named | — | The model id sent on every request, e.g. `gpt-4o-mini`. No model is ever fabricated for you. |
| `MM_LLM_API_KEY` | **required** once a provider is named | — | The provider credential. **Secret** — see below. |
| `MM_LLM_BASE_URL` | **required** for `custom`, refused for every other provider | — | Absolute `http(s)` root of an OpenAI-compatible endpoint. On a hosted provider it would silently do nothing, so naming it there is refused rather than ignored. |

**The key is deployment-wide, and it is yours, not your members'.** One
credential serves every member of this deployment; every request they make
spends it. It is never shown to a member and cannot be changed by one: no
route accepts a key, a provider, a model or a base URL from a browser, the key
value appears in no response, no error message and no log line, and the only
thing the app tells a signed-in member is which provider kind and model are in
use. Rotating or revoking it is a settings change here, followed by a restart.

The browser never talks to a provider: it posts to this app's own origin
(`/api/llm`, behind the same sign-in as every other API route) and the server
makes the outbound call with the key above.

Half a section refuses to start, naming every gap at once:

```
LLM configuration is incomplete, missing: MM_LLM_MODEL, MM_LLM_API_KEY
MM_LLM_PROVIDER must be one of openai, anthropic, gemini, openrouter, custom, got 'gpt5'
MM_LLM_PROVIDER=custom requires environment variables: MM_LLM_BASE_URL
```

A healthy start names the choice — and only the choice — on the startup line:
`llm=openai:gpt-4o-mini`, or `llm=none` when you configured none.

## 4. Verify the deployment

**The startup line is the first check.** A healthy start logs:

```
marky-mark server: mode=azure port=8080 static=dist (auth=entra, storage=github-repo, directory=graph)
```

`storage=github-repo` is the confirmation the backend knob arrived;
`storage=blob` or `storage=azurite` there means it did not.

**The fail-fast check is the second.** Before the HTTP listener accepts
anything, `server/index.ts` proves the default repo is reachable **and**
writable (PRD 010 Req 6). A deployment that cannot write where it was pointed
**exits non-zero** with the reason rather than serving 500s later:

```
marky-mark server: storage is unusable — GitHub default repository example-org/marky-mark-storage
is not writable: the App installation grants contents: read — grant it Repository permissions →
Contents: Read and write, then accept the updated permissions on the installation
```

```
marky-mark server: storage is unusable — GitHub installation lookup for example-org/marky-mark-storage
failed: 404 — not found, or the App is not installed on that repository
```

The first is a permission you can fix on the installation; the second is the
repo name, the owner, or the missing install. Neither ever echoes key material.

Then walk the app itself, as the Azure guide's step 6 does — with one addition:

1. **Sign in and create a workspace.** `gh api repos/$GH_OWNER/$GH_REPO/contents/workspaces`
   now lists a `<uuid>` directory.
2. **Create a document, type, save.** The repo gains
   `workspaces/<uuid>/files/<name>.md`, and `gh api repos/$GH_OWNER/$GH_REPO/commits`
   shows one commit per save — **authored by the signed-in user**, committed by
   the app (`APP_COMMIT_IDENTITY`, `server/providers/github/storage.ts`).
3. **Delete that document.** It disappears from the app, and the delete is
   itself a commit: the content stays in the branch's history. That is why the
   delete confirmation on a git-backed workspace says the repository's history
   retains it instead of promising it cannot be undone (PRD 010 Req 21). The
   app offers no undelete and no version browsing — recovery, if you want it,
   is `git revert` in the repo.

## 5. The knob is not the mode

`MM_STORAGE_BACKEND` and `MM_MODE` are independent, and all four combinations
start (PRD 010 Req 1). This is the thing that trips operators up, so plainly:

| | `MM_MODE=local` | `MM_MODE=azure` |
| --- | --- | --- |
| `MM_STORAGE_BACKEND=blob` | mock auth + Azurite — `npm run server:local` | today's Azure deployment |
| `MM_STORAGE_BACKEND=github` | mock auth, files in a real repo — the fastest way to try this backend | Entra sign-in, files in a real repo |

Consequences worth stating outright:

- **A github-backend deployment needs no Azure storage account.** No container
  is created, `MM_STORAGE_CONTAINER` is unused, and
  `AZURE_STORAGE_CONNECTION_STRING` is **never read** — `loadStorage` in
  `server/config.ts` returns a config with no connection string at all rather
  than a fabricated one, and `MM_MODE=azure` stops requiring it.
- **`MM_MODE=azure` still requires the Entra sign-in configuration.**
  `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID` are required whatever the backend —
  the backend decides where bytes live, not who may sign in. The Azure guide's
  step 1 applies unchanged.
- **The GitHub App is not a sign-in mechanism.** Nobody signs into Marky Mark
  with a GitHub account. Members are the directory's users, and permissions
  inside the app are the workspace manifest's roles.

## 6. The BYO connection story

Beyond the deployment default, a team admin can point a **new** workspace at a
repository of their own (PRD 010 Reqs 15–19). What you must support as the
operator:

1. **`MM_GITHUB_APP_SLUG` must be set.** It is what makes the choice exist:
   `GET /api/github/byo` answers `{available:false, reason}` without it, and
   the New Workspace dialog then offers no storage choice at all rather than a
   dead end. It is the one optional variable with a visible product effect.
2. **The admin's path:** New Workspace → *connect your GitHub repo* → GitHub's
   App install consent (the install URL of step 1.3, carrying the wizard
   session as `state`) → back to the Setup URL → pick repository → branch →
   optional subdirectory. Every GitHub call in that flow is the **server's**,
   made with the App credentials; the browser never holds a GitHub token.
3. **What that repo then looks like** — the opposite of the default repo, for
   humans:

   ```
   <root>/<path>                     the workspace's documents, as normal files
   <root>/.marky-mark/manifest.json  app metadata, all of it under one directory
   ```

   The document the app calls `notes/plan.md` is committed at
   `<root>/notes/plan.md` and reads on GitHub as ordinary Markdown: no id in
   the path, no `files/` segment, no encoding. Files already committed under
   that root **are** workspace documents — that is the point of connecting a
   repo you already have. Pushes and edits made on github.com are picked up on
   the next read (PRD 010 Req 19).
4. **Repair lives in Workspace settings**, for holders of `workspace.settings`
   — the same wizard, re-pointed. A workspace whose repo was renamed, deleted
   or uninstalled is still **listed** with the reason instead of vanishing, so
   an owner can find it and reconnect it (PRD 010 Req 18).
5. **The security boundary for a BYO workspace is the repository's own
   permissions.** Anyone with read access to that repo can read every document
   in that workspace, whatever their in-app role; anyone with write access can
   change them, in the repo if not in the app. In-app roles bound only what
   *the app* permits. Say this out loud to the admins you enable: connecting a
   repo whose collaborator list is wider than the workspace's member list
   widens the workspace. The deployment cannot narrow it, and does not try.

## Known limitations

- **`node server/index.ts` does not start yet** — the extensionless-import gap
  is the backend-independent one described in
  [HOSTING-AZURE.md § Known limitations](HOSTING-AZURE.md#known-limitations),
  and it bites this backend identically.
- **One branch, one root, per deployment.** No per-workspace branch on the
  default backend, no branch switching, and no pull-request flow: a save is a
  commit straight onto the configured branch.
- **No undelete and no version browsing in the app.** The repository's history
  retains what a delete removed (which is what the delete copy says), but
  nothing in Marky Mark reads that history: recovery is a git operation in the
  repo, done outside the app.
- **Rate limits are GitHub's.** A busy deployment shares one installation's
  budget; there is no queue and no backoff — a call that hits the limit fails
  with the reset time named, and the user retries.
- **No webhooks.** Out-of-band pushes are noticed on the next read, not pushed
  to open clients (PRD 010 Req 19).

## Troubleshooting

The 400-vs-502 split below is `server/workspaceConnection.ts`'s and is worth
knowing: **400 means the connection is wrong** (something an admin can fix),
**502 means GitHub is unavailable** (something they can only wait out).

| Symptom | Cause | Fix |
| --- | --- | --- |
| The server exits at startup with `storage is unusable — … is not writable: the App installation grants contents: read` | the installation has Contents but not write | App → Permissions → **Contents: Read and write**, then accept the pending permission request **on the installation** — a granted permission the installation has not accepted is not in effect |
| The server exits at startup with `storage is unusable — GitHub installation lookup for … failed: 404 — not found, or the App is not installed on that repository` | `MM_GITHUB_DEFAULT_REPO` names a repo that does not exist, is spelled differently, or the App was never installed on it | fix the `owner/repo` pair, or install the App there (step 2) |
| `MM_STORAGE_BACKEND=github requires environment variables: …` | exactly the named settings are missing | set them (step 3); the message lists all of them at once |
| `MM_GITHUB_APP_ID must be the numeric GitHub App id` / `MM_GITHUB_PRIVATE_KEY is not a readable PEM private key` | the Client ID (`Iv1.…`) was pasted instead of the App ID, or the PEM lost its newlines | re-copy from the App's General page; `\n`-escape the PEM for an app setting (step 1.5) |
| Startup logs `storage=blob` on a deployment you configured for GitHub | `MM_STORAGE_BACKEND` did not arrive (an app-settings edit, or a startup command that overrides the environment) | re-apply the app settings from step 3 and restart |
| The New Workspace dialog offers no GitHub choice | `MM_GITHUB_APP_SLUG` is unset — `GET /api/github/byo` reports it unavailable by design | set it (step 3) and restart |
| A BYO workspace suddenly reports its repository could not be reached, and is listed needing attention | the App was **uninstalled** from that repo, the repo was **renamed** or **deleted**, or its permissions were **revoked** — all four answer 404/403 from GitHub, i.e. `400` here: the connection is wrong | re-install or re-grant, or reconnect the workspace from Workspace settings (§ 6.4). A rename is not followed: reconnect to the new name |
| The same message, but transient, on a repo nothing changed about | GitHub answered 5xx — `502`, not a broken connection | wait; nothing to reconfigure. The workspace reconnects itself on the next successful read |
| Saves fail with `rate limit exceeded, resets at <time>` | the installation's GitHub rate limit is exhausted | wait for the reset the message names; nothing was written and nothing was retried |
| The delete confirmation says content cannot be undone on a repo-backed workspace | the workspace's row could not report its backend (an unreachable store falls back to the stricter promise) | fix the connection; the copy follows the listing's `retainsHistory` (PRD 010 Req 21) |

## Running it locally instead

You do not need App Service, Entra or Azure to try this backend — mode and
backend are independent (§ 5), so point the local server at a scratch repo:

```sh
MM_STORAGE_BACKEND=github \
MM_GITHUB_APP_ID=123456 \
MM_GITHUB_PRIVATE_KEY="$(cat marky-mark-example.private-key.pem)" \
MM_GITHUB_DEFAULT_REPO="$GH_OWNER/$GH_REPO" \
npm run server:local
```

Mock auth and a seeded user directory as usual, at <http://localhost:4924>,
with every file in the repo. And with no App at all, `npm run server:local`
alone is the offline blob path — the whole GitHub test suite runs against
`server/providers/github/fake.ts`, a local fake of the GitHub REST API, so no
test in this repo ever reaches github.com.
