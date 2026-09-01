# Sandcastle PR Mode Setup

PR mode (issues labeled `sandcastle:require-pr`) runs entirely as **your own
GitHub account** — no bot account, no GitHub App. Every PR action an agent
performs (opening the PR, commenting, replying) leads with an attribution
marker: `**[agent-name · harness · model]**`, e.g.
`**[pr-reviewer · claude-code · claude-fable-5]**` — so you always know
which agent, on which harness, with which model, acted on your behalf.
Anything unmarked is you. (Set `MARKER_DETAIL = false` in
`.sandcastle/main.mts` for plain `**[agent-name]**` markers.) Because you
author the PRs, GitHub's Approve button is unavailable (authors can't
approve their own PRs) — the merge gate is a **label** instead.

PR descriptions are written by the implementer itself: after the last commit,
its session is resumed for one "pr-writer" turn to produce a human-quality
summary — what the PR does and why, a commit-by-commit walkthrough, key
decisions, files touched — with all branch commits preserved for history
(squash happens only at merge). Set `PR_SUMMARY_DETAILED = false` in
`.sandcastle/main.mts` to drop the walkthrough section for a tighter summary
(fewer pr-writer tokens).

## One-time setup (~2 minutes)

1. **Upgrade your fine-grained PAT** (the `GH_TOKEN` in `.sandcastle/.env`):
   https://github.com/settings/personal-access-tokens — it needs these repo
   permissions on the repos you run sandcastle in:
   - Contents: Read and write
   - Pull requests: Read and write
   - Issues: Read and write
   - Metadata: Read (added automatically)
2. **Run `npm run sandcastle:init`** once per repo — creates the label
   vocabulary below (existing labels are never modified) and prints this
   protocol. No branch protection required (`require approvals: 0` is
   GitHub's default — leave it).

## The label protocol

| Label                       | Goes on | Who sets it                    | Meaning                                      |
| --------------------------- | ------- | ------------------------------ | -------------------------------------------- |
| `sandcastle`                | issue   | you                            | queue this issue for the loop                |
| `sandcastle:require-pr`     | issue   | you                            | gate it behind a PR + outer review           |
| `sandcastle:agent-approve`  | issue   | you                            | same PR flow, reviewer agent approves for you |
| `sandcastle:in-review`      | PR      | orchestrator                   | agent debate in progress                     |
| `sandcastle:ready`          | PR      | orchestrator                   | debate settled, awaiting you                 |
| `sandcastle:needs-decision` | PR      | orchestrator                   | deadlocked threads await your verdict        |
| `sandcastle:approved`       | PR      | you — or the reviewer agent on `sandcastle:agent-approve` issues | authorize the merge — next run squash-merges |

The merge gate is code-enforced: `sandcastle:approved` present AND zero
unresolved review threads. The orchestrator lazily creates its own status
labels if missing, but the human-applied ones come only from init — it never
provisions your input vocabulary behind your back.

Agents are hard-forbidden from touching labels, with exactly one exception:
on an issue you labeled `sandcastle:agent-approve`, the `pr-reviewer` agent
may add `sandcastle:approved` — see below. No agent may ever use GitHub's
Approve button (`gh pr review --approve`) in any mode.

## Agent approval (`sandcastle:agent-approve`)

Label an issue `sandcastle:agent-approve` and you delegate the merge
authorization for that issue's PR to the reviewer agent: you still get the
PR, the review threads, and the full debate — you just don't have to show up
at the end to click anything.

- It implies PR mode, so it works alone or alongside `sandcastle:require-pr`.
- The reviewer approves the same way you would: a PR comment stating it is
  approving on your behalf and why (carrying its `**[pr-reviewer · …]**`
  marker, like every other agent action), then `sandcastle:approved` on the
  PR. The next run merges.
- It approves only when it has nothing outstanding AND every thread is
  resolved. Deadlocks still escalate: `⚠️ NEEDS-DECISION` threads land on
  `sandcastle:needs-decision` and wait for you, delegated or not.
- If the reviewer's turn ends without writing the label on a settled PR, the
  orchestrator writes it and says so in its summary comment — a delegated PR
  never sits waiting on an owner who already stepped back.
- Changed your mind on a PR? Remove `sandcastle:approved` before the next run.

## Day to day

- Label an issue `sandcastle` + `sandcastle:require-pr` → the loop
  implements it, opens a PR, and the reviewer/addresser agents debate it in
  review threads. (`sandcastle` alone = legacy flow: inner review + local
  merge, no PR. `sandcastle:agent-approve` = the same PR flow, but the
  reviewer approves at the end instead of you.)
- Your inbox: `gh pr list --label sandcastle:ready` (self-authored GitHub
  activity never triggers GitHub notifications, so check the labels or the
  run's console output).
- Something not working? `npm run sandcastle:doctor` checks env, tokens,
  the docker image, and labels; `npm run sandcastle -- --help` prints usage.
- Comment on any thread like a normal review — your (unmarked) comments
  route to the addresser agent on the next run. Reply your verdict on
  `⚠️ NEEDS-DECISION` threads.
- Satisfied? Add `sandcastle:approved`. The next run merges, deletes the
  branch, and the issue closes via `Closes #N`. (On
  `sandcastle:agent-approve` issues the reviewer adds that label for you.)
