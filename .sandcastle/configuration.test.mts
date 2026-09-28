import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COPILOT_SETUP, DEFAULT_AGENT_TIERS, LOCAL_CONFIG, configurationTable,
  effectiveConfiguration, loadConfiguration, parseConfiguration,
  requireRunnableConfiguration, saveConfiguration, showConfiguration,
  validateConfiguration,
  type LocalConfiguration,
} from "./configuration.mjs";
import { configure, runConfigure } from "./configure.mjs";

const source = dirname(fileURLToPath(import.meta.url));
const chosen = (harness: LocalConfiguration["harness"] = "claude-code"): LocalConfiguration => ({
  version: 1, harness, models: { normal: "chosen-normal", hard: "chosen-hard" }, agentTiers: {},
});

describe("explicit local Sandcastle configuration", () => {
  let cwd: string;
  let path: string;
  const log = vi.fn<(message: string) => void>();
  const output = () => log.mock.calls.map(([line]) => line).join("\n");
  const write = (value: unknown) => writeFileSync(path, JSON.stringify(value));
  const wizard = (answers: Array<string | null>) => configure({
    discover: async () => ({ status: "unavailable", message: "Test: no catalog", hint: "Enter models manually." }),
    cwd, log, ask: async (question) => {
      log(question);
      if (!answers.length) throw new Error("Unexpected extra wizard prompt");
      return answers.shift() ?? null;
    },
  });

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "sandcastle-config-"));
    mkdirSync(join(cwd, ".sandcastle"));
    path = join(cwd, LOCAL_CONFIG);
    log.mockClear();
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("U1435: a fresh checkout has no harness or models and cannot execute", () => {
    expect(() => loadConfiguration(cwd)).toThrow(/Not configured/);
    expect(() => requireRunnableConfiguration(cwd)).toThrow(/npm run configure/);
    expect(showConfiguration(cwd, log)).toBe(1);
    expect(output()).toContain("npm run configure");
    expect(existsSync(path)).toBe(false);
  });

  it("U1436: rejects missing, unknown, and malformed execution choices", () => {
    const invalid = [
      null, [], {}, { ...chosen(), version: 2 }, { ...chosen(), harness: "" },
      { ...chosen(), harness: "auto" }, { ...chosen(), harness: undefined },
      { ...chosen(), models: {} }, { ...chosen(), models: { normal: "one" } },
      { ...chosen(), models: { normal: "", hard: "two" } },
      { ...chosen(), models: { normal: "one", hard: "model --flag" } },
      { ...chosen(), models: { normal: " one", hard: "two" } },
      { ...chosen(), models: { normal: "one", hard: "two", extra: "three" } },
      { ...chosen(), agentTiers: null }, { ...chosen(), agentTiers: [] },
      { ...chosen(), agentTiers: { unknown: "hard" } },
      { ...chosen(), agentTiers: { implementer: "heroic" } },
      { ...chosen(), GH_TOKEN: "not-a-real-token" },
    ];
    for (const value of invalid) expect(() => validateConfiguration(value)).toThrow();
    expect(() => parseConfiguration("{")).toThrow(/not valid JSON/);
  });

  it("U1437: resolves all roles through explicit models and local overrides", () => {
    const config = validateConfiguration({ ...chosen(), agentTiers: { planner: "normal" } });
    const effective = effectiveConfiguration(config);
    expect(Object.keys(effective.agentTiers)).toEqual(Object.keys(DEFAULT_AGENT_TIERS));
    expect(effective.agentTiers.planner).toBe("normal");
    expect(effective.agentTiers.implementer).toBe("hard");
    expect(effective.tiers).toEqual([
      { name: "normal", model: "chosen-normal" }, { name: "hard", model: "chosen-hard" },
    ]);
    const table = configurationTable(config);
    expect(table).toContain("local override");
    expect(table).toContain("shared policy");
    expect(table).toContain("claude-code");
  });

  it("U1438: Copilot can be displayed but never falls back to Claude execution", () => {
    write(chosen("copilot"));
    const before = readFileSync(path, "utf8");
    expect(showConfiguration(cwd, log)).toBe(0);
    expect(output()).toContain(COPILOT_SETUP);
    expect(requireRunnableConfiguration(cwd).harness).toBe("copilot");
    expect(readFileSync(path, "utf8")).toBe(before);
    write(chosen());
    expect(requireRunnableConfiguration(cwd)).toEqual(chosen());
  });

  it("U1439: explicit save is atomic and refuses concurrent edits", () => {
    saveConfiguration(chosen(), cwd, null);
    expect(loadConfiguration(cwd)).toEqual(chosen());
    expect(readdirSync(join(cwd, ".sandcastle"))).toEqual(["local.json"]);
    expect(() => saveConfiguration(chosen("copilot"), cwd, null)).toThrow(/changed while/);
    expect(loadConfiguration(cwd).harness).toBe("claude-code");
  });

  it("U1440: a fresh wizard requires harness and both models before confirmed save", async () => {
    expect(await wizard(["", "1", "", "chosen-normal", "bad model", "chosen-hard", "", "yes"])).toBe(0);
    expect(loadConfiguration(cwd)).toEqual(chosen("copilot"));
    expect(output()).toContain("Choose one of: 1, 2");
    expect(output()).toContain("Proposed configuration:");
    expect(output()).toContain("Configuration saved does not mean execution is ready");
  });

  it("U1441: declining the fresh save leaves the checkout unconfigured", async () => {
    expect(await wizard(["2", "one", "two", "", ""])).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(output()).toContain("Nothing saved");
  });

  it("U1442: cancellation and EOF never persist a partial wizard", async () => {
    for (const answers of [[":cancel"], ["1", "one", null]]) {
      expect(await wizard(answers)).toBe(130);
      expect(existsSync(path)).toBe(false);
    }
  });

  it("U1443: existing configuration can be exited without edits", async () => {
    write(chosen());
    const before = readFileSync(path, "utf8");
    expect(await wizard(["5"])).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("U1444: changing harness clears old models and requires explicit replacements", async () => {
    write(chosen());
    expect(await wizard(["1", "1", "", "copilot-normal", "", "copilot-hard", "4", "y"])).toBe(0);
    expect(loadConfiguration(cwd).models).toEqual({ normal: "copilot-normal", hard: "copilot-hard" });
    expect(loadConfiguration(cwd).harness).toBe("copilot");
    expect(output()).not.toContain("[chosen-normal; Enter to keep]");
  });

  it("U1445: editing models can keep explicit choices on the same harness", async () => {
    write(chosen());
    expect(await wizard(["2", "", "replacement-hard", "4", "y"])).toBe(0);
    expect(loadConfiguration(cwd).models).toEqual({ normal: "chosen-normal", hard: "replacement-hard" });
  });

  it("U1446: individual and all-agent assignments can be changed or restored", async () => {
    write(chosen());
    expect(await wizard(["3", "99", "all", "normal", "3", "shared", "", "4", "y"])).toBe(0);
    const config = loadConfiguration(cwd);
    expect(config.agentTiers.planner).toBe("normal");
    expect(config.agentTiers.implementer).toBeUndefined();
    expect(effectiveConfiguration(config).agentTiers.implementer).toBe("hard");
    expect(Object.keys(config.agentTiers)).toHaveLength(10);
  });

  it("U1447: an invalid local file is preserved on cancel and repair requires confirmation", async () => {
    writeFileSync(path, "{broken");
    expect(await wizard([":cancel"])).toBe(130);
    expect(readFileSync(path, "utf8")).toBe("{broken");
    expect(await wizard(["2", "one", "two", "", "y"])).toBe(0);
    expect(loadConfiguration(cwd).models.hard).toBe("two");
    expect(output()).toContain("replace existing configuration");
  });

  it("U1448: aborted readline questions leave existing configuration unchanged", async () => {
    write(chosen());
    const before = readFileSync(path, "utf8");
    expect(await configure({
      cwd, log, ask: async () => { throw new DOMException("Stopped", "AbortError"); },
    })).toBe(130);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("U1449: help and show never prompt, while unknown arguments fail", async () => {
    expect(await runConfigure({ cwd, args: ["--help"], log })).toBe(0);
    expect(await runConfigure({ cwd, args: ["--show"], log })).toBe(1);
    expect(await runConfigure({ cwd, args: ["--auto"], log })).toBe(1);
    expect(existsSync(path)).toBe(false);
    write(chosen("copilot"));
    expect(await runConfigure({ cwd, args: ["--show"], log })).toBe(0);
  });

  const copyScripts = () => {
    for (const file of readdirSync(source)) {
      if (/\.(mjs|mts|ts)$/.test(file) && !file.includes(".test.")) {
        copyFileSync(join(source, file), join(cwd, ".sandcastle", file));
      }
    }
  };
  const start = (entry: string, args: string[] = [], env = process.env) =>
    spawnSync(process.execPath, [entry, ...args], { cwd, env, encoding: "utf8", timeout: 30_000 });

  it("U1450: configure and show run on Node alone with no dependencies", () => {
    copyScripts();
    let result = start(".sandcastle/configure.mjs", ["--show"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Not configured");
    expect(result.stderr).toBe("");
    result = start(".sandcastle/configure.mjs");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("needs a terminal");
    expect(existsSync(path)).toBe(false);
    write(chosen());
    result = start(".sandcastle/configure.mjs", ["--show"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("chosen-hard");
    expect(existsSync(join(cwd, "node_modules"))).toBe(false);
  });

  const isolateExecution = () => {
    copyScripts();
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ type: "module" }));
    symlinkSync(resolve(source, "../node_modules"), join(cwd, "node_modules"), "junction");
    const bin = join(cwd, "bin");
    mkdirSync(bin);
    for (const command of ["git", "gh", "docker", "claude", "copilot"]) {
      writeFileSync(join(bin, command), '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$COMMAND_LOG"\nexit 99\n', { mode: 0o755 });
    }
    writeFileSync(join(bin, "npm"), '#!/bin/sh\nprintf "https://registry.npmjs.org/\\n"\n', { mode: 0o755 });
    return { PATH: bin, COMMAND_LOG: join(cwd, "commands.log") };
  };

  it("U1477: help and show never launch a CLI or authentication probe", () => {
    const env = isolateExecution();
    for (const args of [["--help"], ["--show"]]) {
      const result = start(".sandcastle/configure.mjs", args, env);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(args[0] === "--show" ? 1 : 0);
    }
    write(chosen("copilot"));
    expect(start(".sandcastle/configure.mjs", ["--show"], env).status).toBe(0);
    expect(existsSync(env.COMMAND_LOG)).toBe(false);
  });

  it("U1451: every execution entrypoint stops before commands when configuration or Copilot credentials are missing", () => {
    const env = isolateExecution();
    for (const config of [null, chosen("copilot"), { ...chosen(), models: {} }]) {
      if (config === null) rmSync(path, { force: true });
      else write(config);
      for (const entry of ["main.ts", "design.ts", "decompose.ts", "issue.ts"]) {
        const result = start("--import", ["tsx", `.sandcastle/${entry}`], env);
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain("SETUP NEEDED:");
        expect(result.stderr).toContain(config === null ? "Not configured" : config.harness === "copilot" ? "COPILOT_GITHUB_TOKEN" : "explicit model ID");
        expect(existsSync(env.COMMAND_LOG)).toBe(false);
      }
    }
  }, 30_000);

  it("U1452: Copilot Doctor checks its own credentials and image without probing Anthropic", () => {
    const env = isolateExecution();
    writeFileSync(join(cwd, "bin/npm"), '#!/bin/sh\nprintf "https://registry.example.com/npm/\\n"\n', { mode: 0o755 });
    write(chosen("copilot"));
    const before = readFileSync(path, "utf8");
    writeFileSync(join(cwd, ".sandcastle/.env"), "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-test-only\n");
    writeFileSync(join(cwd, "bin/docker"), '#!/bin/sh\nif [ "$1" = "images" ]; then printf "fake-image\\n"; fi\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(cwd, "no-network.mjs"),
      'import { appendFileSync } from "node:fs"; globalThis.fetch = async () => { appendFileSync("network.log", "unexpected"); throw new Error("Network forbidden in test"); };');
    const result = start("--import", ["tsx", "--import", "./no-network.mjs", ".sandcastle/doctor.ts", "--image-gaps"], env);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain(COPILOT_SETUP);
    expect(result.stdout).not.toContain("claude setup-token");
    expect(result.stdout).toContain("docker build-image");
    expect(result.stdout).toContain("COPILOT_GITHUB_TOKEN");
    expect(result.stdout).toContain("https://github.com/settings/personal-access-tokens/new");
    expect(result.stdout).toContain("Resource owner: your personal account");
    expect(result.stdout).toContain("Repository access: Public repositories");
    expect(result.stdout).toContain("Permissions > Account > Add permissions > Copilot Requests");
    expect(result.stdout).toContain("COPILOT_GITHUB_TOKEN=<token> in .sandcastle/.env");
    expect(result.stdout).toContain("Resource owner: jorgeper");
    expect(result.stdout).toContain("Only select repositories > marky-mark");
    expect(result.stdout).toContain("Contents, Issues, and Pull requests: Read and write; Metadata: Read");
    expect(result.stdout).toContain("GH_TOKEN=<token> in .sandcastle/.env");
    expect(result.stdout).toContain("Details: .sandcastle/PR_SETUP.md");
    expect(result.stdout).toContain("lacks the Copilot runtime capability marker");
    expect(result.stdout).toContain("docker build-image --npm-registry 'https://registry.example.com/npm/'");
    expect(result.stdout).toContain("No network probe performed");
    expect(existsSync(join(cwd, "network.log"))).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("U1453: local choices and temporary files are ignored by the committed policy", () => {
    copyFileSync(join(source, ".gitignore"), join(cwd, ".sandcastle/.gitignore"));
    const init = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
    expect(init.status).toBe(0);
    for (const file of [LOCAL_CONFIG, `${LOCAL_CONFIG}.test.tmp`]) {
      const result = spawnSync("git", ["check-ignore", file], { cwd, encoding: "utf8" });
      expect(result.status).toBe(0);
    }
  });

  it("U1493: configured Copilot starts with the dedicated file token, never a repository-token fallback", () => {
    const env = isolateExecution();
    write(chosen("copilot"));
    const credentials = join(cwd, ".sandcastle/.env");
    writeFileSync(join(cwd, "runtime.mts"), `
      import { assertExecutionReady, harnessFor, modelFor } from "./.sandcastle/effort.mts";
      import { agentForModel } from "./.sandcastle/agents.mts";
      assertExecutionReady();
      const agent = agentForModel(modelFor("implementer"));
      console.log(JSON.stringify({ harness: harnessFor(), provider: agent.name, model: agent.model, verifier: agent.goalVerifier?.model }));
    `);
    for (const content of ["GH_TOKEN=github_pat_repo\n", "COPILOT_GITHUB_TOKEN=\n"]) {
      writeFileSync(credentials, content);
      const blocked = start("--import", ["tsx", "./runtime.mts"], { ...env, COPILOT_GITHUB_TOKEN: "github_pat_parent" });
      expect(blocked.error, blocked.stderr + blocked.stdout).toBeUndefined();
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain("COPILOT_GITHUB_TOKEN");
    }
    writeFileSync(credentials, "COPILOT_GITHUB_TOKEN=github_pat_inference\nGH_TOKEN=github_pat_repo\n");
    const ready = start("--import", ["tsx", "./runtime.mts"], env);
    expect(ready.status, ready.stderr).toBe(0);
    expect(JSON.parse(ready.stdout)).toEqual({
      harness: "copilot", provider: "copilot", model: "chosen-hard", verifier: "chosen-hard",
    });
    expect(existsSync(env.COMMAND_LOG)).toBe(false);
  });

  it("U1494: Doctor checks the dedicated token and image metadata without running a container or exposing credentials", () => {
    const env = isolateExecution();
    write(chosen("copilot"));
    writeFileSync(join(cwd, ".sandcastle/.env"), "COPILOT_GITHUB_TOKEN=github_pat_inference\nGH_TOKEN=github_pat_repo\n");
    writeFileSync(join(cwd, "bin/gh"), `#!/bin/sh
if [ "$1" = "api" ] && [ "$2" = "user" ] && [ "$GH_TOKEN" = "github_pat_inference" ]; then
  printf "dedicated-token-probe\\n" >> "$COMMAND_LOG"
  exit 0
fi
exit 99
`, { mode: 0o755 });
    writeFileSync(join(cwd, "bin/docker"), `#!/bin/sh
printf "%s\\n" "$*" >> "$COMMAND_LOG"
if [ "$1" = "images" ]; then printf "image-id\\n"; fi
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then printf "1\\n"; fi
exit 0
`, { mode: 0o755 });
    const result = start("--import", ["tsx", ".sandcastle/doctor.ts"], env);
    expect(result.stdout).toContain("COPILOT_GITHUB_TOKEN authenticates to GitHub");
    expect(result.stdout).toContain("image metadata only; no container or agent launched");
    expect(result.stdout).toContain("npm registry for image builds");
    expect(result.stdout).not.toContain(" --npm-registry ");
    expect(result.stdout + result.stderr).not.toContain("github_pat_inference");
    expect(result.stdout + result.stderr).not.toContain("github_pat_repo");
    expect(result.stdout).toContain("GH_TOKEN could not authenticate to GitHub");
    expect(result.stdout).toContain("GH_TOKEN=<token> in .sandcastle/.env");
    const commands = readFileSync(env.COMMAND_LOG, "utf8");
    expect(commands).toContain("dedicated-token-probe");
    expect(commands).not.toMatch(/\brun\b|\bexec\b/);
    writeFileSync(join(cwd, "bin/gh"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    const rejected = start("--import", ["tsx", ".sandcastle/doctor.ts"], env);
    expect(rejected.status, rejected.stderr).toBe(1);
    expect(rejected.stdout).toContain("COPILOT_GITHUB_TOKEN could not authenticate to GitHub");
    expect(rejected.stdout).toContain("Permissions > Account > Add permissions > Copilot Requests");
    expect(rejected.stdout).toContain("COPILOT_GITHUB_TOKEN=<token> in .sandcastle/.env");
    expect(rejected.stdout).toContain("Details: .sandcastle/PR_SETUP.md");
    expect(rejected.stdout + rejected.stderr).not.toContain("github_pat_inference");
    expect(rejected.stdout + rejected.stderr).not.toContain("github_pat_repo");
    writeFileSync(join(cwd, "bin/npm"), '#!/bin/sh\nprintf "https://user:private-registry-token@registry.example.com/\\n"\n', { mode: 0o755 });
    const unsafeRegistry = start("--import", ["tsx", ".sandcastle/doctor.ts"], env);
    expect(unsafeRegistry.status).toBe(1);
    expect(unsafeRegistry.stdout).toContain("host npm registry is not a credential-free HTTPS URL (value hidden)");
    expect(unsafeRegistry.stdout + unsafeRegistry.stderr).not.toContain("private-registry-token");
  });

  it("U1454: the running process keeps one explicit snapshot even when the file changes", () => {
    const env = isolateExecution();
    write(chosen());
    writeFileSync(join(cwd, "snapshot.mjs"), `
      import { modelFor } from "./.sandcastle/effort.mts";
      import { writeFileSync } from "node:fs";
      const first = modelFor("implementer");
      writeFileSync(".sandcastle/local.json", JSON.stringify(${JSON.stringify(chosen("copilot"))}));
      console.log(JSON.stringify([first, modelFor("implementer")]));
    `);
    const result = start("--import", ["tsx", "snapshot.mjs"], env);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["chosen-hard", "chosen-hard"]);
    expect(loadConfiguration(cwd).harness).toBe("copilot");
  });

  it("U1456: real readline EOF and Ctrl-C cancel without saving", async () => {
    for (const action of ["eof", "interrupt"]) {
      const input = Object.assign(new PassThrough(), { isTTY: true });
      const output = Object.assign(new PassThrough(), { isTTY: true });
      const pending = runConfigure({ cwd, args: [], input, output, log });
      if (action === "eof") input.end();
      else input.write("\u0003");
      try {
        expect(await pending).toBe(130);
        expect(existsSync(path)).toBe(false);
      } finally {
        input.destroy();
        output.destroy();
      }
    }
  });
});
