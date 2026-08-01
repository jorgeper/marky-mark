import { describe, expect, it } from "vitest";
import {
  classifyPrdIssue,
  findPrdPr,
  parseCloseMarkerPresent,
  parsePrApproval,
  parseSubIssues,
  prdBranchPrefixFor,
  prdPathFromPrFiles,
  PARENT_CLOSE_MARKER,
  type PrdPrHead,
} from "./prd-lane.mts";

describe("prdBranchPrefixFor / findPrdPr", () => {
  const prs: PrdPrHead[] = [
    { number: 5, state: "CLOSED", headRefName: "prd/issue-12-old-take" },
    { number: 9, state: "OPEN", headRefName: "prd/issue-12-search-speedup" },
    { number: 7, state: "OPEN", headRefName: "prd/issue-120-other" },
    { number: 8, state: "OPEN", headRefName: "sandcastle/issue-12" },
  ];

  it("builds the branch prefix", () => {
    expect(prdBranchPrefixFor(12)).toBe("prd/issue-12-");
  });

  it("matches only the exact issue number prefix (12, not 120)", () => {
    expect(findPrdPr(prs, 120)?.number).toBe(7);
  });

  it("picks the newest (highest-numbered) matching PR", () => {
    expect(findPrdPr(prs, 12)?.number).toBe(9);
  });

  it("returns null when no PRD branch exists", () => {
    expect(findPrdPr(prs, 99)).toBeNull();
  });
});

describe("parseSubIssues", () => {
  it("counts total and open", () => {
    const json = JSON.stringify([
      { number: 31, state: "open" },
      { number: 32, state: "closed" },
      { number: 33, state: "OPEN" },
    ]);
    expect(parseSubIssues(json)).toEqual({ total: 3, open: 2 });
  });

  it("handles the empty list", () => {
    expect(parseSubIssues("[]")).toEqual({ total: 0, open: 0 });
  });
});

describe("parsePrApproval", () => {
  it("true on the approved label", () => {
    const json = JSON.stringify({
      labels: [{ name: "sandcastle:approved" }],
      reviewDecision: "",
    });
    expect(parsePrApproval(json)).toBe(true);
  });

  it("true on an approving review", () => {
    const json = JSON.stringify({ labels: [], reviewDecision: "APPROVED" });
    expect(parsePrApproval(json)).toBe(true);
  });

  it("false otherwise", () => {
    const json = JSON.stringify({
      labels: [{ name: "sandcastle:ready" }],
      reviewDecision: "REVIEW_REQUIRED",
    });
    expect(parsePrApproval(json)).toBe(false);
  });
});

describe("parseCloseMarkerPresent", () => {
  it("finds the marker in issue comments", () => {
    const json = JSON.stringify({
      comments: [{ body: "hello" }, { body: `${PARENT_CLOSE_MARKER} — 3/3.` }],
    });
    expect(parseCloseMarkerPresent(json)).toBe(true);
  });

  it("false without it", () => {
    expect(
      parseCloseMarkerPresent(JSON.stringify({ comments: [{ body: "hi" }] })),
    ).toBe(false);
  });
});

describe("prdPathFromPrFiles", () => {
  it("returns the PRD markdown file from the PR's changed files", () => {
    const json = JSON.stringify({
      files: [{ path: "README.md" }, { path: "prd/009-search-speedup.md" }],
    });
    expect(prdPathFromPrFiles(json)).toBe("prd/009-search-speedup.md");
  });

  it("ignores prd/TEMPLATE.md and returns null when absent", () => {
    const json = JSON.stringify({ files: [{ path: "prd/TEMPLATE.md" }] });
    expect(prdPathFromPrFiles(json)).toBeNull();
  });
});

describe("classifyPrdIssue", () => {
  const none = { total: 0, open: 0 };

  it("no PR → needs-prd", () => {
    expect(
      classifyPrdIssue({
        pr: null,
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "needs-prd" });
  });

  it("open unapproved PR → awaiting-review", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "OPEN", approved: false },
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "awaiting-review", pr: 9 });
  });

  it("open approved PR → merge-and-decompose", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "OPEN", approved: true },
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "merge-and-decompose", pr: 9 });
  });

  it("merged PR, no sub-issues → decompose (crash recovery)", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "MERGED", approved: true },
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "decompose", pr: 9 });
  });

  it("closed-unmerged PR → abandoned", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "CLOSED", approved: false },
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "abandoned", pr: 9 });
  });

  it("sub-issues with some open → in-progress (regardless of PR)", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "MERGED", approved: true },
        subIssues: { total: 3, open: 1 },
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "in-progress", open: 1, total: 3 });
  });

  it("all sub-issues closed, marker absent → close-parent", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "MERGED", approved: true },
        subIssues: { total: 3, open: 0 },
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "close-parent", total: 3 });
  });

  it("all closed but marker present (manually reopened parent) → done", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "MERGED", approved: true },
        subIssues: { total: 3, open: 0 },
        closeMarkerPresent: true,
      }),
    ).toEqual({ kind: "done" });
  });
});
