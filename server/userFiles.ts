// PRD 007 Req 9: the per-user blob API — the roaming half of the PRD 002
// layered configuration. The signed-in user's User settings layer (and their
// personal themes, reading positions and session stores) live under
// `users/<user id>/…`, OUTSIDE every workspace prefix: they follow the user
// across browsers and devices and are visible to no one else. There is no
// path by which one user names another's blobs — the prefix comes from the
// validated token, never from the URL — and server/app.ts blocks the whole
// `users/` prefix from the workspace-agnostic /api/files scaffold.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { cleanRelativePath, readBody, sendJson } from './http.ts';
import type { RequestAuth, StorageProvider } from './providers/types.ts';

/** PRD 007 Req 9: the root prefix all per-user data lives under. */
export const USERS_PREFIX = 'users/';

/** One user's own prefix. Ids come from the token, so they are encoded once. */
export function userPrefix(userId: string): string {
  return `${USERS_PREFIX}${encodeURIComponent(userId)}/`;
}

/**
 * Handle a request under `/api/me/files`. The caller (app.ts) has already
 * applied the 401 auth guard; every path here is scoped to `auth.user`, so
 * there is no permission check to make — a user is always allowed their own
 * blobs. Unmatched routes answer 404.
 */
export async function handleUserFilesApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  storage: StorageProvider,
  auth: RequestAuth,
): Promise<void> {
  const prefix = userPrefix(auth.user.id);
  const rest = pathname.slice('/api/me/files'.length);

  if (rest === '' && req.method === 'GET') {
    const listed = await storage.list(prefix);
    sendJson(res, 200, listed.map((f) => ({ ...f, path: f.path.slice(prefix.length) })));
    return;
  }

  const relative = cleanRelativePath(rest.replace(/^\//, ''));
  if (!relative) {
    sendJson(res, 400, { error: 'invalid file path' });
    return;
  }
  const blobPath = prefix + relative;

  if (req.method === 'GET') {
    const file = await storage.read(blobPath);
    if (!file) sendJson(res, 404, { error: 'not found' });
    else sendJson(res, 200, { path: relative, ...file });
    return;
  }
  if (req.method === 'PUT') {
    const { etag } = await storage.write(blobPath, await readBody(req));
    sendJson(res, 200, { path: relative, etag });
    return;
  }
  if (req.method === 'DELETE') {
    const existed = await storage.delete(blobPath);
    sendJson(res, existed ? 200 : 404, existed ? { deleted: relative } : { error: 'not found' });
    return;
  }
  sendJson(res, 404, { error: 'no such endpoint' });
}
