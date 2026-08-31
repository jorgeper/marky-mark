// PRD 017 Req 14: the deployment-admin surface — the routes under
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
import {
  addWorkspaceMember,
  grantableRoleNames,
  parseWorkspaceManifest,
  resolvePermissions,
  serializeWorkspaceManifest,
  workspaceOwnerIds,
  type WorkspaceManifest,
} from '../src/lib/hostedWorkspace.ts';
import {
  deploymentOrigin,
  invitationMessage,
  parseInvitationRequest,
} from '../src/lib/invitations.ts';
import type { DeploymentPolicy } from './deployment.ts';
import { readBody, sendJson } from './http.ts';
import type { DirectoryInviteResult, Providers, RequestAuth } from './providers/types.ts';
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
 * POST /api/admin/invitations — PRD 017 Req 29+30: invite a guest through
 * the directory seam AS THE SIGNED-IN ADMIN, optionally granting a role in
 * one workspace in the same request.
 */
async function inviteGuest(
  req: IncomingMessage,
  res: ServerResponse,
  providers: Providers,
  auth: RequestAuth,
): Promise<void> {
  let data: unknown;
  try {
    data = JSON.parse((await readBody(req)) || 'null');
  } catch {
    sendJson(res, 400, { error: 'malformed JSON body' });
    return;
  }
  // Req 30 needs the manifest anyway, so it is read FIRST — the shared
  // parser then validates the role against THIS workspace's grantable set
  // (custom roles included), not just the built-ins.
  const requested = (data ?? {}) as { workspace?: { id?: unknown } };
  const workspaceId =
    typeof requested.workspace === 'object' &&
    requested.workspace !== null &&
    typeof requested.workspace.id === 'string'
      ? requested.workspace.id
      : null;
  let manifest: WorkspaceManifest | null = null;
  if (workspaceId !== null) {
    const blob = await providers.storage.read(`${WORKSPACES_PREFIX}${workspaceId}/manifest.json`);
    if (blob === null) {
      sendJson(res, 404, { error: 'no such workspace' });
      return;
    }
    const parsedManifest = parseWorkspaceManifest(blob.content);
    if (!parsedManifest.ok) {
      sendJson(res, 500, { error: `corrupt workspace manifest: ${parsedManifest.error}` });
      return;
    }
    manifest = parsedManifest.manifest;
  }
  const parsed = parseInvitationRequest(data, manifest ? grantableRoleNames(manifest) : undefined);
  if (!parsed.ok) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }
  const { email, note, workspace } = parsed.invitation;
  // Req 30: the caller must hold workspace.members there — implicit for
  // admins (Req 4), so behind the gate above this cannot refuse today; the
  // check stays where the rule is stated.
  if (manifest && !resolvePermissions(manifest, auth.user.id, auth.isAdmin).has('workspace.members')) {
    sendJson(res, 403, { error: 'forbidden', required: 'workspace.members' });
    return;
  }
  // Req 29: Graph POST /v1.0/invitations rides the OBO exchange under the
  // provider seam. A directory refusal comes back as data; a transport or
  // token-exchange failure rejects. Both map to 502 carrying the failure's
  // own sentence — never a silent success, and never a token (obo.ts's
  // errors carry the AADSTS line only).
  const forwarded = req.headers['x-forwarded-proto'];
  let outcome: DirectoryInviteResult;
  try {
    outcome = await providers.directory.invite(
      {
        email,
        redirectUrl: deploymentOrigin(req.headers.host, Array.isArray(forwarded) ? forwarded[0] : forwarded),
        message: invitationMessage(auth.user.displayName, note),
      },
      auth,
    );
  } catch (err) {
    sendJson(res, 502, {
      error: err instanceof Error ? err.message : 'the invitation could not be sent',
    });
    return;
  }
  if (!outcome.ok) {
    sendJson(res, 502, { error: outcome.message, code: outcome.code });
    return;
  }
  const invitedUser = outcome.user;
  // Req 30: the same-request role grant, through the existing pure
  // mutation with the issue #180 snapshot — the email is the only display
  // name known now. A failure after the invitation succeeded still
  // answers 201, carrying `membership: { error }`; there is no un-invite.
  let membership: { error: string } | undefined;
  if (manifest && workspace) {
    const grant = addWorkspaceMember(manifest, {
      id: invitedUser.id,
      role: workspace.role,
      displayName: email,
    });
    if (!grant.ok) {
      membership = { error: grant.error };
    } else {
      try {
        await providers.storage.write(
          `${WORKSPACES_PREFIX}${workspace.id}/manifest.json`,
          serializeWorkspaceManifest({ ...grant.manifest, modified: new Date().toISOString() }),
        );
      } catch {
        membership = { error: 'the invitation was sent, but the membership could not be stored' };
      }
    }
  }
  sendJson(res, 201, {
    id: invitedUser.id,
    email,
    displayName: invitedUser.displayName,
    pending: true,
    ...(membership ? { membership } : {}),
  });
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

  // POST /api/admin/invitations — the Req 29+30 invitation flow above.
  if (pathname === `${ADMIN_PREFIX}/invitations` && req.method === 'POST') {
    await inviteGuest(req, res, providers, auth);
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
