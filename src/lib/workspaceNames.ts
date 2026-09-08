/**
 * PRD 020 Req 1+3 (amended by PRD 026 Req 1+2+9): the workspace unique-name
 * rules — one pure module owning the charset/length validation, the
 * case-insensitive comparison key, the reserved-name list, and the
 * slugify/dedupe machinery migration and the scratchpad provisioning share.
 * PRD 026 splits the format rule in two: a name being CHOSEN (creation, a
 * rename) must be lowercase-dash (`uniqueNameFormatProblem`), while a name
 * already STORED keeps PRD 020's wider charset
 * (`legacyUniqueNameFormatProblem`) so nothing on disk stops parsing. The
 * server (`server/workspaces.ts`) enforces these rules on creation and
 * rename; the New Workspace dialog and the workspace-settings rename section
 * pre-validate with the same functions, so client hints and server refusals
 * can never disagree. No I/O, no imports from the manifest module: migration
 * planning works over a minimal structural shape so this module stays
 * leaf-level.
 */

/** PRD 020 Req 1: a unique name is 1–100 characters. */
export const UNIQUE_NAME_MAX_LENGTH = 100;

/**
 * PRD 026 Req 1: the rule a chosen name meets — lowercase ASCII letters,
 * digits and single dashes, never leading, trailing or consecutive.
 */
const CHOSEN_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * PRD 026 Req 9: PRD 020 Req 1's original charset, kept only for names
 * already stored (`uniqueName`, `formerNames`) so a grandfathered `Team_Docs`
 * or `Design-Docs` manifest still parses.
 */
const LEGACY_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * PRD 026 Req 1: the one charset refusal every caller shows — the dialogs as
 * you type, the server in its 400 — phrased to sit beside Req 7's guidance
 * ("Lowercase letters, numbers and dashes").
 */
const CHOSEN_NAME_CHARSET_PROBLEM =
  'A unique name may only use lowercase letters, numbers and single dashes between them.';

/** PRD 026 Req 2: the word the planner and the server mint when a slug comes out empty. */
export const WORKSPACE_SLUG_FALLBACK = 'workspace';

/**
 * PRD 020 Req 1 (Req 11's reserved words): names no workspace may take —
 * `scratch`/`scratchpad` (the scratchpad feature's canonical path word and
 * its issue #244 legacy alias — both stay reserved so neither can be
 * shadowed by a real workspace or a derived username) and the
 * top-level route segments already in use: `api` (the whole REST surface,
 * server/app.ts) and `assets` (the built SPA's asset directory, which path
 * routing must keep addressable). Compared case-insensitively, like
 * uniqueness itself.
 */
export const RESERVED_WORKSPACE_NAMES = ['api', 'assets', 'scratch', 'scratchpad'] as const;

/** PRD 020 Req 1: uniqueness is case-insensitive — this is the comparison key. */
export function uniqueNameKey(name: string): string {
  return name.toLowerCase();
}

export function isReservedWorkspaceName(name: string): boolean {
  return (RESERVED_WORKSPACE_NAMES as readonly string[]).includes(uniqueNameKey(name));
}

/**
 * PRD 020 Req 1: the empty and over-length refusals both format rules share
 * — distinct messages from the charset one, so a user learns which of the
 * three they tripped.
 */
