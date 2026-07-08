import type { Platform } from './types';

export type { Platform } from './types';

let instance: Promise<Platform> | null = null;

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/** Dev server and e2e runs use the localStorage fs shim; production web builds
 * must get the real static-web platform (SPEC2 FR-B.1). */
function useShim(): boolean {
  return import.meta.env.DEV || new URLSearchParams(window.location.search).has('shim');
}

/** Resolve the platform once: Tauri host, dev/e2e shim, or static web. */
export function getPlatform(): Promise<Platform> {
  if (!instance) {
    instance = isTauri()
      ? import('./tauri').then((m) => m.createTauriPlatform())
      : useShim()
        ? import('./browser').then((m) => m.createBrowserPlatform())
        : import('./web').then((m) => m.createWebPlatform());
  }
  return instance;
}
