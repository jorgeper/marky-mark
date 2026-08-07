# Spec: BYO repo connection model: server-side connection record and human-readable repo layout (#103)

## Goal

All acceptance criteria in issue-specs/issue-103.md are satisfied for issue
#103, with evidence visible in the session: a workspace can be backed by a
server-side repo connection record (`{kind: 'repo', owner, repo, branch, root?}`)
that #101's resolver turns into a live GitHub-backed provider; that workspace's
documents live at the connected `branch`+`root` as **normal markdown files**
readable on GitHub, with the manifest under `<root>/.marky-mark/` and never
listed as a workspace file; the workspace id stays an opaque app-side UUID with
the connection recorded server-side and derivable from no URL, id or client
payload; BYO and default-storage workspaces coexist in one deployment (both
listed, opened, saved and deleted correctly); `npm run validate:quick` passes in
the implementer's session; and a summary comment from the implementer exists on
issue #103.

## Acceptance criteria

### The connection record becomes a live backend (Req 17)

- `createWorkspaceBackends`'s `connect` hook (`server/backends.ts`, deliberately
  left unset by #101) is supplied where the backends are wired
  (`server/app.ts` / `server/index.ts`): a `{kind: 'repo', owner, repo, branch,
  root?}` record resolves to a GitHub-backed `StorageProvider` for that
  workspace. No new plumbing in `server/workspaces.ts` request handling — it
  already resolves storage per workspace through `backends.forWorkspace(id)`.
- The connection is built from #100's `createGitHubStorageProvider` plus the
  deployment's App auth (`createGitHubAppAuth` from `config.github`), not a
  second GitHub client. The record supplies owner/repo/branch/root; the
  credential never comes from the record.
- BYO works **independently of the deployment default**: a `blob`-default
  deployment with the App section configured (`MM_GITHUB_APP_ID`,
  `MM_GITHUB_PRIVATE_KEY`) serves repo-backed workspaces alongside blob ones.
  A repo record on a deployment with **no** App configuration keeps #101's
  named error (`workspace <id> names a repo backend this deployment cannot
  connect to`) rather than crashing or silently falling back to the default.
- Connections are **reused, not rebuilt per request**: resolving the same
  workspace twice returns a provider that shares #100's installation token and
  branch-snapshot cache (e.g. a keyed cache on owner/repo/branch/root). Pinned
  by a test asserting the request count against the fake does not grow linearly
  with repeated resolutions. Reuse must not weaken Req 10 — write decisions are
  still made from fresh state, which #100 already guarantees.

### The human-readable repo layout (Req 17)

- For a BYO workspace, seam path → repo path is exactly:
  - `workspaces/<id>/files/<p>` → `<root>/<p>` — the document a user sees as
    `notes/plan.md` in the app is committed at `<root>/notes/plan.md` in the
    repo, as normal markdown. No id in the path, no `files/` segment, no
    mangling, no encoding.
  - `workspaces/<id>/manifest.json` → `<root>/.marky-mark/manifest.json` — app
    metadata lives under a single `.marky-mark/` directory at the connected
    root.
  - `<root>` empty means the repo root; a configured root is a plain
    repo-relative prefix with no leading/trailing slashes.
- The mapping is **bidirectional and total for listings**: `list(prefix)`
  returns seam paths, so `GET /api/workspaces/<id>/files` shows the repo's files
  under the root, and `.mmkeep` markers keep working as ordinary committed files
  (Req 9 unchanged).
- `.marky-mark/` at the connected root is app metadata, **never a workspace
  file**: it does not appear in any file listing, is not reachable through the
  `files/<path>` routes (a request for `.marky-mark/...` or any path that would
  land inside it is refused, not served), and cannot be written or deleted
  through them. Only the `<root>/.marky-mark/` directory is metadata; a
  `.marky-mark` directory deeper in the tree is an ordinary file path.
- Path safety: the mapped provider serves **only its own workspace**. A seam
  path outside `workspaces/<id>/` (another workspace's prefix, `users/…`, the
  backend record itself) is refused with a thrown error rather than mapped into
  the repo, and no mapped path can escape the configured root (`..` segments,
  absolute paths, empty segments).
- Existing repo content is workspace content by design: files already present
  under the connected root list and open as documents, and a `root` of the repo
  root means the whole repo. State this in the code comment — it is the point of
  Req 17, not a leak.
