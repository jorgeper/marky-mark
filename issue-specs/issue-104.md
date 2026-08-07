# Spec: Connect-your-GitHub-repo wizard in the new-workspace flow (#104)

## Goal

All acceptance criteria in issue-specs/issue-104.md are satisfied for issue
#104, with evidence visible in the session: the hosted new-workspace flow offers
a storage choice — **default storage** (today's fields, a byte-identical create
body) or **connect your GitHub repo** — and the GitHub choice runs a restartable
install → pick repo → pick branch + optional subdirectory → confirm wizard that
creates the workspace through #103's `storage: {kind: 'repo', …}` create field;
every step talks only to the app's own origin (no GitHub call from `src/`, the
bundle scan's fetch allowlist unchanged), the server doing the GitHub work
behind new authenticated routes that never hand a caller an installation their
own wizard session does not name; wizard state survives leaving the app for
GitHub's consent page and returning, and re-entering after an abandoned or
failed round trip continues or restarts cleanly rather than erroring; the step
logic lives in a pure `src/lib/` module unit-tested from U435 up;
`npm run validate:quick` passes in the implementer's session; and a summary
comment from the implementer exists on issue #104.

## Acceptance criteria

### The storage choice in the new-workspace flow (Req 15)

- The New Workspace dialog (`src/components/WorkspaceSwitcher.tsx`,
  `NewWorkspaceDialog`) presents two storage choices: **default storage** and
  **connect your GitHub repo**. Default storage is preselected.
- The default-storage path is **unchanged**: the same name / people+roles /
  everyone-access fields, the same validation
  (`validateNewWorkspaceForm` in `src/lib/workspaceLifecycle.ts`), and a
  `POST /api/workspaces` body that carries **no** `storage` field — byte
  identical to today, so existing hosted e2e coverage keeps passing untouched.
- The GitHub choice is offered only when the deployment can actually connect one
  (its GitHub App section is configured). Where it cannot, the choice is either
  absent or visibly unavailable with a one-line reason — never an option that
  leads to a dead end or a 500.
- Both choices collect the same workspace fields (name, members, everyone
  access); the GitHub choice adds the connection, it does not replace the
  workspace's own settings.
- New interactive UI ships `data-testid`s and no existing test id is renamed
  (`.sandcastle/CODING_STANDARDS.md` § Testing).

### The wizard's steps (Req 16)

- Choosing GitHub enters a multi-step wizard whose steps are, in order:
  1. **Install** — the admin is sent to GitHub's consent page to install the
     deployment's App on their repo, and comes back to the app. The wizard
     states plainly what leaving does and shows how to come back if the tab is
     lost.
  2. **Pick repo** — the repos the resulting installation grants, listed for
     selection. An installation that grants no repo the app can use says so.
  3. **Pick branch and subdirectory** — branch defaults to the repo's default
     branch; the subdirectory is optional and defaults to the repo root. The
     subdirectory is validated as a plain repo-relative prefix (no leading or
     trailing slash, no `..`, no absolute path) with a named message rather than
     a server round trip to discover it.
  4. **Confirm** — the chosen owner/repo/branch/root is shown back before
     anything is created.
- Confirming creates the workspace with one existing call: `POST
  /api/workspaces` carrying `storage: {kind: 'repo', owner, repo, branch, root?}`
  (root omitted when the repo root was chosen). No new create endpoint.
