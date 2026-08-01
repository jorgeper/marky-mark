// Phase timing for the loop: every agent run is wrapped in `timed()`, which
// prints timestamped start/finish lines to the console and appends one JSON
// line per phase to `.sandcastle/logs/timings.jsonl` — a machine-readable
// trace of where a run's wall-clock time went. Best-effort: a failed write
// never breaks the loop.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const TIMINGS_PATH = ".sandcastle/logs/timings.jsonl";

const stamp = (): string => new Date().toISOString().slice(11, 19);

/** Console line with a wall-clock (UTC) timestamp, matching the agent logs. */
export const logStep = (message: string): void => {
  console.log(`[${stamp()}] ${message}`);
};

export interface TimingEntry {
  readonly ts: string;
  readonly phase: string;
  readonly ms: number;
  readonly ok: boolean;
  readonly [key: string]: unknown;
}

export const appendTiming = (
  entry: TimingEntry,
  path: string = TIMINGS_PATH,
): void => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
  } catch {
    // Best-effort telemetry — never break the loop over a log write.
  }
};

// Heartbeat: while any phase is active, print a "still running" line every
// two minutes. Long parallel phases (a 20-minute implementer) otherwise
// leave the console silent, which reads as a hang — and has been "fixed"
// by killing live agents. The interval is unref'd so it never keeps the
// process alive on its own.
const HEARTBEAT_MS = 120_000;
const activePhases = new Map<string, { readonly label: string; readonly start: number }>();
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

const printHeartbeat = (): void => {
  if (activePhases.size === 0) return;
  const parts = [...activePhases.values()].map(
    ({ label, start }) => `${label} ${((Date.now() - start) / 60000).toFixed(1)}m`,
  );
  logStep(`⏳ still running: ${parts.join(", ")}`);
};

const trackPhase = (key: string, label: string): void => {
  activePhases.set(key, { label, start: Date.now() });
  if (heartbeatTimer === undefined) {
    heartbeatTimer = setInterval(printHeartbeat, HEARTBEAT_MS);
    heartbeatTimer.unref?.();
  }
};

const untrackPhase = (key: string): void => {
  activePhases.delete(key);
  if (activePhases.size === 0 && heartbeatTimer !== undefined) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
};

/**
 * Run `fn`, logging a timestamped start/finish pair to the console and
 * appending a `TimingEntry` to the timings file. `meta` (issue/PR numbers,
 * models) is spread into both the console line and the JSONL entry.
 * While any phase is active, a heartbeat line lists them every 2 minutes.
 */
export const timed = async <T extends unknown>(
  phase: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>,
  path: string = TIMINGS_PATH,
): Promise<T> => {
  const metaText = Object.entries(meta)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  logStep(`▶ ${phase} started${metaText ? ` (${metaText})` : ""}`);
  const start = Date.now();
  const phaseLabel = `${phase}${metaText ? `(${metaText})` : ""}`;
  const phaseKey = `${phaseLabel}#${start}`;
  trackPhase(phaseKey, phaseLabel);
  let ok = true;
  try {
    return await fn();
  } catch (error) {
    ok = false;
    throw error;
  } finally {
    untrackPhase(phaseKey);
    const ms = Date.now() - start;
    logStep(
      `■ ${phase} ${ok ? "finished" : "failed"} in ${(ms / 1000).toFixed(1)}s${metaText ? ` (${metaText})` : ""}`,
    );
    appendTiming({ ts: new Date().toISOString(), phase, ms, ok, ...meta }, path);
  }
};