- Per-user files (`users/…`, `server/userFiles.ts`) and the legacy
  workspace-agnostic `/api/files*` scaffold stay on the deployment default,
  unchanged.

### Creating a BYO workspace, server-side only (Req 17)

- `POST /api/workspaces` accepts an **optional** storage/connection field
  naming a repo connection (`{kind: 'repo', owner, repo, branch, root?}`;
  suggested body key `storage`, defaulting to the deployment default when
  absent). A body with no such field behaves byte-identically to today — this
  is what #104's wizard will call, and the only way a repo record is created in
  this issue.
- The field is validated through `validateWorkspaceBackend`
  (`server/backends.ts`) — one validator, not a second opinion — and a
  malformed connection is a **400** naming the offending field, never a created
  workspace.
- Creation of a BYO workspace is **fail-fast**: the repo is checked for
  reachability and `contents: write` (reuse `assertRepoIsWritable` from
  `server/providers/github/storage.ts`) before anything is written, and a
  failure answers an actionable 4xx/5xx from `githubFailureDetail`'s existing
  vocabulary with **no** record, no manifest and no commit left behind.
- On success the order #101 established holds: the backend record goes to the
  **deployment default** store first (`workspaces/<id>/backend.json`), then the
  manifest is written through the connected provider, landing at
  `<root>/.marky-mark/manifest.json` as one commit (Req 7 attribution
  unchanged). The 201 response is the existing `{id, manifest}` — no connection
  details.
- The workspace id is an opaque `randomUUID()` exactly as today: nothing about
  owner/repo/branch/root appears in the id, in the workspace URL, or in any
  API response this issue touches. The connection is read from the server-side
  record and from nowhere else.

### BYO and default workspaces coexist (Req 3 + 17)

- `GET /api/workspaces` lists BYO workspaces too. Today's scan matches
  `workspaces/<id>/manifest.json` in the deployment default store, which a BYO
  workspace does not have — enumeration must become the **union** of that scan
  and the ids that have a `backend.json` record, with each workspace's manifest
  loaded through `backends.forWorkspace(id)`. Existing recordless workspaces
  keep listing. A workspace whose manifest cannot be loaded (corrupt, or its
  repo unreachable) is skipped as today rather than failing the whole listing.
- Opening, reading, saving, renaming, folder ops and uploads on a BYO workspace
  go through the same routes and permission checks as any workspace, with the
  same status codes and the same opaque ETag round-trip. `src/` is **untouched**
  — the client platform (`src/platform/hosted.ts`) needs no protocol change.
- Deleting a BYO workspace removes the workspace's content under the connected
  root (files and `<root>/.marky-mark/`) as commits, then forgets the record in
  the deployment default. The sweep never touches anything outside the
  configured root and never deletes the repo or the branch. Repo history retains
  the content — the delete-confirmation copy correction is #106's.
- A test proves the two kinds coexist in one deployment: a blob-default (or
  in-memory) deployment holding one default workspace and one BYO workspace,
  where each is listed, opened, saved and deleted without touching the other's
  store.

### Tests and conventions

- Unit coverage lives in `tests/unit/` following the server naming (a new file
  such as `server-byo-layout.test.ts`, plus cases in
  `server-github-backend.test.ts` / `server-workspaces.test.ts` where they
  belong). Titles start with the next unused `U<n>` — **the current maximum is
  U414, so new tests begin at U415** — and `describe` blocks name the contract
  (`describe('PRD 010 Req 17 …')`).
- Coverage pins at least: the seam→repo path mapping both ways (file, manifest,
  nested path, empty and non-empty root); `.marky-mark/` hidden from listings
  and unreachable through `files/<path>`; a refused out-of-workspace or
  root-escaping path; a document saved in the app landing at the plain repo path
  as one commit; a file pre-existing in the repo listing as a workspace
  document; the create path (happy path, malformed connection → 400, unwritable
  repo → actionable failure with nothing written); listing showing both kinds;
  delete sweeping the root and forgetting the record.
- No test reaches github.com: everything runs against
  `server/providers/github/fake.ts` (extend it only if a needed route is
  missing), and the unit suite passes offline.
- Every new or changed behaviour carries the citation comment the repo requires
  (`// PRD 010 Req 17: <what and why>`), per `.sandcastle/CODING_STANDARDS.md` §
  Style and `docs/COMMENT-FORMAT.md`.
- `server/README.md` gains a short note on the BYO layout (files at the
  connected root, metadata under `.marky-mark/`) contrasted with the default
  repo's app-storage layout. The operator walkthrough stays #106's.

