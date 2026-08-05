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
walkthrough (app registration, storage account, deployment) is PRD 007
Req 23, a separate issue; the environment reference is below.

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

`MM_MODE=azure` refuses to start with any of its required variables missing,
naming them all at once.

## API surface (scaffold)

Kept deliberately minimal — workspace manifest, roles, and permissions are
sibling issues. All endpoints except sign-in require
`Authorization: Bearer <token>` and answer `401` without it.

| Endpoint | Meaning |
| --- | --- |
| `POST /api/auth/sign-in` | Local: `{username}` → `{kind:'token', token, user}`. Azure: `{kind:'redirect', authorizeUrl}` for the SPA's PKCE flow. The only unauthenticated endpoint. |
| `GET /api/me` | The authenticated user. |
| `GET /api/files` (`?prefix=`) | List stored files (path, size, lastModified, etag). |
| `GET /api/files/<path>` | Read: `{path, content, etag}`, or 404. |
| `PUT /api/files/<path>` | Write body as content → `{path, etag}`. |
| `DELETE /api/files/<path>` | Delete; 404 when absent. |
| `GET /api/directory/search?q=` | Directory user search. |
| `GET /api/directory/users/<id>` | One directory user, or 404. |

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
- E2E (`npm run test:e2e`): `tests/e2e/hosted.spec.ts` boots this server in
  local mode via Playwright's `webServer` (E159+) — real HTTP against
  Azurite, zero Azure resources or network beyond localhost.
