// Fresh-machine setup must run on Node alone, before tsx or the local engine
// can be imported. Runtime checks stay in setup.mts once bootstrap is ready.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfiguration } from "./configuration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function runCommand(command, args, options) {
  if (command === "npm" && process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return spawnSync(
    process.platform === "win32" && command === "npm" ? "npm.cmd" : command,
    args,
    { ...options, shell: process.platform === "win32" && command === "npm" },
  );
}

export function bootstrapDoctor({
  cwd = root,
  args = process.argv.slice(2),
  nodeVersion = process.versions.node,
  run = runCommand,
  log = console.log,
} = {}) {
  const help = "Usage: npm run doctor [-- --image-gaps]\nAlias: npm run sandcastle:doctor";
  if (args.includes("--help") || args.includes("-h")) {
    log(`${help}\nRead-only setup guide. No installs, credential writes, or issue changes.`);
    return 0;
  }
  if (args.some((arg) => arg !== "--image-gaps")) {
    log(help);
    return 1;
  }

  log("Marky Mark / Sandcastle setup\n");
  log("Read-only: follow the next step, then rerun npm run doctor.\n");
  const stop = (problem, ...steps) => {
    log(`SETUP NEEDED: ${problem}`);
    for (const step of steps) log(`  ${step}`);
    log("\nThen rerun: npm run doctor");
    return 1;
  };
  const probe = (command, commandArgs, directory = cwd) =>
    run(command, commandArgs, {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: "pipe",
    });
  const commandProblem = (result) =>
    result.error?.message || result.stderr?.trim() || (result.signal
      ? `terminated by ${result.signal}` : `exit status ${result.status}`);

  const [major, minor] = nodeVersion.split(".").map(Number);
  if (!(major === 22 && minor >= 18) && !(major >= 24)) {
    return stop(`Node.js ${nodeVersion} is not supported by this setup.`,
      "Install Node.js 22.18+ (22.x) or 24+ (including npm): https://nodejs.org/en/download",
      "Marky Mark's server checks require native TypeScript support without extra flags.");
  }
  if (probe("git", ["--version"]).status !== 0) {
    return stop("Git is not available.", "Install Git: https://git-scm.com/downloads");
  }
  if (probe("git", ["rev-parse", "--show-toplevel"]).status !== 0) {
    return stop("Marky Mark must be a Git checkout, not a downloaded ZIP.",
      "git clone https://github.com/jorgeper/marky-mark.git",
      "cd marky-mark");
  }

  try {
    loadConfiguration(cwd);
  } catch (error) {
    return stop(error instanceof Error ? error.message : String(error), "npm run configure");
  }
  log("OK: explicit local harness and model configuration (execution checked below)");

  const engine = resolve(cwd, "../sandcastle");
  const engineManifest = join(engine, "package.json");
  if (!existsSync(engineManifest)) {
    return stop(`The local Sandcastle engine is missing at ${engine}.`,
      'git clone https://github.com/jorgeper/sandcastle.git "../sandcastle"',
      "Use this repository, not a registry package. No package registration is needed.");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(engineManifest, "utf8"));
  } catch (error) {
    return stop(`Cannot read ${engineManifest}: ${error.message}`,
      "Repair the checkout's package.json before continuing.");
  }
  if (manifest?.name !== "sandcastle-local" || manifest?.private !== true) {
    return stop("The sibling checkout is not the private sandcastle-local engine.",
      "Update ../sandcastle to the revision containing the local-package migration.",
      "Its package.json must declare name: sandcastle-local and private: true.");
  }
  if (probe("npm", ["--version"]).status !== 0) {
    return stop("npm is not available.", "Install Node.js with npm: https://nodejs.org/en/download");
  }
  const dependencies = ["ls", "--depth=0", "--omit=optional"];
  if (probe("npm", dependencies, engine).status !== 0) {
    return stop("Sandcastle's dependencies are missing or inconsistent.",
      "npm --prefix ../sandcastle ci --no-audit --no-fund",
      "npm --prefix ../sandcastle run build");
  }
  const artifacts = ["index.js", "index.d.ts", "main.js", "chat.js", "sandboxes/docker.js"];
  if (artifacts.some((file) => !existsSync(join(engine, "dist", file)))) {
    return stop("Sandcastle has not been built.", "npm --prefix ../sandcastle run build");
  }
  log("OK: local Sandcastle checkout and build");

  if (probe("npm", dependencies).status !== 0) {
    return stop("Marky Mark's dependencies are missing or inconsistent.",
      "npm ci --no-audit --no-fund");
  }
  const linkedEngine = join(cwd, "node_modules/sandcastle-local");
  if (!existsSync(linkedEngine) || realpathSync(linkedEngine) !== realpathSync(engine)) {
    return stop("Marky Mark is not linked to ../sandcastle.",
      "npm ci --no-audit --no-fund");
  }
  const imports = probe(process.execPath, [
    "--input-type=module", "--eval",
    'await import("sandcastle-local"); await import("sandcastle-local/sandboxes/docker"); await import("sandcastle-local/chat"); await import("tsx");',
  ]);
  if (imports.status !== 0) {
    return stop(`The installed engine cannot load: ${commandProblem(imports)}`,
      "npm --prefix ../sandcastle ci --no-audit --no-fund",
      "npm --prefix ../sandcastle run build",
      "npm ci --no-audit --no-fund");
  }
  log("OK: Marky Mark dependencies and local engine imports\n");

  const result = run(process.execPath, [
    "--import", "tsx", ".sandcastle/doctor.ts", ...args,
  ], { cwd, stdio: "inherit" });
  if (result.error || result.signal || result.status === null) {
    return stop(`Runtime doctor could not finish: ${commandProblem(result)}`,
      "Resolve the error above before starting the loop.");
  }
  if (result.status !== 0) log("\nFollow the guidance above, then rerun: npm run doctor");
  return result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = bootstrapDoctor();
  } catch (error) {
    console.error(`Doctor failed: ${error.message}`);
    process.exitCode = 1;
  }
}
