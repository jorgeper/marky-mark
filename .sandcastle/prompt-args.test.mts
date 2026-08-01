import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Tripwire: a {{PLACEHOLDER}} in a prompt file with no matching promptArgs
// entry in main.mts is a runtime PromptError that kills the run (it once
// took the whole loop down, uncaught). This mirrors the args each call
// site passes — update BOTH when adding a placeholder.

const BUILT_IN = ["SOURCE_BRANCH", "TARGET_BRANCH"];

const ARGS_BY_PROMPT: Record<string, string[]> = {
  "plan-prompt.md": ["CANDIDATE_NUMBERS", "LIST_TASKS_COMMAND"],
  "spec-prompt.md": [
    "TASK_ID",
    "ISSUE_TITLE",
    "BRANCH",
    "SPEC_PATH",
    "REPO",
    "AGENT_MARKER",
    "VERIFY_COMMANDS",
    "QUICK_VERIFY_COMMANDS",
  ],
  "review-prompt.md": [
    "TASK_ID",
    "BRANCH",
    "QUICK_VERIFY_COMMANDS",
    "COMMENT_TASK_COMMAND",
  ],
  "merge-prompt.md": [
    "BRANCHES",
    "ISSUES",
    "VERIFY_COMMANDS",
    "COMMENT_TASK_COMMAND",
    "CLOSE_TASK_COMMAND",
    "VIEW_TASK_COMMAND",
  ],
  "pr-review-prompt.md": [
    "AGENT_NAME",
    "AGENT_MARKER",
    "PR_NUMBER",
    "REPO",
    "THREADS_JSON",
    "FINAL_ROUND",
  ],
  "pr-address-prompt.md": [
    "AGENT_NAME",
    "AGENT_MARKER",
    "PR_NUMBER",
    "REPO",
    "THREADS_JSON",
    "BRANCH",
    "VERIFY_COMMANDS",
    "QUICK_VERIFY_COMMANDS",
  ],
  "pr-conflict-prompt.md": [
    "AGENT_NAME",
    "BRANCH",
    "VERIFY_COMMANDS",
    "QUICK_VERIFY_COMMANDS",
  ],
  "decompose-prompt.md": [
    "PARENT_NUMBER",
    "PARENT_TITLE",
    "PRD_PATH",
    "REPO",
    "AGENT_MARKER",
    "TRIGGER_LABEL",
  ],
};

const placeholdersIn = (file: string): string[] => {
  const text = readFileSync(
    fileURLToPath(new URL(`./${file}`, import.meta.url)),
    "utf8",
  );
  return [...new Set([...text.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]!))];
};

describe("every prompt placeholder has a matching promptArgs entry", () => {
  for (const [file, args] of Object.entries(ARGS_BY_PROMPT)) {
    it(file, () => {
      const allowed = new Set([...args, ...BUILT_IN]);
      const unmatched = placeholdersIn(file).filter((p) => !allowed.has(p));
      expect(unmatched).toEqual([]);
    });
  }
});
