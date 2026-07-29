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
//   Phase 1 (Plan):      An opus agent picks unblocked issues among those
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
//   npx tsx .sandcastle/main.mts              run the loop
//   npx tsx .sandcastle/main.mts --init       create the label vocabulary
//   npx tsx .sandcastle/main.mts --doctor     check env/auth/docker/labels
//   npx tsx .sandcastle/main.mts --help       show usage

import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";
import { parseEnvFile, prSetupGuide, readPrConfig } from "./env.mts";
import {
  APPROVED_LABEL,
  classifyIssue,
  classifyThread,
  type PrSnapshot,
  type ThreadState,
} from "./state.mts";
import * as github from "./github.mts";
import { printHelp, runDoctor, runInit } from "./setup.mts";

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
  process.exit(await runDoctor());
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
// Configuration — every knob for this template, in one place
// ---------------------------------------------------------------------------

// Repo-relative directory where per-issue specs are committed. Rename to
// "prd", "docs/specs", etc. — the spec writer, goal statements, and issue
// comments all follow it. Specs land at `<SPEC_DIR>/issue-<n>.md`.
const SPEC_DIR = "specs";

// Inner turn bound for each implementer attempt: "or stop after N turns" is
// appended to the goal so a stalled attempt ends and the next fresh-context
// attempt takes over instead of spinning forever.
const GOAL_MAX_TURNS = 25;

// Outer fresh-context attempts per issue (`maxIterations` of the goal run).
// Each attempt is a full autonomous /goal session, so keep this small.
const IMPLEMENT_ATTEMPTS = 4;

// Maximum number of classify→plan→execute→merge cycles before stopping.
const MAX_ITERATIONS = 10;

// Reviewer turns per debate invocation before deadlocked threads escalate to
// the owner as NEEDS-DECISION.
const MAX_DEBATE_ROUNDS = 3;

// Issues carrying this label get a PR + outer review instead of the inner
// reviewer + local merge.
const PR_LABEL = github.REQUIRE_PR_LABEL;

// The branch merges target and PRs diff against.
const TARGET_BRANCH = "master";

// When true, PR/issue markers carry full provenance: **[agent · harness ·
// model]**. Set false for plain **[agent]** markers. Turn-taking parses the
// agent name either way.
const MARKER_DETAIL = true;

// When true (default), PR descriptions include a commit-by-commit
// walkthrough so the owner never has to click into individual commits.
// False keeps the tighter what/why summary — fewer pr-writer tokens.
const PR_SUMMARY_DETAILED = true;

// Models are deliberately NOT configured here: each agent's harness and
// model are declared inline at its sandbox.run()/run() call site, so any
// agent can run a different model (or harness) by editing that one spot.

const branchFor = (issueNumber: number) => `sandcastle/issue-${issueNumber}`;

// Hooks run inside the sandbox before the agent starts each iteration.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};

// Copy node_modules from the host into the worktree before each sandbox
// starts.
const copyToWorktree = ["node_modules"];

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
      const model = "claude-opus-4-8";
      await sandbox.run({
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
      });
      if (finalRound) break;
    } else {
      const model = "claude-opus-4-8";
      await sandbox.run({
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
        },
      });
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

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

