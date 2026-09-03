// PRD 007 Req 7: the workspace-scoped API. Each workspace is a per-workspace
// prefix in the blob container — `workspaces/<id>/manifest.json` (the
// manifest) plus `workspaces/<id>/files/<path>` (its documents and assets).
// Nothing else stores workspace state: no database, no server-local files.
// The manifest sits OUTSIDE the `files/` prefix, so workspace file listings
// never surface it.
// PRD 007 Req 13+17: every endpoint here declares exactly one required
// permission from the catalog (typed — see `required: Permission` below) and
// answers 403, after the 401 auth guard in app.ts, when the caller's
// resolved permissions lack it. The endpoint→permission table lives in
// server/README.md.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  addWorkspaceMember,
  buildNewWorkspaceManifest,
  createCustomRole,
  parseWorkspaceManifest,
  removeCustomRole,
  removeWorkspaceMember,
  resolvePermissions,
  serializeWorkspaceManifest,
  setEveryoneAccess,
  setWorkspaceMemberRole,
  updateCustomRole,
  validateWorkspaceManifest,
  workspaceOwnerIds,
  type ManifestResult,
  type Permission,
  type WorkspaceManifest,
} from '../src/lib/hostedWorkspace.ts';
import type { WorkspaceListing } from '../src/lib/workspaceLifecycle.ts';
import {
  dedupeUniqueName,
  planUniqueNameMigration,
  slugifyWorkspaceName,
  uniqueNameKey,
  uniqueNameProblem,
} from '../src/lib/workspaceNames.ts';
import { isSidecarPath } from '../src/lib/sidecar.ts';
import { UPLOAD_MAX_LABEL, uploadRejection, uploadTypeRejection } from '../src/lib/fileTransfer.ts';
import { contentTypeFor } from './contentTypes.ts';
import {
  clearSummaryCache,
  readCachedSummary,
  readSummaryCacheKey,
  summaryCacheUsage,
  validateSummaryCacheEntry,
  writeCachedSummary,
} from './summaryCache.ts';
import { filterListedWorkspaces } from '../src/lib/deploymentSettings.ts';
import type { DeploymentPolicy } from './deployment.ts';
import { cleanRelativePath, readBody, readBodyBytes, sendJson, tryDecode } from './http.ts';
import { mergeThreeWay } from './merge.ts';
import type { DirectoryProvider, RequestAuth, StorageProvider } from './providers/types.ts';
import { userPrefix } from './userFiles.ts';

/** PRD 007 Req 7: the root prefix all workspace data lives under. */
export const WORKSPACES_PREFIX = 'workspaces/';

const manifestBlob = (id: string): string => `${WORKSPACES_PREFIX}${id}/manifest.json`;
const filesPrefix = (id: string): string => `${WORKSPACES_PREFIX}${id}/files/`;

const MANIFEST_BLOB_RE = /^workspaces\/([^/]+)\/manifest\.json$/;

