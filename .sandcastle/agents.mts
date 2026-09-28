import { claudeCode, copilot, type AgentProvider } from "sandcastle-local";
import { executionConfiguration, modelFor, type EffortConfig } from "./effort.mts";

/** One dispatch point for execution and the independent goal verifier; no harness fallback. */
export const agentForModel = (
  model: string,
  config: EffortConfig = executionConfiguration(),
): AgentProvider => {
  switch (config.harness) {
    case "claude-code":
      return claudeCode(model);
    case "copilot":
      return copilot(model, { goalVerifierModel: modelFor("reviewer", config) });
    default:
      throw new Error("Select an execution harness with npm run configure.");
  }
};
