# Spec: OBO exchange fails (400 invalid_request): Entra refuses the id_token as the jwt-bearer assertion — the SPA must obtain an access token for the app's own API (#184)

## Goal

All acceptance criteria in issue-specs/issue-184.md are satisfied for issue #184, with evidence visible in the session: the hosted-mode session bearer is an Entra access token for the app's own API (`api://<client id>/access_as_user`) rather than the id_token, the server validates that bearer (v2.0 issuer, `aud` = client id, `scp` includes `access_as_user`) and hands it to the OBO exchange as the assertion while an id_token bearer gets a clean 401, both hosting guides plus docs/AUTHENTICATION.md document the "Expose an API" registration step and the new bearer, and `npm run validate:quick` passes in the implementer's session with a summary comment posted on issue #184.

## Acceptance criteria

- The SPA requests the app's own API scope: the authorize redirect and the code
  exchange both carry `openid profile email api://<client id>/access_as_user`,
  and the session bearer stored/sent by the SPA is the resulting
  **access_token**, not the id_token. The scope string is stated in one place
  server-side (`buildAuthorizeUrl` in `server/providers/azure/entra.ts` today);
  it remains a single source of truth rather than being duplicated. The
  id_token may still be parsed client-side for display claims, but is never
  sent to the API as the bearer.
- The server validates the access token the same way it validates the id_token
  today (`jwtVerify` against the tenant JWKS, `iss` = tenant v2.0 issuer,
  `aud` = the bare client id) and additionally rejects tokens whose `scp` does
  not include `access_as_user`. Users are still identified by `oid`.
- A request bearing an id_token (an old tab from before this change) receives a
  clean 401 — not a 500 — so the client re-enters sign-in.
- The OBO exchange in `server/providers/azure/obo.ts` receives the validated
  access token as the `assertion`; the rest of `obo.ts` (grant, Graph scope,
  per-user cache keying) is unchanged.
- When the token endpoint refuses the exchange, `obo.ts` logs the response's
  `error_description` (the AADSTS code, e.g. `AADSTS240002 …`) — never the
  assertion or the client secret — so the log names the actual cause instead
  of a bare `400 (invalid_request)`.
- Both hosting guides gain the operator step that exposes the API on the app
  registration, with exact values: identifier URI `api://<client id>`, one
  delegated scope `access_as_user` (consentable by admins and users), and
  `requestedAccessTokenVersion: 2`. `docs/HOSTING-AZURE.md` § 1 shows the CLI
  form (`az ad app update --identifier-uris` plus the Graph PATCH of
  `api.oauth2PermissionScopes` / `api.requestedAccessTokenVersion`);
  `docs/HOSTING-AZURE-PORTAL.md` § 3 shows the portal form (**Expose an API →
  Add a scope**). `docs/AUTHENTICATION.md`'s sign-in dance names the access
  token as the session bearer.
- The `docs-hosting-llm` env-parity unit test
  (`tests/unit/docs-hosting-llm.test.ts`) stays green with no new environment
  variable introduced.
- Unit tests cover: the assertion handed to OBO is the access token, the `scp`
  check (accept with `access_as_user`, 401 without), and the AADSTS
  `error_description` logging. Local mock mode is unaffected.
- Iterate with `npm run typecheck` and `npm run test:unit` (or tests targeted
  at the changed code) after each change; baseline an attempt with the quick
  tier only. Run `npm run validate:quick` ONCE, right before declaring the
  goal met, and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #184.

## Context

Follow-up to #180 (member search / directory over Graph OBO), part of PRD
`prd/007-azure-hosted-workspaces.md`. The live failure: `src/lib/hostedAuth.ts`
returns `payload.id_token` as the session bearer, and
`server/providers/azure/obo.ts` forwards that bearer as the jwt-bearer
`assertion`; Entra answers `AADSTS240002` because id_tokens are not valid OBO
assertions. The registration currently exposes no API, so an app-audience
access token does not exist yet — hence the operator doc step is part of the
fix, not optional. Key files: `src/lib/hostedAuth.ts` (SPA scope + token
choice), `server/providers/azure/entra.ts` (`buildAuthorizeUrl`, session
`jwtVerify`), `server/providers/azure/obo.ts` (exchange + logging),
`server/providers/azure/graph.ts` (consumer of the exchange), the two hosting
guides, and `docs/AUTHENTICATION.md`. Real-tenant verification (the #180
acceptance list — search returns members and guests, ids resolve, avatars
load) cannot run in this sandbox; encode it in the docs and cover the token
plumbing with unit tests. This issue blocks the autocomplete part of #183.
