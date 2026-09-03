/**
 * PRD 007 Req 7+13+14: the hosted-workspace data model — the fixed permission
 * catalog, the five built-in roles, the versioned workspace-manifest JSON
 * (the hosted evolution of the local `.marky-workspace` format in
 * `workspace.ts`), and pure permission resolution. No I/O and no platform
 * imports: the server (`server/workspaces.ts`) and, later, the hosted client
 * (#73) both consume this module, so parse/serialize/validate stay pure and
 * timestamps come in as arguments.
 */

import { uniqueNameFormatProblem, uniqueNameProblem } from './workspaceNames.ts';

// --- permission catalog (PRD 007 Req 13) -------------------------------------

/**
 * PRD 007 Req 13: the fixed catalog of verbs the server enforces — exactly
 * these fourteen, nothing else. Role definitions and endpoint requirements
 * reference the `Permission` union, so an unknown verb is a type error in
 * code and a validation error in manifest data.
 */
export const PERMISSIONS = [
  'doc.read',
  'doc.edit',
  'file.create',
  'file.delete',
  'file.rename',
  'file.upload',
  'file.download',
  'folder.manage',
  'comment.read',
  'comment.write',
  'workspace.settings',
  'workspace.members',
  'workspace.roles',
  'workspace.delete',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

// --- deployment-level permissions (PRD 017 Req 2) ----------------------------

/**
 * PRD 017 Req 2: the two deployment-level permission names, beside — and
 * deliberately NOT members of — the workspace verb catalog above. Because
 * `isPermission` rejects them, no built-in or custom role can grant them
 * (manifest validation refuses unknown verbs) and the role editor, which
 * enumerates `PERMISSIONS`, never offers them. A route refusing for one uses
 * the existing 403 shape `{ error: 'forbidden', required: '<name>' }`; the
 * admin routes that consume these names arrive with PRD 017's later issues.
 */
export const DEPLOYMENT_PERMISSIONS = ['deployment.admin', 'deployment.create'] as const;

export type DeploymentPermission = (typeof DEPLOYMENT_PERMISSIONS)[number];

// --- built-in roles (PRD 007 Req 14) -----------------------------------------

export type BuiltInRoleName = 'Owner' | 'Editor' | 'Contributor' | 'Commenter' | 'Viewer';

const EDITOR_PERMISSIONS: readonly Permission[] = [
  'doc.read',
  'doc.edit',
  'file.create',
  'file.delete',
  'file.rename',
  'file.upload',
  'file.download',
  'folder.manage',
  'comment.read',
  'comment.write',
];

/**
 * PRD 007 Req 14: the five built-in roles as named permission sets — Owner
 * all fourteen, Editor all doc/file/folder/comment verbs, Contributor is
 * Editor minus `file.delete`/`file.rename`/`folder.manage`, Commenter and
 * Viewer the read-and-comment tail. Built-ins live here in code, never in a
 * manifest, which is what makes them uneditable and undeletable: manifest
 * validation rejects a custom role using a built-in name, and the role
 * mutation helpers below refuse built-in targets.
 */
export const BUILT_IN_ROLES: Readonly<Record<BuiltInRoleName, readonly Permission[]>> = {
  Owner: PERMISSIONS,
  Editor: EDITOR_PERMISSIONS,
  Contributor: EDITOR_PERMISSIONS.filter(
    (p) => p !== 'file.delete' && p !== 'file.rename' && p !== 'folder.manage'
  ),
  Commenter: ['doc.read', 'file.download', 'comment.read', 'comment.write'],
  Viewer: ['doc.read', 'file.download', 'comment.read'],
};

export function isBuiltInRoleName(name: string): name is BuiltInRoleName {
  return Object.prototype.hasOwnProperty.call(BUILT_IN_ROLES, name);
}

// --- the workspace manifest (PRD 007 Req 7) ----------------------------------

/** The one schema version this build reads and writes. */
export const MANIFEST_VERSION = 1;

export interface WorkspaceMember {
  /** The auth provider's stable user id (Entra object id / mock id). */
  id: string;
  /** A role name: built-in or a custom role defined in the same manifest. */
  role: string;
  /**
   * PRD 007 Req 6 (issue #180): the display name known when the member was
   * added — the fallback `resolveMembers` renders when the directory cannot
   * answer (Graph unreachable, user left the tenant). Absent in manifests
   * written before this field existed; never authoritative while the
   * directory still resolves the id.
   */
  displayName?: string;
}

/** A custom role: a named subset of the permission catalog (PRD 007 Req 15). */
export interface CustomRole {
  name: string;
  permissions: Permission[];
}

/** Everyone-in-tenant access: off, or on with a default role (PRD 007 Req 16). */
export interface EveryoneAccess {
  enabled: boolean;
  /** Role for signed-in non-members while enabled; `DEFAULT_EVERYONE_ROLE`. */
  role: string;
}

/**
 * PRD 007 Req 16: what everyone-access grants until a role is named — the
 * least-privileged built-in. One constant for the whole flavor: the server
 * stamps it on a create request that omits the role, and the New Workspace
 * form starts its picker there, so the two can never drift apart.
 */
export const DEFAULT_EVERYONE_ROLE: BuiltInRoleName = 'Viewer';

/**
 * PRD 007 Req 7: the workspace manifest — the versioned JSON evolution of
 * the local `.marky-workspace` format (`WorkspaceFileData` in
 * `workspace.ts`). It keeps that format's `version` and `settings` slots;
 * the `folders` list is gone (the workspace IS its blob prefix) and the
 * hosted-only fields (name, timestamps, members, roles, everyone-access)
 * are new. One manifest blob per workspace; no database.
 */
export interface WorkspaceManifest {
  version: typeof MANIFEST_VERSION;
  name: string;
  /**
   * PRD 020 Req 1: the workspace's deployment-unique name (1–100 chars from
   * `[A-Za-z0-9._-]`, unique case-insensitively) — the identity URLs will be
   * built from, beside the free-text display `name` above. Optional like the
   * `scratchpad` marker: manifests written before the field existed parse
   * unchanged, and the Req 3 migration is what fills it in.
   */
  uniqueName?: string;
  /** ISO 8601 creation timestamp; preserved across updates. */
  created: string;
  /** ISO 8601 last-manifest-update timestamp. */
  modified: string;
  members: WorkspaceMember[];
  /** Custom role definitions; built-ins are code, never listed here. */
  roles: CustomRole[];
  everyone: EveryoneAccess;
  /** Workspace-scoped settings — the PRD 002 Workspace layer slot. */
  settings: Record<string, unknown>;
  /**
   * PRD 019 Req 8: marks the personal scratchpad workspace, stamped once at
   * provisioning. Absent on every regular workspace — manifests written
   * before the field existed parse unchanged — and it is what the listing
   * and delete routes read to special-case a scratchpad without an extra
   * blob read per row.
   */
  scratchpad?: true;
}

export type ManifestResult =
  | { ok: true; manifest: WorkspaceManifest }
  | { ok: false; error: string };

const fail = (error: string): ManifestResult => ({ ok: false, error });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isIsoTimestamp = (v: unknown): v is string =>
  isNonEmptyString(v) && !Number.isNaN(Date.parse(v));

/**
 * PRD 007 Req 7: validate untrusted manifest data. An unsupported schema
 * version or a malformed field is rejected with an error naming the problem
 * — never silently coerced (deliberately unlike the corruption-tolerant
 * local `parseWorkspaceFile`, because a hosted manifest is the permission
 * source of truth, and "sane empty" here would mean dropped members).
 */
export function validateWorkspaceManifest(data: unknown): ManifestResult {
  if (!isPlainObject(data)) return fail('manifest must be a JSON object');
  if (data.version !== MANIFEST_VERSION) {
    return fail(`unsupported manifest version ${JSON.stringify(data.version)} (this build reads version ${MANIFEST_VERSION})`);
  }
  const { name, created, modified, everyone, settings } = data;
  if (!isNonEmptyString(name)) return fail('manifest name must be a non-empty string');
  // PRD 020 Req 1: the unique name is optional (pre-migration manifests still
  // parse) but a present one must be well-formed. Format only here — reserved
  // words and collisions are creation/rename policy, not manifest shape.
  let uniqueName: string | undefined;
  if (data.uniqueName !== undefined) {
    if (typeof data.uniqueName !== 'string') return fail('manifest uniqueName must be a string');
    const problem = uniqueNameFormatProblem(data.uniqueName);
    if (problem) return fail(`manifest uniqueName is invalid: ${problem}`);
    uniqueName = data.uniqueName;
  }
  if (!isIsoTimestamp(created)) return fail('manifest created must be an ISO 8601 timestamp');
  if (!isIsoTimestamp(modified)) return fail('manifest modified must be an ISO 8601 timestamp');

  if (!Array.isArray(data.members)) return fail('manifest members must be an array');
  const members: WorkspaceMember[] = [];
  const memberIds = new Set<string>();
  for (const m of data.members as unknown[]) {
    if (!isPlainObject(m) || !isNonEmptyString(m.id) || !isNonEmptyString(m.role)) {
      return fail('each member must be {id, role} with non-empty strings');
    }
    // Issue #180: the display-name snapshot is optional — manifests written
    // before it existed parse unchanged — but a present one must be a
    // non-empty string, never silently coerced.
    if (m.displayName !== undefined && !isNonEmptyString(m.displayName)) {
      return fail('member displayName must be a non-empty string when present');
    }
    // A role NAME that resolves to nothing stays valid (resolution fails
    // closed); a duplicate member id is a malformed manifest, not a policy.
    if (memberIds.has(m.id)) return fail(`duplicate member id ${JSON.stringify(m.id)}`);
    memberIds.add(m.id);
    members.push({ id: m.id, role: m.role, ...(m.displayName !== undefined ? { displayName: m.displayName } : {}) });
  }

  if (!Array.isArray(data.roles)) return fail('manifest roles must be an array');
  const roles: CustomRole[] = [];
  const roleNames = new Set<string>();
  for (const r of data.roles as unknown[]) {
    if (!isPlainObject(r) || !isNonEmptyString(r.name) || !Array.isArray(r.permissions)) {
      return fail('each custom role must be {name, permissions[]}');
    }
    // PRD 007 Req 14: a custom role cannot shadow a built-in name — that
    // would amount to editing the built-in.
    if (isBuiltInRoleName(r.name)) {
      return fail(`custom role ${JSON.stringify(r.name)} shadows a built-in role`);
    }
    if (roleNames.has(r.name)) return fail(`duplicate custom role ${JSON.stringify(r.name)}`);
    roleNames.add(r.name);
    const permissions: Permission[] = [];
    for (const p of r.permissions as unknown[]) {
      // PRD 007 Req 13: only catalog verbs exist — an unknown verb is an
      // error, not a typo that passes.
      if (!isPermission(p)) return fail(`unknown permission ${JSON.stringify(p)} in role ${JSON.stringify(r.name)}`);
      permissions.push(p);
    }
    roles.push({ name: r.name, permissions });
  }

  if (!isPlainObject(everyone) || typeof everyone.enabled !== 'boolean' || !isNonEmptyString(everyone.role)) {
    return fail('manifest everyone must be {enabled: boolean, role: string}');
  }
  if (!isPlainObject(settings)) return fail('manifest settings must be an object');

  // PRD 019 Req 8: the scratchpad marker is optional — absent on every
  // regular manifest, which stays the common case — but a present one must
  // be literally `true`, never a truthy stand-in silently coerced.
  if (data.scratchpad !== undefined && data.scratchpad !== true) {
    return fail('manifest scratchpad must be true when present');
  }

  return {
    ok: true,
    manifest: {
      version: MANIFEST_VERSION,
      name,
      ...(uniqueName !== undefined ? { uniqueName } : {}),
      created,
      modified,
      members,
      roles,
      everyone: { enabled: everyone.enabled, role: everyone.role },
      settings: { ...settings },
      ...(data.scratchpad === true ? { scratchpad: true as const } : {}),
    },
  };
}

/** Parse manifest JSON text; malformed JSON is an error like any other. */
export function parseWorkspaceManifest(json: string): ManifestResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return fail('manifest is not valid JSON');
  }
  return validateWorkspaceManifest(data);
}

