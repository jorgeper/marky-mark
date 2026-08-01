---
name: sandcastle-customize
description: Detect this repo's toolchain and set Sandcastle's verify commands (VERIFY_COMMANDS in .sandcastle/config.mts). Use when init deferred detection, when doctor flags the knob, or when the repo's verification tooling changed.
---

# Customize Sandcastle for this repo

You are configuring the Tier-2 knobs in `.sandcastle/config.mts` — the
single place Sandcastle's agents learn how to install and verify in this
repo. v1 scope: the toolchain block (`TOOLCHAIN`, `INSTALL_COMMAND`,
`COPY_TO_WORKTREE`, `VERIFY_COMMANDS`, `QUICK_VERIFY_COMMANDS`).

`QUICK_VERIFY_COMMANDS` is the fast inner-loop subset (typecheck + unit
tests, no e2e/browser suites) agents run while iterating; the full
`VERIFY_COMMANDS` runs once before work is declared done. Leave it empty
to disable tiering. The `sandcastle-analyze` skill proposes values from
actual run timing data.

## 1. Inspect the repo

Gather evidence before proposing anything:

- Manifests: `package.json` (+ lockfile → npm/pnpm/yarn/bun),
  `src-tauri/tauri.conf.json` (Tauri), `go.mod`, `pyproject.toml`
  (+ `uv.lock`/`poetry.lock`).
- `package.json` `scripts`: which are verification-shaped (`typecheck`,
  `test`, `test:*`, `lint`, `check`, `validate*`)? Which actually run fast
  enough for an agent inner loop (unit tests yes; e2e/browser suites
  usually no)?
- CI config (`.github/workflows/*`): what does CI actually run to gate
  merges?
- `CLAUDE.md` / `AGENTS.md`: any stated rules about verification — these
  override everything else.

## 2. Propose

Tell the owner what you detected (project type + evidence) and propose a
`VERIFY_COMMANDS` list with one line of reasoning per command. Prefer 2-3
fast, canonical commands over an exhaustive list. If the evidence is
ambiguous, ask — don't guess.

## 3. Apply on approval

Edit `.sandcastle/config.mts` only after the owner approves:

- Set `VERIFY_COMMANDS` to the approved list.
- Correct `TOOLCHAIN`, `INSTALL_COMMAND`, and `COPY_TO_WORKTREE` if they
  don't match the repo (e.g. pnpm repo with `npm install`).
- Delete any `TODO(sandcastle)` comment left by init's "detect later".

## 4. Point at the receipt

End by telling the owner to run `npm run sandcastle:doctor` — it verifies
the declared scripts exist and the rest of the setup holds.
