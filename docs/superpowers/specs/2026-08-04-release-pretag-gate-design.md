# Release pre-tag CI gate + failure flow — design

Date: 2026-08-04. Owner-approved via brainstorming session. Amends the
behaviour specified in `prd/008-releaser-agent.md` (R10, R11, R15, R17)
and `.sandcastle/release-prompt.md`; implemented directly (not via the
PRD lane) at the owner's direction.

## Problem

The v0.5.0-alpha.1 cut (issue #66) failed in CI **after** the tag was
pushed and the merge-back landed. Two defects:

1. **Environment mismatch.** The releaser's local gate (`npm run
   validate`) runs in a Linux sandbox, but `release.yml`'s `test` job
   runs on `macos-latest` — and it is the only place in the system the
   suite ever runs on macOS (there is no PR CI). A macOS-only failure
   (E150's `Control+Home`, which is a no-op on macOS) is therefore
   structurally guaranteed to surface only after the tag is spent and
   main carries a version bump for a release that doesn't exist.
2. **Silent failure.** `npm run sandcastle` reported the releaser run as
   successful (`timings.jsonl`: `ok:true`; console: "releaser finished")
   because the host's only failure signal is an exception from
   `sandbox.run`. The semantic outcome lives solely in issue comments
   (`CUT_FAILED_MARKER`), which no host code reads back. Worse, the open
   issue re-classifies as `proceed` every run, burning a 20-minute
   sandbox per invocation on a dead cut.

## Goals

- The tag (and merge-back) are only ever spent after the macOS test
  suite has passed on the release branch tip.
- A failed cut files an actionable `sandcastle` bug so the normal
  implement lane fixes it; the release parks while the bug is open and
  auto-retries when it closes.
- The `npm run sandcastle` invocation that runs a releaser reports the
  cut's real outcome on the console and in `timings.jsonl`.

## Non-goals

- No PR-time or on-main macOS CI (cost; revisit if macOS-only breakage
  becomes frequent).
- No tag or release deletion by any agent, ever (unchanged guards).
- The E150 fix itself: filed as a `sandcastle` bug, owned by the
  implement lane, not this change.
- No skip-if-already-green optimisation of `release.yml`'s tag-time
  test job — it stays as the redundant safety net gating the builds.

## Design

### 1. CI: one reusable macOS test job, two callers

- New `.github/workflows/test-suite.yml` — `on: workflow_call`,
  `runs-on: macos-latest`, containing exactly the steps of today's
  `test` job in `release.yml` (checkout, toolchain setup, `npm run
  validate`).
- `release.yml`'s `test` job becomes `uses:
  ./.github/workflows/test-suite.yml`. Tag-time behaviour unchanged.
- New `.github/workflows/release-branch-test.yml` — `on: push:
  branches: ['release/**']`, also `uses` the suite. This is the pre-tag
  gate; it fires automatically on the releaser's branch push. Release
  branches are pushed only at cut time, so no wasted runs.

Drift between the pre-tag gate and the tag-time net is impossible: same
job.

### 2. Runbook: spend the tag only after macOS is green

`release-prompt.md` Phase 2 splits (R11/R15 amendment):

- **Phase 2a — push branch, watch branch CI.** `git push -u origin
  release/v{VERSION}` (no tag). Poll for the `release-branch-test` run
  whose head SHA is the branch tip; wait to terminal state (~once a
  minute, like Phase 3). On failure → failure flow (§3) and STOP —
  nothing is spent: no tag, no merge-back, main untouched. On success
  post one comment starting the new marker
  `🏰 Sandcastle releaser: pre-tag CI green` (`PRETAG_CI_GREEN_MARKER`)
  with the run URL.
- **Phase 2b — tag + merge back, only on green.** Exactly today's tag
  push and merge-back. The merge-back is now gated on pre-tag CI green
  (R15 change): main only ever carries the version files of a cut that
  passed macOS tests.

Phases 0, 1, 3–6 unchanged. Marker constraints: the new marker must not
be a substring of any existing marker or vice versa (the U209
invariant; satisfied — neither full marker string, prefix included,
contains the other).

**Retry semantics.** A re-dispatch after a pre-tag failure re-cuts the
same version: `git checkout -B release/v{VERSION} origin/main` and
**force-push the branch**. Updating a not-yet-tagged release branch is
sanctioned; deleting one remains forbidden. Phase resume continues to
trust reality over markers (a marker whose work is missing is redone
without re-posting the comment).

### 3. Failure flow: file the bug, park the release

On any cut failure — local gate (R10), branch CI (2a), tag-run CI
(Phase 3), or the Windows run (Phase 5) — the releaser:

1. **Files one `sandcastle`-labeled bug issue**: title
   `Release cut failed: <failing step/test>`; body carries the failing
   step or test id, the CI run URL, the evidence tail, and a note that
   it blocks release issue #N. **Dedup:** if the newest cut-failed
   comment on the release issue already links an open bug, do not file
   another.
2. **Posts the cut-failed comment** (existing `CUT_FAILED_MARKER`)
   including a machine-readable line on its own line:

       Blocked-by: #<bug-number>

   and text telling the owner the fix flows through `npm run
   sandcastle`, and that the release retries automatically once the bug
   closes.

### 4. Host lane: parking, loud outcome reporting

`release-lane.mts` (pure, unit-tested) gains:

- `parseBlockedBy(commentsJson): number | null` — the `Blocked-by: #n`
  from the **newest** comment containing `CUT_FAILED_MARKER`, else null.
- New classifier inputs: `cutFailedPosted: boolean`,
  `blockedByBug: number | null`, `blockingBugOpen: boolean | null`
  (host resolves the bug's state impurely before classifying).
- New action kind `parked`, checked **before** the tag-pushed resume:
  - cut-failed posted + linked bug open → `{ kind: "parked", bug }` —
    console `release #N → parked on bug #M`, no sandbox.
  - cut-failed posted + linked bug closed → fall through to the normal
    resume/proceed path (re-dispatch).
  - cut-failed posted + no parseable `Blocked-by` (e.g. legacy #66) →
    `{ kind: "parked", bug: null }` with a console warning naming the
    owner's move. Never dispatch a sandbox at a known-dead cut.
- `releaseOutcome(commentsJson)` — pure map from the newest phase marker
  to `{ level: "ok" | "failed" | "incomplete", text }`: `ok` only for
  `AWAITING_PUBLISH_MARKER` (the sole terminal success), `failed` for
  `CUT_FAILED_MARKER` as the newest marker, `incomplete` for any other
  newest marker (the run ended mid-cut).

`main.ts` after `sandbox.run` resolves: re-fetch the issue comments,
compute `releaseOutcome`, and

- print it loudly — e.g.
  `✖ release #66: CUT FAILED — bug #67, fix via npm run sandcastle` or
  `✔ release #66: cut complete, awaiting publish — <draft URL>`;
- record `ok:false` in `timings.jsonl` for `failed` and `incomplete`
  outcomes (mechanism chosen at implementation, e.g. throwing a typed
  error inside the `timed` callback that the lane catches to print the
  outcome line instead of the generic infrastructure warning).

Unit tests cover `parseBlockedBy`, `releaseOutcome`, the new classifier
states, and the marker-substring invariant extended to the new marker,
alongside the existing release-lane tests.

### 5. One-time cleanup (#66 / v0.5.0-alpha.1)

- File the E150 bug now (`sandcastle` label): `Control+Home` at
  `tests/e2e/live-preview.spec.ts:212` and `:299` is a no-op on macOS;
  needs a platform-correct go-to-document-start (fix shape is the
  implement lane's call).
- Close #66 with a comment: cut abandoned, version spent, superseded by
  the next `/new-release` (0.5.0-alpha.2) once the fix lands.
- Tag `v0.5.0-alpha.1` and branch `release/v0.5.0-alpha.1` remain, per
  the immutability rules. Main keeps the alpha.1 version bump; the
  alpha.2 cut supersedes it.

## Error handling

- Bug filing fails (gh error): still post the cut-failed comment,
  without `Blocked-by`; the lane parks with the no-bug warning and the
  owner intervenes. Failure to file never blocks the failure report.
- Branch CI run not found after push (trigger lag): poll with a bounded
  wait before concluding; if it genuinely never appears, treat as a cut
  failure (evidence: `gh run list` output).
- `release-lane` classification unable to resolve the blocking bug's
  state: park with a warning (fail safe — never dispatch on unknown
  state).

## Testing

- Unit (`npm run test:unit`): new pure functions + classifier states as
  in §4.
- Workflow YAML: `npm run validate:quick` file checks; correctness of
  the `workflow_call` factoring is verified on the first real cut (the
  reusable job is exercised by both callers).
- Manual/dry-run: pushing a throwaway `release/v0.0.0-test` branch to
  confirm `release-branch-test.yml` triggers, then deleting nothing —
  the branch stays per the rules — is at the owner's discretion; not
  automated.
