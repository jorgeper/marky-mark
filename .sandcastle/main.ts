// Parallel Planner with Review — re-entrant orchestration loop
//
// Each iteration:
//   Phase 0 (Classify):  Deterministic code inspects GitHub state for every
//                        open `Sandcastle` issue and picks an action:
//                          implement | merge | resolve-conflicts |
//                          addresser-turn | reviewer-turn | wait | abandoned
//   Phase 0.5 (Merge):   Approved PRs (owner approval + zero unresolved
//                        threads) are squash-merged — code, no agent.
//   Phase 0.6 (Rebase):  Approved-but-conflicting PRs get a conflict-resolver
//                        agent, then merge on the next pass.
//   Phase 0.7 (Debate):  PRs awaiting an agent turn resume the outer
//                        reviewer ⇄ addresser debate in PR review threads.
//   Phase 1 (Plan):      A Fable agent picks unblocked issues among those
//                        with no open PR (dependency analysis).
//   Phase 2 (Execute):   Per issue: a spec writer distills the issue into a
//                        committed spec (specs/issue-<n>.md, linked from the
//                        issue) and a goal statement; the implementer then
//                        runs in goal mode — Claude Code's native /goal turn
//                        loop self-verifies each attempt, with fresh-context
//                        retries between attempts (see ADR 0021). Issues
//                        labeled `sandcastle:require-pr` then publish a PR and
//                        enter the debate; others keep the legacy inner
//                        reviewer.
//   Phase 3 (Merge):     Legacy branches merge locally via the merger agent.
//
// Issues opt in via labels: `sandcastle` queues an issue for the loop;
// `sandcastle:require-pr` gates it behind a PR. Run `npm run sandcastle:init`
// once per repo to create the label vocabulary. Everything runs as the
// owner's single identity (see PR_SETUP.md): agents mark their comments with
// **[agent-name]** prefixes, and the merge gate is the owner adding the
// `sandcastle:approved` label — GitHub approvals are not used, since authors
// cannot approve their own PRs.
//
// Usage:
//   npx tsx .sandcastle/main.ts              run the loop
//   npx tsx .sandcastle/main.ts --init       create the label vocabulary
//   npx tsx .sandcastle/main.ts --doctor     check env/auth/docker/labels
//   npx tsx .sandcastle/main.ts --help       show usage

import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";
import { parseEnvFile, prSetupGuide, readPrConfig } from "./env.mts";
import { runInstallScan } from "./install-scan.mts";
import {
  APPROVED_LABEL,
  classifyIssue,
  classifyThread,
  type PrSnapshot,
  type ThreadState,
} from "./state.mts";
import * as github from "./github.mts";
import { logStep, timed } from "./timing.mts";
import { printHelp, runDoctor, runInit } from "./setup.mts";
import {
  COPY_TO_WORKTREE,
  GOAL_MAX_TURNS,
  IMPLEMENT_ATTEMPTS,
  INSTALL_COMMAND,
  MARKER_DETAIL,
  MAX_DEBATE_ROUNDS,
  MAX_ITERATIONS,
  PR_SUMMARY_DETAILED,
  QUICK_VERIFY_COMMANDS,
  SPEC_DIR,
  VERIFY_COMMANDS,
} from "./config.mts";
import { effectiveQuickCommands, verifyCommandsText } from "./verify.mts";

const execFileAsync = promisify(execFile);

// --- CLI flags — handled before anything else so they work in a repo that
// --- isn't configured yet. (npm passes them via `npm run sandcastle -- --help`.)
const cliArgs = process.argv.slice(2);
if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
  printHelp();
  process.exit(0);
}
if (cliArgs.includes("--init")) {
  await runInit();
  process.exit(0);
}
if (cliArgs.includes("--doctor")) {
  process.exit(
    await runDoctor({ imageGaps: cliArgs.includes("--image-gaps") }),
  );
}

// The planner emits its plan as JSON inside <plan> tags; Output.object extracts
// and validates it against this schema.
const planSchema = z.object({
  issues: z.array(
    z.object({ id: z.string(), title: z.string(), branch: z.string() }),
  ),
});

// The spec writer emits the goal statement and spec path inside <spec> tags.
// The goal statement is also committed in the spec file's `## Goal` section,
// so a re-run recovers it from git instead of regenerating (idempotency).
const specSchema = z.object({
  goal: z.string(),
  specPath: z.string(),
});

// ---------------------------------------------------------------------------
// Configuration — knobs live in ./config.mts (one place, also read by the
// doctor). Only derived values stay here.
// ---------------------------------------------------------------------------

// Issues carrying this label get a PR + outer review instead of the inner
// reviewer + local merge.
const PR_LABEL = github.REQUIRE_PR_LABEL;

// The branch merges target and PRs diff against.
// The branch the loop runs on — merges, pushes, and the merge phase's
// branchAhead() all anchor here. Derived, never hardcoded: a "master"
// default silently stranded every implemented branch on main-based repos
// (branchAhead was always false, so nothing ever merged).
const TARGET_BRANCH = (
  await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"])
).stdout.trim();

