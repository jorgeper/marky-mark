import type { Platform } from './types';
import type { MenuItemSpec, MenuSpec } from '../lib/menuSpec';
import type { AuxKind } from '../lib/auxProtocol';
import { dispatchCommand } from '../lib/commands';
import { parseCombo } from '../lib/hotkeys';

/**
 * Real desktop platform. All Tauri imports are dynamic so this module only
 * evaluates inside the Tauri webview; the browser shim never touches them.
 */

/**
 * Canonical combo ("Mod+Shift+C") → Tauri/muda accelerator ("CmdOrCtrl+Shift+C").
 * muda's parser takes literal characters (=, -, ,, digits, letters) and the
 * usual key names (F5, ArrowUp) case-insensitively, so the key passes through.
 */
function toAccelerator(combo: string): string | undefined {
  const c = parseCombo(combo);
  if (!c) return undefined;
  const parts: string[] = [];
  if (c.mod) parts.push('CmdOrCtrl');
  if (c.shift) parts.push('Shift');
  if (c.alt) parts.push('Alt');
  parts.push(c.key);
  return parts.join('+');
}
export async function createTauriPlatform(): Promise<Platform> {
  const fsp = await import('@tauri-apps/plugin-fs');
  const dialog = await import('@tauri-apps/plugin-dialog');
  const pathApi = await import('@tauri-apps/api/path');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { emit, listen } = await import('@tauri-apps/api/event');
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');

  const sep = pathApi.sep();
  const join = (...parts: string[]) =>
    parts
      .filter(Boolean)
      .map((p, i) => (i === 0 ? p.replace(/[/\\]+$/, '') : p.replace(/^[/\\]+|[/\\]+$/g, '')))
      .join(sep);
  const splitPath = (p: string) => p.split(/[/\\]+/).filter(Boolean);

  let cachedConfigDir: string | null = null;

  // SPEC13 §1–§2: the two aux windows — fixed-size, non-resizable, singleton.
  const AUX_LABELS: readonly AuxKind[] = ['settings', 'about'];
  const AUX_OPTIONS: Record<AuxKind, { title: string; width: number; height: number }> = {
    settings: { title: 'Settings', width: 620, height: 560 },
    about: { title: 'About Marky Mark', width: 360, height: 420 },
  };

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
      const current = getCurrentWindow();
      if (current.label === 'main') {
        // SPEC13 §3.6: aux windows die with the main window, promptless. An
        // aux window closing itself must not tear down its sibling.
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        for (const label of AUX_LABELS) {
          const w = await WebviewWindow.getByLabel(label);
          if (w) await w.destroy().catch(() => {});
        }
      }
      await current.destroy();
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

    /**
     * Native menu bar (SPEC12 §3.3): convert the pure spec into real menu
     * objects — app menu on macOS, in-window menu bar on Windows. Item
     * activations dispatch into the command registry; each install replaces
     * the previous menu atomically (old items keep working until then, so a
     * rebuild never drops a click).
     */
    async setAppMenu(spec: MenuSpec) {
      const { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu');

      const toItem = async (it: MenuItemSpec) => {
        if (it.type === 'predefined') {
          return PredefinedMenuItem.new({ item: it.item, ...(it.label ? { text: it.label } : {}) });
        }
        const common = {
          text: it.label,
          accelerator: it.accelerator ? toAccelerator(it.accelerator) : undefined,
          action: () => dispatchCommand(it.command, 'menu'),
        };
        try {
          return it.checked !== undefined
            ? await CheckMenuItem.new({ ...common, checked: it.checked })
            : await MenuItem.new(common);
        } catch {
          // An exotic rebound key the accelerator parser rejects must never
          // take the whole menu down — keep the item, drop the shortcut.
          return it.checked !== undefined
            ? CheckMenuItem.new({ ...common, accelerator: undefined, checked: it.checked })
            : MenuItem.new({ ...common, accelerator: undefined });
        }
      };

      const submenus = await Promise.all(
        spec.submenus.map(async (m) =>
          Submenu.new({ text: m.title, items: await Promise.all(m.items.map(toItem)) })
        )
      );
      const menu = await Menu.new({ items: submenus });
      await menu.setAsAppMenu();
    },

    /** SPEC13 §1–§2: one fixed-size window per kind; reinvoke = focus. */
    async openAuxWindow(kind: AuxKind) {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const existing = await WebviewWindow.getByLabel(kind);
      if (existing) {
        await existing.unminimize().catch(() => {});
        await existing.setFocus();
        return;
      }
      const opt = AUX_OPTIONS[kind];
      new WebviewWindow(kind, {
        url: `index.html?window=${kind}`,
        title: opt.title,
        width: opt.width,
        height: opt.height,
        resizable: false,
        maximizable: false,
        center: true,
      });
    },

    async busEmit(event, payload) {
      await emit(event, payload);
    },
    async busListen(event, cb) {
      return listen(event, (e) => cb(e.payload));
    },

    async closeFocusedAuxWindow() {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      for (const label of AUX_LABELS) {
        const w = await WebviewWindow.getByLabel(label);
        if (w && (await w.isFocused().catch(() => false))) {
          await w.destroy().catch(() => {});
          return true;
        }
      }
      return false;
    },
  };
  return platform;
}
