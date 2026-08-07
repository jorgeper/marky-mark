// PRD 010 Req 18: life after connecting — the ONE decision point every
// connection question resolves through, so no route invents its own answer.
//
//   * what a repo-backed workspace's connection IS, and whether the
//     deployment's App installation still reaches it (the settings surface);
//   * who may repair it when it does not (the manifest lives in the
//     unreachable repo, so the card in `server/workspaceCards.ts` is what
//     authorises the repair);
//   * what a reconnect must PROVE before the stored record changes;
//   * and how a connection failure — anywhere, on open, on listing or on
//     save — becomes a named, actionable status instead of a bare 500.
//
// The failure vocabulary is `githubFailureDetail`'s and nobody else's: the
// message is the thrown error's own sentence, and only the STATUS is decided
// here, from the status the store reported (duck typed, so this module stays
// free of any vendor import). GitHub refusing or not having it is the
// operator's connection being wrong (400); GitHub itself failing is a bad
// gateway (502). No credential, App JWT or installation token is read,
// returned or logged — nothing here even holds one.

import { parseWorkspaceManifest, resolvePermissions, type WorkspaceManifest } from '../src/lib/hostedWorkspace.ts';
import type { ConnectionHealth, WorkspaceConnectionPayload } from '../src/lib/workspaceConnection.ts';
import {
  validateWorkspaceBackend,
  type WorkspaceBackendRecord,
  type WorkspaceBackends,
} from './backends.ts';
import type { RequestAuth, StorageProvider } from './providers/types.ts';
import { readWorkspaceCard } from './workspaceCards.ts';
import { WORKSPACES_PREFIX } from './workspaces.ts';

/** The manifest's seam path, in the one spelling every backend maps. */
const manifestSeamPath = (id: string): string => `${WORKSPACES_PREFIX}${id}/manifest.json`;

/**
 * PRD 010 Req 18: the status a connection failure resolves to. The split is
 * the one create already makes: a status GitHub itself failed on is a 502,
 * anything else — refused, revoked, deleted, renamed — is a 400 the admin can
 * act on. A thrown error with no status at all is a server-side data problem
 * (a corrupt record), which stays the 500 it already was.
 */
export function connectionFailureStatus(err: unknown): number {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return 500;
  return status >= 500 ? 502 : 400;
}

/** Is this a connection failure at all, or an ordinary server-side error? */
export function isConnectionFailure(err: unknown): boolean {
  return typeof (err as { status?: unknown } | null)?.status === 'number';
}

/**
 * PRD 010 Req 18: the sentence a lost connection is reported with. It is the
 * thrown error's own message — `githubFailureDetail` already phrases "the App
 * is not installed there", "no such repository", "the rate limit is
 * exhausted" — with one lead-in naming what the reader can do about it. Never
 * a stack, never a response dump, never `“workspace <id>” is no longer there`.
 */
export function connectionFailureMessage(err: unknown): string {
  const message = (err as Error | null)?.message ?? 'the connected repository could not be reached';
  return `This workspace’s connected repository could not be reached: ${message}`;
}

/**
 * PRD 010 Req 18: is the connection live? One probe — the connected store's
 * own fail-fast writability check (`init()`, PRD 010 Req 6), which is exactly
 * what create proves before a workspace exists. Answering it here means the
 * settings surface and create agree by construction rather than by wording.
 */
export async function probeConnection(
  backends: WorkspaceBackends,
  record: WorkspaceBackendRecord,
  id: string,
): Promise<ConnectionHealth> {
  try {
    const store = await backends.connect(record, id);
    await store.init?.();
    return { state: 'ok' };
  } catch (err) {
    return connectionFailureStatus(err) === 502
      ? { state: 'unavailable', message: connectionFailureMessage(err) }
      : { state: 'blocked', message: connectionFailureMessage(err) };
  }
}

/** The stored record, or null when the workspace is on the deployment default. */
export async function storedRepoRecord(
  backends: WorkspaceBackends,
  id: string,
): Promise<Extract<WorkspaceBackendRecord, { kind: 'repo' }> | null> {
  const stored = await backends.deploymentDefault.read(`${WORKSPACES_PREFIX}${id}/backend.json`);
  if (!stored) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored.content);
  } catch {
    return null;
  }
  const parsed = validateWorkspaceBackend(value);
  return parsed.ok && parsed.record.kind === 'repo' ? parsed.record : null;
}

/**
 * PRD 010 Req 18: the connection surface's payload. A workspace that is not
 * repo-backed answers `{connected: false}` — no section, no empty state, no
 * "default storage" label, because Req 3 says nothing in the client reveals
 * which backend a default workspace uses.
 */
