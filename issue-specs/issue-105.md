# Spec: BYO connection management: settings surface, reconnect, and out-of-band edits (#105)

## Goal

All acceptance criteria in issue-specs/issue-105.md are satisfied for issue
#105, with evidence visible in the session: a repo-backed workspace's
connection (owner/repo, branch, root, App installation status) is shown in
Workspace settings to holders of `workspace.settings` and nowhere else, and
they can re-run the connect wizard to repair it — reachable even while the
connection is broken; connection loss on open, on listing and on save is a
named, actionable error in the server's existing GitHub failure vocabulary
rather than a hang, a "no longer there", or a workspace that silently vanishes
from the Open dialog; out-of-band pushes and edits made on GitHub are picked up
on the next read and a stale-base save against one takes the same merge/412
path as any in-app save, with the security-boundary stance documented in
`server/README.md`; the decision logic lives in pure `src/lib/` modules,
unit-tested from U455 up against the local GitHub fake with no test reaching
github.com; `npm run validate:quick` passes in the implementer's session; and a
summary comment from the implementer exists on issue #105.

## Acceptance criteria

### The connection in Workspace settings (Req 18)

- Workspace settings gains a connection section, mounted next to
  `WorkspaceAccessSettings` / `WorkspaceDangerZone` in `src/App.tsx`'s
  `workspaceActions` (so it lives on the `workspaces` capability, never on a
  flavor check). It shows the connected **owner/repo**, **branch**, **root**
  (the repo root said in words when no subdirectory was chosen) and the
  **App installation status** — installed and writable, or the named reason it
  is not.
- It renders **only** for a member holding `workspace.settings`, and the route
  behind it refuses anyone else by name regardless of what the UI shows — the
  pattern `WorkspaceAccessSettings` already uses for its own verbs.
- A workspace that is **not** repo-backed shows nothing at all: no section, no
  empty state, no "default storage" label. Req 3 stands — nothing in the client
  reveals which backend a default workspace uses.
- The status is answered by the server making the GitHub call with the
  deployment's App credentials. **No GitHub host string appears in `src/`** and
  no new client network call site is added: the surface goes through the
  existing bearer-stamped `api()` wrapper in
  `src/platform/hostedWorkspaces.ts`, so `FETCH_ALLOWLIST` in
  `scripts/validate.mjs` is unchanged.
- No credential, App JWT or installation token reaches the client or a log
  line; the status is a state plus a sentence, never a response dump.
- New interactive UI ships `data-testid`s and no existing test id is renamed
  (`.sandcastle/CODING_STANDARDS.md` § Testing).

### Reconnect (Req 18)

- The section offers **re-running the connect wizard** for this workspace:
  install → pick repo → pick branch + optional subdirectory → confirm, the same
  steps and the same pure step logic `src/lib/githubConnectWizard.ts` already
  owns, reused rather than duplicated. The reconnect run collects **no**
  workspace fields (no name, no members): it produces a connection, not a
  workspace.
- Confirming a reconnect updates the workspace's stored backend record through
  a new authenticated route gated on `workspace.settings`. It does **not** go
  through `POST /api/workspaces`, and it never creates a workspace.
- A reconnect is **repair, not migration** (PRD 010 non-goals): only a
  workspace whose stored record is already `kind: 'repo'` can be reconnected —
  a default-storage workspace has no reconnect path — and the new connection is
  accepted only after it is proved reachable with write access **and** proved
  to carry this workspace's own `<root>/.marky-mark/manifest.json`. A target
  that does not (an unrelated or empty repo, a wrong branch, a wrong
  subdirectory) is refused with a named message and the stored record is left
  exactly as it was. Nothing is written to the new target before the record
  changes, and the manifest is never re-created there.
- A refused reconnect is shown **in the wizard**, using the server's own
  message, with the picked values still in hand so the admin can correct a
  step — never a discarded wizard and never a half-changed record.
