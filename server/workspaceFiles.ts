// PRD 007 Req 7 + PRD 027 Req 6: the workspace FILE semantics — list, read,
// save (with PRD 007 Req 20 If-Match and the PRD 016 Req 7–8 three-way merge)
// and upload (PRD 007 Req 19's type/size/409 rule) — factored out of the
// route switch in server/workspaces.ts so they exist ONCE. Two callers share
// them: `handleWorkspaceApi` (the `/api/workspaces/<id>/files*` and `upload`
// routes, which authorize with `requirePermission`) and the MCP file tools
// in server/mcp.ts (which authorize with the agent token). Neither layer
// re-implements a storage rule; a rule that changes here changes for both.
//
// Nothing here sends a response or checks a permission — each function
// answers a plain outcome and the caller maps it to its own wire shape
// (an HTTP status, or a tools/call error result).

import type { FileStat, StorageProvider } from './providers/types.ts';
import { uploadRejection, uploadTypeRejection } from '../src/lib/fileTransfer.ts';
import { contentTypeFor } from './contentTypes.ts';
import { mergeThreeWay } from './merge.ts';

/** PRD 007 Req 7: the root prefix all workspace data lives under. */
export const WORKSPACES_PREFIX = 'workspaces/';

/** PRD 007 Req 7: where one workspace's documents and assets live. */
export const filesPrefix = (id: string): string => `${WORKSPACES_PREFIX}${id}/files/`;

/** The basename of a workspace-relative path (`a/b/c.png` → `c.png`). */
export function basenameOf(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1);
}

/**
 * Does this exact blob exist? A metadata listing rather than a read: the
 * create-vs-save decision must not pay for downloading the bytes it is about
 * to replace. Prefix listings can return neighbours (`a.md` matches `a.md2`),
 * so the exact path is what counts.
 */
export async function blobExists(storage: StorageProvider, path: string): Promise<boolean> {
  return (await storage.list(path)).some((b) => b.path === path);
}

/**
 * PRD 007 Req 7: the workspace's files with workspace-relative paths — the
 * rows `GET /api/workspaces/<id>/files` answers. The manifest never appears
 * because it lives outside the files/ prefix.
 */
export async function listWorkspaceFiles(storage: StorageProvider, id: string): Promise<FileStat[]> {
  const prefix = filesPrefix(id);
  const listed = await storage.list(prefix);
  return listed.map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
}

/**
 * PRD 007 Req 7: one file as utf-8 text with its ETag — what
 * `GET /api/workspaces/<id>/files/<path>` answers — or null when absent.
 */
export async function readWorkspaceFile(
  storage: StorageProvider,
  id: string,
  filePath: string,
): Promise<{ path: string; content: string; etag: string } | null> {
  const file = await storage.read(filesPrefix(id) + filePath);
  return file ? { path: filePath, ...file } : null;
}

/**
 * PRD 016 Req 8: the structured-file guard. A LINE merge knows nothing about
 * syntax, so two clean edits to different lines of a JSON document can produce
 * a file that no longer parses — and the comment sidecars (`src/lib/sidecar.ts`)
 * are exactly such documents. A merged `.json` that does not `JSON.parse` is
 * refused, so the 412 and its dialog are what the user gets rather than a
 * committed file the app can no longer read.
 */
function mergeKeepsFileWellFormed(filePath: string, text: string): boolean {
  if (!/\.json$/i.test(filePath)) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * PRD 016 Req 8: how many times the read-merge-write is re-run when the
 * merged write itself loses a race. Small on purpose: each attempt is a
 * fresh head read and a fresh merge, so a blob busy enough to beat this
 * many times over is one the user should be told about rather than one to
 * keep hammering. Running out answers 412 — never an unconditional write.
 */
const MERGE_ATTEMPTS = 3;

/**
 * PRD 016 Req 8: the merge attempt that sits between "the conditional write
 * lost" and "answer 412". Answers the landed merge, or null for every
 * reason the caller must turn back into today's 412:
 *
 *  - the save carried no base (the client's base is the ONLY possible merge
 *    base — a blob store has no version history to resolve one from);
 *  - the file is gone from the head;
 *  - the two sides conflict;
 *  - the merged text fails the structured-file guard;
 *  - the merged write kept losing further races.
 *
 * The write below is CONDITIONAL ON THE ETAG THE HEAD READ RETURNED — the
 * same rule the plain conditional write follows — so a head that moves again
 * is refused and the next iteration merges against the real head. The client's
 * base is trusted unverified: a lying client could at most produce a write it
 * could already produce with an unconditional save.
 */
async function mergeStaleSave(
  storage: StorageProvider,
  blobPath: string,
  filePath: string,
  ours: string,
  clientBase?: string,
): Promise<{ etag: string; content: string } | null> {
  if (clientBase === undefined) return null;
  for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt += 1) {
    const head = await storage.read(blobPath);
    if (!head) return null;
    const merged = mergeThreeWay(clientBase, ours, head.content);
    if (!merged.clean) return null;
    if (!mergeKeepsFileWellFormed(filePath, merged.text)) return null;
    const written = await storage.writeIfMatch(blobPath, merged.text, head.etag);
    if (written) return { etag: written.etag, content: merged.text };
  }
  return null;
}

