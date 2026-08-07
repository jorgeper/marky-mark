// PRD 010 Req 3: which backend backs which workspace. A deployment can hold
// workspaces on more than one store, so the answer is a durable per-workspace
// record — `workspaces/<id>/backend.json` in the DEPLOYMENT DEFAULT store,
// deliberately outside the workspace's `files/` prefix and deliberately NOT
// in the manifest: the manifest lives in the workspace's own backend, and the
// backend has to be known before anything there can be read.
//
// A workspace with no record is served by the deployment default — which is
// every workspace an existing deployment already has, so this ships with no
// migration step and no startup rewrite.
//
// Nothing here reaches the client: the record is not in any API response, not
// in a file listing (it is outside `files/`), and not reachable through the
// `files/<path>` routes.

import { GITHUB_STORAGE_KIND } from './providers/github/storage.ts';
import type { StorageProvider } from './providers/types.ts';
import { WORKSPACES_PREFIX } from './workspaces.ts';

/**
 * PRD 010 Req 3: what a record may say. One kind ships here — the deployment
 * default; `repo` is the shape #103's BYO connection fills in, validated the
 * same way so that issue supplies contents rather than plumbing.
 */
export type WorkspaceBackendRecord =
  | { kind: 'deployment-default' }
  | { kind: 'repo'; owner: string; repo: string; branch: string; root?: string };

/** A validated record, or the named reason it is not one. */
export type WorkspaceBackendResult =
  | { ok: true; record: WorkspaceBackendRecord }
  | { ok: false; error: string };

/** Where a workspace's record lives — outside its `files/` prefix (Req 3). */
export function backendRecordPath(id: string): string {
  return `${WORKSPACES_PREFIX}${id}/backend.json`;
}

const BACKEND_RECORD_RE = /^workspaces\/([^/]+)\/backend\.json$/;

/**
 * PRD 010 Req 17: the workspace id a blob path names as a backend record, or
 * null. `GET /api/workspaces` enumerates the UNION of the manifest scan and
 * these — a BYO workspace's manifest lives in its own repo, so the record is
 * the only trace of it in the deployment default store.
 */
export function backendRecordWorkspaceId(blobPath: string): string | null {
  return BACKEND_RECORD_RE.exec(blobPath)?.[1] ?? null;
}

/**
 * PRD 010 Req 21: whether deleting from this store leaves the content in a
 * repository's history — the one place the app asks it, against the kind the
 * provider itself spells, so the two cannot drift. Null (a store that could
 * not be resolved) is `false`: the stricter promise is the safe one to make
 * about an unknown backend.
 *
 * It answers about the STORE, not about a connection — a workspace on a
 * `github` deployment default and a BYO repo workspace are alike here, which
 * is what keeps PRD 010 Req 3 intact when the client renders it.
 */
export function retainsHistory(store: Pick<StorageProvider, 'kind'> | null | undefined): boolean {
  return store?.kind === GITHUB_STORAGE_KIND;
}

const fail = (error: string): WorkspaceBackendResult => ({ ok: false, error });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * PRD 010 Req 3: parsed through a typed validator that REJECTS malformed data
 * with a named error rather than coercing it — the stance
 * `validateWorkspaceManifest` takes (and the shape it is written in), for the
 * same reason: silently reading a damaged record as "the default" would serve
 * a workspace from the wrong store.
 */
export function validateWorkspaceBackend(value: unknown): WorkspaceBackendResult {
  if (!isPlainObject(value)) return fail('backend record must be an object');
  const { kind, owner, repo, branch, root } = value;
  if (kind === 'deployment-default') return { ok: true, record: { kind } };
  if (kind !== 'repo') {
    return fail(`backend record kind must be 'deployment-default' or 'repo', got ${describeValue(kind)}`);
  }
  if (!isNonEmptyString(owner)) return fail('backend record owner must be a non-empty string');
  if (!isNonEmptyString(repo)) return fail('backend record repo must be a non-empty string');
  if (!isNonEmptyString(branch)) return fail('backend record branch must be a non-empty string');
  if (root !== undefined && typeof root !== 'string') {
    return fail('backend record root must be a string when present');
  }
  return { ok: true, record: { kind, owner, repo, branch, ...(root === undefined ? {} : { root }) } };
}

/** How a rejected value is named in an error — never the value itself. */
function describeValue(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : typeof value;
}

/** Parse a stored record. Malformed JSON is a named error like any other. */
export function parseWorkspaceBackend(text: string): WorkspaceBackendResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'backend record is not valid JSON' };
  }
  return validateWorkspaceBackend(value);
}

export function serializeWorkspaceBackend(record: WorkspaceBackendRecord): string {
  return JSON.stringify(record, null, 2);
}

/**
 * PRD 010 Req 3: the ONE thing request handling resolves storage through.
 * `server/workspaces.ts` asks this per workspace instead of reading a
 * process-wide `providers.storage`, so a workspace on another backend is
 * served from it with no further plumbing.
 */
export interface WorkspaceBackends {
  /** The deployment default — per-user files and the legacy scaffold's store. */
  readonly deploymentDefault: StorageProvider;
  /** The storage backing this workspace. No record means the default. */
  forWorkspace(id: string): Promise<StorageProvider>;
  /**
   * PRD 010 Req 17: the same resolution for a record that is not stored yet —
   * what create uses to PROVE a repo connection (reachable, `contents:
   * write`) before the record, the manifest or any commit exists.
   */
  connect(record: WorkspaceBackendRecord, id: string): Promise<StorageProvider>;
  /** Write the record a newly created workspace gets. */
  remember(id: string, record: WorkspaceBackendRecord): Promise<void>;
  /** Drop it again when the workspace is deleted. */
  forget(id: string): Promise<void>;
}

export interface WorkspaceBackendsOptions {
  deploymentDefault: StorageProvider;
  /**
   * How a record that is not the deployment default becomes a provider.
   * Optional: a deployment with no GitHub App section configured cannot
   * connect one at all, and says so by name rather than falling back to the
   * default store (PRD 010 Req 17).
   */
  connect?: (record: WorkspaceBackendRecord, id: string) => Promise<StorageProvider> | StorageProvider;
}

export function createWorkspaceBackends(options: WorkspaceBackendsOptions): WorkspaceBackends {
  const { deploymentDefault, connect } = options;

  const resolve = async (record: WorkspaceBackendRecord, id: string): Promise<StorageProvider> => {
    if (record.kind === 'deployment-default') return deploymentDefault;
    if (!connect) {
      throw new Error(`workspace ${id} names a repo backend this deployment cannot connect to`);
    }
    return connect(record, id);
  };

  return {
    deploymentDefault,
    connect: resolve,
    async forWorkspace(id: string): Promise<StorageProvider> {
      const stored = await deploymentDefault.read(backendRecordPath(id));
      // No record: every workspace an existing deployment already has.
      if (!stored) return deploymentDefault;
      const parsed = parseWorkspaceBackend(stored.content);
      // A damaged record is refused, never coerced — the caller turns this
      // into a 500 the way a corrupt manifest already is.
      if (!parsed.ok) throw new Error(`corrupt workspace backend record: ${parsed.error}`);
      return resolve(parsed.record, id);
    },
    async remember(id: string, record: WorkspaceBackendRecord): Promise<void> {
      await deploymentDefault.write(backendRecordPath(id), serializeWorkspaceBackend(record));
    },
    async forget(id: string): Promise<void> {
      await deploymentDefault.delete(backendRecordPath(id));
    },
  };
}
