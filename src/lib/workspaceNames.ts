/**
 * PRD 020 Req 1+3: the workspace unique-name rules — one pure module owning
 * the charset/length validation, the case-insensitive comparison key, the
 * reserved-name list, and the slugify/dedupe machinery migration and the
 * scratchpad provisioning share. The server (`server/workspaces.ts`) enforces
 * these rules on creation and rename; the New Workspace dialog and the
 * workspace-settings rename section pre-validate with the same functions, so
 * client hints and server refusals can never disagree. No I/O, no imports
 * from the manifest module: migration planning works over a minimal
 * structural shape so this module stays leaf-level.
 */

/** PRD 020 Req 1: a unique name is 1–100 characters. */
export const UNIQUE_NAME_MAX_LENGTH = 100;

const UNIQUE_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * PRD 020 Req 1 (Req 11's reserved words): names no workspace may take —
 * `scratch`/`scratchpad` (the scratch feature's own path words) and the
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
 * PRD 020 Req 1: the format refusal a proposed unique name earns, or null
 * when it is well-formed. Format only — reserved words are a policy the
 * server (and the dialogs) layer on via `uniqueNameProblem`; manifest
 * validation uses exactly this half, so a migrated manifest is never
 * rejected for history the policy no longer allows.
 */
export function uniqueNameFormatProblem(name: string): string | null {
  if (name.length === 0) return 'A unique name is required.';
  if (name.length > UNIQUE_NAME_MAX_LENGTH) {
    return `A unique name must be at most ${UNIQUE_NAME_MAX_LENGTH} characters.`;
  }
  if (!UNIQUE_NAME_RE.test(name)) {
    return 'A unique name may only use letters, digits, and . _ - characters.';
  }
  return null;
}

/**
 * PRD 020 Req 1: the full refusal — format, then the reserved list. This is
 * what creation and rename enforce, and what the dialogs show as you type;
 * collisions need deployment state and stay the server's own check.
 */
export function uniqueNameProblem(name: string): string | null {
  const format = uniqueNameFormatProblem(name);
  if (format) return format;
  if (isReservedWorkspaceName(name)) return `"${name}" is a reserved name.`;
  return null;
}

/**
 * PRD 020 Req 3: a display name slugified into a unique-name candidate —
 * lowercased, runs of characters outside `[a-z0-9._-]` collapsed to `-`,
 * clamped to the length limit. A name with nothing usable at all (it cannot
 * be empty — manifests require a non-empty display name) still yields a
 * charset-legal base for dedupe to suffix.
 */
export function slugifyWorkspaceName(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, UNIQUE_NAME_MAX_LENGTH);
  return slug === '' ? 'workspace' : slug;
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
    const uniqueName = dedupeUniqueName(slugifyWorkspaceName(w.name), taken);
    taken.add(uniqueNameKey(uniqueName));
    plan.push({ id: w.id, uniqueName });
  }
  return plan;
}