// Models are deliberately NOT configured here: each agent's harness and
// model are declared inline at its sandbox.run()/run() call site, so any
// agent can run a different model (or harness) by editing that one spot.

const branchFor = (issueNumber: number) => `sandcastle/issue-${issueNumber}`;

// Issue-tracker command literals injected into prompts that comment on or
// close issues (merge-prompt, review-prompt). Centralized so a different
// tracker only changes these three lines.
const COMMENT_TASK_COMMAND = 'gh issue comment <ID> --body "<BODY>"';
const CLOSE_TASK_COMMAND = 'gh issue close <ID> --comment "<COMMENT>"';
const VIEW_TASK_COMMAND = "gh issue view <ID>";

// Commits on `branch` not yet in TARGET_BRANCH — the loop's definition of
// shippable work. Derived from GIT STATE, not any single run's commits: a
// fresh-context attempt that merely verifies prior work makes none. 0 for
// both "not started" and "fully merged"; callers must disambiguate with
// goal/judge context.
const branchAheadCount = async (branch: string): Promise<number> => {
  try {
    const { stdout } = await execFileAsync("git", [
      "rev-list",
      "--count",
      `${TARGET_BRANCH}..${branch}`,
    ]);
    return Number.parseInt(stdout.trim(), 10);
  } catch {
    return 0; // branch doesn't exist locally
  }
};

// Hooks run inside the sandbox before the agent starts each iteration.
// The install command comes from the detected toolchain (config.mts).
const hooks = {
  sandbox: { onSandboxReady: [{ command: INSTALL_COMMAND }] },
};

// Copied from the host into the worktree before each sandbox starts.
const copyToWorktree = [...COPY_TO_WORKTREE];

// Prompt-ready rendering of the verify commands, injected as the
// VERIFY_COMMANDS prompt arg everywhere agents are told to verify work.
const VERIFY_TEXT = verifyCommandsText(VERIFY_COMMANDS);

// Inner-loop rendering: the quick subset while iterating (QUICK_VERIFY_TEXT),
// with the full suite reserved for the once-before-done gate. Falls back to
// the full list when QUICK_VERIFY_COMMANDS is empty.
const QUICK_VERIFY_TEXT = verifyCommandsText(
  effectiveQuickCommands(QUICK_VERIFY_COMMANDS, VERIFY_COMMANDS),
);

// ---------------------------------------------------------------------------
// Agent identity & attribution
// ---------------------------------------------------------------------------

// This script IS the config: each agent's harness and model are declared
// inline at its sandbox.run() call site, so any agent can run a different
// model (or harness) by editing that one spot. Pass the same values to
// markerFor so the marker can never drift from what actually ran.

// Every action an agent performs on a PR (opening it, commenting, replying)
// is attributed with this marker, like a signature on behalf of the owner.
const markerFor = (name: string, harness: string, model: string) =>
  MARKER_DETAIL ? `**[${name} · ${harness} · ${model}]**` : `**[${name}]**`;

// ---------------------------------------------------------------------------
// Bot configuration (PR mode only)
// ---------------------------------------------------------------------------

// Missing .env is reported by readPrConfig / --doctor, not a crash here.
const envVars = (() => {
  try {
    return parseEnvFile(readFileSync(new URL("./.env", import.meta.url), "utf8"));
  } catch {
    return {};
  }
})();

// Resolved lazily on the first iteration that sees a `pr`-labeled issue.
let repo = "";
let prInfraReady = false;

const ensurePrInfra = async () => {
  if (prInfraReady) return;
  const { ok, missing } = readPrConfig(envVars);
  if (!ok) {
    console.error(prSetupGuide(missing));
    process.exit(1);
  }
  repo = await github.repoSlug();
  prInfraReady = true;
};

// ---------------------------------------------------------------------------
// PR-mode helpers
// ---------------------------------------------------------------------------

// Resumed against the implementer's own session, so it writes from memory of
// the work — like a human describing the branch they just finished. Inline
// prompt: values are interpolated here in JS (sandcastle only supports
// {{KEY}} substitution for promptFile, not inline prompts).
const prWriterPrompt = (issueNumber: string) => {
  const detailSections = PR_SUMMARY_DETAILED
    ? `## What changed
Walk through the work in commit order, grouped logically — a few bullets or
short paragraphs covering every meaningful change, so a reader understands
the whole branch without opening any commit.

## Key decisions
- the significant choices you made and why (omit section if none)

## Files touched
- path — one-line reason`
    : `## Key decisions
- the significant choices you made and why (omit section if none)

## Files touched
- path — one-line reason`;

  return `You just finished implementing this task. Now write the pull
request description a thoughtful human engineer would write for the commits
you just made. Summarize and explain — the reader should not need to open
individual commits to understand the branch.

Output EXACTLY these two tagged blocks and nothing else. Do not run tools,
make commits, or change any files.

<pr-title>concise imperative summary, max 70 chars</pr-title>
<pr-body>
Fixes #${issueNumber}.

One or two short paragraphs: what this PR does and why — the approach taken
and anything a reviewer should know before reading the diff.

${detailSections}
</pr-body>`;
};

