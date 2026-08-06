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
 *   - the window-level drop listener that opens a dragged Markdown file.
 *
 * It performs no network I/O of any kind — a document opened through here
 * never leaves the browser.
 */

/** Minimal File System Access API surface (not yet in TypeScript's lib.dom). */
export interface FSFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
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
  /** An explicit Save of a handle-less doc becomes a download of its basename. */
  commit(path: string): void;
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
      if (!doc.handle) return;
      try {
        const w = await doc.handle.createWritable();
        await w.write(content);
        await w.close();
      } catch {
        /* permission revoked mid-session: memory copy still holds it */
      }
    },

    commit(path) {
      const doc = docs.get(path);
      if (doc && !doc.handle) download(basenameOf(path), doc.content);
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
