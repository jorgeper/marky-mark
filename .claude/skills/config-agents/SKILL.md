---
name: config-agents
description: Show and interactively change Sandcastle's effort tiers — which harness (claude-code or codex) and model each tier uses and which tier each agent runs at (EFFORT_TIERS / AGENT_TIERS in .sandcastle/config.mts). Use when the owner wants to see or change agent models or harnesses, raise or lower an agent's tier, add a tier, or asks why the loop skipped an issue for effort.
---

# Configure Sandcastle's agents, harnesses and effort tiers

You are editing two blocks at the bottom of `.sandcastle/config.mts`:

- `EFFORT_TIERS` — ordered weakest → strongest, each
  `{ name, harness, model }`. The harness is the CLI the agent runs under:
  `"claude-code"` (Anthropic models) or `"codex"` (OpenAI models). Every
  tier also provisions an issue label `sandcastle:effort-<name>`.
- `AGENT_TIERS` — agent role → tier name. Static: the owner's choice for
  this setup, independent of any issue. Any role can sit on any tier, so
  putting a role on a codex tier is how an agent runs on OpenAI.

The loop (`.sandcastle/main.ts`) resolves each agent's provider through
`agentFor(role)` (`.sandcastle/harness.mts`) and its harness/model through
`harnessFor`/`modelFor` in `.sandcastle/effort.mts`, and skips an issue
labeled `sandcastle:effort-<tier>` until every agent on its path
(spec-writer, implementer, reviewer, merger, conflict-resolver, plus
pr-reviewer and addresser for PR-labeled issues) is configured at that
tier or above. Planner, decomposer, designer and filer are cross-issue
agents: their tier sets their model but never gates an issue.

A codex tier needs `OPENAI_API_KEY` declared in `.sandcastle/.env` (the
env resolver forwards only declared keys into sandboxes — an exported
shell variable is not enough); the sandbox Dockerfile installs both CLIs.
The loop refuses to start, and `npm run sandcastle:doctor` reports, when a
codex tier is in use without the key.

Touch nothing else: not the loop, not the labels, not the prompts.

## 1. Show the current table

Run and print the output verbatim:

```sh
npm run -s sandcastle:agents
```

It lists every tier with its model and label, then every agent with its
tier and model, then any configuration problems. If it exits non-zero, the
config is broken — fix that first (step 3), then continue.

## 2. Ask what to change

Use AskUserQuestion, one question at a time, until the owner is done:

1. **What to change** — one of: an agent's tier, a tier's model or
   harness, add a tier, or nothing (done).
2. For an agent's tier: which agents (multi-select from the table) and
   which tier (single-select from `EFFORT_TIERS`). Offer the shortcuts
   "the whole issue path" (the seven agents named above) and "every agent".
3. For a tier's model or harness: which tier, then the harness
   (`claude-code` or `codex`) if they want it changed, then the model id —
   the model must belong to the tier's harness. Known-good ids (verified
   2026-09-10; both vendors retire ids over time, so accept any id the
   owner types and do not invent one):
   - claude-code: `claude-fable-5-1` (strongest), `claude-opus-5`,
     `claude-sonnet-5`, `claude-haiku-4-5-20251001`.
   - codex: `gpt-5.6-sol` (deep work), `gpt-5.6-terra` (everyday),
     `gpt-5.6-luna` (light); GPT-6 Astra is in staged rollout and may not
     be available to every account.
   When switching a tier to codex, check `.sandcastle/.env` declares
   `OPENAI_API_KEY` (presence only — never read the value) and, if it does
   not, point the owner at `/sandcastle-auth` to set it up.
4. For a new tier: its name (lowercase, label-safe: letters, digits, `-`),
   its harness, its model, and where it sits in the order (weakest →
   strongest). Tell the owner the label `sandcastle:effort-<name>` will
   exist after the next `npm run sandcastle:init`.

Do not ask about anything the owner did not raise. If they gave the full
change in their request ("run the implementer on hard"), skip to step 3.

## 3. Apply

Edit `.sandcastle/config.mts` with targeted string replacements — never
rewrite the file. Keep the comments above each block, the `as const`, and
the `satisfies` clause. Tier names in `AGENT_TIERS` must match a name in
`EFFORT_TIERS` exactly.

Then prove it:

```sh
npm run -s sandcastle:agents
npm run -s sandcastle:test
```

The first re-prints the table (show it); the second runs the Sandcastle
unit suite, whose effort and label tripwires must stay green. If either
fails, fix the config until both pass — never leave the file in a state the
loop would refuse at startup.

## 4. Close

Tell the owner in two or three sentences what changed and what it means
for queued work: which labeled issues are now eligible or newly held. If a
tier was added, remind them to run `npm run sandcastle:init` so the label
exists, and that held issues re-enter on the next `npm run sandcastle` with
no relabeling — the skip note on the issue is per configuration, so a fresh
one appears only if the new setup still falls short.
