/**
 * PRD 007 Req 21: local-file mode, shared by every browser flavor. The
 * single-file web build has always opened a Markdown file the user picks or
 * drops entirely inside the page (SPEC2 §3); the hosted flavor now offers the
 * same thing on its start page, with nothing uploaded and no workspace
 * required. This module is that machinery, owned once:
 *
 *   - an in-memory map of opened documents, keyed by a virtual path;
 *   - the File System Access picker where the browser has it, an
 *     <input type=file> otherwise;
 *   - write-through to the file's handle when the browser granted one,
 *     otherwise a download on the user's explicit Save (commitFile);
 *   - PRD 009 Req 15: the readwrite grant behind that write-through, asked
 *     for on the Save gesture and falling back to the download whenever the
 *     in-place write cannot land (lib/localSave.ts holds the decision);
 *   - the window-level drop listener that opens a dragged Markdown file.
 *
 * It performs no network I/O of any kind — a document opened through here
 * never leaves the browser.
 */

import { flushLocalDoc, saveLocalDoc, type FSPermissionState, type LocalWriteTarget } from '../lib/localSave';

/** Minimal File System Access API surface (not yet in TypeScript's lib.dom). */
export interface FSFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  // PRD 009 Req 15: the readwrite grant a write-through needs. Optional
  // because lib.dom knows neither member and a browser may offer neither.
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<FSPermissionState>;
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<FSPermissionState>;
}
interface OpenPickerOptions {
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
  multiple?: boolean;
}
interface SavePickerOptions {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}
declare global {
  interface Window {
    showOpenFilePicker?(opts?: OpenPickerOptions): Promise<FSFileHandle[]>;
    showSaveFilePicker?(opts?: SavePickerOptions): Promise<FSFileHandle & { name?: string }>;
  }
}

export const MD_PICKER_TYPES = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] as string[] } },
];

export interface LocalDoc {
  content: string;
  handle: FSFileHandle | null;
  /**
   * PRD 009 Req 15: the bytes this doc's handle is known to hold on disk —
   * set by a write-through that landed, so the explicit Save that follows
   * knows whether there is anything left to write.
   */
  flushed?: string | null;
}

/** Show a hidden file input; resolves to the pick, or null when cancelled. */
export function pickViaInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    input.click();
  });
}

/**
 * PRD 009 Req 15: one document's handle as the browser seams lib/localSave.ts
 * reasons about — a handle-less doc has no target at all, which is what makes
 * its Save a download. `write`/`close` are one unit: the bytes are not on disk
 * until the writable closes, so a failure in either is a failed write.
 */
const targetFor = (doc: LocalDoc): LocalWriteTarget | null => {
  const handle = doc.handle;
  if (!handle) return null;
  const mode = { mode: 'readwrite' } as const;
  return {
    ...(handle.queryPermission
      ? { query: (): Promise<FSPermissionState> => handle.queryPermission!(mode) }
      : {}),
    ...(handle.requestPermission
      ? { request: (): Promise<FSPermissionState> => handle.requestPermission!(mode) }
      : {}),
    write: async (content: string) => {
      const w = await handle.createWritable();
      await w.write(content);
      await w.close();
    },
  };
};

/** The name a virtual path downloads under — both flavors' `basename`. */
const basenameOf = (path: string): string => path.split('/').pop() ?? path;

/** Hand `content` to the browser as a download named `name`. */
export function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface LocalDocs {
  /** The open documents, by virtual path. */
  docs: Map<string, LocalDoc>;
  /** The virtual path a file of this name lives at. */
  pathFor(name: string): string;
  /** True when the path belongs to this store (never a server path). */
  owns(path: string): boolean;
  /** Open a handle-backed file; resolves to its virtual path. */
  openHandle(handle: FSFileHandle): Promise<string>;
  /** Open a plain File (no write-through handle); resolves to its path. */
  openFile(file: File): Promise<string>;
  /** The picker seam behind `openFileDialog`; null = cancelled. */
  pick(): Promise<string | null>;
  /** Write through to the handle when there is one; memory always wins. */
  write(path: string, content: string): Promise<void>;
  /**
   * The user's explicit Save: in place through the handle where the browser
   * grants it, a download of the basename everywhere else (PRD 009 Req 15).
   */
  commit(path: string): Promise<void>;
  /** Window-level drop → open a Markdown file locally. */
  listenForDrop(cb: (path: string) => void): void;
}

/**
 * @param prefix virtual directory the docs hang under ('' — the web build's
 *   historical `/name.md` — or e.g. 'local' for a flavor whose own paths must
 *   stay distinguishable from these).
 */
export function createLocalDocs(prefix = ''): LocalDocs {
  const docs = new Map<string, LocalDoc>();
  const root = prefix ? `/${prefix}` : '';
  const pathFor = (name: string) => `${root}/${name}`;
  const owns = (path: string) => (root ? path === root || path.startsWith(`${root}/`) : docs.has(path));

  const openHandle = async (handle: FSFileHandle): Promise<string> => {
    const file = await handle.getFile();
    const path = pathFor(file.name);
    docs.set(path, { content: await file.text(), handle });
    return path;
  };
  const openFile = async (file: File): Promise<string> => {
    const path = pathFor(file.name);
    docs.set(path, { content: await file.text(), handle: null });
    return path;
  };

  return {
    docs,
    pathFor,
    owns,
    openHandle,
    openFile,

    async pick() {
      if (window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker({ types: MD_PICKER_TYPES, multiple: false });
          return handle ? openHandle(handle) : null;
        } catch {
          return null; // user cancelled
        }
      }
      const file = await pickViaInput('.md,.markdown');
      return file ? openFile(file) : null;
    },

    async write(path, content) {
      const doc = docs.get(path);
      if (!doc) {
        docs.set(path, { content, handle: null });
        return;
      }
      doc.content = content;
      // PRD 009 Req 15: not the user's explicit Save — keep an already-granted
      // file up to date and stop there. No permission prompt (the browser
      // would refuse one outside a gesture) and never a download.
      doc.flushed = (await flushLocalDoc(targetFor(doc), content)) ? content : null;
    },

    async commit(path) {
      const doc = docs.get(path);
      if (!doc) return;
      // PRD 009 Req 15: the write-through already landed these bytes in the
      // user's own file — nothing to write, nothing to download.
      if (doc.flushed === doc.content) return;
      const outcome = await saveLocalDoc(targetFor(doc), doc.content);
      doc.flushed = outcome.kind === 'in-place' ? doc.content : null;
      // A save that could not land in place — no handle, the grant refused,
      // or the write threw — still reaches the user, as a download.
      if (outcome.kind === 'download') download(basenameOf(path), doc.content);
    },

    listenForDrop(cb) {
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => {
        e.preventDefault();
        const item = e.dataTransfer?.items?.[0];
        const file = e.dataTransfer?.files?.[0];
        if (!file || !/\.(md|markdown)$/i.test(file.name)) return;
        void (async () => {
          const getHandle = (item as unknown as { getAsFileSystemHandle?: () => Promise<unknown> })
            ?.getAsFileSystemHandle;
          if (getHandle) {
            try {
              const h = (await getHandle.call(item)) as (FSFileHandle & { kind?: string }) | null;
              if (h && h.kind === 'file') {
                cb(await openHandle(h));
                return;
              }
            } catch {
              /* fall through to plain File */
            }
          }
          cb(await openFile(file));
        })();
      });
    },
  };
}
