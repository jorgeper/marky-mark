// Host-side gh CLI wrappers. Pure JSON parsing lives in exported functions
// (parsePrView/parseThreads) so it can be unit-tested; everything touching
// the network stays thin. All calls run as the owner's single identity —
// agent comments are distinguished by **[agent-name]** markers, not logins.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  APPROVED_LABEL,
  speakerOf,
  type PrSnapshot,
  type ReviewThread,
} from "./state.mts";

const execFileAsync = promisify(execFile);

// Marker-aware: matches both **[pr-reviewer]** and the detailed
// **[pr-reviewer · harness · model]** form.
const isReviewerComment = (body: string) => speakerOf(body) === "reviewer";

export const gh = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
};

export interface IssueInfo {
  number: number;
  title: string;
  labels: string[];
}

export const listSandcastleIssues = async (): Promise<IssueInfo[]> => {
  const raw = await gh([
    "issue", "list", "--state", "open", "--label", "sandcastle",
    "--limit", "100", "--json", "number,title,labels",
  ]);
  return (JSON.parse(raw) as any[]).map((issue) => ({
    number: issue.number,
    title: issue.title,
    labels: (issue.labels as any[]).map((label) => label.name),
  }));
};

export const repoSlug = async (): Promise<string> =>
  (
    await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])
  ).trim();

// --- PRD lane (prd/008) wrappers — raw JSON out, parsing in prd-lane.mts ---

export const listRequiresPrdIssues = async (): Promise<IssueInfo[]> => {
  const raw = await gh([
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    REQUIRES_PRD_LABEL,
    "--limit",
    "100",
    "--json",
    "number,title,labels",
  ]);
  return (JSON.parse(raw) as any[]).map((issue) => ({
    number: issue.number,
    title: issue.title,
    labels: (issue.labels as any[]).map((label) => label.name),
  }));
};

export const listAllPrHeads = async (): Promise<
  { number: number; state: string; headRefName: string }[]
> => {
  const raw = await gh([
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "number,state,headRefName",
  ]);
  return JSON.parse(raw);
};

// Capped at 100 sub-issues (GitHub's max per_page) — a parent past that is
// not expected in practice. Deliberately per_page, not --paginate: gh
// concatenates multi-page results into back-to-back JSON arrays, which
// would break parseSubIssues' single JSON.parse.
export const subIssuesJson = (
  repo: string,
  issueNumber: number,
): Promise<string> =>
  gh([
    "api",
    "-X",
    "GET",
    `repos/${repo}/issues/${issueNumber}/sub_issues`,
    "-F",
    "per_page=100",
  ]);

export const prApprovalJson = (prNumber: number): Promise<string> =>
  gh(["pr", "view", String(prNumber), "--json", "labels,reviewDecision"]);

export const prFilesJson = (prNumber: number): Promise<string> =>
  gh(["pr", "view", String(prNumber), "--json", "files"]);

export const issueCommentsJson = (issueNumber: number): Promise<string> =>
  gh(["issue", "view", String(issueNumber), "--json", "comments"]);

export const findLatestPr = async (
  branch: string,
): Promise<{ number: number; state: "OPEN" | "MERGED" | "CLOSED" } | null> => {
  const raw = await gh([
    "pr", "list", "--head", branch, "--state", "all",
    "--limit", "1", "--json", "number,state",
  ]);
  const prs = JSON.parse(raw) as { number: number; state: string }[];
  if (prs.length === 0) return null;
  return { number: prs[0]!.number, state: prs[0]!.state as any };
};

export const parsePrView = (
  viewJson: string,
): Pick<
  PrSnapshot,
  "number" | "state" | "mergeable" | "labels" | "reviewerHasReviewed"
> => {
  const view = JSON.parse(viewJson);
  const comments: any[] = view.comments ?? [];
  return {
    number: view.number,
    state: view.state,
    mergeable: view.mergeable || "UNKNOWN",
    labels: ((view.labels ?? []) as any[]).map((label) => label.name),
    reviewerHasReviewed: comments.some(
      (comment) =>
        typeof comment.body === "string" && isReviewerComment(comment.body),
    ),
  };
};

const THREADS_QUERY = `query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 50) { nodes { body url } }
        }
      }
    }
  }
}`;

