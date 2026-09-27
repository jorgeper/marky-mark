import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure } from "./configure.mjs";
import { isModelId, loadConfiguration, saveConfiguration } from "./configuration.mjs";
import { discoverModels, discoveryEnvironment, type DiscoveryOptions, type DiscoveryResult } from "./model-discovery.mjs";

// A real child process exercises framing, process exit, cancellation, and cleanup,
// but cannot contact a provider or run an agent.
const fixture = `
import {appendFileSync} from "node:fs";
const mode = process.env.PROBE_MODE;
const authCommand = process.argv.includes("auth");
const claude = process.env.PROBE_HARNESS === "claude";
const trace = (value) => appendFileSync(process.env.PROBE_TRACE, JSON.stringify(value) + "\\n");
trace({kind:"start", cwd:process.cwd(), args:process.argv.slice(2)});
process.stderr.write("test-secret-that-must-not-be-shown\\n");
if(mode === "hang") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else if(mode === "exit") {
  process.exit(2);
} else if(mode === "garbage") {
  process.stdout.write(claude ? "not-json\\n" : "Wrong-Header: 7\\r\\n\\r\\ninvalid");
  if(authCommand) process.exit(0);
} else if(mode === "oversize") {
  process.stdout.write(claude ? "x".repeat(1024*1024+1) : "Content-Length: 2000000\\r\\n\\r\\n");
  if(authCommand) process.exit(0);
} else if(authCommand) {
  process.stdout.write(JSON.stringify({loggedIn:mode !== "no-auth", authMethod:"claude.ai", apiProvider:"firstParty", email:"not-for-display"}));
  process.exit(mode === "no-auth" ? 1 : 0);
} else {
  let buffer=Buffer.alloc(0);
  const send = value => {
    const body = JSON.stringify(value);
    const frame = Buffer.from(claude ? body+"\\n" : "Content-Length: "+Buffer.byteLength(body)+"\\r\\n\\r\\n"+body);
    const unicode = frame.indexOf(Buffer.from("é"));
    const split = unicode < 0 ? 7 : unicode + 1;
    process.stdout.write(frame.subarray(0,split));
    setTimeout(()=>process.stdout.write(frame.subarray(split)), 5);
  };
  const handle = message => {
    trace({kind:"request", message});
    if(claude) {
      send({type:"control_response", response:{subtype:"success", request_id:message.request_id, response:{
        models:[{value:"default",displayName:"Automatic"}, {value:"opus[1m]",displayName:"Café Opus"}, {value:"sonnet",displayName:"Sonnet"}]
      }}});
      return;
    }
    if(mode === "server-request") {
      send({jsonrpc:"2.0",id:100,method:"execute",params:{}});
      return;
    }
    if(mode === "rpc-error") {
      send({jsonrpc:"2.0",id:message.id,error:{code:-32601,message:"test-secret-that-must-not-be-shown"}});
      return;
    }
    let result;
    if(message.method === "ping") result = {protocolVersion:mode === "old-protocol" ? 2 : 3};
    if(message.method === "auth.getStatus") result = {isAuthenticated:mode !== "no-auth",authType:"user",login:"not-for-display"};
    if(message.method === "models.list") result = {models:mode === "empty" ? [] : mode === "bad-models" ? [{id:5}] : [
      {id:"auto",name:"Automatic"},{id:"test-small",name:"Café small"},{id:"test-large",name:"Large"},
      {id:"test-large",name:"Large"}
    ]};
    send({jsonrpc:"2.0",id:message.id,result});
  };
  process.stdin.on("data",chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    while(true) {
      if(claude) {
        const end=buffer.indexOf("\\n");
        if(end<0)break;
        const line=buffer.subarray(0,end).toString();buffer=buffer.subarray(end+1);
        handle(JSON.parse(line));
      } else {
        const end=buffer.indexOf("\\r\\n\\r\\n");
        if(end<0)break;
        const n=Number(/Content-Length: (\\d+)/i.exec(buffer.subarray(0,end).toString())[1]);
        if(buffer.length<end+4+n)break;
        const message=JSON.parse(buffer.subarray(end+4,end+4+n).toString());
        buffer=buffer.subarray(end+4+n);handle(message);
      }
    }
  });
}
`;

