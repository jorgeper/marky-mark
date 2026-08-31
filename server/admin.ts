// PRD 017 Req 14: the deployment-admin surface — four routes under
// /api/admin, every one requiring `deployment.admin` (the caller's id in
// MM_ADMINS, stamped on the request in app.ts). Refusal is the Req 2 shape,
// `403 { error: 'forbidden', required: 'deployment.admin' }`, for everyone
// else — including non-admins who are Owners of every workspace: no
// workspace verb reaches across the deployment. The aggregation and row
// shapes are the pure functions in src/lib/deploymentAdmin.ts, shared with
// the Management view so the client renders exactly what a test pins here.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  aggregateWorkspaceBlobStats,
  type AdminUserRow,
  type AdminWorkspaceRow,
} from '../src/lib/deploymentAdmin.ts';
import {
  DEPLOYMENT_SETTINGS_BLOB,
  parseDeploymentSettings,
  serializeDeploymentSettings,
} from '../src/lib/deploymentSettings.ts';
import { parseWorkspaceManifest, workspaceOwnerIds } from '../src/lib/hostedWorkspace.ts';
import type { DeploymentPolicy } from './deployment.ts';
import { readBody, sendJson } from './http.ts';
import type { Providers, RequestAuth } from './providers/types.ts';
import { WORKSPACES_PREFIX } from './workspaces.ts';

/** The prefix app.ts routes here. */
export const ADMIN_PREFIX = '/api/admin';

/**
 * PRD 017 Req 16: every workspace in the deployment as an admin row — one
 * `storage.list` of the whole workspaces prefix aggregated by the pure
 * function, plus one manifest read per workspace for the fields blobs cannot
 * carry. A manifest that is missing or does not parse still yields a row,
 * flagged with the error and carrying its blob figures — Management is where
 * an operator finds broken things.
 */
async function listAdminWorkspaces(providers: Providers): Promise<AdminWorkspaceRow[]> {
  const blobs = await providers.storage.list(WORKSPACES_PREFIX);
  const stats = aggregateWorkspaceBlobStats(blobs, WORKSPACES_PREFIX);
  const rows: AdminWorkspaceRow[] = [];
  for (const [id, stat] of stats) {
    const figures = { fileCount: stat.fileCount, totalBytes: stat.totalBytes };
    const blob = await providers.storage.read(`${WORKSPACES_PREFIX}${id}/manifest.json`);
    const parsed = blob === null ? null : parseWorkspaceManifest(blob.content);
    if (!parsed || !parsed.ok) {
      rows.push({
        id,
        name: null,
        created: null,
        // The newest blob write stands in so the newest-first sort still
        // places the broken workspace somewhere honest.
        modified: stat.newestModified,
        owners: [],
        memberIds: [],
        everyone: null,
        ...figures,
        error: parsed ? parsed.error : 'the workspace has no manifest',
      });
      continue;
    }
    const manifest = parsed.manifest;
    rows.push({
      id,
      name: manifest.name,
      created: manifest.created,
      modified: manifest.modified,
      // Owner refs carry the issue-#180 display-name snapshots, so the
      // client's existing resolveMembers fallback applies unchanged.
      owners: workspaceOwnerIds(manifest).map((ownerId) => {
        const snapshot = manifest.members.find((m) => m.id === ownerId)?.displayName;
        return snapshot ? { id: ownerId, displayName: snapshot } : { id: ownerId };
      }),
      memberIds: manifest.members.map((m) => m.id),
      everyone: manifest.everyone,
      ...figures,
    });
  }
  return rows;
}

/**
 * Handle a request under `/api/admin`. The caller (app.ts) has already
 * applied the 401 auth guard; the deployment.admin gate runs here, first,
 * so no admin data is assembled — let alone sent — for anyone else.
 */
export async function handleAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  providers: Providers,
  auth: RequestAuth,
  deployment: DeploymentPolicy,
  admins: ReadonlySet<string>,
): Promise<void> {
  // PRD 017 Req 14 (Req 2 shape): one gate for the whole surface.
  if (auth.isAdmin !== true) {
    sendJson(res, 403, { error: 'forbidden', required: 'deployment.admin' });
    return;
  }
  const { pathname } = url;

  // GET /api/admin/workspaces — the Req 16 rows.
  if (pathname === `${ADMIN_PREFIX}/workspaces` && req.method === 'GET') {
    sendJson(res, 200, await listAdminWorkspaces(providers));
    return;
  }

  // GET /api/admin/users — the Req 19 rows: the directory's whole tenant,
  // each stamped with whether it is in MM_ADMINS. A directory failure is an
  // error the tab can show, never an empty tenant.
  if (pathname === `${ADMIN_PREFIX}/users` && req.method === 'GET') {
    let users;
    try {
      users = await providers.directory.listUsers(auth);
    } catch {
      sendJson(res, 502, { error: 'the directory could not be listed' });
      return;
    }
    const rows: AdminUserRow[] = users.map((user) => ({ ...user, admin: admins.has(user.id) }));
    sendJson(res, 200, rows);
    return;
  }

  if (pathname === `${ADMIN_PREFIX}/settings`) {
    // GET — the parsed settings plus, when Req 7 applies, the parse error,
    // exactly as the per-request policy read resolves them.
    if (req.method === 'GET') {
      sendJson(res, 200, await deployment.read());
      return;
    }
    // PUT — replace the record after validating with the SHARED parser (the
    // same one the client predicts with), 400 naming the problem on an
    // invalid body. Last write wins; no ETag negotiation (Req 14).
    if (req.method === 'PUT') {
      const parsed = parseDeploymentSettings(await readBody(req));
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      await providers.storage.write(
        DEPLOYMENT_SETTINGS_BLOB,
        serializeDeploymentSettings(parsed.settings),
      );
      sendJson(res, 200, { settings: parsed.settings });
      return;
    }
  }

  sendJson(res, 404, { error: 'no such endpoint' });
}
