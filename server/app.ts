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
import type { Providers, RequestAuth } from './providers/types.ts';

/** Uploads beyond this are rejected outright (scaffold guard, not a quota). */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on('data', (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * decodeURIComponent, or null on a malformed percent-escape. Request paths
 * are attacker-controlled, and a bare decodeURIComponent throws on e.g.
 * `/%zz` — uncaught in the synchronous static handler, that took the whole
 * process down.
 */
function tryDecode(component: string): string | null {
  try {
    return decodeURIComponent(component);
  } catch {
    return null;
  }
}

/** A stored-file path from the URL; null when absent, malformed, or escaping the root. */
function filePathFrom(pathname: string): string | null {
  const raw = tryDecode(pathname.slice('/api/files/'.length));
  if (!raw) return null;
  const segments = raw.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  return segments.join('/');
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  providers: Providers,
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

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const user = token ? await providers.auth.validateToken(token) : null;
  if (!user) {
    sendJson(res, 401, { error: 'authentication required' });
    return;
  }
  const auth: RequestAuth = { token, user };

  if (pathname === '/api/me' && req.method === 'GET') {
    sendJson(res, 200, user);
    return;
  }

  if (pathname === '/api/directory/search' && req.method === 'GET') {
    sendJson(res, 200, await providers.directory.search(url.searchParams.get('q') ?? '', auth));
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

  if (pathname === '/api/files' && req.method === 'GET') {
    sendJson(res, 200, await providers.storage.list(url.searchParams.get('prefix') ?? ''));
    return;
  }

  if (pathname.startsWith('/api/files/')) {
    const filePath = filePathFrom(pathname);
    if (!filePath) {
      sendJson(res, 400, { error: 'invalid file path' });
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

export function createApp(staticDir: string, providers: Providers, mode: ServerMode): RequestListener {
  const staticRoot = path.resolve(staticDir);
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      handleApi(req, res, url, providers).catch((err: unknown) => {
        console.error('API error:', err);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal server error' });
        else res.end();
      });
      return;
    }
    handleStatic(req, res, url, staticRoot, mode);
  };
}
