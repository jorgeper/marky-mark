import { describe, expect, it } from "vitest";
import {
  detectInstalls,
  dockerfileSuggestion,
  runSectionsSince,
  updateTally,
  formatNudges,
  type InstallTally,
} from "./install-scan.mts";

describe("dockerfileSuggestion", () => {
  it("suggests playwright with-deps, carrying the browsers from the command", () => {
    const d = {
      key: "playwright-browsers",
      label: "Playwright browsers",
      line: "Bash(npx playwright install chromium 2>&1 | tail -10)",
    };
    const suggestion = dockerfileSuggestion(d);
    expect(suggestion).toContain("ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright");
    expect(suggestion).toContain("install --with-deps chromium");
    expect(suggestion).toContain("chmod -R a+rX /ms-playwright");
  });

  it("parses package names out of an apt line, dropping flags and shell noise", () => {
    const d = {
      key: "apt-packages",
      label: "apt",
      line: "Bash(whoami; id; apt-get install -y libnss3 2>&1 | tail -3)",
    };
    expect(dockerfileSuggestion(d)).toBe(
      "RUN apt-get update && apt-get install -y libnss3",
    );
  });

  it("handles npm globals", () => {
    const d = {
      key: "npm-global",
      label: "npm -g",
      line: "npm install -g tsx vitest && echo done",
    };
    expect(dockerfileSuggestion(d)).toBe("RUN npm install -g tsx vitest");
  });

  it("falls back to a placeholder when packages can't be parsed", () => {
    const d = { key: "apk-packages", label: "apk", line: "apk add $(cat x)" };
    expect(dockerfileSuggestion(d)).toBe("RUN apk add --no-cache <packages>");
  });
});

describe("detectInstalls", () => {
  it("detects playwright browser installs", () => {
    const log = "⚙ Bash npx playwright install --with-deps chromium\nok";
    const found = detectInstalls(log);
    expect(found.map((d) => d.key)).toEqual(["playwright-browsers"]);
    expect(found[0]!.line).toContain("playwright install");
  });

  it("detects system package managers", () => {
    const log = [
      "sudo apt-get install -y libnss3",
      "apk add chromium",
      "sudo dnf install jq",
    ].join("\n");
    expect(detectInstalls(log).map((d) => d.key)).toEqual([
      "apt-packages",
      "apk-packages",
      "dnf-yum-packages",
    ]);
  });

  it("detects global npm installs but NOT worktree installs", () => {
    expect(detectInstalls("npm install -g tsx").map((d) => d.key)).toEqual([
      "npm-global",
    ]);
    expect(detectInstalls("npm install")).toEqual([]);
    expect(detectInstalls("npm install --save-dev vitest")).toEqual([]);
    expect(detectInstalls("yarn install && pnpm install")).toEqual([]);
  });

  it("reports each signature once per scan", () => {
    const log = "npx playwright install\nnpx playwright install chromium";
    expect(detectInstalls(log)).toHaveLength(1);
  });
});

describe("updateTally", () => {
  const detection = {
    key: "playwright-browsers",
    label: "Playwright browsers",
    line: "npx playwright install",
  };

  it("increments run counts across updates for the same image", () => {
    const first = updateTally(undefined, "img-1", [detection]);
    expect(first.entries["playwright-browsers"]!.runs).toBe(1);
    const second = updateTally(first, "img-1", [detection]);
    expect(second.entries["playwright-browsers"]!.runs).toBe(2);
  });

  it("resets when the image id changes (owner rebuilt the image)", () => {
    const first = updateTally(undefined, "img-1", [detection]);
    const afterRebuild = updateTally(first, "img-2", []);
    expect(afterRebuild.entries).toEqual({});
    expect(afterRebuild.imageId).toBe("img-2");
  });

  it("a run with no detections leaves existing counts unchanged", () => {
    const first = updateTally(undefined, "img-1", [detection]);
    const second = updateTally(first, "img-1", []);
    expect(second.entries["playwright-browsers"]!.runs).toBe(1);
  });
});

describe("formatNudges", () => {
  it("names the install, the repeat count, and the Dockerfile fix", () => {
    const detection = {
      key: "playwright-browsers",
      label: "Playwright browsers (`npx playwright install`)",
      line: "npx playwright install",
    };
    const tally: InstallTally = {
      imageId: "img-1",
      entries: { "playwright-browsers": { runs: 3, lastExample: "x" } },
    };
    const [nudge] = formatNudges(tally, [detection]);
    expect(nudge).toContain("Playwright browsers");
    expect(nudge).toContain("seen in 3 runs");
    expect(nudge).toContain(".sandcastle/Dockerfile");
    expect(nudge).toContain("npx sandcastle docker build-image");
    // The nudge carries the ready-to-paste Dockerfile line.
    expect(nudge).toContain("PLAYWRIGHT_BROWSERS_PATH=/ms-playwright");
    expect(nudge).toContain("install --with-deps");
  });

  it("omits the repeat clause on first sighting", () => {
    const detection = { key: "apt-packages", label: "apt", line: "apt" };
    const tally: InstallTally = {
      imageId: "img-1",
      entries: { "apt-packages": { runs: 1, lastExample: "x" } },
    };
    expect(formatNudges(tally, [detection])[0]).not.toContain("seen in");
  });
});

describe("runSectionsSince", () => {
  const log = [
    "ancient preamble npx playwright install chromium",
    "--- Run started: 2026-07-30T10:00:00.000Z ---",
    "old run: apt-get install libfoo",
    "--- Run started: 2026-08-01T04:00:00.000Z ---",
    "new run: npm install -g tsx",
  ].join("\n");

  it("keeps only runs started at or after sinceMs", () => {
    const since = Date.parse("2026-08-01T00:00:00.000Z");
    const scoped = runSectionsSince(log, since);
    expect(scoped).toContain("npm install -g tsx");
    expect(scoped).not.toContain("apt-get install libfoo");
    expect(scoped).not.toContain("playwright install");
  });

  it("returns the whole text when sinceMs is 0", () => {
    expect(runSectionsSince(log, 0)).toBe(log);
  });
});
