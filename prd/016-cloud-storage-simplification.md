# PRD 016: Cloud storage simplification — blob only, merge-on-save kept

**Status:** Draft
**Date:** 2026-08-29

Issue: #173.

## Problem

PRD 007 gave hosted Marky Mark one store: a per-workspace prefix in Azure
Blob Storage behind a small `StorageProvider` seam, deployable with a
storage account and a connection string. PRD 010 then added a second
backend — a GitHub repo driven through a GitHub App — plus everything a
second backend drags in: a `MM_STORAGE_BACKEND` knob and eight
`MM_GITHUB_*` variables, per-workspace `backend.json`/`card.json`
records beside the manifest, a five-route bring-your-own-repo wizard, a
connection-settings panel with reconnect, a "needs attention" listing
state, a history-aware delete prompt, a 764-line fake of the GitHub API,
a second Playwright lane, and a 435-line operator guide. Nine issues
(#99–#107), ~12,400 lines across 74 files, none of it cited by a
`SPEC<n>` — the code carries `PRD 010 Req <n>` comments instead.

The owner no longer wants any of it. The hosted flavor should be what
PRD 007 described: blob storage, one hosting story, nothing to choose.
The one PRD 010 idea worth keeping is merge-on-save — two people editing
different parts of the same document should not be thrown into the
Cancel/Overwrite/Reload dialog. PRD 010 made that a git-only capability
because the git provider could read the client's base version back from
a commit; on blob there is no history, so this PRD moves the base to
where it already lives: the client.

This is a subtraction, not a restoration. `server/providers/azure/blob.ts`
was not touched by PRD 010 and `MM_STORAGE_BACKEND` already defaults to
`blob`; the work is removing the second path and re-homing the merge.
A `git revert` of the PRD 010 commits is not viable — #113 (hosted LLM
proxy), #114 (no-network rewrite) and #115 (summary cache) landed on top
of them — so the removal is surgical, guided by the inventory in this
PRD's grilling session (2026-08-29).

## Goals

- The hosted flavor has exactly one storage backend, Azure Blob Storage
  (Azurite locally), configured exactly as PRD 007 configured it.
- No trace of GitHub-as-storage remains in `server/`, `src/`, `tests/`,
  `docs/`, `package.json`, or the Playwright config — and a guard keeps
  it from creeping back.
- Merge-on-save survives on blob: a stale conditional save whose edits
  do not collide with the newer server text lands merged, with the
  existing "changes from someone else were merged in" notice and no
  dialog; true conflicts still get the PRD 007 dialog.
- The `StorageProvider` seam, the in-memory reference provider, its
  contract suite, and the Azurite local lane stay — they are how the
  hosted flavor is developed and tested with zero Azure resources.
- A deployment that ran the PRD 010 build keeps working on the new
  build with no operator action beyond deploying it.

## Non-goals

- **Migration tooling.** No script copies a GitHub-backed workspace's
  files into blob. Such a workspace stops appearing in the list; its
  files stay in the repo for the operator to copy in by hand.
- **Cleaning stray records.** `backend.json` / `card.json` blobs left by
  the PRD 010 build are inert and left in place; no startup sweep.
- **A storage knob of any kind.** `MM_STORAGE_BACKEND` is removed, not
  narrowed to `blob`. A future backend would reintroduce a knob then.
- **Any other backend, GitHub sign-in, or per-user GitHub credentials.**
- **Server-side history.** No Azure Blob versioning, no snapshot cache,
  no version browsing. The client is the only source of the merge base.
- **An in-app merge editor.** Conflicting saves keep the three-choice
  dialog; no conflict markers, pick-mine/pick-theirs, CRDTs, or
  real-time co-editing.
- **Changing comment-sidecar merge semantics.** Sidecars go through the
  same save path and the same structured-file guard they do today.
- **Consolidating `HOSTING-AZURE.md` and `HOSTING-AZURE-PORTAL.md`.**
  Both Azure guides stay; only their GitHub cross-references go.
- **Manifest schema changes.** `MANIFEST_VERSION` stays 1; PRD 010 never
  added a manifest field and this PRD adds none.
- **Removing the seam.** `StorageProvider`, `createMemoryStorage()`, the
  contract suite (`tests/unit/storage-contract.ts`), `server/devSpa.ts`
  and `server/contentTypes.ts` are shared infrastructure that PRD 010
  happened to introduce or extract; they stay.
- **Deleting PRD 010.** `prd/` is the record; the file stays, marked
  superseded.
- **The desktop and static-web flavors.** Untouched.

## Requirements

### Server: one backend

