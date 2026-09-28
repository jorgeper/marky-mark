import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverModels } from "./model-discovery.mjs";
import {
  ConfigurationError, COPILOT_SETUP, DEFAULT_AGENT_TIERS, LOCAL_CONFIG, ROOT,
  TIER_NAMES, configurationTable, isModelId, parseConfiguration,
  readConfigurationText, saveConfiguration, showConfiguration,
} from "./configuration.mjs";

class Cancelled extends Error {}

/**
 * @param {{cwd?: string, ask: (question: string) => Promise<string | null>, log?: (message: string) => void, discover?: typeof discoverModels, signal?: AbortSignal}} options
 */
export async function configure({ cwd = ROOT, ask, log = console.log, discover = discoverModels, signal }) {
  const original = readConfigurationText(cwd);
  /** @type {import("./configuration.mjs").LocalConfiguration | undefined} */
  let draft;
  try {
    draft = parseConfiguration(original);
    log(configurationTable(draft));
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    log(`SETUP NEEDED: ${error.message}`);
    if (original !== null) log("The existing file will remain untouched unless you confirm its replacement.");
  }
  log("\nModel selection checks native CLI authentication and model metadata only: no inference prompts, agents, automatic logins, or GitHub writes.");
  log("Normal CLI startup, including native updates and credential/cache maintenance, may occur. Secrets are never copied into configuration. Type :cancel at any prompt to discard changes.");

  /** @param {string} question */
  const answer = async (question) => {
    const result = await ask(question);
    if (result === null || result.trim() === ":cancel") throw new Cancelled();
    return result.trim();
  };
  /** @param {string} question @param {string[]} values */
  const choose = async (question, values) => {
    while (true) {
      const value = await answer(question);
      if (values.includes(value)) return value;
      log(`Choose one of: ${values.join(", ")}.`);
    }
  };
  const selectHarness = async () => {
    const choice = await choose("Harness: 1) Copilot  2) Claude Code: ", ["1", "2"]);
    /** @type {import("./configuration.mjs").Harness} */
    const harness = choice === "1" ? "copilot" : "claude-code";
    if (harness === "copilot") {
      log(COPILOT_SETUP);
      log("CLI setup: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli");
      log("Choose model IDs available to your Copilot account. Do not enter GitHub credentials here.");
    } else {
      log("CLI/auth setup: https://code.claude.com/docs/en/setup");
      log("Use model IDs available to your Claude account; Doctor will guide sandbox credentials separately.");
    }
    // Changing harness invalidates the old model choices; never reuse them implicitly.
    draft = {
      version: 1, harness,
      models: draft?.harness === harness ? { ...draft.models } : {},
      agentTiers: { ...draft?.agentTiers },
    };
  };
  const selectModels = async () => {
    if (!draft) throw new ConfigurationError("Select a harness first.");
    const harness = draft.harness;
    /** @type {import("./model-discovery.mjs").ModelChoice[]} */
    let models = [];
    const refresh = async () => {
      log(`Checking ${harness} authentication and model catalog...`);
      const result = await discover(harness, { signal });
      models = result.status === "available" ? result.models : [];
      if (result.status === "available") {
        log(`Authentication: ${result.authentication}\nModels from ${result.source}:`);
        log(models.map((model, index) => `  ${index + 1}) ${model.name} (${model.id})`).join("\n"));
        log("Auto/default choices are omitted. A catalog listing is not a model-execution or Docker check.");
      } else {
        log(`Model discovery unavailable: ${result.message}\n${result.hint}`);
        log("Manual model entry is UNVERIFIED. Complete login in another terminal and enter :retry to refresh, or :cancel to exit.");
      }
    };
    await refresh();
    for (const tier of TIER_NAMES) {
      const previous = draft.models[tier];
      while (true) {
        const value = await answer(`Model for ${tier}${previous ? ` [${previous}; Enter to keep]` : " (required)"} — ${models.length ? "number or model ID" : "manual ID (unverified)"}, :retry to refresh: `);
        if (value === ":retry") {
          await refresh();
          continue;
        }
        const index = models.findIndex((_, index) => String(index + 1) === value);
        if (/^\d+$/.test(value) && index < 0) {
          log("Choose a listed number or enter a model ID, not an out-of-range number.");
          continue;
        }
        const model = index >= 0 ? models[index].id : value || previous;
        if (isModelId(model)) {
          if (models.length && !models.some((choice) => choice.id === model)) {
            const confirm = await answer(`${model} is not in this catalog and is UNVERIFIED. Keep it anyway? [y/N]: `);
            if (!["y", "yes"].includes(confirm.toLowerCase())) continue;
          }
          draft.models[tier] = model;
          break;
        }
        log("Choose an explicit model, not auto/default, a command, credential, or whitespace.");
      }
    }
  };
  const selectAgents = async () => {
    if (!draft) throw new ConfigurationError("Select a harness first.");
    const roles = Object.keys(DEFAULT_AGENT_TIERS);
    log(roles.map((role, index) => `  ${index + 1}) ${role}: ${draft?.agentTiers[role] ?? DEFAULT_AGENT_TIERS[role]}`).join("\n"));
    while (true) {
      const choice = await answer("Agent number, all, or Enter to keep assignments: ");
      if (!choice) return;
      const index = roles.findIndex((_, index) => String(index + 1) === choice);
      if (choice !== "all" && index < 0) {
        log("Choose an agent number, all, or Enter.");
        continue;
      }
      const tier = await choose(`Tier (${TIER_NAMES.join("/")} or shared to restore policy): `, [...TIER_NAMES, "shared"]);
      for (const role of choice === "all" ? roles : [roles[index]]) {
        if (tier === "shared") delete draft.agentTiers[role];
        else draft.agentTiers[role] = tier;
      }
      log("Assignments updated in the draft only.");
    }
  };
  const confirmSave = async () => {
    if (!draft) throw new ConfigurationError("Select a harness first.");
    log(`\nProposed configuration:\n${configurationTable(draft)}`);
    const confirmation = await answer(`Save ${LOCAL_CONFIG}${original !== null ? " (replace existing configuration)" : ""}? [y/N]: `);
    if (!["y", "yes"].includes(confirmation.toLowerCase())) {
      log("Nothing saved.");
      return false;
    }
    saveConfiguration(draft, cwd, original);
    log(`Saved ${LOCAL_CONFIG}. Configuration saved does not mean execution is ready.\nNext: npm run doctor`);
    return true;
  };

  try {
    if (!draft) {
      await selectHarness();
      await selectModels();
      await selectAgents();
      await confirmSave();
      return 0;
    }
    while (true) {
      const choice = await choose(
        "\nConfigure: 1) Harness  2) Models  3) Agent tiers  4) Save and exit  5) Exit without saving: ",
        ["1", "2", "3", "4", "5"],
      );
      if (choice === "1") {
        await selectHarness();
        await selectModels();
      } else if (choice === "2") await selectModels();
      else if (choice === "3") await selectAgents();
      else if (choice === "4" && await confirmSave()) return 0;
      else if (choice === "5") {
        log("Nothing saved.");
        return 0;
      }
    }
  } catch (error) {
    if (error instanceof Cancelled || (error instanceof Error && error.name === "AbortError")) {
      log("Cancelled. Nothing saved.");
      return 130;
    }
    throw error;
  }
}

