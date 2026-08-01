// Image-gap nudge (prd/006, jorgeper/sandcastle#9): detect expensive
// in-sandbox installs in run logs and suggest baking them into the
// Dockerfile. Installs inside a container die with it — every new sandbox
// repays the download, and goal-mode attempts burn turn budget on setup.
// Nudge, never a gate: nothing blocks, nothing edits the Dockerfile.
// Pure functions live at the top so tests can import without side effects.

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface InstallDetection {
  key: string;
  label: string;
  /** The first matching log line (trimmed), kept as evidence. */
  line: string;
}

// Fixed list, matched line-by-line — no duration/size heuristics in v1.
// Deliberately absent: plain npm/yarn/pnpm install (worktree deps persist
// via the bind mount) and pip install (usually venv-local).
const SIGNATURES: ReadonlyArray<{
  key: string;
  label: string;
  pattern: RegExp;
}> = [
  {
    key: "playwright-browsers",
    label: "Playwright browsers (`npx playwright install`)",
    pattern: /playwright install/,
  },
  {
    key: "apt-packages",
    label: "system packages via apt (`apt-get install`)",
    pattern: /\bapt(-get)?\s+install\b/,
  },
  {
    key: "apk-packages",
    label: "system packages via apk (`apk add`)",
    pattern: /\bapk\s+add\b/,
  },
  {
    key: "dnf-yum-packages",
    label: "system packages via dnf/yum",
    pattern: /\b(dnf|yum)\s+install\b/,
  },
  {
    key: "npm-global",
    label: "global npm packages (`npm install -g`)",
    pattern: /\bnpm\s+(install|i)\s+(-g|--global)\b/,
  },
];

/** Scan one log's text; each signature is reported at most once per scan. */
export const detectInstalls = (logText: string): InstallDetection[] => {
  const found = new Map<string, InstallDetection>();
  for (const line of logText.split("\n")) {
    for (const sig of SIGNATURES) {
      if (!found.has(sig.key) && sig.pattern.test(line)) {
        found.set(sig.key, {
          key: sig.key,
          label: sig.label,
          line: line.trim().slice(0, 200),
        });
      }
    }
  }
  return [...found.values()];
};

export interface InstallTally {
  /** Sandbox image id the counts were collected against. A different id
   *  means the owner rebuilt the image — the fix — so counts reset. */
  imageId: string;
  entries: Record<string, { runs: number; lastExample: string }>;
}

export const updateTally = (
  tally: InstallTally | undefined,
  imageId: string,
  detections: InstallDetection[],
): InstallTally => {
  const base: InstallTally =
    tally && tally.imageId === imageId ? tally : { imageId, entries: {} };
  const entries = { ...base.entries };
  for (const d of detections) {
    entries[d.key] = {
      runs: (entries[d.key]?.runs ?? 0) + 1,
      lastExample: d.line,
    };
  }
  return { imageId, entries };
};

/** Package tokens following the install keyword in the captured line —
 *  flags are skipped, the first shell metacharacter ends the list. */
const packagesAfter = (line: string, keyword: RegExp): string[] => {
  const match = keyword.exec(line);
  if (!match) return [];
  const rest = line.slice(match.index + match[0].length);
  const packages: string[] = [];
  for (const token of rest.split(/\s+/)) {
    if (token === "" || token.startsWith("-")) continue;
    if (!/^[A-Za-z0-9][\w.+:@/-]*$/.test(token)) break;
    packages.push(token);
  }
  return packages;
};

/** Ready-to-paste Dockerfile line for a detection, package names parsed
 *  from the captured command when possible. */
export const dockerfileSuggestion = (d: InstallDetection): string => {
  const pkgs = (keyword: RegExp, fallback = "<packages>"): string => {
    const found = packagesAfter(d.line, keyword);
    return found.length > 0 ? found.join(" ") : fallback;
  };
  switch (d.key) {
    case "playwright-browsers":
      // Two gotchas make the naive one-liner ineffective: installed as root
      // before the USER switch, browsers land in /root/.cache where the
      // runtime user can't see them; and unpinned npx grabs the latest
      // playwright, whose browser build revision may not match the repo's.
      return [
        `ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`,
        `RUN npx playwright@<repo's @playwright/test version> install --with-deps ${pkgs(/playwright\s+install\b/, "chromium")} && chmod -R a+rX /ms-playwright`,
      ].join("\n      ");
    case "apt-packages":
      return `RUN apt-get update && apt-get install -y ${pkgs(/apt(?:-get)?\s+install\b/)}`;
    case "apk-packages":
      return `RUN apk add --no-cache ${pkgs(/apk\s+add\b/)}`;
    case "dnf-yum-packages":
      return `RUN dnf install -y ${pkgs(/(?:dnf|yum)\s+install\b/)}`;
    case "npm-global":
      return `RUN npm install -g ${pkgs(/npm\s+(?:install|i)\s+(?:-g|--global)\b/)}`;
    default:
      return `RUN <install ${d.label}>`;
  }
};