// Push a branch from the sandbox's worktree checkout. Runs on the host so
// agents never need push credentials; PR authorship (the bot) is what GitHub
// shows regardless of who pushes.
const pushBranch = async (worktreePath: string, branch: string) => {
  await execFileAsync("git", [
    "-C", worktreePath, "push", "--force-with-lease", "-u", "origin", branch,
  ]);
};

const snapshotFor = async (issueNumber: number): Promise<PrSnapshot | null> => {
  const pr = await github.findLatestPr(branchFor(issueNumber));
  if (pr === null) return null;
  if (pr.state !== "OPEN") {
    return {
      number: pr.number,
      state: pr.state,
      mergeable: "UNKNOWN",
      labels: [],
      reviewerHasReviewed: true,
      threads: [],
    };
  }
  return github.fetchPrSnapshot(repo, pr.number);
};

const threadsJsonFor = (snapshot: PrSnapshot) =>
  JSON.stringify(
    snapshot.threads.map((t) => ({
      id: t.id,
      isResolved: t.isResolved,
      comments: t.comments.map((c) => ({ body: c.body })),
    })),
    null,
    2,
  );

// Status label + owner review request + summary comment — emitted by code,
// not agents, so the "waiting on you" signal is reliable.
const finalizeDebate = async (prNumber: number) => {
  const snapshot = await github.fetchPrSnapshot(repo, prNumber);
  const open = snapshot.threads
    .map((thread) => ({ thread, state: classifyThread(thread) }))
    .filter(
      (e): e is { thread: (typeof snapshot.threads)[number]; state: ThreadState } =>
        e.state !== null,
    );
  const needsDecision = open.filter((e) => e.state === "awaiting-human");
  const label =
    open.length === 0 ? "sandcastle:ready" : "sandcastle:needs-decision";
  await github.setStatusLabel(prNumber, label);
  // The summary is about to tell the owner to add the approved label —
  // make sure it exists at exactly the moment they'll reach for it.
  await github.ensureLabelsExist([github.APPROVED_LABEL_DEF]);
  const lines = [
    `**[orchestrator]** Debate finished.`,
    `- Unresolved threads: ${open.length} (${needsDecision.length} need your decision)`,
    ...needsDecision.map((e) => `  - ${e.thread.comments[0]?.url ?? e.thread.id}`),
    open.length === 0
      ? `All threads resolved — add the \`${APPROVED_LABEL}\` label when satisfied and the next run merges.`
      : `Reply on the threads above with your verdict, then re-run sandcastle.`,
  ];
  await github.postPrComment(prNumber, lines.join("\n"));
};

// Alternates pr-reviewer and addresser turns on an open sandbox until the PR
// classification leaves the debate states or the reviewer-turn cap is hit.
// `first` is "pr-reviewer" right after PR creation or when author-side
// commits await review; "addresser" when reviewer/owner comments await fixes.
const runDebate = async (
  sandbox: Awaited<ReturnType<typeof sandcastle.createSandbox>>,
  prNumber: number,
  branch: string,
  first: "pr-reviewer" | "addresser",
) => {
  // Status labels are the loop's own output channel — create lazily if
  // missing so a mid-debate label write never fails. Human-applied labels
  // are provisioned only by `npm run sandcastle:init`.
  await github.ensureLabelsExist(github.STATUS_LABEL_DEFS);
  await github.setStatusLabel(prNumber, "sandcastle:in-review");
  let turn = first;
  let reviewerTurns = 0;

  while (true) {
    const snapshot = await github.fetchPrSnapshot(repo, prNumber);
    const threadsJson = threadsJsonFor(snapshot);
    // Agents authenticate with the owner's GH_TOKEN, which Sandcastle
    // already injects into sandboxes from .sandcastle/.env.

    if (turn === "pr-reviewer") {
      reviewerTurns += 1;
      const finalRound = reviewerTurns >= MAX_DEBATE_ROUNDS;
      const model = "claude-fable-5";
      await timed("pr-reviewer", { pr: prNumber, round: reviewerTurns }, () =>
        sandbox.run({
          name: "pr-reviewer",
          maxIterations: 1,
          agent: sandcastle.claudeCode(model),
          promptFile: "./.sandcastle/pr-review-prompt.md",
          promptArgs: {
            AGENT_NAME: "pr-reviewer",
            AGENT_MARKER: markerFor("pr-reviewer", "claude-code", model),
            PR_NUMBER: prNumber,
            REPO: repo,
            THREADS_JSON: threadsJson,
            FINAL_ROUND: String(finalRound),
          },
        }),
      );
      if (finalRound) break;
    } else {
      const model = "claude-fable-5";
      await timed("addresser", { pr: prNumber }, () =>
        sandbox.run({
          name: "addresser",
          maxIterations: 25,
          agent: sandcastle.claudeCode(model),
          promptFile: "./.sandcastle/pr-address-prompt.md",
          promptArgs: {
            AGENT_NAME: "addresser",
            AGENT_MARKER: markerFor("addresser", "claude-code", model),
            PR_NUMBER: prNumber,
            REPO: repo,
            THREADS_JSON: threadsJson,
            BRANCH: branch,
            VERIFY_COMMANDS: VERIFY_TEXT,
            QUICK_VERIFY_COMMANDS: QUICK_VERIFY_TEXT,
          },
        }),
      );
      await pushBranch(sandbox.worktreePath, branch);
    }

    const after = await github.fetchPrSnapshot(repo, prNumber);
    const action = classifyIssue(after);
    if (action.kind === "addresser-turn") turn = "addresser";
    else if (action.kind === "reviewer-turn") turn = "pr-reviewer";
    else break;
  }

  await finalizeDebate(prNumber);
};

