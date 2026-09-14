// PRD 027 Reqs 3+4: workspace-scoped agent tokens — minting, hashing, lookup,
// revocation and the scope check — through the StorageProvider seam only (no
// Azure specifics, no server-local state, no cache).
//
// THIS IS THE ONE AUTH PATH FOR AGENTS. The MCP endpoint (#365), the session
// tools and every later bridge sub-issue authenticate a presented token with
// `resolveAgentToken` and authorize the request with `checkAgentTokenScope`;
// none of them adds a second lookup, a second hash scheme or a second notion
// of "which workspace may this token touch". A token authorizes exactly its
// own workspace, nothing else.
//
// Storage layout (PRD 027 Req 3): the record of one token lives at
// `workspaces/<id>/agent-tokens/<sha256-hex>.json` — under the workspace's
// own prefix, so PRD 007 Req 12's whole-prefix delete already removes a
// deleted workspace's tokens — and holds ONLY `{id, label, createdAt}`. The
// plaintext is never stored, never logged and never answered after mint.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AgentTokenRow, MintedAgentToken } from '../src/lib/workspaceLifecycle.ts';
import type { StorageProvider } from './providers/types.ts';
import { WORKSPACES_PREFIX } from './workspaces.ts';

// PRD 027 Req 3: the wire shapes are shared with the client (one definition,
// in src/lib) and re-exported here so this module's consumers name them
// beside the functions that produce them.
export type { AgentTokenRow, MintedAgentToken };

/** PRD 027 Req 4: what a live token resolves to. */
export interface ResolvedAgentToken {
  workspaceId: string;
  tokenId: string;
}

/**
 * PRD 027 Req 4: the explicit authorization refusal — a stable code and one
 * message, so every consumer answers the same thing for out-of-scope use.
 */
export const AGENT_TOKEN_SCOPE_ERROR = {
  code: 'agent_token_out_of_scope',
  message: 'agent token not authorized for this workspace',
} as const;

/**
 * PRD 027 Req 4: the authentication refusal — what a request presenting no
 * token, a malformed one, an unknown one or a revoked one is answered with
 * (HTTP 401 from the MCP endpoint). Sibling of the scope error above: same
 * shape, one constant, so every consumer answers the same thing.
 */
export const AGENT_TOKEN_UNAUTHORIZED_ERROR = {
  code: 'agent_token_unauthorized',
  message: 'a valid agent token is required (Authorization: Bearer <token>)',
} as const;

export type AgentTokenScopeCheck =
  | { ok: true }
  | { ok: false; error: typeof AGENT_TOKEN_SCOPE_ERROR };

const OUT_OF_SCOPE: AgentTokenScopeCheck = { ok: false, error: AGENT_TOKEN_SCOPE_ERROR };

/**
 * The token text: a fixed prefix, the workspace id, and 32 bytes of CSPRNG
 * entropy as 64 hex characters. Carrying the workspace id in the text is what
 * makes `resolveAgentToken` one storage read — it knows which prefix to look
 * under — without leaking anything: the id is not a secret, and the hex tail
 * is the whole secret. Hex (not base64url) so the `_` separators stay
 * unambiguous whatever an id contains.
 */
const TOKEN_PREFIX = 'mmat_';
const SECRET_BYTES = 32;
const TOKEN_RE = /^mmat_(.+)_([0-9a-f]{64})$/;

/** PRD 027 Req 3: where one workspace's token records live. */
export const agentTokensPrefix = (workspaceId: string): string =>
  `${WORKSPACES_PREFIX}${workspaceId}/agent-tokens/`;

const recordBlob = (workspaceId: string, hash: string): string =>
  `${agentTokensPrefix(workspaceId)}${hash}.json`;

