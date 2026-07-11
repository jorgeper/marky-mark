import type { MenuSpec } from '../lib/menuSpec';

/**
 * The single seam between the app and the host (SPEC FR-6). Everything that
 * touches the filesystem, dialogs, paths, or the window goes through this
 * interface. Two implementations exist:
 *   - tauri.ts   — the real desktop app (macOS now, Windows later)
 *   - browser.ts — an in-memory/localStorage shim used by `vite dev` and the
 *                  Playwright e2e suite (exposed to tests as window.__mmfs)
 * App code must never import Tauri APIs or assume an OS outside platform/.
 */
export interface Platform {
  kind: 'tauri' | 'browser' | 'web';
  isMac: boolean;

  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  /** File/dir names (not full paths) directly inside `dir`; [] if missing. */
  readDirNames(dir: string): Promise<string[]>;
  mkdirp(dir: string): Promise<void>;

  /** App config directory (created if needed). Themes live in <configDir>/themes. */
  configDir(): Promise<string>;
  /** Path of the bundled welcome document's on-disk home (may not exist yet). */
  welcomeDocPath(): Promise<string>;
  join(...parts: string[]): string;
  basename(path: string): string;
  dirname(path: string): string;

  openFileDialog(): Promise<string | null>;
  setTitle(title: string): Promise<void>;
  /** Register for files opened via association/CLI; drains any pending opens. */
  onOpenFile(cb: (path: string) => void): Promise<void>;
  /** Register for markdown files dropped onto the window. */
  onFileDrop(cb: (path: string) => void): Promise<void>;
  /** Watch one file for external changes; resolves to an unwatch function. */
  watchFile(path: string, cb: () => void): Promise<() => void>;

  /**
   * Intercept window close: when shouldBlock() is true the close is prevented
   * and onBlocked() runs (the app shows its save/discard/cancel modal).
   */
  registerCloseGuard(shouldBlock: () => boolean, onBlocked: () => void): Promise<void>;
  /** Close the window for real (bypasses the guard). */
  closeNow(): Promise<void>;

  /** Map an <img src> in a rendered doc to something the webview can load. */
  resolveAssetSrc(src: string, docDir: string): string;

  /**
   * Web only: flush an explicit user Save for handle-less files (download
   * fallback). Desktop writes are already durable, so it's optional.
   */
  commitFile?(path: string): Promise<void>;
  /** Web only: pick a .css theme file and store it as a user theme. */
  importTheme?(): Promise<boolean>;
  /** Pick a destination for Save As…; null = cancelled. */
  saveFileDialog?(suggestedName: string): Promise<string | null>;
  /** Desktop only: reveal <configDir>/themes in the OS file manager. */
  revealThemesDir?(): Promise<void>;

  /**
   * Managed external-link hand-off (SPEC11 §4): open an http(s) URL outside
   * the app — OS default browser on desktop, new noopener tab on web. The
   * webview itself never navigates anywhere.
   */
  openExternal(url: string): Promise<void>;

  /**
   * Native menu installation (SPEC12 §3.3). Defined ⇒ the platform owns the
   * menu and the in-app header is not rendered at all (SPEC12 §2.3); item
   * activations dispatch into the command registry. Desktop implements it;
   * web never does; the dev shim records the spec under ?nativeMenu=1.
   */
  setAppMenu?(spec: MenuSpec): Promise<void>;
}