// ---------------------------------------------------------------------------
// Conversational-lane visibility — a nudge, never orchestration. Issues
// routed to the design/decompose lanes need the human present for a
// conversation, so this loop only points at them (convention-level
// coupling: label names + a suggestion; no shared code — ADR 0009).
// ---------------------------------------------------------------------------

const nudgeConversationalLanes = async (): Promise<void> => {
  const lanes = [
    { label: "sandcastle:design", script: ".sandcastle/design.ts" },
    { label: "sandcastle:decompose", script: ".sandcastle/decompose.ts" },
  ];
  for (const lane of lanes) {
    try {
      const { stdout } = await execFileAsync("gh", [
        "issue",
        "list",
        "--state",
        "open",
        "--label",
        lane.label,
        "--json",
        "number",
        "--limit",
        "20",
      ]);
      const issues = JSON.parse(stdout) as Array<{ number: number }>;
      if (issues.length === 0) continue;
      const list = issues.map((i) => `#${i.number}`).join(", ");
      const how = existsSync(lane.script)
        ? `npx tsx ${lane.script}`
        : `the ${lane.label} lane (conversational-prd template)`;
      console.log(
        `ℹ ${issues.length} ${lane.label} issue(s) await a conversation (${list}) — run ${how} to tackle them separately.`,
      );
    } catch {
      // Nudges are best-effort; never block the loop on them.
    }
  }
};

// Nudge, not a gate: sandbox worktrees branch from committed history, so an
// uncommitted implementer skill means goal-mode implementers run without
// process rules — and it fails silently. Warn at startup, keep running.
const warnUncommittedSkill = async (): Promise<void> => {
  const skillPath = ".claude/skills/sandcastle-implementer/SKILL.md";
  try {
    await execFileAsync("git", ["cat-file", "-e", `HEAD:${skillPath}`]);
  } catch {
    console.warn(
      `⚠ ${skillPath} is not committed — implementers will run without process rules.\n` +
        `  Fix: git add .claude .sandcastle && git commit && git push (details: npm run sandcastle:doctor)`,
    );
  }
};

// Nudge, not a gate (prd/007): an empty VERIFY_COMMANDS means init deferred
// detection — agents can't be told how to verify until it's set.
const warnEmptyVerifyCommands = (): void => {
  if (VERIFY_COMMANDS.length > 0) return;
  console.warn(
    `⚠ VERIFY_COMMANDS in .sandcastle/config.mts is empty — spec goals and merge checks can't name verification commands.\n` +
      `  Fix: run the "sandcastle-customize" skill from your coding agent in this repo, or edit .sandcastle/config.mts by hand.`,
  );
};

// Nudge, not a gate (prd/007 Tier-1 guard): the loop anchors merges and PRs
// to the branch it runs on — starting it on a side branch is usually an
// accident worth flagging, never blocking.
const warnNonDefaultBranch = async (): Promise<void> => {
  try {
    const { stdout } = await execFileAsync("gh", [
      "repo",
      "view",
      "--json",
      "defaultBranchRef",
      "--jq",
      ".defaultBranchRef.name",
    ]);
    const defaultBranch = stdout.trim();
    if (defaultBranch && defaultBranch !== TARGET_BRANCH) {
      console.warn(
        `⚠ loop is running on "${TARGET_BRANCH}" but the repo's default branch is "${defaultBranch}" — merges and PRs will target "${TARGET_BRANCH}".\n` +
          `  If that's not intended, stop and re-run from "${defaultBranch}".`,
      );
    }
  } catch {
    // Best-effort nudge; never block the loop on gh availability.
  }
};

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

await warnUncommittedSkill();
warnEmptyVerifyCommands();
await warnNonDefaultBranch();
await nudgeConversationalLanes();

