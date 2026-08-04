// Init, doctor, and help — the operational commands behind
// `npx tsx .sandcastle/main.mts [--init|--doctor|--help]`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { QUICK_VERIFY_COMMANDS, VERIFY_COMMANDS } from "./config.mts";
import { parseEnvFile } from "./env.mts";
import * as github from "./github.mts";
import {
  currentImageId,
  dockerfileSuggestion,
  imageCreatedMs,
  readTally,
  scanLogs,
  type InstallDetection,
} from "./install-scan.mts";
import { missingVerifyScripts } from "./verify.mts";

const execFileAsync = promisify(execFile);

export const LABEL_ROWS: [string, string, string, string][] = [
  [github.TRIGGER_LABEL, "issue", "you", "queue this issue for the loop"],
  [github.REQUIRE_PR_LABEL, "issue", "you", "gate it behind a PR + outer review"],
  [github.AGENT_APPROVE_LABEL, "issue", "you", "same PR flow, but the reviewer agent approves in your place"],
  [github.REQUIRES_PRD_LABEL, "issue", "you", "needs an approved PRD PR before decompose/implement"],
  [github.RELEASE_LABEL, "issue", "/new-release", "release request — enters the releaser lane (prd/008)"],
  ["sandcastle:in-review", "PR", "orchestrator", "agent debate in progress"],
  ["sandcastle:ready", "PR", "orchestrator", "debate settled, awaiting you"],
  ["sandcastle:needs-decision", "PR", "orchestrator", "deadlocked threads await your verdict"],
  ["sandcastle:ready-to-merge", "issue", "orchestrator", "goal verified on the branch — merge phase takes it directly"],
  ["sandcastle:approved", "PR", "you", "authorize the merge — next run squash-merges"],
];

export const printHelp = (): void => {
  console.log(
    [
      `Sandcastle orchestrator`,
      ``,
      `Usage:`,
      `  npm run sandcastle           run the loop (classify → merge → debate → plan → implement)`,
      `  npm run sandcastle:init      create the sandcastle label vocabulary in this repo`,
      `  npm run sandcastle:doctor    check env, auth, docker image, and labels`,
      `      -- --image-gaps          also live-scan logs for in-sandbox installs + Dockerfile suggestions`,
      `  npx tsx .sandcastle/main.mts [--init | --doctor [--image-gaps] | --help]`,
      ``,
      `Labels (see .sandcastle/PR_SETUP.md for the full protocol):`,
      ...LABEL_ROWS.map(
        ([name, on, by, meaning]) =>
          `  ${name.padEnd(26)} on ${on.padEnd(5)} set by ${by.padEnd(12)} — ${meaning}`,
      ),
    ].join("\n"),
  );
};

// Scaffold the implementer process-rules skill into the repo. In goal mode
// the implementer receives no prompt — its prompt IS the composed /goal
// command — so the process rules (RGR, commit format, single-task scope)
// live as a committed Claude Code skill that every sandbox checkout carries.
// Written once, committed by the owner; never overwritten if present.
const SKILL_PATH = ".claude/skills/sandcastle-implementer/SKILL.md";
const CUSTOMIZE_SKILL_PATH = ".claude/skills/sandcastle-customize/SKILL.md";
const ANALYZE_SKILL_PATH = ".claude/skills/sandcastle-analyze/SKILL.md";

const scaffoldSkill = (
  targetPath: string,
  sourceFile: string,
): "created" | "exists" => {
  if (existsSync(targetPath)) return "exists";
  const source = fileURLToPath(new URL(sourceFile, import.meta.url));
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, readFileSync(source, "utf8"));
  return "created";
};

export const scaffoldImplementerSkill = (): "created" | "exists" =>
  scaffoldSkill(SKILL_PATH, "./implementer-skill.md");

export const scaffoldCustomizeSkill = (): "created" | "exists" =>
  scaffoldSkill(CUSTOMIZE_SKILL_PATH, "./customize-skill.md");

export const scaffoldAnalyzeSkill = (): "created" | "exists" =>
  scaffoldSkill(ANALYZE_SKILL_PATH, "./analyze-skill.md");

