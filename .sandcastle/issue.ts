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
  ensureLabel,
  ghJson,
  getIssue,
  createIssue,
  laneNudge,
  preflight,
  summarizeTitle,
} from "./shared.ts";

// Filer lane — capture first, enrich optionally.
//
// Filing is instant and deterministic (no agent): the issue exists,
// UNLABELED (= on hold, invisible to the agents), from second zero. That
// IS the quick issue — declining the develop step is the fast path, and
// Ctrl-C mid-development leaves exactly the same safe state.
//
// Developing an issue is a short-leash conversation (anchored `issue-<n>`)
// that grounds it in the repo, asks at most a couple of questions, rewrites
// the issue body, and ALWAYS ends by asking you how to route it — with the
// filer's recommendation, both directions: "I think this needs a PRD —
// route to design?" or "I don't think this needs a PRD — want one anyway?"
//
//   npx tsx .sandcastle/issue.ts "search is slow on big repos"   # capture
//   npx tsx .sandcastle/issue.ts            # picker: develop a held issue
//
// Ctrl-C is always safe — the issue persists; conversations re-attach.

const agent = claudeCode(MODEL);
const sandbox = docker();
const AGENT_MARKER = markerFor("filer");
const ROUTING_LABELS = [DESIGN_LABEL, DECOMPOSE_LABEL, IMPLEMENT_LABEL];

ensureLabel(DESIGN_LABEL, "Needs a PRD; grill the owner");

const guidanceFor = (issueNumber: number): void => {
  const labels = getIssue(issueNumber).labels.map((l) => l.name);
  if (labels.includes(DESIGN_LABEL)) {
    console.log(
      `Routed to the design lane. Next step:\n  npm run sandcastle:design   (pick #${issueNumber})`,
    );
  } else if (labels.includes(IMPLEMENT_LABEL)) {
    console.log(`Implementer-ready. Next step:\n  npm run sandcastle`);
    const nudge = laneNudge(IMPLEMENT_LABEL, "all will be picked up");
    if (nudge) console.log(`(${nudge})`);
  } else {
    console.log(
      `#${issueNumber} is on hold (unlabeled — agents won't touch it). Your options:`,
    );
    console.log(
      `  develop it:   npm run sandcastle:issue          (pick #${issueNumber})`,
    );
    console.log(
      `  release it:   gh issue edit ${issueNumber} --add-label "${IMPLEMENT_LABEL}"   # or "${DESIGN_LABEL}"`,
    );
  }
};

const develop = async (issueNumber: number): Promise<void> => {
  // Preflight here, not at capture: capture must stay instant, and only the
  // develop conversation needs the sandbox credentials.
  await preflight();
  const issue = getIssue(issueNumber);
  const convoId = `issue-${issueNumber}`;
  let convo: Conversation;
  const existing = (await conversation.list()).find((s) => s.id === convoId);
  if (existing) {
    console.log(`Re-attaching to conversation "${convoId}".`);
    convo = await conversation.open(convoId, { agent, sandbox });
  } else {
    convo = await conversation.start({
      name: convoId,
      role: "filer",
      agent,
      sandbox,
      promptFile: ".sandcastle/filer-prompt.md",
      promptArgs: {
        ISSUE_NUMBER: issueNumber,
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: issue.body,
        AGENT_MARKER,
      },
    });
  }
  await chat(convo);
  console.log("");
  guidanceFor(issueNumber);
};

// --- Entry ---------------------------------------------------------------------

const report = process.argv.slice(2).join(" ").trim();

if (report !== "") {
  // Capture: instant, no agent. Unlabeled = on hold.
  const issueNumber = createIssue({
    title: summarizeTitle(report),
    body: `${AGENT_MARKER}\n\n${report}\n\n_Captured via issue.ts on behalf of the owner._`,
  });
  console.log(`Filed #${issueNumber} (on hold, unlabeled).`);
  const answer = await ask("Develop it now? (y / Enter to skip): ");
  if (answer.toLowerCase().startsWith("y")) {
    await develop(issueNumber);
  } else {
    guidanceFor(issueNumber);
  }
} else {
  // Picker: open issues with no routing label are held drafts to develop.
  interface IssueRow {
    number: number;
    title: string;
    labels: Array<{ name?: string }>;
  }
  const held = ghJson<IssueRow[]>(
    "issue list --state open --json number,title,labels --limit 100",
  ).filter((i) => !i.labels.some((l) => ROUTING_LABELS.includes(l.name ?? "")));

  if (held.length === 0) {
    const text = await ask("No held issues. What's the issue? ");
    if (text === "") process.exit(0);
    const issueNumber = createIssue({
      title: summarizeTitle(text),
      body: `${AGENT_MARKER}\n\n${text}\n\n_Captured via issue.ts on behalf of the owner._`,
    });
    console.log(`Filed #${issueNumber} (on hold, unlabeled).`);
    const answer = await ask("Develop it now? (y / Enter to skip): ");
    if (answer.toLowerCase().startsWith("y")) await develop(issueNumber);
    else guidanceFor(issueNumber);
  } else {
    console.log("Held issues (no routing label yet):");
    held.forEach((i, idx) =>
      console.log(`  ${idx + 1}. #${i.number} ${i.title}`),
    );
    const answer = await ask(
      "Number to develop, or type a new issue (Enter to exit): ",
    );
    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= held.length) {
      await develop(held[index - 1]!.number);
    } else if (answer !== "") {
      const issueNumber = createIssue({
        title: summarizeTitle(answer),
        body: `${AGENT_MARKER}\n\n${answer}\n\n_Captured via issue.ts on behalf of the owner._`,
      });
      console.log(`Filed #${issueNumber} (on hold, unlabeled).`);
      const develop2 = await ask("Develop it now? (y / Enter to skip): ");
      if (develop2.toLowerCase().startsWith("y")) await develop(issueNumber);
      else guidanceFor(issueNumber);
    }
  }
}