- A refused connection (#103's fail-fast 400/502) is shown **in the wizard**,
  using the server's own message, with the picked values still in hand so the
  admin can correct a step — not a discarded wizard and not a workspace that
  exists but cannot open.
- On success the new workspace opens exactly as a default-storage create does
  (`lifecycle.navigateTo(created.id)`), and the wizard's saved state is cleared.
- Nothing in the created workspace's UI reveals the connection beyond the wizard
  itself (Req 3); the settings surface is #105's.

### Restartable (Req 16)

- The install step is a **round trip out of the app**: the wizard's progress
  (chosen mode, the workspace fields already entered, the step reached, and what
  identifies the installation on return) is persisted before navigating away and
  is still there when the browser comes back.
- The return from GitHub is recognised by the app (GitHub returns to the
  configured setup URL with `installation_id` / `setup_action`, plus whatever
  opaque state the server issued) and resumes the wizard at the pick-repo step
  rather than dropping the user on a bare start page.
- **Abandoning mid-flow is not an error state.** Closing the dialog, reloading,
  or never returning from GitHub leaves resumable state; re-entering New
  Workspace offers to continue where it stopped **or** start over, and starting
  over discards the saved state cleanly.
- Saved state that can no longer be used — the install was cancelled or later
  removed, the state no longer matches a session the server knows, the repo has
  gone — resolves to a named message and a clean restart, never a stuck step, a
  silent hang, or a raw status code.
- The resume/restart decision is a **pure function** over saved state + the
  return parameters, unit-tested; the component only renders what it returns.
- Persisted wizard state carries no credential and nothing GitHub-issued beyond
  identifiers already visible to the user (owner, repo, branch, installation
  id). No token ever reaches `src/`.

### The server side the wizard talks to (Req 2 + 4 + 16)

- **No GitHub API call is made from the client.** Every wizard step calls the
  app's own origin under `/api/…` through the existing bearer-authenticated
  wrapper in `src/platform/hostedWorkspaces.ts`; the server makes the GitHub
  calls with the App credentials (`createGitHubAppAuth`, `server/providers/
  github/auth.ts`). No GitHub host string appears anywhere in `src/`.
- The new routes cover what the steps need and no more: whether BYO is
  available, the URL to send the admin to for the install, resolving the return
  into a wizard session, the installation's repos, and a repo's branches +
  default branch. They live behind the same 401 guard as the rest of `/api`
  (`server/app.ts` applies it before dispatch) and answer 401 without a token.
- **Enumeration is bounded.** No route hands a signed-in caller the deployment's
  whole installation list or a repo list they did not just complete a round trip
  for: repos and branches are answerable only for an installation named by the
  caller's own wizard session, and a request for another one is refused with a
  named 403/404 rather than served. A test pins this.
- GitHub failures (rate limit, 5xx, uninstalled app, missing repo) surface
  through the existing vocabulary (`githubFailureDetail`) as actionable
  messages, never as a hung step or a leaked response dump (Req 11). No
  credential, App JWT or installation token is ever logged or returned.
- The install URL needs the deployment's App identity on the **web** host, which
  today's config does not carry. Add it to the existing optional `github`
  section in `server/config.ts` with that file's existing strictness (named
  refusal when partially configured, never echoing key material), and keep the
  BYO choice unavailable when it is absent.
- `U370` (`tests/unit/server-github-fake.test.ts`) asserts exactly one GitHub
  host occurrence in all of `server/`, in `auth.ts`. Keep the rule — every
  GitHub host string in **one** module next to `GITHUB_API_BASE` — and update
  that test's expectation deliberately, in the same commit, to name the added
  occurrence(s) in that same file. Do not weaken it to a substring or a count.
- `server/providers/github/fake.ts` grows only the routes the wizard needs that
  it lacks (the installation's repositories, a repo's metadata for its default
  branch, its branch list), in the style of its existing route groups, with the
  request-counting and failure-queueing behaviour still working. **No test and
  no dev lane reaches github.com.**

### Tests and conventions

- The wizard's decision logic is a **pure module under `src/lib/`** (no `react`,
  no components — `.sandcastle/CODING_STANDARDS.md` § Style), with
  `src/components/` a thin shell over it, exactly as
  `workspaceLifecycle.ts` ↔ `WorkspaceSwitcher.tsx` already are. Its unit file
  is `tests/unit/<kebab-case-module>.test.ts` matching the module name.
- Titles start with the next unused `U<n>` — **the current maximum is U434, so
  new tests begin at U435** — and `describe` blocks name the contract
  (`describe('PRD 010 Req 15+16 …')`). No number is reused and no existing test
  is weakened, deleted or skipped.
- Coverage pins at least: the create body for each choice (default → no
  `storage` field; GitHub → the exact `{kind:'repo', …}` record, root omitted at
  the repo root); subdirectory validation (accepted, and each rejected shape
  named); step ordering and the branch default; resume-vs-restart over saved
  state + return parameters, including unusable saved state; the new server
  routes' happy paths against the fake; the 401 guard; and the
  cross-installation refusal.
- Every new or changed behaviour carries the citation comment the repo requires
  (`// PRD 010 Req 15: …` / `Req 16`), per `.sandcastle/CODING_STANDARDS.md` §
  Style and `docs/COMMENT-FORMAT.md`.
- The bundle scan's `FETCH_ALLOWLIST` in `scripts/validate.mjs` is unchanged:
  wizard calls go through the existing hosted API wrapper rather than adding a
  network call site.
- If any new or changed file under `src/` or `tests/e2e/` carries a `SPEC<n>`
  citation, `npm run map` has been run and the regenerated `docs/MAP.md` is
  committed (the gate diffs it). PRD-only citations do not affect it.