export const runInit = async (): Promise<void> => {
  // Scaffold the local skills BEFORE any GitHub call: a bad token or missing
  // remote must not strand purely local scaffolding (nudges-not-gates).
  const skill = scaffoldImplementerSkill();
  console.log(
    skill === "created"
      ? `Wrote ${SKILL_PATH} — commit it so implementer sandboxes pick it up.`
      : `${SKILL_PATH} already exists — left untouched.`,
  );

  const customize = scaffoldCustomizeSkill();
  console.log(
    customize === "created"
      ? `Wrote ${CUSTOMIZE_SKILL_PATH} — run it from your coding agent to tune verify commands; commit it with the scaffold.`
      : `${CUSTOMIZE_SKILL_PATH} already exists — left untouched.`,
  );

  const analyze = scaffoldAnalyzeSkill();
  console.log(
    analyze === "created"
      ? `Wrote ${ANALYZE_SKILL_PATH} — run it from your coding agent after a slow run to see where the time went.`
      : `${ANALYZE_SKILL_PATH} already exists — left untouched.`,
  );

  const repo = await github.repoSlug();
  const created = await github.ensureLabelsExist(github.ALL_LABEL_DEFS);

  console.log(`Sandcastle labels in ${repo}:\n`);
  for (const [name, on, by, meaning] of LABEL_ROWS) {
    const mark = created.includes(name) ? "created" : "exists ";
    console.log(
      `  ${name.padEnd(26)} [${mark}]  on ${on.padEnd(5)} set by ${by.padEnd(12)} — ${meaning}`,
    );
  }
  console.log(
    `\nNext: label an issue \`sandcastle\` (add \`sandcastle:require-pr\` for the PR flow, or \`sandcastle:agent-approve\` to have the reviewer approve it too), then run \`npm run sandcastle\`.`,
  );
  console.log(`Details: .sandcastle/PR_SETUP.md`);
};

interface CheckResult {
  ok: boolean;
  detail: string;
  hint?: string;
}