- The wizard's saved-state mechanics survive the round trip out to GitHub for
  the reconnect flow too: the saved state names which workspace is being
  repaired, and returning from GitHub lands back on **that** workspace's
  settings rather than the start page or a fresh New Workspace dialog.
  `SavedWizardState` today requires a create form; whichever way that is
  generalised (a purpose/discriminant, or a version bump that discards v1
  records as unusable saved state), `decideWizardEntry`'s existing contract —
  fresh / resume / continue / restart, with every unusable combination a named
  restart — holds for both flows, and no existing U-numbered wizard test is
  weakened, deleted or skipped.
- Re-entering after an abandoned reconnect is not an error state: it continues
  or restarts cleanly, exactly as the create flow does.

### Connection loss is actionable, never silent (Req 18)

- The repair surface is reachable **while the connection is broken**. Today
  both the settings surface and its permission check would need the manifest,
  which lives in the unreachable repo; after this issue a member who may repair
  the workspace can open it, see the failure named, and start a reconnect
  without the repo being readable first.
- To make that possible the deployment default store keeps a small server-side
  card beside `workspaces/<id>/backend.json` — enough to name the workspace and
  to authorise its repair (its display name and its owner/settings-holder ids).
  It is written when the workspace's manifest is written (create, and the
  member/role/settings mutations that change those values), **never**
  client-writable: the create body's `storage` field and
  `validateWorkspaceBackend` are unchanged, and nothing of the card is exposed
  beyond the connection surface itself.
- `GET /api/workspaces` no longer **drops** a repo-backed workspace whose
  backend cannot be reached (`server/workspaces.ts` ~line 486 skips it today).
  The row is listed as needing attention, with the reason, so an owner can find
  and open it; a corrupt manifest keeps today's skip. One broken workspace
  still never fails the listing, and the Open dialog's existing no-access
  phrasing is untouched.
- Opening a workspace whose connection is broken shows the named, actionable
  reason (app uninstalled, repo deleted or renamed, permissions revoked, GitHub
  unavailable) — not `“workspace <id>” is no longer there`, not a blank shell,
  not an indefinite spinner. Saving into one likewise reports the reason
  through the existing failure notice; no save silently succeeds, hangs, or
  loses the buffer.
- The server side of that is **one decision point**, not a per-route
  invention: a connection failure resolves through the existing
  `githubFailureDetail` vocabulary to a status that separates "GitHub refused
  or does not have it" from "GitHub is unavailable" (the split
  `connectionFailureStatus` already makes on create), with the sentence as the
  body. A bare 500 carrying an `Error.message` from `backends.forWorkspace` is
  not that, and neither is a raw stack.
- Blob-backed and deployment-default workspaces are behaviourally unchanged by
  every one of the above.

### Out-of-band edits (Req 19)

- A commit made outside the app — a push, or an edit on github.com — is picked
  up on the next read: the file's new content and a new version token come back
  once the branch head has moved, and the cache in
  `server/providers/github/storage.ts` (anchored on the head sha, Req 10) never
  keeps serving the superseded tree past its window. A test pins this against
  the fake's `setFile` out-of-band mutator.
- Files **created** out of band appear in the workspace's file listing, and
  files **deleted** out of band read as absent rather than as stale content.
  Nothing requires a document to have been created by the app.
- A conditional save whose base is stale **because of an out-of-band commit**
  takes the same path as one made stale by another member: a non-colliding edit
  merges cleanly and answers the merged text plus the new version token
  (`merged: true`, PRD 010 Req 12+13), and a colliding edit answers 412 and the
  existing Cancel/Overwrite/Reload dialog. No code path branches on *who* made
  the other change — the merge decision reads versions and text only, and a
  test asserts an out-of-band-vs-in-app pair of saves behaves identically.
- The stance is **documented** in `server/README.md`'s bring-your-own-repo
  section: GitHub repo permissions are the security boundary for BYO
  workspaces, in-app roles bound only what the app itself permits, out-of-band
  edits are legitimate and are neither detected nor policed, and repo history
  retains content the app deletes. Operator walkthrough prose stays #106's.

