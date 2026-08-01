import { describe, expect, it } from "vitest";
import {
  effectiveQuickCommands,
  missingVerifyScripts,
  verifyCommandsText,
} from "./verify.mts";

describe("verifyCommandsText", () => {
  it("formats one command", () => {
    expect(verifyCommandsText(["npm run typecheck"])).toBe(
      "`npm run typecheck`",
    );
  });
  it("joins two with and", () => {
    expect(verifyCommandsText(["npm run typecheck", "npm run test:unit"])).toBe(
      "`npm run typecheck` and `npm run test:unit`",
    );
  });
  it("comma-joins three", () => {
    expect(verifyCommandsText(["a", "b", "c"])).toBe("`a`, `b` and `c`");
  });
  it("falls back to a config.mts pointer when empty", () => {
    expect(verifyCommandsText([])).toContain(".sandcastle/config.mts");
  });
});

describe("missingVerifyScripts", () => {
  const scripts = { typecheck: "tsc", "test:unit": "vitest run" };
  it("flags pm-run scripts missing from package.json", () => {
    expect(
      missingVerifyScripts(["npm run typecheck", "npm run test"], scripts),
    ).toEqual(["test"]);
  });
  it("ignores non-pm-run commands (binaries checked elsewhere)", () => {
    expect(missingVerifyScripts(["cargo check", "pytest"], scripts)).toEqual(
      [],
    );
  });
  it("handles pnpm/yarn/bun runners", () => {
    expect(missingVerifyScripts(["pnpm run lint"], scripts)).toEqual(["lint"]);
  });
});

describe("effectiveQuickCommands", () => {
  it("returns the quick list when declared", () => {
    expect(
      effectiveQuickCommands(["npm run typecheck"], ["npm run typecheck", "npm run test"]),
    ).toEqual(["npm run typecheck"]);
  });

  it("falls back to the full list when quick is empty", () => {
    expect(effectiveQuickCommands([], ["npm run test"])).toEqual([
      "npm run test",
    ]);
  });
});