export function serializeWorkspaceManifest(manifest: WorkspaceManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * PRD 007 Req 10: a fresh manifest with the creator as the sole member,
 * role Owner, and everyone-access off (default role Viewer, per Req 16).
 */
export function createWorkspaceManifest(name: string, creatorId: string, nowIso: string): WorkspaceManifest {
  return {
    version: MANIFEST_VERSION,
    name,
    created: nowIso,
    modified: nowIso,
    members: [{ id: creatorId, role: 'Owner' }],
    roles: [],
    everyone: { enabled: false, role: DEFAULT_EVERYONE_ROLE },
    settings: {},
  };
}

/**
 * PRD 007 Req 10: is `name` a role this manifest can grant — one of the five
 * built-ins, or one of its own custom roles? Membership grants are validated
 * against exactly this set, so a typo is a 400 rather than a member who
 * silently resolves to no permissions at all.
 */
export function isKnownRoleName(manifest: WorkspaceManifest, name: string): boolean {
  return isBuiltInRoleName(name) || manifest.roles.some((r) => r.name === name);
}

/** PRD 007 Req 10: the create-workspace request body, as the API accepts it. */
export interface CreateWorkspaceRequest {
  name: string;
  /**
   * PRD 020 Req 2: the deployment-unique name chosen up front. Optional at
   * the API so pre-#219 callers keep working (their workspaces get one from
   * the Req 3 migration); the New Workspace dialog always sends it.
   */
  uniqueName?: string;
  /** Initial members besides the creator; the creator is always Owner. */
  members?: WorkspaceMember[];
  /** Everyone-in-tenant access; `role` defaults to Viewer (Req 16). */
  everyone?: { enabled: boolean; role?: string };
}

/**
 * PRD 007 Req 10+16: build the manifest a create request asks for. The
 * creator is retained as Owner no matter what the body says — an initial
 * grant naming the creator is folded into that one Owner entry, so nobody
 * can create a workspace they cannot administer. Role names are validated
 * against the manifest's own grantable set (built-ins plus its custom roles,
 * which a fresh workspace has none of); everyone-access defaults to Viewer.
 * Pure: the server passes the clock in, and unit tests pass a fixed one.
 */
export function buildNewWorkspaceManifest(
  body: unknown,
  creatorId: string,
  nowIso: string,
): ManifestResult {
  if (!isPlainObject(body)) return fail('request body must be a JSON object');
  // Untrusted fields stay `unknown` until each check narrows them — the same
  // shape-by-shape discipline validateWorkspaceManifest applies above.
  const { name, uniqueName, members, everyone } = body;
  // PRD 020 Req 1+2: a provided unique name must be well-formed and not
  // reserved — the stateless half of creation's enforcement; the collision
  // check needs deployment state and lives with the route.
  if (uniqueName !== undefined) {
    if (typeof uniqueName !== 'string') return fail('uniqueName must be a string');
    const problem = uniqueNameProblem(uniqueName);
    if (problem) return fail(problem);
  }
  // PRD 020 Req 2: the friendly display name is optional when a unique name
  // is given — unset means the unique name IS the display.
  let display = typeof name === 'string' ? name.trim() : '';
  if (display === '' && typeof uniqueName === 'string') display = uniqueName;
  if (display === '') return fail('name must be a non-empty string');
  const manifest = createWorkspaceManifest(display, creatorId, nowIso);
  if (typeof uniqueName === 'string') manifest.uniqueName = uniqueName;

  if (members !== undefined) {
    if (!Array.isArray(members)) return fail('members must be an array');
    const seen = new Set<string>([creatorId]);
    for (const m of members as unknown[]) {
      if (!isPlainObject(m) || !isNonEmptyString(m.id) || !isNonEmptyString(m.role)) {
        return fail('each member must be {id, role} with non-empty strings');
      }
      if (!isKnownRoleName(manifest, m.role)) return fail(`unknown role ${JSON.stringify(m.role)}`);
      // The creator stays Owner: a body entry for them is absorbed, never a
      // demotion and never a duplicate id in the stored manifest.
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      manifest.members.push({ id: m.id, role: m.role });
    }
  }

  if (everyone !== undefined) {
    if (!isPlainObject(everyone) || typeof everyone.enabled !== 'boolean') {
      return fail('everyone must be {enabled: boolean, role?: string}');
    }
    const role = everyone.role === undefined ? DEFAULT_EVERYONE_ROLE : everyone.role;
    if (!isNonEmptyString(role) || !isKnownRoleName(manifest, role)) {
      return fail(`unknown role ${JSON.stringify(everyone.role)}`);
    }
    manifest.everyone = { enabled: everyone.enabled, role };
  }

  return { ok: true, manifest };
}

/**
 * PRD 020 Req 2: the friendly name as a separate fact — `name` is what chrome
 * displays either way, but the rename UI needs "is a friendly name set" to
 * pre-fill its optional field. Unset is stored as `name === uniqueName` (the
 * unique name is the display), so that equality reads back as null here.
 */
export function friendlyNameOf(manifest: Pick<WorkspaceManifest, 'name' | 'uniqueName'>): string | null {
  return manifest.uniqueName !== undefined && manifest.name === manifest.uniqueName ? null : manifest.name;
}

/**
 * PRD 007 Req 11: who to ask for access to this workspace. The Owner-role
 * members, and — for a workspace whose ownership only exists through a custom
 * role — anyone holding `workspace.members`, so the no-access message always
 * names someone who can actually grant it. Ids, resolved to display names by
 * the caller.
 */
export function workspaceOwnerIds(manifest: WorkspaceManifest): string[] {
  const owners = manifest.members.filter((m) => m.role === 'Owner').map((m) => m.id);
  if (owners.length > 0) return owners;
  return manifest.members
    .filter((m) => permissionsOfRole(manifest, m.role).has('workspace.members'))
    .map((m) => m.id);
}

// --- membership mutations (PRD 007 Req 16) -----------------------------------

/**
 * PRD 007 Req 16: the one role a workspace can never be left without. Named
 * once here so the invariant reads the same in every helper below — "Owner"
 * means the built-in role by that name, not "whoever holds admin verbs".
 */
export const OWNER_ROLE: BuiltInRoleName = 'Owner';

/** The refusal every membership edit shares, phrased for the UI and the API. */
const LAST_OWNER_ERROR = 'a workspace must keep at least one Owner';

/** True when `id` is the only Owner-role member — the one nobody may unseat. */
function isLastOwner(manifest: WorkspaceManifest, id: string): boolean {
  const owners = manifest.members.filter((m) => m.role === OWNER_ROLE);
  return owners.length === 1 && owners[0].id === id;
}

/**
 * PRD 007 Req 15+16: every role name this manifest can grant, in the order a
 * picker should offer them — the five built-ins first, then the workspace's
 * own custom roles. One list for the member role select and the everyone-role
 * select, so a freshly created custom role is grantable immediately.
 */
export function grantableRoleNames(manifest: WorkspaceManifest): string[] {
  return [...Object.keys(BUILT_IN_ROLES), ...manifest.roles.map((r) => r.name)];
}

/**
 * PRD 007 Req 16: add one member. The role must be one this manifest can
 * grant (400 rather than a member who silently resolves to nothing), and an
 * id already on the list is a refusal — a second grant would be the duplicate
 * `validateWorkspaceManifest` rejects.
 */
export function addWorkspaceMember(manifest: WorkspaceManifest, member: WorkspaceMember): ManifestResult {
  const id = member.id.trim();
  if (!id) return fail('member id must be a non-empty string');
  if (manifest.members.some((m) => m.id === id)) return fail(`${JSON.stringify(id)} is already a member`);
  if (!isKnownRoleName(manifest, member.role)) return fail(`unknown role ${JSON.stringify(member.role)}`);
  // Issue #180: the display-name snapshot rides along when the caller has
  // one (the server stamps it from the directory at add time).
  const added: WorkspaceMember = {
    id,
    role: member.role,
    ...(member.displayName ? { displayName: member.displayName } : {}),
  };
  return { ok: true, manifest: { ...manifest, members: [...manifest.members, added] } };
}

/**
 * PRD 007 Req 16: remove one member — unless they are the last Owner, which
 * would leave the workspace with nobody able to administer it.
 */
export function removeWorkspaceMember(manifest: WorkspaceManifest, id: string): ManifestResult {
  if (!manifest.members.some((m) => m.id === id)) return fail(`${JSON.stringify(id)} is not a member`);
  if (isLastOwner(manifest, id)) return fail(LAST_OWNER_ERROR);
  return { ok: true, manifest: { ...manifest, members: manifest.members.filter((m) => m.id !== id) } };
}

/**
 * Issue #193: scrub a rescinded invitee from the member list,
 * unconditionally — unlike removeWorkspaceMember, the last-Owner invariant
 * does not apply, because the deleted user cannot administer anything and
 * the alternative is a manifest carrying a member id the directory can no
 * longer resolve. Null when the id holds no membership (nothing to write).
 */
export function scrubWorkspaceMember(manifest: WorkspaceManifest, id: string): WorkspaceManifest | null {
  if (!manifest.members.some((m) => m.id === id)) return null;
  return { ...manifest, members: manifest.members.filter((m) => m.id !== id) };
}

/**
 * PRD 007 Req 16: change one member's role. The same last-Owner invariant
 * applies: demoting the sole Owner is refused exactly like removing them —
 * the two are the same act with different spellings.
 */
export function setWorkspaceMemberRole(
  manifest: WorkspaceManifest,
  id: string,
  role: string,
): ManifestResult {
  if (!manifest.members.some((m) => m.id === id)) return fail(`${JSON.stringify(id)} is not a member`);
  if (!isKnownRoleName(manifest, role)) return fail(`unknown role ${JSON.stringify(role)}`);
  if (role !== OWNER_ROLE && isLastOwner(manifest, id)) return fail(LAST_OWNER_ERROR);
  return {
    ok: true,
    // Issue #180: a role change keeps the member's display-name snapshot.
    manifest: { ...manifest, members: manifest.members.map((m) => (m.id === id ? { ...m, role } : m)) },
  };
}

/**
 * PRD 007 Req 16: toggle everyone-in-tenant access and the role it grants.
 * Omitting the role keeps the one already stored (a fresh manifest starts at
 * `DEFAULT_EVERYONE_ROLE`), so turning access on twice never silently
 * re-lowers a role the Owner raised.
 */
export function setEveryoneAccess(
  manifest: WorkspaceManifest,
  everyone: { enabled: boolean; role?: string },
): ManifestResult {
  const role = everyone.role === undefined ? manifest.everyone.role : everyone.role;
  if (!isKnownRoleName(manifest, role)) return fail(`unknown role ${JSON.stringify(role)}`);
  return { ok: true, manifest: { ...manifest, everyone: { enabled: everyone.enabled, role } } };
}

// --- custom-role mutations (PRD 007 Req 14+15) -------------------------------

/** A custom-role edit as the API accepts it: the verbs arrive untrusted. */
export interface CustomRoleInput {
  name: string;
  permissions: readonly string[];
}

/**
 * PRD 007 Req 15: who still holds a role — member ids, and whether
 * everyone-access grants it. Non-empty means deleting the role would strip a
 * live grant, which is exactly what `removeCustomRole` refuses.
 */
export interface CustomRoleUsage {
  members: string[];
  everyone: boolean;
}

export function customRoleUsage(manifest: WorkspaceManifest, name: string): CustomRoleUsage {
  return {
    members: manifest.members.filter((m) => m.role === name).map((m) => m.id),
    everyone: manifest.everyone.enabled && manifest.everyone.role === name,
  };
}

export function isCustomRoleInUse(manifest: WorkspaceManifest, name: string): boolean {
  const usage = customRoleUsage(manifest, name);
  return usage.members.length > 0 || usage.everyone;
}

/** "2 members", "everyone-access", "1 member and everyone-access". */
function describeUsage(usage: CustomRoleUsage): string {
  const parts: string[] = [];
  if (usage.members.length > 0) {
    parts.push(`${usage.members.length} member${usage.members.length === 1 ? '' : 's'}`);
  }
  if (usage.everyone) parts.push('everyone-access');
  return parts.join(' and ');
}

/**
 * The refusal a proposed custom-role name earns, or null when it is usable:
 * blank, slash-bearing (a role name addresses its own endpoint path segment),
 * shadowing a built-in, or already taken by another custom role. `replacing`
 * is the name being renamed away from, which never counts as taken.
 */
function customRoleNameProblem(
  manifest: WorkspaceManifest,
  name: string,
  replacing?: string,
): string | null {
  if (!name) return 'role name must not be empty';
  if (name.includes('/')) return `role name ${JSON.stringify(name)} must not contain "/"`;
  if (isBuiltInRoleName(name)) return `built-in role ${JSON.stringify(name)} cannot be edited or shadowed`;
  if (manifest.roles.some((r) => r.name === name && r.name !== replacing)) {
    return `custom role ${JSON.stringify(name)} already exists`;
  }
  return null;
}

/** Narrow untrusted verb strings to catalog permissions, or name the bad one. */
function readPermissions(names: readonly string[], roleName: string): Permission[] | string {
  const permissions: Permission[] = [];
  for (const p of names) {
    if (!isPermission(p)) return `unknown permission ${JSON.stringify(p)} in role ${JSON.stringify(roleName)}`;
    permissions.push(p);
  }
  return permissions;
}

/**
 * Add or redefine a custom role. Refuses built-in names: built-ins are not
 * editable, and creating a same-named custom role would shadow one.
 */
export function upsertCustomRole(manifest: WorkspaceManifest, role: CustomRole): ManifestResult {
  if (isBuiltInRoleName(role.name)) {
    return fail(`built-in role ${JSON.stringify(role.name)} cannot be edited or shadowed`);
  }
  if (!role.permissions.every(isPermission)) return fail('role permissions must come from the catalog');
  const roles = manifest.roles.filter((r) => r.name !== role.name);
  return { ok: true, manifest: { ...manifest, roles: [...roles, { name: role.name, permissions: [...role.permissions] }] } };
}

/**
 * PRD 007 Req 15: create a new custom role as a named subset of the catalog.
 * Unlike `upsertCustomRole` this never redefines an existing role — a name
 * already in use is a refusal, so "create" cannot silently overwrite the
 * permission set members already hold.
 */
export function createCustomRole(manifest: WorkspaceManifest, role: CustomRoleInput): ManifestResult {
  const name = role.name.trim();
  const problem = customRoleNameProblem(manifest, name);
  if (problem) return fail(problem);
  const permissions = readPermissions(role.permissions, name);
  if (typeof permissions === 'string') return fail(permissions);
  return { ok: true, manifest: { ...manifest, roles: [...manifest.roles, { name, permissions }] } };
}

/**
 * PRD 007 Req 15: rename and/or re-scope one custom role. Members holding the
 * old name — and an everyone-access grant naming it — carry over to the new
 * name in the SAME update, so a rename never silently drops anyone to a role
 * that resolves to no permissions.
 */
export function updateCustomRole(
  manifest: WorkspaceManifest,
  currentName: string,
  next: CustomRoleInput,
): ManifestResult {
  if (isBuiltInRoleName(currentName)) {
    return fail(`built-in role ${JSON.stringify(currentName)} cannot be edited or shadowed`);
  }
  if (!manifest.roles.some((r) => r.name === currentName)) {
    return fail(`no custom role ${JSON.stringify(currentName)}`);
  }
  const name = next.name.trim();
  const problem = customRoleNameProblem(manifest, name, currentName);
  if (problem) return fail(problem);
  const permissions = readPermissions(next.permissions, name);
  if (typeof permissions === 'string') return fail(permissions);
  return {
    ok: true,
    manifest: {
      ...manifest,
      members: manifest.members.map((m) => (m.role === currentName ? { ...m, role: name } : m)),
      roles: manifest.roles.map((r) => (r.name === currentName ? { name, permissions } : r)),
      everyone:
        manifest.everyone.role === currentName ? { ...manifest.everyone, role: name } : manifest.everyone,
    },
  };
}

/**
 * Remove a custom role. Refuses built-in names: built-ins are not deletable.
 * PRD 007 Req 15: a role any member still holds — or one everyone-access is
 * currently granting — is refused too, naming the role: deleting it would
 * silently strip a live grant rather than being an edit anyone asked for.
 */
export function removeCustomRole(manifest: WorkspaceManifest, name: string): ManifestResult {
  if (isBuiltInRoleName(name)) {
    return fail(`built-in role ${JSON.stringify(name)} cannot be deleted`);
  }
  if (!manifest.roles.some((r) => r.name === name)) return fail(`no custom role ${JSON.stringify(name)}`);
  const usage = customRoleUsage(manifest, name);
  if (usage.members.length > 0 || usage.everyone) {
    return fail(`custom role ${JSON.stringify(name)} is still in use by ${describeUsage(usage)}`);
  }
  return { ok: true, manifest: { ...manifest, roles: manifest.roles.filter((r) => r.name !== name) } };
}

// --- permission resolution (PRD 007 Req 13+16) -------------------------------

const NO_PERMISSIONS: ReadonlySet<Permission> = new Set();

/** A role name → its permission set: built-in first, else custom, else nothing. */
function permissionsOfRole(manifest: WorkspaceManifest, roleName: string): ReadonlySet<Permission> {
  if (isBuiltInRoleName(roleName)) return new Set(BUILT_IN_ROLES[roleName]);
  const custom = manifest.roles.find((r) => r.name === roleName);
  return custom ? new Set(custom.permissions) : NO_PERMISSIONS;
}

/**
 * PRD 017 Req 4: the verbs a deployment admin holds implicitly in every
 * workspace — read plus administer, never write. Exactly these seven: no
 * other verb (`doc.edit`, the `file.create/delete/rename/upload` writes,
 * `folder.manage`, `comment.write`) is ever implicit.
 */
export const ADMIN_IMPLICIT_PERMISSIONS: readonly Permission[] = [
  'doc.read',
  'file.download',
  'comment.read',
  'workspace.settings',
  'workspace.members',
  'workspace.roles',
  'workspace.delete',
];

/**
 * PRD 007 Req 13+16: resolve a user's permissions from the manifest.
 * Explicit membership wins over the everyone-role (even when the member's
 * role name resolves to nothing — an unknown role fails closed rather than
 * falling back); a signed-in non-member gets the everyone default role when
 * everyone-access is on, and nothing at all when it is off.
 *
 * PRD 017 Req 4: a deployment admin additionally holds the implicit set
 * above as a union with whatever the manifest grants — never an override,
 * so an admin who is also an Owner keeps full Owner permissions. This is
 * the single resolution path (`requirePermission` and the listing on the
 * server, refusal prediction on the client), which is what makes every
 * route inherit the union with no per-route change. Callers that cannot
 * know admin status — historic fixtures, tests about non-admins — omit the
 * flag and resolve as non-admin; the client passes `/api/me`'s `admin`
 * (issue #189), so its prediction matches the server's resolution.
 */
export function resolvePermissions(
  manifest: WorkspaceManifest,
  userId: string,
  isAdmin = false,
): ReadonlySet<Permission> {
  const member = manifest.members.find((m) => m.id === userId);
  let granted: ReadonlySet<Permission>;
  if (member) granted = permissionsOfRole(manifest, member.role);
  else if (manifest.everyone.enabled) granted = permissionsOfRole(manifest, manifest.everyone.role);
  else granted = NO_PERMISSIONS;
  if (!isAdmin) return granted;
  return new Set([...granted, ...ADMIN_IMPLICIT_PERMISSIONS]);
}

/**
 * PRD 017 Req 5: whether the admin banner shows — the signed-in user is a
 * deployment admin (`/api/me` says `admin: true`) AND the bound workspace's
 * manifest grants them nothing of its own: no explicit membership and no
 * everyone-access. They are viewing purely through the Req 4 implicit union
 * above, and the banner says so. The moment they hold a role — e.g. after
 * adding themselves as Owner in People — this turns false and the banner
 * disappears; a non-admin is never shown it, whatever the manifest says.
 */
export function isViewingAsAdminOnly(
  manifest: WorkspaceManifest,
  me: { id: string; admin: boolean },
): boolean {
  if (!me.admin) return false;
  if (manifest.members.some((m) => m.id === me.id)) return false;
  return !manifest.everyone.enabled;
}
