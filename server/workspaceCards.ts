// PRD 010 Req 18: the small server-side card that makes a broken connection
// repairable. A repo-backed workspace keeps its manifest in ITS OWN repo, so
// when that repo cannot be reached there is nothing left in the deployment
// default to say what the workspace is called or who is allowed to fix it —
// which is exactly the moment someone needs to fix it.
//
// The card is that minimum: a display name, the workspace's creation stamp
// (the identity a reconnect target is proved against) and the ids that hold
// `workspace.settings`. It lives beside `workspaces/<id>/backend.json` in the
// deployment default, outside the workspace's `files/` prefix, and it is
// NEVER client-writable: it is derived from the manifest by the server every
// time the manifest is written, the create body's `storage` field and
// `validateWorkspaceBackend` are unchanged by it, and nothing of it is
// exposed beyond the connection surface and the listing's attention row.

import { resolvePermissions, type WorkspaceManifest } from '../src/lib/hostedWorkspace.ts';
import type { StorageProvider } from './providers/types.ts';
import { WORKSPACES_PREFIX } from './workspaces.ts';

/** What the card holds — nothing that is not needed to name and repair. */
export interface WorkspaceCard {
  name: string;
  /** The manifest's creation stamp: this workspace's durable identity. */
  created: string;
  /** The member ids resolving to `workspace.settings` — who may repair it. */
  admins: string[];
}

/** Where a workspace's card lives — outside its `files/` prefix, like the record. */
export function workspaceCardPath(id: string): string {
  return `${WORKSPACES_PREFIX}${id}/card.json`;
}

/**
 * PRD 010 Req 18: the card is a PROJECTION of the manifest, never a second
 * source of truth. Everyone-access is deliberately not consulted: a repair
 * grant has to name people, and `workspace.settings` is not a verb the
 * everyone role hands out.
 */
export function cardFromManifest(manifest: WorkspaceManifest): WorkspaceCard {
  const admins = manifest.members
    .map((m) => m.id)
    .filter((id) => resolvePermissions(manifest, id).has('workspace.settings'));
  return { name: manifest.name, created: manifest.created, admins };
}

export function serializeWorkspaceCard(card: WorkspaceCard): string {
  return JSON.stringify(card, null, 2);
}

/** A stored card, or null — a damaged card is simply no card (Req 18). */
export function parseWorkspaceCard(text: string): WorkspaceCard | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { name, created, admins } = value as Partial<WorkspaceCard>;
  if (typeof name !== 'string' || typeof created !== 'string') return null;
  if (!Array.isArray(admins) || !admins.every((a): a is string => typeof a === 'string')) return null;
  return { name, created, admins };
}

/**
 * PRD 010 Req 18: written wherever the manifest is written — create, the
 * whole-manifest PUT, and every member/role/everyone mutation that can change
 * the name or who holds `workspace.settings`. It goes to the DEPLOYMENT
 * DEFAULT store, never the workspace's own backend: a card in the unreachable
 * repo would be no use at the one moment it is wanted.
 */
export async function rememberWorkspaceCard(
  deploymentDefault: StorageProvider,
  id: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  await deploymentDefault.write(workspaceCardPath(id), serializeWorkspaceCard(cardFromManifest(manifest)));
}

/** The stored card, or null when there is none (every pre-#105 workspace). */
export async function readWorkspaceCard(
  deploymentDefault: StorageProvider,
  id: string,
): Promise<WorkspaceCard | null> {
  const stored = await deploymentDefault.read(workspaceCardPath(id));
  return stored ? parseWorkspaceCard(stored.content) : null;
}

/** Drop it with the workspace, so nothing of it outlives a delete. */
export async function forgetWorkspaceCard(deploymentDefault: StorageProvider, id: string): Promise<void> {
  await deploymentDefault.delete(workspaceCardPath(id));
}
