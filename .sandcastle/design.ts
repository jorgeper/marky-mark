import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  claudeCode,
  conversation,
  type Conversation,
} from "@ai-hero/sandcastle";
import { chat } from "@ai-hero/sandcastle/chat";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  MODEL,
  DESIGN_LABEL,
  DECOMPOSE_LABEL,
  IMPLEMENT_LABEL,
  markerFor,
  ask,
  gh,
  ghJson,
  ensureLabel,
  listOpenIssues,
  getIssue,
  createIssue,
  commentOnIssue,
  findIssueByTitle,
  interpretPickerAnswer,
  summarizeTitle,
  decomposeIssueTitle,
  linkSubIssue,
  numberFromUrl,
  preflight,
  pullFastForward,
  laneNudge,
} from "./shared.ts";

// Designer lane — re-entrant, no resident process (same shape as the main
// loop: classify GitHub state → do everything actionable → exit with
// guidance). Each run:
//
//   1. Sweep every design conversation with a PRD PR: merge approved PRs
//      (+ file the decompose handoff issue), relay new PR feedback to the
//      designer. Mechanical work needs no human present.
//   2. Let you run design conversations for open sandcastle:design issues,
//      one after another, until you stop or none remain.
//   3. Exit, telling you exactly what's waiting on you.
//
//   npx tsx .sandcastle/design.ts "my feature idea"   # files the issue first
//   npx tsx .sandcastle/design.ts --issue 41          # jump to one issue
//   npx tsx .sandcastle/design.ts                     # sweep + picker (free text files a new topic)
//
// Ctrl-C is always safe — conversations are durable and re-attach.

const agent = claudeCode(MODEL);
const sandbox = docker();
const AGENT_MARKER = markerFor("designer");
const ANCHOR_TEXT = "Designer conversation started";

await preflight();
ensureLabel(DESIGN_LABEL, "Needs a PRD; grill the owner");
const repoSlug = gh("repo view --json nameWithOwner -q .nameWithOwner").trim();

const prUrlOf = (c: Conversation): string | undefined =>
  [...c.metadata.artifacts].reverse().find((a) => a.includes("/pull/"));
