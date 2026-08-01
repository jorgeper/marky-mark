import { describe, expect, it } from "vitest";
import { interpretPickerAnswer, summarizeTitle } from "./shared.ts";

describe("summarizeTitle", () => {
  it("returns short text unchanged", () => {
    expect(summarizeTitle("search is slow on big repos")).toBe(
      "search is slow on big repos",
    );
  });

  it("collapses newlines and repeated whitespace", () => {
    expect(summarizeTitle("search   is\nslow")).toBe("search is slow");
  });

  it("uses the first sentence when it fits, dropping the terminator", () => {
    expect(
      summarizeTitle(
        "I want dictation formatting. So I want to brainstorm how to implement that.",
      ),
    ).toBe("I want dictation formatting");
  });

  it("truncates a long first sentence at a word boundary with an ellipsis", () => {
    const long =
      "I am thinking about prototyping a feature where as I'm dictating I can somehow do things like formatting in bullet points";
    const title = summarizeTitle(long);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("  ");
    // Word boundary: the character before the ellipsis is not a space and
    // the title is a prefix of the source text plus the ellipsis.
    expect(long.startsWith(title.slice(0, -1).trimEnd())).toBe(true);
  });

  it("respects a custom maximum length", () => {
    const title = summarizeTitle("one two three four five six seven", 15);
    expect(title.length).toBeLessThanOrEqual(15);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("interpretPickerAnswer", () => {
  it("finishes on empty or whitespace-only input", () => {
    expect(interpretPickerAnswer("", 3)).toEqual({ kind: "finish" });
    expect(interpretPickerAnswer("   ", 3)).toEqual({ kind: "finish" });
  });

  it("picks a candidate for an integer within range (1-based → 0-based)", () => {
    expect(interpretPickerAnswer("1", 3)).toEqual({ kind: "pick", index: 0 });
    expect(interpretPickerAnswer("3", 3)).toEqual({ kind: "pick", index: 2 });
    expect(interpretPickerAnswer(" 2 ", 3)).toEqual({ kind: "pick", index: 1 });
  });

  it("treats out-of-range numbers as a new topic", () => {
    expect(interpretPickerAnswer("7", 3)).toEqual({
      kind: "topic",
      topic: "7",
    });
    expect(interpretPickerAnswer("0", 3)).toEqual({
      kind: "topic",
      topic: "0",
    });
  });

  it("treats free text as a new topic, trimmed", () => {
    expect(interpretPickerAnswer("add dark mode to the site", 3)).toEqual({
      kind: "topic",
      topic: "add dark mode to the site",
    });
    expect(interpretPickerAnswer("  themed exports  ", 3)).toEqual({
      kind: "topic",
      topic: "themed exports",
    });
  });

  it("treats numeric input as a topic when there are no candidates", () => {
    expect(interpretPickerAnswer("1", 0)).toEqual({
      kind: "topic",
      topic: "1",
    });
  });

  it("only pure integers are picks — decimals are topics", () => {
    expect(interpretPickerAnswer("2.5", 3)).toEqual({
      kind: "topic",
      topic: "2.5",
    });
  });
});
