---
name: config-agents
description: Show and interactively change Sandcastle's effort tiers — which model each tier uses and which tier each agent runs at (EFFORT_TIERS / AGENT_TIERS in .sandcastle/config.mts). Use when the owner wants to see or change agent models, raise or lower an agent's tier, add a tier, or asks why the loop skipped an issue for effort.
---

# Configure Sandcastle's agents and effort tiers

You are editing two blocks at the bottom of `.sandcastle/config.mts`:

- `EFFORT_TIERS` — ordered weakest → strongest, each `{ name, model }`.
  Every tier also provisions an issue label `sandcastle:effort-<name>`.
- `AGENT_TIERS` — agent role → tier name. Static: the owner's choice for
  this setup, independent of any issue.

The loop (`.sandcastle/main.ts`) resolves each agent's model through
`modelFor(role)` in `.sandcastle/effort.mts`, and skips an issue labeled
`sandcastle:effort-<tier>` until every agent on its path (spec-writer,
implementer, reviewer, merger, conflict-resolver, plus pr-reviewer and
addresser for PR-labeled issues) is configured at that tier or above.
Planner, decomposer, designer and filer are cross-issue agents: their tier
sets their model but never gates an issue.

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

1. **What to change** — one of: an agent's tier, a tier's model, add a
   tier, or nothing (done).
2. For an agent's tier: which agents (multi-select from the table) and
   which tier (single-select from `EFFORT_TIERS`). Offer the shortcuts
   "the whole issue path" (the seven agents named above) and "every agent".
3. For a tier's model: which tier, then the model id. Current Claude ids:
   `claude-fable-5-1` (strongest), `claude-opus-5`, `claude-sonnet-5`,
   `claude-haiku-4-5-20251001`. Accept any id the owner types; do not
   invent one.
4. For a new tier: its name (lowercase, label-safe: letters, digits, `-`),
   its model, and where it sits in the order (weakest → strongest). Tell
   the owner the label `sandcastle:effort-<name>` will exist after the next
   `npm run sandcastle:init`.

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