/** The last segment of a workspace-relative path — the file's own name. */
function basenameOf(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

/**
 * PRD 007 Req 18: blob storage has no directories — a prefix exists only for
 * as long as something is stored under it. An empty folder the user created
 * would therefore vanish on the next listing, so it is made real by this
 * zero-byte marker blob. It is a dotfile, which the sidebar tree already
 * hides (SPEC34's dotfile rule), and the hosted platform filters it from
 * directory listings besides — so the folder shows up and the marker never
 * does.
 */
export const FOLDER_PLACEHOLDER = '.mmkeep';

// --- the route→verb table (PRD 007 Req 13+17) --------------------------------

/** One workspace-scoped route and the single catalog verb it requires. */
export interface WorkspaceRouteRequirement {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  /**
   * The path under `/api/workspaces/<id>` (`''` is the workspace itself),
   * with four placeholders standing for whatever the caller addresses:
   * `<new>` a blob that does not exist yet, `<existing>` one that does,
   * `<sidecar>` a comment sidecar, `<folder>` a folder that exists.
   */
  path: string;
  required: Permission;
  /** Why this verb and not the neighbouring one. */
  why: string;
}

/**
 * PRD 007 Req 13+17: every workspace-scoped route and the ONE verb it
 * requires, declared in one readable place — the same table server/README.md
 * documents. The handlers below pass exactly these verbs to
 * `requirePermission`; `tests/unit/server-workspaces.test.ts` enumerates this
 * table, issues each request as a caller who holds nothing, and asserts the
 * 403 names the verb listed here. So an entry that drifts from its handler
 * fails, and a catalog verb no route requires fails too — a new verb cannot
 * be added to `PERMISSIONS` and left dead.
 */
export const WORKSPACE_ROUTE_PERMISSIONS: readonly WorkspaceRouteRequirement[] = [
  { method: 'DELETE', path: '', required: 'workspace.delete', why: 'destroys the workspace and every blob under it' },
  { method: 'GET', path: 'manifest', required: 'doc.read', why: 'the manifest is what opening the workspace reads' },
  { method: 'PUT', path: 'manifest', required: 'workspace.settings', why: 'the whole-manifest write, settings slot included' },
  { method: 'POST', path: 'move-file', required: 'file.rename', why: 'rename and move are the same act on one file' },
  { method: 'POST', path: 'move-folder', required: 'folder.manage', why: 'a folder move re-keys every blob under it' },
  { method: 'POST', path: 'folders', required: 'folder.manage', why: 'creating an empty folder is folder management' },
  { method: 'DELETE', path: 'folders/<folder>', required: 'folder.manage', why: 'so is deleting one, contents and all' },
  { method: 'PUT', path: 'upload/<new>', required: 'file.upload', why: 'its own verb and its own size/type rule (Req 19)' },
  { method: 'GET', path: 'download/<existing>', required: 'file.download', why: 'taking bytes out of the workspace (Req 19)' },
  { method: 'POST', path: 'members', required: 'workspace.members', why: 'handing out a role' },
  { method: 'PUT', path: 'members/<member>', required: 'workspace.members', why: 'changing one' },
  { method: 'DELETE', path: 'members/<member>', required: 'workspace.members', why: 'taking one away' },
  { method: 'PUT', path: 'everyone', required: 'workspace.members', why: 'everyone-access is a grant like any other' },
  { method: 'POST', path: 'roles', required: 'workspace.roles', why: 'defining a role is not handing one out' },
  { method: 'PUT', path: 'roles/<role>', required: 'workspace.roles', why: 'nor is editing one' },
  { method: 'DELETE', path: 'roles/<role>', required: 'workspace.roles', why: 'nor deleting one' },
  { method: 'GET', path: 'summary-cache', required: 'doc.read', why: 'PRD 011 Req 30: how much the shared summary cache holds' },
  { method: 'DELETE', path: 'summary-cache', required: 'workspace.settings', why: 'PRD 011 Req 30: Clear throws away every member’s summaries, not just the caller’s' },
  { method: 'GET', path: 'summary-cache/entry', required: 'doc.read', why: 'PRD 011 Req 28: a summary of content this caller may already read' },
  { method: 'PUT', path: 'summary-cache/entry', required: 'doc.read', why: 'PRD 011 Req 29: caching what a reader just generated is still a read of the document' },
  { method: 'GET', path: 'files', required: 'doc.read', why: 'the file listing is workspace content' },
  { method: 'GET', path: 'files/<existing>', required: 'doc.read', why: 'reading a document or a pasted image' },
  { method: 'PUT', path: 'files/<existing>', required: 'doc.edit', why: 'a PUT over an existing blob is a save' },
  { method: 'PUT', path: 'files/<new>', required: 'file.create', why: 'a PUT of a path that holds nothing yet is a create' },
  { method: 'DELETE', path: 'files/<existing>', required: 'file.delete', why: 'removing a blob' },
  { method: 'GET', path: 'files/<sidecar>', required: 'comment.read', why: 'a sidecar is comments, not a document' },
  { method: 'PUT', path: 'files/<sidecar>', required: 'comment.write', why: 'so a Commenter can write one without doc.edit' },
  { method: 'DELETE', path: 'files/<sidecar>', required: 'comment.write', why: 'the last comment going away is a comment write' },
];

/**
 * PRD 007 Req 13+17: which verb one `files/<path>` request needs. A comment
 * sidecar is comments — `comment.read`/`comment.write` — which is what lets a
 * Commenter (no `doc.edit`) actually comment; every other blob, pasted images
 * included, stays on the doc/file verbs. A PUT is a create when the path
 * holds nothing yet and a save when it does: a custom role may grant
 * `file.create` without `doc.edit` or the other way round (Req 15), so the
 * two cannot share one verb. `exists` is a thunk because that is the only
 * branch that needs it — every other request answers without a storage round
 * trip, and this function is the one place that knows which branch that is.
 */
async function fileRouteVerb(
  method: string,
  filePath: string,
  exists: () => Promise<boolean>,
): Promise<Permission | null> {
  if (isSidecarPath(filePath)) {
    if (method === 'GET') return 'comment.read';
    return method === 'PUT' || method === 'DELETE' ? 'comment.write' : null;
  }
  if (method === 'GET') return 'doc.read';
  if (method === 'PUT') return (await exists()) ? 'doc.edit' : 'file.create';
  return method === 'DELETE' ? 'file.delete' : null;
}

/** A `{from, to}` move request body, or null when it is not one. */
function parseMove(raw: string): { from: string; to: string } | null {
  let body: unknown;
  try {
    body = JSON.parse(raw || '');
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const { from, to } = body as { from?: unknown; to?: unknown };
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  const cleanFrom = cleanRelativePath(from);
  const cleanTo = cleanRelativePath(to);
  return cleanFrom && cleanTo ? { from: cleanFrom, to: cleanTo } : null;
}

/**
 * Does this exact blob exist? A metadata listing rather than a read: the
 * create-vs-save decision must not pay for downloading the bytes it is about
 * to replace. Prefix listings can return neighbours (`a.md` matches `a.md2`),
 * so the exact path is what counts.
 */
async function blobExists(storage: StorageProvider, path: string): Promise<boolean> {
  return (await storage.list(path)).some((b) => b.path === path);
}

/**
 * PRD 016 Req 8: the structured-file guard. A LINE merge knows nothing about
 * syntax, so two clean edits to different lines of a JSON document can produce
 * a file that no longer parses — and the comment sidecars (`src/lib/sidecar.ts`)
 * are exactly such documents. A merged `.json` that does not `JSON.parse` is
 * refused, so the 412 and its dialog are what the user gets rather than a
 * committed file the app can no longer read.
 */
function mergeKeepsFileWellFormed(filePath: string, text: string): boolean {
  if (!/\.json$/i.test(filePath)) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * PRD 016 Req 8: how many times the read-merge-write is re-run when the
 * merged write itself loses a race. Small on purpose: each attempt is a
 * fresh head read and a fresh merge, so a blob busy enough to beat this
 * many times over is one the user should be told about rather than one to
 * keep hammering. Running out answers 412 — never an unconditional write.
 */
const MERGE_ATTEMPTS = 3;

/**
 * PRD 016 Req 8: the merge attempt that sits between "the conditional write
 * lost" and "answer 412". Answers the landed merge, or null for every
 * reason the caller must turn back into today's 412:
 *
 *  - the save carried no base (the client's base is the ONLY possible merge
 *    base — a blob store has no version history to resolve one from);
 *  - the file is gone from the head;
 *  - the two sides conflict;
 *  - the merged text fails the structured-file guard;
 *  - the merged write kept losing further races.
 *
 * The write below is CONDITIONAL ON THE ETAG THE HEAD READ RETURNED — the
 * same rule the plain conditional write follows — so a head that moves again
 * is refused and the next iteration merges against the real head. The client's
 * base is trusted unverified: a lying client could at most produce a write it
 * could already produce with an unconditional save.
 */
async function mergeStaleSave(
  storage: StorageProvider,
  blobPath: string,
  filePath: string,
  ours: string,
  clientBase?: string,
): Promise<{ etag: string; content: string } | null> {
  if (clientBase === undefined) return null;
  for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt += 1) {
    const head = await storage.read(blobPath);
    if (!head) return null;
    const merged = mergeThreeWay(clientBase, ours, head.content);
    if (!merged.clean) return null;
    if (!mergeKeepsFileWellFormed(filePath, merged.text)) return null;
    const written = await storage.writeIfMatch(blobPath, merged.text, head.etag);
    if (written) return { etag: written.etag, content: merged.text };
  }
  return null;
}

/** Copy one blob's bytes (and media type) to a new path, then drop the old. */
async function moveBlob(storage: StorageProvider, from: string, to: string): Promise<boolean> {
  const bytes = await storage.readBytes(from);
  if (!bytes) return false;
  await storage.writeBytes(to, bytes.data, bytes.contentType);
  await storage.delete(from);
  return true;
}

/**
 * Load and parse a workspace's manifest. `null` means no such workspace; a
 * string is a parse/validation error (a corrupt manifest is a server-side
 * data problem, surfaced as 500 — never silently coerced).
 */
async function loadManifest(
  storage: StorageProvider,
  id: string,
): Promise<WorkspaceManifest | string | null> {
  const blob = await storage.read(manifestBlob(id));
  if (!blob) return null;
  const parsed = parseWorkspaceManifest(blob.content);
  return parsed.ok ? parsed.manifest : parsed.error;
}

/**
 * PRD 020 Req 1: every unique name currently held, as case-insensitive keys —
 * the collision set creation and rename check against. Derived by loading
 * every manifest, exactly like the listing loop: there is no database, one
 * manifest blob per workspace is all the state there is. `excludeId` leaves
 * out the workspace being renamed, so a case-only rename never collides with
 * itself. Corrupt manifests contribute nothing (their reads fail loudly on
 * their own routes).
 */
async function takenUniqueNames(storage: StorageProvider, excludeId?: string): Promise<Set<string>> {
  const taken = new Set<string>();
  for (const blob of await storage.list(WORKSPACES_PREFIX)) {
    const id = MANIFEST_BLOB_RE.exec(blob.path)?.[1];
    if (!id || id === excludeId) continue;
    const manifest = await loadManifest(storage, id);
    if (manifest && typeof manifest !== 'string' && manifest.uniqueName) {
      taken.add(uniqueNameKey(manifest.uniqueName));
    }
  }
  return taken;
}

/** PRD 020 Req 1: the 409 refusal creation and rename both send — one template, so the two routes can never drift apart. */
function uniqueNameTakenError(name: string): string {
  return `The unique name ${JSON.stringify(name)} is already taken.`;
}

/**
 * PRD 020 Req 3: the upgrade migration — every manifest without a unique name
 * gets one: display name slugified, deduped deployment-wide past reserved
 * words and every name already held. Idempotent (a manifest that carries the
 * field is skipped, so a second run writes nothing) and logged per workspace
 * through the injected `log`. Runs once at server startup (server/index.ts);
 * returns how many manifests were migrated.
 */
export async function migrateWorkspaceUniqueNames(
  storage: StorageProvider,
  log: (line: string) => void,
): Promise<number> {
  const rows = new Map<string, WorkspaceManifest>();
  for (const blob of await storage.list(WORKSPACES_PREFIX)) {
    const id = MANIFEST_BLOB_RE.exec(blob.path)?.[1];
    if (!id) continue;
    const manifest = await loadManifest(storage, id);
    // A corrupt manifest has no name to slugify; it stays the 500 its own
    // routes already report rather than being silently rewritten here.
    if (!manifest || typeof manifest === 'string') continue;
    rows.set(id, manifest);
  }
  const plan = planUniqueNameMigration(
    [...rows].map(([id, manifest]) => ({
      id,
      name: manifest.name,
      ...(manifest.uniqueName !== undefined ? { uniqueName: manifest.uniqueName } : {}),
      created: manifest.created,
    })),
  );
  for (const { id, uniqueName } of plan) {
    const manifest = rows.get(id);
    if (!manifest) continue;
    // The display name is preserved as the friendly name by writing nothing
    // but the new field; timestamps stay untouched — migration is an upgrade,
    // not an edit anyone made.
    await storage.write(manifestBlob(id), serializeWorkspaceManifest({ ...manifest, uniqueName }));
    log(`workspace-name migration: ${id} ${JSON.stringify(manifest.name)} → unique name ${JSON.stringify(uniqueName)}`);
  }
  return plan.length;
}

/**
 * PRD 007 Req 13+17: the one guard every workspace-scoped operation passes.
 * Resolves the caller's permissions from the manifest and answers 403 when
 * the single required verb is missing. Returns the manifest to act on, or
 * null when the response has already been sent (404/403/500).
 */
async function requirePermission(
  res: ServerResponse,
  storage: StorageProvider,
  id: string,
  auth: RequestAuth,
  required: Permission,
): Promise<WorkspaceManifest | null> {
  const manifest = await loadManifest(storage, id);
  if (manifest === null) {
    sendJson(res, 404, { error: 'no such workspace' });
    return null;
  }
  if (typeof manifest === 'string') {
    sendJson(res, 500, { error: `corrupt workspace manifest: ${manifest}` });
    return null;
  }
  // PRD 017 Req 4: admin status rides in on the request auth, so the implicit
  // admin union applies to every route through this one gate.
  if (!resolvePermissions(manifest, auth.user.id, auth.isAdmin).has(required)) {
    sendJson(res, 403, { error: 'forbidden', required });
    return null;
  }
  return manifest;
}

/**
 * Parse a JSON request body. Sends the 400 itself and returns `undefined`
 * (a value `JSON.parse` never yields) when the body is malformed, so callers
 * bail on exactly one check.
 */
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  try {
    return JSON.parse((await readBody(req)) || '{}');
  } catch {
    sendJson(res, 400, { error: 'malformed JSON body' });
    return undefined;
  }
}

/**
 * PRD 007 Req 15+16: persist the outcome of one pure manifest mutation. A
 * refusal from `src/lib/hostedWorkspace.ts` — an unknown role, a built-in
 * name, the last Owner, an in-use role — is a 400 carrying that named error;
 * a success is written with the server owning the timestamps exactly as the
 * manifest PUT does (creation immutable, modification restamped here).
 */
async function saveMutation(
  res: ServerResponse,
  storage: StorageProvider,
  id: string,
  existing: WorkspaceManifest,
  result: ManifestResult,
): Promise<void> {
  if (!result.ok) {
    sendJson(res, 400, { error: result.error });
    return;
  }
  const manifest: WorkspaceManifest = {
    ...result.manifest,
    created: existing.created,
    modified: new Date().toISOString(),
  };
  await storage.write(manifestBlob(id), serializeWorkspaceManifest(manifest));
  sendJson(res, 200, { id, manifest });
}

/** The untrusted `{name, permissions}` shape a custom-role write carries. */
function readRoleBody(body: unknown): { name: string; permissions: string[] } | string {
  if (typeof body !== 'object' || body === null) return 'role must be {name, permissions[]}';
  const { name, permissions } = body as { name?: unknown; permissions?: unknown };
  if (typeof name !== 'string') return 'role must be {name, permissions[]}';
  if (!Array.isArray(permissions) || !permissions.every((p): p is string => typeof p === 'string')) {
    return 'role permissions must be an array of permission names';
  }
  return { name, permissions };
}

/**
 * PRD 007 Req 6 (issue #180): the display name to snapshot into the manifest
 * when a member is added — from the directory when it answers, undefined
 * (never a blocked add) when it does not. A directory that answers the bare
 * id as the display name contributes nothing a fallback needs.
 */
async function snapshotDisplayName(
  directory: DirectoryProvider,
  id: string,
  auth: RequestAuth,
): Promise<string | undefined> {
  const user = await directory.getUser(id, auth).catch(() => null);
  const name = user?.displayName?.trim();
  return name && name !== id ? name : undefined;
}

// --- the personal scratchpad (PRD 019 Reqs 5–7) ------------------------------

/** PRD 019 Req 6: the scratchpad workspace's display name. */
export const SCRATCHPAD_NAME = 'Scratchpad';

/**
 * PRD 019 Req 5: where one user's scratchpad workspace id is recorded — the
 * source of truth for "already provisioned". Under the caller's own
 * token-scoped prefix (`users/<id>/…`, the server/userFiles.ts pattern), so
 * no request can name another user's record.
 */
export function scratchpadPointerBlob(userId: string): string {
  return `${userPrefix(userId)}scratchpad.json`;
}

/** The recorded workspace id, or null when the blob is not a valid record. */
function parseScratchpadPointer(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { workspaceId?: unknown };
    return typeof parsed?.workspaceId === 'string' && parsed.workspaceId !== ''
      ? parsed.workspaceId
      : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/me/scratchpad — resolve-or-create the calling user's scratchpad.
 * PRD 019 Req 5: keyed SOLELY by the validated token identity (never the
 * URL, query or body) and idempotent — every call answers `{id}` with the
 * same workspace id, created exactly once. PRD 019 Req 7: deliberately NOT
 * behind the deployment creation policy — every signed-in user, guests
 * included, gets one; `deployment.creationFor` keeps governing the regular
 * POST /api/workspaces above.
 */
export async function handleScratchpadResolve(
  res: ServerResponse,
  storage: StorageProvider,
  auth: RequestAuth,
): Promise<void> {
  const pointer = scratchpadPointerBlob(auth.user.id);
  const recorded = await storage.read(pointer);
  if (recorded) {
    // A record that exists but does not parse is a server-side data problem,
    // surfaced as 500 like a corrupt manifest — never silently re-created
    // (that would strand the real scratchpad and its files).
    const id = parseScratchpadPointer(recorded.content);
    if (!id) sendJson(res, 500, { error: 'corrupt scratchpad record' });
    else sendJson(res, 200, { id });
    return;
  }
  // First call: provision a REAL workspace through the standard creation
  // pieces (PRD 019 Req 6) — manifest from buildNewWorkspaceManifest with
  // the caller as sole Owner, opaque randomUUID id, manifest at the standard
  // workspaces/<id>/manifest.json blob. The display-name snapshot comes from
  // the caller's own token, as the create route does for the creator.
  const built = buildNewWorkspaceManifest({ name: SCRATCHPAD_NAME }, auth.user.id, new Date().toISOString());
  if (!built.ok) {
    sendJson(res, 500, { error: built.error });
    return;
  }
  const displayName = auth.user.displayName.trim();
  // PRD 020 Req 1: a workspace provisioned here carries a unique name from
  // birth, minted exactly like the Req 3 migration would — "Scratchpad"
  // slugifies into the reserved word, so dedupe lands on `scratchpad-2`,
  // `-3`… deployment-wide (Req 12's per-user usernames are a later issue).
  const uniqueName = dedupeUniqueName(
    slugifyWorkspaceName(SCRATCHPAD_NAME),
    await takenUniqueNames(storage),
  );
  const manifest: WorkspaceManifest = {
    ...built.manifest,
    uniqueName,
    // PRD 019 Req 8: the manifest itself carries the scratchpad marker —
    // the one place the listing loop and the delete branch can read it
    // without an extra blob round trip per workspace.
    scratchpad: true,
    members: built.manifest.members.map((m) =>
      m.id === auth.user.id && displayName ? { ...m, displayName } : m,
    ),
  };
  const id = randomUUID();
  // The manifest is written BEFORE the pointer, so a recorded id always
  // names a workspace that exists; the conditional create below is what
  // makes two concurrent first calls yield exactly one scratchpad (Req 5) —
  // only one pointer write can land.
  await storage.write(manifestBlob(id), serializeWorkspaceManifest(manifest));
  const claimed = await storage.writeIfAbsent(pointer, JSON.stringify({ workspaceId: id }));
  if (claimed) {
    sendJson(res, 200, { id });
    return;
  }
  // Lost the race: another call recorded its id first. Drop this call's
  // orphan manifest and adopt the recorded workspace.
  await storage.delete(manifestBlob(id));
  const winner = await storage.read(pointer);
  const winnerId = winner ? parseScratchpadPointer(winner.content) : null;
  if (!winnerId) sendJson(res, 500, { error: 'corrupt scratchpad record' });
  else sendJson(res, 200, { id: winnerId });
}

/**
 * Handle a request under `/api/workspaces`. The caller (app.ts) has already
 * applied the 401 auth guard. Unmatched routes answer 404 here.
 */
export async function handleWorkspaceApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  storage: StorageProvider,
  auth: RequestAuth,
  directory: DirectoryProvider,
  deployment: DeploymentPolicy,
): Promise<void> {
  const pathname = url.pathname;
  const rest = pathname.slice('/api/workspaces'.length);
  // PRD 007 Req 8: `?raw=1` is the byte-level view of the SAME blob the JSON
  // form serves — an <img> can load it directly and a paste can PUT bytes to
  // it. Same paths, same permissions; only the representation differs.
  const raw = url.searchParams.get('raw') === '1';

  // PRD 007 Req 10: create — pre-permission (no workspace exists yet to hold
  // a verb); the creator becomes its sole Owner. PRD 017 Req 8: gated by the
  // deployment's creation policy instead, evaluated per request and BEFORE
  // anything is written — a disallowed caller leaves no blob behind. Nothing
  // else about creation changes (body, manifest, sole Owner).
  if (rest === '' && req.method === 'POST') {
    const creation = await deployment.creationFor(auth);
    if (!creation.allowed) {
      sendJson(res, 403, { error: 'forbidden', required: 'deployment.create' });
      return;
    }
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    // PRD 007 Req 10: initial members with roles and everyone-access ride
    // along with the name; a name-only body is exactly the old behaviour.
    // The creator is retained as Owner whatever the body asks for, and an
    // unknown role name is a 400 rather than a member with no permissions.
    const built = buildNewWorkspaceManifest(body, auth.user.id, new Date().toISOString());
    if (!built.ok) {
      sendJson(res, 400, { error: built.error });
      return;
    }
    // PRD 020 Req 1: the stateful half of unique-name enforcement (format and
    // reserved words were refused inside buildNewWorkspaceManifest) — a name
    // any workspace already holds, compared case-insensitively, is a 409 the
    // dialog shows verbatim.
    if (built.manifest.uniqueName) {
      const taken = await takenUniqueNames(storage);
      if (taken.has(uniqueNameKey(built.manifest.uniqueName))) {
        sendJson(res, 409, { error: uniqueNameTakenError(built.manifest.uniqueName) });
        return;
      }
    }
    // PRD 007 Req 6 (issue #180): snapshot each initial member's display
    // name at add time — the creator's from their own token, the rest from
    // the directory — so `resolveMembers` has a human-readable fallback
    // when Graph cannot answer later. A directory miss just leaves the
    // snapshot off; it never blocks creation.
    const withNames = await Promise.all(
      built.manifest.members.map(async (m) => {
        const displayName =
          m.id === auth.user.id
            ? auth.user.displayName.trim() || undefined
            : await snapshotDisplayName(directory, m.id, auth);
        return displayName ? { ...m, displayName } : m;
      }),
    );
    const manifest: WorkspaceManifest = { ...built.manifest, members: withNames };
    // PRD 007 Req 7: the id is an opaque server-generated UUID.
    const id = randomUUID();
    await storage.write(manifestBlob(id), serializeWorkspaceManifest(manifest));
    sendJson(res, 201, { id, manifest });
    return;
  }

  // PRD 007 Req 11: list — deliberately pre-permission: workspace metadata
  // (id, name, timestamps) is readable to any signed-in user so an Open
  // dialog can list everything; contents stay behind per-workspace checks.
  if (rest === '' && req.method === 'GET') {
    // The listing is derived from manifests alone: a `manifest.json` under
    // the workspaces prefix IS a workspace; any other blob there is not a
    // row of its own.
    const blobs = await storage.list(WORKSPACES_PREFIX);
    const ids = new Set<string>();
    for (const blob of blobs) {
      const id = MANIFEST_BLOB_RE.exec(blob.path)?.[1];
      if (id) ids.add(id);
    }
    const out: WorkspaceListing[] = [];
    for (const id of ids) {
      const manifest = await loadManifest(storage, id);
      if (manifest === null || typeof manifest === 'string') continue; // corrupt: has no listable metadata
      // PRD 019 Req 8: a scratchpad is personal — anyone but its Owner gets
      // no row at all, decided here BEFORE (and independent of) the listing
      // policy below, and for admins the same as anyone else (this loop
      // never consults auth.isAdmin). The owner's own row rides through
      // flagged, so the Open dialog can label it "My scratchpad".
      if (manifest.scratchpad && !workspaceOwnerIds(manifest).includes(auth.user.id)) continue;
      // PRD 007 Req 11: the row carries what the Open dialog needs to tell
      // "openable" from "ask for access" — a resolved access flag and the
      // owner ids to name — so the client never probes a forbidden read to
      // find out. Never file contents, never workspace-scoped settings.
      out.push({
        id,
        name: manifest.name,
        created: manifest.created,
        modified: manifest.modified,
        owners: workspaceOwnerIds(manifest),
        // PRD 017 Req 11: resolved WITHOUT the admin union — the `members`
        // filter below must treat an admin like anyone else (cross-membership
        // browsing lives in Management only), so what the manifest alone
        // grants decides whether the row is sent at all.
        access: resolvePermissions(manifest, auth.user.id).has('doc.read'),
        // PRD 019 Req 8: only the owner's own scratchpad reaches this push,
        // so the flag marks exactly the row the dialog labels.
        ...(manifest.scratchpad ? { scratchpad: true as const } : {}),
      });
    }
    // PRD 017 Req 11+15: the listing policy, read per request — under
    // `members` a row the caller cannot open is never sent (so the Req 12
    // no-access message cannot arise there); `everyone` is today's listing.
    const { settings } = await deployment.read();
    const listed = filterListedWorkspaces(settings.listing.policy, out);
    // PRD 017 Req 4: every row that survives the filter is openable to an
    // admin (the implicit doc.read), so their rows read openable even where
    // the manifest grants them nothing.
    if (auth.isAdmin) for (const row of listed) row.access = true;
    sendJson(res, 200, listed);
    return;
  }

  const decoded = tryDecode(rest.replace(/^\//, ''));
  const segments = decoded === null ? null : decoded.split('/');
  const id = segments?.[0];
  if (!segments || !id || id === '.' || id === '..') {
    sendJson(res, 400, { error: 'invalid workspace id' });
    return;
  }

  // DELETE /api/workspaces/<id> — destroy the workspace outright.
  if (segments.length === 1 && req.method === 'DELETE') {
    // Required permission: workspace.delete (404 for an unknown id, 403 when
    // the caller lacks exactly that verb — PRD 007 Req 12+17).
    const manifest = await requirePermission(res, storage, id, auth, 'workspace.delete');
    if (!manifest) return;
    // PRD 019 Req 9: a scratchpad workspace is never deletable — not by its
    // Owner, not by an admin. A deleted scratchpad would only be silently
    // recreated on the next /scratchpad visit, so the verb is refused for
    // every caller before anything under the prefix is touched.
    if (manifest.scratchpad) {
      sendJson(res, 400, { error: 'a scratchpad workspace cannot be deleted' });
      return;
    }
    // PRD 007 Req 12: EVERY blob under the workspace prefix goes — manifest,
    // files/, comment sidecars, pasted images and the summary cache (PRD 011
    // Req 29) alike. Listing the prefix (rather than the files/ subtree) is
    // what makes that exhaustive: nothing of the workspace survives to be
    // listed or read afterwards.
    const prefix = `${WORKSPACES_PREFIX}${id}/`;
    const blobs = await storage.list(prefix);
    const manifestPath = manifestBlob(id);
    await Promise.all(blobs.filter((b) => b.path !== manifestPath).map((b) => storage.delete(b.path)));
    // The manifest goes last: while it exists the permission check above
    // still answers, so an interrupted sweep never leaves unguarded blobs.
    await storage.delete(manifestPath);
    sendJson(res, 200, { deleted: id });
    return;
  }

  // GET/PUT /api/workspaces/<id>/manifest
  if (segments.length === 2 && segments[1] === 'manifest') {
    if (req.method === 'GET') {
      // Required permission: doc.read — any member (or everyone-role holder).
      const manifest = await requirePermission(res, storage, id, auth, 'doc.read');
      if (manifest) sendJson(res, 200, { id, manifest });
      return;
    }
    if (req.method === 'PUT') {
      // Required permission: workspace.settings — the whole-manifest write,
      // unchanged. The finer-grained member and role endpoints above (Req
      // 15+16) are the ones settings UI uses; narrowing what this one may
      // touch belongs to the #79 enforcement sweep.
      const existing = await requirePermission(res, storage, id, auth, 'workspace.settings');
      if (!existing) return;
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'malformed JSON body' });
        return;
      }
      const validated = validateWorkspaceManifest(body);
      if (!validated.ok) {
        sendJson(res, 400, { error: validated.error });
        return;
      }
      // PRD 020 Req 4: this PUT is the rename write path. A changed unique
      // name passes the same rules as creation — reserved words and a
      // case-insensitive collision with any OTHER workspace are refused with
      // an error the settings UI shows verbatim. An unchanged name skips the
      // checks (re-PUTting a manifest stays idempotent), and a body that
      // omits the field keeps the stored one — a pre-#219 client's manifest
      // write must never strip the workspace's identity.
      const requested = validated.manifest.uniqueName;
      if (requested !== undefined && requested !== existing.uniqueName) {
        // Format already passed validateWorkspaceManifest, so the shared rule
        // can only trip on a reserved word — same message the dialogs show.
        const problem = uniqueNameProblem(requested);
        if (problem) {
          sendJson(res, 400, { error: problem });
          return;
        }
        if ((await takenUniqueNames(storage, id)).has(uniqueNameKey(requested))) {
          sendJson(res, 409, { error: uniqueNameTakenError(requested) });
          return;
        }
      }
      const uniqueName = requested ?? existing.uniqueName;
      // The server owns the timestamps: creation is immutable, modification
      // is stamped here (PRD 007 Req 7's created/modified record).
      const manifest: WorkspaceManifest = {
        ...validated.manifest,
        ...(uniqueName !== undefined ? { uniqueName } : {}),
        created: existing.created,
        modified: new Date().toISOString(),
      };
      await storage.write(manifestBlob(id), serializeWorkspaceManifest(manifest));
      sendJson(res, 200, { id, manifest });
      return;
    }
  }

  // PRD 011 Req 28+29+30: this workspace's summary cache — get a key, put a
  // key, report roughly what it holds, throw it away. Membership and the 401
  // are the ones every route here already has; the verbs are the catalog's
  // existing ones (PRD 007 Req 13), no fifteenth added.

  // GET/PUT /api/workspaces/<id>/summary-cache/entry — one key at a time.
  if (segments.length === 3 && segments[1] === 'summary-cache' && segments[2] === 'entry') {
    if (req.method === 'GET') {
      // Required permission: doc.read — a summary is derived from content the
      // caller may already read.
      if (!(await requirePermission(res, storage, id, auth, 'doc.read'))) return;
      // The key rides the query string, so the ONE key-carrying path segment
      // that would otherwise need escaping never exists.
      const key = readSummaryCacheKey(url.searchParams.get('key'));
      if (!key) {
        sendJson(res, 400, { error: 'invalid cache key' });
        return;
      }
      // A miss is 200 with `entry: null`, not 404: "nothing cached yet" is
      // the ordinary answer, and a client must not read a status code to
      // tell it apart from a failure it should report.
      sendJson(res, 200, { entry: await readCachedSummary(storage, id, key) });
      return;
    }
    if (req.method === 'PUT') {
      // Required permission: doc.read — storing a summary the caller just
      // generated is not a change to any document.
      if (!(await requirePermission(res, storage, id, auth, 'doc.read'))) return;
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const entry = validateSummaryCacheEntry(body);
      if (typeof entry === 'string') {
        sendJson(res, 400, { error: entry });
        return;
      }
      // The server stamps the time, as it does for manifests and cards.
      await writeCachedSummary(storage, id, entry, Date.now());
      sendJson(res, 200, { key: entry.key });
      return;
    }
  }

  // GET/DELETE /api/workspaces/<id>/summary-cache — the whole cache: how much
  // it holds, and throwing it away.
  if (segments.length === 2 && segments[1] === 'summary-cache') {
    if (req.method === 'GET') {
      // Required permission: doc.read — the size is about content the caller
      // can already reach (PRD 011 Req 30's inspect half, #120's to render).
      if (!(await requirePermission(res, storage, id, auth, 'doc.read'))) return;
      sendJson(res, 200, await summaryCacheUsage(storage, id));
      return;
    }
    if (req.method === 'DELETE') {
      // Required permission: workspace.settings — Clear discards summaries
      // every member shares, so it is the workspace-wide authority and not
      // the reader's (PRD 011 Req 30's clear half).
      if (!(await requirePermission(res, storage, id, auth, 'workspace.settings'))) return;
      sendJson(res, 200, { cleared: await clearSummaryCache(storage, id) });
      return;
    }
  }

  // POST /api/workspaces/<id>/move-file — rename or move ONE file.
  // Required permission: file.rename (PRD 007 Req 18: the file verb; folders
  // move through move-folder under folder.manage, so each route still checks
  // exactly one verb). A move onto an existing path is refused with 409 —
  // never a silent destruction of the target — and an unknown source is 404.
  if (segments.length === 2 && segments[1] === 'move-file' && req.method === 'POST') {
    const manifest = await requirePermission(res, storage, id, auth, 'file.rename');
    if (!manifest) return;
    const move = parseMove(await readBody(req));
    if (!move) {
      sendJson(res, 400, { error: 'expected {from, to} relative file paths' });
      return;
    }
    const prefix = filesPrefix(id);
    if (await storage.read(prefix + move.to)) {
      sendJson(res, 409, { error: 'a file already exists at the destination', path: move.to });
      return;
    }
    if (!(await moveBlob(storage, prefix + move.from, prefix + move.to))) {
      sendJson(res, 404, { error: 'not found', path: move.from });
      return;
    }
    sendJson(res, 200, { from: move.from, to: move.to });
    return;
  }

  // POST /api/workspaces/<id>/move-folder — rename or move a folder, contents
  // and all. Required permission: folder.manage. Every blob under the source
  // prefix is re-keyed under the destination prefix (that IS "the directory
  // takes its contents with it" when directories are only prefixes); a
  // destination that already holds anything is 409, an empty source is 404.
  if (segments.length === 2 && segments[1] === 'move-folder' && req.method === 'POST') {
    const manifest = await requirePermission(res, storage, id, auth, 'folder.manage');
    if (!manifest) return;
    const move = parseMove(await readBody(req));
    if (!move) {
      sendJson(res, 400, { error: 'expected {from, to} relative folder paths' });
      return;
    }
    const prefix = filesPrefix(id);
    const fromPrefix = `${prefix}${move.from}/`;
    const toPrefix = `${prefix}${move.to}/`;
    if (toPrefix.startsWith(fromPrefix)) {
      sendJson(res, 400, { error: 'a folder cannot move inside itself' });
      return;
    }
    const blobs = await storage.list(fromPrefix);
    if (blobs.length === 0) {
      sendJson(res, 404, { error: 'not found', path: move.from });
      return;
    }
    if ((await storage.list(toPrefix)).length > 0) {
      sendJson(res, 409, { error: 'a folder already exists at the destination', path: move.to });
      return;
    }
    for (const blob of blobs) await moveBlob(storage, blob.path, toPrefix + blob.path.slice(fromPrefix.length));
    sendJson(res, 200, { from: move.from, to: move.to, moved: blobs.length });
    return;
  }

  // POST /api/workspaces/<id>/folders — create an EMPTY folder (PRD 007 Req
  // 18). Required permission: folder.manage. The folder is the placeholder
  // blob; creating one that already exists is idempotent, not an error.
  if (segments.length === 2 && segments[1] === 'folders' && req.method === 'POST') {
    const manifest = await requirePermission(res, storage, id, auth, 'folder.manage');
    if (!manifest) return;
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req)) || '');
    } catch {
      body = null;
    }
    const raw = (body as { path?: unknown } | null)?.path;
    const folder = typeof raw === 'string' ? cleanRelativePath(raw) : null;
    if (!folder) {
      sendJson(res, 400, { error: 'expected {path} — a relative folder path' });
      return;
    }
    await storage.write(`${filesPrefix(id)}${folder}/${FOLDER_PLACEHOLDER}`, '');
    sendJson(res, 201, { path: folder });
    return;
  }

  // DELETE /api/workspaces/<id>/folders/<path> — delete a folder and
  // everything under it. Required permission: folder.manage. PRD 007
  // non-goals: hosted deletes are PERMANENT — there is no trash to restore
  // from, which is why the UI's confirmation promises no recovery.
  if (segments.length > 2 && segments[1] === 'folders' && req.method === 'DELETE') {
    const manifest = await requirePermission(res, storage, id, auth, 'folder.manage');
    if (!manifest) return;
    const folder = cleanRelativePath(segments.slice(2).join('/'));
    if (!folder) {
      sendJson(res, 400, { error: 'invalid folder path' });
      return;
    }
    const blobs = await storage.list(`${filesPrefix(id)}${folder}/`);
    if (blobs.length === 0) {
      sendJson(res, 404, { error: 'not found', path: folder });
      return;
    }
    await Promise.all(blobs.map((b) => storage.delete(b.path)));
    sendJson(res, 200, { deleted: folder, files: blobs.length });
    return;
  }

  // PUT /api/workspaces/<id>/upload/<path> — single-file upload (PRD 007 Req
  // 19). Required permission: file.upload — deliberately its own route rather
  // than a flag on the files PUT, so the upload verb is what is checked and
  // the size/type rule below is enforced on exactly the upload path.
  if (segments.length > 2 && segments[1] === 'upload' && req.method === 'PUT') {
    const manifest = await requirePermission(res, storage, id, auth, 'file.upload');
    if (!manifest) return;
    const filePath = cleanRelativePath(segments.slice(2).join('/'));
    if (!filePath) {
      sendJson(res, 400, { error: 'invalid file path' });
      return;
    }
    const blobPath = filesPrefix(id) + filePath;
    // PRD 007 Req 17+19: the SAME pure rule the client rejects with, applied
    // again here — the client's check is a courtesy, this one is the control.
    // Type first (it needs no body at all), then the size, split into the two
    // status codes HTTP already has words for.
    const name = basenameOf(filePath);
    const typeRejection = uploadTypeRejection(name);
    if (typeRejection) {
      sendJson(res, 415, { error: typeRejection });
      return;
    }
    let bytes: Uint8Array;
    try {
      // A body past the transport's own guard never finishes arriving — that
      // is the same refusal, reported with the same limit.
      bytes = await readBodyBytes(req);
    } catch {
      sendJson(res, 413, { error: `upload exceeds the ${UPLOAD_MAX_LABEL} upload limit` });
      return;
    }
    const sizeRejection = uploadRejection(name, bytes.length);
    if (sizeRejection) {
      sendJson(res, 413, { error: sizeRejection });
      return;
    }
    // An upload never silently replaces an existing blob: the client picks a
    // free name from the listing, and a race that loses is told so.
    if (await storage.readBytes(blobPath)) {
      sendJson(res, 409, { error: 'a file already exists there', path: filePath });
      return;
    }
    const { etag } = await storage.writeBytes(blobPath, bytes, contentTypeFor(filePath));
    sendJson(res, 201, { path: filePath, etag, size: bytes.length });
    return;
  }

  // GET /api/workspaces/<id>/download/<path> — single-file download (PRD 007
  // Req 19). Required permission: file.download. The bytes are the blob's,
  // with a Content-Disposition naming the file's own basename; bulk transfer
  // is explicitly out of scope (PRD 007 non-goals).
  if (segments.length > 2 && segments[1] === 'download' && req.method === 'GET') {
    const manifest = await requirePermission(res, storage, id, auth, 'file.download');
    if (!manifest) return;
    const filePath = cleanRelativePath(segments.slice(2).join('/'));
    if (!filePath) {
      sendJson(res, 400, { error: 'invalid file path' });
      return;
    }
    const bytes = await storage.readBytes(filesPrefix(id) + filePath);
    if (!bytes) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const name = basenameOf(filePath);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': bytes.data.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      ETag: bytes.etag,
    });
    res.end(Buffer.from(bytes.data));
    return;
  }

  // PRD 007 Req 16+17: membership. Every route below requires exactly one
  // verb — `workspace.members` — and answers 400 with the pure layer's own
  // named refusal (unknown role, duplicate id, last Owner) on invalid input.

  // POST /api/workspaces/<id>/members — add one member with a role.
  if (segments.length === 2 && segments[1] === 'members' && req.method === 'POST') {
    const existing = await requirePermission(res, storage, id, auth, 'workspace.members');
    if (!existing) return;
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    const { id: memberId, role } = (body ?? {}) as { id?: unknown; role?: unknown };
    if (typeof memberId !== 'string' || typeof role !== 'string') {
      sendJson(res, 400, { error: 'member must be {id, role} with non-empty strings' });
      return;
    }
    // PRD 007 Req 6 (issue #180): snapshot the display name known now, so
    // the list stays readable when the directory cannot answer later.
    const displayName = await snapshotDisplayName(directory, memberId, auth);
    await saveMutation(res, storage, id, existing, addWorkspaceMember(existing, { id: memberId, role, displayName }));
    return;
  }

  // PUT /api/workspaces/<id>/everyone — everyone-in-tenant access + its role.
  if (segments.length === 2 && segments[1] === 'everyone' && req.method === 'PUT') {
    const existing = await requirePermission(res, storage, id, auth, 'workspace.members');
    if (!existing) return;
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    const { enabled, role } = (body ?? {}) as { enabled?: unknown; role?: unknown };
    if (typeof enabled !== 'boolean' || (role !== undefined && typeof role !== 'string')) {
      sendJson(res, 400, { error: 'everyone must be {enabled: boolean, role?: string}' });
      return;
    }
    await saveMutation(res, storage, id, existing, setEveryoneAccess(existing, { enabled, role }));
    return;
  }

  // PUT/DELETE /api/workspaces/<id>/members/<userId> — role change / removal.
  if (segments.length === 3 && segments[1] === 'members') {
    const memberId = segments[2];
    if (req.method === 'PUT') {
      const existing = await requirePermission(res, storage, id, auth, 'workspace.members');
      if (!existing) return;
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const { role } = (body ?? {}) as { role?: unknown };
      if (typeof role !== 'string') {
        sendJson(res, 400, { error: 'body must be {role: string}' });
        return;
      }
      await saveMutation(res, storage, id, existing, setWorkspaceMemberRole(existing, memberId, role));
      return;
    }
    if (req.method === 'DELETE') {
      const existing = await requirePermission(res, storage, id, auth, 'workspace.members');
      if (!existing) return;
      await saveMutation(res, storage, id, existing, removeWorkspaceMember(existing, memberId));
      return;
    }
  }

  // PRD 007 Req 15+17: the custom-role editor's writes. One verb each —
  // `workspace.roles` — and never `workspace.members`: defining a role is a
  // different act from handing one out.

  // POST /api/workspaces/<id>/roles — create a named subset of the catalog.
  if (segments.length === 2 && segments[1] === 'roles' && req.method === 'POST') {
    const existing = await requirePermission(res, storage, id, auth, 'workspace.roles');
    if (!existing) return;
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    const role = readRoleBody(body);
    if (typeof role === 'string') {
      sendJson(res, 400, { error: role });
      return;
    }
    await saveMutation(res, storage, id, existing, createCustomRole(existing, role));
    return;
  }

  // PUT/DELETE /api/workspaces/<id>/roles/<name> — rename+edit / delete.
  if (segments.length === 3 && segments[1] === 'roles') {
    const roleName = segments[2];
    if (req.method === 'PUT') {
      const existing = await requirePermission(res, storage, id, auth, 'workspace.roles');
      if (!existing) return;
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const role = readRoleBody(body);
      if (typeof role === 'string') {
        sendJson(res, 400, { error: role });
        return;
      }
      await saveMutation(res, storage, id, existing, updateCustomRole(existing, roleName, role));
      return;
    }
    if (req.method === 'DELETE') {
      const existing = await requirePermission(res, storage, id, auth, 'workspace.roles');
      if (!existing) return;
      await saveMutation(res, storage, id, existing, removeCustomRole(existing, roleName));
      return;
    }
  }

  // GET /api/workspaces/<id>/files — list; required permission: doc.read.
  if (segments.length === 2 && segments[1] === 'files' && req.method === 'GET') {
    const manifest = await requirePermission(res, storage, id, auth, 'doc.read');
    if (!manifest) return;
    const prefix = filesPrefix(id);
    const listed = await storage.list(prefix);
    // Paths come back workspace-relative; the manifest never appears because
    // it lives outside the files/ prefix (PRD 007 Req 7).
    sendJson(res, 200, listed.map((f) => ({ ...f, path: f.path.slice(prefix.length) })));
    return;
  }

  // /api/workspaces/<id>/files/<path> — read/write/delete one file.
  if (segments.length > 2 && segments[1] === 'files') {
    const filePath = cleanRelativePath(segments.slice(2).join('/'));
    if (!filePath) {
      sendJson(res, 400, { error: 'invalid file path' });
      return;
    }
    const blobPath = filesPrefix(id) + filePath;
    // PRD 007 Req 13+17: one verb for this request, from the table above —
    // sidecars answer to the comment verbs, and a PUT is a create or a save
    // depending on whether the blob is already there. An unsupported method
    // yields no verb and falls through to the 404 at the end.
    const method = req.method ?? '';
    const verb = await fileRouteVerb(method, filePath, () => blobExists(storage, blobPath));
    if (verb && !(await requirePermission(res, storage, id, auth, verb))) return;
    if (method === 'GET') {
      if (raw) {
        const bytes = await storage.readBytes(blobPath);
        if (!bytes) {
          sendJson(res, 404, { error: 'not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': bytes.contentType,
          'Content-Length': bytes.data.length,
          ETag: bytes.etag,
        });
        res.end(Buffer.from(bytes.data));
        return;
      }
      const file = await storage.read(blobPath);
      if (!file) sendJson(res, 404, { error: 'not found' });
      else sendJson(res, 200, { path: filePath, ...file });
      return;
    }
    if (method === 'PUT') {
      if (raw) {
        const { etag } = await storage.writeBytes(
          blobPath,
          await readBodyBytes(req),
          contentTypeFor(filePath),
        );
        sendJson(res, 200, { path: filePath, etag });
        return;
      }
      // PRD 016 Req 7: two body shapes, told apart by Content-Type. The bare
      // text body is the save as it always was; a JSON `{content, base}` body
      // additionally carries the text the client LOADED, so a stale save can
      // merge below even on a backend with no version history. One size limit
      // (MAX_BODY_BYTES in readBody) covers the whole body either way.
      const rawBody = await readBody(req);
      let content = rawBody;
      let base: string | undefined;
      if (/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          parsed = null;
        }
        const body = parsed as { content?: unknown; base?: unknown } | null;
        if (typeof body?.content !== 'string' || (body.base !== undefined && typeof body.base !== 'string')) {
          sendJson(res, 400, { error: 'expected {content, base?} — the text to save and optionally the text it was edited from' });
          return;
        }
        content = body.content;
        base = body.base;
      }
      // PRD 007 Req 20: optimistic concurrency. `If-Match` carries the ETag
      // the client read; the write lands only while the blob still has it.
      // When it does not, the answer is 412 and the STORED CONTENT IS
      // UNTOUCHED — the other member's save survives, and the client prompts
      // to reload or overwrite. A request with no If-Match is a deliberate
      // unconditional write (a first save, or the user's Overwrite choice).
      const ifMatch = req.headers['if-match'];
      if (typeof ifMatch === 'string' && ifMatch !== '' && ifMatch !== '*') {
        const written = await storage.writeIfMatch(blobPath, content, ifMatch);
        if (!written) {
          // PRD 016 Req 8: the stale save gets one chance to become a merge
          // before it becomes a 412 — a save that carried its base merges;
          // one that did not takes the 412 below verbatim.
          const merged = await mergeStaleSave(storage, blobPath, filePath, content, base);
          if (merged) {
            sendJson(res, 200, { path: filePath, etag: merged.etag, merged: true, content: merged.content });
            return;
          }
          sendJson(res, 412, { error: 'the file changed on the server since it was loaded', path: filePath });
          return;
        }
        sendJson(res, 200, { path: filePath, etag: written.etag });
        return;
      }
      const { etag } = await storage.write(blobPath, content);
      sendJson(res, 200, { path: filePath, etag });
      return;
    }
    if (method === 'DELETE') {
      const existed = await storage.delete(blobPath);
      sendJson(res, existed ? 200 : 404, existed ? { deleted: filePath } : { error: 'not found' });
      return;
    }
  }

  sendJson(res, 404, { error: 'no such endpoint' });
}
