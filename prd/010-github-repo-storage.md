# PRD 010: GitHub-backed workspace storage

**Status:** Draft
**Date:** 2026-08-06

## Problem

Hosted Marky Mark (PRD 007) stores everything in Azure Blob Storage.
That was deliberately built behind a provider seam (`StorageProvider`,
8 path→bytes operations) with non-Azure backends named as the intended
extension point — but none exists. Two consequences hurt:

- **Deployment coupling.** An operator must provision an Azure storage
  account even when a plain git repo would do, and teams who live in
  GitHub cannot keep their docs where the rest of their work is.
- **Collaboration ceiling.** Blob writes are conditional-put only: any
  two people editing the same file see the Cancel/Overwrite/Reload
  conflict dialog on every overlapping save window, even when their
  edits don't touch the same lines. PRD 007 explicitly declared
  merge-free ETag semantics; a git-backed store can do better — commit,
  merge cleanly when edits don't collide, and only surface true
  conflicts.

The owner wants GitHub as a first-class backing store in two shapes:
(1) a deployment-default repo replacing blob storage wholesale, and
(2) "bring your own repo" — a team connects a workspace to their own
GitHub repo through a guided, restartable wizard.

## Goals

- An operator can deploy hosted Marky Mark with **no Azure storage at
  all**: a GitHub repo is the deployment's default backing store.
- Workspace creators can optionally **connect their own GitHub repo**;
  default-storage and BYO-repo workspaces coexist in one deployment,
  and which backend a default workspace uses is invisible to users.
- On git-backed workspaces, two people can edit **the same document
  concurrently** without dialogs as long as their edits don't collide;
  only true conflicts interrupt.
- A team's BYO repo stays **human-readable on GitHub**: normal markdown
  files at a root they chose, editable out-of-band, with out-of-band
  edits flowing back into the app naturally.
- No long-lived repo secrets are pasted into or stored by the app: the
  GitHub connection uses a GitHub App with short-lived installation
  tokens.
- Sign-in, roles, and the client platform protocol are untouched:
  GitHub is a storage credential, never an identity provider.

## Non-goals

- **Replacing or deprecating blob storage.** Blob remains a fully
  supported deployment default; this PRD adds a peer backend.
- **GitHub as sign-in.** Authentication stays Entra ID (azure mode) /
  mock (local mode). Workspace members never need GitHub accounts; only
  the repo admin performing a BYO install touches GitHub.
- **Per-user GitHub credentials.** All repo access is server-mediated
  through one installation per connection; there is no per-member OAuth
  and no PAT support in any mode.
- **In-app history, undelete, or version browsing.** Git retains
  history and teams can browse it on GitHub, but the app grows no UI
  for it. (Delete-confirmation copy is adjusted — see Req 21 — but no
  recovery feature ships.)
- **An in-app merge editor.** True conflicts keep the existing
  three-choice dialog (Req 12); conflict markers, pick-mine/pick-theirs
  UI, CRDTs, and real-time co-editing stay out.
- **Enforcing app roles against direct repo access.** For BYO
  workspaces, GitHub repo permissions are the real security boundary;
  in-app roles only govern what the app itself allows (Req 19). No
  detection or policing of out-of-band edits.
- **Other git hosts.** GitHub only — no GitLab, Bitbucket, or generic
  git remotes. The storage seam stays host-agnostic but only a GitHub
  provider ships.
- **Migration tooling.** No importer that moves existing blob-backed
  workspaces to a repo (or between repos). A workspace's backend is
  fixed at creation/connection.
- **GitHub Enterprise Server / custom API hosts.** github.com only.

## Requirements

### Backend model and configuration

1. The server gains a storage-backend knob, orthogonal to the existing
   `MM_MODE` auth/directory switch: the deployment default backend is
   either **blob** (today's provider, unchanged) or **github** (a repo
   the operator designates). Any other value refuses to start, matching
   existing config strictness.