describe("authenticated, metadata-only model discovery", () => {
  let cwd: string;
  let tracePath: string;
  let children: ChildProcess[];
  let launches: Array<{ command: string; env: NodeJS.ProcessEnv | undefined }>;
  let options: DiscoveryOptions;
  const trace = () => existsSync(tracePath)
    ? readFileSync(tracePath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    : [];

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "discovery-test-"));
    tracePath = join(cwd, "trace.jsonl");
    const executable = join(cwd, "fake-cli.mjs");
    writeFileSync(executable, fixture);
    children = [];
    launches = [];
    options = {
      timeoutMs: 3000,
      env: { PROBE_TRACE: tracePath, GH_TOKEN: "repo-secret", GITHUB_TOKEN: "other-repo-secret" },
      spawnProcess: (command, args, childOptions) => {
        launches.push({ command, env: childOptions.env });
        const child = spawn(process.execPath, [executable, ...args], {
          ...childOptions, env: { ...childOptions.env, PROBE_HARNESS: command },
        });
        children.push(child);
        return child;
      },
    };
  });
  afterEach(() => {
    for (const child of children) {
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    }
    for (const event of trace().filter((row) => row.kind === "start")) {
      expect(existsSync(event.cwd)).toBe(false);
    }
    rmSync(cwd, { recursive: true, force: true });
  });

  it("U1457: Copilot authenticates before listing models, with no session or prompt", async () => {
    const result = await discoverModels("copilot", options);
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.message);
    expect(result.models).toEqual([{ id: "test-small", name: "Café small" }, { id: "test-large", name: "Large" }]);
    expect(trace().filter((row) => row.kind === "request").map((row) => row.message.method))
      .toEqual(["ping", "auth.getStatus", "models.list"]);
    expect(launches[0].env?.GH_TOKEN).toBeUndefined();
    expect(launches[0].env?.GITHUB_TOKEN).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("not-for-display");
  });

  it("U1458: Claude uses its authenticated picker and preserves context aliases", async () => {
    const result = await discoverModels("claude-code", options);
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.message);
    expect(result.models.map((model) => model.id)).toEqual(["opus[1m]", "sonnet"]);
    expect(result.authentication).toBe("claude.ai / firstParty");
    const starts = trace().filter((row) => row.kind === "start");
    expect(starts[0].args).toEqual(["--safe-mode", "auth", "status", "--json"]);
    expect(starts[1].args).toContain("--safe-mode");
    expect(starts[1].args).toContain("--no-session-persistence");
    expect(starts[1].args).toContain("--strict-mcp-config");
    expect(starts[1].args.slice(-2)).toEqual(["--tools", ""]);
    expect(trace().filter((row) => row.kind === "request").map((row) => row.message))
      .toEqual([{ type: "control_request", request_id: "1", request: { subtype: "initialize", hooks: {} } }]);
  });

  it("U1459: missing authentication stops before querying a catalog", async () => {
    options.env = { ...options.env, PROBE_MODE: "no-auth" };
    for (const harness of ["copilot", "claude-code"] as const) {
      const result = await discoverModels(harness, options);
      expect(result.status).toBe("unavailable");
      if (result.status !== "unavailable") throw new Error("Expected login guidance");
      expect(result.message).toContain("not signed in");
      expect(result.hint).toContain(harness === "copilot" ? "copilot login" : "claude auth login");
    }
    const requests = trace().filter((row) => row.kind === "request");
    expect(requests.map((row) => row.message.method)).toEqual(["ping", "auth.getStatus"]);
  });

  it("U1460: repository credentials are stripped without changing the parent environment", () => {
    const env = { GH_TOKEN: "repo", GITHUB_TOKEN: "repo2", gh_token: "case-insensitive", COPILOT_GITHUB_TOKEN: "dedicated", ANTHROPIC_API_KEY: "claude", NODE_OPTIONS: "--preload unsafe", CLAUDECODE: "nested", PATH: "path" };
    expect(discoveryEnvironment(env)).toEqual({ COPILOT_GITHUB_TOKEN: "dedicated", ANTHROPIC_API_KEY: "claude", PATH: "path" });
    expect(env.GH_TOKEN).toBe("repo");
  });

  it("U1461: a dedicated Copilot credential is retained but never displayed", async () => {
    options.env = { ...options.env, COPILOT_GITHUB_TOKEN: "dedicated-secret" };
    const result = await discoverModels("copilot", options);
    expect(launches[0].env?.COPILOT_GITHUB_TOKEN).toBe("dedicated-secret");
    expect(JSON.stringify(result)).toContain("dedicated COPILOT_GITHUB_TOKEN");
    expect(JSON.stringify(result)).not.toContain("dedicated-secret");
  });

  it("U1462: unsupported, malformed, empty, or rejected catalogs fail visibly without leaking stderr", async () => {
    for (const mode of ["old-protocol", "rpc-error", "server-request", "bad-models", "empty", "garbage", "oversize", "exit"]) {
      options.env = { ...options.env, PROBE_MODE: mode };
      const result = await discoverModels("copilot", options);
      expect(result.status, mode).toBe("unavailable");
      expect(JSON.stringify(result)).not.toContain("test-secret-that-must-not-be-shown");
    }
  });

  it("U1463: malformed Claude authentication output never starts initialization", async () => {
    options.env = { ...options.env, PROBE_MODE: "garbage" };
    const result = await discoverModels("claude-code", options);
    expect(result.status).toBe("unavailable");
    expect(children).toHaveLength(1);
  });

  it("U1464: a missing executable produces installation guidance", async () => {
    options.spawnProcess = (_command, _args, childOptions) => {
      const child = spawn(join(cwd, "does-not-exist"), [], childOptions);
      children.push(child);
      return child;
    };
    const result = await discoverModels("copilot", options);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") throw new Error("Expected missing CLI");
    expect(result.message).toContain("not installed or not on PATH");
    expect(result.hint).toContain("Install/update Copilot");
  });

  it("U1465: timeout terminates even a CLI that ignores SIGTERM", async () => {
    options.env = { ...options.env, PROBE_MODE: "hang" };
    options.timeoutMs = 150;
    const result = await discoverModels("copilot", options);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") throw new Error("Expected timeout");
    expect(result.message).toContain("timed out");
    expect(children[0].signalCode).toBe("SIGKILL");
  });

  it("U1466: cancellation aborts metadata discovery and cleans up its child", async () => {
    options.env = { ...options.env, PROBE_MODE: "hang" };
    const controller = new AbortController();
    options.signal = controller.signal;
    const pending = discoverModels("copilot", options);
    const timer = setTimeout(() => controller.abort(), 100);
    try { await expect(pending).rejects.toMatchObject({ name: "AbortError" }); }
    finally { clearTimeout(timer); }
  });

  it("U1467: a pre-cancelled operation does not start a CLI", async () => {
    await expect(discoverModels("copilot", { ...options, signal: AbortSignal.abort() }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(children).toHaveLength(0);
  });

  it("U1468: explicit aliases support the Claude context suffix but not auto/default or arguments", () => {
    for (const model of ["opus[1m]", "sonnet", "claude-opus-5[1m]", "gpt-5.4"]) expect(isModelId(model)).toBe(true);
    for (const model of ["auto", "default", "AUTO", "Default", "opus --tools all", "opus[bad]", "opus;exit", "x".repeat(257)]) expect(isModelId(model)).toBe(false);
  });
});

