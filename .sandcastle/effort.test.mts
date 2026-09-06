import { describe, expect, it } from "vitest";
import { AGENT_TIERS, EFFORT_TIERS } from "./config.mts";
import {
  agentTable,
  configSignature,
  effortConfigErrors,
  effortLabelDefs,
  eligibility,
  modelFor,
  requiredTier,
  skipAlreadyPosted,
  skipComment,
  type EffortConfig,
} from "./effort.mts";

// A two-tier fixture so the tests never depend on what config.mts says today.
const tiers = [
  { name: "normal", model: "model-normal" },
  { name: "hard", model: "model-hard" },
];
const allNormal: EffortConfig = {
  tiers,
  agentTiers: {
    planner: "normal",
    "spec-writer": "normal",
    implementer: "normal",
    reviewer: "normal",
    merger: "normal",
    "conflict-resolver": "normal",
    decomposer: "normal",
    "pr-reviewer": "normal",
    addresser: "normal",
  },
};
const withHardPath: EffortConfig = {
  tiers,
  agentTiers: {
    ...allNormal.agentTiers,
    "spec-writer": "hard",
    implementer: "hard",
    reviewer: "hard",
    merger: "hard",
    "conflict-resolver": "hard",
  },
};

describe("effort tiers: model resolution", () => {
  it("resolves an agent's model through its configured tier", () => {
    expect(modelFor("implementer", withHardPath)).toBe("model-hard");
    expect(modelFor("planner", withHardPath)).toBe("model-normal");
  });

  it("throws for an agent the config does not name", () => {
    expect(() => modelFor("nobody", allNormal)).toThrow(/nobody/);
  });

  it("the real config resolves every agent to a model", () => {
    for (const role of Object.keys(AGENT_TIERS)) {
      expect(modelFor(role)).toMatch(/^claude-/);
    }
    expect(effortConfigErrors()).toEqual([]);
  });
});

describe("effort tiers: config validation", () => {
  it("reports an agent configured at an unknown tier", () => {
    const errors = effortConfigErrors({
      tiers,
      agentTiers: { ...allNormal.agentTiers, implementer: "heroic" },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/implementer/);
    expect(errors[0]).toMatch(/heroic/);
  });

  it("reports an agent on the issue path that the config omits", () => {
    const { implementer: _dropped, ...rest } = allNormal.agentTiers;
    const errors = effortConfigErrors({ tiers, agentTiers: rest });
    expect(errors.join("\n")).toMatch(/implementer/);
  });

  it("reports an empty tier list", () => {
    expect(effortConfigErrors({ tiers: [], agentTiers: {} })).not.toEqual([]);
  });
});

describe("effort tiers: labels", () => {
  it("derives one sandcastle:effort-<tier> label per tier, in tier order", () => {
    expect(effortLabelDefs(tiers).map((d) => d.name)).toEqual([
      "sandcastle:effort-normal",
      "sandcastle:effort-hard",
    ]);
  });

  it("the real config derives a label for every configured tier", () => {
    expect(effortLabelDefs().map((d) => d.name)).toEqual(
      EFFORT_TIERS.map((t) => `sandcastle:effort-${t.name}`),
    );
  });

  it("an unlabeled issue requires the weakest tier", () => {
    expect(requiredTier(["sandcastle"], allNormal)).toBe("normal");
  });

  it("the strongest effort label wins when several are present", () => {
    expect(
      requiredTier(
        ["sandcastle:effort-normal", "sandcastle", "sandcastle:effort-hard"],
        allNormal,
      ),
    ).toBe("hard");
  });

  it("an effort label naming no configured tier is ignored", () => {
    expect(requiredTier(["sandcastle:effort-heroic"], allNormal)).toBe(
      "normal",
    );
  });
});

describe("effort tiers: issue eligibility", () => {
  it("a normal issue is eligible under an all-normal config", () => {
    expect(eligibility(["sandcastle"], false, allNormal)).toEqual({
      ok: true,
      required: "normal",
    });
  });

  it("a hard issue is held when the issue path runs below hard, naming the short agents", () => {
    const verdict = eligibility(
      ["sandcastle", "sandcastle:effort-hard"],
      false,
      allNormal,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.required).toBe("hard");
    expect(verdict.short.map((s) => s.role)).toEqual([
      "spec-writer",
      "implementer",
      "reviewer",
      "merger",
      "conflict-resolver",
    ]);
    expect(verdict.short[0]).toEqual({
      role: "spec-writer",
      tier: "normal",
      model: "model-normal",
    });
  });

  it("a hard issue is eligible once every agent on its path is hard", () => {
    expect(
      eligibility(["sandcastle:effort-hard"], false, withHardPath).ok,
    ).toBe(true);
  });

  it("a PR-labeled hard issue also needs the PR agents at hard", () => {
    const verdict = eligibility(["sandcastle:effort-hard"], true, withHardPath);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.short.map((s) => s.role)).toEqual([
      "pr-reviewer",
      "addresser",
    ]);
  });

  it("agents above the required tier are never short (hard agents take normal issues)", () => {
    expect(eligibility(["sandcastle"], true, withHardPath).ok).toBe(true);
  });

  it("the planner and decomposer are cross-issue agents and never gate an issue", () => {
    const planner: EffortConfig = {
      tiers,
      agentTiers: { ...withHardPath.agentTiers, "pr-reviewer": "hard", addresser: "hard" },
    };
    expect(eligibility(["sandcastle:effort-hard"], true, planner).ok).toBe(true);
  });
});

describe("effort tiers: the skip comment", () => {
  const verdict = eligibility(["sandcastle:effort-hard"], false, allNormal);

  it("names the label, the short agents with tier and model, and the fix", () => {
    if (verdict.ok) throw new Error("fixture must be ineligible");
    const body = skipComment(verdict, allNormal);
    expect(body).toContain("`sandcastle:effort-hard`");
    expect(body).toContain("implementer");
    expect(body).toContain("normal (model-normal)");
    expect(body).toContain("`hard` (model-hard)");
    expect(body).toContain("/config-agents");
  });

  it("is posted once per configuration: the signature marker makes re-posts detectable", () => {
    if (verdict.ok) throw new Error("fixture must be ineligible");
    const body = skipComment(verdict, allNormal);
    expect(skipAlreadyPosted([], allNormal)).toBe(false);
    expect(skipAlreadyPosted(["unrelated", body], allNormal)).toBe(true);
    // A changed configuration is a new situation — say so again.
    expect(skipAlreadyPosted([body], withHardPath)).toBe(false);
  });

  it("the signature is stable across key order and differs across configs", () => {
    const reordered: EffortConfig = {
      tiers,
      agentTiers: Object.fromEntries(
        Object.entries(allNormal.agentTiers).reverse(),
      ),
    };
    expect(configSignature(reordered)).toBe(configSignature(allNormal));
    expect(configSignature(withHardPath)).not.toBe(configSignature(allNormal));
  });
});

describe("effort tiers: the agent table", () => {
  it("lists every tier with its model and every agent with tier and model", () => {
    const table = agentTable(withHardPath);
    expect(table).toMatch(/hard\s+model-hard/);
    expect(table).toMatch(/implementer\s+hard\s+model-hard/);
    expect(table).toMatch(/planner\s+normal\s+model-normal/);
  });
});