/** PRD 007 Req 20 + PRD 016 Req 8: the stale-save refusal, worded once. */
export const SAVE_CONFLICT_MESSAGE = 'the file changed on the server since it was loaded';

/** What one text save came to — the caller picks the status and body. */
export type SaveOutcome =
  | { ok: true; etag: string; merged?: undefined }
  | { ok: true; etag: string; merged: true; content: string }
  | { ok: false; reason: 'conflict'; error: typeof SAVE_CONFLICT_MESSAGE };

/**
 * PRD 007 Req 20: one text save with optimistic concurrency. `ifMatch`
 * carries the ETag the client read; the write lands only while the blob
 * still has it. When it does not, the STORED CONTENT IS UNTOUCHED — the
 * other member's save survives — unless (PRD 016 Req 8) the save carried
 * its `base` and merges cleanly, in which case the merge lands and is
 * answered as `merged: true`. No `ifMatch` (or `*`) is a deliberate
 * unconditional write: a first save, or the user's Overwrite choice.
 */
export async function saveWorkspaceFile(
  storage: StorageProvider,
  id: string,
  filePath: string,
  content: string,
  ifMatch?: string,
  base?: string,
): Promise<SaveOutcome> {
  const blobPath = filesPrefix(id) + filePath;
  if (typeof ifMatch === 'string' && ifMatch !== '' && ifMatch !== '*') {
    const written = await storage.writeIfMatch(blobPath, content, ifMatch);
    if (written) return { ok: true, etag: written.etag };
    // PRD 016 Req 8: the stale save gets one chance to become a merge before
    // it becomes a conflict — a save that carried its base merges; one that
    // did not takes the refusal verbatim.
    const merged = await mergeStaleSave(storage, blobPath, filePath, content, base);
    if (merged) return { ok: true, etag: merged.etag, merged: true, content: merged.content };
    return { ok: false, reason: 'conflict', error: SAVE_CONFLICT_MESSAGE };
  }
  const { etag } = await storage.write(blobPath, content);
  return { ok: true, etag };
}

/**
 * PRD 007 Req 8: store raw bytes at a workspace path with the media type the
 * extension ALONE dictates (`contentTypeFor`) — the one place bytes are
 * written for both the `?raw=1` PUT and the upload route.
 */
export async function writeWorkspaceBytes(
  storage: StorageProvider,
  id: string,
  filePath: string,
  bytes: Uint8Array,
): Promise<{ etag: string }> {
  return storage.writeBytes(filesPrefix(id) + filePath, bytes, contentTypeFor(filePath));
}

/** What one upload came to — the route maps reasons to 415/413/409. */
export type UploadOutcome =
  | { ok: true; etag: string; size: number }
  | { ok: false; reason: 'unsupported_type' | 'too_large' | 'already_exists'; error: string };

/**
 * PRD 007 Req 17+19: the upload rule — the SAME pure check the client
 * rejects with, applied again here: the client's check is a courtesy, this
 * one is the control. Type first (decidable from the name alone), then the
 * size, then the 409: an upload never silently replaces an existing blob.
 */
export async function uploadWorkspaceFile(
  storage: StorageProvider,
  id: string,
  filePath: string,
  bytes: Uint8Array,
): Promise<UploadOutcome> {
  const name = basenameOf(filePath);
  const typeRejection = uploadTypeRejection(name);
  if (typeRejection) return { ok: false, reason: 'unsupported_type', error: typeRejection };
  const sizeRejection = uploadRejection(name, bytes.length);
  if (sizeRejection) return { ok: false, reason: 'too_large', error: sizeRejection };
  if (await storage.readBytes(filesPrefix(id) + filePath)) {
    return { ok: false, reason: 'already_exists', error: 'a file already exists there' };
  }
  const { etag } = await writeWorkspaceBytes(storage, id, filePath, bytes);
  return { ok: true, etag, size: bytes.length };
}
