import { existsSync } from "node:fs";
import {
  claudeCode,
  conversation,
  type Conversation,
} from "@ai-hero/sandcastle";
import { chat } from "@ai-hero/sandcastle/chat";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  MODEL,
  DECOMPOSE_LABEL,
  IMPLEMENT_LABEL,
  markerFor,
  ask,
  ensureLabel,
  listOpenIssues,
  getIssue,
  createIssue,
  findIssueByTitle,
  decomposeIssueTitle,
  parsePrdLine,
  pullFastForward,
  linkSubIssue,
  numberFromUrl,
  gh,
  laneNudge,
  preflight,
} from "./shared.ts";

// Decomposer lane: a decompose issue in → breakdown conversation →
// parent + implementation issues out; the script closes the tracking issue.
//
//   npx tsx .sandcastle/decompose.ts                    # picker
//   npx tsx .sandcastle/decompose.ts --issue 46         # pick up a labeled issue
//   npx tsx .sandcastle/decompose.ts prd/002-foo.md     # direct (files the issue for the trace)
//
// Ctrl-C is always safe — the conversation is durable and re-attaches.

const agent = claudeCode(MODEL);
const sandbox = docker();
const AGENT_MARKER = markerFor("decomposer");

await preflight();
ensureLabel(DECOMPOSE_LABEL, "Merged PRD needs an issue breakdown");

// --- Resolve the decompose issue ---------------------------------------------

const args = process.argv.slice(2);
let issueNumber: number;

if (args[0] === "--issue" && args[1]) {
  issueNumber = Number.parseInt(args[1], 10);
} else if (args[0]) {
  const prdFile = args[0].trim();
  if (!existsSync(prdFile)) {
    console.error(`PRD file not found: ${prdFile}`);
    console.error(
      "Is the PRD PR merged and your checkout up to date? (git pull)",
    );
    process.exit(1);
  }
  // Even the direct path leaves a trace: reuse or file the tracking issue.
  const title = decomposeIssueTitle(prdFile);
  const already = findIssueByTitle(title);
  if (already !== undefined) {
    issueNumber = already;
    console.log(`Using existing decompose issue #${issueNumber}.`);
  } else {
    issueNumber = createIssue({
      title,
      label: DECOMPOSE_LABEL,
      body: `${AGENT_MARKER}\n\n**PRD:** ${prdFile}\n\n_Filed via decompose.ts on behalf of the owner._`,
    });
    console.log(`Created decompose issue #${issueNumber}.`);
  }
} else {
  const issues = listOpenIssues(DECOMPOSE_LABEL);
  if (issues.length === 0) {
    console.log(
      `No open ${DECOMPOSE_LABEL} issues. Merge a PRD PR first (npm run sandcastle:design), ` +
        "or pass a PRD path: npx tsx .sandcastle/decompose.ts prd/NNN-<slug>.md",
    );
    process.exit(0);
  }
  console.log(`Open ${DECOMPOSE_LABEL} issues:`);
  issues.forEach((i, idx) =>
    console.log(`  ${idx + 1}. #${i.number} ${i.title}`),
  );
  const answer = await ask("Number to work on (or Enter to exit): ");
  const index = Number.parseInt(answer, 10);
  if (!Number.isInteger(index) || index < 1 || index > issues.length) {
    process.exit(0);
  }
  issueNumber = issues[index - 1]!.number;
}

const issue = getIssue(issueNumber);
const prdFile = parsePrdLine(issue.body);
if (!prdFile) {
  console.error(
    `Issue #${issueNumber} has no "**PRD:** <path>" line in its body — add one and re-run.`,
  );
  process.exit(1);
}
if (!existsSync(prdFile)) {
  // The PRD merge landed on the remote; the local checkout may be behind.
  console.log(`${prdFile} not found locally — pulling…`);
  pullFastForward();
}
if (!existsSync(prdFile)) {
  console.error(
    `PRD file ${prdFile} (from issue #${issueNumber}) not found even after ` +
      "a fast-forward pull — check the branch you're on and the issue's **PRD:** line.",
  );
  process.exit(1);
}

// --- Open or start the conversation ------------------------------------------

const convoId = `decompose-issue-${issueNumber}`;
let convo: Conversation;
const existing = (await conversation.list()).find((s) => s.id === convoId);
if (existing) {
  console.log(`Re-attaching to conversation "${convoId}".`);
  convo = await conversation.open(convoId, { agent, sandbox });
} else {
  console.log(
    `Starting decompose conversation for issue #${issueNumber} (${prdFile})…`,
  );
  convo = await conversation.start({
    name: convoId,
    role: "decomposer",
    agent,
    sandbox,
    promptFile: ".sandcastle/decomposer-prompt.md",
    promptArgs: {
      PRD_FILE: prdFile,
      ISSUE_NUMBER: issueNumber,
      AGENT_MARKER,
    },
  });
}

const { finalTurn } = await chat(convo);

// --- Close the tracking issue (mechanical — stays out of the agent) -----------

if (finalTurn?.type === "done" && finalTurn.artifacts.length > 0) {
  console.log("\nCreated issues:");
  for (const url of finalTurn.artifacts) console.log(`  ${url}`);

  // Chain the tree: the feature parent (the created issue without a
  // **Parent:** line) becomes a sub-issue of this decompose issue, so the
  // whole design → decompose → parent → children hierarchy is one tree.
  const repoSlug = gh(
    "repo view --json nameWithOwner -q .nameWithOwner",
  ).trim();
  for (const url of finalTurn.artifacts) {
    if (!url.includes("/issues/")) continue;
    const n = numberFromUrl(url);
    if (n === undefined || n === issueNumber) continue;
    const body = getIssue(n).body;
    if (!body.includes("**Parent:**")) {
      if (linkSubIssue(repoSlug, issueNumber, n)) {
        console.log(`Linked parent #${n} as sub-issue of #${issueNumber}.`);
      }
      break;
    }
  }

  if (getIssue(issueNumber).state === "OPEN") {
    try {
      gh(
        `issue close ${issueNumber} --comment ${JSON.stringify(
          `${AGENT_MARKER} Decomposed into: ${finalTurn.artifacts.join(" ")}`,
        )}`,
      );
      console.log(`Closed decompose issue #${issueNumber}.`);
    } catch {
      console.log(
        `Could not close issue #${issueNumber} — close it manually when convenient.`,
      );
    }
  }
  const nudge = laneNudge(
    IMPLEMENT_LABEL,
    "they're ready for the implementers",
  );
  console.log(`\nNext step:\n  npm run sandcastle`);
  if (nudge) console.log(`(${nudge})`);
} else {
  console.log(
    "\nDecomposition not finished — re-run `npm run sandcastle:decompose` to continue.",
  );
}