export const parseThreads = (graphqlJson: string): ReviewThread[] => {
  const nodes: any[] =
    JSON.parse(graphqlJson).data.repository.pullRequest.reviewThreads.nodes;
  return nodes.map((node) => ({
    id: node.id,
    isResolved: node.isResolved,
    comments: (node.comments.nodes as any[]).map((comment) => ({
      body: comment.body,
      url: comment.url,
    })),
  }));
};

export const fetchPrSnapshot = async (
  repo: string,
  prNumber: number,
): Promise<PrSnapshot> => {
  const [owner, name] = repo.split("/") as [string, string];
  const viewJson = await gh([
    "pr", "view", String(prNumber),
    "--json", "number,state,mergeable,labels,comments",
  ]);
  const threadsJson = await gh([
    "api", "graphql",
    "-f", `query=${THREADS_QUERY}`,
    "-F", `owner=${owner}`, "-F", `repo=${name}`, "-F", `pr=${prNumber}`,
  ]);
  const base = parsePrView(viewJson);
  const threads = parseThreads(threadsJson);
  // Line comments live in review threads, not the PR conversation — count
  // them as reviewer activity too.
  const reviewerInThreads = threads.some((thread) =>
    thread.comments.some((comment) => isReviewerComment(comment.body)),
  );
  return {
    ...base,
    reviewerHasReviewed: base.reviewerHasReviewed || reviewerInThreads,
    threads,
  };
};

/** Extract the trimmed contents of the first `<tag>...</tag>` block. */
export const extractTag = (text: string, tag: string): string | null => {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1]!.trim() : null;
};

export const createPr = async (opts: {
  branch: string;
  title: string;
  body: string;
}): Promise<number> => {
  const url = await gh([
    "pr", "create", "--head", opts.branch,
    "--title", opts.title, "--body", opts.body,
  ]);
  const match = url.trim().match(/\/pull\/(\d+)/);
  if (!match) throw new Error(`could not parse PR number from: ${url}`);
  return Number(match[1]);
};

// PRD 008 R14: release/* branches are permanent — no Sandcastle path (merge,
// cleanup, or otherwise) may delete them. Every branch-deletion site routes
// through this predicate; design.ts imports it too, a deliberate exception to
// the no-cross-template-sharing norm so there is exactly one guard.
export const isPermanentBranch = (branch: string): boolean =>
  branch.startsWith("release/");

// Pure seam for merge-command construction so tests can assert the deletion
// exemption without mocking gh. `target` is whatever `gh pr merge` accepts —
// a PR number or URL.
export const mergePrArgs = (target: string, headRefName: string): string[] => {
  const args = ["pr", "merge", target, "--squash"];
  // PRD 008 R14: a permanent release/* head survives its merge.
  if (!isPermanentBranch(headRefName)) args.push("--delete-branch");
  return args;
};

export const prHeadRefName = async (prNumber: number): Promise<string> => {
  const raw = await gh([
    "pr", "view", String(prNumber), "--json", "headRefName",
  ]);
  return (JSON.parse(raw) as { headRefName: string }).headRefName;
};

export const mergePr = async (prNumber: number): Promise<void> => {
  const headRefName = await prHeadRefName(prNumber);
  await gh(mergePrArgs(String(prNumber), headRefName));
};

// GitHub's "Closes #N" auto-close is asynchronous; we close explicitly after
// merging so the next iteration never sees a merged PR with an open issue.
// Closing an already-closed issue is a no-op error we swallow.
export const closeIssue = async (
  issueNumber: number,
  comment: string,
): Promise<void> => {
  await gh([
    "issue", "close", String(issueNumber), "--comment", comment,
  ]).catch(() => {});
};

// ---------------------------------------------------------------------------
// Label vocabulary. Two kinds by ownership:
//   - Human-applied (trigger + approved): provisioned only by the explicit
//     init command (`npm run sandcastle:init`) — never behind the owner's back.
//   - Orchestrator-applied (statuses): the loop's own output channel, created
//     lazily right before the loop needs to write them.
// ---------------------------------------------------------------------------

export interface LabelDef {
  name: string;
  color: string;
  desc: string;
}

