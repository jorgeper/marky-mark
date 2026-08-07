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
import { isSidecarPath } from '../src/lib/sidecar.ts';
import { UPLOAD_MAX_LABEL, uploadRejection, uploadTypeRejection } from '../src/lib/fileTransfer.ts';
import {
  backendRecordWorkspaceId,
  validateWorkspaceBackend,
  type WorkspaceBackendRecord,
  type WorkspaceBackends,
} from './backends.ts';
import { contentTypeFor } from './contentTypes.ts';
import { cleanRelativePath, readBody, readBodyBytes, sendJson, tryDecode } from './http.ts';
import type { RequestAuth, StorageProvider } from './providers/types.ts';

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
  if (!resolvePermissions(manifest, auth.user.id).has(required)) {
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

/**
 * PRD 010 Req 17: the optional `storage` field on a create body — the ONLY
 * way a repo connection is created in this issue, and what #104's wizard will
 * call. Absent means the deployment default, so a body with no such field
 * behaves byte-identically to before. Validation is
 * `validateWorkspaceBackend`'s and no one else's: one validator for the record
 * the wizard sends and the record that is later read back.
 */
function readStorageField(body: unknown): WorkspaceBackendRecord | string {
  const requested = (body as { storage?: unknown } | null)?.storage;
  if (requested === undefined) return { kind: 'deployment-default' };
  const validated = validateWorkspaceBackend(requested);
  return validated.ok ? validated.record : `storage: ${validated.error}`;
}

/**
 * PRD 010 Req 17: what a refused connection answers. The vocabulary is
 * `githubFailureDetail`'s already — the message is the thrown error's — and
 * only the status is decided here, from the status the store reported (duck
 * typed, so this module stays free of any vendor import): GitHub blaming the
 * request is the operator's connection being wrong (400), GitHub itself
 * failing is a bad gateway (502).
 */
function connectionFailureStatus(err: unknown): number {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 500 ? 502 : 400;
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
 * Handle a request under `/api/workspaces`. The caller (app.ts) has already
 * applied the 401 auth guard. Unmatched routes answer 404 here.
 *
 * PRD 010 Req 3: storage arrives as a per-workspace RESOLVER, not one
 * process-wide provider — a deployment may hold workspaces on more than one
 * backend, and which one backs a given workspace is a property of that
 * workspace. Everything before an id is known (create, the listing) is the
 * deployment default's, by definition.
 */
export async function handleWorkspaceApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  backends: WorkspaceBackends,
  auth: RequestAuth,
): Promise<void> {
  const deploymentDefault = backends.deploymentDefault;
  const pathname = url.pathname;
  const rest = pathname.slice('/api/workspaces'.length);
  // PRD 007 Req 8: `?raw=1` is the byte-level view of the SAME blob the JSON
  // form serves — an <img> can load it directly and a paste can PUT bytes to
  // it. Same paths, same permissions; only the representation differs.
  const raw = url.searchParams.get('raw') === '1';

  // PRD 007 Req 10: create — deliberately pre-permission (any signed-in user
  // may create a workspace); the creator becomes its sole Owner.
  if (rest === '' && req.method === 'POST') {
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
    // PRD 010 Req 17: a malformed connection is a 400 naming the offending
    // field, never a created workspace.
    const record = readStorageField(body);
    if (typeof record === 'string') {
      sendJson(res, 400, { error: record });
      return;
    }
    // PRD 007 Req 7 + PRD 010 Req 17: the id stays an opaque server-generated
    // UUID. Nothing about owner/repo/branch/root appears in it, in the
    // workspace URL, or in any API response — the connection is read from the
    // server-side record and from nowhere else.
    const id = randomUUID();
    let target = deploymentDefault;
    if (record.kind !== 'deployment-default') {
      // PRD 010 Req 17: fail fast. The repo is proved reachable with
      // `contents: write` BEFORE anything is written, so a bad connection
      // leaves no record, no manifest and no commit behind.
      try {
        target = await backends.connect(record, id);
        await target.init?.();
      } catch (err) {
        sendJson(res, connectionFailureStatus(err), { error: (err as Error).message });
        return;
      }
    }
    // PRD 010 Req 3: the record goes down BEFORE the manifest — the backend
    // is what says where the manifest itself belongs, so it can never be the
    // second thing written.
    await backends.remember(id, record);
    // …and the manifest through the workspace's OWN backend, which for a repo
    // connection lands it at `<root>/.marky-mark/manifest.json` as one commit.
    await target.write(manifestBlob(id), serializeWorkspaceManifest(built.manifest));
    // The 201 is the existing `{id, manifest}` — no connection details.
    sendJson(res, 201, { id, manifest: built.manifest });
    return;
  }

  // PRD 007 Req 11: list — deliberately pre-permission: workspace metadata
  // (id, name, timestamps) is readable to any signed-in user so an Open
  // dialog can list everything; contents stay behind per-workspace checks.
  if (rest === '' && req.method === 'GET') {
    // PRD 010 Req 3+17: which ids exist is the UNION of two traces in the
    // deployment default — a `manifest.json` (a workspace on this store, and
    // every workspace an existing deployment already has) and a
    // `backend.json` (a workspace whose manifest lives in ITS backend, which
    // is what a BYO workspace looks like from here). Neither trace is a row
    // of its own: each id's manifest is loaded through its own backend.
    const blobs = await deploymentDefault.list(WORKSPACES_PREFIX);
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const blob of blobs) {
      const id = MANIFEST_BLOB_RE.exec(blob.path)?.[1] ?? backendRecordWorkspaceId(blob.path);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    const out: WorkspaceListing[] = [];
    for (const id of ids) {
      // A workspace whose manifest cannot be loaded — corrupt, or a connected
      // repo that is unreachable right now — is skipped, exactly as a corrupt
      // manifest already was: one broken workspace never fails the listing.
      let manifest: WorkspaceManifest | string | null;
      try {
        manifest = await loadManifest(await backends.forWorkspace(id), id);
      } catch {
        continue;
      }
      if (manifest === null || typeof manifest === 'string') continue; // corrupt: has no listable metadata
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
        access: resolvePermissions(manifest, auth.user.id).has('doc.read'),
      });
    }
    sendJson(res, 200, out);
    return;
  }

  const decoded = tryDecode(rest.replace(/^\//, ''));
  const segments = decoded === null ? null : decoded.split('/');
  const id = segments?.[0];
  if (!segments || !id || id === '.' || id === '..') {
    sendJson(res, 400, { error: 'invalid workspace id' });
    return;
  }

  // PRD 010 Req 3: one resolution per request, from here on `storage` IS
  // this workspace's backend. A record that cannot be read is a server-side
  // data problem, reported like a corrupt manifest — never coerced into the
  // default, which would serve the workspace from the wrong store.
  let storage: StorageProvider;
  try {
    storage = await backends.forWorkspace(id);
  } catch (err) {
    sendJson(res, 500, { error: (err as Error).message });
    return;
  }

  // DELETE /api/workspaces/<id> — destroy the workspace outright.
  if (segments.length === 1 && req.method === 'DELETE') {
    // Required permission: workspace.delete (404 for an unknown id, 403 when
    // the caller lacks exactly that verb — PRD 007 Req 12+17).
    const manifest = await requirePermission(res, storage, id, auth, 'workspace.delete');
    if (!manifest) return;
    // PRD 007 Req 12: EVERY blob under the workspace prefix goes — manifest,
    // files/, comment sidecars and pasted images alike. Listing the prefix
    // (rather than the files/ subtree) is what makes that exhaustive: nothing
    // of the workspace survives to be listed or read afterwards.
    // PRD 010 Req 17: on a BYO workspace the same sweep is the connected root
    // — its files and its `.marky-mark/` — as commits, and nothing outside
    // that root: the workspace's store cannot address anything else, so the
    // repo and the branch themselves are never touched. Repo history retains
    // the content, as git history always does.
    const prefix = `${WORKSPACES_PREFIX}${id}/`;
    const blobs = await storage.list(prefix);
    const manifestPath = manifestBlob(id);
    await Promise.all(blobs.filter((b) => b.path !== manifestPath).map((b) => storage.delete(b.path)));
    // The manifest goes last: while it exists the permission check above
    // still answers, so an interrupted sweep never leaves unguarded blobs.
    await storage.delete(manifestPath);
    // PRD 010 Req 3: and the record with it, so nothing of the workspace is
    // left behind in the deployment default either. When that store IS this
    // workspace's, the sweep above already took it and this is a no-op; when
    // it is not, this is the only thing that removes it.
    await backends.forget(id);
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
      // The server owns the timestamps: creation is immutable, modification
      // is stamped here (PRD 007 Req 7's created/modified record).
      const manifest: WorkspaceManifest = {
        ...validated.manifest,
        created: existing.created,
        modified: new Date().toISOString(),
      };
      await storage.write(manifestBlob(id), serializeWorkspaceManifest(manifest));
      sendJson(res, 200, { id, manifest });
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
    await saveMutation(res, storage, id, existing, addWorkspaceMember(existing, { id: memberId, role }));
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
      const content = await readBody(req);
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
