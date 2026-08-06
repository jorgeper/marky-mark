/**
 * PRD 009 Req 15: the decision a single-file-mode save makes in a browser —
 * handle present? permission granted? did the write land, or must the bytes
 * reach the user as a download instead? The File System Access seams are
 * passed in as plain functions (no `window`, no `document`, no platform
 * import), so `src/platform/localDocs.ts` and the unit suite — which runs in
 * vitest's `node` environment — exercise the same code.
 *
 * Two shapes of write share it:
 *   - the user's explicit Save (`saveLocalDoc`), which MAY prompt for the
 *     readwrite grant because it runs from their own gesture, and downloads
 *     whenever the in-place write cannot land;
 *   - every other write (`flushLocalDoc`) — comment autosaves and friends —
 *     which writes through an already-granted handle and otherwise does
 *     nothing at all: it never prompts and never downloads (the "no download
 *     spam" rule the web build has always kept).
 */

/** `PermissionState` as the File System Access API spells it. */
export type FSPermissionState = 'granted' | 'denied' | 'prompt';

/**
 * The browser seams behind one open document's file handle. `query`/`request`
 * are optional because they are optional on the handle itself — a browser (or
 * a `showSaveFilePicker` handle) that offers neither is simply written to.
 */
export interface LocalWriteTarget {
  query?: () => Promise<FSPermissionState>;
  request?: () => Promise<FSPermissionState>;
  write: (content: string) => Promise<void>;
}

/** Where an explicit Save's bytes went. */
export type LocalSaveOutcome =
  | { kind: 'in-place' }
  | { kind: 'download'; reason: 'no-handle' | 'permission-denied' | 'write-failed' };

/**
 * PRD 009 Req 15: the readwrite grant, obtained explicitly rather than left
 * to chance — `queryPermission` first so an already-granted handle never
 * re-prompts in the same session, `requestPermission` only when it is not
 * already `'granted'`. A seam that throws counts as a refusal: the caller
 * falls back to the download rather than assuming the write will work.
 */
export async function ensureWritePermission(target: LocalWriteTarget): Promise<boolean> {
  try {
    const state = target.query ? await target.query() : 'granted';
    if (state === 'granted') return true;
    if (!target.request) return false;
    return (await target.request()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * PRD 009 Req 15: an explicit Save. With a handle and the grant, the bytes go
 * back into the user's own file in place — no download. Without a handle (the
 * `<input type=file>` fallback, a drop with no `getAsFileSystemHandle`, a
 * browser with no API), or when the grant is refused or the write throws, the
 * download runs so the bytes still reach the user: the document is never left
 * looking saved with nothing written anywhere.
 */
export async function saveLocalDoc(target: LocalWriteTarget | null, content: string): Promise<LocalSaveOutcome> {
  if (!target) return { kind: 'download', reason: 'no-handle' };
  if (!(await ensureWritePermission(target))) return { kind: 'download', reason: 'permission-denied' };
  try {
    await target.write(content);
  } catch {
    return { kind: 'download', reason: 'write-failed' };
  }
  return { kind: 'in-place' };
}

/**
 * PRD 009 Req 15: a write that is NOT the user's explicit Save. It keeps an
 * already-granted file up to date and stops there — no permission prompt
 * (the browser would refuse one outside a user gesture anyway) and never a
 * download. Answers whether the bytes reached the file, so the explicit Save
 * that follows knows there is nothing left to write.
 */
export async function flushLocalDoc(target: LocalWriteTarget | null, content: string): Promise<boolean> {
  if (!target) return false;
  try {
    if (target.query && (await target.query()) !== 'granted') return false;
    await target.write(content);
    return true;
  } catch {
    return false;
  }
}