export async function connectionPayload(
  backends: WorkspaceBackends,
  id: string,
): Promise<WorkspaceConnectionPayload> {
  const record = await storedRepoRecord(backends, id);
  if (!record) return { connected: false };
  return {
    connected: true,
    owner: record.owner,
    repo: record.repo,
    branch: record.branch,
    ...(record.root ? { root: record.root } : {}),
    health: await probeConnection(backends, record, id),
  };
}

/**
 * PRD 010 Req 18: may this caller manage the connection? The manifest is the
 * answer whenever it can be read — the same `workspace.settings` resolution
 * every other settings verb uses. When it CANNOT be read, which is precisely
 * the broken-connection case this issue exists for, the deployment-default
 * card answers instead: that is the whole reason it is written.
 */
export async function mayRepairConnection(
  backends: WorkspaceBackends,
  id: string,
  auth: RequestAuth,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  let manifest: WorkspaceManifest | null = null;
  try {
    const store = await backends.forWorkspace(id);
    const blob = await store.read(manifestSeamPath(id));
    const parsed = blob ? parseWorkspaceManifest(blob.content) : null;
    if (parsed?.ok) manifest = parsed.manifest;
  } catch {
    // The connection is down. That is not an authorisation answer — the card
    // below is — so nothing is decided from this failure.
  }
  if (manifest) {
    if (resolvePermissions(manifest, auth.user.id).has('workspace.settings')) return { ok: true };
    return { ok: false, status: 403, error: 'forbidden' };
  }
  const card = await readWorkspaceCard(backends.deploymentDefault, id);
  if (!card) return { ok: false, status: 404, error: 'no such workspace' };
  if (!card.admins.includes(auth.user.id)) return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true };
}

/** A refused reconnect: the named reason, shown in the wizard verbatim. */
export type ReconnectResult =
  | { ok: true; record: Extract<WorkspaceBackendRecord, { kind: 'repo' }> }
  | { ok: false; status: number; error: string };

/**
 * PRD 010 Req 18: a reconnect is REPAIR, not migration. Everything below has
 * to hold before the stored record is touched, and nothing is written to the
 * new target at any point — the manifest is read there, never created there:
 *
 *  - the workspace's stored record is already `kind: 'repo'` (a
 *    default-storage workspace has no reconnect path at all);
 *  - the new target is reachable with write access (the same `init()` probe
 *    create fails fast on);
 *  - and it already carries THIS workspace's own
 *    `<root>/.marky-mark/manifest.json` — proved against the card's creation
 *    stamp, so an unrelated repo that merely happens to hold a manifest is
 *    refused too.
 *
 * Every refusal leaves the stored record exactly as it was.
 */
export async function proveReconnect(
  backends: WorkspaceBackends,
  id: string,
  requested: unknown,
): Promise<ReconnectResult> {
  const existing = await storedRepoRecord(backends, id);
  if (!existing) {
    return {
      ok: false,
      status: 409,
      error:
        'This workspace is not stored in a connected repository, so there is no connection to repair. ' +
        'Reconnecting cannot move a workspace between backends.',
    };
  }
  const validated = validateWorkspaceBackend(requested);
  if (!validated.ok) return { ok: false, status: 400, error: `connection: ${validated.error}` };
  if (validated.record.kind !== 'repo') {
    return { ok: false, status: 400, error: 'connection: a reconnect must name a repository.' };
  }
  const record = validated.record;

  let store: StorageProvider;
  try {
    store = await backends.connect(record, id);
    await store.init?.();
  } catch (err) {
    return { ok: false, status: connectionFailureStatus(err) === 502 ? 502 : 400, error: (err as Error).message };
  }

  let manifestBlob: { content: string } | null;
  try {
    manifestBlob = await store.read(manifestSeamPath(id));
  } catch (err) {
    return { ok: false, status: connectionFailureStatus(err) === 502 ? 502 : 400, error: (err as Error).message };
  }
  const parsed = manifestBlob ? parseWorkspaceManifest(manifestBlob.content) : null;
  if (!parsed?.ok) {
    return {
      ok: false,
      status: 400,
      error:
        `${record.owner}/${record.repo} on ${record.branch} does not hold this workspace at ` +
        `${record.root ? `${record.root}/` : 'the repository root'} — nothing was changed. ` +
        'Check the branch and the subdirectory.',
    };
  }
  const card = await readWorkspaceCard(backends.deploymentDefault, id);
  if (card && parsed.manifest.created !== card.created) {
    return {
      ok: false,
      status: 400,
      error:
        `${record.owner}/${record.repo} holds a DIFFERENT workspace’s data — nothing was changed. ` +
        'Reconnecting repairs this workspace’s own connection; it does not adopt another one.',
    };
  }
  return { ok: true, record };
}