export const runDoctor = async (options?: {
  /** Also live-scan ALL logs for in-sandbox installs and print ready-to-
   *  paste Dockerfile lines. Off by default: old logs from before an image
   *  fix would re-flag solved problems. */
  imageGaps?: boolean;
}): Promise<number> => {
  console.log(`Sandcastle doctor\n`);
  const results: boolean[] = [];

  // A missing binary (`gh`, `docker`) surfaces as a raw `spawn <bin> ENOENT`
  // from every check that shells out to it — translate it into an actionable
  // install hint, printed once per binary rather than under each failing
  // check.
  const INSTALL_HINTS: Record<string, string> = {
    gh: "install the GitHub CLI, then `gh auth login` — macOS: `brew install gh`; Debian/Ubuntu: `sudo apt install gh`; all platforms: https://github.com/cli/cli#installation",
    docker:
      "install Docker and start the daemon — macOS: Docker Desktop (or `brew install colima docker`); Debian/Ubuntu: `sudo apt install docker.io`; all platforms: https://docs.docker.com/get-docker/",
  };
  const hintedBinaries = new Set<string>();
  const check = async (name: string, fn: () => Promise<CheckResult>) => {
    try {
      const result = await fn();
      results.push(result.ok);
      console.log(`  ${result.ok ? "✓" : "✗"} ${name} — ${result.detail}`);
      if (!result.ok && result.hint) console.log(`      ↳ ${result.hint}`);
    } catch (error) {
      results.push(false);
      const errno = error as NodeJS.ErrnoException;
      const missingBinary =
        error instanceof Error &&
        errno.code === "ENOENT" &&
        errno.path &&
        errno.path in INSTALL_HINTS
          ? errno.path
          : undefined;
      const message = missingBinary
        ? `\`${missingBinary}\` is not installed (not found on PATH)`
        : error instanceof Error
          ? error.message.split("\n")[0]
          : String(error);
      console.log(`  ✗ ${name} — ${message}`);
      if (missingBinary && !hintedBinaries.has(missingBinary)) {
        hintedBinaries.add(missingBinary);
        console.log(`      ↳ ${INSTALL_HINTS[missingBinary]}`);
      }
    }
  };

  let envVars: Record<string, string> = {};
  await check(".sandcastle/.env", async () => {
    envVars = parseEnvFile(
      readFileSync(new URL("./.env", import.meta.url), "utf8"),
    );
    return { ok: true, detail: "found" };
  });

  await check("agent credentials", async () => {
    // Presence is not validity: a stale or mispasted credential passes an
    // existence check here, then 401s every agent mid-run ("Invalid bearer
    // token"). Probe the API up front. Only a 401 fails the check — any
    // other response proves the credential authenticated — and a network
    // error degrades to a soft pass so the doctor still works offline.
    const oauth = envVars.CLAUDE_CODE_OAUTH_TOKEN;
    const apiKey = envVars.ANTHROPIC_API_KEY;
    if (!oauth && !apiKey) {
      return {
        ok: false,
        detail: "no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY",
        hint: "run `claude setup-token` and add CLAUDE_CODE_OAUTH_TOKEN to .sandcastle/.env",
      };
    }
    if (oauth && !oauth.startsWith("sk-ant-oat01-")) {
      return {
        ok: false,
        detail:
          "CLAUDE_CODE_OAUTH_TOKEN does not look like a Claude Code OAuth token (expected sk-ant-oat01-…)",
        hint: "run `claude setup-token` and paste the full token into .sandcastle/.env",
      };
    }
    const label = oauth ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY";
    const headers: Record<string, string> = oauth
      ? {
          Authorization: `Bearer ${oauth}`,
          "anthropic-beta": "oauth-2025-04-20",
          "anthropic-version": "2023-06-01",
        }
      : { "x-api-key": apiKey as string, "anthropic-version": "2023-06-01" };
    let status: number;
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
    } catch {
      return {
        ok: true,
        detail: `${label} set (API unreachable — could not verify)`,
      };
    }
    if (status === 401) {
      return {
        ok: false,
        detail: `${label} rejected by the API (401) — agents will fail with "Invalid bearer token"`,
        hint: oauth
          ? "the token is expired or revoked — run `claude setup-token` and update .sandcastle/.env"
          : "check the key in the Anthropic console and update .sandcastle/.env",
      };
    }
    return { ok: true, detail: `${label} authenticates against the API` };
  });

  await check("GH_TOKEN (sandbox agents)", async () => {
    if (!envVars.GH_TOKEN) {
      return {
        ok: false,
        detail: "missing from .sandcastle/.env",
        hint: "see .sandcastle/PR_SETUP.md for the required scopes",
      };
    }
    await execFileAsync("gh", ["api", "user"], {
      env: { ...process.env, GH_TOKEN: envVars.GH_TOKEN },
    });
    // A contents-only fine-grained PAT passes the auth probe above but
    // strands sandbox agents on issue/PR operations — probe issue access.
    const slug = await github.repoSlug();
    try {
      await execFileAsync(
        "gh",
        ["api", `repos/${slug}/issues?per_page=1`, "--silent"],
        { env: { ...process.env, GH_TOKEN: envVars.GH_TOKEN } },
      );
    } catch {
      return {
        ok: false,
        detail:
          "authenticates but cannot read this repo's issues — sandbox agents will fail on issue/PR operations",
        hint: "regenerate the token with Contents + Issues + Pull requests R/W (fine-grained) or `repo` scope (classic), then update GH_TOKEN in .sandcastle/.env",
      };
    }
    return {
      ok: true,
      detail:
        "authenticates and can read issues (write scopes can't be probed — PR mode needs Contents+PRs+Issues R/W)",
    };
  });

  await check("gh CLI host auth + repo", async () => {
    const slug = await github.repoSlug();
    return { ok: true, detail: slug };
  });

  await check("implementer skill committed", async () => {
    // Sandbox worktrees branch from committed history, so an uncommitted
    // skill file silently strips goal-mode implementers of their process
    // rules (single 🏰 comment when complete, prior-attempt awareness).
    try {
      await execFileAsync("git", ["cat-file", "-e", `HEAD:${SKILL_PATH}`]);
    } catch {
      const scaffolded = existsSync(SKILL_PATH);
      return {
        ok: false,
        detail: scaffolded
          ? `${SKILL_PATH} exists but is not committed — implementers run without process rules`
          : `${SKILL_PATH} missing`,
        hint: scaffolded
          ? "git add .claude .sandcastle && git commit -m 'chore: sandcastle scaffold' && git push"
          : "run `npm run sandcastle:init`, then git add .claude .sandcastle && git commit && git push",
      };
    }
    return { ok: true, detail: "committed on HEAD" };
  });

  await check("verify commands", async () => {
    // Tier-2 knob honesty (prd/007): a wrong VERIFY_COMMANDS fails loud
    // here, not three agent-turns deep in an unsatisfiable spec goal.
    if (VERIFY_COMMANDS.length === 0) {
      return {
        ok: false,
        detail:
          "VERIFY_COMMANDS in .sandcastle/config.mts is empty — spec goals and merge checks can't name verification",
        hint: 'run the "sandcastle-customize" skill from your coding agent in this repo (or edit .sandcastle/config.mts by hand)',
      };
    }
    let scripts: Record<string, string> = {};
    try {
      const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
        scripts?: Record<string, string>;
      };
      scripts = pkg.scripts ?? {};
    } catch {
      // No package.json (non-node repo): pm-run checks don't apply.
    }
    const missing = missingVerifyScripts(
      [...VERIFY_COMMANDS, ...QUICK_VERIFY_COMMANDS],
      scripts,
    );
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `package.json has no script(s): ${missing.join(", ")}`,
        hint: "fix VERIFY_COMMANDS/QUICK_VERIFY_COMMANDS in .sandcastle/config.mts or add the scripts to package.json",
      };
    }
    return { ok: true, detail: VERIFY_COMMANDS.join(", ") };
  });

  await check("docker sandbox image", async () => {
    const image = `sandcastle:${basename(process.cwd())}`;
    const { stdout } = await execFileAsync("docker", ["images", "-q", image]);
    if (!stdout.trim()) {
      return {
        ok: false,
        detail: `${image} not built`,
        hint: "run `npx sandcastle docker build-image`",
      };
    }
    return { ok: true, detail: image };
  });

  await check("labels", async () => {
    const existing = new Set(
      (await github.listLabelNames()).map((name) => name.toLowerCase()),
    );
    const missing = github.ALL_LABEL_DEFS.filter(
      (def) => !existing.has(def.name.toLowerCase()),
    ).map((def) => def.name);
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `missing: ${missing.join(", ")}`,
        hint: "run `npm run sandcastle:init`",
      };
    }
    return {
      ok: true,
      detail: `all ${github.ALL_LABEL_DEFS.length} sandcastle labels exist`,
    };
  });

  await check("image gaps", async () => {
    // In-sandbox installs mean the Dockerfile is missing toolchain the
    // agents keep needing (prd/006). Evidence is scoped to the CURRENT
    // image: a tally recorded against a previous image is stale (the
    // rebuild was the fix), and the --image-gaps live scan only reads log
    // runs started after the image was built. Rebuilding resets the tally.
    const image = `sandcastle:${basename(process.cwd())}`;
    const imageId = await currentImageId(image).catch(() => "");
    const tally = readTally();
    const tallyFresh =
      tally !== undefined && imageId !== "" && tally.imageId === imageId;
    const found = new Map<string, string>();
    const detections = new Map<string, InstallDetection>();
    if (tallyFresh) {
      for (const [key, e] of Object.entries(tally.entries)) {
        found.set(key, `${key} (${e.runs} run${e.runs !== 1 ? "s" : ""})`);
        detections.set(key, { key, label: key, line: e.lastExample });
      }
    }
    if (options?.imageGaps) {
      const since = await imageCreatedMs(image);
      for (const d of scanLogs(since)) {
        if (!found.has(d.key)) {
          found.set(d.key, `${d.key} (in logs, not yet tallied)`);
        }
        detections.set(d.key, d);
      }
    }
    if (found.size === 0) {
      const staleNote =
        tally !== undefined && !tallyFresh
          ? " (previous image's tally ignored — clears after the next completed run)"
          : "";
      return {
        ok: true,
        detail: options?.imageGaps
          ? `no in-sandbox installs against the current image${staleNote}`
          : `none tallied against the current image${staleNote} (re-run with --image-gaps for a log scan)`,
      };
    }
    // A suggested install that's already in the Dockerfile is a different
    // problem: the bake isn't taking effect at runtime.
    let dockerfile = "";
    try {
      dockerfile = readFileSync(".sandcastle/Dockerfile", "utf8");
    } catch {
      // No Dockerfile — the plain suggestion below stands.
    }
    const alreadyBaked = [...detections.values()].filter(
      (d) => d.key === "playwright-browsers" && /playwright.* install/.test(dockerfile),
    );
    const suggestions = [...detections.values()]
      .map((d) => `      ${dockerfileSuggestion(d)}`)
      .join("\n");
    const bakedNote =
      alreadyBaked.length > 0
        ? `\n    note: the Dockerfile already has a playwright install line, yet agents still installed against the CURRENT image — the bake isn't effective at runtime. Check: browsers must be in a path the runtime user can read (PLAYWRIGHT_BROWSERS_PATH), and the playwright version must match the repo's.`
        : "";
    return {
      ok: false,
      detail: `agents install inside sandboxes (current image): ${[...found.values()].join(", ")}`,
      hint: `add to .sandcastle/Dockerfile, then \`npx sandcastle docker build-image\` (rebuilding resets the tally):\n${suggestions}${bakedNote}`,
    };
  });

  await check("queued work", async () => {
    const issues = await github.listSandcastleIssues();
    return {
      ok: true,
      detail: `${issues.length} open issue(s) labeled sandcastle`,
    };
  });

  const failed = results.filter((ok) => !ok).length;
  console.log(
    failed === 0
      ? `\nAll checks passed.`
      : `\n${failed} check(s) need attention.`,
  );
  return failed === 0 ? 0 : 1;
};