await warnUncommittedSkill();
await nudgeConversationalLanes();

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

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
      await sandbox.run({
        name: "conflict-resolver",
        maxIterations: 10,
        agent: sandcastle.claudeCode("claude-opus-4-8"),
        promptFile: "./.sandcastle/pr-conflict-prompt.md",
        promptArgs: {
          AGENT_NAME: "conflict-resolver",
          BRANCH: branch,
          TARGET_BRANCH,
        },
      });
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
  const candidates = dispatch
    .filter((entry) => entry.action.kind === "implement")
    .map((entry) => entry.issue.number);

  if (candidates.length === 0) {
    console.log("No issues ready for implementation this round.");
    if (mergedAny || debatesOrFixes > 0) continue; // state advanced — reclassify
    console.log("Nothing to do until a human acts. Exiting.");
    break;
  }

  const plan = await sandcastle.run({
    hooks,
    sandbox: docker(),
    name: "planner",
    // One iteration is enough: the planner just needs to read and reason.
    maxIterations: 1,
    agent: sandcastle.claudeCode("claude-opus-4-8"),
    promptFile: "./.sandcastle/plan-prompt.md",
    promptArgs: { CANDIDATE_NUMBERS: candidates.join(", ") },
    output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
  });

  const issues = plan.output.issues;

  if (issues.length === 0) {
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
        const specModel = "claude-opus-4-8";
        const specPath = `${SPEC_DIR}/issue-${issue.id}.md`;
        const specRun = await sandbox.run({
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
          },
          completionSignal: "</spec>",
        });
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
        const implementerModel = "claude-opus-4-8";
        const implement = await sandbox.run({
          name: "implementer",
          goal: spec.goal,
          goalMaxTurns: GOAL_MAX_TURNS,
          maxIterations: IMPLEMENT_ATTEMPTS,
          agent: sandcastle.claudeCode(implementerModel),
        });

        if (!implement.goalMet) {
          // Unverified work never merges: keep the branch and commits for the
          // next run's fresh attempt, but hide them from the merge phase and
          // skip the PR flow. The issue stays open, so the loop retries.
          console.warn(
            `  ⚠ #${issue.id}: goal not met after ${implement.iterations.length} attempt(s) — leaving branch for the next run.`,
          );
          return { ...implement, commits: [] };
        }
        if (implement.commits.length === 0) return implement;

        if (!isPrMode) {
          // Legacy path — inner reviewer commits directly, merger merges later.
          const review = await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            agent: sandcastle.claudeCode("claude-opus-4-8"),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: { TASK_ID: issue.id, BRANCH: issue.branch, TARGET_BRANCH },
          });
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
            const writeup = await implement.resume(prWriterPrompt(issue.id), {
              name: "pr-writer",
              completionSignal: "</pr-body>",
            });
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
          `Implemented over ${implement.commits.length} commit(s); see the commit history for details.`,
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

  // Merge-phase input is derived from GIT STATE, not just this cycle's
  // results: a previous run may have implemented a branch and died before
  // merging (re-entrancy) — the goal judge then verifies "already done" with
  // zero new commits, and commit-count-only filtering would strand the
  // branch (and re-classify the issue as `implement` forever). Legacy
  // branches ahead of the target merge even with no new commits this cycle;
  // PR-mode branches never merge locally (their gate is owner approval).
  const branchAhead = async (branch: string): Promise<boolean> => {
    try {
      const { stdout } = await execFileAsync("git", [
        "rev-list",
        "--count",
        `${TARGET_BRANCH}..${branch}`,
      ]);
      return Number.parseInt(stdout.trim(), 10) > 0;
    } catch {
      return false; // branch doesn't exist locally
    }
  };
  const completedIssues: typeof issues = [];
  for (const [i, outcome] of settled.entries()) {
    const issue = issues[i]!;
    if (outcome.status !== "fulfilled") continue;
    if (prLabelByNumber.get(Number(issue.id))) continue;
    if (outcome.value.commits.length > 0 || (await branchAhead(issue.branch))) {
      completedIssues.push(issue);
    }
  }

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
  await sandcastle.run({
    hooks,
    sandbox: docker(),
    name: "merger",
    maxIterations: 1,
    agent: sandcastle.claudeCode("claude-opus-4-8"),
    promptFile: "./.sandcastle/merge-prompt.md",
    promptArgs: {
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  // PR-mode branches fork from local HEAD but their PR diffs are computed
  // against origin/master — keep the remote in sync with local merges.
  await execFileAsync("git", ["push", "origin", TARGET_BRANCH]);

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
