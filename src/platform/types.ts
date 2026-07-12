import type { MenuSpec } from '../lib/menuSpec';
import type { AuxKind } from '../lib/auxProtocol';

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
  /**
   * Pick a destination for Save As… / exports; null = cancelled. `kind`
   * selects the extension filter (default markdown; the review-bundle
   * export passes 'html' so the OS dialog doesn't force a .md suffix).
   */
  saveFileDialog?(suggestedName: string, kind?: 'markdown' | 'html'): Promise<string | null>;
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

  /**
   * SPEC13 §4.2: open (or focus — singleton) the Settings/About aux window.
   * Defined ⇒ the in-page settings/about overlays are never rendered.
   * Desktop implements it; web never does; the dev shim only under
   * ?nativeMenu=1 (window.open + BroadcastChannel).
   */
  openAuxWindow?(kind: AuxKind): Promise<void>;
  /** Cross-window event bus for the SPEC13 §3 protocol. */
  busEmit?(event: string, payload: unknown): Promise<void>;
  /** Subscribe; resolves to an unlisten function. */
  busListen?(event: string, cb: (payload: unknown) => void): Promise<() => void>;
  /**
   * Close the focused aux window if any (the ⌘W path — the native Close
   * Window accelerator runs in the main window's JS regardless of window
   * focus). Resolves true if an aux window was focused and closed.
   */
  closeFocusedAuxWindow?(): Promise<boolean>;

  /**
   * File → Print… : the webview's REAL native print of the current window
   * (Rust print_view command — window.print() is a WKWebView no-op). The
   * OS dialog offers Save as PDF. Print CSS hides the app chrome. The shim
   * records invocations on window.__mmPrints; web leaves it undefined (the
   * browser's own ⌘P already covers it).
   */
  printCurrent?(): Promise<void>;

  /**
   * SPEC19 §2.3: the updater seam. Desktop implements it with the official
   * updater/process plugins (all network Rust-side, user-initiated only,
   * responses verified against the baked-in public key); web leaves it
   * undefined; the shim mocks it via window.__mmUpdate for e2e.
   */
  updates?: {
    /** null ⇒ already up to date. Throws on network/manifest/signature errors. */
    check(): Promise<{ version: string; notes: string } | null>;
    downloadAndInstall(onProgress: (pct: number) => void): Promise<void>;
    restart(): Promise<void>;
  };
}
