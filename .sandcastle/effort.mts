// Effort tiers — the one place that turns config.mts's EFFORT_TIERS and
// AGENT_TIERS into decisions:
//
//   modelFor(role)          which model an agent runs on (its configured tier)
//   effortLabelDefs()       the `sandcastle:effort-<tier>` issue labels
//   requiredTier(labels)    the tier an issue's labels demand
//   eligibility(...)        can this setup take this issue, or which agents
//                           on its path fall short
//   skipComment(...)        the note the loop leaves on a held issue, with a
//                           configuration signature so it is posted once
//   agentTable()            what `npm run sandcastle:agents` / /config-agents show
//
// Pure: every function takes the configuration as an argument (defaulting
// to config.mts) so tests never depend on the live setup, and nothing here
// touches gh, the filesystem, or the sandbox.

import { AGENT_TIERS, EFFORT_TIERS } from "./config.mts";

export interface EffortTier {
  name: string;
  model: string;
}

export interface EffortConfig {
  /** Ordered weakest → strongest. */
  tiers: readonly EffortTier[];
  /** Agent role → tier name. */
  agentTiers: Readonly<Record<string, string>>;
}

export const LIVE_CONFIG: EffortConfig = {
  tiers: EFFORT_TIERS,
  agentTiers: AGENT_TIERS,
};

export const EFFORT_LABEL_PREFIX = "sandcastle:effort-";
export const effortLabelFor = (tier: string): string =>
  `${EFFORT_LABEL_PREFIX}${tier}`;

// Agents that work one specific issue, in the order the loop runs them. An
// issue's tier applies to every one of these; the planner and decomposer
// reason across issues and are never gated by any single issue's label.
export const ISSUE_PATH_AGENTS = [
  "spec-writer",
  "implementer",
  "reviewer",
  "merger",
  "conflict-resolver",
] as const;
export const PR_PATH_AGENTS = ["pr-reviewer", "addresser"] as const;

const tierRank = (name: string, config: EffortConfig): number =>
  config.tiers.findIndex((tier) => tier.name === name);

const tierByName = (name: string, config: EffortConfig): EffortTier => {
  const tier = config.tiers.find((t) => t.name === name);
  if (tier === undefined) {
    throw new Error(
      `effort tier "${name}" is not in EFFORT_TIERS (${config.tiers.map((t) => t.name).join(", ")}) — fix .sandcastle/config.mts or run /config-agents`,
    );
  }
  return tier;
};

/** The model an agent runs on: its configured tier's model. */
export const modelFor = (
  role: string,
  config: EffortConfig = LIVE_CONFIG,
): string => {
  const tierName = config.agentTiers[role];
  if (tierName === undefined) {
    throw new Error(
      `agent "${role}" has no tier in AGENT_TIERS — add it to .sandcastle/config.mts`,
    );
  }
  return tierByName(tierName, config).model;
};

/** Every configuration problem the doctor (and the loop, before it starts)
 *  should name. Empty means the config is sound. */
export const effortConfigErrors = (
  config: EffortConfig = LIVE_CONFIG,
): string[] => {
  const errors: string[] = [];
  if (config.tiers.length === 0) {
    errors.push("EFFORT_TIERS is empty — declare at least one tier");
  }
  const names = new Set<string>();
  for (const tier of config.tiers) {
    if (names.has(tier.name)) {
      errors.push(`EFFORT_TIERS names "${tier.name}" twice`);
    }
    names.add(tier.name);
    if (!tier.model) errors.push(`tier "${tier.name}" has no model`);
  }
  for (const [role, tierName] of Object.entries(config.agentTiers)) {
    if (!names.has(tierName)) {
      errors.push(
        `agent "${role}" is configured at tier "${tierName}", which EFFORT_TIERS does not define`,
      );
    }
  }
  for (const role of [...ISSUE_PATH_AGENTS, ...PR_PATH_AGENTS]) {
    if (!(role in config.agentTiers)) {
      errors.push(`agent "${role}" is missing from AGENT_TIERS`);
    }
  }
  return errors;
};

export interface LabelDef {
  name: string;
  color: string;
  desc: string;
}

/** One issue label per tier, in tier order. */
export const effortLabelDefs = (
  tiers: readonly EffortTier[] = LIVE_CONFIG.tiers,
): LabelDef[] =>
  tiers.map((tier, index) => ({
    name: effortLabelFor(tier.name),
    color: "C5DEF5",
    desc:
      index === 0
        ? `Needs the ${tier.name} effort tier (${tier.model}) — the default for unlabeled issues`
        : `Needs the ${tier.name} effort tier (${tier.model}) on every agent that works it`,
  }));

/** The tier an issue's labels demand: the strongest effort label present,
 *  else the weakest tier. Labels naming no configured tier are ignored. */
