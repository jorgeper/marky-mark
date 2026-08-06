import type { Platform } from './types';
import { createLocalDocs, pickViaInput, MD_PICKER_TYPES } from './localDocs';
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

const LS_CONFIG = 'marky-mark.web.config.v1'; // SPEC32 §3: fresh start at 0.4

function loadConfig(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_CONFIG) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function createWebPlatform(): Platform {
  // PRD 007 Req 21: the local-doc machinery now lives in localDocs.ts, shared
  // with the hosted flavor's start-page file mode. Web keeps its historical
  // `/name.md` paths (no prefix) — nothing else here changes.
  const local = createLocalDocs();
  const docs = local.docs;
  let config = loadConfig();

  const saveConfig = () => localStorage.setItem(LS_CONFIG, JSON.stringify(config));
  const isConfigPath = (p: string) => p.startsWith('/config/');
  const docPathFor = local.pathFor;

  // Seed the welcome doc (in memory — never downloaded).
  docs.set('/welcome.md', { content: FIXTURES['welcome.md'] ?? '# Welcome\n', handle: null });

  // SPEC16 §1.3: a review bundle carries its document — seed it and open it
  // on boot through the same path a file association would use.
  const review = extractReviewPayload(document);
  if (review) docs.set(docPathFor(review.name), { content: review.markdown, handle: null });

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
      await local.write(path, content);
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
      return local.pick();
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
      local.listenForDrop(cb);
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

    // SPEC43 §4.6: defined iff the browser offers clipboard read — absent
    // ⇒ the Smart Edit Paste item is omitted. Reading is local; the page's
    // zero-network CSP is untouched.
    ...(typeof navigator !== 'undefined' && navigator.clipboard?.readText
      ? {
          readClipboardText: () => navigator.clipboard.readText(),
        }
      : {}),

    async commitFile(path) {
      local.commit(path);
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
