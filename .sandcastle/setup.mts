// Init, doctor, and help — the operational commands behind
// `npx tsx .sandcastle/main.mts [--init|--doctor|--help]`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseEnvFile } from "./env.mts";
import * as github from "./github.mts";

const execFileAsync = promisify(execFile);

const LABEL_ROWS: [string, string, string, string][] = [
  [github.TRIGGER_LABEL, "issue", "you", "queue this issue for the loop"],
  [github.REQUIRE_PR_LABEL, "issue", "you", "gate it behind a PR + outer review"],
  ["sandcastle:in-review", "PR", "orchestrator", "agent debate in progress"],
  ["sandcastle:ready", "PR", "orchestrator", "debate settled, awaiting you"],
  ["sandcastle:needs-decision", "PR", "orchestrator", "deadlocked threads await your verdict"],
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
      `  npx tsx .sandcastle/main.mts [--init | --doctor | --help]`,
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

export const scaffoldImplementerSkill = (): "created" | "exists" => {
  if (existsSync(SKILL_PATH)) return "exists";
  const source = fileURLToPath(
    new URL("./implementer-skill.md", import.meta.url),
  );
  mkdirSync(dirname(SKILL_PATH), { recursive: true });
  writeFileSync(SKILL_PATH, readFileSync(source, "utf8"));
  return "created";
};

export const runInit = async (): Promise<void> => {
  const repo = await github.repoSlug();
  const created = await github.ensureLabelsExist(github.ALL_LABEL_DEFS);

  const skill = scaffoldImplementerSkill();
  console.log(
    skill === "created"
      ? `Wrote ${SKILL_PATH} — commit it so implementer sandboxes pick it up.`
      : `${SKILL_PATH} already exists — left untouched.`,
  );

  console.log(`Sandcastle labels in ${repo}:\n`);
  for (const [name, on, by, meaning] of LABEL_ROWS) {
    const mark = created.includes(name) ? "created" : "exists ";
    console.log(
      `  ${name.padEnd(26)} [${mark}]  on ${on.padEnd(5)} set by ${by.padEnd(12)} — ${meaning}`,
    );
  }
  console.log(
    `\nNext: label an issue \`sandcastle\` (add \`sandcastle:require-pr\` for the PR flow), then run \`npm run sandcastle\`.`,
  );
  console.log(`Details: .sandcastle/PR_SETUP.md`);
};

interface CheckResult {
  ok: boolean;
  detail: string;
  hint?: string;
}

export const runDoctor = async (): Promise<number> => {
  console.log(`Sandcastle doctor\n`);
  const results: boolean[] = [];

  const check = async (name: string, fn: () => Promise<CheckResult>) => {
    try {
      const result = await fn();
      results.push(result.ok);
      console.log(`  ${result.ok ? "✓" : "✗"} ${name} — ${result.detail}`);
      if (!result.ok && result.hint) console.log(`      ↳ ${result.hint}`);
    } catch (error) {
      results.push(false);
      const message =
        error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.log(`  ✗ ${name} — ${message}`);
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
    const ok = Boolean(
      envVars.CLAUDE_CODE_OAUTH_TOKEN || envVars.ANTHROPIC_API_KEY,
    );
    return {
      ok,
      detail: ok
        ? "Claude credential set"
        : "no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY",
      hint: "run `claude setup-token` and add CLAUDE_CODE_OAUTH_TOKEN to .sandcastle/.env",
    };
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
    return { ok: true, detail: "all 6 sandcastle labels exist" };
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
