/**
 * PRD 017 Req 6: the deployment-settings record — who may create workspaces
 * and who may see the directory listing — stored at
 * `deployment/settings.json`, the only blob under the reserved `deployment/`
 * prefix. Parser, serializer and the two policy decisions are pure functions
 * here so the server enforces and the client predicts with the SAME rules
 * (the hostedWorkspace.ts pattern). No I/O, no DOM.
 */

/** PRD 017 Req 6: the reserved prefix nothing but the settings record lives under. */
export const DEPLOYMENT_PREFIX = 'deployment/';

/** PRD 017 Req 6: the one blob under the reserved prefix. */
export const DEPLOYMENT_SETTINGS_BLOB = `${DEPLOYMENT_PREFIX}settings.json`;

export type CreationPolicy = 'everyone' | 'members' | 'restricted';
export type ListingPolicy = 'everyone' | 'members';

/**
 * PRD 017 Req 6: one allow-list row — keyed by the provider's stable user id
 * (like workspace membership, never an email/UPN), with the issue #180
 * display-name snapshot taken when an admin adds the entry.
 */
export interface CreationAllowEntry {
  id: string;
  displayName?: string;
}

const SETTINGS_VERSION = 1;

/** PRD 017 Req 6: the version-1 record, exactly as stored. */
export interface DeploymentSettings {
  version: typeof SETTINGS_VERSION;
  creation: { policy: CreationPolicy; allow: CreationAllowEntry[] };
  listing: { policy: ListingPolicy };
}

/**
 * PRD 017 Req 6: what an ABSENT blob means — today's behaviour exactly
 * (PRD 007 Reqs 10–11: anyone signed-in creates, everyone lists), so an
 * upgraded deployment changes nothing until an admin edits the policies.
 */
export const DEFAULT_DEPLOYMENT_SETTINGS: DeploymentSettings = {
  version: SETTINGS_VERSION,
  creation: { policy: 'everyone', allow: [] },
  listing: { policy: 'everyone' },
};

/**
 * PRD 017 Req 7: what a PRESENT-but-unreadable blob means — the most
 * restrictive of every policy, until an admin rewrites the record. A record
 * an operator deliberately tightened must never fall open because it stopped
 * parsing.
 */
export const FAIL_CLOSED_DEPLOYMENT_SETTINGS: DeploymentSettings = {
  version: SETTINGS_VERSION,
  creation: { policy: 'restricted', allow: [] },
  listing: { policy: 'members' },
};

export type DeploymentSettingsResult =
  | { ok: true; settings: DeploymentSettings }
  | { ok: false; error: string };

const fail = (error: string): DeploymentSettingsResult => ({ ok: false, error });

const CREATION_POLICIES: readonly CreationPolicy[] = ['everyone', 'members', 'restricted'];
const LISTING_POLICIES: readonly ListingPolicy[] = ['everyone', 'members'];

/** The allow list, validated row by row, or null when any row is not one. */
function readAllowList(raw: unknown): CreationAllowEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CreationAllowEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { id, displayName } = entry as { id?: unknown; displayName?: unknown };
    if (typeof id !== 'string' || id === '') return null;
    if (displayName !== undefined && typeof displayName !== 'string') return null;
    out.push(displayName === undefined ? { id } : { id, displayName });
  }
  return out;
}

/**
 * PRD 017 Req 6+7: parse the stored record. Strict on purpose — bad JSON, a
 * non-object, an unknown version, an unknown policy value or a malformed
 * allow row all refuse with a named error, and the CALLER decides what a
 * refusal means (the server fails closed via `effectiveDeploymentSettings`;
 * the Management editor will show the error and offer a save-over).
 */
export function parseDeploymentSettings(json: string): DeploymentSettingsResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return fail('deployment settings are not valid JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return fail('deployment settings must be a JSON object');
  }
  const { version, creation, listing } = data as {
    version?: unknown;
    creation?: unknown;
    listing?: unknown;
  };
  if (version !== SETTINGS_VERSION) {
    return fail(`unknown deployment settings version: ${JSON.stringify(version)}`);
  }
  const creationRaw = (creation ?? {}) as { policy?: unknown; allow?: unknown };
  if (!CREATION_POLICIES.includes(creationRaw.policy as CreationPolicy)) {
    return fail(`unknown creation policy: ${JSON.stringify(creationRaw.policy)}`);
  }
  const allow = readAllowList(creationRaw.allow ?? []);
  if (!allow) return fail('creation.allow must be a list of {id, displayName?} entries');
  const listingRaw = (listing ?? {}) as { policy?: unknown };
  if (!LISTING_POLICIES.includes(listingRaw.policy as ListingPolicy)) {
    return fail(`unknown listing policy: ${JSON.stringify(listingRaw.policy)}`);
  }
  return {
    ok: true,
    settings: {
      version: SETTINGS_VERSION,
      creation: { policy: creationRaw.policy as CreationPolicy, allow },
      listing: { policy: listingRaw.policy as ListingPolicy },
    },
  };
}

