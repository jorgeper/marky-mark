# How authentication works in hosted Marky Mark

A plain-language tour of Microsoft sign-in as this app uses it: what a
tenant is, who can log in, how the sign-in dance actually works, and
where each piece lives in the code. The operator setup steps are in
[HOSTING-AZURE.md](HOSTING-AZURE.md) § 1; this file explains the model.

## The four words that matter

- **Tenant** — your own little directory of users inside Microsoft's
  cloud (also called "Microsoft Entra ID directory"). Creating an Azure
  subscription gave you one automatically (the "Default Directory",
  e.g. `yourname.onmicrosoft.com`). It is the guest list for your
  deployment: *only accounts that exist in your tenant can sign in.*
- **Member** — a normal user object in your tenant. You can mint these
  freely (`alice@yourname.onmicrosoft.com`) and hand out the passwords.
- **Guest** — a user object in your tenant that *points at an account
  that lives somewhere else*: someone's personal Microsoft account, or
  their work account in a different company's tenant. You invite them
  by email; accepting the invite creates the guest object. They keep
  signing in with their own credentials — your tenant just recognises
  them afterwards.
- **App registration** — Marky Mark's identity card inside your tenant
  (the "Marky Mark" entry under App registrations). It fixes two ids
  the server trusts: the **tenant id** (which directory may sign users
  in) and the **client id** (which app the tokens are for). It is
  registered *single-tenant*: your directory only.

So, to your two questions: **yes**, users you create in the tenant can
log in, and **yes**, people outside it can too once you invite them as
guests — with a personal Microsoft account, a work account from another
tenant, or (with the default invite settings) any email at all, which
gets a one-time-passcode flow. What can *not* happen is a stranger
signing in uninvited: no account in your tenant, no way in.

## The sign-in dance, step by step

The flow is "authorization code + PKCE" — the standard way a
browser-only app signs in without ever holding a secret. In Marky Mark:

1. You open the site. With no session, the server serves the SPA with a
   `marky-mark-hosted` marker and the SPA shows only a sign-in page.
2. You click **Sign in with Microsoft**. The SPA asks the server where
   to go (`POST /api/auth/sign-in`), and the server answers with your
   tenant's authorize URL —
   `login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize` — with
   the client id and the scopes `openid profile email
   api://<client-id>/access_as_user` already pinned
   (`buildAuthorizeUrl`, `server/providers/azure/entra.ts`). That last
   scope is the app's *own* API scope (the registration's "Expose an
   API" step): asking for it is what makes Microsoft mint an access
   token addressed to this app.
3. The SPA adds the parts only it knows — its own redirect URI, a CSRF
   `state`, and a freshly generated PKCE challenge — and sends your
   browser there (`src/lib/hostedAuth.ts`).
4. Microsoft authenticates you *on its own pages*: password, MFA,
   whatever your account requires. Marky Mark never sees credentials.
   For a guest, Microsoft bounces through their home login (their
   personal-account or employer's page) and comes back.
5. Microsoft redirects your browser back to the app's registered
   redirect URI with a one-time **code**. The SPA trades the code (plus
   the PKCE verifier that proves it started the flow) at your tenant's
   token endpoint for tokens. No app secret is involved — the PKCE
   pair is what makes the exchange safe for a public client.
6. Out of that exchange the SPA keeps the **access token** minted for
   the app's own API — a signed statement from your tenant that user
   `<oid>` may call app `<client-id>` with scope `access_as_user`. It
   becomes the session: the SPA stores it and sends it as the bearer on
   every API call. (The exchange also returns an id_token; the SPA may
   read display claims out of it, but it is never sent to the API — it
   is not a valid ticket for calling anything, and the Graph exchange
   below refuses it outright.)
7. On every request, the server verifies that token's signature against
   your tenant's published public keys (JWKS) and checks exactly three
   pinned claims: the **issuer** must be your tenant, the **audience**
   must be your client id, and the **scopes** (`scp`) must include
   `access_as_user`
   (`createEntraAuthProvider`, `server/providers/azure/entra.ts`).
   Anything else — expired, another tenant, another app, or an
   id_token left over in an old tab from before the access-token
   switch — is a flat 401 that sends the browser back through sign-in.
   There is no server-side session store to leak or clean up.

Who you *are* to the app is the token's `oid` claim — the user object's
permanent id in your tenant. Workspace manifests record members by that
id, so renaming a user or changing their email breaks nothing.

Authentication ends there; **authorization** is the app's own layer on
top: each workspace's manifest maps member ids to roles (Owner, Editor,
…), and the server checks the required permission on every operation.
Signing in successfully grants nothing by itself — a signed-in user
with no membership anywhere can list workspace names and that's it.

