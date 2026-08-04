import { describe, expect, it } from "vitest";
import {
  extractTag,
  isPermanentBranch,
  mergePrArgs,
  parsePrView,
  parseThreads,
} from "./github.mts";

describe("isPermanentBranch (PRD 008 R14)", () => {
  it("classifies release/* branches as permanent", () => {
    expect(isPermanentBranch("release/v0.5.0")).toBe(true);
    expect(isPermanentBranch("release/v1.2.3-alpha.1")).toBe(true);
  });

  it("leaves every other branch deletable", () => {
    expect(isPermanentBranch("sandcastle/issue-42")).toBe(false);
    expect(isPermanentBranch("main")).toBe(false);
    expect(isPermanentBranch("releases/x")).toBe(false);
    expect(isPermanentBranch("my-release/v1")).toBe(false);
  });
});

describe("mergePrArgs (PRD 008 R14)", () => {
  it("omits --delete-branch for a release/* head so the branch survives", () => {
    expect(mergePrArgs("41", "release/v0.5.0")).toEqual([
      "pr", "merge", "41", "--squash",
    ]);
  });

  it("keeps delete-on-merge for every other head", () => {
    expect(mergePrArgs("41", "sandcastle/issue-42")).toEqual([
      "pr", "merge", "41", "--squash", "--delete-branch",
    ]);
  });
});

describe("extractTag", () => {
  it("extracts and trims the first tagged block", () => {
    const text = "noise <pr-title> Fix the flag </pr-title> <pr-body>a\nb</pr-body>";
    expect(extractTag(text, "pr-title")).toBe("Fix the flag");
    expect(extractTag(text, "pr-body")).toBe("a\nb");
  });
  it("returns null when the tag is absent or unclosed", () => {
    expect(extractTag("no tags here", "pr-title")).toBeNull();
    expect(extractTag("<pr-title>unclosed", "pr-title")).toBeNull();
  });
});

describe("parsePrView", () => {
  const view = {
    number: 12,
    state: "OPEN",
    mergeable: "CONFLICTING",
    labels: [{ name: "sandcastle:ready" }, { name: "sandcastle:approved" }],
    comments: [
      { body: "looks good overall" },
      { body: "**[pr-reviewer]** Review complete — no outstanding concerns." },
    ],
  };

  it("extracts fields and detects reviewer activity via the marker", () => {
    expect(parsePrView(JSON.stringify(view))).toEqual({
      number: 12,
      state: "OPEN",
      mergeable: "CONFLICTING",
      labels: ["sandcastle:ready", "sandcastle:approved"],
      reviewerHasReviewed: true,
    });
  });

  it("reviewerHasReviewed is false without the marker", () => {
    const noMarker = { ...view, comments: [{ body: "**[addresser]** done" }] };
    expect(parsePrView(JSON.stringify(noMarker)).reviewerHasReviewed).toBe(
      false,
    );
  });

  it("detects the reviewer via detailed harness/model markers", () => {
    const detailed = {
      ...view,
      comments: [
        {
          body: "**[pr-reviewer · claude-code · claude-opus-4-8]** Review complete.",
        },
      ],
    };
    expect(parsePrView(JSON.stringify(detailed)).reviewerHasReviewed).toBe(
      true,
    );
  });

  it("normalizes missing labels/comments and unknown mergeable", () => {
    const sparse = { number: 3, state: "OPEN" };
    expect(parsePrView(JSON.stringify(sparse))).toEqual({
      number: 3,
      state: "OPEN",
      mergeable: "UNKNOWN",
      labels: [],
      reviewerHasReviewed: false,
    });
  });
});

describe("parseThreads", () => {
  const graphql = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: "T_1",
                isResolved: false,
                comments: {
                  nodes: [
                    { body: "**[pr-reviewer]** fix", url: "https://x/1" },
                    { body: "**[addresser]** fixed", url: "https://x/2" },
                  ],
                },
              },
              { id: "T_2", isResolved: true, comments: { nodes: [] } },
            ],
          },
        },
      },
    },
  };

  it("flattens threads and comments, keeping resolution and order", () => {
    expect(parseThreads(JSON.stringify(graphql))).toEqual([
      {
        id: "T_1",
        isResolved: false,
        comments: [
          { body: "**[pr-reviewer]** fix", url: "https://x/1" },
          { body: "**[addresser]** fixed", url: "https://x/2" },
        ],
      },
      { id: "T_2", isResolved: true, comments: [] },
    ]);
  });

  it("returns [] when there are no threads", () => {
    const empty = {
      data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
    };
    expect(parseThreads(JSON.stringify(empty))).toEqual([]);
  });
});
