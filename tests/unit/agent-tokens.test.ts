import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AGENT_TOKEN_SCOPE_ERROR,
  agentTokensPrefix,
  checkAgentTokenScope,
  listAgentTokens,
  mintAgentToken,
  resolveAgentToken,
  revokeAgentToken,
} from '../../server/agentTokens';
import { createMemoryStorage } from './storage-contract';

// PRD 027 Reqs 3+4: the agent-token module against the in-memory storage
// seam — mint/hash/list/revoke and the token-auth helper every later bridge
// sub-issue consumes.
describe('PRD 027 Reqs 3+4 agent tokens', () => {
  it('U1386: mint answers the plaintext once and stores only a SHA-256 hash with {id, label, createdAt} under the workspace prefix', async () => {
    const { provider, blobs } = createMemoryStorage();
    const minted = await mintAgentToken(provider, 'ws-1', 'Claude Code', () => new Date('2026-09-14T10:00:00Z'));
    expect(minted.label).toBe('Claude Code');
    expect(minted.createdAt).toBe('2026-09-14T10:00:00.000Z');
    expect(minted.id).toMatch(/^[0-9a-f-]{36}$/);
    // ≥32 bytes of entropy: the hex tail is 64 characters, and two mints
    // never collide.
    expect(minted.token).toMatch(/^mmat_ws-1_[0-9a-f]{64}$/);
    const again = await mintAgentToken(provider, 'ws-1', 'Second');
    expect(again.token).not.toBe(minted.token);

    // Storage: one blob per token, named by the hash, under workspaces/<id>/
    // (so PRD 007 Req 12's whole-prefix delete takes the tokens with it).
    const hash = createHash('sha256').update(minted.token).digest('hex');
    expect(agentTokensPrefix('ws-1')).toBe('workspaces/ws-1/agent-tokens/');
    expect(blobs.has(`workspaces/ws-1/agent-tokens/${hash}.json`)).toBe(true);
    expect(JSON.parse(blobs.get(`workspaces/ws-1/agent-tokens/${hash}.json`)!)).toEqual({
      id: minted.id,
      label: 'Claude Code',
      createdAt: '2026-09-14T10:00:00.000Z',
    });
    // Nothing stored anywhere contains the plaintext.
    for (const content of blobs.values()) expect(content).not.toContain(minted.token);
    for (const path of blobs.keys()) expect(path).not.toContain(minted.token.slice(-64));
  });

  it('U1387: resolve succeeds for a live token and answers null for unknown, malformed and revoked ones — with no cache', async () => {
    const { provider, blobs } = createMemoryStorage();
    const minted = await mintAgentToken(provider, 'ws-1', 'live');
    expect(await resolveAgentToken(provider, minted.token)).toEqual({ workspaceId: 'ws-1', tokenId: minted.id });

    // Unknown: right shape, wrong secret. Malformed: not a token at all.
    expect(await resolveAgentToken(provider, `mmat_ws-1_${'0'.repeat(64)}`)).toBeNull();
    expect(await resolveAgentToken(provider, 'not-a-token')).toBeNull();
    expect(await resolveAgentToken(provider, '')).toBeNull();
    // A token minted for another workspace does not resolve as this one's,
    // even with the id swapped in the text — the hash is over the whole text.
    const swapped = minted.token.replace('mmat_ws-1_', 'mmat_ws-2_');
    expect(await resolveAgentToken(provider, swapped)).toBeNull();

    // Revoked: the record is gone and the very next resolve fails.
    expect(await revokeAgentToken(provider, 'ws-1', minted.id)).toBe(true);
    expect(await resolveAgentToken(provider, minted.token)).toBeNull();
    expect([...blobs.keys()].filter((p) => p.startsWith('workspaces/ws-1/agent-tokens/'))).toEqual([]);
    // Revoking again, or an id that never existed, is false — not a throw.
    expect(await revokeAgentToken(provider, 'ws-1', minted.id)).toBe(false);
    expect(await revokeAgentToken(provider, 'ws-1', 'nope')).toBe(false);
    // Revoke is workspace-scoped: another workspace's id does nothing here.
    const other = await mintAgentToken(provider, 'ws-2', 'elsewhere');
    expect(await revokeAgentToken(provider, 'ws-1', other.id)).toBe(false);
    expect(await resolveAgentToken(provider, other.token)).toEqual({ workspaceId: 'ws-2', tokenId: other.id });
  });

  it('U1388: the scope check refuses another workspace and any path outside workspaces/<id>/ with the one stable error', () => {
    const resolved = { workspaceId: 'ws-1', tokenId: 't1' };
    expect(checkAgentTokenScope(resolved, 'ws-1')).toEqual({ ok: true });
    expect(checkAgentTokenScope(resolved, 'ws-1', 'workspaces/ws-1/files/a.md')).toEqual({ ok: true });
    expect(checkAgentTokenScope(resolved, 'ws-1', 'workspaces/ws-1/manifest.json')).toEqual({ ok: true });

    const refused = { ok: false, error: AGENT_TOKEN_SCOPE_ERROR };
    expect(checkAgentTokenScope(resolved, 'ws-2')).toEqual(refused);
    expect(checkAgentTokenScope(resolved, 'ws-1', 'workspaces/ws-2/files/a.md')).toEqual(refused);
    expect(checkAgentTokenScope(resolved, 'ws-1', 'workspaces/ws-10/files/a.md')).toEqual(refused);
    expect(checkAgentTokenScope(resolved, 'ws-1', 'users/u/settings.json')).toEqual(refused);
    expect(checkAgentTokenScope(resolved, 'ws-1', 'workspaces/ws-1/../ws-2/files/a.md')).toEqual(refused);
    expect(checkAgentTokenScope(resolved, 'ws-1', '')).toEqual(refused);
    expect(AGENT_TOKEN_SCOPE_ERROR).toEqual({
      code: 'agent_token_out_of_scope',
      message: 'agent token not authorized for this workspace',
    });
  });

  it('U1389: list rows carry id, label and createdAt only — never the plaintext or the hash — in creation order', async () => {
    const { provider } = createMemoryStorage();
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 8, 14, 0, 0, tick++));
    const first = await mintAgentToken(provider, 'ws-1', 'first', clock);
    const second = await mintAgentToken(provider, 'ws-1', 'second', clock);
    await mintAgentToken(provider, 'ws-2', 'other workspace', clock);

    const rows = await listAgentTokens(provider, 'ws-1');
    expect(rows).toEqual([
      { id: first.id, label: 'first', createdAt: first.createdAt },
      { id: second.id, label: 'second', createdAt: second.createdAt },
    ]);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['createdAt', 'id', 'label']);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(first.token.slice(-64));
    expect(serialized).not.toContain(createHash('sha256').update(first.token).digest('hex'));
    expect(await listAgentTokens(provider, 'ws-3')).toEqual([]);
  });
});
