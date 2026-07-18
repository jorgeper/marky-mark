import type { Platform } from './types';
import { FIXTURES } from '../bundled';
import { extractReviewPayload } from '../lib/reviewBundle';

/**
 * Static-web platform (SPEC2 §3): the single-file build hosted anywhere.
 * - Open: File System Access API when available, <input type=file> fallback.
 * - Drag-and-drop opens files (with a writable handle when the browser
 *   provides one via getAsFileSystemHandle).
 * - Save: write-through to the handle; otherwise a download (triggered only
 *   by explicit Save via commitFile — comment autosaves stay in memory so
 *   the user is never spammed with downloads).
 * - Settings/themes persist in localStorage; documents live in memory.
 * Comments are always embedded on web (no sidecar siblings possible).
 */

// Minimal File System Access API surface (not yet in TypeScript's lib.dom).
interface FSFileHandle {
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

const LS_CONFIG = 'marky-mark.web.config.v1'; // SPEC32 §3: fresh start at 0.4
const MD_PICKER_TYPES = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] as string[] } },
];

interface WebDoc {
  content: string;
  handle: FSFileHandle | null;
}

function loadConfig(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_CONFIG) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function pickViaInput(accept: string): Promise<File | null> {
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

function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function createWebPlatform(): Platform {
  const docs = new Map<string, WebDoc>();
  let config = loadConfig();

  const saveConfig = () => localStorage.setItem(LS_CONFIG, JSON.stringify(config));
  const isConfigPath = (p: string) => p.startsWith('/config/');
  const docPathFor = (name: string) => `/${name}`;

  // Seed the welcome doc (in memory — never downloaded).
  docs.set('/welcome.md', { content: FIXTURES['welcome.md'] ?? '# Welcome\n', handle: null });

  // SPEC16 §1.3: a review bundle carries its document — seed it and open it
  // on boot through the same path a file association would use.
  const review = extractReviewPayload(document);
  if (review) docs.set(docPathFor(review.name), { content: review.markdown, handle: null });

  const openHandle = async (handle: FSFileHandle): Promise<string> => {
    const file = await handle.getFile();
    const path = docPathFor(file.name);
    docs.set(path, { content: await file.text(), handle });
    return path;
  };
  const openFile = async (file: File): Promise<string> => {
    const path = docPathFor(file.name);
    docs.set(path, { content: await file.text(), handle: null });
    return path;
  };

  return {
    kind: 'web',
    isMac: navigator.platform.toLowerCase().includes('mac'),

    async readTextFile(path) {
      if (isConfigPath(path)) {
        const v = config[path];
        if (v === undefined) throw new Error(`ENOENT: ${path}`);
        return v;
      }
      const doc = docs.get(path);
      if (!doc) throw new Error(`ENOENT: ${path}`);
      return doc.content;
    },
    async writeTextFile(path, content) {
      if (isConfigPath(path)) {
        config[path] = content;
        saveConfig();
        return;
      }
      const doc = docs.get(path);
      if (doc) {
        doc.content = content;
        if (doc.handle) {
          try {
            const w = await doc.handle.createWritable();
            await w.write(content);
            await w.close();
          } catch {
            /* permission revoked mid-session: memory copy still holds it */
          }
        }
      } else {
        docs.set(path, { content, handle: null });
      }
    },
    async exists(path) {
      return isConfigPath(path) ? config[path] !== undefined : docs.has(path);
    },
    async remove(path) {
      if (isConfigPath(path)) {
        delete config[path];
        saveConfig();
      } else {
        docs.delete(path);
      }
    },
    async readDirNames(dir) {
      const prefix = `${dir.replace(/\/$/, '')}/`;
      const source = isConfigPath(`${prefix}x`) ? Object.keys(config) : [...docs.keys()];
      return [...new Set(source.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split('/')[0]))];
    },
    async mkdirp() {
      /* directories are implicit */
    },

    async configDir() {
      return '/config';
    },
    async welcomeDocPath() {
      return '/welcome.md';
    },
    join(...parts) {
      return parts.join('/').replace(/\/+/g, '/');
    },
    basename(path) {
      return path.split('/').pop() ?? path;
    },
    dirname(path) {
      const parts = path.split('/');
      parts.pop();
      return parts.join('/') || '/';
    },

    async openFileDialog() {
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
    async saveFileDialog(suggestedName) {
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName, types: MD_PICKER_TYPES });
          const name = (handle as { name?: string }).name ?? suggestedName;
          const path = docPathFor(name);
          docs.set(path, { content: docs.get(path)?.content ?? '', handle });
          return path;
        } catch {
          return null; // cancelled
        }
      }
      // Fallback: a handle-less virtual doc; the commitFile() after the Save As
      // write triggers the actual download with this name.
      return docPathFor(suggestedName);
    },
    async setTitle(title) {
      document.title = title;
    },
    async onOpenFile(cb) {
      // No OS file associations on the web — but a review bundle's embedded
      // document opens on boot (SPEC16 §1.3).
      if (review) cb(docPathFor(review.name));
    },
    async onFileDrop(cb) {
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
              if (h && (h as { kind?: string }).kind === 'file') {
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
    async watchFile() {
      return () => {}; // nothing external can change an in-memory doc
    },

    async registerCloseGuard(shouldBlock) {
      window.addEventListener('beforeunload', (e) => {
        if (shouldBlock()) e.preventDefault();
      });
    },
    async closeNow() {
      window.close();
    },

    resolveAssetSrc(src) {
      // The single-file page has no filesystem: doc-relative images can never
      // resolve, and under the page's CSP an attempt would only produce a
      // violation. Inline data/blob images pass; everything else neutralizes.
      return /^(data:|blob:)/i.test(src) ? src : '';
    },

    async openExternal(url) {
      if (!/^https?:\/\//i.test(url)) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    // SPEC36 §4.6: defined iff the browser offers clipboard read — absent
    // ⇒ the Smart Edit Paste item is omitted. Reading is local; the page's
    // zero-network CSP is untouched.
    ...(typeof navigator !== 'undefined' && navigator.clipboard?.readText
      ? {
          readClipboardText: () => navigator.clipboard.readText(),
        }
      : {}),

    async commitFile(path) {
      const doc = docs.get(path);
      if (doc && !doc.handle) download(this.basename(path), doc.content);
    },
    async importTheme() {
      let name: string;
      let css: string;
      if (window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'CSS theme', accept: { 'text/css': ['.css'] } }],
            multiple: false,
          });
          if (!handle) return false;
          const file = await handle.getFile();
          name = file.name;
          css = await file.text();
        } catch {
          return false;
        }
      } else {
        const file = await pickViaInput('.css');
        if (!file) return false;
        name = file.name;
        css = await file.text();
      }
      config[`/config/themes/${name}`] = css;
      saveConfig();
      return true;
    },
  };
}