export function serializeDeploymentSettings(settings: DeploymentSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * PRD 017 Req 7: the parse outcome the routes act on. `error` present means
 * the stored blob exists but is unreadable — the settings alongside it are
 * then the fail-closed set, and `GET /api/admin/settings` (the Management
 * sub-issue) reports the error so an admin can save over it. Regular users
 * only ever see the effects; never a 500.
 */
export interface EffectiveDeploymentSettings {
  settings: DeploymentSettings;
  error?: string;
}

/** PRD 017 Req 6+7: absent blob → defaults; unreadable blob → fail closed. */
export function effectiveDeploymentSettings(stored: string | null): EffectiveDeploymentSettings {
  if (stored === null) return { settings: DEFAULT_DEPLOYMENT_SETTINGS };
  const parsed = parseDeploymentSettings(stored);
  if (!parsed.ok) return { settings: FAIL_CLOSED_DEPLOYMENT_SETTINGS, error: parsed.error };
  return { settings: parsed.settings };
}

/** PRD 017 Req 3: why creation is refused — the word the client hints from. */
export type CreateRefusal = 'guest' | 'restricted';

export type CreationDecision = { allowed: true } | { allowed: false; refusal: CreateRefusal };

/**
 * PRD 017 Req 8: the creation policy, decided from facts the server resolved
 * — `everyone`: any signed-in user; `members`: tenant members but not guests
 * (Req 9 resolves `guest`, failing closed when the directory cannot answer);
 * `restricted`: only ids in the allow list. Admins create under EVERY policy.
 */
export function decideWorkspaceCreation(
  settings: DeploymentSettings,
  caller: { id: string; admin: boolean; guest: boolean },
): CreationDecision {
  if (caller.admin) return { allowed: true };
  const { policy, allow } = settings.creation;
  if (policy === 'everyone') return { allowed: true };
  if (policy === 'members') {
    return caller.guest ? { allowed: false, refusal: 'guest' } : { allowed: true };
  }
  return allow.some((entry) => entry.id === caller.id)
    ? { allowed: true }
    : { allowed: false, refusal: 'restricted' };
}

/**
 * PRD 017 Req 11: the listing policy — under `members` every row whose
 * `access` is false for the caller is omitted (row shape untouched), so the
 * Req 12 no-access message can never arise there; under `everyone` the
 * listing is exactly today's. Callers pass `access` resolved WITHOUT the
 * Req 4 admin union: admins get the same filtered listing as anyone else —
 * cross-membership browsing lives in Management only.
 */
export function filterListedWorkspaces<T extends { access: boolean }>(
  policy: ListingPolicy,
  rows: readonly T[],
): T[] {
  return policy === 'members' ? rows.filter((row) => row.access) : [...rows];
}

/**
 * PRD 017 Req 10: the one-line hint under the disabled start-page action,
 * worded from the server's `createRefusal` — shared so the client renders
 * exactly what the tests assert.
 */
export const CREATE_REFUSAL_HINTS: Record<CreateRefusal, string> = {
  restricted: 'Workspace creation is limited in this deployment — a deployment admin can grant it.',
  guest: 'Guests cannot create workspaces here.',
};

/**
 * PRD 017 Req 3: what `GET /api/me` answers — the bare user plus the
 * deployment facts the client renders affordances from. `createRefusal` is
 * present exactly when `canCreateWorkspaces` is false.
 */
export interface SessionMe {
  id: string;
  username: string;
  displayName: string;
  /**
   * PRD 020 Req 12: the user's assigned URL segment — their scratch URL is
   * `/<handle>/scratch`. Distinct from `username`, which is the UPN.
   */
  handle: string;
  admin: boolean;
  canCreateWorkspaces: boolean;
  createRefusal?: CreateRefusal;
}