## Adding people

Create a member (they sign in with this new account):

```sh
az ad user create \
  --display-name "Alice Example" \
  --user-principal-name alice@<yourtenant>.onmicrosoft.com \
  --password '<a strong temp password>' --force-change-password-next-sign-in true
```

Invite a guest (they sign in with their existing account):

```sh
az rest --method POST --uri https://graph.microsoft.com/v1.0/invitations \
  --body '{"invitedUserEmailAddress":"friend@example.com","inviteRedirectUrl":"https://<your-app>.azurewebsites.net/"}'
```

Portal equivalents: **Entra ID → Users → New user → Create new user /
Invite external user**. The invite email's link has the person accept
into your tenant; after that they sign in to Marky Mark normally.

### Inviting from the app

Deployment admins (`MM_ADMINS`) can send that same Graph invitation
without leaving Marky Mark: **Management → People → Invite…**, or — to
grant a workspace role in the same step — type the address into a
workspace's People picker and use its **Invite … as &lt;role&gt;** row.
The server calls `POST /v1.0/invitations` *as the signed-in admin*
through the on-behalf-of exchange (delegated `User.Invite.All`), so
Entra's own guest-invite policy (`allowInvitesFrom`) applies on top —
if your tenant restricts who may invite, that restriction wins. The
invitee gets Microsoft's standard invitation mail (plus the admin's
optional note) and shows with a **Pending** badge in People until they
accept. That invitation email often lands in the invitee's spam folder
(observed with Gmail), so tell invitees to check there. With Entra's
Google federation configured — an operator step in External Identities,
no app change — gmail invitees sign in with their Google account
instead of a one-time passcode.

When Microsoft's email doesn't arrive at all (Graph can report
`sent: true` while delivery quietly fails; observed with Gmail
recipients), the **invite link** is the reliable alternative: the
redeem URL works without any email. A successful **Send** shows the
link of the invitation it just created; **Get invite link** beside Send
creates (or refreshes) the invitation *without* sending Microsoft's
mail and shows the URL to copy; and every **Pending** row in
Management → People offers **Copy invite link**, which re-creates the
invitation silently — Graph only yields the redeem URL at creation, and
a re-POST returns a fresh valid one without disturbing the pending
guest. Hand the copied URL to the invitee over any channel you trust;
redeeming it accepts them into the tenant exactly as the email's link
would.

While the badge still says **Pending**, an admin can change their mind:
the row's **Rescind** action (behind a confirm naming the email) deletes
the unredeemed guest's account — again as the signed-in admin, via
delegated `User.ReadWrite.All` — and removes any workspace memberships
it had been granted. Once the invitation is accepted the action
disappears: members and accepted guests are managed in Entra, never
deleted from the app.

Then give them access in the app: search for them in the workspace's
People section (the picker searches your tenant through Microsoft
Graph — see "How the directory calls authenticate" below), or flip the
workspace's **everyone-in-tenant access** toggle (workspace settings)
to admit every tenant account at a default role.

## Who can do what: the access model

Authentication decides who gets *in*; this section is the map of what
they can *do* once in. The building metaphor:

- **Signing in = getting into the building.** Controlled entirely at
  the tenant layer: you decide who is in the directory — members you
  create, guests you invite. Nobody uninvited gets past the door, and
  Marky Mark itself has no user database to manage; the tenant is it.
- **Workspaces = locked rooms.** Contents are guarded per room: every
  operation on a workspace checks one permission verb from the catalog
  against your role in *that* workspace (or its everyone-in-tenant
  setting). No role, no everyone-access → 403 naming the missing verb,
  whatever the UI showed. Roles are per-workspace: Owner of one, Viewer
  of another, stranger to the rest.
