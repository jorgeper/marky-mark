# Spec: Close the PRD 010 verification matrix: provider contract, merge unit coverage, and e2e against the GitHub fake (#107)

## Goal

All acceptance criteria in issue-specs/issue-107.md are satisfied for issue
#107, with evidence visible in the session: every clause of PRD 010 Req 22 is
covered by a named test (provider contract run against the GitHub provider,
merge-on-save decision units, and — the standing gap — desktop-shim e2e for the
new-workspace storage choice, the wizard happy path and restart, a merged
concurrent save and a conflicting one) driven by the local GitHub API fake with
no test reaching github.com, the no-network rule is pinned by a test that also
sees the e2e lane's own boot config, `npm run validate:quick` passes once at the
end, and a summary comment from the implementer exists on issue #107.

## Acceptance criteria

- The Req 22 matrix is closed clause by clause, and the mapping is legible: for
  each clause — provider contract, merge decision (clean / conflict / 412
  fallback), e2e new-workspace choice, e2e wizard happy path, e2e wizard
  restart, e2e merged concurrent save, e2e conflicting concurrent save — a test
  id covers it, and the issue comment lists which id covers which clause.
  Clauses already covered by sibling issues (#99–#105) are *not* re-implemented;
  they are named as already-covered, and only genuine gaps get new tests.
- Unit — provider contract: the GitHub `StorageProvider` runs the one shared
  suite (`describeStorageContract` in `tests/unit/storage-contract.ts`, driven
  today from `tests/unit/server-github-storage.test.ts` alongside the in-memory
  reference run in `tests/unit/server-workspaces.test.ts`). If the audit finds a
  seam expectation asserted for only one backend, it moves into the shared suite
  so both runs get it rather than being restated per backend.
- Unit — merge-on-save: the decision logic is covered as pure functions for a
  clean merge, a conflict, and the 412 fallback (a base version the backend
  cannot resolve, and a provider with no merge capability). Existing coverage
  lives in `tests/unit/server-merge.test.ts` and
  `tests/unit/server-merge-save.test.ts`; gaps are filled there, and nothing
  already covered is duplicated.
- E2e — the known gap: a desktop-shim Playwright spec (new file under
  `tests/e2e/`, or a clearly separated block in an existing one) exercises,
  against a hosted server configured with the GitHub backend:
  - the new-workspace flow offering the two storage choices and letting the
    admin pick **connect your GitHub repo** (`new-workspace-storage-default` /
    `new-workspace-storage-github`);
  - the wizard happy path end to end — install step, repo pick, branch +
    optional subdirectory, confirm — landing in a created BYO workspace whose
    files read back from the repo branch (`github-wizard-*` test ids);
  - the wizard's restartability: an abandoned or unresolved round trip
    re-entered later resumes or restarts cleanly with a named state, never a
    stuck step or a raw status code;
  - a concurrent save that merges cleanly — a second writer's non-overlapping
    change lands first, the in-app save succeeds, the editor shows the merged
    text with the merged notice and a clean (saved) buffer;
  - a concurrent save that conflicts — an overlapping change makes the save
    fail 412 and the existing `save-conflict-prompt` Cancel/Overwrite/Reload
    dialog appears unchanged.
- Every new test carries the next unused stable id (`E<n>` for desktop e2e —
  the suite's highest today is E220; `U<n>` for unit — highest today is U474),
  numbers are never reused or renumbered, and no existing test is weakened,
  deleted, or marked `.skip` / `.only` / `.fixme`.
- The GitHub-backed e2e lane boots from repo tooling alone and offline: the
  fake's own `listen()` (`server/providers/github/fake.ts`) serves the API, the
  server is pointed at it through `MM_GITHUB_API_BASE` / `MM_GITHUB_WEB_BASE`
  with `MM_STORAGE_BACKEND=github` and an App keypair generated at boot, and the
  lane is wired the way the Azurite lane is (a `webServer` entry in
  `playwright.config.ts` backed by a package.json script, on its own port that
  collides with neither 4923 nor 4924). No credential, no network, no manual
  step: a clean checkout runs it.
- The no-network rule is pinned by a test rather than by convention: the guard
  in `tests/unit/server-github-fake.test.ts` (U370 — GitHub host strings confined
  to `server/providers/github/auth.ts`, and no test naming the API host) is
  extended, or a sibling unit test is added, so the new e2e lane's boot script,
  Playwright config and spec are inside the scanned scope. A future test or
  script that points at the real GitHub API fails the unit suite.
- `E2E_TEST_FLOOR` in `scripts/validate.mjs` is raised to the suite's new
  collected count, with its comment noting what issue #107 added — the floor
  keeps meaning "this many tests exist".
- New and changed code carries the repo's citation comments (`PRD 010 Req <n>:`
  / `SPEC<n> §x.y:` per `docs/COMMENT-FORMAT.md` and
  `.sandcastle/CODING_STANDARDS.md`), and `docs/MAP.md` is regenerated with
  `npm run map` if the gate reports it stale.
- Iteration used `npm run typecheck` and `npm run test:unit` (plus single e2e
  runs via `npx playwright test -g '<title>'` while debugging one behaviour);
  the full gate was NOT run as a start-of-attempt baseline.
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #107, naming the
  clause→test-id mapping and the gate result.

## Context

The issue is an audit, not a green field: siblings #99–#105 already shipped most
of Req 22. Before writing anything, grep what exists —
`tests/unit/storage-contract.ts` (the one shared provider-contract suite, run
against both the in-memory reference and the GitHub provider),
`tests/unit/server-github-storage.test.ts`, `server-github-fake.test.ts`,
`server-github-byo.test.ts`, `server-merge.test.ts`, `server-merge-save.test.ts`
— so the work lands on the actual gap.

That gap is e2e: nothing under `tests/e2e/` touches GitHub-backed storage today.
The pieces to assemble it are all in place. `server/providers/github/fake.ts`
exports `handler` and `listen()` precisely so an e2e lane can point a real server
process at it (pinned by U369). `server/config.ts` reads `MM_STORAGE_BACKEND`,
`MM_GITHUB_API_BASE`, `MM_GITHUB_WEB_BASE`, `MM_GITHUB_APP_ID`,
`MM_GITHUB_PRIVATE_KEY`, `MM_GITHUB_APP_SLUG` and `MM_GITHUB_DEFAULT_REPO`.
`server/local.ts` is the model for a boot script (it builds the SPA if stale,
starts its dependency, then imports `./index.ts`), and `playwright.config.ts`
shows how a second server becomes a `webServer` entry. `tests/e2e/hosted.spec.ts`
shows the shape of a hosted spec: a `const HOSTED = 'http://localhost:4924'`
base, a `signIn` helper minting a mock bearer token, and API calls used to set up
the second-writer side of a concurrency test.

For the wizard, the return from GitHub's consent page is read off the URL —
`readGitHubReturn` / `decideWizardEntry` in `src/lib/githubConnectWizard.ts`,
with saved progress under `WIZARD_STATE_KEY` in localStorage — so an e2e test can
simulate the round trip by navigating back with the `installation_id` and `state`
parameters instead of driving a consent page. UI surfaces:
`src/components/WorkspaceSwitcher.tsx` (`new-workspace-storage*`),
`src/components/GitHubRepoWizard.tsx` (`github-wizard-*`),
`src/components/WorkspaceConnectionSettings.tsx` (`workspace-connection-*`), and
`save-conflict-prompt` plus the merged-save handling in `src/App.tsx` (grep
`planMergedSave`).

Costs, per CLAUDE.md: `npm run typecheck` + `npm run test:unit` are the seconds-
long inner loop; `npm run test:e2e` is minutes and serialized machine-wide, so
debug one test with `npx playwright test -g '<title>'`. Run
`npm run validate:quick` once, at the end.
