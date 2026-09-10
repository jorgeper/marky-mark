---
name: sandcastle-auth
description: Set up or fix the credentials Sandcastle's agents need — Claude Code OAuth token / Anthropic API key (claude-code tiers), OpenAI API key (codex tiers), GH_TOKEN — via an interactive wizard that writes .sandcastle/.env without secrets ever entering the chat. Use when the owner wants to set up claude or codex auth, the doctor/preflight/loop flags a missing or rejected credential, or .sandcastle/.env is missing.
---

# Set up Sandcastle agent credentials

Credentials live in `.sandcastle/.env` (gitignored). Only keys declared
there reach sandboxed agents — an exported shell variable is not enough.
Which keys are needed follows from the harness column of the tier table:
claude-code tiers need `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`),
codex tiers need `OPENAI_API_KEY`, and PR-mode issue/PR operations need
`GH_TOKEN` regardless of harness.

**Never handle secret values yourself.** Do not read `.env` values, do not
print them, and do not ask the owner to paste a token into the chat — the
wizard exists so secrets go straight from their keyboard to the file. If
the owner pastes a secret into the conversation anyway, write it to
`.sandcastle/.env` for them, then tell them it is now in the session
transcript and recommend rotating it.

## 1. Show what is needed vs. present

Run `npm run -s sandcastle:agents` for the tier table (which harnesses are
in use), then check key **presence only** — for example:

```sh
for k in CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY OPENAI_API_KEY GH_TOKEN; do
  grep -qE "^\s*$k\s*=." .sandcastle/.env 2>/dev/null && echo "$k set" || echo "$k missing"
done
```

Tell the owner which credentials their configuration needs and which are
missing. If everything needed is present and they reported no failure,
offer `npm run sandcastle:doctor` (which live-probes the APIs) instead of
re-entering keys.

## 2. Hand them the wizard

The wizard is interactive (silent prompts, API probes) so the owner runs
it themselves. Tell them to type, at the Claude Code prompt:

```
! bash .claude/skills/sandcastle-auth/wizard.sh
```

It creates `.env` from `.env.example` when missing, offers `claude
setup-token` for the OAuth path, hides all secret input, rejects
obviously-wrong token shapes, updates or appends each key idempotently
(chmod 600), and probes each API so a bad key fails immediately. Mention
which menu entries their config actually needs (e.g. "you only need 3 —
OpenAI — for the codex tier").

## 3. Verify and close

After they've run it, run `npm run -s sandcastle:doctor` and read the
credential lines (agent credentials, OpenAI credentials, GH_TOKEN). Report
the outcome in a sentence or two. If a probe failed, point at the fix (the
wizard again with a fresh key; for GH_TOKEN scope problems,
`.sandcastle/PR_SETUP.md`). Do not edit `.sandcastle/.env` by hand except
for the pasted-secret fallback above.
