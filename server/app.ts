// PRD 007 Req 1: one origin serves both the REST API (under /api/) and the
// built SPA (everything else, with an index.html fallback for client-side
// routes). Plain node:http — no framework — because the scaffold's surface is
// deliberately minimal until the workspace-semantics sibling issues land.
// PRD 007 Req 3: handlers touch vendor services only through the Providers
// seam handed in here.

import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { Buffer } from 'node:buffer';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ServerMode } from './config.ts';
import { cleanRelativePath, readBody, sendJson, tryDecode } from './http.ts';
import { createLlmApi, LLM_PREFIX, type LlmApi } from './llm.ts';
import type { Providers, RequestAuth } from './providers/types.ts';
import { handleUserFilesApi, USERS_PREFIX } from './userFiles.ts';
import { handleWorkspaceApi, WORKSPACES_PREFIX } from './workspaces.ts';

/**
 * PRD 007 Req 9+13: prefixes the workspace-agnostic /api/files scaffold must
 * never reach — workspace data is permission-checked at /api/workspaces, and
 * per-user data is token-scoped at /api/me/files. Neither may be read (or
 * listed) through a route that applies neither check.
 */
const RESERVED_PREFIXES = [WORKSPACES_PREFIX, USERS_PREFIX];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** A stored-file path from the URL; null when absent, malformed, or escaping the root. */
function filePathFrom(pathname: string): string | null {
  const raw = tryDecode(pathname.slice('/api/files/'.length));
  if (!raw) return null;
  return cleanRelativePath(raw);
}

/**
 * The session token a request presents, or '' when it presents none.
 * PRD 007 Req 8: an <img> element cannot carry an Authorization header, so
 * GETs may also present the token as `?access_token=`. GET only and
 * same-origin only: a token in a query string must never be able to mutate
 * anything, and the app's external-link policy keeps the URL from being
 * handed to another origin as a Referer.
 */
