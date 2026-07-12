import type { Platform } from './types';
import { FIXTURES } from '../bundled';
import { dispatchRecent, dispatchCommand, type CommandId } from '../lib/commands';
import type { MenuSpec } from '../lib/menuSpec';
import type { AuxKind } from '../lib/auxProtocol';

/**
 * Browser shim platform: a virtual filesystem persisted to localStorage so
 * state (settings, sidecars, edits) survives page reloads — which is exactly
 * what the e2e suite relies on to simulate app restarts and external edits.
 * Exposed to Playwright as window.__mmfs.
 */

const LS_KEY = 'marky-mark.fs.v1'; // SPEC32 §3: fresh start at 0.4

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
    /**
     * SPEC12 §5.2: under ?nativeMenu=1 the shim simulates the desktop menu —
     * the latest installed spec is recorded here, and click(command) drives
     * the registry exactly like a native menu item activation. This is the
     * e2e seam; Playwright cannot click real native menus.
     */
    __mmMenu?: {
      spec: MenuSpec | null;
      click(command: string): void;
      /** SPEC29 §3.3: drive an Open Recent entry by its path. */
      clickRecent(path: string): void;
    };
    /**
     * SPEC13 §5.2: aux-window activity recorded for e2e — how many times each
     * kind was opened vs focused-instead (singleton assertion seam).
     */
    __mmAux?: {
      opened: Record<AuxKind, number>;
      focused: Record<AuxKind, number>;
    };
    /**
     * SPEC23 §4: dev-shim-only editor seam — cursor/selection/nav-mode
     * mirror for e2e. The app maintains it only when platform.kind is
     * 'browser'; desktop and web builds never set it.
     */
    __mmEdit?: {
      head: number;
      headLine: number;
      selFrom: number;
      selTo: number;
      selText: string;
      /** SPEC24 §1: whether the editor had focus at report time. */
      focused: boolean;
      nav: boolean;
    };
    /**
     * SPEC19 §2.3: the shim's updater mock — tests set `next` (null = up to
     * date, a version = available, {error} = failure) and read back what
     * happened. No network, ever.
     */
    __mmUpdate?: {
      next: { version: string; notes: string } | { error: string } | null;
      progress: number[];
      installed: boolean;
      restarted: boolean;
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
  const nativeMenu = new URLSearchParams(window.location.search).has('nativeMenu');
  window.__mmfs = {
    read: (p) => fs.read(p),
    write: (p, c) => fs.write(p, c),
    remove: (p) => fs.remove(p),
    exists: (p) => fs.exists(p),
    list: () => fs.list(),
    reset: () => fs.reset(),
  };

  const join = (...parts: string[]) => normalize(parts.join('/'));

  /** SPEC12 §5.2: record the installed spec; click() dispatches like a menu. */
  const setAppMenu = async (spec: MenuSpec) => {
    // SPEC29 §3.3: commands may live inside nested submenus now.
    const flatten = (items: MenuSpec['submenus'][number]['items']): MenuSpec['submenus'][number]['items'] =>
      items.flatMap((it) => (it.type === 'submenu' ? flatten(it.items) : [it]));
    window.__mmMenu = {
      spec,
      click(command: string) {
        const exists = spec.submenus.some((m) =>
          flatten(m.items).some((it) => it.type === 'command' && it.command === command)
        );
        if (!exists) throw new Error(`no menu item for command: ${command}`);
        dispatchCommand(command as CommandId, 'menu');
      },
      clickRecent(path: string) {
        const exists = spec.submenus.some((m) =>
          flatten(m.items).some((it) => it.type === 'recent' && it.path === path)
        );
        if (!exists) throw new Error(`no recent item for path: ${path}`);
        dispatchRecent(path);
      },
    };
  };

  /**
   * SPEC13 §5.2: the shim's cross-window bus. BroadcastChannel never delivers
   * to the posting context, exactly like the real protocol needs (main and
   * aux windows only ever consume each other's events, never their own).
   */
  const channel = new BroadcastChannel('mm://bus');
  const busEmit = async (event: string, payload: unknown) => {
    channel.postMessage({ event, payload });
  };
  const busListen = async (event: string, cb: (payload: unknown) => void) => {
    const handler = (e: MessageEvent) => {
      const data = e.data as { event?: string; payload?: unknown };
      if (data && data.event === event) cb(data.payload);
    };
    channel.addEventListener('message', handler);
    return () => channel.removeEventListener('message', handler);
  };

  /** SPEC13 §5.2: aux windows are same-origin popups; singleton by handle. */
  const auxHandles: Partial<Record<AuxKind, Window | null>> = {};
  const openAuxWindow = async (kind: AuxKind) => {
    const aux = (window.__mmAux ??= {
      opened: { settings: 0, about: 0 },
      focused: { settings: 0, about: 0 },
    });
    const existing = auxHandles[kind];
    if (existing && !existing.closed) {
      existing.focus();
      aux.focused[kind] += 1;
      return;
    }
    auxHandles[kind] = window.open(`/?window=${kind}&nativeMenu=1`, `mm-${kind}`, 'width=620,height=560');
    aux.opened[kind] += 1;
  };

  const closeFocusedAuxWindow = async () => {
    for (const kind of ['settings', 'about'] as const) {
      const h = auxHandles[kind];
      if (h && !h.closed && h.document.hasFocus()) {
        h.close();
        return true;
      }
    }
    return false;
  };

  return {
    kind: 'browser',
    ...(nativeMenu ? { setAppMenu, openAuxWindow, closeFocusedAuxWindow } : {}),
    busEmit,
    busListen,
    // The shim never opens print UI — record invocations for e2e (E67).
    async printCurrent() {
      ((window as unknown as { __mmPrints?: string[] }).__mmPrints ??= []).push('print-current');
    },
    // SPEC19 §2.3: mocked updater, driven by window.__mmUpdate (E69/E70).
    updates: {
      async check() {
        const hook = (window.__mmUpdate ??= { next: null, progress: [], installed: false, restarted: false });
        const next = hook.next;
        if (next && 'error' in next) throw new Error(next.error);
        return next;
      },
      async downloadAndInstall(onProgress) {
        const hook = window.__mmUpdate!;
        for (const pct of [12, 48, 87, 100]) {
          hook.progress.push(pct);
          onProgress(pct);
          await new Promise((r) => setTimeout(r, 30));
        }
        hook.installed = true;
      },
      async restart() {
        window.__mmUpdate!.restarted = true;
      },
    },
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

    /** SPEC20 follow-up: Insert Image… — prompt-driven like openFileDialog. */
    async openImageDialog() {
      const path = window.prompt('Insert image (virtual path):', '/docs/images/');
      if (!path) return null;
      return fs.exists(path) ? normalize(path) : null;
    },
    async copyFile(src, dest) {
      const content = fs.read(src);
      if (content === null) throw new Error(`ENOENT: ${src}`);
      fs.write(dest, content);
    },

    /**
     * SPEC20 §3: pasted images live in the virtual fs as data: URIs, so the
     * shim preview renders them for real and e2e can assert on the pixels.
     */
    async writeBinaryFile(path, bytes) {
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const mime =
        { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] ?? 'application/octet-stream';
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      fs.write(path, `data:${mime};base64,${btoa(bin)}`);
    },

    resolveAssetSrc(src, docDir) {
      if (/^(data:|blob:)/i.test(src)) return src;
      // Doc-relative paths that name a virtual-fs data: URI (a pasted image)
      // resolve to it; everything else passes through untouched, as before.
      try {
        const rel = decodeURIComponent(src);
        const abs = rel.startsWith('/') ? rel : `${docDir.replace(/\/$/, '')}/${rel}`;
        const stored = fs.read(abs);
        if (stored?.startsWith('data:')) return stored;
      } catch {
        // malformed percent-encoding — fall through
      }
      return src;
    },

    async openExternal(url) {
      if (!/^https?:\/\//i.test(url)) return;
      // The shim is the dev/test platform: record the hand-off (E46 asserts
      // it happened without the app navigating) instead of opening anything —
      // the e2e network-isolation assertion stays absolute.
      const w = window as unknown as { __mmExternalOpens?: string[] };
      (w.__mmExternalOpens ??= []).push(url);
    },
  };
}
