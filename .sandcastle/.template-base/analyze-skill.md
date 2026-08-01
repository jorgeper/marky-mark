---
name: sandcastle-analyze
description: Analyze Sandcastle run timing data (.sandcastle/logs/timings.jsonl + timestamped agent logs) to find where wall-clock time goes, then propose config/Dockerfile changes that speed up future runs. Use after a slow run, or whenever the owner asks why agents take so long.
---

# Analyze Sandcastle run performance

You are diagnosing where a Sandcastle run's wall-clock time went and
proposing concrete, evidence-backed changes. Never guess: every claim
should cite a number from the data below.

## 1. Gather the data

All paths are relative to the repo root:

- **`.sandcastle/logs/timings.jsonl`** — one JSON object per phase:
  `{ts, phase, ms, ok, issue|pr|round|candidates|branches}`. Phases:
  planner, spec-writer, implementer, reviewer, pr-writer, pr-reviewer,
  addresser, conflict-resolver, merger.
- **`.sandcastle/logs/*.log`** — per-agent logs. Every line starts with a
  `[HH:MM:SS]` UTC timestamp; `--- Run started: <ISO> ---` delimits runs.
  Landmark lines: `ToolName(args)` when a tool call starts, `Agent stopped
after Xs`, `Iteration N finished in Xs`, `Setting up sandbox (new
container) ... done (Xs)`, `Merging to <branch> done (Xs)`,
  `Context window: NNNk`.
- **`.sandcastle/install-tally.json`** — tally of expensive in-sandbox
  installs the image-gap scanner has seen.
- **`.sandcastle/config.mts`** — the knobs you may propose changing.
- **`.sandcastle/Dockerfile`** — what the sandbox image already bakes in.

Prefer a small script (jq/python) over eyeballing for the aggregations.

## 2. Compute

1. **Phase totals** from timings.jsonl: total ms and count per phase, per
   issue/PR, and the share of run wall-clock each phase consumed. Flag
   `ok:false` entries — failed phases that burned time.
2. **Slow-step breakdown** for the top time-consuming phases: in the
   matching `.log` file, compute the gap between consecutive timestamped
   lines. The top gaps are the slowest steps; the line _starting_ a gap
   names what was running (a `Bash(...)` line → that command; prose → model
   thinking/generation; `Setting up sandbox` → container/install overhead).
3. **Test-run census**: count tool-call lines invoking test/verify commands
   (the repo's `VERIFY_COMMANDS`/`QUICK_VERIFY_COMMANDS`, plus obvious
   test runners: `npm test`, `vitest`, `playwright`, `pytest`, `go test`).
   Per attempt, how many FULL-suite runs happened, and what did each cost?
   More than one full run per attempt is the primary "too many tests too
   often" signal.
4. **Sandbox overhead**: sum `Setting up sandbox ... done (Xs)` and compare
   `Iteration N finished in Xs` against `Agent stopped after Xs` — the
   difference is setup/merge/collect overhead per attempt.
5. **Install waste**: tool calls installing things at run time (playwright
   browsers, apt packages, global npm installs) — cross-check whether the
   Dockerfile already bakes them (if so, the image may need a rebuild).
6. **Attempt efficiency**: attempts per issue (timings.jsonl implementer
   entries and `Iteration N/M` lines), idle warnings, and long `sleep`
   polling in tool calls.

## 3. Diagnose → knob map

| Evidence                                                     | Suggestion                                                                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| >1 full verify run per attempt, or full suite dominates gaps | Set `QUICK_VERIFY_COMMANDS` in `.sandcastle/config.mts` to a fast subset (typecheck + unit); the prompts already tell agents to run the full suite only once before finishing |
| Full suite itself slow even once                             | Propose trimming `VERIFY_COMMANDS` (move e2e to CI/debate phase) — owner's call                                                                                               |
| Repeated in-sandbox installs                                 | Add `RUN` lines to `.sandcastle/Dockerfile`, then `npx sandcastle docker build-image`                                                                                         |
| High sandbox setup share                                     | Check `COPY_TO_WORKTREE` covers dependency dirs (e.g. `node_modules`); confirm sandbox reuse ("Reusing live sandbox" lines)                                                   |
| Attempts exhausted without goal met                          | Look at WHY in the log tail before touching `GOAL_MAX_TURNS`/`IMPLEMENT_ATTEMPTS` — usually a spec or environment problem, not a budget problem                               |
| Long `sleep NN` polling in tool calls                        | Note it in the report; this is agent behavior worth a CLAUDE.md/skill rule, not a config knob                                                                                 |
| Many debate rounds per PR                                    | Consider lowering `MAX_DEBATE_ROUNDS` or improving review prompts                                                                                                             |

## 4. Report, then apply on approval

Present a short report: total run time, top 3 time sinks with numbers,
then a ranked list of proposed changes (expected saving, one line of
evidence each). Apply changes only after the owner approves, and only to
`.sandcastle/config.mts`, `.sandcastle/Dockerfile`, or CLAUDE.md — never
edit `.sandcastle/main.ts`/prompt files for tuning. After Dockerfile
changes, remind the owner to rebuild the image.
