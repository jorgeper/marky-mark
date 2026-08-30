---
name: sandcastle-implementer
description: Process rules for Sandcastle implementer agents working a goal against a committed spec in this repo. Use whenever implementing a Sandcastle issue.
---

# Sandcastle implementer process rules

You are working toward a goal that references a committed spec file (the
goal statement names its path). Read the spec first, then the issue it
names (via `gh issue view <n>`), then any `**PRD:**` file the issue
references.

## Scope

- ONLY work on the single issue the goal names. Never pick up other issues.
- Do not close the issue — the orchestrator does that later.
- Do not push — the orchestrator pushes from the host.

## Orientation

Check `git log -n 10` first: prior attempts on this branch left their state
in commits and the issue's comments. Continue from where they stopped
instead of redoing work.

## Execution

Explore the repo and fill your context with relevant information before
editing. Pay extra attention to test files touching the relevant code.

If applicable, use RGR to complete the task:

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

## Feedback loops

Verify in two tiers, both declared in `.sandcastle/config.mts`:

- **Baseline (start of an attempt):** quick tier ONLY. Never run the full
  `VERIFY_COMMANDS` at the start of an attempt — not even to assess
  inherited state from a previous attempt. If the final gate later fails
  on something your diff can't explain, compare against baseline then
  (e.g. `git stash` + re-run the one failing test).
- **While iterating** run `QUICK_VERIFY_COMMANDS` (or tests targeted at
  the code you changed) after each change. If the list is empty, pick the
  fastest relevant subset of `VERIFY_COMMANDS` yourself.
- **Once, right before declaring the goal met**, run the full
  `VERIFY_COMMANDS` and make sure they pass — the goal judge needs to see
  their output in your session. This should be the ONLY full-suite run of
  the attempt; full-suite runs are the biggest time cost of an attempt.
- **Run the final gate in the FOREGROUND and wait**, even when it takes
  minutes. Never launch it in the background and end your turn to "wait
  for a notification" — in this harness, ending your turn ends the
  session: the suite is orphaned and the entire attempt is wasted. If the
  harness moves a long gate to the background on its own (the foreground
  cap), wait on THAT run — never start a second gate while one is still
  running; two suites at once make every timing-sensitive test fail.
- **A flake is not a gate failure.** If the gate fails only in the e2e
  step and `npm run test:e2e:failed` then passes, the gate counts as
  passed: cite both outputs as the evidence and stop. Do not re-run the
  full gate to "get a clean pass" — issue #177's attempt did that 13
  times (7–10 min each) and never converged. A test that fails again on
  the targeted re-run is a real failure: fix it or report it.

Your repo's CLAUDE.md/AGENTS.md may refine which commands are
appropriate; it overrides these lists.

## Commits

Commit message format:

1. Start with `RALPH:` prefix
2. Task completed + spec/PRD reference
3. Key decisions made
4. Files changed
5. Blockers or notes for the next attempt

Keep it concise.

## The issue

When the work is complete, leave a single comment on the issue recording
what this run did (`gh issue comment <n>`). Lead with
`🏰 **Sandcastle · Implementer** — <branch>`, then keep it concise:

- **Done:** what was built
- **Decisions:** key choices made
- **Files:** files changed

If a comment like this from a prior attempt already covers the finished
work, do not post a duplicate.

If you cannot finish because of a genuine blocker, leave one comment
describing the blocker and what remains — the next fresh-context attempt
will continue from your commits.