### Tests and conventions

- Decision logic is **pure `src/lib/`** code (no `react`, no components,
  no `@tauri-apps/*` — `.sandcastle/CODING_STANDARDS.md` § Style) with the
  components a thin shell over it, as `workspaceLifecycle.ts` ↔
  `WorkspaceSwitcher.tsx` and `githubConnectWizard.ts` ↔ `GitHubRepoWizard.tsx`
  already are. A new module's unit file is
  `tests/unit/<kebab-case-module>.test.ts` matching the module name; server
  behaviour extends the existing `tests/unit/server-*.test.ts` files.
- Titles start at the next unused number — **the current maximum is U454, so
  new tests begin at U455** — and `describe` blocks name the contract
  (`describe('PRD 010 Req 18 …')` / `Req 19`). No number is reused and no
  existing test is weakened, deleted or skipped.
- Coverage pins at least: the connection surface's payload for a repo-backed
  workspace and its silence for a default-storage one; the
  `workspace.settings` gate and the 401 guard on the new route(s); reconnect
  accepted, and each refusal named (not repo-backed, unreachable, no write
  access, no manifest at the target) with the stored record unchanged after
  each; the listing keeping a broken repo-backed workspace with its reason; the
  open-and-save failure mapping for a lost connection; out-of-band create,
  edit and delete visible on next read; and the out-of-band stale save merging
  cleanly in one case and 412-ing in the conflicting one.
- Simulating connection loss needs the fake to be able to lose an installation
  (`server/providers/github/fake.ts` has no uninstall mutator today). Add it in
  the style of the existing seams, keeping `count()` / `queueRateLimit()` /
  `queueServerError()` working. **No test and no dev lane reaches github.com.**
- `U370` (`tests/unit/server-github-fake.test.ts`) asserts exactly one GitHub
  host occurrence per host constant in all of `server/`, in `auth.ts`. Keep the
  rule intact; if an occurrence must be added it goes in that same file and the
  test's expectation is updated deliberately in the same commit — never
  weakened to a substring or a count.
- The unit suite runs with `isolate: false`: inject the fake, never
  monkey-patch `globalThis.fetch`, and restore any module-level or global state
  a test touches.
- Every new or changed behaviour carries the repo's citation comment
  (`// PRD 010 Req 18: …` / `Req 19`), per `.sandcastle/CODING_STANDARDS.md` §
  Style and `docs/COMMENT-FORMAT.md`.
- If any new or changed file under `src/` or `tests/e2e/` carries a `SPEC<n>`
  citation, `npm run map` has been run and the regenerated `docs/MAP.md` is
  committed (the gate diffs it). PRD-only citations do not affect it.

### Scope boundaries — what this issue does NOT do

