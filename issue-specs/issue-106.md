# Spec: Operator hosting guide for the GitHub backend, and delete-copy correction for git-backed workspaces (#106)

## Goal

All acceptance criteria in issue-specs/issue-106.md are satisfied for issue
#106, with evidence visible in the session: an operator-facing GitHub hosting
walkthrough exists at the depth of the Azure one (App registration, github
default backend config, default-repo install, BYO story) and is linked from
the repo's doc pointers; delete copy on git-backed workspaces says history is
retained while blob-backed and desktop copy is byte-identical to today;
`npm run validate:quick` was run once at the end and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #106.

## Acceptance criteria

### Req 20 — the operator hosting guide

- An operator-facing GitHub walkthrough exists, either as a sibling document
  (`docs/HOSTING-GITHUB.md`) or as a clearly-scoped part of
  `docs/HOSTING-AZURE.md`, at the same depth as the existing Azure walkthrough
  (numbered steps, exact values, copy-pasteable commands/settings where the
  Azure guide has them) — not a paragraph of prose pointing at
  `server/README.md`.
- The guide covers registering the deployment's **GitHub App**: the repository
  permission it must grant (**Contents: Read and write**), the **Setup URL**
  GitHub returns the connect wizard to (the deployment origin — GitHub appends
  `installation_id`, `setup_action` and the echoed `state`; see
  `readGitHubReturn` in `src/lib/githubConnectWizard.ts`), the App slug, and how
  the PEM private key is carried as an App Service app setting (literal or
  `\n`-escaped newlines). It states plainly that the App private key is the only
  GitHub credential the server accepts — no PAT, no long-lived repo token.
- The guide covers configuring the server for a **github default backend**:
  `MM_STORAGE_BACKEND=github` plus the variables `GITHUB_BACKEND_REQUIRED` in
  `server/config.ts` demands (`MM_GITHUB_APP_ID`, `MM_GITHUB_PRIVATE_KEY`,
  `MM_GITHUB_DEFAULT_REPO`) and the optional ones with their real defaults
  (`MM_GITHUB_DEFAULT_BRANCH`, `MM_GITHUB_DEFAULT_ROOT`, `MM_GITHUB_APP_SLUG`,
  `MM_GITHUB_WEB_BASE`, `MM_GITHUB_API_BASE`), plus **installing the App on the
  operator-owned default repo** and what that repo then holds
  (`workspaces/<uuid>/…`, `users/…` — app storage, not for human browsing).
- The guide covers the **BYO connection story** operators must support: what a
  team admin does (New Workspace → connect your GitHub repo → App install
  consent → repo/branch/subdirectory), that `MM_GITHUB_APP_SLUG` is what makes
  that choice available at all, that a BYO workspace's files are human-readable
  at the chosen root with app metadata under `.marky-mark/`, that reconnect
  lives in Workspace settings for holders of `workspace.settings`, and the
  documented stance that **GitHub repo permissions are the security boundary**
  for BYO workspaces while in-app roles bound only what the app permits.
- The guide states the orthogonality that trips operators up: the backend knob
  is independent of `MM_MODE`; a github-backend deployment needs **no Azure
  storage account** and never reads `AZURE_STORAGE_CONNECTION_STRING`, while
  `MM_MODE=azure` still requires Entra sign-in config. It also documents the
  fail-fast startup check (unreachable repo, or an installation without
  Contents: Read and write, exits non-zero naming which) and operator-level
  troubleshooting for the live failure states — App uninstalled, repo renamed
  or deleted, permissions revoked, rate limit exhausted — matching the
  400-vs-502 split `server/workspaceConnection.ts` already implements.
- Every environment variable name, default and required/optional marking in the
  guide matches `server/config.ts` and the table in `server/README.md`; no
  variable that does not exist is named.
- A unit test guards the guide against drift, in the style of U147
  (`tests/unit/comment-format.test.ts`, which asserts `docs/COMMENT-FORMAT.md`
  still describes the build): at minimum, every variable in
  `GITHUB_BACKEND_REQUIRED` appears in the guide, and the guide's document path
  is asserted to exist.
- The guide is discoverable from the places that index docs: `README.md`,
  `docs/DEVELOPING.md`, the `docs/HOSTING-AZURE.md` storage section, and the
  docs sentence in `AGENTS.md` (`CLAUDE.md` is a symlink to it and must keep
  resolving). `AGENTS.md` stays a map of pointers within its ~150-line budget.

### Req 21 — delete copy on git-backed workspaces