1. Azure Blob Storage is the only storage backend. `server/providers/github/`
   (auth, storage, byo, fake), `server/githubByo.ts`, `server/backends.ts`,
   `server/workspaceConnection.ts`, `server/workspaceCards.ts`,
   `server/e2eGithub.ts` and
   `server/e2eGithubLane.ts` are deleted. `createProviders` has no
   backend switch, no `createRepoConnector`, no `createGitHubByoApi`;
   `server/index.ts` performs no startup repo validation.
2. `server/config.ts` no longer reads `MM_STORAGE_BACKEND` or any
   `MM_GITHUB_*` variable (`APP_ID`, `PRIVATE_KEY`, `DEFAULT_REPO`,
   `DEFAULT_BRANCH`, `DEFAULT_ROOT`, `APP_SLUG`, `API_BASE`, `WEB_BASE`).
   The `StorageBackend` type, `loadGitHubConfig`, `GITHUB_BACKEND_REQUIRED`
   and the `AZURE_BLOB_REQUIRED`/`AZURE_REQUIRED` split are gone; azure
   mode requires the storage connection string and container exactly as
   PRD 007 did. Setting a removed variable has no effect and produces no
   error (it is an unknown variable like any other).
3. The workspace listing (`GET /api/workspaces`) is derived from
   manifests only. The server neither writes nor reads
   `workspaces/<id>/backend.json` or `card.json`; pre-existing ones are
   ignored. Listing rows carry no `attention` and no `retainsHistory`
   field, and `WorkspaceListing` in `src/lib/workspaceLifecycle.ts`
   loses both.
4. `POST /api/workspaces` has no `storage` field: the server does not
   read it, `readStorageField` is gone, and the create body type in
   `src/lib/hostedWorkspace.ts` no longer declares it.
5. The routes `/api/github/byo/*` and `/api/workspaces/<id>/connection`
   (GET and reconnect) no longer exist; a request to any of them takes
   the server's ordinary not-found path.
6. The `StorageProvider` seam in `server/providers/types.ts` is PRD 007's
   again: the optional `asUser?()` and `readAtVersion?()` members and
   `StoragePathError` (with its 400 mapping in `server/app.ts`) are
   removed. `createMemoryStorage()` and the contract suite stay and the
   suite still runs against the memory provider.

### Merge-on-save on blob