function uniqueNameLengthProblem(name: string): string | null {
  if (name.length === 0) return 'A unique name is required.';
  if (name.length > UNIQUE_NAME_MAX_LENGTH) {
    return `A unique name must be at most ${UNIQUE_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

/**
 * PRD 026 Req 1 (amending PRD 020 Req 1): the format refusal a CHOSEN unique
 * name earns, or null when it is well-formed. Format only — reserved words
 * are a policy the server (and the dialogs) layer on via `uniqueNameProblem`.
 * Stored names are NOT held to this: manifest validation uses
 * `legacyUniqueNameFormatProblem` (Req 9), which is what keeps a
 * grandfathered manifest readable.
 */
export function uniqueNameFormatProblem(name: string): string | null {
  const length = uniqueNameLengthProblem(name);
  if (length) return length;
  return CHOSEN_NAME_RE.test(name) ? null : CHOSEN_NAME_CHARSET_PROBLEM;
}

/**
 * PRD 026 Req 9: the format refusal a STORED unique name earns under PRD 020
 * Req 1's original charset (`[A-Za-z0-9._-]`, 1–100). Manifest validation
 * checks `uniqueName` and every `formerNames` entry with this, never with the
 * strict rule, so a name written under the old rule keeps parsing, resolving
 * and listing unchanged. Nothing that chooses a name calls this.
 */
export function legacyUniqueNameFormatProblem(name: string): string | null {
  const length = uniqueNameLengthProblem(name);
  if (length) return length;
  return LEGACY_NAME_RE.test(name) ? null : 'A unique name may only use letters, digits, and . _ - characters.';
}

/**
 * PRD 020 Req 1 + PRD 026 Req 1+3: the full refusal a chosen name earns —
 * strict format, then the reserved list. This is what creation and rename
 * enforce, and what the dialogs show as you type; collisions need deployment
 * state and stay the server's own check.
 */
export function uniqueNameProblem(name: string): string | null {
  const format = uniqueNameFormatProblem(name);
  if (format) return format;
  if (isReservedWorkspaceName(name)) return `"${name}" is a reserved name.`;
  return null;
}

/**
 * PRD 024 Req 2+3+4: the `formerNames` history a rename leaves behind — pure,
 * so the server route stays a thin caller. Three rules in one pass: the name
 * becoming current leaves the list (Req 3 — the list never holds the current
 * name, so renaming back reclaims your own name), the name just given up is
 * appended in order (Req 2, and Req 4's flat list: no old→new mapping, so no
 * chain and no loop is representable), and a case-only change records nothing
 * because the previous and next names share a `uniqueNameKey`. An entry is
 * never duplicated, and a rename from nothing (a manifest that carried no
 * unique name) records nothing.
 */
export function recordFormerName(
  formerNames: readonly string[],
  previous: string | undefined,
  next: string,
): string[] {
  const nextKey = uniqueNameKey(next);
  const kept = formerNames.filter((name) => uniqueNameKey(name) !== nextKey);
  if (previous === undefined) return kept;
  const previousKey = uniqueNameKey(previous);
  if (previousKey === nextKey) return kept;
  return kept.some((name) => uniqueNameKey(name) === previousKey) ? kept : [...kept, previous];
}

/**
 * PRD 026 Req 2 (amending PRD 020 Req 3): THE slugifier — free text into a
 * URL-name candidate. Lowercased; every run of characters outside `[a-z0-9]`
 * becomes one dash; leading and trailing dashes go; clamped to the length
 * limit, and trailing dashes go again after the clamp (a cut can land right
 * after one). Every non-empty result satisfies Req 1. Nothing usable (`!!!`,
 * `日本語`) yields the empty string: the fallback word is the caller's —
 * `WORKSPACE_SLUG_FALLBACK` for the migration planner and the server's
 * name-only create, `user` for username derivation (Req 11,
 * `usernames.ts`), and none at all for the New Workspace dialog (Req 6).
 */
export function slugifyWorkspaceName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, UNIQUE_NAME_MAX_LENGTH)
    .replace(/-+$/, '');
}

/**
 * PRD 020 Req 3: dedupe a candidate deployment-wide with `-2`, `-3`…
 * suffixes. Reserved words count as taken — migration must never mint one
 * (the existing "Scratchpad" workspace slugifies straight into the reserved
 * word, and lands on `scratchpad-2` because of this rule). `taken` holds
 * `uniqueNameKey`-normalized names; the suffix truncates the base so the
 * result never exceeds the length limit.
 */
export function dedupeUniqueName(base: string, taken: ReadonlySet<string>): string {
  const free = (candidate: string) =>
    !isReservedWorkspaceName(candidate) && !taken.has(uniqueNameKey(candidate));
  if (free(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, UNIQUE_NAME_MAX_LENGTH - suffix.length) + suffix;
    if (free(candidate)) return candidate;
  }
}

/** The manifest facts migration planning needs — structural, no import cycle. */
export interface MigratableWorkspace {
  id: string;
  /** The display name (preserved as the friendly name — never rewritten). */
  name: string;
  /** Present means already migrated; the plan skips it (idempotency). */
  uniqueName?: string;
  /** ISO 8601 creation timestamp — the dedupe order (oldest keeps the bare slug). */
  created: string;
}

/**
 * PRD 020 Req 3: the migration plan — which workspaces get which unique name.
 * Pure and deterministic: manifests already carrying a unique name are
 * skipped (so a second run plans nothing), their names count as taken, and
 * the unnamed rest are processed oldest-first (ties broken by id) so the
 * workspace that has carried a display name longest keeps the unsuffixed
 * slug. The caller writes the manifests and logs each row.
 */
export function planUniqueNameMigration(
  workspaces: readonly MigratableWorkspace[],
): { id: string; uniqueName: string }[] {
  const taken = new Set<string>();
  for (const w of workspaces) {
    if (w.uniqueName) taken.add(uniqueNameKey(w.uniqueName));
  }
  const pending = workspaces
    .filter((w) => !w.uniqueName)
    .sort((a, b) => (a.created === b.created ? (a.id < b.id ? -1 : 1) : a.created < b.created ? -1 : 1));
  const plan: { id: string; uniqueName: string }[] = [];
  for (const w of pending) {
    // PRD 026 Req 2: the fallback word is the planner's, not the slugifier's.
    const uniqueName = dedupeUniqueName(slugifyWorkspaceName(w.name) || WORKSPACE_SLUG_FALLBACK, taken);
    taken.add(uniqueNameKey(uniqueName));
    plan.push({ id: w.id, uniqueName });
  }
  return plan;
}