- On a **git-backed** hosted workspace (deployment default `github`, or a BYO
  repo workspace), user-facing copy that today promises unrecoverable deletion
  no longer does: the sidebar file/folder delete prompt (`folder-delete-prompt`
  in `src/App.tsx`, driven by `platform.permanentDelete`) and the workspace
  Danger Zone (`src/components/WorkspaceDangerZone.tsx`) say that deleting
  removes the content from the app while the repository's history retains it —
  without promising any in-app recovery, undelete or version browsing (PRD 010
  non-goals).
- On a **blob-backed** hosted workspace the strings are byte-identical to
  today's (`Permanently delete “…”? This cannot be undone.` and
  `Deleting “…” permanently removes its documents, comments and images for
  everyone. This cannot be undone.`), and the desktop/web non-hosted copy
  (`Move to Trash`) is untouched.
- Which copy appears is decided from server-supplied per-workspace state: it is
  available to **any member who can delete** (so it must not be gated on
  `workspace.settings` the way `GET /api/workspaces/<id>/connection` is), costs
  no GitHub round trip per prompt, and reveals nothing about a default-storage
  workspace beyond the retention fact — PRD 010 Req 3 (which backend a default
  workspace uses stays invisible) still holds, so no repo, owner, branch or the
  word "GitHub" appears in default-storage copy.
- The wording decision is a pure function in `src/lib/` with unit tests
  continuing the repo's `U<n>` numbering, covering git-backed, blob-backed and
  desktop cases; the components render what it returns (house style: pure
  module + thin shell, as `workspaceConnection.ts` /
  `WorkspaceConnectionSettings.tsx` do). No component-level test harness is
  introduced.
- Adjacent documentation that asserts the same now-wrong promise is corrected
  for the github backend: `server/README.md`'s folder-delete row (`PERMANENT —
  there is no trash and no version history`) and the `permanentDelete` comments
  in `src/platform/hosted.ts` / `src/platform/types.ts` describe both backends
  accurately.
- New and changed code and doc sections carry citation comments naming the
  contract (`PRD 010 Req 20`, `PRD 010 Req 21`) per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`.

### Process and verification

- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or vitest targeted at the changed modules) — not the full gate after each
  change, and no full-gate baseline at the start of the attempt.
- `npm run validate:quick` was run **once**, right before declaring the goal
  met, and printed `QUICK VALIDATION: ALL PASSED` in the session. Existing e2e
  delete tests still pass unchanged, since blob-backed copy did not move.
- The work is committed on branch `sandcastle/issue-106` with a message naming
  the issue and the requirements (e.g. `RALPH: … (issue #106, PRD 010 Req
  20+21)`).
- A summary comment from the implementer exists on issue #106, naming the guide
  path, the copy decision and the gate result. The issue body and title are not
  edited.

## Context

PRD: `prd/010-github-repo-storage.md` (Reqs 20 and 21; parent issue #97). This
is the documentation-and-copy tail of the effort — the backend itself already
landed: `MM_STORAGE_BACKEND` and the config loader in `server/config.ts`, the
provider in `server/providers/github/` (with `fake.ts`, the local GitHub API
fake every GitHub test runs against — no test may reach github.com),
per-workspace backend records in `server/backends.ts`, the wizard in
`src/lib/githubConnectWizard.ts` + `src/components/GitHubRepoWizard.tsx`, and
the connection surface in `server/workspaceConnection.ts` +
`src/lib/workspaceConnection.ts`. The environment reference already exists as a
table in `server/README.md` (§ Environment variables) — the hosting guide is
the operator *walkthrough* around it, not a second copy of the table.

`docs/HOSTING-AZURE.md` is the shape to match: numbered sections 1–6 (Entra
registration → storage account → deployment payload → App Service → custom
domain → verification) plus Known limitations, Troubleshooting and Running it
locally. Whether the GitHub path is a sibling file or a section is the
implementer's call; a sibling keeps the Azure guide's title honest but then
needs the pointer updates listed above.

For Req 21 the interesting part is plumbing, not prose: `permanentDelete` is
today a static `true` on the hosted platform (`src/platform/hosted.ts`), so
per-workspace truth has to reach the client from the server through a path any
deleting member can read — the manifest/listing responses are the natural
carriers, `GET /api/workspaces/<id>/connection` is not (it needs
`workspace.settings` and answers `{connected:false}` for default-storage
workspaces by design). Note the tension worth resolving explicitly in a
comment: Req 3 keeps a default workspace's backend invisible, so the corrected
copy should state the retention fact without naming GitHub or the repo.

Unit tests are pure-module only (`tests/unit/*.test.ts`, no `.tsx`), so express
the copy rule as a function to test. Grep `PRD 010` and `SPEC` citations to
land in the right files rather than reading `src/App.tsx` whole.
