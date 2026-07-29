import { describe, expect, it } from "vitest";
import {
  classifyIssue,
  classifyThread,
  type PrSnapshot,
  type ReviewThread,
  speakerOf,
} from "./state.mts";

const comment = (body: string) => ({ body, url: "https://example.com/c/1" });

const thread = (bodies: string[], isResolved = false): ReviewThread => ({
  id: `T_${bodies.join("|").length}`,
  isResolved,
  comments: bodies.map(comment),
});

const pr = (overrides: Partial<PrSnapshot>): PrSnapshot => ({
  number: 7,
  state: "OPEN",
  mergeable: "MERGEABLE",
  labels: [],
  reviewerHasReviewed: true,
  threads: [],
  ...overrides,
});

describe("speakerOf", () => {
  it("detects reviewer prefix", () => {
    expect(speakerOf("**[pr-reviewer]** looks wrong")).toBe("reviewer");
  });
  it("detects each author-side prefix", () => {
    expect(speakerOf("**[implementer]** done")).toBe("author");
    expect(speakerOf("**[addresser]** fixed")).toBe("author");
    expect(speakerOf("**[conflict-resolver]** rebased")).toBe("author");
  });
  it("treats unprefixed and unknown-prefixed comments as human", () => {
    expect(speakerOf("please rename this")).toBe("human");
    expect(speakerOf("**[somebody]** hi")).toBe("human");
  });
  it("parses detailed markers with harness and model", () => {
    expect(
      speakerOf("**[pr-reviewer · claude-code · claude-opus-4-8]** hm"),
    ).toBe("reviewer");
    expect(speakerOf("**[addresser · codex · gpt-5]** fixed")).toBe("author");
    expect(speakerOf("**[implementer: claude-code/opus]** done")).toBe(
      "author",
    );
  });
});

describe("classifyThread", () => {
  it("returns null for resolved threads", () => {
    expect(classifyThread(thread(["**[pr-reviewer]** nit"], true))).toBeNull();
  });
  it("author spoke last -> reviewer-work", () => {
    expect(
      classifyThread(thread(["**[pr-reviewer]** fix", "**[addresser]** fixed"])),
    ).toBe("reviewer-work");
  });
  it("reviewer spoke last -> addresser-work", () => {
    expect(classifyThread(thread(["**[pr-reviewer]** fix this"]))).toBe(
      "addresser-work",
    );
  });
  it("reviewer NEEDS-DECISION last -> awaiting-human", () => {
    expect(
      classifyThread(
        thread(["**[pr-reviewer]** ⚠️ NEEDS-DECISION: A says X, B says Y"]),
      ),
    ).toBe("awaiting-human");
  });
  it("human verdict after NEEDS-DECISION -> addresser-work", () => {
    expect(
      classifyThread(
        thread([
          "**[pr-reviewer]** ⚠️ NEEDS-DECISION: A vs B",
          "go with option B",
        ]),
      ),
    ).toBe("addresser-work");
  });
});

describe("classifyIssue", () => {
  it("no PR -> implement", () => {
    expect(classifyIssue(null)).toEqual({ kind: "implement" });
  });
  it("closed-unmerged PR with open issue -> abandoned", () => {
    expect(classifyIssue(pr({ state: "CLOSED" }))).toEqual({ kind: "abandoned" });
  });
  it("merged PR with open issue -> close-issue (auto-close race)", () => {
    expect(classifyIssue(pr({ state: "MERGED" }))).toEqual({
      kind: "close-issue",
    });
  });
  it("approved label + no unresolved threads -> merge", () => {
    expect(classifyIssue(pr({ labels: ["sandcastle:approved"] }))).toEqual({
      kind: "merge",
    });
  });
  it("approved label but conflicting -> resolve-conflicts", () => {
    expect(
      classifyIssue(
        pr({ labels: ["sandcastle:approved"], mergeable: "CONFLICTING" }),
      ),
    ).toEqual({ kind: "resolve-conflicts" });
  });
  it("approved label with unresolved threads is NOT merged", () => {
    expect(
      classifyIssue(
        pr({
          labels: ["sandcastle:approved"],
          threads: [thread(["**[pr-reviewer]** wait"])],
        }),
      ),
    ).toEqual({ kind: "addresser-turn" });
  });
  it("other labels do not trigger the merge gate", () => {
    expect(classifyIssue(pr({ labels: ["sandcastle:ready"] }))).toEqual({
      kind: "wait",
    });
  });
  it("addresser-work wins over reviewer-work", () => {
    expect(
      classifyIssue(
        pr({
          threads: [
            thread(["**[pr-reviewer]** fix", "**[addresser]** fixed"]),
            thread(["**[pr-reviewer]** also this"]),
          ],
        }),
      ),
    ).toEqual({ kind: "addresser-turn" });
  });
  it("only author-last threads -> reviewer-turn", () => {
    expect(
      classifyIssue(
        pr({ threads: [thread(["**[pr-reviewer]** x", "**[addresser]** done"])] }),
      ),
    ).toEqual({ kind: "reviewer-turn" });
  });
  it("all threads awaiting human -> wait", () => {
    expect(
      classifyIssue(
        pr({ threads: [thread(["**[pr-reviewer]** ⚠️ NEEDS-DECISION: x"])] }),
      ),
    ).toEqual({ kind: "wait" });
  });
  it("open PR never reviewed (crash recovery) -> reviewer-turn", () => {
    expect(classifyIssue(pr({ reviewerHasReviewed: false }))).toEqual({
      kind: "reviewer-turn",
    });
  });
  it("reviewed, no threads, not approved -> wait (awaiting owner)", () => {
    expect(classifyIssue(pr({}))).toEqual({ kind: "wait" });
  });
});