// Image-gap nudge (prd/006): logs modified after this instant belong to
// this run's scan window.
const LOOP_START_MS = Date.now();

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log();
  logStep(`=== Iteration ${iteration}/${MAX_ITERATIONS} ===`);
  console.log();

  const openIssues = await github.listSandcastleIssues();
  if (openIssues.length === 0) {
    console.log("No open issues labeled `sandcastle`.");
    const labelNames = await github.listLabelNames().catch(() => []);
    const lower = new Set(labelNames.map((name) => name.toLowerCase()));
    if (!lower.has(github.TRIGGER_LABEL)) {
      console.log(
        "Labels aren't set up in this repo yet — run `npm run sandcastle:init` to create them.",
      );
    }
    console.log(
      "Label an issue `sandcastle` to queue it; add `sandcastle:require-pr` to gate it behind a PR.",
    );
    break;
  }
  if (openIssues.some((issue) => issue.labels.includes(PR_LABEL))) {
    await ensurePrInfra();
  }

  // -------------------------------------------------------------------------
  // Phase 0: classify every issue against GitHub PR state
  // -------------------------------------------------------------------------
  const dispatch: {
    issue: github.IssueInfo;
    snapshot: PrSnapshot | null;
    action: ReturnType<typeof classifyIssue>;
  }[] = [];
  for (const issue of openIssues) {
    const snapshot = issue.labels.includes(PR_LABEL)
      ? await snapshotFor(issue.number)
      : null; // legacy issues never have PRs
    const action = classifyIssue(snapshot);
    dispatch.push({ issue, snapshot, action });
    console.log(`  #${issue.number} → ${action.kind}`);
  }
  const prLabelByNumber = new Map(
    dispatch.map((e) => [e.issue.number, e.issue.labels.includes(PR_LABEL)]),
  );

  // -------------------------------------------------------------------------
  // Phase 0.5: merges for approved PRs (code, no agent — the human checkpoint)
  // -------------------------------------------------------------------------
  let mergedAny = false;
  for (const entry of dispatch) {
    if (entry.action.kind !== "merge") continue;
    console.log(`Merging approved PR #${entry.snapshot!.number} (issue #${entry.issue.number})`);
    await github.mergePr(entry.snapshot!.number);
    // Don't rely on the async "Closes #N" auto-close — finish it now so the
    // next iteration never sees this issue as still open.
    await github.closeIssue(
      entry.issue.number,
      `Completed by Sandcastle — merged PR #${entry.snapshot!.number}.`,
    );
    mergedAny = true;
  }
  if (mergedAny) {
    await execFileAsync("git", ["pull", "--ff-only", "origin", TARGET_BRANCH]);
  }

  // -------------------------------------------------------------------------
  // Phase 0.6: conflict resolution for approved-but-conflicting PRs
  // -------------------------------------------------------------------------
  let debatesOrFixes = 0;
  for (const entry of dispatch) {
    if (entry.action.kind !== "resolve-conflicts") continue;
    debatesOrFixes += 1;
    const branch = branchFor(entry.issue.number);
    console.log(`Resolving conflicts on ${branch} (PR #${entry.snapshot!.number})`);
    const sandbox = await sandcastle.createSandbox({
      branch,
      sandbox: docker(),
      hooks,
      copyToWorktree,
    });
    try {
      await timed("conflict-resolver", { pr: entry.snapshot!.number }, () =>
        sandbox.run({
          name: "conflict-resolver",
          maxIterations: 10,
          agent: sandcastle.claudeCode("claude-fable-5"),
          promptFile: "./.sandcastle/pr-conflict-prompt.md",
          // TARGET_BRANCH is a built-in prompt arg (injected by run()) —
          // passing it in promptArgs is a PromptError that kills the run
          // before it logs anything.
          promptArgs: {
            AGENT_NAME: "conflict-resolver",
            BRANCH: branch,
            VERIFY_COMMANDS: VERIFY_TEXT,
            QUICK_VERIFY_COMMANDS: QUICK_VERIFY_TEXT,
          },
        }),
      );
      await pushBranch(sandbox.worktreePath, branch);
      // Merge is picked up by the next iteration's classification pass.
    } finally {
      await sandbox.close();
    }
  }

  // -------------------------------------------------------------------------
  // Phase 0.7: resume debates awaiting an agent turn
  // -------------------------------------------------------------------------
  for (const entry of dispatch) {
    const { action } = entry;
    if (action.kind !== "addresser-turn" && action.kind !== "reviewer-turn")
      continue;
    debatesOrFixes += 1;
    const branch = branchFor(entry.issue.number);
    console.log(`Resuming debate on PR #${entry.snapshot!.number} (${action.kind})`);
    const sandbox = await sandcastle.createSandbox({
      branch,
      sandbox: docker(),
      hooks,
      copyToWorktree,
    });
    try {
      await runDebate(
        sandbox,
        entry.snapshot!.number,
        branch,
        action.kind === "addresser-turn" ? "addresser" : "pr-reviewer",
      );
    } finally {
      await sandbox.close();
    }
  }

  for (const entry of dispatch) {
    if (entry.action.kind === "close-issue") {
      console.log(
        `  #${entry.issue.number}: PR #${entry.snapshot!.number} already merged — closing the issue.`,
      );
      await github.closeIssue(
        entry.issue.number,
        `Completed by Sandcastle — merged PR #${entry.snapshot!.number}.`,
      );
    }
    if (entry.action.kind === "abandoned")
      console.warn(
        `  ⚠ #${entry.issue.number}: PR closed without merging but issue still open — skipping. Relabel or close the issue to proceed.`,
      );
    if (entry.action.kind === "wait")
      console.log(`  ⏳ #${entry.issue.number}: waiting on owner.`);
  }

  // -------------------------------------------------------------------------
  // Phase 1: Plan — restricted to issues with no open PR
  // -------------------------------------------------------------------------
  // Issues whose goal a previous cycle already verified (ready-to-merge
  // label, applied in Phase 2) skip re-implementation: if the merger died
  // before merging them, re-proving the work costs a full implementer
  // attempt — including its verify gate — for zero new information. Carry
  // them straight to the merge phase; if their branch turns out to be fully
  // merged already, the only missing state-advance is the close.
  const carriedToMerge: { id: string; title: string; branch: string }[] = [];
  for (const entry of dispatch) {
    if (entry.action.kind !== "implement") continue;
    if (entry.issue.labels.includes(PR_LABEL)) continue;
    if (!entry.issue.labels.includes("sandcastle:ready-to-merge")) continue;
    if ((await branchAheadCount(branchFor(entry.issue.number))) > 0) {
      logStep(
        `#${entry.issue.number}: goal already verified — carrying straight to merge.`,
      );
      carriedToMerge.push({
        id: String(entry.issue.number),
        title: entry.issue.title,
        branch: branchFor(entry.issue.number),
      });
    } else {
      console.log(
        `  #${entry.issue.number}: verified and already merged — closing issue.`,
      );
      await github.closeIssue(
        entry.issue.number,
        "🏰 Sandcastle: goal verified in a previous cycle and the branch is already merged — closing (orchestrator safety net).",
      );
    }
  }
  const candidates = dispatch
    .filter((entry) => entry.action.kind === "implement")
    .filter((entry) => !entry.issue.labels.includes("sandcastle:ready-to-merge"))
    .map((entry) => entry.issue.number);

  if (candidates.length === 0 && carriedToMerge.length === 0) {
    console.log("No issues ready for implementation this round.");
    if (mergedAny || debatesOrFixes > 0) continue; // state advanced — reclassify
    console.log("Nothing to do until a human acts. Exiting.");
    break;
  }

  // One candidate needs no planner: a full docker+model run whose only job
  // is choosing among issues has nothing to choose. Dispatch it directly.
  const issues =
    candidates.length === 0
      ? []
      : candidates.length === 1
      ? [
          {
            id: String(candidates[0]!),
            title: dispatch.find((e) => e.issue.number === candidates[0])!
              .issue.title,
            branch: branchFor(candidates[0]!),
          },
        ]
      : (
          await timed("planner", { candidates: candidates.length }, () =>
            sandcastle.run({
              hooks,
              sandbox: docker(),
              name: "planner",
              // One iteration is enough: the planner just needs to read and reason.
              maxIterations: 1,
              agent: sandcastle.claudeCode("claude-fable-5"),
              promptFile: "./.sandcastle/plan-prompt.md",
              promptArgs: {
                CANDIDATE_NUMBERS: candidates.join(", "),
                LIST_TASKS_COMMAND:
                  "gh issue list --state open --label Sandcastle --limit 100 --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'",
              },
              output: sandcastle.Output.object({
                tag: "plan",
                schema: planSchema,
              }),
            }),
          )
        ).output.issues;

  if (candidates.length === 1) {
    logStep(`Single candidate #${candidates[0]} — skipping planner.`);
  }

  if (issues.length === 0 && carriedToMerge.length === 0) {
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute — implementer, then inner review (legacy) or PR + debate
  // -------------------------------------------------------------------------
  // Provision status labels once, before the parallel executors race to
  // apply the ready-to-merge marker.
  await github.ensureLabelsExist(github.STATUS_LABEL_DEFS);
  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: docker(),
        hooks,
        copyToWorktree,
      });

      try {
        const isPrMode = prLabelByNumber.get(Number(issue.id)) === true;

        // Spec step: distill the issue into a committed spec + goal statement.
        // The writer acts like the implementer — its own RALPH: commit and
        // its own 🏰 issue comment (with a clickable link to the spec); it
        // never edits the issue body. Idempotent: if the spec file already
        // exists on the branch, the goal is recovered from its `## Goal`
        // section and no duplicate comment is posted. The committed file is
        // the durable source of truth; the <spec> tag just hands the
        // statement to this script (extractTag pattern, like the pr-writer —
        // sandbox.run has no structured output).
        const specModel = "claude-fable-5";
        const specPath = `${SPEC_DIR}/issue-${issue.id}.md`;
        const specRun = await timed("spec-writer", { issue: issue.id }, async () =>
          sandbox.run({
            name: "spec-writer",
            maxIterations: 1,
            agent: sandcastle.claudeCode(specModel),
            promptFile: "./.sandcastle/spec-prompt.md",
            promptArgs: {
              TASK_ID: issue.id,
              ISSUE_TITLE: issue.title,
              BRANCH: issue.branch,
              SPEC_PATH: specPath,
              REPO: await github.repoSlug(),
              AGENT_MARKER: markerFor("spec-writer", "claude-code", specModel),
              VERIFY_COMMANDS: VERIFY_TEXT,
              QUICK_VERIFY_COMMANDS: QUICK_VERIFY_TEXT,
            },
            completionSignal: "</spec>",
          }),
        );
        const specJson = github.extractTag(specRun.stdout, "spec");
        if (specJson === null) {
          throw new Error(
            `spec-writer for #${issue.id} produced no <spec> tag`,
          );
        }
        const spec = specSchema.parse(JSON.parse(specJson));
        console.log(`  #${issue.id}: spec at ${spec.specPath}`);

        // Push the spec commit right away in every mode so the SHA-pinned
        // link in the spec-writer's issue comment resolves immediately.
        // Non-PR issues merge locally (true merge, SHAs preserved) but only
        // reach origin at the end of a successful run — and never if the
        // goal isn't met — so gating this on PR mode left the link 404ing.
        await pushBranch(sandbox.worktreePath, issue.branch);

        // Implementer in goal mode: the inner /goal turn loop works and
        // self-verifies (judge checks the condition after every turn); the
        // outer iterations are fresh-context retries that continue from git
        // state when an attempt exhausts its turn bound.
        const implementerModel = "claude-fable-5";
        const implement = await timed("implementer", { issue: issue.id }, () =>
          sandbox.run({
            name: "implementer",
            goal: spec.goal,
            goalMaxTurns: GOAL_MAX_TURNS,
            maxIterations: IMPLEMENT_ATTEMPTS,
            agent: sandcastle.claudeCode(implementerModel),
          }),
        );

        if (!implement.goalMet) {
          // Unverified work never merges: keep the branch and commits for the
          // next run's fresh attempt, but hide them from the merge phase and
          // skip the PR flow. The issue stays open, so the loop retries.
          console.warn(
            `  ⚠ #${issue.id}: goal not met after ${implement.iterations.length} attempt(s) — leaving branch for the next run.`,
          );
          return { ...implement, commits: [] };
        }
        // Shippable work is the branch's delta vs the target, not just this
        // run's commits — a verifying re-run makes none (same derive-from-git
        // rule as the merge phase).
        const branchDelta = await branchAheadCount(issue.branch);
        if (implement.commits.length === 0 && branchDelta === 0) {
          // Judge says done and the branch is fully merged: the only missing
          // state-advance is the issue close (a prior merger merged the
          // branch but missed the close). Close deterministically, or the
          // classifier re-dispatches this issue — and its full verify gate —
          // every cycle, forever.
          console.log(
            `  #${issue.id}: goal met and branch already merged — closing issue.`,
          );
          await github.closeIssue(
            Number(issue.id),
            "🏰 Sandcastle: goal verified met and the branch is already merged into the target — closing (orchestrator safety net).",
          );
          return implement;
        }

        if (!isPrMode) {
          // Durable "gate passed" marker: if this run dies before the merge
          // phase (crash, Ctrl-C), the next cycle carries this issue straight
          // to merge instead of paying a full re-implementation to re-prove
          // the goal. The label leaves with the issue when it closes.
          await github.addIssueLabel(
            Number(issue.id),
            "sandcastle:ready-to-merge",
          );
          // Nothing new this run: the merge phase picks the branch up from
          // git state; re-running the inner reviewer would review old work.
          if (implement.commits.length === 0) return implement;
          // Legacy path — inner reviewer commits directly, merger merges later.
          const review = await timed("reviewer", { issue: issue.id }, () =>
            sandbox.run({
              name: "reviewer",
              maxIterations: 1,
              agent: sandcastle.claudeCode("claude-fable-5"),
              promptFile: "./.sandcastle/review-prompt.md",
              // TARGET_BRANCH reaches the prompt via the built-in arg.
              promptArgs: {
                TASK_ID: issue.id,
                BRANCH: issue.branch,
                QUICK_VERIFY_COMMANDS: QUICK_VERIFY_TEXT,
                COMMENT_TASK_COMMAND,
              },
            }),
          );
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        }

        // PR mode — publish and debate instead of the inner reviewer.
        await pushBranch(sandbox.worktreePath, issue.branch);

        // Have the implementer itself write the PR description — it just did
        // the work, so it knows the what, the why, and the decisions. Resume
        // its session for one iteration; fall back to a minimal body if the
        // session can't be resumed or the output doesn't parse.
        let title = issue.title;
        let body: string | null = null;
        if (implement.resume) {
          try {
            const writeup = await timed("pr-writer", { issue: issue.id }, () =>
              implement.resume!(prWriterPrompt(issue.id), {
                name: "pr-writer",
                completionSignal: "</pr-body>",
              }),
            );
            title = github.extractTag(writeup.stdout, "pr-title") ?? title;
            body = github.extractTag(writeup.stdout, "pr-body");
            if (body === null) {
              console.warn(
                `  #${issue.id}: pr-writer produced no <pr-body> tag; using fallback description.`,
              );
            }
          } catch (error) {
            console.warn(`  #${issue.id}: pr-writer failed (${error}); using fallback description.`);
          }
        } else {
          console.warn(
            `  #${issue.id}: implementer session not resumable; using fallback PR description.`,
          );
        }
        body ??= [
          `Fixes #${issue.id} — ${issue.title}.`,
          ``,
          `Implemented over ${implement.commits.length || branchDelta} commit(s); see the commit history for details.`,
        ].join("\n");

        // Guarantee the PR ↔ issue link regardless of what the pr-writer
        // produced — the closing keyword is what ties the chain together.
        const closesLine = new RegExp(`(Closes|Fixes|Resolves) #${issue.id}\\b`).test(
          body,
        )
          ? ""
          : `\n\nCloses #${issue.id}`;
        const prNumber = await github.createPr({
          branch: issue.branch,
          title,
          body: `${markerFor("implementer", "claude-code", implementerModel)} opened this PR.\n\n${body}${closesLine}`,
        });
        console.log(`  #${issue.id}: opened PR #${prNumber}`);
        await runDebate(sandbox, prNumber, issue.branch, "pr-reviewer");
        // Empty commits keeps PR-mode branches out of the local merger phase —
        // their merge gate is the owner's approval on GitHub.
        return { ...implement, commits: [] };
      } finally {
        await sandbox.close();
      }
    }),
  );

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  // Merge-phase input is derived from GIT STATE (branchAheadCount), not just
  // this cycle's results: a previous run may have implemented a branch and
  // died before merging (re-entrancy) — the goal judge then verifies
  // "already done" with zero new commits, and commit-count-only filtering
  // would strand the branch (and re-classify the issue as `implement`
  // forever). Legacy branches ahead of the target merge even with no new
  // commits this cycle; PR-mode branches never merge locally (their gate is
  // owner approval).
  const completedIssues: typeof issues = [];
  for (const [i, outcome] of settled.entries()) {
    const issue = issues[i]!;
    if (outcome.status !== "fulfilled") continue;
    if (prLabelByNumber.get(Number(issue.id))) continue;
    if (
      outcome.value.commits.length > 0 ||
      (await branchAheadCount(issue.branch)) > 0
    ) {
      completedIssues.push(issue);
    }
  }

  // Verified-in-a-previous-cycle issues merge alongside this cycle's work.
  completedIssues.push(...carriedToMerge);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) ready to merge:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    console.log("No local branches to merge this cycle.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge (legacy branches only — PR branches merge via approval)
  // -------------------------------------------------------------------------
  // A merger failure must not kill the loop: the merge input is derived
  // from git state, so the next cycle simply retries it. (An uncaught
  // PromptError here once took the whole process down.)
  try {
  await timed("merger", { branches: completedBranches.length }, () =>
    sandcastle.run({
      hooks,
      sandbox: docker(),
      name: "merger",
      maxIterations: 1,
      agent: sandcastle.claudeCode("claude-fable-5"),
      promptFile: "./.sandcastle/merge-prompt.md",
      promptArgs: {
        BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
        ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
        VERIFY_COMMANDS: VERIFY_TEXT,
        COMMENT_TASK_COMMAND,
        CLOSE_TASK_COMMAND,
        VIEW_TASK_COMMAND,
      },
    }),
  );
  } catch (error) {
    console.error(
      `  ✗ merger failed: ${error instanceof Error ? error.message : error} — continuing; next cycle retries from git state.`,
    );
    continue;
  }

  // PR-mode branches fork from local HEAD but their PR diffs are computed
  // against origin/master — keep the remote in sync with local merges.
  await execFileAsync("git", ["push", "origin", TARGET_BRANCH]);

  // The merger's state-advance is the issue close, and an agent can miss it
  // (it happened: a merged branch's issue stayed open, so the classifier
  // re-dispatched it — and its full verify gate — every cycle). Verify each
  // branch the merger actually merged has a closed issue; close
  // deterministically if not.
  for (const issue of completedIssues) {
    if ((await branchAheadCount(issue.branch)) > 0) continue; // not merged
    const state = (
      await github
        .gh(["issue", "view", issue.id, "--json", "state", "--jq", ".state"])
        .catch(() => "")
    ).trim();
    if (state === "OPEN") {
      console.log(`  #${issue.id}: merged but left open by merger — closing.`);
      await github.closeIssue(
        Number(issue.id),
        "🏰 Sandcastle: branch merged this cycle — closing (orchestrator safety net; the merger missed the close).",
      );
    }
  }

  console.log("\nBranches merged.");
}

// Image-gap nudge (prd/006): scan this run's logs for expensive in-sandbox
// installs and suggest the Dockerfile fix. Best-effort, never blocks.
for (const nudge of await runInstallScan(
  `sandcastle:${basename(process.cwd())}`,
  LOOP_START_MS,
)) {
  console.warn(nudge);
}

console.log("\nAll done.");