### Scope boundaries — what this issue does NOT do

- **No wizard and no UI** (#104): no new-workspace storage choice, no install
  round-trip, no installation/repo/branch pickers, no resumable wizard state.
  `src/` is untouched.
- **No settings connection surface, no reconnect, no connection-loss UX**
  (#105); no API that reads a connection back.
- **No merge-on-save** (#102): a stale conditional save on a BYO workspace still
  answers 412.
- **No hosting guide or delete-copy change** (#106) beyond the `server/README.md`
  lines above; **no e2e** (#107) — the e2e suite keeps booting the local blob
  backend.
- No migration of existing workspaces between backends, and no change to
  `MM_STORAGE_BACKEND` semantics.
- `docs/MAP.md` (generated from `src/` and `tests/e2e/` only) needs no
  regeneration — `npm run map` is not part of this issue.

### Verification

- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx vitest run tests/unit/server-*.test.ts`) after each change — not the full
  gate after every edit, and no full-gate baseline at the start of the attempt.
  Baseline with the quick tier only if a baseline is wanted at all.
- `npm run validate:quick` has been run **ONCE**, at the end, in the
  implementer's session, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #103, naming the seam→
  repo path mapping, the create-request shape #104 will call, the new U numbers,
  and the gate result.

## Context

PRD 010 (`prd/010-github-repo-storage.md`, parent #97) adds GitHub as a peer of
Azure Blob behind the PRD 007 storage seam. #99 landed
`server/providers/github/auth.ts` (App JWT → installation tokens,
`GITHUB_API_BASE` as the one host constant, `githubFailureDetail` as the one
failure vocabulary) and `server/providers/github/fake.ts`. #100 landed
`server/providers/github/storage.ts` — a full `StorageProvider` over a repo
branch, commit per mutation, head-sha-anchored cache. #101 landed the
`MM_STORAGE_BACKEND` knob and `server/backends.ts`: the per-workspace
`backend.json` record, its validator (which **already** carries the `repo`
shape), and `WorkspaceBackends.forWorkspace()` with an unset `connect` hook.
This issue is the BYO half: fill in that hook, add the layout mapping, and let
something create such a record — server-side only.

Files worth reading first:

- `server/backends.ts` — 142 lines; `WorkspaceBackendRecord`,
  `validateWorkspaceBackend`, `createWorkspaceBackends` and the `connect` option
  written for exactly this issue.
- `server/providers/github/storage.ts` — `GitHubStorageOptions`
  (owner/repo/branch/root/auth), `assertRepoIsWritable`, and the `repoPath` /
  `seamPath` pair that already handles a repo-relative root. Decide deliberately
  between wrapping the provider with a path-mapping decorator and teaching it a
  layout; a decorator keeps #100's contract tests untouched but must preserve
  `asUser` (Req 7 attribution) and `init`.
- `server/workspaces.ts` — create (~line 303), the `manifest.json` enumeration
  in `GET /api/workspaces` (~line 329), per-workspace resolution (~line 369) and
  the delete-everything-under-the-prefix sweep (~line 383). `WORKSPACES_PREFIX`,
  `manifestBlob`, `filesPrefix` and `FOLDER_PLACEHOLDER` are the seam-path
  vocabulary to map from.
- `src/lib/hostedWorkspace.ts` — `buildNewWorkspaceManifest` (~line 287) is what
  parses the create body today; the connection field is a server-side concern
  and does not have to live there.
- `server/providers/index.ts` and `server/config.ts` — where App auth is built
  and where `config.github` may exist without the github backend being the
  default.
- `issue-specs/issue-101.md` and `issue-specs/issue-100.md` — the conventions
  this issue continues.

Gotchas:

- The server runs under plain `node server/index.ts` (native type stripping), so
  new server imports keep the explicit `.ts` extension.
- The unit suite runs with `isolate: false` (`vitest.config.ts`): inject the
  fake, never monkey-patch `globalThis.fetch`, and do not leak global state
  between files.
- U370 walks all of `server/` for a GitHub host string and expects exactly one
  hit in `auth.ts` — keep host strings out of new code and out of `server/`
  README code samples.
- The record lives in the deployment default store while the manifest lives in
  the repo; the two writes are not atomic. Order matters (record first — the
  backend is what says where the manifest belongs), and a create that fails
  after the record lands must not leave a workspace that lists but cannot open:
  clean up, or refuse before writing anything.
