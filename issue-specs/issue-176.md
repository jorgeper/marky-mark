# Spec: Remove GitHub storage backend: server, client, tests, docs, residue guard (PRD 016 Reqs 1–6, 11–21) (#176)

## Goal

All acceptance criteria in issue-specs/issue-176.md are satisfied for issue #176, with evidence visible in the session: the GitHub storage backend is fully removed from server, client, tests, and docs per PRD 016 Reqs 1–6 and 11–19; a residue-guard unit test asserts no GitHub-storage token survives or creeps back (Req 20); `npm run validate:quick` prints `QUICK VALIDATION: ALL PASSED` in the implementer's session; and a summary comment from the implementer exists on issue #176.

## Acceptance criteria

Server — one backend (PRD 016 Reqs 1–6):

- Azure Blob Storage is the only storage backend. These files no longer exist: `server/providers/github/` (entire directory: auth, storage, byo, fake), `server/githubByo.ts`, `server/backends.ts`, `server/workspaceConnection.ts`, `server/workspaceCards.ts`, `server/e2eGithub.ts`, `server/e2eGithubLane.ts`. `createProviders` has no backend switch, no `createRepoConnector`, no `createGitHubByoApi`; `server/index.ts` performs no startup repo validation.
- `server/config.ts` reads neither `MM_STORAGE_BACKEND` nor any `MM_GITHUB_*` variable; `StorageBackend`, `loadGitHubConfig`, `GITHUB_BACKEND_REQUIRED` and the `AZURE_BLOB_REQUIRED`/`AZURE_REQUIRED` split are gone; azure mode requires the connection string and container exactly as PRD 007 did. Setting a removed variable has no effect and produces no error.
- `GET /api/workspaces` derives from manifests only; the server neither writes nor reads `backend.json`/`card.json` (pre-existing ones are ignored). Listing rows carry no `attention`/`retainsHistory`, and `WorkspaceListing` in `src/lib/workspaceLifecycle.ts` declares neither field.
- `POST /api/workspaces` has no `storage` field: the server does not read it, `readStorageField` is gone, and the create body type in `src/lib/hostedWorkspace.ts` no longer declares it.
- `/api/github/byo/*` and `/api/workspaces/<id>/connection` (GET and reconnect) no longer exist; requests to them take the ordinary not-found path.
- `server/providers/types.ts` is PRD 007's seam again: `asUser?()`, `readAtVersion?()` and `StoragePathError` (with its 400 mapping in `server/app.ts`) are removed. `createMemoryStorage()` and the contract suite remain, and the suite still runs against the memory provider.

Client removal (Reqs 11–13):

- These files no longer exist: `src/lib/githubConnectWizard.ts`, `src/components/GitHubRepoWizard.tsx`, `src/components/WorkspaceConnectionSettings.tsx`, `src/lib/workspaceConnection.ts`, `src/lib/deleteRetention.ts`. `src/platform/hostedWorkspaces.ts` has no `GitHubByoClient`, `Byo*` types, `byoCall`/`byoQuery`, `connection()`, or `reconnect()`. `src/App.tsx` has no wizard-return handling, `reconnectReturnTarget`, connection panel, or retention-aware delete copy. Pre-existing GitHub mentions unrelated to storage (About-dialog repository link, SPEC19 updater, `github-dark` theme, GFM fixtures) are untouched.
- The new-workspace flow in `src/components/WorkspaceSwitcher.tsx` matches PRD 007 Req 10 again: name and initial members/everyone-access only; no storage choice, no availability probe, no wizard resume.
- Delete confirmations are back to the two pre-PRD-010 cases: hosted workspaces/files say "This cannot be undone." (PRD 007 Req 12 copy) in the sidebar prompt and `WorkspaceDangerZone`; local trash wording unchanged; no "repository's history retains" variant anywhere in `src/`.

Documentation (Reqs 14–17):