export const TRIGGER_LABEL = "sandcastle";
export const REQUIRE_PR_LABEL = "sandcastle:require-pr";
export const REQUIRES_PRD_LABEL = "sandcastle:requires-prd";
export const AGENT_APPROVE_LABEL = "sandcastle:agent-approve";

export const TRIGGER_LABEL_DEFS: LabelDef[] = [
  { name: TRIGGER_LABEL, color: "1D76DB", desc: "Queue this issue for the sandcastle loop" },
  { name: REQUIRE_PR_LABEL, color: "0052CC", desc: "Gate this issue behind a PR + outer review" },
  { name: AGENT_APPROVE_LABEL, color: "0052CC", desc: "PR mode, but the reviewer agent approves instead of you" },
  { name: REQUIRES_PRD_LABEL, color: "B60205", desc: "Needs an approved PRD before decompose/implement" },
];

export type StatusLabel =
  | "sandcastle:in-review"
  | "sandcastle:ready"
  | "sandcastle:needs-decision"
  | "sandcastle:ready-to-merge";

const STATUS_LABELS: { name: StatusLabel; color: string; desc: string }[] = [
  { name: "sandcastle:in-review", color: "FBCA04", desc: "Agent debate in progress" },
  { name: "sandcastle:ready", color: "0E8A16", desc: "Awaiting owner approval label" },
  { name: "sandcastle:needs-decision", color: "D93F0B", desc: "Deadlocked threads await owner verdict" },
  { name: "sandcastle:ready-to-merge", color: "1D76DB", desc: "Goal verified met on the branch — merge phase can take it directly" },
];

export const STATUS_LABEL_DEFS: LabelDef[] = STATUS_LABELS;

export const APPROVED_LABEL_DEF: LabelDef = {
  name: APPROVED_LABEL,
  color: "5319E7",
  desc: "Owner authorized the merge — next run squash-merges",
};

export const ALL_LABEL_DEFS: LabelDef[] = [
  ...TRIGGER_LABEL_DEFS,
  ...STATUS_LABEL_DEFS,
  APPROVED_LABEL_DEF,
];

export const listLabelNames = async (): Promise<string[]> => {
  const raw = await gh(["label", "list", "--limit", "100", "--json", "name"]);
  return (JSON.parse(raw) as { name: string }[]).map((label) => label.name);
};

// Create-if-missing. GitHub label names are case-insensitive-unique, so an
// existing `Sandcastle` counts as `sandcastle`. Existing labels are never
// touched — owner customizations (colors, descriptions) are preserved.
export const ensureLabelsExist = async (
  defs: LabelDef[],
): Promise<string[]> => {
  const existing = new Set(
    (await listLabelNames()).map((name) => name.toLowerCase()),
  );
  const created: string[] = [];
  for (const def of defs) {
    if (existing.has(def.name.toLowerCase())) continue;
    await gh([
      "label", "create", def.name,
      "--color", def.color, "--description", def.desc,
    ]);
    created.push(def.name);
  }
  return created;
};

export const setStatusLabel = async (
  prNumber: number,
  label: StatusLabel,
): Promise<void> => {
  const others = STATUS_LABELS.map((l) => l.name).filter((n) => n !== label);
  const args = ["pr", "edit", String(prNumber), "--add-label", label];
  for (const other of others) args.push("--remove-label", other);
  // Removing a label that isn't attached fails on some gh versions — retry
  // with just the addition.
  await gh(args).catch(async () => {
    await gh(["pr", "edit", String(prNumber), "--add-label", label]);
  });
};

export const addIssueLabel = async (
  issueNumber: number,
  label: StatusLabel,
): Promise<void> => {
  await gh([
    "issue", "edit", String(issueNumber), "--add-label", label,
  ]).catch(() => {});
};

// Orchestrator safety net for `sandcastle:agent-approve` PRs: the reviewer
// agent is the one that signs off (it says so in its own comment), but a
// turn that ends without writing the label would strand the PR waiting on an
// owner who has already delegated. Idempotent — re-adding is a no-op.
export const addPrLabel = async (
  prNumber: number,
  label: string,
): Promise<void> => {
  await gh(["pr", "edit", String(prNumber), "--add-label", label]);
};

export const postPrComment = async (
  prNumber: number,
  body: string,
): Promise<void> => {
  await gh(["pr", "comment", String(prNumber), "--body", body]);
};
