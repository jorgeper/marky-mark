# Spec: Agent bridge gating and workspace-scoped agent tokens (experimental setting, MM_AGENT_BRIDGE, mint/list/revoke) (#364)

## Goal

All acceptance criteria in issue-specs/issue-364.md are satisfied for issue #364, with evidence visible in the session: the `agentBridge` experimental setting (default off, User scope, hosted-only capability) and the `MM_AGENT_BRIDGE` server flag each gate the feature so that with either off the client and API are unchanged (token routes 404, no agent UI rendered); with both on, a workspace member whose role carries `workspace.settings` can mint (plaintext shown exactly once, hash-only storage), list (label, created date) and revoke agent tokens from the Manage tab, backed by a reusable server token-auth helper whose workspace-scope checks and revocation are unit-tested; `npm run validate:quick` passes in the implementer's session; and a summary comment from the implementer exists on issue #364.

## Acceptance criteria

### Client gating (PRD 027 Req 1)

- `Settings` in `src/lib/settings.ts` has a new boolean key `agentBridge`, default `false`, scope `U`, listed in `EXPERIMENTAL_KEYS`, loaded with the same boolean tolerance as `semanticZoom` (a non-boolean stored value loads as `false`).
- The Experimental tab of `SettingsPanel` shows an "Agent bridge" row as one more `EXPERIMENTAL_FEATURES` data entry (test id `experimental-agent-bridge`), with a one-line description of what turning it on does. It carries a capability that is true only for the hosted platform (a new optional `Platform` flag, e.g. `agentBridge?: boolean`, set in `src/platform/hosted.ts` only); on desktop and the static web build the row shows an unavailable note and cannot be enabled, mirroring the `semanticZoom` capability pattern.
- With the setting off (the default), no agent-bridge UI exists anywhere: the Manage tab renders no agent-token section and the client makes no agent-token request. The gate reads the applied setting, so turning it on takes effect through the existing settings-save behaviour with no reload.

### Server gating (PRD 027 Req 2)

