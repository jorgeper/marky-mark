// Pure helpers around the VERIFY_COMMANDS knob (config.mts) — used by
// main.mts (prompt text + startup nudge) and setup.mts (doctor).

/** Human-readable list for prompt injection: '`a`, `b` and `c`'. */
export const verifyCommandsText = (commands: readonly string[]): string => {
  if (commands.length === 0) {
    return "the verification commands declared in .sandcastle/config.mts (currently unset — check package.json scripts for the real ones)";
  }
  const quoted = commands.map((c) => `\`${c}\``);
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
};

/**
 * The inner-loop verify list: the quick subset when declared, otherwise the
 * full list — so an empty QUICK_VERIFY_COMMANDS means "no tiering".
 */
export const effectiveQuickCommands = (
  quick: readonly string[],
  full: readonly string[],
): readonly string[] => (quick.length > 0 ? quick : full);

/**
 * Script names referenced by `<pm> run <script>` verify commands but absent
 * from package.json `scripts`. Non-runner commands (cargo, pytest, …) are
 * skipped — their absence is a PATH question, not a package.json one.
 */
export const missingVerifyScripts = (
  commands: readonly string[],
  scripts: Record<string, string>,
): string[] =>
  commands
    .map((c) => /^(?:npm|pnpm|yarn|bun) run (\S+)/.exec(c)?.[1])
    .filter((s): s is string => s !== undefined && !(s in scripts));
