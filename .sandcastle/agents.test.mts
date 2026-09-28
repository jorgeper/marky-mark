import { describe, expect, it } from "vitest";
import { agentForModel } from "./agents.mts";
import { effectiveConfiguration } from "./configuration.mjs";
import { copilotCredentialProblem, parseEnvFile } from "./env.mts";

describe("selected Sandcastle execution harness", () => {
  it("U1491: dispatches both harnesses with explicit role and reviewer models", () => {
    for (const harness of ["copilot", "claude-code"] as const) {
      const config = effectiveConfiguration({
        version: 1, harness, models: { normal: "worker", hard: "judge" },
        agentTiers: { reviewer: "hard" },
      });
      const agent = agentForModel("worker", config);
      expect(agent.name).toBe(harness);
      expect(agent.model).toBe("worker");
      expect(agent.sessionStorage).toBeDefined();
      expect(agent.composeGoalPrompt).toBeDefined();
      expect(agent.goalVerifier?.model).toBe(harness === "copilot" ? "judge" : undefined);
      expect(agent.buildPrintCommand({
        prompt: "work", dangerouslySkipPermissions: true, resumeSession: "same-session",
      }).command).toContain("same-session");
    }
    expect(() => agentForModel("worker", { tiers: [], agentTiers: {} })).toThrow(/Select/);
  });
  it("U1492: repository or Claude credentials cannot substitute for a dedicated Copilot token", () => {
    const unrelated: Record<string, string>[] = [{}, { GH_TOKEN: "github_pat_fake" }, { CLAUDE_CODE_OAUTH_TOKEN: "fake" }];
    for (const vars of unrelated) {
      expect(copilotCredentialProblem(vars)).toContain("COPILOT_GITHUB_TOKEN");
    }
    expect(copilotCredentialProblem({ COPILOT_GITHUB_TOKEN: "ghp_fake" })).toContain("classic PAT");
    expect(copilotCredentialProblem(parseEnvFile('COPILOT_GITHUB_TOKEN="github_pat_fake"'))).toBeUndefined();
  });
});
