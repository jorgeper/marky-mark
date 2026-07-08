import type { Platform } from './types';

/**
 * Real desktop platform. All Tauri imports are dynamic so this module only
 * evaluates inside the Tauri webview; the browser shim never touches them.
 */
export async function createTauriPlatform(): Promise<Platform> {
  const fsp = await import('@tauri-apps/plugin-fs');
  const dialog = await import('@tauri-apps/plugin-dialog');
  const pathApi = await import('@tauri-apps/api/path');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');

  const sep = pathApi.sep();
  const join = (...parts: string[]) =>
    parts
      .filter(Boolean)
      .map((p, i) => (i === 0 ? p.replace(/[/\\]+$/, '') : p.replace(/^[/\\]+|[/\\]+$/g, '')))
      .join(sep);
  const splitPath = (p: string) => p.split(/[/\\]+/).filter(Boolean);

  let cachedConfigDir: string | null = null;

  const platform: Platform = {
    kind: 'tauri',
    isMac: navigator.userAgent.includes('Mac'),

    readTextFile: (path) => fsp.readTextFile(path),
    writeTextFile: (path, content) => fsp.writeTextFile(path, content),
    exists: (path) => fsp.exists(path),
    remove: (path) => fsp.remove(path),
    async readDirNames(dir) {
      if (!(await fsp.exists(dir))) return [];
      const entries = await fsp.readDir(dir);
      return entries.map((e) => e.name).filter((n): n is string => !!n);
    },
    async mkdirp(dir) {
      if (!(await fsp.exists(dir))) await fsp.mkdir(dir, { recursive: true });
    },

    async configDir() {
      if (!cachedConfigDir) {
        cachedConfigDir = await pathApi.appConfigDir();
        await this.mkdirp(cachedConfigDir);
      }
      return cachedConfigDir;
    },
    async welcomeDocPath() {
      return join(await this.configDir(), 'welcome.md');
    },
    join,
    basename(path) {
      return splitPath(path).pop() ?? path;
    },
    dirname(path) {
      const parts = splitPath(path);
      parts.pop();
      const prefix = /^[/\\]/.test(path) ? sep : '';
      return prefix + parts.join(sep);
    },

    async openFileDialog() {
      const picked = await dialog.open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });
      return typeof picked === 'string' ? picked : null;
    },
    async saveFileDialog(suggestedName) {
      const picked = await dialog.save({
        defaultPath: suggestedName,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });
      return typeof picked === 'string' ? picked : null;
    },
    async revealThemesDir() {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      const dir = join(await this.configDir(), 'themes');
      await this.mkdirp(dir);
      await openPath(dir);
    },
    async setTitle(title) {
      await getCurrentWindow().setTitle(title);
    },
    async onOpenFile(cb) {
      // Live events (macOS file-association opens while running)…
      await listen<string[]>('mm://open-file', (e) => {
        for (const p of e.payload) cb(p);
      });
      // …then drain opens that happened before the frontend was listening
      // (double-click launch) and CLI arguments (Windows/Linux associations).
      const pending = await invoke<string[]>('take_pending_open_files');
      for (const p of pending) cb(p);
    },
    async onFileDrop(cb) {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          const md = event.payload.paths.find((p) => /\.(md|markdown)$/i.test(p));
          if (md) cb(md);
        }
      });
    },
    async watchFile(path, cb) {
      return fsp.watch(path, () => cb(), { delayMs: 400 });
    },

    async registerCloseGuard(shouldBlock, onBlocked) {
      await getCurrentWindow().onCloseRequested((event) => {
        if (shouldBlock()) {
          event.preventDefault();
          onBlocked();
        }
      });
    },
    async closeNow() {
      await getCurrentWindow().destroy();
    },

    resolveAssetSrc(src, docDir) {
      // SPEC11 §1.3: remote URLs no longer pass through (the renderer already
      // replaced them with placeholders; this is belt-and-braces).
      if (/^(https?:)?\/\//i.test(src)) return '';
      if (/^(data:|asset:|blob:)/.test(src)) return src;
      const abs = /^([/\\]|[A-Za-z]:)/.test(src) ? src : join(docDir, ...src.split('/'));
      return convertFileSrc(abs);
    },

    async openExternal(url) {
      if (!/^https?:\/\//i.test(url)) return; // http(s) only, matching the capability scope
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    },
  };
  return platform;
}
