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

| Label                       | Goes on | Who sets it            | Meaning                                      |
| --------------------------- | ------- | ---------------------- | -------------------------------------------- |
| `sandcastle`                | issue   | you                    | queue this issue for the loop                |
| `sandcastle:require-pr`     | issue   | you                    | gate it behind a PR + outer review           |
| `sandcastle:in-review`      | PR      | orchestrator           | agent debate in progress                     |
| `sandcastle:ready`          | PR      | orchestrator           | debate settled, awaiting you                 |
| `sandcastle:needs-decision` | PR      | orchestrator           | deadlocked threads await your verdict        |
| `sandcastle:approved`       | PR      | **you, only ever you** | authorize the merge — next run squash-merges |

The merge gate is code-enforced: `sandcastle:approved` present AND zero
unresolved review threads. Agents are hard-forbidden from touching labels.
The orchestrator lazily creates its own status labels if missing, but the
human-applied ones come only from init — it never provisions your input
vocabulary behind your back.

## Day to day

- Label an issue `sandcastle` + `sandcastle:require-pr` → the loop
  implements it, opens a PR, and the reviewer/addresser agents debate it in
  review threads. (`sandcastle` alone = legacy flow: inner review + local
  merge, no PR.)
- Your inbox: `gh pr list --label sandcastle:ready` (self-authored GitHub
  activity never triggers GitHub notifications, so check the labels or the
  run's console output).
- Something not working? `npm run sandcastle:doctor` checks env, tokens,
  the docker image, and labels; `npm run sandcastle -- --help` prints usage.
- Comment on any thread like a normal review — your (unmarked) comments
  route to the addresser agent on the next run. Reply your verdict on
  `⚠️ NEEDS-DECISION` threads.
- Satisfied? Add `sandcastle:approved`. The next run merges, deletes the
  branch, and the issue closes via `Closes #N`.