- `docs/HOSTING-GITHUB.md` is deleted (nothing relocated — its LLM section already exists in `HOSTING-AZURE.md` §4). `tests/unit/docs-hosting-llm.test.ts` drops the GitHub guide from `GUIDES` and adds `docs/HOSTING-AZURE-PORTAL.md`, so the `MM_*` parity check covers both Azure walkthroughs.
- Every GitHub-storage cross-reference is removed: `HOSTING-AZURE-PORTAL.md` (§"Storing files in GitHub instead?", step-4 skip note, further-reading row), `HOSTING-AZURE.md` callout, `README.md` GitHub-backend lines, `docs/DEVELOPING.md` `server:github`/`MM_STORAGE_BACKEND` notes, `server/README.md` GitHub env/route/layout/security content, and `AGENTS.md`'s directory map (naming `HOSTING-AZURE` and `HOSTING-AZURE-PORTAL` as the two operator guides, within its size budget). The two Azure guides read as the complete operator story with no step mentioning, skipping for, or deferring to a second backend.
- `server/README.md` describes storage as blob-only and documents merge-on-save as a blob capability: the `PUT .../files/<path>` row states the optional base, the `200 { merged: true, content }` answer, and the 412 fallback; the passage saying a blob ETag cannot name bytes to merge from is gone. No new variable or Azure feature is introduced for merge-on-save.
- `prd/010-github-repo-storage.md` carries `**Status:** Superseded by PRD 016 (2026-08-29)` with its body otherwise untouched; `prd/007-azure-hosted-workspaces.md`'s "Real-time co-editing" non-goal has one added sentence noting PRD 016 added merge-on-save for non-colliding edits, true conflicts still reload-or-overwrite.

Verification and gate (Reqs 18–21):

- GitHub-only unit test files are deleted: `server-byo-layout`, `server-github-fake`, `server-github-storage`, `server-github-backend`, `server-github-byo`, `server-github-auth`, `github-connect-wizard`, `delete-retention`, `docs-hosting-github`, `workspace-connection`. `server-merge`, `server-merge-save`, `merged-save` are retained, pointed at the blob path (#175). `server-config.test.ts` and `server-workspaces.test.ts` have no backend/GitHub cases. The contract suite still runs for the memory provider and every non-GitHub test that imports it.
- `tests/e2e/github-storage.spec.ts` is deleted with E221–E223. E224 (merged concurrent save, no dialog, notice) and E225 (conflicting save, dialog) exist rewritten against the local hosted lane (mock auth + Azurite), keeping their E numbers. `playwright.config.ts` has one `webServer` entry and no `LANE_SERVER_PORT`; `package.json` has no `server:github` script; the lane-port comment in `tests/e2e/offsite.ts` is corrected. `E2E_TEST_FLOOR` in `scripts/validate.mjs` is re-pinned with PRD 016's rationale replacing E221–E223's.
- A residue-guard unit test exists asserting that no file under `server/`, `src/`, `tests/`, `docs/`, `scripts/`, plus `package.json` and the two Playwright configs, contains `MM_STORAGE_BACKEND`, `MM_GITHUB_`, `/api/github/`, `providers/github`, or `server:github` — narrow on purpose: SPEC9/SPEC19 GitHub Releases tooling and `api.github.com` in the updater stay legal.
- `docs/MAP.md` has been regenerated (`npm run map`) and is unchanged by the regeneration; the hosted server starts in local mode (`npm run server:local`) and in azure mode with only PRD 007's variables.
- Test economy: the implementer iterated with `npm run typecheck` and `npm run test:unit` (or tests targeted at the changed code), and ran `npm run validate:quick` ONCE, right before declaring the goal met — not after every small change and not as a start-of-attempt baseline. That single run printed `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #176.

## Context

PRD: `prd/016-cloud-storage-simplification.md` (Reqs 1–6, 11–21; Reqs 7–10 landed as #175 on this branch — merge-on-save on blob via client-supplied base, so E224/E225's merge semantics already work without GitHub). Parent: #173. This is surgical subtraction, not `git revert` — #113/#114/#115 landed on top of PRD 010; follow the PRD's inventory. The removals are interlocked by the doc-parity test (Req 14), the residue guard (Req 20), and the e2e floor (Req 19), so they land as one atomic change. PRD 010 code carries `PRD 010 Req <n>` comments instead of `SPEC<n>` citations — grep `PRD 010` to sweep for stragglers. The `StorageProvider` seam, `createMemoryStorage()`, the contract suite (`tests/unit/storage-contract.ts`), and the Azurite local lane are shared infrastructure and must stay.