/**
 * @param {{cwd?: string, args?: string[], input?: NodeJS.ReadableStream & {isTTY?: boolean}, output?: NodeJS.WritableStream & {isTTY?: boolean}, log?: (message: string) => void}} options
 */
export async function runConfigure({
  cwd = ROOT, args = process.argv.slice(2), input = process.stdin, output = process.stdout,
  log = console.log,
} = {}) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    log("Usage: npm run configure [-- --show]\nInteractive authenticated model discovery and configuration, or --show for local read-only output without CLI/auth probes. No default harness or models.");
    return 0;
  }
  if (args.length === 1 && args[0] === "--show") return showConfiguration(cwd, log);
  if (args.length) {
    log("Unknown options. Usage: npm run configure [-- --show]");
    return 1;
  }
  if (!input.isTTY || !output.isTTY) {
    log("Interactive configuration needs a terminal. Use npm run configure -- --show for read-only output.");
    return 1;
  }
  const terminal = createInterface({ input, output });
  const controller = new AbortController();
  terminal.on("SIGINT", () => controller.abort());
  terminal.on("close", () => controller.abort());
  try {
    return await configure({
      cwd, log, signal: controller.signal,
      ask: (question) => terminal.question(question, { signal: controller.signal }),
    });
  } finally {
    terminal.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runConfigure();
  } catch (error) {
    console.error(`Configure failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