- `server/config.ts` parses `MM_AGENT_BRIDGE` into `ServerConfig.agentBridge: boolean` in both modes: unset, `''`, or `0` means off; `1` means on; any other value refuses to start with a message naming the variable (not its value's interpretation). `npm run server:local` honours the flag, so local mode (mock auth + Azurite) supports the feature.
- `createApp` in `server/app.ts` receives the flag (a new defaulted parameter or options field, so every existing caller wires byte-identically) and mounts the agent-token routes only when it is on. With the flag off, the routes answer the API's ordinary 404 and no token module code path runs on a request.
- `server/README.md`, `docs/HOSTING-AZURE.md` and `docs/HOSTING-AZURE-PORTAL.md` each gain a row for `MM_AGENT_BRIDGE` in their environment-variable tables (both modes, optional, default off, experimental).

### Token storage and the auth helper (PRD 027 Reqs 3+4)

- A new server module (e.g. `server/agentTokens.ts`) owns token minting, hashing, lookup and revocation through the existing `StorageProvider` seam only (no Azure specifics). Minting generates a token with at least 32 bytes of CSPRNG entropy, stores only a SHA-256 hash together with `{id, label, createdAt}` under the workspace's own prefix (`workspaces/<id>/…`, so deleting the workspace already removes its tokens), and returns the plaintext exactly once to the caller.
- The module exports a token-auth helper that resolves a presented token to `{workspaceId, tokenId}` or to `null` for an unknown or revoked token, with a single storage read per call (no scan across all workspaces; e.g. the token text carries the workspace id and the hash names the blob) and no in-memory cache, so revocation takes effect on the next request that presents the token.
- The module exports a scope check that, given a resolved token and a target workspace id (and, for file paths, a path), answers an explicit authorization error shape (a stable error code/message, e.g. `agent token not authorized for this workspace`) for any workspace other than the token's own or any path outside `workspaces/<id>/`. Later sub-issues (#365 MCP endpoint, session tools) consume these helpers and must not add a second auth path; the module's doc comment says so.
- No code path logs a token or a token hash, and no API response after mint carries the plaintext (list rows carry only `id`, `label`, `createdAt`).

### Routes (PRD 027 Req 3)

- Under the flag, `server/workspaces.ts` (or a sibling mounted from it) serves `POST /api/workspaces/<id>/agent-tokens` (body `{label}`, answers 201 `{id, label, createdAt, token}`), `GET /api/workspaces/<id>/agent-tokens` (answers the row list without plaintext) and `DELETE /api/workspaces/<id>/agent-tokens/<tokenId>` (204; 404 for an unknown id). Every one of them goes through the existing `requirePermission` gate with `workspace.settings`, so the deployment-admin union of PRD 017 applies and any other member gets the usual 403. An empty or non-string label is a 400. The routes are added to `WORKSPACE_ROUTE_PERMISSIONS` so the existing drift test covers them.

### Workspace UI (PRD 027 Req 3)

- The Manage tab (`WorkspaceSettingsTab` in `src/components/WorkspaceAccessSettings.tsx`) renders a new "Agent tokens" section (a `SectionHeader`, test id `agent-tokens-section`) only when the applied `agentBridge` setting is on and the caller's permissions include `workspace.settings`. It offers a label input and a Mint button (`agent-token-label`, `agent-token-mint`), shows the freshly minted plaintext once in a copyable field (`agent-token-plaintext`) that disappears when the section re-lists or the panel closes, lists existing tokens as rows with label and created date (`agent-token-row`), and each row has a Revoke control (`agent-token-revoke`) that removes it after the server confirms.
- All three calls go through new methods on `WorkspaceLifecycle` in `src/platform/hostedWorkspaces.ts` (e.g. `listAgentTokens`, `mintAgentToken`, `revokeAgentToken`) that reuse that file's existing fetch wrapper; no new `fetch(` call site is added anywhere in `src/`, so the bundle-scan count in `scripts/validate.mjs` is unchanged.
- When the setting is on but the server flag is off (the list answers 404), the section shows a short "not enabled on this deployment" note (`agent-tokens-unavailable`) instead of an error and offers no mint control.
- New chrome follows `docs/STYLE-GUIDE.md` (tokens, `.btn*` wrappers, `SectionHeader`); the style lint in the quick gate passes.

### Tests

- Unit tests, `U<n>:` numbered from the next unused id, cover: config parsing of `MM_AGENT_BRIDGE` (off/on/refusal, both modes) in `tests/unit/server-config.test.ts`; the token module (mint returns plaintext once and stores only a hash; resolve succeeds for a live token, fails for unknown and revoked tokens; scope check refuses another workspace and an out-of-prefix path; response shapes carry no plaintext) against `createMemoryStorage`; route gating at the HTTP layer via `createApp` (404 with the flag off, 201/200/204 with it on, 403 for a member without `workspace.settings`, 401 unauthenticated); the settings key (default false, in `EXPERIMENTAL_KEYS`, U-scoped, never workspace-pinnable) in the settings test files.
- The e2e lane runs the hosted server with the flag on: `playwright.config.ts` adds `MM_AGENT_BRIDGE: '1'` to the `server:local` webServer env. New `E<n>:` tests in `tests/e2e/hosted.spec.ts`, numbered from the next unused id, prove: with the setting off, the Manage tab shows no `agent-tokens-section`; with the setting on, an Owner mints a token and the plaintext appears once, the list then shows the label and a created date and not the plaintext, and revoking removes the row and the GET route no longer lists it; a member whose role lacks `workspace.settings` sees no section. Flag-off behaviour is proven by the unit-level `createApp` test (the lane cannot run two server configurations).
- No existing test is weakened, renamed, skipped or renumbered; test ids stay unique.

### Process

- New behaviour carries citation comments per `.sandcastle/CODING_STANDARDS.md` (`// PRD 027 Req n: …`). If any `SPEC<n>` citation moved, `npm run map` has been run and `docs/MAP.md` is committed unchanged from what the generator produces.
- The implementer iterates with `npm run typecheck` and `npm run test:unit` (or targeted tests such as `npx vitest run tests/unit/server-config.test.ts` and `npx playwright test -g '<title>'`), baselining at the start with the quick pair only.
- `npm run validate:quick` has been run once in the implementer's session, right before declaring the goal met, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #364 describing what landed, the new test ids, and the validate:quick evidence.

## Context

- PRD: `prd/027-mcp-workspace-control.md` (Reqs 1 to 4 are this issue; Reqs 5+ are sibling issues #363, #365 to #368 and must not be started here: no MCP endpoint, no WebSocket, no session tools, no setup docs page).
- Settings precedent: `semanticZoom` and `fluidMode` in `src/lib/settings.ts` (`DEFAULT_SETTINGS`, `SCOPE`, `EXPERIMENTAL_KEYS`, the parse block near line 494) and the `EXPERIMENTAL_FEATURES` data table plus `ExperimentalCapabilities` in `src/components/SettingsPanel.tsx`. `Platform.semanticZoom` in `src/platform/types.ts` is the capability-flag precedent; the new flag is set only in `src/platform/hosted.ts`.
- Server precedent: `loadAdmins` / `LLM_ENV_VARS` in `server/config.ts` for env parsing and refusals; `requirePermission`, `WORKSPACES_PREFIX`, `manifestBlob` and `WORKSPACE_ROUTE_PERMISSIONS` in `server/workspaces.ts`; `createApp` in `server/app.ts` is called from `server/index.ts` and from `tests/unit/server-workspaces.test.ts` (in-process HTTP against `createMemoryStorage` from `tests/unit/storage-contract.ts`).
- Client precedent: `WorkspaceLifecycle` and its single fetch wrapper in `src/platform/hostedWorkspaces.ts`; `useWorkspaceAccess` / `WorkspaceSettingsTab` in `src/components/WorkspaceAccessSettings.tsx`; `WorkspaceMembers.tsx` for a permission-gated section with rows and actions.
- E2E precedent: `tests/e2e/hosted.spec.ts` helpers `signInTo`, `createWorkspace`, `workspaceWithRole`, `openWorkspaceSettings`; `openSettings(page, 'experimental')` and `saveSettings` in `tests/e2e/helpers.ts`; `experimental-semantic-zoom` toggling in `tests/e2e/semantic-zoom.spec.ts`. Next unused ids at spec time: E647, U1383 (re-check with grep before numbering).
- Constraints: no `console.*` in `src/`; `src/lib/` stays host-free; `src/platform/tauri.ts` and `web.ts` need no change beyond the optional capability flag staying absent; secrets never in logs (the `MM_LLM_API_KEY` rule in `server/config.ts` is the model).
