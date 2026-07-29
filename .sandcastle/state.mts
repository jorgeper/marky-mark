// Pure classification of PR/debate state. No I/O — main.mts feeds it
// snapshots fetched via lib/github.mts, keeping the merge gate and
// turn-taking rules unit-testable.

export const AUTHOR_AGENTS = [
  "implementer",
  "addresser",
  "conflict-resolver",
] as const;
export const REVIEWER_AGENT = "pr-reviewer";

export type Speaker = "author" | "reviewer" | "human";

// Markers are `**[name]**` or the detailed `**[name · harness · model]**`;
// the agent is identified by the name before any separator.
export const speakerOf = (body: string): Speaker => {
  const match = body.match(/^\*\*\[([a-z0-9-]+)[^\]]*\]\*\*/);
  if (!match) return "human";
  if (match[1] === REVIEWER_AGENT) return "reviewer";
  if ((AUTHOR_AGENTS as readonly string[]).includes(match[1]!)) return "author";
  return "human";
};

export interface ThreadComment {
  body: string;
  url: string;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  comments: ThreadComment[];
}

/** The owner adds this PR label to authorize the merge — the human gate. */
export const APPROVED_LABEL = "sandcastle:approved";

export interface PrSnapshot {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  labels: string[];
  /** True once any comment carries the pr-reviewer marker. */
  reviewerHasReviewed: boolean;
  threads: ReviewThread[];
}

export type ThreadState = "addresser-work" | "reviewer-work" | "awaiting-human";

export const classifyThread = (t: ReviewThread): ThreadState | null => {
  if (t.isResolved || t.comments.length === 0) return null;
  const last = t.comments[t.comments.length - 1]!;
  switch (speakerOf(last.body)) {
    case "author":
      return "reviewer-work";
    case "reviewer":
      return last.body.includes("NEEDS-DECISION")
        ? "awaiting-human"
        : "addresser-work";
    case "human":
      return "addresser-work";
  }
};

export type IssueAction =
  | { kind: "implement" }
  | { kind: "merge" }
  | { kind: "resolve-conflicts" }
  | { kind: "addresser-turn" }
  | { kind: "reviewer-turn" }
  | { kind: "wait" }
  | { kind: "close-issue" }
  | { kind: "abandoned" };

export const classifyIssue = (pr: PrSnapshot | null): IssueAction => {
  if (pr === null) return { kind: "implement" };
  // PR merged but the issue is still open: GitHub's "Closes #N" auto-close
  // is asynchronous, so this is the normal state moments after a merge (or
  // after a crash between merge and close). Finish the close ourselves.
  if (pr.state === "MERGED") return { kind: "close-issue" };
  // PR closed WITHOUT merging while the issue stays open — a human decision
  // we must not override by silently re-implementing.
  if (pr.state === "CLOSED") return { kind: "abandoned" };

  const states = pr.threads
    .map(classifyThread)
    .filter((s): s is ThreadState => s !== null);

  // The human checkpoint: the approved label + a fully settled conversation.
  if (pr.labels.includes(APPROVED_LABEL) && states.length === 0) {
    return pr.mergeable === "CONFLICTING"
      ? { kind: "resolve-conflicts" }
      : { kind: "merge" };
  }

  if (states.includes("addresser-work")) return { kind: "addresser-turn" };
  if (states.includes("reviewer-work")) return { kind: "reviewer-turn" };
  if (states.length === 0 && !pr.reviewerHasReviewed)
    return { kind: "reviewer-turn" }; // crashed before the first review
  return { kind: "wait" };
};