const prdFileOf = (c: Conversation): string | undefined =>
  c.metadata.artifacts.find((a) => /(^|\/)prd\//.test(a) && a.endsWith(".md"));

/** What the human can act on after this run exits. */
const awaitingYou: string[] = [];

// ---------------------------------------------------------------------------
// Handoff: the merge that lands a PRD files the decompose issue.
// ---------------------------------------------------------------------------

const createHandoffIssue = (
  prdFile: string | undefined,
  designIssue: number,
): void => {
  if (!prdFile) {
    console.log(
      `  merged, but no PRD file recorded — file the ${DECOMPOSE_LABEL} issue manually with a **PRD:** line.`,
    );
    return;
  }
  ensureLabel(DECOMPOSE_LABEL, "Merged PRD needs an issue breakdown");
  const title = decomposeIssueTitle(prdFile);
  let decomposeIssue = findIssueByTitle(title);
  if (decomposeIssue !== undefined) {
    console.log(`  decompose issue already exists: #${decomposeIssue}.`);
  } else {
    decomposeIssue = createIssue({
      title,
      label: DECOMPOSE_LABEL,
      body: `${AGENT_MARKER}\n\n**PRD:** ${prdFile}\n\nFollows #${designIssue}.`,
    });
    console.log(`  filed decompose issue #${decomposeIssue}.`);
  }
  // Chain the tree: the decompose issue is a sub-issue of the design issue.
  if (linkSubIssue(repoSlug, designIssue, decomposeIssue)) {
    console.log(`  linked #${decomposeIssue} as sub-issue of #${designIssue}.`);
  }
  awaitingYou.push(`Decompose ${prdFile}:  npm run sandcastle:decompose`);
};

// ---------------------------------------------------------------------------
// Sweep: every designer conversation with a PRD PR gets one classify-and-act
// pass. No polling — re-run the script (or approve/comment first) to advance.
// ---------------------------------------------------------------------------

interface PrComment {
  author?: { login?: string };
  body?: string;
  createdAt?: string;
  submittedAt?: string;
}

interface InlineComment {
  id?: number;
  user?: { login?: string };
  body?: string;
  created_at?: string;
  path?: string;
  line?: number | null;
}

const designIssueOf = (conversationId: string): number | undefined => {
  const match = /^design-issue-(\d+)$/.exec(conversationId);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
};

const sweepPr = async (conversationId: string): Promise<void> => {
  const convo = await conversation.open(conversationId, { agent, sandbox });
  const prUrl = prUrlOf(convo);
  const designIssue = designIssueOf(conversationId);
  if (!prUrl || designIssue === undefined) return;
  const prNumber = numberFromUrl(prUrl);

  const view = ghJson<{
    state: string;
    reviewDecision: string;
    comments: PrComment[];
    reviews: PrComment[];
    labels: Array<{ name?: string }>;
  }>(`pr view ${prUrl} --json state,reviewDecision,comments,reviews,labels`);

  console.log(`\nPRD PR ${prUrl} [issue #${designIssue}]:`);

  if (view.state === "MERGED") {
    // Manual merge (or a merge from a previous run that died before the
    // handoff): make sure the decompose issue exists.
    createHandoffIssue(prdFileOf(convo), designIssue);
    return;
  }
  if (view.state !== "OPEN") {
    console.log(`  ${view.state.toLowerCase()} — nothing to do.`);
    return;
  }

  // Approval gate — same convention as the main loop: the owner labels,
  // the script merges. Never the human by hand, never the agent.
  const approved =
    view.labels.some((l) => l.name === "sandcastle:approved") ||
    view.reviewDecision === "APPROVED";
  if (approved) {
    console.log("  sandcastle:approved — merging…");
    try {
      gh(`pr merge ${prUrl} --squash --delete-branch`);
      console.log("  merged.");
      if (pullFastForward()) console.log("  local checkout fast-forwarded.");
      createHandoffIssue(prdFileOf(convo), designIssue);
    } catch (error) {
      console.error(
        `  merge failed (${error instanceof Error ? error.message.split("\n", 1)[0] : error}) — fix and re-run.`,
      );
      awaitingYou.push(`Merge failed for ${prUrl} — resolve and re-run design`);
    }
    return;
  }

  // New human feedback since the last processed batch?
  const feedbackStatePath = join(
    ".sandcastle",
    "conversations",
    conversationId,
    "pr-feedback.json",
  );
  const cutoff = existsSync(feedbackStatePath)
    ? (
        JSON.parse(readFileSync(feedbackStatePath, "utf-8")) as {
          lastProcessedAt: string;
        }
      ).lastProcessedAt
    : new Date(0).toISOString();

  let inline: InlineComment[] = [];
  try {
    inline = ghJson<InlineComment[]>(
      `api repos/${repoSlug}/pulls/${prNumber}/comments`,
    );
  } catch {
    // Best-effort — general comments still flow if the pulls API hiccups.
  }

  const items = [
    ...[...view.comments, ...view.reviews].map((c) => ({
      author: c.author?.login ?? "unknown",
      body: (c.body ?? "").trim(),
      at: c.createdAt ?? c.submittedAt ?? "",
      context: "",
    })),
    ...inline.map((c) => ({
      author: c.user?.login ?? "unknown",
      body: (c.body ?? "").trim(),
      at: c.created_at ?? "",
      context: c.path
        ? ` (inline on ${c.path}${c.line != null ? `:${c.line}` : ""}, comment id ${c.id})`
        : "",
    })),
  ]
    .filter(
      (c) => c.body !== "" && !c.body.startsWith(AGENT_MARKER) && c.at > cutoff,
    )
    .sort((a, b) => a.at.localeCompare(b.at));

  if (items.length === 0) {
    console.log("  no new feedback — awaiting your review.");
    awaitingYou.push(
      `Review ${prUrl} — comment, or approve with: gh pr edit ${prUrl} --add-label "sandcastle:approved"`,
    );
    return;
  }

  const batch = items
    .map((c) => `From @${c.author} at ${c.at}${c.context}:\n${c.body}`)
    .join("\n\n---\n\n");
  console.log(`  ${items.length} new feedback item(s) — designer addressing…`);
  const turn = await convo.send(`PR feedback:\n\n${batch}`);
  writeFileSync(
    feedbackStatePath,
    JSON.stringify({ lastProcessedAt: items[items.length - 1]!.at }) + "\n",
  );
  await convo.close();
  console.log(`  designer: ${turn.message.split("\n", 1)[0]}`);
  awaitingYou.push(
    `Re-review ${prUrl} (revised) — comment again, or approve with: gh pr edit ${prUrl} --add-label "sandcastle:approved"`,
  );
};

// ---------------------------------------------------------------------------
// A single design conversation: grill → PRD PR (or de-escalation).
// ---------------------------------------------------------------------------

const runDesignConversation = async (issueNumber: number): Promise<void> => {
  const issue = getIssue(issueNumber);
  const convoId = `design-issue-${issueNumber}`;
  let convo: Conversation;
  const existing = (await conversation.list()).find((s) => s.id === convoId);
  if (existing) {
    console.log(`Re-attaching to conversation "${convoId}".`);
    convo = await conversation.open(convoId, { agent, sandbox });
  } else {
    console.log(`Starting design conversation for issue #${issueNumber}…`);
    convo = await conversation.start({
      name: convoId,
      role: "designer",
      agent,
      sandbox,
      promptFile: ".sandcastle/designer-prompt.md",
      promptArgs: {
        ISSUE_NUMBER: issueNumber,
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: issue.body,
        AGENT_MARKER,
      },
    });
  }

  // Anchor comment: make the conversation visible from the issue (idempotent).
  if (!issue.comments.some((c) => c.body.includes(ANCHOR_TEXT))) {
    commentOnIssue(
      issueNumber,
      `${AGENT_MARKER}\n\n${ANCHOR_TEXT} (\`${convoId}\`). Attach with \`npm run sandcastle:design\`.`,
    );
  }

  if (convo.status === "awaiting-agent" || convo.status === "failed") {
    console.log("Recovering an unanswered turn from a previous run…");
    const turn = await convo.recover();
    if (turn) console.log(`Designer: ${turn.message.split("\n", 1)[0]}`);
  }

  if (prUrlOf(convo) === undefined) {
    await chat(convo);
  }

  const prUrl = prUrlOf(convo);
  if (prUrl !== undefined) {
    if (!getIssue(issueNumber).comments.some((c) => c.body.includes(prUrl))) {
      commentOnIssue(issueNumber, `${AGENT_MARKER}\n\nPRD PR opened: ${prUrl}`);
    }
    awaitingYou.push(
      `Review ${prUrl} — comment, or approve with: gh pr edit ${prUrl} --add-label "sandcastle:approved"`,
    );
    console.log(`\nPRD PR opened: ${prUrl} — review it whenever you like.`);
    return;
  }

  const labels = getIssue(issueNumber).labels.map((l) => l.name);
  if (convo.status === "done" && labels.includes(IMPLEMENT_LABEL)) {
    console.log(
      `Issue #${issueNumber} was de-escalated to ${IMPLEMENT_LABEL} — no PRD needed.`,
    );
    awaitingYou.push(`De-escalated #${issueNumber}:  npm run sandcastle`);
  } else {
    console.log(
      `Conversation for #${issueNumber} paused — re-run to continue it.`,
    );
    awaitingYou.push(
      `Continue designing #${issueNumber}:  npm run sandcastle:design`,
    );
  }
};

// ---------------------------------------------------------------------------
// Main — sweep the PR checkpoints, then drain conversations until you stop.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

// Step 1: mechanical sweep of every designer conversation that has a PR.
const designerConversations = (await conversation.list()).filter(
  (s) => s.role === "designer" && /^design-issue-\d+$/.test(s.id),
);
for (const summary of designerConversations) {
  if (!summary.artifacts.some((a) => a.includes("/pull/"))) continue;
  try {
    await sweepPr(summary.id);
  } catch (error) {
    console.error(
      `Sweep failed for ${summary.id}: ${error instanceof Error ? error.message.split("\n", 1)[0] : error}`,
    );
  }
}

// Step 2: conversations. An explicit request (topic / --issue) goes first;
// then offer the remaining open design issues one after another.
const fileDesignIssue = (topic: string): number => {
  console.log(`\nFiling a design issue for: ${topic}`);
  const issueNumber = createIssue({
    title: `PRD: ${summarizeTitle(topic)}`,
    label: DESIGN_LABEL,
    body: `${AGENT_MARKER}\n\n${topic}\n\n_Filed via design.ts on behalf of the owner._`,
  });
  console.log(`Created design issue #${issueNumber}.`);
  return issueNumber;
};

let firstIssue: number | undefined;
if (args[0] === "--issue" && args[1]) {
  firstIssue = Number.parseInt(args[1], 10);
} else if (args.length > 0) {
  firstIssue = fileDesignIssue(args.join(" ").trim());
}

const conversationsWithPr = new Set(
  designerConversations
    .filter((s) => s.artifacts.some((a) => a.includes("/pull/")))
    .map((s) => designIssueOf(s.id))
    .filter((n): n is number => n !== undefined),
);

for (;;) {
  let issueNumber = firstIssue;
  firstIssue = undefined;

  if (issueNumber === undefined) {
    // Issues still needing a conversation (no PRD PR yet). Symmetry with
    // issue.ts: pick one, or describe something new — free text files a
    // design issue and starts its conversation, so an empty list is an
    // invitation, not a dead end.
    const candidates = listOpenIssues(DESIGN_LABEL).filter(
      (i) => !conversationsWithPr.has(i.number),
    );
    if (candidates.length > 0) {
      console.log(
        `\n${candidates.length} design issue(s) awaiting a conversation:`,
      );
      candidates.forEach((i, idx) =>
        console.log(`  ${idx + 1}. #${i.number} ${i.title}`),
      );
    }
    const answer = await ask(
      candidates.length > 0
        ? "Number to work on, or describe a new design topic (Enter to finish): "
        : "\nDescribe a new design topic (Enter to finish): ",
    );
    const action = interpretPickerAnswer(answer, candidates.length);
    if (action.kind === "finish") break;
    issueNumber =
      action.kind === "pick"
        ? candidates[action.index]!.number
        : fileDesignIssue(action.topic);
  }

  await runDesignConversation(issueNumber);
  conversationsWithPr.add(issueNumber);
}

// Step 3: exit with the state of the lane — nothing here polls.
console.log("\n=== Design lane: done for this run ===");
if (awaitingYou.length > 0) {
  console.log("Waiting on you:");
  for (const line of awaitingYou) console.log(`  • ${line}`);
  console.log(
    "\nWhen you've commented or approved, run `npm run sandcastle:design` again — it picks up exactly where things stand.",
  );
} else {
  console.log("Nothing waiting on you in this lane.");
}
const implNudge = laneNudge(
  IMPLEMENT_LABEL,
  "run `npm run sandcastle` when you want them built",
);
if (implNudge) console.log(`\nFYI: ${implNudge}`);