- **Two things are policy-controlled deployment-wide** (PRD 017; the
  defaults reproduce PRD 007 Reqs 10–11, so an untouched deployment
  behaves as it always did):
  1. **Reading the directory of room names.** Under the default
     `everyone` listing policy, the Open Workspace dialog lists every
     workspace's name and last-modified time to any signed-in user, so
     people can find a workspace and see whom to ask. Under `members`,
     the listing only shows workspaces the caller could actually open.
     Contents are never returned without access — only the label on
     the door.
  2. **Building new rooms.** Under the default `everyone` creation
     policy, any signed-in user may create a workspace and becomes its
     sole Owner. `members` excludes guests; `restricted` allows only
     admins and an explicit allow list. Refused users see New
     Workspace disabled with a one-line reason.

So the control levers, from coarse to fine:

| Lever | Controls | Where |
| --- | --- | --- |
| Tenant membership (create users, invite guests, remove them) | who can sign in at all | Entra ID → Users |
| Deployment admins (`MM_ADMINS`) | who may open the Management view and administer any workspace | App Service environment variable — a redeploy, never in-app |
| Creation policy (`everyone` / `members` / `restricted` + allow list) | who may create workspaces | Management → Settings |
| Listing policy (`everyone` / `members`) | whether non-members see workspace names in Open Workspace | Management → Settings |
| Workspace membership + roles (People section) | what each person may do per workspace | Settings… with the workspace open |
| Everyone-in-tenant toggle + default role | blanket access to one workspace | People section |
| Custom roles (Roles section) | the exact verb set a role grants | Settings… with the workspace open |

### Deployment admins

Users whose ids are listed in `MM_ADMINS` hold, in **every** workspace,
an implicit permission set on top of whatever their membership grants:
`doc.read`, `file.download`, `comment.read`, `workspace.settings`,
`workspace.members`, `workspace.roles` and `workspace.delete` (PRD 017
Req 4). In plain language: an admin can read any workspace and
administer it — membership, roles, settings, delete — but can never
*edit* content in a workspace they are not a member of. To edit, they
must first add themselves as a member in People, and that membership is
visible to the workspace's Owners there — visibility by membership is
the audit trail. While an admin views a workspace that grants them
nothing, a persistent banner says so.

## How the directory calls authenticate

Tenant user **search and avatars** (the membership picker) go to
Microsoft Graph, which only accepts tokens minted *for Graph* — never
the session bearer. So the server runs the **on-behalf-of exchange**
(`server/providers/azure/obo.ts`): it trades the caller's session
access token (the `api://<client-id>/access_as_user` one — Entra
refuses an id_token here with `AADSTS240002`) at the tenant token
endpoint for a delegated Graph token (`User.ReadBasic.All`), cached
per user for its validity window, and Graph is called with that. The
exchange authenticates with the registration's client secret
(`ENTRA_CLIENT_SECRET`) — the one
credential in the sign-in story the browser never sees. Guests of the
tenant come back marked as such and are badged in the People section,
and each member's display name is snapshotted into the workspace
manifest at add time, so member lists stay readable even when Graph
cannot answer. Setup:
[HOSTING-AZURE.md](HOSTING-AZURE.md) § 1.

## Where the pieces live

| Piece | File |
| --- | --- |
| Authorize URL, JWKS validation, iss/aud/scp pinning | `server/providers/azure/entra.ts` |
| On-behalf-of Graph token exchange (directory calls) | `server/providers/azure/obo.ts`, used by `server/providers/azure/graph.ts` |
| PKCE + state generation, callback parsing, token exchange | `src/lib/hostedAuth.ts` |
| Sign-in page / hosted marker | `src/components/HostedSignIn.tsx`, `server/app.ts` |
| Per-request auth guard | `server/providers/types.ts` (`AuthProvider`), used by `server/app.ts` |
| Roles and per-operation permission checks | `server/workspaces.ts`, reference in `server/README.md` |
| Local dev stand-in (mock users, no Microsoft) | `server/providers/mock/auth.ts` |
| Admin routes (`/api/admin/workspaces`, `/users`, `/settings`, `/invitations`) | `server/admin.ts` |
| Deployment settings (policies, parser, fail-closed defaults) | `src/lib/deploymentSettings.ts`, read/written by `server/deployment.ts` |
| Management view (Workspaces / People / Settings tabs) | `src/components/ManagementPanel.tsx` |