### Scope boundaries — what this issue does NOT do

- **No settings connection surface, no reconnect, no connection-loss UX**
  (#105). The wizard is reachable from New Workspace only.
- **No e2e** (#107): the wizard's happy path and restart are covered there,
  together with the rest of the Req 22 matrix. The existing e2e suite must keep
  passing and its count floor must not drop.
- **No hosting guide** (#106) beyond a short `server/README.md` note on the new
  routes and the added config value; the operator walkthrough for registering
  the App and its setup URL is #106's.
- No change to `POST /api/workspaces`'s contract, to the backend record shape,
  to the BYO layout (#103), to merge-on-save (#102), or to
  `MM_STORAGE_BACKEND` semantics.
- No per-user GitHub OAuth, no PAT input, no GitHub sign-in: GitHub stays a
  server-held storage credential (PRD 010 non-goals).
- No migration of an existing workspace onto a repo, and no way to change a
  workspace's backend after creation.

### Verification

- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx vitest run tests/unit/<file>.test.ts`) after each change — not the full
  gate after every edit, and no full-gate baseline at the start of the attempt.
  Baseline with the quick tier only if a baseline is wanted at all.
- `npm run validate:quick` has been run **ONCE**, at the end, in the
  implementer's session, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #104, naming the
  storage choice, the wizard's steps and where their logic lives, the server
  routes added, the config value added, the new U numbers, and the gate result.

## Context

PRD 010 (`prd/010-github-repo-storage.md`, parent #97) makes GitHub a peer of
Azure Blob behind the PRD 007 storage seam. Everything server-side this issue
needs already exists: #99 landed `server/providers/github/auth.ts` (App JWT →
installation tokens, `listInstallations` / `installationForRepo` /
`requestAsInstallation`, `githubFailureDetail` as the one failure vocabulary)
and `server/providers/github/fake.ts`; #100 the `StorageProvider` over a repo
branch; #101 the `MM_STORAGE_BACKEND` knob and `server/backends.ts`; #103 the
BYO connection (`server/providers/github/byo.ts`, `createRepoConnector` in
`server/providers/index.ts`) and — the hook this issue calls — the optional
`storage` field on `POST /api/workspaces`, validated by
`validateWorkspaceBackend`, fail-fast, 400/502 on refusal. This issue is the
user-visible half: the choice, the wizard, and the small server surface the
wizard reads GitHub through.

Files worth reading first:

- `src/components/WorkspaceSwitcher.tsx` (258 lines) — `NewWorkspaceDialog` is
  the flow to grow; `src/lib/workspaceLifecycle.ts` holds its pure half
  (`emptyNewWorkspaceForm`, `validateNewWorkspaceForm`).
- `src/platform/hostedWorkspaces.ts` — the `WorkspaceLifecycle` interface,
  `create()` (~line 133) and the single bearer-stamped `api()` wrapper every new
  call must go through.
- `server/workspaces.ts` ~line 348–460 — `readStorageField`,
  `connectionFailureStatus` and the create path, including the comment that
  names this issue's wizard as its caller.
- `server/providers/github/auth.ts` — the App-auth surface and `GITHUB_API_BASE`
  (the one host constant U370 guards); `server/config.ts` ~line 140–180 —
  `loadGitHubConfig`, where an added config value belongs.
- `server/providers/github/fake.ts` — `REPO_ROUTE` and the route table
  (~line 336–500) to extend, plus `count()` / `queueRateLimit()` for tests.
- `issue-specs/issue-103.md` and `issue-specs/issue-101.md` — the conventions
  this issue continues.

Gotchas:

- The server runs under plain `node server/index.ts` (native type stripping), so
  new server imports keep the explicit `.ts` extension.
- The unit suite runs with `isolate: false` (`vitest.config.ts`): inject the
  fake and never monkey-patch `globalThis.fetch`; a test that touches
  module-level or global state restores it.
- `src/lib/` modules are pure logic — no `react`, no `@tauri-apps/*`, no imports
  from `src/components/`; and there are no `console.*` call sites in `src/`.
- The wizard is a hosted-web flow: it lives behind the `workspaces` Platform
  capability (`src/platform/types.ts`), so nothing added may assume the hosted
  flavor by name or break the desktop build, which has no such capability.
- Leaving the app for GitHub is a full navigation, not a fetch — whatever state
  the wizard relies on must outlive an unload, and the return lands on the app's
  own URL with GitHub's query parameters attached.
