# Spec: Releaser groundwork: release/* branches are permanent, exempt from all cleanup (#57)

## Goal

All acceptance criteria in issue-specs/issue-57.md are satisfied for issue #57, with evidence visible in the session: every live branch-deletion site in the Sandcastle tooling (`mergePr` in `.sandcastle/github.mts` and the approval-gate merge in `.sandcastle/design.ts`) explicitly exempts `release/*` branches via a shared permanence guard; unit tests demonstrate that a `release/vX.Y.Z` head branch survives the merge/cleanup path that deletes other merged branches; all Sandcastle tests pass via `npx vitest run .sandcastle/ --config /dev/null`; and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- A shared branch-permanence guard (a pure, exported predicate — e.g. in `.sandcastle/github.mts` or `.sandcastle/shared.ts`) exists that classifies exactly `release/*` branches as permanent: `release/v0.5.0` and `release/v1.2.3-alpha.1` are permanent; `sandcastle/issue-42`, `main`, `releases/x`, and `my-release/v1` are not.
- Both live branch-deletion sites route through that guard, with the `release/*` exemption explicit and visible in the code at each site:
  - `mergePr` in `.sandcastle/github.mts` (today: `gh pr merge --squash --delete-branch`): merging a PR whose head branch matches `release/*` succeeds without deleting the branch (no `--delete-branch`, no other deletion path); PRs from any other branch keep today's delete-on-merge behavior.
  - The `sandcastle:approved` merge in `.sandcastle/design.ts` (today: `gh pr merge <url> --squash --delete-branch`): same exemption, same preserved behavior for non-release branches.
- No unguarded deletion sites remain: a search over `.sandcastle/` (excluding the vendored `.template-base/` snapshot — see Context) for branch-deletion forms (`--delete-branch`, `branch -D`/`-d`, `push --delete`, `push origin :`) finds only sites that route through the guard.
- Unit tests exist alongside the existing `.sandcastle/*.test.mts` suites (e.g. extending `.sandcastle/github.test.mts`) and pass, covering: the guard's positive and negative cases above, and a verifiable check that the cleanup path preserves `release/*` — e.g. asserting the constructed `gh` merge arguments omit `--delete-branch` for a `release/vX.Y.Z` head while including it for a `sandcastle/issue-N` head. Structure the merge-arg construction as a pure, testable seam rather than mocking `gh` end-to-end.
- The full Sandcastle suite passes: `npx vitest run .sandcastle/ --config /dev/null` (these files are outside `npm run test:unit`'s `tests/unit/**` include, so they must be run with this command; it completes in ~1s).
- Iterate with `npm run typecheck` and the targeted test command above (`npx vitest run .sandcastle/github.test.mts --config /dev/null` while editing) — note `tsconfig.json` does not include `.sandcastle/`, so the vitest run is the real signal for this change. Run the full gate `npm run validate:quick` ONCE, right before declaring the goal met (not after every change, and not as a starting baseline), and it prints `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #57.

## Context

This is PRD 008 (`prd/008-releaser-agent.md`) requirement R14, groundwork for R15 (merge-back) and future hotfix cuts: merging a `release/*` branch into main must never trigger its deletion. Parent issue: #25.

The only two live deletion sites in the repo today are `.sandcastle/github.mts:223` (`mergePr`, called from `main.ts` for issue PRs and PRD PRs) and `.sandcastle/design.ts:165`. `mergePr` currently takes only a PR number and doesn't know the head branch — the implementer must obtain it (e.g. `gh pr view --json headRefName`, or thread it from callers, which already know the branch in most paths). `.sandcastle/.template-base/` contains a vendored copy of `github.mts` with the same call; it is the upstream template baseline used for upgrade diffs, not executed code — leave it unchanged. The merger agent prompt (`.sandcastle/merge-prompt.md`) only merges into the current branch and deletes nothing; no change needed there.

Existing test style: see `.sandcastle/github.test.mts` (vitest, pure-function tests over exported helpers like `extractTag`/`parsePrView`). Follow `.sandcastle/CODING_STANDARDS.md`.