7. A conditional document save (`PUT` with `If-Match`) may carry the
   **base text** — the content the client loaded at the version named by
   `If-Match` — in the same request (for example a JSON body
   `{ content, base }` distinguished from the bare-text body by
   `Content-Type`; the exact wire shape is the implementer's). A save
   without base behaves exactly as PRD 007 Req 20: match → write, stale
   → 412, no `If-Match` → deliberate overwrite. The request-size limit
   applies to the whole body.
8. When `If-Match` is stale and base is present, the server performs the
   existing three-way line merge (base, ours = the request's content,
   theirs = the current blob). A clean merge that passes the existing
   structured-file guard (`mergeKeepsFileWellFormed`) is written with
   `If-Match` on the head's ETag, retrying a bounded number of times if
   the head moves again, and answers `200 { path, etag, merged: true,
   content }` with the merged text. A conflicting merge, a guard failure,
   or exhausted retries answer the existing 412 with the stored content
   untouched. Never an unconditional write. The server trusts the
   client's base: a client that lies about base could at most produce a
   write it could already have produced with an unconditional save.
9. The hosted platform (`src/platform/hosted.ts`) sends base on every
   conditional save of a document it loaded, and keeps handling the
   `merged: true` response as today: the buffer becomes the merged text,
   is marked clean at that text, the selection is clamped best-effort,
   the `MERGED_SAVE_NOTICE` shows, and no dialog appears
   (`src/lib/mergedSave.ts` and `WriteResult` in `src/platform/types.ts`
   stay). A 412 still raises `SaveConflictError` and the
   Cancel/Overwrite/Reload dialog.
10. The pure merge (`mergeThreeWay` and the guard) survives as a unit-tested
    module with its existing coverage (clean merge, conflict, guard
    refusal); only the git-specific plumbing around it goes.

### Client removal

11. `src/lib/githubConnectWizard.ts`, `src/components/GitHubRepoWizard.tsx`,
    `src/components/WorkspaceConnectionSettings.tsx`,
    `src/lib/workspaceConnection.ts` and `src/lib/deleteRetention.ts` are
    deleted. `src/platform/hostedWorkspaces.ts` loses the `GitHubByoClient`,
    `Byo*` types, `byoCall`/`byoQuery`, `connection()` and `reconnect()`.
    `src/App.tsx` loses the wizard-return handling, `reconnectReturnTarget`,
    the connection panel, and the retention-aware delete copy; the
    About-dialog repository link and every other pre-existing GitHub
    mention in `src/` (SPEC19 updater, `github-dark` theme, GFM fixtures)
    are untouched.
12. The new-workspace flow in `src/components/WorkspaceSwitcher.tsx` is
    PRD 007 Req 10 again: name and initial members/everyone-access; no
    storage choice, no availability probe, no wizard resume.
13. Delete confirmations return to the two pre-PRD 010 cases. Hosted
    workspaces and files say "This cannot be undone." (PRD 007 Req 12
    copy) in the sidebar prompt and `WorkspaceDangerZone`; the local
    trash wording is unchanged. No "repository's history retains" variant
    exists anywhere in `src/`.

### Documentation

14. `docs/HOSTING-GITHUB.md` is deleted. Its "The deployment's LLM
    provider (optional)" section already exists in `docs/HOSTING-AZURE.md`
    (§4), so nothing is relocated; `tests/unit/docs-hosting-llm.test.ts`
    drops the GitHub guide from its `GUIDES` list and keeps asserting
    against the Azure guide.
15. Every GitHub-storage cross-reference is removed: `HOSTING-AZURE-PORTAL.md`
    (§"Storing files in GitHub instead?", the step-4 skip note, the
    further-reading row), `HOSTING-AZURE.md` (the "github-backend
    deployment skips it" callout), `README.md`'s GitHub-backend lines,
    `docs/DEVELOPING.md`'s `server:github` / `MM_STORAGE_BACKEND` notes,
    `server/README.md`'s GitHub env, route, layout and security-posture
    content, and `AGENTS.md`'s directory map, which now names
    `HOSTING-AZURE` and `HOSTING-AZURE-PORTAL` as the two operator guides
    (CLI and portal walkthroughs of the one backend). `AGENTS.md` stays
    within its size budget.
16. `prd/010-github-repo-storage.md`'s status line becomes
    `**Status:** Superseded by PRD 016 (2026-08-29)`; its body is left
    as written. `prd/007-azure-hosted-workspaces.md`'s "Real-time
    co-editing" non-goal gains one sentence noting that merge-on-save
    for non-colliding edits was added by PRD 016 and that true conflicts
    still use reload-or-overwrite.

### Verification and gate

17. The GitHub-only unit files are deleted: `server-byo-layout`,
    `server-github-fake`, `server-github-storage`, `server-github-backend`,
    `server-github-byo`, `server-github-auth`, `github-connect-wizard`,
    `delete-retention`, `docs-hosting-github`, `workspace-connection`.
    `server-merge`, `server-merge-save` and `merged-save` are retained and
    re-pointed at the blob path (Req 7–10). `server-config.test.ts` and
    `server-workspaces.test.ts` lose their backend/GitHub cases. The
    contract suite still runs for the memory provider and for every
    non-GitHub test that imports it (`server-workspaces`, `server-llm`,
    `server-summary-cache`).
18. `tests/e2e/github-storage.spec.ts` is deleted with E221–E223. E224
    (merged concurrent save, no dialog, notice shown) and E225
    (conflicting concurrent save, dialog shown) are rewritten against the
    existing local hosted lane (mock auth + Azurite) and keep their E
    numbers. `playwright.config.ts` loses the second `webServer` entry and
    the `LANE_SERVER_PORT` import; `package.json` loses `server:github`;
    `tests/e2e/offsite.ts`'s lane-port comment is corrected.
    `E2E_TEST_FLOOR` in `scripts/validate.mjs` is re-pinned to the new
    count with the E221–E223 rationale replaced by this PRD's.
19. A residue guard: a unit test asserts that no file under `server/`,
    `src/`, `tests/`, `docs/`, `scripts/`, plus `package.json` and the
    two Playwright configs, contains `MM_STORAGE_BACKEND`, `MM_GITHUB_`,
    `/api/github/`, `providers/github`, or `server:github`. The pattern
    list is deliberately narrow so the SPEC9/SPEC19 GitHub Releases
    tooling and `api.github.com` in the updater stay legal.
20. `npm run typecheck`, `npm run test:unit`, and `npm run validate:quick`
    (`QUICK VALIDATION: ALL PASSED`) pass; the hosted server starts in
    local mode (`npm run server:local`) and in azure mode with only PRD
    007's variables set. `docs/MAP.md` is regenerated (`npm run map`) and
    unchanged, since PRD 010 owned no spec rows.

## Open questions

- None — decisions above were settled in the issue #173 grilling session
  (2026-08-29): remove all five PRD 010 deliverables but keep merge-on-save
  on blob; base comes from the client; no migration; the knob is removed
  outright; PRD 010 is marked superseded.