- **No e2e** (#107 owns the Req 22 matrix). The existing e2e suite must keep
  passing and its count floor must not drop.
- **No operator hosting guide** (#106) beyond the `server/README.md` notes this
  issue's routes, config and stance require; and **no delete-copy correction**
  (#106, Req 21).
- No migration of a workspace between backends, no connecting a
  default-storage workspace to a repo, and no disconnecting a repo-backed one.
- No change to `POST /api/workspaces`'s contract, to `validateWorkspaceBackend`
  or the `storage` field's shape, to the BYO layout (#103), to merge-on-save's
  decision logic (#102), or to `MM_STORAGE_BACKEND` semantics.
- No per-user GitHub OAuth, no PAT input, no GitHub sign-in; no in-app history,
  version browsing or merge editor; no detection or policing of out-of-band
  edits (PRD 010 non-goals).
- No new client network call site and no GitHub call from `src/`.

### Verification

- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx vitest run tests/unit/<file>.test.ts`) after each change — not the full
  gate after every edit, and no full-gate baseline at the start of the attempt.
  Baseline with the quick tier only if a baseline is wanted at all.
- `npm run validate:quick` has been run **ONCE**, at the end, in the
  implementer's session, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #105, naming the
  connection surface and where it mounts, the reconnect route and its refusals,
  what makes the repair surface reachable while the connection is broken, what
  changed for out-of-band reads and stale saves, the new U numbers, and the
  gate result.

## Context

PRD 010 (`prd/010-github-repo-storage.md`, parent #97) makes GitHub a peer of
Azure Blob behind the PRD 007 storage seam. This issue is life *after*
connecting; everything it builds on exists. #99 landed
`server/providers/github/auth.ts` (App JWT → installation tokens,
`installationForRepo`, `requestAsInstallation`, `githubFailureDetail` as the
one failure vocabulary, `GitHubApiError.status`) and
`server/providers/github/fake.ts`. #100 landed the provider and its head-sha
cache. #101 landed `server/backends.ts` — the per-workspace record at
`workspaces/<id>/backend.json` in the **deployment default** store, resolved
per request by `backends.forWorkspace(id)`. #102 landed merge-on-save
(`mergeStaleSave` in `server/workspaces.ts` ~line 225, `server/merge.ts`),
which already keys off `readAtVersion` alone and therefore already covers Req
19's merge half — this issue proves and documents it rather than rewriting it.
#103 landed the BYO layout (`server/providers/github/byo.ts`,
`MANIFEST_REPO_PATH`). #104 landed the wizard: `src/lib/githubConnectWizard.ts`
(pure steps, saved state, `decideWizardEntry`, `validateSubdirectory`),
`src/components/GitHubRepoWizard.tsx`, `server/githubByo.ts`
(`/api/github/byo/*`, session-scoped so no caller can name an installation
their own session did not come back from) and `byo` on the lifecycle seam in
`src/platform/hostedWorkspaces.ts`.

Files worth reading first:

- `server/backends.ts` — the record, its validator, `remember` / `forget` /
  `forWorkspace`, and `backendRecordWorkspaceId` (the listing's second trace).
- `server/workspaces.ts` ~line 414–530 — create's fail-fast connect and
  `connectionFailureStatus`, the listing's `catch { continue }`, and the
  per-request `backends.forWorkspace` resolution whose throw is today a bare
  500.
- `server/githubByo.ts` — the wizard's server surface and its session scoping;
  `server/app.ts` ~line 150–165 for how `byo` and `handleWorkspaceApi` are
  dispatched (the connection routes need both the backends and the App auth —
  wiring is the implementer's call).
- `src/components/WorkspaceAccessSettings.tsx` (57 lines) and
  `WorkspaceDangerZone.tsx` — the shape a permission-gated settings section
  takes; `src/App.tsx` ~line 5437–5449 mounts them.
- `src/platform/hosted.ts` ~line 220–303 — `readManifest`'s `enoent` on a
  failed read (the open path Req 18 must make actionable) and `writeTextFile`'s
  412 / `refusal()` handling (the save path, already close).
- `src/lib/workspaceLifecycle.ts` — `WorkspaceListing` and the Open dialog's
  pure half, where a "needs attention" row belongs.
- `server/providers/github/storage.ts` ~line 50–270 — `CACHE_TTL_MS` and the
  head-sha-anchored snapshot that makes out-of-band pickup work;
  `fake.setFile()` is the out-of-band mutator tests use.
- `issue-specs/issue-104.md` and `issue-specs/issue-103.md` — the conventions
  this issue continues.

Gotchas:

- The server runs under plain `node server/index.ts` (native type stripping),
  so new server imports keep the explicit `.ts` extension.
- `src/lib/` modules are pure logic, and there are no `console.*` call sites in
  `src/`.
- This is a hosted-web surface behind the optional `workspaces` capability
  (`src/platform/types.ts`); nothing added may assume the hosted flavor by name
  or break the desktop build, which has no such capability.
- Leaving for GitHub is a full navigation: whatever the reconnect flow needs on
  return — including which workspace it is repairing — must outlive an unload.
- `docs/MAP.md` is generated by `npm run map` and never hand-edited.
