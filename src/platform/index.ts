import type { Platform } from './types';
import { detectHostedMode } from '../lib/hostedGate';

export type { Platform, WriteResult } from './types';

let instance: Promise<Platform> | null = null;

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/**
 * PRD 007 Req 2+5: only HTML served by the hosted backend carries the
 * injected marker, so Tauri, the dev shim and static web hosting resolve
 * exactly as before — the hosted platform exists for them nowhere.
 */
function isHosted(): boolean {
  return detectHostedMode(document) !== null;
}

/** Dev server and e2e runs use the localStorage fs shim; production web builds
 * must get the real static-web platform (SPEC2 FR-B.1). */
function useShim(): boolean {
  return import.meta.env.DEV || new URLSearchParams(window.location.search).has('shim');
}

/** Load the backend this page runs on, first match wins. */
function loadPlatform(): Promise<Platform> {
  if (isTauri()) return import('./tauri').then((m) => m.createTauriPlatform());
  if (isHosted()) return import('./hosted').then((m) => m.createHostedPlatform());
  if (useShim()) return import('./browser').then((m) => m.createBrowserPlatform());
  return import('./web').then((m) => m.createWebPlatform());
}

/** Resolve the platform once: Tauri host, hosted backend, dev/e2e shim, or static web. */
export function getPlatform(): Promise<Platform> {
  if (!instance) instance = loadPlatform();
  return instance;
}