export const requiredTier = (
  labels: readonly string[],
  config: EffortConfig = LIVE_CONFIG,
): string => {
  let best = 0;
  for (const label of labels) {
    if (!label.startsWith(EFFORT_LABEL_PREFIX)) continue;
    const rank = tierRank(label.slice(EFFORT_LABEL_PREFIX.length), config);
    if (rank > best) best = rank;
  }
  return config.tiers[best]!.name;
};

export interface ShortAgent {
  role: string;
  tier: string;
  model: string;
}

export type Eligibility =
  | { ok: true; required: string }
  | { ok: false; required: string; short: ShortAgent[] };

/** Can this configuration take the issue? Every agent on the issue's path
 *  must sit at or above the required tier; agents above it are fine (a hard
 *  implementer takes normal issues, at hard). */
export const eligibility = (
  labels: readonly string[],
  prLabeled: boolean,
  config: EffortConfig = LIVE_CONFIG,
): Eligibility => {
  const required = requiredTier(labels, config);
  const needed = tierRank(required, config);
  const path = prLabeled
    ? [...ISSUE_PATH_AGENTS, ...PR_PATH_AGENTS]
    : [...ISSUE_PATH_AGENTS];
  const short: ShortAgent[] = [];
  for (const role of path) {
    const tier = config.agentTiers[role] ?? config.tiers[0]!.name;
    if (tierRank(tier, config) < needed) {
      short.push({ role, tier, model: tierByName(tier, config).model });
    }
  }
  return short.length === 0 ? { ok: true, required } : { ok: false, required, short };
};

/** A short stable fingerprint of the configuration, so a held issue is
 *  commented on once per configuration rather than once per run. */
export const configSignature = (config: EffortConfig = LIVE_CONFIG): string => {
  const canonical = JSON.stringify({
    tiers: config.tiers.map((t) => [t.name, t.model]),
    agents: Object.entries(config.agentTiers).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  });
  // djb2 — collisions only matter between two configs the same issue sees
  // back to back, and even then the cost is one missing comment.
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash + canonical.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const SKIP_MARKER = "sandcastle:effort-skip";
const skipMarkerFor = (config: EffortConfig): string =>
  `<!-- ${SKIP_MARKER} ${configSignature(config)} -->`;

export const skipComment = (
  verdict: Extract<Eligibility, { ok: false }>,
  config: EffortConfig = LIVE_CONFIG,
): string => {
  const requiredModel = tierByName(verdict.required, config).model;
  return [
    `**[orchestrator]** Skipping this issue for now: it is labeled \`${effortLabelFor(verdict.required)}\`, but the current agent configuration runs these agents on its path below that tier:`,
    ``,
    ...verdict.short.map((s) => `- ${s.role}: ${s.tier} (${s.model})`),
    ``,
    `Run \`/config-agents\` to raise them to \`${verdict.required}\` (${requiredModel}), or relabel the issue. The loop re-checks on every run and says nothing more until the configuration changes.`,
    skipMarkerFor(config),
  ].join("\n");
};

/** True when a skip comment for exactly this configuration is already on
 *  the issue. */
export const skipAlreadyPosted = (
  commentBodies: readonly string[],
  config: EffortConfig = LIVE_CONFIG,
): boolean => {
  const marker = skipMarkerFor(config);
  return commentBodies.some((body) => body.includes(marker));
};

/** The table `npm run sandcastle:agents` prints and /config-agents reads. */
export const agentTable = (config: EffortConfig = LIVE_CONFIG): string => {
  const roleWidth = Math.max(
    ...Object.keys(config.agentTiers).map((r) => r.length),
    "agent".length,
  );
  const tierWidth = Math.max(
    ...config.tiers.map((t) => t.name.length),
    "tier".length,
  );
  const modelWidth = Math.max(...config.tiers.map((t) => t.model.length), 0);
  const lines = [
    `Effort tiers (weakest → strongest), from .sandcastle/config.mts:`,
    ``,
    ...config.tiers.map(
      (t) => `  ${t.name.padEnd(tierWidth)}  ${t.model.padEnd(modelWidth)}  label: ${effortLabelFor(t.name)}`,
    ),
    ``,
    `Agents:`,
    ``,
    `  ${"agent".padEnd(roleWidth)}  ${"tier".padEnd(tierWidth)}  model`,
    ...Object.entries(config.agentTiers).map(([role, tier]) => {
      const model = config.tiers.find((t) => t.name === tier)?.model ?? "(unknown tier!)";
      return `  ${role.padEnd(roleWidth)}  ${tier.padEnd(tierWidth)}  ${model}`;
    }),
    ``,
    `Issue path (all must meet the issue's label): ${ISSUE_PATH_AGENTS.join(", ")}; plus ${PR_PATH_AGENTS.join(", ")} for PR-labeled issues.`,
  ];
  const errors = effortConfigErrors(config);
  if (errors.length > 0) {
    lines.push(``, `Problems:`, ...errors.map((e) => `  ⚠ ${e}`));
  }
  return lines.join("\n");
};
