import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Shared policy has no harness or model defaults. Only local.json selects them.
export const TIER_NAMES = Object.freeze(["normal", "hard"]);
/** @type {Readonly<Record<string, string>>} */
export const DEFAULT_AGENT_TIERS = Object.freeze({
  planner: "hard",
  "spec-writer": "hard",
  implementer: "hard",
  reviewer: "hard",
  merger: "hard",
  "conflict-resolver": "hard",
  decomposer: "hard",
  "pr-reviewer": "hard",
  addresser: "hard",
  designer: "hard",
  filer: "hard",
});
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCAL_CONFIG = ".sandcastle/local.json";
export const COPILOT_BLOCKER =
  "Copilot execution is not implemented for this workflow's goals, conversations, or sandbox authentication yet. No agents will run; there is no Claude fallback.";

/**
 * @typedef {"claude-code" | "copilot"} Harness
 * @typedef {{version: 1, harness: Harness, models: Record<string, string>, agentTiers: Record<string, string>}} LocalConfiguration
 */

export class ConfigurationError extends Error {}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {Record<string, unknown>} value @param {string[]} allowed @param {string} label */
function checkKeys(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ConfigurationError(`${label} contains unknown fields. Credentials do not belong in ${LOCAL_CONFIG}.`);
  }
}

/** @param {unknown} value @returns {value is string} */
export const isModelId = (value) =>
  typeof value === "string" && value.length <= 256
  && !["auto", "default"].includes(value.toLowerCase())
  && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*(?:\[1m\])?$/.test(value);

/** @param {unknown} value @returns {LocalConfiguration} */
export function validateConfiguration(value) {
  if (!isObject(value)) throw new ConfigurationError("Configuration must be a JSON object.");
  checkKeys(value, ["version", "harness", "models", "agentTiers"], "Configuration");
  if (value.version !== 1) throw new ConfigurationError("Configuration version must be 1.");
  if (value.harness !== "claude-code" && value.harness !== "copilot") {
    throw new ConfigurationError("Select a harness explicitly: claude-code or copilot.");
  }
  if (!isObject(value.models)) throw new ConfigurationError("Select a model for every tier.");
  checkKeys(value.models, [...TIER_NAMES], "Models");
  /** @type {Record<string, string>} */
  const models = {};
  for (const tier of TIER_NAMES) {
    const model = value.models[tier];
    if (!isModelId(model)) {
      throw new ConfigurationError(`Tier ${tier} needs an explicit model ID (no whitespace or shell arguments).`);
    }
    models[tier] = model;
  }
  const overrides = value.agentTiers === undefined ? {} : value.agentTiers;
  if (!isObject(overrides)) throw new ConfigurationError("agentTiers must be an object.");
  checkKeys(overrides, Object.keys(DEFAULT_AGENT_TIERS), "Agent assignments");
  /** @type {Record<string, string>} */
  const agentTiers = {};
  for (const [role, tier] of Object.entries(overrides)) {
    if (typeof tier !== "string" || !TIER_NAMES.includes(tier)) {
      throw new ConfigurationError(`Agent ${role} must use a shared tier: ${TIER_NAMES.join(", ")}.`);
    }
    agentTiers[role] = tier;
  }
  return { version: 1, harness: value.harness, models, agentTiers };
}

export function readConfigurationText(cwd = ROOT) {
  try {
    return readFileSync(join(cwd, LOCAL_CONFIG), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/** @param {string | null} text @returns {LocalConfiguration} */
export function parseConfiguration(text) {
  if (text === null) {
    throw new ConfigurationError(`Not configured. Run npm run configure to select a harness and models on this machine.`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigurationError(`${LOCAL_CONFIG} is not valid JSON. Run npm run configure to repair it.`);
  }
  return validateConfiguration(value);
}

export function loadConfiguration(cwd = ROOT) {
  return parseConfiguration(readConfigurationText(cwd));
}

/** @param {LocalConfiguration} config */
export function effectiveConfiguration(config) {
  return {
    harness: config.harness,
    tiers: TIER_NAMES.map((name) => ({ name, model: config.models[name] })),
    agentTiers: { ...DEFAULT_AGENT_TIERS, ...config.agentTiers },
  };
}

export function requireRunnableConfiguration(cwd = ROOT) {
  const config = loadConfiguration(cwd);
  if (config.harness === "copilot") throw new ConfigurationError(COPILOT_BLOCKER);
  return config;
}

/**
 * Save only after confirmation, without overwriting edits made since the wizard opened.
 * @param {LocalConfiguration} config
 * @param {string} cwd
 * @param {string | null} expectedText
 */
export function saveConfiguration(config, cwd, expectedText) {
  const validated = validateConfiguration(config);
  if (readConfigurationText(cwd) !== expectedText) {
    throw new ConfigurationError("Configuration changed while the wizard was open. Nothing saved; rerun npm run configure.");
  }
  const path = join(cwd, LOCAL_CONFIG);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** @param {LocalConfiguration} config */
export function configurationTable(config) {
  const effective = effectiveConfiguration(config);
  return [
    `Harness: ${config.harness} (local: ${LOCAL_CONFIG})`,
    "",
    "Tiers (shared order, local models):",
    ...effective.tiers.map(({ name, model }) => `  ${name.padEnd(8)} ${model}`),
    "",
    "Agent                Tier      Model                         Assignment source",
    ...Object.entries(effective.agentTiers).map(([role, tier]) =>
      `  ${role.padEnd(19)} ${tier.padEnd(9)} ${config.models[tier].padEnd(29)} ${Object.hasOwn(config.agentTiers, role) ? "local override" : "shared policy"}`),
    "",
    "Model execution is unverified; this view does not authenticate or refresh the model catalog.",
    ...(config.harness === "copilot" ? [COPILOT_BLOCKER] : []),
  ].join("\n");
}

export function showConfiguration(cwd = ROOT, log = console.log) {
  try {
    log(configurationTable(loadConfiguration(cwd)));
    return 0;
  } catch (error) {
    log(`SETUP NEEDED: ${error instanceof Error ? error.message : String(error)}`);
    log("Run: npm run configure");
    return 1;
  }
}