describe("Configure model discovery and picker", () => {
  let cwd: string;
  const log = vi.fn<(message: string) => void>();
  const catalog: DiscoveryResult = {
    status: "available", source: "test CLI", authentication: "test login",
    models: [{ id: "test-small", name: "Small" }, { id: "test-large", name: "Large" }],
  };
  const discover = vi.fn<typeof discoverModels>();
  const output = () => log.mock.calls.map(([line]) => line).join("\n");
  const wizard = (answers: Array<string | null>) => configure({
    cwd, log, discover, ask: async (question) => {
      log(question);
      if (!answers.length) throw new Error(`Unexpected prompt: ${question}`);
      return answers.shift() ?? null;
    },
  });
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "model-picker-test-"));
    mkdirSync(join(cwd, ".sandcastle"));
    log.mockClear();
    discover.mockReset().mockResolvedValue(catalog);
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("U1469: numbered choices use the authenticated catalog once for both tiers", async () => {
    expect(await wizard(["1", "99", "1", "2", "", "y"])).toBe(0);
    expect(loadConfiguration(cwd).models).toEqual({ normal: "test-small", hard: "test-large" });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith("copilot", { signal: undefined });
    expect(output()).toContain("Small (test-small)");
    expect(output()).not.toContain("Copilot is configured");
  });

  it("U1470: no model is selected by blank input; a known ID is accepted explicitly", async () => {
    expect(await wizard(["2", "", "test-large", "1", "", "y"])).toBe(0);
    expect(loadConfiguration(cwd).models).toEqual({ normal: "test-large", hard: "test-small" });
    expect(output()).toContain("Choose an explicit model");
  });

  it("U1471: an out-of-catalog ID requires explicit unverified confirmation", async () => {
    expect(await wizard(["1", "custom", "n", "1", "another-custom", "y", "", "y"])).toBe(0);
    expect(loadConfiguration(cwd).models).toEqual({ normal: "test-small", hard: "another-custom" });
    expect(output()).toContain("not in this catalog and is UNVERIFIED");
  });

  it("U1472: failed discovery guides login and can be retried after native authentication", async () => {
    discover.mockResolvedValueOnce({ status: "unavailable", message: "Not signed in", hint: "Run copilot login" });
    expect(await wizard(["1", ":retry", "2", "1", "", "y"])).toBe(0);
    expect(discover).toHaveBeenCalledTimes(2);
    expect(output()).toContain("Run copilot login");
    expect(loadConfiguration(cwd).models.normal).toBe("test-large");
  });

  it("U1473: failed discovery permits visibly unverified manual choices", async () => {
    discover.mockResolvedValue({ status: "unavailable", message: "Offline", hint: "Check network" });
    expect(await wizard(["2", "explicit-one", "explicit-two", "", "y"])).toBe(0);
    expect(output()).toContain("Manual model entry is UNVERIFIED");
    expect(loadConfiguration(cwd).models).toEqual({ normal: "explicit-one", hard: "explicit-two" });
  });

  it("U1474: cancelling during discovery saves nothing", async () => {
    discover.mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    expect(await wizard(["1"])).toBe(130);
    expect(existsSync(join(cwd, ".sandcastle/local.json"))).toBe(false);
  });

  it("U1475: agent-only edits and early cancellation never discover models", async () => {
    expect(await wizard([":cancel"])).toBe(130);
    saveConfiguration({
      version: 1, harness: "copilot",
      models: { normal: "test-small", hard: "test-large" }, agentTiers: {},
    }, cwd, null);
    expect(await wizard(["3", "all", "normal", "", "4", "y"])).toBe(0);
    expect(discover).not.toHaveBeenCalled();
    expect(loadConfiguration(cwd).agentTiers.implementer).toBe("normal");
  });

  it("U1476: changing harness discovers that provider and requires new explicit choices", async () => {
    saveConfiguration({
      version: 1, harness: "copilot",
      models: { normal: "old-small", hard: "old-large" }, agentTiers: {},
    }, cwd, null);
    expect(await wizard(["1", "2", "", "1", "2", "4", "y"])).toBe(0);
    expect(discover).toHaveBeenCalledExactlyOnceWith("claude-code", { signal: undefined });
    expect(loadConfiguration(cwd).models).toEqual({ normal: "test-small", hard: "test-large" });
    expect(output()).not.toContain("[old-small; Enter to keep]");
  });
});
