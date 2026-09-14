// PRD 027 Req 14 (issue #363): the server half of the agent bridge — a
// session broker that holds at most ONE controlled tab per workspace,
// dispatches typed tool requests to it and correlates the typed results back.
// It is transport-agnostic: the tab is reached only through an injected
// `SessionTransport`, so the WebSocket route (issue #367) and the MCP
// endpoint (issue #365) plug in without this module knowing either. It
// imports the shared protocol module and nothing vendor-specific — no
// network call site, no `Providers`, no Azure — and mounts no route:
// nothing here is reachable until a later issue wires it up.

import { randomUUID } from 'node:crypto';
import {
  BRIDGE_PROTOCOL_VERSION,
  noControlledSessionError,
  type BridgeToolRequest,
  type BridgeToolResult,
  type EditorStateSnapshot,
  type ServerToTabMessage,
  type TabToServerMessage,
} from '../src/lib/agentBridgeProtocol.ts';

/**
 * PRD 027 Req 14 (issue #363): everything the broker needs from a transport.
 * `send` delivers one envelope to the tab; `close` tears the channel down
 * (the broker calls it after a takeover, Req 10). Inbound envelopes reach
 * the broker through the handle `register` returns, never through here.
 */
export interface SessionTransport {
  send(message: ServerToTabMessage): void;
  close(): void;
}

/** The handle a transport drives for the one session it registered. */
export interface SessionHandle {
  /** Feed one inbound envelope (already decoded) to the broker. */
  deliver(message: TabToServerMessage): void;
  /** The tab is gone or toggled off: tear the session down. */
  close(): void;
  /** Whether this handle still names the workspace's live session. */
  readonly active: boolean;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** A dispatchable request: everything but the correlation id, which the broker mints. */
export type BridgeToolCall = DistributiveOmit<BridgeToolRequest, 'id'>;

export interface SessionBroker {
  /**
   * PRD 027 Req 10 (issue #363): register the tab now controlling
   * `workspaceId`. A session already registered for that workspace is
   * replaced: it is told `session_replaced`, closed, and its pending
   * dispatches settle with `no_controlled_session`.
   */
  register(workspaceId: string, transport: SessionTransport): SessionHandle;
  /** Is a controlled session registered for this workspace? */
  has(workspaceId: string): boolean;
  /**
   * Send one tool request to the workspace's session and settle with its
   * result. Errors are returned AS DATA in the `{ ok: false }` shape — no
   * session, a timeout, a takeover, a teardown — never as a rejection.
   */
  dispatch(workspaceId: string, call: BridgeToolCall): Promise<BridgeToolResult>;
  /** The last snapshot the workspace's session pushed or returned, if any. */
  lastState(workspaceId: string): EditorStateSnapshot | null;
}

export interface SessionBrokerOptions {
  /** How long an unanswered request waits before settling with `timeout`. */
  timeoutMs?: number;
}

/** PRD 027 Req 11: interactive-fast round trips; an idle tab answers well within this. */
export const DEFAULT_DISPATCH_TIMEOUT_MS = 5_000;

interface Pending {
  resolve(result: BridgeToolResult): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Session {
  transport: SessionTransport;
  pending: Map<string, Pending>;
  lastState: EditorStateSnapshot | null;
  active: boolean;
}

/** PRD 027 Req 14 (issue #363): a broker holding at most one session per workspace. */
export function createSessionBroker(options: SessionBrokerOptions = {}): SessionBroker {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;
  const sessions = new Map<string, Session>();

  /** Settle every pending call of a session with `no_controlled_session` and forget it. */
  function settleAll(session: Session): void {
    for (const [id, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, id, error: noControlledSessionError() });
    }
    session.pending.clear();
  }

  /** Drop `session` if it is still the live one for `workspaceId`. */
  function retire(workspaceId: string, session: Session): void {
    if (!session.active) return;
    session.active = false;
    settleAll(session);
    if (sessions.get(workspaceId) === session) sessions.delete(workspaceId);
  }

  return {
    register(workspaceId, transport) {
      // PRD 027 Req 10 (issue #363): exactly one controlled tab per workspace.
      // The previous session learns it was replaced (its toggle turns off),
      // then its channel is closed; the new session takes over from here.
      const previous = sessions.get(workspaceId);
      if (previous) {
        retire(workspaceId, previous);
        previous.transport.send({ v: BRIDGE_PROTOCOL_VERSION, kind: 'session_replaced' });
        previous.transport.close();
      }
      const session: Session = { transport, pending: new Map(), lastState: null, active: true };
      sessions.set(workspaceId, session);
      return {
        get active() {
          return session.active;
        },
        deliver(message) {
          // A stale handle (replaced or closed) is inert: nothing it delivers
          // can settle the live session's requests.
          if (!session.active) return;
          if (message.kind === 'state') {
            session.lastState = message.state;
            return;
          }
          const pending = session.pending.get(message.result.id);
          // Unknown or already-settled (timed out) ids are ignored.
          if (!pending) return;
          session.pending.delete(message.result.id);
          clearTimeout(pending.timer);
          if (message.result.ok) session.lastState = message.result.state;
          pending.resolve(message.result);
        },
        close() {
          retire(workspaceId, session);
        },
      };
    },

    has(workspaceId) {
      return sessions.has(workspaceId);
    },

    dispatch(workspaceId, call) {
      const session = sessions.get(workspaceId);
      const id = randomUUID();
      if (!session) return Promise.resolve({ ok: false, id, error: noControlledSessionError() });
      const request: BridgeToolRequest = { ...call, id };
      return new Promise<BridgeToolResult>((resolve) => {
        const timer = setTimeout(() => {
          if (!session.pending.delete(id)) return;
          resolve({ ok: false, id, error: { code: 'timeout', message: `${call.tool} did not answer within ${timeoutMs}ms` } });
        }, timeoutMs);
        session.pending.set(id, { resolve, timer });
        session.transport.send({ v: BRIDGE_PROTOCOL_VERSION, kind: 'tool_request', request });
      });
    },

    lastState(workspaceId) {
      return sessions.get(workspaceId)?.lastState ?? null;
    },
  };
}
