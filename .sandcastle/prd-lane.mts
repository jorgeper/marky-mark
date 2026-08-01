// PRD lane (prd/008): pure classification for `sandcastle:requires-prd`
// issues. Every state is derived from GitHub alone — no conversation store.
// The impure lane runner lives in main.mts (agent call sites stay there,
// template convention); everything here is unit-testable.

import { APPROVED_LABEL } from "./state.mts";

/** First line of the idempotent parent-close comment. Close once: a
 * manually-reopened parent (marker already present) is never re-closed. */
export const PARENT_CLOSE_MARKER = "🏰 Sandcastle: all sub-issues complete";

/** A PRD PR for issue N lives on branch `prd/issue-<N>-<slug>` — the
 * trailing dash keeps issue 12 from matching issue 120's branches. */
export const prdBranchPrefixFor = (issueNumber: number): string =>
  `prd/issue-${issueNumber}-`;

export interface PrdPrHead {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  headRefName: string;
}

/** Newest (highest-numbered) PR whose head branch matches the issue. */
export const findPrdPr = (
  prs: PrdPrHead[],
  issueNumber: number,
): PrdPrHead | null => {
  const prefix = prdBranchPrefixFor(issueNumber);
  const matches = prs.filter((pr) => pr.headRefName.startsWith(prefix));
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (a.number > b.number ? a : b));
};

export interface SubIssueSummary {
  total: number;
  open: number;
}

/** Input: `gh api repos/<slug>/issues/<n>/sub_issues` (a JSON array of
 * issue objects; `state` is "open"/"closed"). */
export const parseSubIssues = (json: string): SubIssueSummary => {
  const items = JSON.parse(json) as { state?: string }[];
  return {
    total: items.length,
    open: items.filter((i) => (i.state ?? "").toLowerCase() === "open").length,
  };
};

/** Input: `gh pr view <n> --json labels,reviewDecision`. Same convention as
 * design.ts: the approved label or an approving review. */
export const parsePrApproval = (json: string): boolean => {
  const view = JSON.parse(json) as {
    labels?: { name?: string }[];
    reviewDecision?: string;
  };
  return (
    (view.labels ?? []).some((l) => l.name === APPROVED_LABEL) ||
    view.reviewDecision === "APPROVED"
  );
};

/** Input: `gh issue view <n> --json comments`. */
export const parseCloseMarkerPresent = (json: string): boolean => {
  const view = JSON.parse(json) as { comments?: { body?: string }[] };
  return (view.comments ?? []).some((c) =>
    (c.body ?? "").includes(PARENT_CLOSE_MARKER),
  );
};

/** Input: `gh pr view <n> --json files`. The merged PRD is the PR's
 * `prd/*.md` file (never TEMPLATE.md) — how a re-run recovers the path. */
export const prdPathFromPrFiles = (json: string): string | null => {
  const view = JSON.parse(json) as { files?: { path?: string }[] };
  return (
    (view.files ?? [])
      .map((f) => f.path ?? "")
      .find(
        (p) => /(^|\/)prd\/.+\.md$/.test(p) && !p.endsWith("prd/TEMPLATE.md"),
      ) ?? null
  );
};

export type PrdAction =
  | { kind: "needs-prd" }
  | { kind: "awaiting-review"; pr: number }
  | { kind: "merge-and-decompose"; pr: number }
  | { kind: "decompose"; pr: number }
  | { kind: "in-progress"; open: number; total: number }
  | { kind: "close-parent"; total: number }
  | { kind: "done" }
  | { kind: "abandoned"; pr: number };

/** The state machine of prd/008. Sub-issues dominate: once they exist the
 * PRD phase is over, whatever the PR looks like. */
export const classifyPrdIssue = (input: {
  pr: {
    number: number;
    state: "OPEN" | "MERGED" | "CLOSED";
    approved: boolean;
  } | null;
  subIssues: SubIssueSummary;
  closeMarkerPresent: boolean;
}): PrdAction => {
  const { pr, subIssues, closeMarkerPresent } = input;
  if (subIssues.total > 0) {
    if (subIssues.open > 0)
      return {
        kind: "in-progress",
        open: subIssues.open,
        total: subIssues.total,
      };
    return closeMarkerPresent
      ? { kind: "done" }
      : { kind: "close-parent", total: subIssues.total };
  }
  if (pr === null) return { kind: "needs-prd" };
  if (pr.state === "OPEN")
    return pr.approved
      ? { kind: "merge-and-decompose", pr: pr.number }
      : { kind: "awaiting-review", pr: pr.number };
  if (pr.state === "MERGED") return { kind: "decompose", pr: pr.number };
  return { kind: "abandoned", pr: pr.number };
};