2. The GitHub backend is a new `StorageProvider` implementation behind
   the existing seam. The REST API surface, path shapes, opaque ETag
   round-trip, opaque workspace ids, and `.mmkeep` folder markers are
   preserved so the client platform (`src/platform/hosted.ts`) works
   against it without protocol changes. No GitHub API calls are ever
   made from the client (SPEC11's fetch allowlist stands).
3. Each workspace records which backend backs it. Default-storage
   workspaces use the deployment default; BYO workspaces record their
   repo connection. Both kinds operate concurrently in one deployment,
   and nothing in the client UI reveals which backend a default
   workspace uses.
4. All GitHub access — mode 1 and mode 2 — authenticates via a
   **GitHub App** owned by the deployment: the operator registers it
   once and configures the server with its App ID and private key. The
   server mints short-lived installation tokens on demand; no PAT and
   no long-lived repo token is ever accepted, stored, or logged.
5. For mode 1, the operator installs the deployment's GitHub App on an
   operator-owned default repo and configures the server with that
   repo. The default repo mirrors today's storage layout on a single
   branch (`workspaces/<uuid>/…` and per-user `users/…` paths); it is
   app storage, not intended for human browsing.
6. Server startup validates the configured backend (repo reachable,
   App installation grants contents read/write) and fails fast with an
   actionable error, consistent with existing config validation.

### Git semantics (both modes)

7. Every mutating operation (file save, upload, rename, folder ops,
   manifest change, delete) lands as **one commit** on the workspace's
   branch. The commit's author line carries the signed-in user's
   display name; the committer is the app; the message names the action
   and path.
8. ETag semantics survive: reads return an opaque version token (e.g.
   derived from blob/commit SHA), stale conditional writes without
   merge eligibility fail with 412 exactly as today, and unconditional
   writes (no If-Match) remain deliberate overwrites.
9. Folder placeholders keep working: creating an empty folder in the
   app produces the existing `.mmkeep` marker as a committed file, and
   the client keeps hiding it.
10. Server-side caching of repo state is allowed and expected so that
    reads and permission checks do not pay a GitHub round trip per
    request; correctness is anchored on ref/SHA comparison, and the
    cache must never serve a write decision from stale state that the
    subsequent commit/push would not detect.
11. GitHub API rate-limit and transient-failure responses surface as
    the existing 5xx/notice pathway with actionable messages — never as
    silent data loss or a hung save.

### Merge-on-save

12. On git-backed workspaces, when a conditional save's base version is
    stale, the server attempts a **three-way merge** (base = the
    version the client loaded, ours = the client's text, theirs = the
    current head). If the merge is clean, the save succeeds: the merged
    text is committed, and the response tells the client the content
    was merged, returning the merged text and its new version token.
    If the merge conflicts, the save fails with the existing 412 and
    the client's Cancel/Overwrite/Reload dialog appears unchanged.
13. After a merged save, the editor refreshes to the merged text
    without losing cursor position unreasonably (best effort) and
    shows a non-blocking notice that changes from someone else were
    merged in. The buffer is clean (saved) at the merged state.
14. Blob-backed workspaces keep today's behavior verbatim: any stale
    conditional save → 412 → dialog. Merge-on-save is a git-backend
    capability, not a protocol change for blob.

### Bring your own repo (mode 2)

15. The new-workspace flow offers two choices: **default storage**
    (today's flow, unchanged fields) or **connect your GitHub repo**,
    which enters a multi-step wizard.
16. The wizard walks a repo admin through: (a) installing the
    deployment's GitHub App on their repo via GitHub's consent page —
    leaving and returning to the app; (b) picking the repo from the
    resulting installation; (c) picking a branch (default: the repo's
    default branch) and an optional subdirectory (default: repo root);
    (d) confirming. It is **restartable**: abandoning mid-flow (or the
    install round-trip failing) leaves resumable state, and re-entering
    the wizard continues or restarts cleanly rather than erroring.
17. A BYO workspace's files live directly at the chosen
    branch+subdirectory root as normal files, human-readable on
    GitHub. App metadata (the workspace manifest) lives under a
    `.marky-mark/` directory at that root. The workspace keeps an
    opaque app-side id; the repo connection is recorded server-side,
    not derived from the URL.
18. Workspace settings show the connection (repo, branch, root, App
    installation status) to members with settings permission, and let
    them re-run the wizard to reconnect (e.g. after an uninstall or a
    repo rename). Connection loss (app uninstalled, repo deleted,
    permissions revoked) surfaces as an actionable error state on open
    and save — never a silent hang or data loss.
19. Out-of-band edits (people pushing to the repo or editing on GitHub
    directly) are legitimate: the app picks them up on next read, and
    concurrent out-of-band changes flow through the same merge/conflict
    path as in-app saves (Req 12). Documented stance: GitHub repo
    permissions are the security boundary for BYO workspaces; in-app
    roles bound only what the app permits.

### Documentation and copy

20. The hosting guide (docs/HOSTING-AZURE.md or a sibling) gains the
    GitHub path: registering the deployment's GitHub App, configuring
    the server for a github default backend, installing on the default
    repo, and the BYO connection story — at the same operator-facing
    depth as the existing Azure walkthrough.
21. User-facing copy that promises unrecoverable deletion (delete
    confirmations and equivalents) is corrected for git-backed
    workspaces: deletion removes content from the app, but repo history
    retains it. Blob-backed copy is unchanged.

### Verification

22. Unit coverage exercises the GitHub provider against the existing
    provider contract tests (the in-memory reference provider's suite),
    plus the merge-on-save decision logic (clean merge, conflict, 412
    fallback) as pure functions where possible. E2e coverage exercises
    the new-workspace choice, the wizard happy path and restart, a
    merged concurrent save, and a conflicting concurrent save — against
    a local fake of the GitHub API (no test may depend on github.com).

## Open questions

- None.
