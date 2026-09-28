// .sandcastle/.env holds the tokens Sandcastle injects into sandboxes.
// main.mts parses it in-process too, to fail fast with guidance when PR mode
// is requested but the token is missing.
//
// PR mode runs entirely as the owner's identity: agents post comments with
// **[agent-name]** markers, and the GH_TOKEN needs Contents (R/W),
// Pull requests (R/W), and Issues (R/W) scopes. See PR_SETUP.md.

export const parseEnvFile = (content: string): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[trimmed.slice(0, eq).trim()] = value;
  }
  return vars;
};

export const copilotCredentialProblem = (vars: Record<string, string>): string | undefined => {
  if (!vars.COPILOT_GITHUB_TOKEN?.trim()) {
    return "Set COPILOT_GITHUB_TOKEN in .sandcastle/.env for sandbox inference. Host Copilot login and GH_TOKEN are not substitutes; see .sandcastle/PR_SETUP.md.";
  }
  if (vars.COPILOT_GITHUB_TOKEN.startsWith("ghp_")) {
    return "COPILOT_GITHUB_TOKEN is a classic PAT, which Copilot does not support. Use a fine-grained PAT with the account permission Copilot Requests.";
  }
  return undefined;
};

export const readPrConfig = (
  vars: Record<string, string>,
): { ok: boolean; missing: string[] } => {
  const missing = ["GH_TOKEN"].filter((key) => !vars[key]);
  return { ok: missing.length === 0, missing };
};

export const prSetupGuide = (missing: string[]): string =>
  [
    `PR-labeled issues found, but PR-mode configuration is incomplete.`,
    `Missing from .sandcastle/.env: ${missing.join(", ")}`,
    ``,
    `PR mode runs as YOUR account (agents mark their comments with`,
    `**[agent-name]**). One-time setup (full guide: .sandcastle/PR_SETUP.md):`,
    `  1. Create or upgrade a fine-grained PAT for your account:`,
    `     https://github.com/settings/personal-access-tokens/new`,
    `     Repo permissions: Contents (R/W), Pull requests (R/W),`,
    `     Issues (R/W), Metadata (R).`,
    `  2. Set it as GH_TOKEN in .sandcastle/.env.`,
    `  3. Run \`npm run sandcastle:init\` once per repo to create the labels.`,
    ``,
    `Day to day: PRs labeled sandcastle:ready await you; add the`,
    `sandcastle:approved label when satisfied and the next run merges.`,
  ].join("\n");
