import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isModelId } from "./configuration.mjs";

/**
 * @typedef {{id: string, name: string}} ModelChoice
 * @typedef {{status: "available", models: ModelChoice[], source: string, authentication: string} |
 *   {status: "unavailable", message: string, hint: string}} DiscoveryResult
 * @typedef {(command: string, args: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess} SpawnProbe
 * @typedef {{signal?: AbortSignal, env?: NodeJS.ProcessEnv, timeoutMs?: number, spawnProcess?: SpawnProbe}} DiscoveryOptions
 */

const MAX_OUTPUT = 1024 * 1024;
const GUIDANCE = {
  copilot: "Install/update Copilot CLI, then run copilot login in your terminal. For model discovery, GH_TOKEN and GITHUB_TOKEN are ignored; use the CLI login or a dedicated COPILOT_GITHUB_TOKEN.",
  "claude-code": "Install/update Claude Code, then run claude auth login in your terminal, or configure its API/cloud-provider credentials. Check claude auth status. No separate API key is required for a Claude subscription.",
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** @param {unknown} value */
const displayText = (value) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 160)
  : "";
const cancelled = () => new DOMException("Model discovery cancelled.", "AbortError");

/** Repository tokens must not choose the Copilot billing identity. Never read .env. */
export function discoveryEnvironment(env = process.env) {
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (["GH_TOKEN", "GITHUB_TOKEN", "NODE_OPTIONS", "NODE_DEBUG", "CLAUDECODE"].includes(key.toUpperCase())) {
      delete result[key];
    }
  }
  return result;
}

/**
 * A bounded metadata-only transport, kept dependency-free for fresh checkouts.
 * Copilot uses the SDK's Content-Length JSON-RPC transport; Claude uses its
 * stream-json initialize control request. No session.create or user prompt is sent.
 * Protocol references:
 * github/copilot-sdk: nodejs/src/client.ts (ping, getAuthStatus, listModels)
 * anthropics/claude-agent-sdk-python: _internal/query.py (initialize)
 *
 * @template T
 * @param {string} command
 * @param {string[]} args
 * @param {"rpc" | "lines" | "json"} format
 * @param {DiscoveryOptions & {cwd: string}} options
 * @param {(request: (method?: string) => Promise<unknown>) => Promise<T>} use
 */
