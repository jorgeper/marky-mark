import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapDoctor, runCommand } from "./doctor.mjs";

describe("local engine bootstrap doctor", () => {
  let directory: string;
  let cwd: string;
  let engine: string;
  const ok: { status: number | null; signal: NodeJS.Signals | null; error?: Error; stdout: string; stderr: string } =
    { status: 0, signal: null, stdout: "", stderr: "" };
  const run = vi.fn((_command: string, _args: string[], _options: { cwd: string; stdio: string }) => ({ ...ok }));
  const log = vi.fn();
  const output = () => log.mock.calls.flat().join("\n");
  const doctor = (args: string[] = []) =>
    bootstrapDoctor({ cwd, args, nodeVersion: "22.18.0", run, log });
  const write = (path: string, content = "") => {
    writeFileSync(path, content);
  };
  const checkout = (name = "sandcastle-local", privatePackage = true) => {
    mkdirSync(engine);
    write(join(engine, "package.json"), JSON.stringify({ name, private: privatePackage }));
  };
  const build = () => {
    mkdirSync(join(engine, "dist/sandboxes"), { recursive: true });
    for (const file of ["index.js", "index.d.ts", "main.js", "chat.js", "sandboxes/docker.js"]) {
      write(join(engine, "dist", file));
    }
  };
  const ready = () => {
    checkout();
    build();
    mkdirSync(join(cwd, "node_modules"));
    symlinkSync(engine, join(cwd, "node_modules/sandcastle-local"), "junction");
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sandcastle-doctor-"));
    cwd = join(directory, "marky-mark");
    engine = join(directory, "sandcastle");
    mkdirSync(cwd);
    run.mockReset().mockImplementation(() => ({ ...ok }));
    log.mockClear();
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("shows help without touching the environment", () => {
    expect(doctor(["--help"])).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(output()).toContain("Read-only");
  });

  it("rejects unsupported options rather than starting the loop", () => {
    expect(doctor(["--install"])).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("explains the Node prerequisite without loading packages", () => {
    for (const nodeVersion of ["20.0.0", "22.17.0", "23.0.0"]) {
      expect(bootstrapDoctor({ cwd, args: [], nodeVersion, run, log })).toBe(1);
    }
    expect(output()).toContain("Install Node.js 22.18+");
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts the supported Node version boundaries", () => {
    ready();
    for (const nodeVersion of ["22.18.0", "24.0.0"]) {
      expect(bootstrapDoctor({ cwd, args: [], nodeVersion, run, log })).toBe(0);
    }
  });

  it("guides Git installation and requires a real checkout", () => {
    run.mockReturnValueOnce({ ...ok, status: 1 });
    expect(doctor()).toBe(1);
    expect(output()).toContain("Install Git");
    run.mockReturnValueOnce(ok).mockReturnValueOnce({ ...ok, status: 1 });
    expect(doctor()).toBe(1);
    expect(output()).toContain("not a downloaded ZIP");
  });

  it("gives the fork clone command before any npm or engine access", () => {
    expect(doctor()).toBe(1);
    expect(output()).toContain('git clone https://github.com/jorgeper/sandcastle.git "../sandcastle"');
    expect(run.mock.calls.every(([command]) => command === "git")).toBe(true);
  });

  it("reports a malformed engine manifest", () => {
    checkout();
    write(join(engine, "package.json"), "{");
    expect(doctor()).toBe(1);
    expect(output()).toContain("Cannot read");
  });

  it("rejects an old engine name or nonprivate package", () => {
    checkout("old-engine");
    expect(doctor()).toBe(1);
    expect(output()).toContain("local-package migration");
    write(join(engine, "package.json"), '{"name":"sandcastle-local","private":false}');
    expect(doctor()).toBe(1);
  });

  it("guides engine installation before asking for a build", () => {
    checkout();
    run.mockImplementation((command, args, options) =>
      command === "npm" && args[0] === "ls" && options.cwd === engine
        ? { ...ok, status: 1 } : ok);
    expect(doctor()).toBe(1);
    expect(output()).toContain("npm --prefix ../sandcastle ci --no-audit --no-fund");
    expect(output()).toContain("npm --prefix ../sandcastle run build");
  });

  it("guides rebuilding an unbuilt engine", () => {
    checkout();
    expect(doctor()).toBe(1);
    expect(output()).toContain("Sandcastle has not been built");
  });

  it("guides project installation after the engine is ready", () => {
    checkout();
    build();
    run.mockImplementation((command, args, options) =>
      command === "npm" && args[0] === "ls" && options.cwd === cwd
        ? { ...ok, status: 1 } : ok);
    expect(doctor()).toBe(1);
    expect(output()).toContain("Marky Mark's dependencies");
    expect(output()).toContain("npm ci --no-audit --no-fund");
  });

  it("rejects an engine copy instead of the local checkout link", () => {
    checkout();
    build();
    mkdirSync(join(cwd, "node_modules/sandcastle-local"), { recursive: true });
    expect(doctor()).toBe(1);
    expect(output()).toContain("not linked to ../sandcastle");
  });

  it("surfaces broken engine imports instead of reporting success", () => {
    ready();
    run.mockImplementation((command, args) =>
      args.includes("--eval") ? { ...ok, status: 1, stderr: "missing build chunk" } : ok);
    expect(doctor()).toBe(1);
    expect(output()).toContain("missing build chunk");
    expect(run.mock.calls.some(([, args]) => args.includes(".sandcastle/doctor.ts"))).toBe(false);
  });

  it("passes image-gap options to the runtime doctor and propagates its failure", () => {
    ready();
    run.mockImplementation((command, args) =>
      args.includes(".sandcastle/doctor.ts") ? { ...ok, status: 1 } : ok);
    expect(doctor(["--image-gaps"])).toBe(1);
    expect(run).toHaveBeenLastCalledWith(process.execPath,
      ["--import", "tsx", ".sandcastle/doctor.ts", "--image-gaps"],
      { cwd, stdio: "inherit" });
    expect(output()).toContain("Follow the guidance above");
  });

  it("only succeeds when the runtime doctor succeeds", () => {
    ready();
    expect(doctor()).toBe(0);
    expect(run).toHaveBeenLastCalledWith(process.execPath,
      ["--import", "tsx", ".sandcastle/doctor.ts"],
      { cwd, stdio: "inherit" });
  });

  it("reports runtime startup failures and signals as failures", () => {
    ready();
    run.mockImplementation((command, args) =>
      args.includes(".sandcastle/doctor.ts") ? { ...ok, status: null, signal: "SIGTERM" } : ok);
    expect(doctor()).toBe(1);
    expect(output()).toContain("terminated by SIGTERM");
    run.mockImplementation((command, args) =>
      args.includes(".sandcastle/doctor.ts") ? { ...ok, status: null, error: new Error("spawn failed") } : ok);
    expect(doctor()).toBe(1);
    expect(output()).toContain("spawn failed");
  });

  it("both npm aliases run without dependencies in a fresh checkout", () => {
    mkdirSync(join(cwd, ".sandcastle"));
    copyFileSync(new URL("./doctor.mjs", import.meta.url), join(cwd, ".sandcastle/doctor.mjs"));
    write(join(cwd, "package.json"), JSON.stringify({
      private: true,
      scripts: {
        doctor: "node .sandcastle/doctor.mjs",
        "sandcastle:doctor": "node .sandcastle/doctor.mjs",
      },
    }));
    execFileSync("git", ["init", "--quiet"], { cwd });
    for (const alias of ["doctor", "sandcastle:doctor"]) {
      const result = runCommand("npm", ["run", alias], { cwd, encoding: "utf8", timeout: 10_000 });
      expect(result.status).toBe(1);
      const [major, minor] = process.versions.node.split(".").map(Number);
      expect(result.stdout).toContain(
        (major === 22 && minor >= 18) || major >= 24
          ? "git clone https://github.com/jorgeper/sandcastle.git"
          : "Install Node.js 22.18+",
      );
      expect(result.stderr).toBe("");
    }
  });
});
