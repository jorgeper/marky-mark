// ---------------------------------------------------------------------------
// Configuration — every knob for this template, in one place (prd/007).
// Imported by main.mts (the loop) and setup.mts (doctor): keep it pure
// consts, no logic and no side effects. Edit by hand any time, or run the
// "sandcastle-customize" skill from your coding agent to update the
// toolchain block below.
// ---------------------------------------------------------------------------

// Repo-relative directory where per-issue specs are committed. Rename to
// "prd", "docs/specs", etc. — the spec writer, goal statements, and issue
// comments all follow it. Specs land at `<SPEC_DIR>/issue-<n>.md`.
export const SPEC_DIR = "issue-specs";

// Inner turn bound for each implementer attempt: "or stop after N turns" is
// appended to the goal so a stalled attempt ends and the next fresh-context
// attempt takes over instead of spinning forever.
export const GOAL_MAX_TURNS = 25;

// Outer fresh-context attempts per issue (`maxIterations` of the goal run).
// Each attempt is a full autonomous /goal session, so keep this small.
export const IMPLEMENT_ATTEMPTS = 4;

// Maximum number of classify→plan→execute→merge cycles before stopping.
export const MAX_ITERATIONS = 10;

// Reviewer turns per debate invocation before deadlocked threads escalate to
// the owner as NEEDS-DECISION.
export const MAX_DEBATE_ROUNDS = 3;

// When true, PR/issue markers carry full provenance: **[agent · harness ·
// model]**. Set false for plain **[agent]** markers. Turn-taking parses the
// agent name either way.
export const MARKER_DETAIL = true;

// When true (default), PR descriptions include a commit-by-commit
// walkthrough so the owner never has to click into individual commits.
// False keeps the tighter what/why summary — fewer pr-writer tokens.
export const PR_SUMMARY_DETAILED = true;

// --- Toolchain (written by `sandcastle init` from detection; prd/007) ------

// Detected project archetype — informational, drives nothing at runtime.
export const TOOLCHAIN = "tauri";

// Runs inside the sandbox before the agent starts each iteration
// (hooks.sandbox.onSandboxReady).
export const INSTALL_COMMAND = "npm install";

// Host paths copied into the worktree before each sandbox starts.
export const COPY_TO_WORKTREE = ["node_modules"];

// The canonical verification suite for this repo. Injected into every
// prompt that tells an agent to verify its work (spec goals, merges,
// conflict resolution, review fixes) and checked by `--doctor`. Repo
// nuance (e.g. "test:e2e is too slow for the inner loop") belongs in your
// CLAUDE.md/AGENTS.md, which agents read and which overrides this list.
export const VERIFY_COMMANDS: string[] = ["npm run validate:quick"];

// Inner-loop subset of VERIFY_COMMANDS: what agents run while iterating
// (after each change), as opposed to the full suite they must pass once
// before declaring work done. validate:quick includes the Playwright
// desktop-shim e2e suite, which is far too slow to re-run per change —
// iterate on typecheck + unit tests instead.
export const QUICK_VERIFY_COMMANDS: string[] = [
  "npm run typecheck",
  "npm run test:unit",
];
