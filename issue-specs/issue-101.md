# Spec: Deployment default backend: github|blob config knob, per-workspace backend record, startup validation (#101)

## Goal

All acceptance criteria in issue-specs/issue-101.md are satisfied for issue
#101, with evidence visible in the session: a `MM_STORAGE_BACKEND=blob|github`
knob orthogonal to `MM_MODE` that defaults to blob, refuses any other value, and
lets a github deployment start with **no** Azure storage connection string at
all; the deployment-default GitHub repo wired through `createProviders` at
today's `workspaces/<uuid>/…` and `users/…` paths on one branch; a per-workspace
backend record that request handling resolves storage through (no record →
deployment default) and that nothing in the client can see; startup validation
that fails fast with an actionable error when the default repo is unreachable or
its App installation does not grant contents write; `npm run validate:quick`
passes in the implementer's session; and a summary comment from the implementer
exists on issue #101.

## Acceptance criteria

### The storage-backend knob (Req 1)

- `ServerConfig` (`server/config.ts`) gains a storage-backend field read from
  **`MM_STORAGE_BACKEND`**, whose only accepted values are `blob` and `github`.
  Omitting it means `blob`. Use exactly that variable name — the operator guide
  (#106) and the BYO work (#103–#105) will reference it.
- Any other value refuses to start with a message in the existing house style —
  naming the variable, the accepted values and the offending value, the way
  `MM_MODE` already does (`MM_MODE must be 'local' or 'azure', got 'x'`).
- The knob is **orthogonal to `MM_MODE`**: all four combinations
  (`local|azure` × `blob|github`) parse. A `local`-mode developer can point at a
  github backend and an `azure`-mode deployment can stay on blob.
- `MM_STORAGE_BACKEND=blob` reproduces today's config exactly: the blob defaults
  (Azurite in local, required `AZURE_STORAGE_CONNECTION_STRING` in azure) and the
  GitHub App section still optional in both modes. U216–U219 and U371–U373 keep
  passing unchanged.
- `MM_STORAGE_BACKEND=github` requires, and names **all at once** when any are
  missing: the PRD 010 Req 4 App credentials (`MM_GITHUB_APP_ID`,
  `MM_GITHUB_PRIVATE_KEY`) and the default repo. The repo arrives as
  **`MM_GITHUB_DEFAULT_REPO`** in `owner/repo` form, with optional
  **`MM_GITHUB_DEFAULT_BRANCH`** (default `main`) and
  **`MM_GITHUB_DEFAULT_ROOT`** (optional repo-relative prefix; default the repo
  root). A `MM_GITHUB_DEFAULT_REPO` that is not exactly one `owner/repo` pair is
  rejected by name.
- **No Azure storage account at all.** With `MM_STORAGE_BACKEND=github`,
  `AZURE_STORAGE_CONNECTION_STRING` is no longer required in azure mode (the
  Entra variables still are), and the resulting config does not carry a
  fabricated connection string. Pinned by a test that loads an azure-mode
  github-backend config with no storage connection string in the environment.
- No new GitHub host string anywhere: the repo is configured as `owner/repo`, not
  a URL, so **U370 stays green** (`api.github.com` still appears once, in
  `GITHUB_API_BASE`). State the grep result in the issue comment.

### Wiring the deployment default (Req 5)

- `createProviders` (`server/providers/index.ts`) returns the GitHub storage
  provider — `createGitHubStorageProvider` from #100, fed a `GitHubAppAuth` built
  from the App config and the configured owner/repo/branch/root — when the knob
  says `github`, and today's blob provider when it says `blob`. Auth and
  directory selection stay driven by `MM_MODE` alone; **U224 keeps passing
  unchanged**.
- With the github backend selected, **no blob client is constructed** — today's
  unconditional `createBlobStorageProvider(...)` call must become conditional, or
  a deployment with no storage account fails at wiring time before it can reach
  the config error. Pinned by a test that wires providers from a github-backend
  config whose `AZURE_STORAGE_CONNECTION_STRING` is absent and asserts
  `storage.kind` is the GitHub one.
- The default repo mirrors today's storage layout on **one branch**:
  `workspaces/<uuid>/…` and `users/…` at those repo-relative paths under the
  configured root. No per-workspace branch, no path mangling, no id translation
  (this is #100's provider used as-is).
- `server/README.md`'s environment table gains the new variables, and its storage
  section states that the default repo is **app storage, not intended for human
  browsing** (the human-readable layout is the BYO case, #103). The full operator
  walkthrough is #106 and is **not** in scope here.

### The per-workspace backend record (Req 3)

- Each workspace has a durable record of which backend backs it, written when the
  workspace is created and removed when the workspace is deleted. The record
  lives in the **deployment default** store, outside the workspace's `files/`
  prefix (suggested: `workspaces/<id>/backend.json`) — **not** inside the
  workspace manifest, because the manifest lives in the workspace's own backend
  and the backend has to be known before it can be read.
- The record is parsed through a typed validator that rejects malformed data with
  a named error rather than coercing it, matching `validateWorkspaceManifest`'s
  stance. This issue ships one kind — the deployment default; #103 adds the BYO
  repo connection to the same shape.
- Workspace-scoped request handling resolves storage **per workspace** through
  one function rather than reading a process-wide `providers.storage`:
  `handleWorkspaceApi` receives a resolver keyed by workspace id. A unit test
  pins that a workspace whose record names a different backend is served by a
  different provider than the deployment default, so #103 only supplies a
  record's contents and adds no new plumbing.
- A workspace with **no** record — every workspace an existing deployment already
  has — resolves to the deployment default. No migration step, no startup
  rewrite, and an existing blob deployment behaves identically after this change.
- Per-user files (`users/…`, `server/userFiles.ts`) and the legacy
  workspace-agnostic `/api/files*` scaffold always use the deployment default
  backend.
- **Nothing in the client learns the backend.** No API response gains a backend
  field: `GET /api/workspaces` rows, the manifest GET/PUT payloads and every
  file route answer byte-identically for a default workspace on either backend.
  The record file never appears in a workspace file listing, is never reachable
  through the `files/<path>` routes, and is not mistaken for a workspace by the
  `manifest.json` enumeration in `GET /api/workspaces`. `src/` is untouched.

### Startup validation (Req 6)

- With `MM_STORAGE_BACKEND=github`, startup validates the configured default repo
  before the HTTP listener accepts connections: the repo is reachable and the App
  installation on it grants **contents read/write**. A failure exits non-zero
  with an actionable message naming the repo and what to fix, consistent with the
  existing config-validation voice and reusing `githubFailureDetail`'s vocabulary
  rather than inventing a second one.
- The validation is an exported, directly testable function (the provider's
  `init()` is a reasonable home, but the check must be callable from a unit test
  without booting a server). Unit tests drive it against the fake for: success;
  the App not installed on the repo / repo absent; an installation that grants
  only `contents: read`; and a transient GitHub 5xx. Each failure throws an
  actionable error rather than starting anyway.
- **No credential, App JWT or installation token** appears in any validation
  message or log line.
- With `MM_STORAGE_BACKEND=blob`, startup makes **zero** GitHub requests — pinned
  against the fake's request log — and behaves exactly as today.
- `server/providers/github/fake.ts` is extended as needed for this: the
  installation lookup route (`GET /repos/<owner>/<repo>/installation`) carries
  `permissions`, and a seed can set them (e.g. contents read-only) so the
  insufficient-permission path is testable. Existing fake behaviour and
  `tests/unit/server-github-fake.test.ts` keep passing.

### Tests and conventions

- New unit tests live in `tests/unit/` following the server naming (config cases
  belong in `server-config.test.ts`; provider selection near
  `server-azure-providers.test.ts`; a new file such as
  `server-github-backend.test.ts` for validation and the backend record is fine).
  Titles start with the next unused `U<n>` — **the current maximum is U400, so
  new tests begin at U401** — and `describe` blocks name the contract
  (`describe('PRD 010 Req 1 …')`).
- No test reaches github.com: everything runs against
  `server/providers/github/fake.ts`, and the unit suite passes with the machine
  offline.
- Every new or changed behaviour carries the citation comment the repo requires
  (`// PRD 010 Req <n>: <what and why>`), per `.sandcastle/CODING_STANDARDS.md` §
  Style and `docs/COMMENT-FORMAT.md`.

### Scope boundaries — what this issue does NOT do

- **No merge-on-save** (#102): stale conditional saves on the github backend
  still answer 412, exactly as #100 left them.
- **No BYO connection contents** (#103): the record has room for a repo
  connection, but nothing creates one, and the human-readable layout with
  `.marky-mark/` metadata is #103's. **No wizard** (#104), **no settings
  connection surface** (#105).
- **No hosting guide** (#106) beyond the `server/README.md` env/layout lines
  above, and **no e2e** (#107) — the e2e suite keeps booting the local blob
  backend.
- `src/` is untouched and `docs/MAP.md` (generated from `src/` and `tests/e2e/`
  only) needs no regeneration — `npm run map` is not part of this issue.

### Verification

- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx vitest run tests/unit/server-*.test.ts`) after each change — not the full
  gate after every edit, and no full-gate baseline at the start of the attempt.
  Baseline with the quick tier only if a baseline is wanted at all.
- `npm run validate:quick` has been run **ONCE**, at the end, in the
  implementer's session, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #101, naming the new
  environment variables, where the per-workspace backend record is stored, the
  new U numbers, the U370 grep result, and the gate result.

## Context

PRD 010 (`prd/010-github-repo-storage.md`, parent #97) adds GitHub as a peer of
Azure Blob behind the PRD 007 storage seam. #99 landed
`server/providers/github/auth.ts` (App JWT → cached installation tokens,
`GITHUB_API_BASE` as the one host constant, `githubFailureDetail` as the one
failure vocabulary) and `server/providers/github/fake.ts`. #100 landed
`server/providers/github/storage.ts` — a full `StorageProvider` over a repo
branch — and deliberately left it **unreachable by configuration**. This issue is
that last wire: the knob, the per-workspace record the resolver reads, and the
fail-fast startup check. Keep the blast radius to `server/` + `tests/unit/`.

Files worth reading first:

- `server/config.ts` — `loadConfig`, `AZURE_REQUIRED`, and `loadGitHubConfig`
  (the optional App section, and the pattern for naming every missing variable
  at once without echoing key material).
- `server/providers/index.ts` — 30 lines; the whole provider-selection switch,
  and the line that unconditionally builds a blob client.
- `server/providers/github/storage.ts` — `GitHubStorageOptions`
  (owner/repo/branch/root/auth) is exactly what the config must produce.
- `server/providers/github/auth.ts` — `installationForRepo`, `GitHubApiError`,
  `githubFailureDetail`; the validation error messages should read like these.
- `server/workspaces.ts` — `handleWorkspaceApi`'s `storage` parameter (the thing
  that becomes a per-workspace resolution), workspace create (~line 293), the
  `manifest.json` enumeration in `GET /api/workspaces` (~line 313) and the
  delete-everything-under-the-prefix path (~line 353).
- `server/index.ts` — 23 lines; `await providers.storage.init?.()` before
  `server.listen`, which is where fail-fast lands.
- `issue-specs/issue-100.md` — the conventions this issue continues.

Gotchas:

- The server runs under plain `node server/index.ts` (native type stripping), so
  new server imports keep the explicit `.ts` extension.
- The unit suite runs with `isolate: false` (`vitest.config.ts`): inject the
  fake, never monkey-patch `globalThis.fetch`, and do not leak global state
  between files.
- U370 walks all of `server/` for a GitHub host string and expects exactly one
  hit in `auth.ts` — configure the repo as `owner/repo`, never as a URL, and keep
  host strings out of README code samples in `server/` (the check covers `.ts`,
  `.tsx`, `.mts`, `.mjs` only, but the spirit is the point).
- `GET /api/workspaces` finds workspaces by matching `workspaces/<id>/manifest.json`
  in a full-prefix listing; a sibling record blob under the same prefix must not
  break that scan, and the workspace-delete path must not leave it orphaned.
- The GitHub provider caches branch state with a TTL; a startup validation that
  primes that cache is fine, but it must not become a source of stale write
  decisions (PRD 010 Req 10, already pinned by U396–U400).
