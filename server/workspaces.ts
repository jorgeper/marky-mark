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
import { cleanRelativePath, readBody, readBodyBytes, sendJson, tryDecode } from './http.ts';
import type { RequestAuth, StorageProvider } from './providers/types.ts';

/** PRD 007 Req 7: the root prefix all workspace data lives under. */
export const WORKSPACES_PREFIX = 'workspaces/';

const manifestBlob = (id: string): string => `${WORKSPACES_PREFIX}${id}/manifest.json`;
const filesPrefix = (id: string): string => `${WORKSPACES_PREFIX}${id}/files/`;

const MANIFEST_BLOB_RE = /^workspaces\/([^/]+)\/manifest\.json$/;

/**
 * PRD 007 Req 8: the media type a raw blob is stored and served with,
 * derived from its extension ALONE. The uploader's Content-Type is
 * deliberately ignored: these bytes come back from the app's own origin, so
 * letting a caller label an upload `text/html` would turn a pasted "image"
 * into stored same-origin script. Anything unrecognised is a download.
 */
const RAW_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'application/octet-stream', // SVG is script-capable — never served as an image
};

function contentTypeFor(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return RAW_CONTENT_TYPES[ext] ?? 'application/octet-stream';
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

/** The untrusted `{name, permissions}` shape a custom-role write carries. */
function readRoleBody(body: unknown): { name: string; permissions: string[] } | string {
  if (typeof body !== 'object' || body === null) return 'role must be {name, permissions[]}';
  const { name, permissions } = body as { name?: unknown; permissions?: unknown };
  if (typeof name !== 'string') return 'role must be {name, permissions[]}';
  if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== 'string')) {
    return 'role permissions must be an array of permission names';
  }
  return { name, permissions: permissions as string[] };
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
): Promise<void> {
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
    const id = randomUUID();
    await storage.write(manifestBlob(id), serializeWorkspaceManifest(built.manifest));
    sendJson(res, 201, { id, manifest: built.manifest });
    return;
  }

  // PRD 007 Req 11: list — deliberately pre-permission: workspace metadata
  // (id, name, timestamps) is readable to any signed-in user so an Open
  // dialog can list everything; contents stay behind per-workspace checks.
  if (rest === '' && req.method === 'GET') {
    const blobs = await storage.list(WORKSPACES_PREFIX);
    const out: WorkspaceListing[] = [];
    for (const blob of blobs) {
      const match = MANIFEST_BLOB_RE.exec(blob.path);
      if (!match) continue;
      const manifest = await loadManifest(storage, match[1]);
      if (manifest === null || typeof manifest === 'string') continue; // corrupt: has no listable metadata
      // PRD 007 Req 11: the row carries what the Open dialog needs to tell
      // "openable" from "ask for access" — a resolved access flag and the
      // owner ids to name — so the client never probes a forbidden read to
      // find out. Never file contents, never workspace-scoped settings.
      out.push({
        id: match[1],
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
    if (req.method === 'GET') {
      // Required permission: doc.read.
      const manifest = await requirePermission(res, storage, id, auth, 'doc.read');
      if (!manifest) return;
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
    if (req.method === 'PUT') {
      // Required permission: doc.edit (one verb per endpoint; PUT is the
      // save path, and no built-in role grants file.create without doc.edit).
      const manifest = await requirePermission(res, storage, id, auth, 'doc.edit');
      if (!manifest) return;
      if (raw) {
        const { etag } = await storage.writeBytes(
          blobPath,
          await readBodyBytes(req),
          contentTypeFor(filePath),
        );
        sendJson(res, 200, { path: filePath, etag });
        return;
      }
      const { etag } = await storage.write(blobPath, await readBody(req));
      sendJson(res, 200, { path: filePath, etag });
      return;
    }
    if (req.method === 'DELETE') {
      // Required permission: file.delete.
      const manifest = await requirePermission(res, storage, id, auth, 'file.delete');
      if (!manifest) return;
      const existed = await storage.delete(blobPath);
      sendJson(res, existed ? 200 : 404, existed ? { deleted: filePath } : { error: 'not found' });
      return;
    }
  }

  sendJson(res, 404, { error: 'no such endpoint' });
}
