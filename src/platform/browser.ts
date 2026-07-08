import type { Platform } from './types';
import { FIXTURES } from '../bundled';

/**
 * Browser shim platform: a virtual filesystem persisted to localStorage so
 * state (settings, sidecars, edits) survives page reloads — which is exactly
 * what the e2e suite relies on to simulate app restarts and external edits.
 * Exposed to Playwright as window.__mmfs.
 */

const LS_KEY = 'markimark.fs.v1';

type Store = Record<string, string>;

declare global {
  interface Window {
    __mmfs?: {
      read(path: string): string | null;
      write(path: string, content: string): void;
      remove(path: string): void;
      exists(path: string): boolean;
      list(): string[];
      reset(): void;
      /** Test hook: the path the next saveFileDialog() call returns. */
      nextSavePath?: string | null;
      /** Test observability: set when revealThemesDir() was invoked. */
      revealedThemesDir?: boolean;
    };
  }
}

function normalize(p: string): string {
  return p.replace(/\/+/g, '/');
}

class BrowserFs {
  private store: Store;
  private listeners = new Set<() => void>();

  constructor() {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      this.store = JSON.parse(raw) as Store;
    } else {
      this.store = {};
      for (const [name, content] of Object.entries(FIXTURES)) {
        this.store[`/docs/${name}`] = content;
      }
      this.flush();
    }
  }

  private flush() {
    localStorage.setItem(LS_KEY, JSON.stringify(this.store));
    for (const l of this.listeners) l();
  }

  read(path: string): string | null {
    const v = this.store[normalize(path)];
    return v === undefined ? null : v;
  }
  write(path: string, content: string) {
    this.store[normalize(path)] = content;
    this.flush();
  }
  remove(path: string) {
    delete this.store[normalize(path)];
    this.flush();
  }
  exists(path: string): boolean {
    return this.store[normalize(path)] !== undefined;
  }
  list(): string[] {
    return Object.keys(this.store);
  }
  reset() {
    localStorage.removeItem(LS_KEY);
  }
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export function createBrowserPlatform(): Platform {
  const fs = new BrowserFs();
  window.__mmfs = {
    read: (p) => fs.read(p),
    write: (p, c) => fs.write(p, c),
    remove: (p) => fs.remove(p),
    exists: (p) => fs.exists(p),
    list: () => fs.list(),
    reset: () => fs.reset(),
  };

  const join = (...parts: string[]) => normalize(parts.join('/'));

  return {
    kind: 'browser',
    isMac: navigator.platform.toLowerCase().includes('mac'),

    async readTextFile(path) {
      const v = fs.read(path);
      if (v === null) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    async writeTextFile(path, content) {
      fs.write(path, content);
    },
    async exists(path) {
      return fs.exists(path);
    },
    async remove(path) {
      fs.remove(path);
    },
    async readDirNames(dir) {
      const prefix = `${normalize(dir).replace(/\/$/, '')}/`;
      const names = new Set<string>();
      for (const p of fs.list()) {
        if (p.startsWith(prefix)) {
          const rest = p.slice(prefix.length);
          names.add(rest.split('/')[0]);
        }
      }
      return [...names];
    },
    async mkdirp() {
      // directories are implicit in the virtual fs
    },

    async configDir() {
      return '/config';
    },
    async welcomeDocPath() {
      return '/docs/welcome.md';
    },
    join,
    basename(path) {
      return normalize(path).split('/').pop() ?? path;
    },
    dirname(path) {
      const parts = normalize(path).split('/');
      parts.pop();
      return parts.join('/') || '/';
    },

    async openFileDialog() {
      const path = window.prompt('Open file (virtual path):', '/docs/field-guide.md');
      if (!path) return null;
      return fs.exists(path) ? normalize(path) : null;
    },
    async saveFileDialog(suggestedName) {
      const hook = window.__mmfs?.nextSavePath;
      if (hook !== undefined) {
        if (window.__mmfs) window.__mmfs.nextSavePath = undefined;
        return hook;
      }
      const path = window.prompt('Save as (virtual path):', `/docs/${suggestedName}`);
      return path ? normalize(path) : null;
    },
    async revealThemesDir() {
      if (window.__mmfs) window.__mmfs.revealedThemesDir = true;
    },
    async setTitle(title) {
      document.title = title;
    },
    async onOpenFile(cb) {
      // Browser shim: allow deep-linking a doc via #open=<path> for dev use.
      const fromHash = () => {
        const m = /#open=([^&]+)/.exec(window.location.hash);
        if (m) cb(decodeURIComponent(m[1]));
      };
      window.addEventListener('hashchange', fromHash);
      fromHash();
    },
    async onFileDrop(cb) {
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (!f || !/\.(md|markdown)$/i.test(f.name)) return;
        void f.text().then((text) => {
          const path = `/docs/${f.name}`;
          fs.write(path, text);
          cb(path);
        });
      });
    },
    async watchFile(path, cb) {
      let last = fs.read(path);
      const off = fs.onChange(() => {
        const now = fs.read(path);
        if (now !== last) {
          last = now;
          cb();
        }
      });
      return off;
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
      return src;
    },
  };
}