export const formatNudges = (
  tally: InstallTally,
  detections: InstallDetection[],
): string[] =>
  detections.map((d) => {
    const runs = tally.entries[d.key]?.runs ?? 1;
    const repeat = runs > 1 ? ` (seen in ${runs} runs)` : "";
    return (
      `⚠ agents installed ${d.label} inside the sandbox${repeat} — ` +
      `bake it into .sandcastle/Dockerfile and rebuild: npx sandcastle docker build-image\n` +
      `    ${dockerfileSuggestion(d)}`
    );
  });

// ---------------------------------------------------------------------------
// IO — best-effort, all failures swallowed (like the conversational nudge)
// ---------------------------------------------------------------------------

const TALLY_PATH = ".sandcastle/install-tally.json";
const LOGS_DIR = ".sandcastle/logs";

export const readTally = (): InstallTally | undefined => {
  try {
    return JSON.parse(readFileSync(TALLY_PATH, "utf8")) as InstallTally;
  } catch {
    return undefined;
  }
};

export const currentImageId = async (imageName: string): Promise<string> => {
  const { stdout } = await execFileAsync("docker", [
    "images",
    "-q",
    imageName,
  ]);
  return stdout.trim();
};

/** Creation time (ms epoch) of the current image; 0 when unknown. */
export const imageCreatedMs = async (imageName: string): Promise<number> => {
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "-f",
      "{{.Created}}",
      imageName,
    ]);
    const ms = Date.parse(stdout.trim());
    return Number.isNaN(ms) ? 0 : ms;
  } catch {
    return 0;
  }
};

/**
 * The portion of a log's text belonging to runs started at or after
 * `sinceMs`. Logs append forever, one `--- Run started: <ISO> ---` delimiter
 * per run — filtering by file mtime alone re-reports installs from runs that
 * predate an image rebuild every time the file is touched. Text before the
 * first delimiter is treated as ancient (included only when sinceMs is 0).
 */
export const runSectionsSince = (text: string, sinceMs: number): string => {
  if (sinceMs <= 0) return text;
  const parts = text.split(/^--- Run started: (.+?) ---$/m);
  // parts = [preamble, ts1, body1, ts2, body2, ...]
  let kept = "";
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const ms = Date.parse(parts[i]!.trim());
    if (!Number.isNaN(ms) && ms >= sinceMs) kept += parts[i + 1]!;
  }
  return kept;
};

/** Detections across all non-conversation logs modified since `sinceMs`
 *  (0 = all history — the doctor's live view, so interrupted or in-flight
 *  runs still surface). Best-effort: [] on any failure. */
export const scanLogs = (sinceMs = 0): InstallDetection[] => {
  try {
    if (!existsSync(LOGS_DIR)) return [];
    const detections = new Map<string, InstallDetection>();
    for (const file of readdirSync(LOGS_DIR)) {
      if (!file.endsWith(".log") || file.startsWith("conversation-")) continue;
      const path = join(LOGS_DIR, file);
      if (statSync(path).mtimeMs < sinceMs) continue;
      const scoped = runSectionsSince(readFileSync(path, "utf8"), sinceMs);
      for (const d of detectInstalls(scoped)) {
        if (!detections.has(d.key)) detections.set(d.key, d);
      }
    }
    return [...detections.values()];
  } catch {
    return [];
  }
};

/** Run-end path: scan this run's logs, update the tally, return the nudge
 *  lines to print. Best-effort: returns [] on any failure. */
export const runInstallScan = async (
  imageName: string,
  sinceMs: number,
): Promise<string[]> => {
  try {
    const detections = new Map<string, InstallDetection>(
      scanLogs(sinceMs).map((d) => [d.key, d]),
    );
    if (detections.size === 0) return [];
    const imageId = await currentImageId(imageName);
    const tally = updateTally(readTally(), imageId, [...detections.values()]);
    writeFileSync(TALLY_PATH, `${JSON.stringify(tally, null, 2)}\n`);
    return formatNudges(tally, [...detections.values()]);
  } catch {
    return [];
  }
};