async function probe(command, args, format, options, use) {
  const { signal, timeoutMs = 20_000, spawnProcess = spawn, cwd } = options;
  if (signal?.aborted) throw cancelled();
  const child = spawnProcess(command, args, {
    cwd, env: discoveryEnvironment(options.env), stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  // The explicit stdio configuration above supplies all three streams.
  if (!child.stdin || !child.stdout || !child.stderr) {
    child.kill();
    throw new Error("The CLI did not provide a metadata transport.");
  }
  const input = child.stdin;
  let buffer = Buffer.alloc(0);
  let bytes = 0;
  let nextId = 0;
  let exited = false;
  /** @type {Error | undefined} */
  let failure;
  /** @type {{id: number, resolve: (value: unknown) => void, reject: (error: Error) => void} | undefined} */
  let pending;
  const fail = (/** @type {Error} */ error) => {
    failure ??= error;
    pending?.reject(error);
    pending = undefined;
  };
  const accept = (/** @type {unknown} */ value) => {
    if (!object(value)) throw new Error("The CLI returned malformed metadata.");
    if (format === "json") {
      pending?.resolve(value);
      pending = undefined;
    } else if (format === "rpc") {
      if (value.method && Object.hasOwn(value, "id")) {
        throw new Error("The CLI requested an operation during metadata discovery; nothing was authorized.");
      }
      if (value.id !== pending?.id || !pending) return;
      if (value.error) throw new Error("The CLI rejected the metadata request. Its discovery protocol may be unsupported.");
      if (!Object.hasOwn(value, "result")) throw new Error("The CLI returned no metadata result.");
      pending.resolve(value.result);
      pending = undefined;
    } else {
      if (value.type === "control_request") {
        throw new Error("Claude requested an operation during metadata discovery; nothing was authorized.");
      }
      if (value.type !== "control_response") return;
      const response = value.response;
      if (!object(response)) throw new Error("Claude returned malformed control metadata.");
      if (response.request_id !== String(pending?.id) || !pending) return;
      if (response.subtype !== "success") throw new Error("Claude rejected model discovery.");
      pending.resolve(response.response);
      pending = undefined;
    }
  };
  const consume = () => {
    while (buffer.length && format !== "json") {
      let start = 0;
      let length;
      let end;
      if (format === "rpc") {
        end = buffer.indexOf("\r\n\r\n");
        if (end < 0) {
          if (buffer.length > 8192) throw new Error("The CLI returned an invalid metadata header.");
          return;
        }
        const match = /^Content-Length:\s*(\d+)$/im.exec(buffer.subarray(0, end).toString());
        if (!match) throw new Error("The CLI returned an invalid metadata header.");
        length = Number(match[1]);
        if (length > MAX_OUTPUT) throw new Error("The CLI metadata exceeds the size limit.");
        start = end + 4;
        if (buffer.length < start + length) return;
        end = start + length;
      } else {
        end = buffer.indexOf("\n");
        if (end < 0) return;
      }
      const text = buffer.subarray(start, end).toString("utf8");
      buffer = buffer.subarray(end + (format === "lines" ? 1 : 0));
      if (text.trim()) {
        let value;
        try { value = JSON.parse(text); }
        catch { throw new Error("The CLI returned invalid metadata JSON."); }
        accept(value);
      }
    }
  };
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_OUTPUT) return fail(new Error("The CLI metadata exceeds the size limit."));
    buffer = Buffer.concat([buffer, chunk]);
    try { consume(); }
    catch (error) { fail(error instanceof Error ? error : new Error("Invalid CLI metadata.")); }
  });
  // Native diagnostics can contain credential material. Never print or persist them.
  child.stderr.resume();
  child.on("error", (error) => {
    fail(new Error("code" in error && error.code === "ENOENT"
      ? `${command} is not installed or not on PATH.`
      : `${command} could not start for model discovery.`));
  });
  input.on("error", () => fail(new Error("The CLI closed its metadata input.")));
  const closed = new Promise((resolve) => child.on("close", (code) => {
    exited = true;
    if (format === "json" && pending && (code === 0 || code === 1)) {
      try { accept(JSON.parse(buffer.toString("utf8"))); }
      catch { fail(new Error("The CLI returned invalid authentication metadata.")); }
    }
    if (pending) fail(new Error("The CLI exited before returning metadata. Update it or use manual model entry."));
    resolve(undefined);
  }));
  const onAbort = () => fail(cancelled());
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => fail(new Error("Model discovery timed out. Check authentication and network access.")), timeoutMs);
  /** @param {string} [method] @returns {Promise<unknown>} */
  const request = (method) => {
    if (failure) return Promise.reject(failure);
    if (signal?.aborted) return Promise.reject(cancelled());
    if (exited) return Promise.reject(new Error("The CLI exited before the metadata request."));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending = { id, resolve, reject };
      if (format === "json") return;
      const body = JSON.stringify(format === "rpc"
        ? { jsonrpc: "2.0", id, method, params: {} }
        : { type: "control_request", request_id: String(id), request: { subtype: "initialize", hooks: {} } });
      input.write(format === "rpc"
        ? `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
        : `${body}\n`);
    });
  };
  try {
    return await use(request);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    // EOF is the normal shutdown. Bound cleanup too: some CLI versions linger.
    input.end();
    const terminate = setTimeout(() => { if (!exited) child.kill("SIGTERM"); }, 250);
    const kill = setTimeout(() => { if (!exited) child.kill("SIGKILL"); }, 1000);
    await closed;
    clearTimeout(terminate);
    clearTimeout(kill);
  }
}

/** @param {unknown} value @param {"copilot" | "claude-code"} harness @returns {ModelChoice[]} */
function modelChoices(value, harness) {
  if (!Array.isArray(value)) throw new Error("The CLI did not return a model catalog.");
  /** @type {Map<string, ModelChoice>} */
  const models = new Map();
  for (const row of value) {
    if (!object(row)) throw new Error("The CLI returned a malformed model entry.");
    const id = harness === "copilot" ? row.id : row.value;
    if (typeof id === "string" && ["default", "auto"].includes(id.toLowerCase())) continue;
    if (!isModelId(id)) throw new Error("The CLI returned an unsupported model identifier; use manual entry if needed.");
    const name = displayText(harness === "copilot" ? row.name : row.displayName) || id;
    models.set(id, { id, name });
  }
  if (!models.size) throw new Error("The CLI catalog has no explicit selectable models (auto/default entries are omitted).");
  return [...models.values()];
}

/**
 * Uses native credentials without exporting them, creating agent sessions, or
 * sending inference requests. CLI auth/cache maintenance may still occur.
 * @param {import("./configuration.mjs").Harness} harness
 * @param {DiscoveryOptions} [options]
 * @returns {Promise<DiscoveryResult>}
 */
export async function discoverModels(harness, options = {}) {
  if (options.signal?.aborted) throw cancelled();
  const cwd = mkdtempSync(join(tmpdir(), "marky-model-discovery-"));
  try {
    const settings = { ...options, cwd };
    if (harness === "copilot") {
      // --no-auto-update also forces the older bundled runtime, unlike normal CLI startup.
      return await probe("copilot", ["--headless", "--stdio", "--log-level", "error"], "rpc", settings, async (request) => {
        const ping = await request("ping");
        if (!object(ping) || typeof ping.protocolVersion !== "number" || ping.protocolVersion < 3) {
          throw new Error("This Copilot CLI does not support the required metadata protocol.");
        }
        const auth = await request("auth.getStatus");
        if (!object(auth) || typeof auth.isAuthenticated !== "boolean") throw new Error("Copilot returned invalid authentication metadata.");
        if (!auth.isAuthenticated) throw new Error("Copilot is not signed in.");
        const catalog = await request("models.list");
        if (!object(catalog)) throw new Error("Copilot returned invalid model metadata.");
        return {
          status: "available", models: modelChoices(catalog.models, harness),
          source: "Copilot CLI account catalog",
          authentication: options.env?.COPILOT_GITHUB_TOKEN || (!options.env && process.env.COPILOT_GITHUB_TOKEN)
            ? "dedicated COPILOT_GITHUB_TOKEN" : `CLI credentials (${displayText(auth.authType) || "authenticated"})`,
        };
      });
    }
    const auth = await probe("claude", ["--safe-mode", "auth", "status", "--json"], "json", settings, (request) => request());
    if (!object(auth) || typeof auth.loggedIn !== "boolean") throw new Error("Claude returned invalid authentication metadata.");
    if (!auth.loggedIn) throw new Error("Claude Code is not signed in or its provider credentials are not configured.");
    return await probe("claude", [
      "--safe-mode", "--print", "--input-format", "stream-json", "--output-format", "stream-json",
      "--verbose", "--no-session-persistence", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--tools", "",
    ], "lines", settings, async (request) => {
      const metadata = await request();
      if (!object(metadata)) throw new Error("Claude returned invalid initialization metadata.");
      return {
        status: "available", models: modelChoices(metadata.models, harness),
        source: "Claude Code model picker (may contain provider-dependent aliases)",
        authentication: `${displayText(auth.authMethod) || "configured credentials"} / ${displayText(auth.apiProvider) || "configured provider"}`,
      };
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Model discovery failed.",
      hint: GUIDANCE[harness],
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