function sessionToken(req: IncomingMessage, url: URL): string {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length);
  if (req.method === 'GET') return url.searchParams.get('access_token') ?? '';
  return '';
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  providers: Providers,
  llm: LlmApi,
  admins: ReadonlySet<string>,
): Promise<void> {
  const { pathname } = url;

  // Sign-in is the one unauthenticated endpoint — everything else under /api/
  // rejects requests without a valid bearer token (PRD 007 Req 3 auth seam).
  if (pathname === '/api/auth/sign-in' && req.method === 'POST') {
    let username: string | undefined;
    try {
      username = (JSON.parse((await readBody(req)) || '{}') as { username?: string }).username;
    } catch {
      sendJson(res, 400, { error: 'malformed JSON body' });
      return;
    }
    const result = await providers.auth.signIn({ username });
    if (!result) {
      sendJson(res, 401, { error: 'unknown user' });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  const token = sessionToken(req, url);
  const user = token ? await providers.auth.validateToken(token) : null;
  if (!user) {
    sendJson(res, 401, { error: 'authentication required' });
    return;
  }
  // PRD 017 Req 4: admin status is stamped on the request context here, once,
  // so every downstream gate (requirePermission → resolvePermissions) inherits
  // the implicit admin grants with no per-route change.
  const auth: RequestAuth = { token, user, isAdmin: admins.has(user.id) };

  if (pathname === '/api/me' && req.method === 'GET') {
    sendJson(res, 200, user);
    return;
  }

  if (pathname === '/api/directory/search' && req.method === 'GET') {
    sendJson(res, 200, await providers.directory.search(url.searchParams.get('q') ?? '', auth));
    return;
  }

  // PRD 007 Req 6: same-origin avatar proxy (the URL shape is defined once,
  // in providers/types.ts userPhotoUrl). Inside the auth guard like the rest
  // of /api/; 404 for a user with no photo or who is unknown. Checked before
  // the plain user lookup, whose prefix it shares.
  if (
    pathname.startsWith('/api/directory/users/') &&
    pathname.endsWith('/photo') &&
    req.method === 'GET'
  ) {
    const id = tryDecode(pathname.slice('/api/directory/users/'.length, -'/photo'.length));
    if (!id) {
      sendJson(res, 400, { error: 'invalid user id' });
      return;
    }
    const photo = await providers.directory.getUserPhoto(id, auth);
    if (!photo) {
      sendJson(res, 404, { error: 'no photo' });
      return;
    }
    res.writeHead(200, { 'Content-Type': photo.contentType, 'Content-Length': photo.data.length });
    res.end(Buffer.from(photo.data));
    return;
  }

  if (pathname.startsWith('/api/directory/users/') && req.method === 'GET') {
    const id = tryDecode(pathname.slice('/api/directory/users/'.length));
    if (id === null) {
      sendJson(res, 400, { error: 'invalid user id' });
      return;
    }
    const found = await providers.directory.getUser(id, auth);
    if (!found) {
      sendJson(res, 404, { error: 'unknown user' });
      return;
    }
    sendJson(res, 200, found);
    return;
  }

  // PRD 011 Req 8+13: the deployment's LLM surface (server/llm.ts) — inside
  // this same 401 guard, so an unauthenticated caller is turned away before
  // any provider is contacted, and the operator's key is never spendable by
  // someone who is not signed in. Absent LLM section, the module still answers
  // availability and refuses a request by name.
  if (pathname === LLM_PREFIX || pathname.startsWith(`${LLM_PREFIX}/`)) {
    await llm.handle(req, res, url);
    return;
  }

  // PRD 007 Req 7+13: everything under /api/workspaces is per-workspace
  // scoped and permission-checked (server/workspaces.ts).
  if (pathname === '/api/workspaces' || pathname.startsWith('/api/workspaces/')) {
    await handleWorkspaceApi(req, res, url, providers.storage, auth, providers.directory);
    return;
  }

  // PRD 007 Req 9: the signed-in user's own blobs — the roaming User settings
  // layer and personal themes (server/userFiles.ts). Scoped to the token's
  // user, never to a name in the URL.
  if (pathname === '/api/me/files' || pathname.startsWith('/api/me/files/')) {
    await handleUserFilesApi(req, res, pathname, providers.storage, auth);
    return;
  }

  if (pathname === '/api/files' && req.method === 'GET') {
    const listed = await providers.storage.list(url.searchParams.get('prefix') ?? '');
    // PRD 007 Req 9+13: the workspace and per-user roots are invisible to the
    // workspace-agnostic scaffold — their blobs (manifests included) are
    // reachable only through the endpoints that check who may see them.
    sendJson(
      res,
      200,
      listed.filter((f) => !RESERVED_PREFIXES.some((p) => f.path.startsWith(p))),
    );
    return;
  }

  if (pathname.startsWith('/api/files/')) {
    const filePath = filePathFrom(pathname);
    if (!filePath) {
      sendJson(res, 400, { error: 'invalid file path' });
      return;
    }
    // PRD 007 Req 9+13: workspace and per-user data never bypass their
    // access checks via the legacy scaffold.
    if (RESERVED_PREFIXES.some((p) => filePath.startsWith(p))) {
      sendJson(res, 403, { error: 'reserved data is served by /api/workspaces and /api/me/files' });
      return;
    }
    if (req.method === 'GET') {
      const file = await providers.storage.read(filePath);
      if (!file) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      sendJson(res, 200, { path: filePath, ...file });
      return;
    }
    if (req.method === 'PUT') {
      const { etag } = await providers.storage.write(filePath, await readBody(req));
      sendJson(res, 200, { path: filePath, etag });
      return;
    }
    if (req.method === 'DELETE') {
      const existed = await providers.storage.delete(filePath);
      sendJson(res, existed ? 200 : 404, existed ? { deleted: filePath } : { error: 'not found' });
      return;
    }
  }

  sendJson(res, 404, { error: 'no such endpoint' });
}

/**
 * PRD 007 Req 5: mark served HTML as hosted (mode in the content) so the
 * unmodified SPA build knows to gate behind sign-in. Injection happens at
 * serve time — dist/ on disk stays byte-identical to a static deployment,
 * which never carries the marker and therefore never shows a sign-in page.
 */
export function injectHostedMarker(html: string, mode: ServerMode): string {
  const marker = `<meta name="marky-mark-hosted" content="${mode}">`;
  const head = html.indexOf('</head>');
  return head === -1 ? marker + html : html.slice(0, head) + marker + html.slice(head);
}

/**
 * Serve the built SPA. Anything that resolves to a real file under staticDir
 * streams out; any other GET falls back to index.html so client-side routes
 * deep-link (PRD 007 Req 1: same origin as the API).
 */
function handleStatic(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  staticRoot: string,
  mode: ServerMode,
): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  const decoded = tryDecode(url.pathname);
  if (decoded === null) {
    sendJson(res, 400, { error: 'invalid path' });
    return;
  }
  const relative = path.posix.normalize(decoded).replace(/^\/+/, '');
  const candidate = path.resolve(staticRoot, relative);
  const inRoot = candidate === staticRoot || candidate.startsWith(staticRoot + path.sep);
  const target =
    inRoot && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : path.join(staticRoot, 'index.html');
  if (!existsSync(target)) {
    sendJson(res, 404, { error: 'SPA build not found — run `npm run build` first' });
    return;
  }
  // PRD 007 Req 5: HTML is read (not streamed) so the hosted marker can be
  // injected; every other asset streams out untouched.
  if (path.extname(target).toLowerCase() === '.html') {
    const html = injectHostedMarker(readFileSync(target, 'utf8'), mode);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
    });
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(target).size,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}

export function createApp(
  staticDir: string,
  providers: Providers,
  mode: ServerMode,
  // PRD 011 Req 8: defaulted to a deployment with no LLM section, so a caller
  // that configured none still wires and the routes report themselves
  // unconfigured rather than 500ing.
  llm: LlmApi = createLlmApi(),
  // PRD 017 Req 1: ids from MM_ADMINS — defaulted empty, so a deployment (or
  // test) that names no admins wires byte-identically to before.
  admins: ReadonlySet<string> = new Set(),
): RequestListener {
  const staticRoot = path.resolve(staticDir);
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      handleApi(req, res, url, providers, llm, admins).catch((err: unknown) => {
        console.error('API error:', err);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal server error' });
        else res.end();
      });
      return;
    }
    handleStatic(req, res, url, staticRoot, mode);
  };
}
