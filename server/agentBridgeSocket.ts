// PRD 027 Req 9 (issue #367): the control channel's server end — the
// WebSocket upgrade route `GET /api/workspaces/<id>/agent-session` that
// registers a browser tab with the ONE app-wide session broker
// (server/agentBridge.ts). It exists only under `MM_AGENT_BRIDGE=1`:
// `createAppHandlers` builds it only then, and `server/index.ts` attaches
// nothing to the `'upgrade'` event otherwise, so a flag-off deployment
// refuses the handshake before any code here runs.
//
// PRD 027 Req 10: takeover and teardown are the broker's — a second upgrade
// for the same workspace replaces the first (which is told
// `session_replaced` and closed); a socket close or error tears the session
// down so the workspace has no controlled tab afterwards.
//
// Auth is the user's EXISTING session, never an agent token (PRD 027 Req 4
// keeps tokens to the MCP endpoint): the bearer header, or — because a
// browser `WebSocket` cannot set headers and an upgrade is a same-origin GET
// — the `?access_token=` query form `server/app.ts` already accepts on GETs.
// Membership is the workspace table's own gate (`checkWorkspacePermission`,
// `doc.read`). Nothing here logs: the URL carries the session token.

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Buffer } from 'node:buffer';
import { decodeBridgeMessage, encodeBridgeMessage } from '../src/lib/agentBridgeProtocol.ts';
import type { SessionBroker, SessionHandle } from './agentBridge.ts';
import type { Providers, RequestAuth } from './providers/types.ts';
import { tryDecode } from './http.ts';
import { AGENT_SESSION_ROUTE, checkWorkspacePermission } from './workspaces.ts';
import { acceptWebSocket, isWebSocketUpgrade, refuseUpgrade } from './websocket.ts';

/** The `'upgrade'` listener shape `http.Server` expects. */
export type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** The workspace id an agent-session upgrade path names, or null for any other path. */
export function agentSessionWorkspaceId(pathname: string): string | null {
  const prefix = '/api/workspaces/';
  const suffix = `/${AGENT_SESSION_ROUTE}`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const raw = pathname.slice(prefix.length, -suffix.length);
  if (!raw || raw.includes('/')) return null;
  return tryDecode(raw);
}

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
};

/**
 * PRD 027 Req 9 (issue #367): build the upgrade handler for one app. Every
 * refusal is an ordinary HTTP status on the raw socket (no `101`), with the
 * same JSON body the REST routes answer.
 */
export function createAgentBridgeUpgrade(
  providers: Providers,
  broker: SessionBroker,
  admins: ReadonlySet<string>,
): UpgradeListener {
  const refuse = (socket: Duplex, status: number, body: unknown) =>
    refuseUpgrade(socket, status, REASONS[status] ?? 'Error', body);

  async function handle(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const workspaceId = agentSessionWorkspaceId(url.pathname);
    if (workspaceId === null) {
      refuse(socket, 404, { error: 'no such endpoint' });
      return;
    }
    if (!isWebSocketUpgrade(req)) {
      refuse(socket, 400, { error: 'expected a websocket upgrade' });
      return;
    }
    // The same two token forms `sessionToken` in server/app.ts reads for a GET.
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : (url.searchParams.get('access_token') ?? '');
    const user = token ? await providers.auth.validateToken(token) : null;
    if (!user) {
      refuse(socket, 401, { error: 'authentication required' });
      return;
    }
    // PRD 017 Req 4: admin status is stamped exactly as the request path does.
    const auth: RequestAuth = { token, user, isAdmin: admins.has(user.id) };
    const check = await checkWorkspacePermission(providers.storage, workspaceId, auth, 'doc.read');
    if (!check.ok) {
      refuse(socket, check.status, check.body);
      return;
    }

    let handle: SessionHandle | null = null;
    const connection = acceptWebSocket(req, socket, head, {
      onMessage(text) {
        // A malformed frame is ignored — never a crash, never a log line.
        const decoded = decodeBridgeMessage(text);
        if (!decoded.ok) return;
        const { message } = decoded;
        // Only the tab→server kinds are deliverable; a tab echoing a
        // server→tab envelope is dropped like any other noise.
        if (message.kind !== 'tool_result' && message.kind !== 'state') return;
        handle?.deliver(message);
      },
      onClose() {
        // PRD 027 Req 10: the tab is gone — the workspace has no controlled
        // session from here (pending dispatches settle as `no_controlled_session`).
        handle?.close();
      },
    });
    if (!connection) return;
    // PRD 027 Req 10: registering REPLACES any earlier tab — the broker
    // sends it `session_replaced` and calls its transport's `close`, which
    // ends that socket with a normal close frame.
    handle = broker.register(workspaceId, {
      send: (message) => connection.send(encodeBridgeMessage(message)),
      close: () => connection.close(1000),
    });
  }

  return (req, socket, head) => {
    handle(req, socket, head).catch(() => {
      // Nothing is logged: the request URL carries the session token.
      if (!socket.destroyed) refuse(socket, 500, { error: 'internal server error' });
    });
  };
}