/** SHA-256 of the whole token text — the blob name and the only thing stored. */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The stored record's shape, refused when a blob does not parse to it. */
function parseRow(content: string): AgentTokenRow | null {
  try {
    const raw = JSON.parse(content) as Partial<AgentTokenRow> | null;
    if (
      raw &&
      typeof raw.id === 'string' &&
      typeof raw.label === 'string' &&
      typeof raw.createdAt === 'string'
    ) {
      return { id: raw.id, label: raw.label, createdAt: raw.createdAt };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * PRD 027 Req 3: mint. Generates the token (≥32 bytes of CSPRNG entropy),
 * stores its hash and `{id, label, createdAt}` under the workspace's prefix,
 * and returns the plaintext to the caller — the one and only time it exists
 * outside the caller's hands.
 */
export async function mintAgentToken(
  storage: StorageProvider,
  workspaceId: string,
  label: string,
  now: () => Date = () => new Date(),
): Promise<MintedAgentToken> {
  const token = `${TOKEN_PREFIX}${workspaceId}_${randomBytes(SECRET_BYTES).toString('hex')}`;
  const row: AgentTokenRow = { id: randomUUID(), label, createdAt: now().toISOString() };
  await storage.write(recordBlob(workspaceId, hashToken(token)), JSON.stringify(row));
  return { ...row, token };
}

/** PRD 027 Req 3: every live token of a workspace as rows — no plaintext, no hash. */
export async function listAgentTokens(storage: StorageProvider, workspaceId: string): Promise<AgentTokenRow[]> {
  const rows: AgentTokenRow[] = [];
  for (const blob of await storage.list(agentTokensPrefix(workspaceId))) {
    const stored = await storage.read(blob.path);
    const row = stored ? parseRow(stored.content) : null;
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * PRD 027 Req 3: revoke by row id — the record is deleted, so the next
 * request presenting that token finds nothing (Req 4: no cache anywhere).
 * Resolves false when the workspace holds no token with that id.
 */
export async function revokeAgentToken(
  storage: StorageProvider,
  workspaceId: string,
  tokenId: string,
): Promise<boolean> {
  for (const blob of await storage.list(agentTokensPrefix(workspaceId))) {
    const stored = await storage.read(blob.path);
    const row = stored ? parseRow(stored.content) : null;
    if (row?.id === tokenId) return storage.delete(blob.path);
  }
  return false;
}

/**
 * PRD 027 Req 4: the token-auth helper. A presented token resolves to its
 * workspace and row id, or to null for anything unknown, malformed or
 * revoked. ONE storage read per call — the token text names the workspace
 * and its hash names the blob, so there is no scan across workspaces — and
 * no in-memory cache, so a revocation is honoured by the very next request.
 */
export async function resolveAgentToken(
  storage: StorageProvider,
  token: string,
): Promise<ResolvedAgentToken | null> {
  const match = TOKEN_RE.exec(token);
  if (!match) return null;
  const workspaceId = match[1];
  const stored = await storage.read(recordBlob(workspaceId, hashToken(token)));
  const row = stored ? parseRow(stored.content) : null;
  return row ? { workspaceId, tokenId: row.id } : null;
}

/**
 * PRD 027 Req 4: the scope check every consumer runs after resolving. A
 * token authorizes only its own workspace; with a `path`, only a blob under
 * that workspace's own prefix (`workspaces/<id>/…`). Anything else answers
 * the explicit refusal above — the same shape from the MCP file tools, the
 * session tools and any later consumer.
 */
export function checkAgentTokenScope(
  resolved: ResolvedAgentToken,
  workspaceId: string,
  path?: string,
): AgentTokenScopeCheck {
  if (workspaceId !== resolved.workspaceId) return OUT_OF_SCOPE;
  if (path !== undefined) {
    const prefix = `${WORKSPACES_PREFIX}${resolved.workspaceId}/`;
    // A normalised-looking path that climbs out of the prefix is out of scope
    // exactly like a path under another workspace.
    if (!path.startsWith(prefix) || path.split('/').includes('..')) return OUT_OF_SCOPE;
  }
  return { ok: true };
}
