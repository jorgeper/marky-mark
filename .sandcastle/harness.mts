// Harness selection — the one place a tier's harness becomes an engine
// provider. effort.mts stays pure (tiers → names/models, no engine import);
// this module owns the @ai-hero/sandcastle dependency so every spawn site
// (main.ts and the conversational scripts) constructs its agent the same
// way: agentFor("<role>"). Credentials ride the env resolver — keys
// declared in .sandcastle/.env reach the sandbox, so the codex CLI finds
// OPENAI_API_KEY there without provider-level env plumbing.

import { claudeCode, codex, type AgentProvider } from "@ai-hero/sandcastle";
import {
  LIVE_CONFIG,
  tierFor,
  type EffortConfig,
  type Harness,
} from "./effort.mts";

export const agentFor = (
  role: string,
  config: EffortConfig = LIVE_CONFIG,
): AgentProvider => {
  const tier = tierFor(role, config);
  switch (tier.harness) {
    case "codex":
      return codex(tier.model);
    case "claude-code":
      return claudeCode(tier.model);
    default: {
      // KNOWN_HARNESSES and this switch must agree; effortConfigErrors()
      // reports the mismatch at startup, this throw is the backstop.
      const unknown: never = tier.harness;
      throw new Error(`tier "${tier.name}" names unknown harness "${unknown as Harness}"`);
    }
  }
};
