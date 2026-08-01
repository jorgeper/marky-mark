import { describe, expect, it } from "vitest";
import { parseEnvFile, prSetupGuide, readPrConfig } from "./env.mts";

describe("parseEnvFile", () => {
  it("parses KEY=VALUE lines, skipping comments and blanks", () => {
    const content = [
      "# comment",
      "",
      "GH_TOKEN=abc123",
      "SOME_KEY = value ",
      "NOT_A_PAIR",
    ].join("\n");
    expect(parseEnvFile(content)).toEqual({
      GH_TOKEN: "abc123",
      SOME_KEY: "value",
    });
  });

  it("keeps '=' inside values", () => {
    expect(parseEnvFile("A=b=c")).toEqual({ A: "b=c" });
  });
});

describe("readPrConfig", () => {
  it("ok when GH_TOKEN present", () => {
    expect(readPrConfig({ GH_TOKEN: "github_pat_x" })).toEqual({
      ok: true,
      missing: [],
    });
  });

  it("reports GH_TOKEN missing", () => {
    expect(readPrConfig({})).toEqual({ ok: false, missing: ["GH_TOKEN"] });
  });
});

describe("prSetupGuide", () => {
  it("mentions the missing key, scopes, setup file, and approval label", () => {
    const guide = prSetupGuide(["GH_TOKEN"]);
    expect(guide).toContain("GH_TOKEN");
    expect(guide).toContain(".sandcastle/.env");
    expect(guide).toContain("PR_SETUP.md");
    expect(guide).toContain("Pull requests (R/W)");
    expect(guide).toContain("sandcastle:approved");
  });
});
