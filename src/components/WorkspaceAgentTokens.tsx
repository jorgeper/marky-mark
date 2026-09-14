// PRD 027 Req 3: the Agent tokens section of Workspace settings (the Manage
// tab) — where a holder of `workspace.settings` mints a workspace-scoped
// agent token, sees its plaintext exactly once, and lists and revokes the
// tokens that exist. Every call goes through the lifecycle seam's own fetch
// wrapper; the server (behind MM_AGENT_BRIDGE and the same verb) is the
// enforcement, this section only shows what it answered. The section mounts
// only with the agent-bridge experiment applied (PRD 027 Req 1), so with it
// off no agent-token request is ever made.

import { useEffect, useState } from 'react';
import type { AgentTokenRow, MintedAgentToken, WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { Button } from './ui/Button';
import { SectionHeader } from './ui/SectionHeader';

export interface WorkspaceAgentTokensProps {
  lifecycle: WorkspaceLifecycle;
  workspaceId: string;
}

/** A created date the row can show — the ISO stamp's calendar day, locale-formatted. */
function createdOn(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString();
}

export function WorkspaceAgentTokens({ lifecycle, workspaceId }: WorkspaceAgentTokensProps) {
  // null while the first list is in flight; `unavailable` when the server
  // has no such routes (PRD 027 Req 2: the deployment's flag is off).
  const [rows, setRows] = useState<AgentTokenRow[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [label, setLabel] = useState('');
  // PRD 027 Req 3: the freshly minted plaintext — held ONLY here, in
  // component state, so it is gone when the section re-lists (a revoke, a
  // second mint) or the panel closes. Nothing re-fetches it; nothing can.
  const [minted, setMinted] = useState<MintedAgentToken | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void lifecycle.listAgentTokens(workspaceId).then((listed) => {
      if (cancelled) return;
      if (listed === null) setUnavailable(true);
      else setRows(listed);
    });
    return () => {
      cancelled = true;
    };
  }, [lifecycle, workspaceId]);

  const mint = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Give the token a label — the agent it is for, say.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await lifecycle.mintAgentToken(workspaceId, trimmed);
    if (result.ok) {
      const { token: _token, ...row } = result.minted;
      setRows((current) => [...(current ?? []), row]);
      setMinted(result.minted);
      setLabel('');
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  const revoke = async (tokenId: string) => {
    setBusy(true);
    setError('');
    const revoked = await lifecycle.revokeAgentToken(workspaceId, tokenId);
    if (revoked) {
      // The list changed: the one-time plaintext is gone with it.
      setMinted(null);
      setRows((current) => (current ?? []).filter((row) => row.id !== tokenId));
    } else {
      setError('The token could not be revoked.');
    }
    setBusy(false);
  };

  return (
    <div className="workspace-agent-tokens" data-testid="agent-tokens-section">
      <SectionHeader>Agent tokens</SectionHeader>
      <p className="hotkey-hint">
        An agent token lets an MCP client such as Claude Code act on this workspace — and only this workspace.
        The token is shown once, when you mint it; revoking it stops the next request that presents it.
      </p>
      {unavailable ? (
        // PRD 027 Req 2: the experiment is on for this reader, but the
        // deployment did not turn the bridge on — a note, not an error, and
        // no mint control for a route that does not exist.
        <p className="hotkey-hint" data-testid="agent-tokens-unavailable">
          The agent bridge is not enabled on this deployment.
        </p>
      ) : (
        <>
          <div className="workspace-member-field">
            <label htmlFor="agent-token-label">Label for a new token</label>
            <div className="agent-token-mint-row">
              <input
                id="agent-token-label"
                data-testid="agent-token-label"
                className="field"
                type="text"
                placeholder="Claude Code on my laptop"
                value={label}
                disabled={busy || rows === null}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void mint();
                }}
              />
              <Button data-testid="agent-token-mint" disabled={busy || rows === null} onClick={() => void mint()}>
                Mint
              </Button>
            </div>
          </div>
          {minted && (
            <div className="agent-token-minted" data-testid="agent-token-minted">
              <p className="hotkey-hint">
                Copy the token for <strong>{minted.label}</strong> now — it will not be shown again.
              </p>
              <input
                data-testid="agent-token-plaintext"
                className="field agent-token-plaintext"
                type="text"
                readOnly
                value={minted.token}
                aria-label="New agent token"
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.currentTarget.select()}
              />
            </div>
          )}
          {rows !== null && rows.length === 0 && (
            <p className="hotkey-hint" data-testid="agent-tokens-empty">
              No agent tokens yet.
            </p>
          )}
          {rows?.map((row) => (
            <div className="agent-token-row" key={row.id} data-testid="agent-token-row">
              <span className="agent-token-row-label" data-testid="agent-token-row-label">
                {row.label}
              </span>
              <span className="agent-token-row-date" data-testid="agent-token-created">
                {createdOn(row.createdAt)}
              </span>
              <Button
                variant="danger"
                size="sm"
                data-testid="agent-token-revoke"
                disabled={busy}
                onClick={() => void revoke(row.id)}
              >
                Revoke
              </Button>
            </div>
          ))}
        </>
      )}
      {error && (
        <p className="workspace-settings-error" data-testid="agent-tokens-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
