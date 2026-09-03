// PRD 007 Req 5: hosted-flavor detection and sign-in session persistence.
// The hosted server injects a <meta> marker into the HTML it serves (see
// server/app.ts injectHostedMarker), so the unmodified SPA build can tell
// "served by the hosted backend" from every other flavor — Tauri, the dev
// shim, and static hosting serve unmarked HTML and never gate on sign-in.
// Storage is a passed-in Storage-shaped object, keeping this module pure.

export type HostedMode = 'local' | 'azure';

/** The marker name server/app.ts injects; content is the server's mode. */
export const HOSTED_META_NAME = 'marky-mark-hosted';

const TOKEN_KEY = 'marky-mark.hosted.token';
const PENDING_KEY = 'marky-mark.hosted.pending-sign-in';
const SCRATCHPAD_INTENT_KEY = 'marky-mark.hosted.scratchpad-intent';
const SCRATCH_BOOT_KEY = 'marky-mark.hosted.scratch-boot';

interface MetaSource {
  querySelector(selector: string): { getAttribute(name: string): string | null } | null;
}

/** The subset of DOM Storage this module touches (localStorage-compatible). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The hosted mode the served HTML declares, or null when this build is not
 * being served by the hosted backend (the only source of the marker).
 */
export function detectHostedMode(doc: MetaSource): HostedMode | null {
  const content = doc.querySelector(`meta[name="${HOSTED_META_NAME}"]`)?.getAttribute('content');
  return content === 'local' || content === 'azure' ? content : null;
}

/** The bearer token of the signed-in session, or null when signed out. */
export function readStoredToken(store: KeyValueStore): string | null {
  return store.getItem(TOKEN_KEY);
}

export function storeToken(store: KeyValueStore, token: string): void {
  store.setItem(TOKEN_KEY, token);
}

export function clearToken(store: KeyValueStore): void {
  store.removeItem(TOKEN_KEY);
}

/**
 * PRD 019 Req 2: the /scratchpad intent across the Entra round trip. The
 * OAuth redirect URI is the origin root, so the pathname a sign-in began on
 * does not survive the navigation — this record (stored beside the pending
 * sign-in when the redirect leaves, taken when the callback completes) is
 * what carries it. Read-and-clear like the pending sign-in: a leftover
 * intent must not route a later, unrelated sign-in into the scratchpad.
 */
export function storeScratchpadIntent(store: KeyValueStore): void {
  store.setItem(SCRATCHPAD_INTENT_KEY, '1');
}

export function clearScratchpadIntent(store: KeyValueStore): void {
  store.removeItem(SCRATCHPAD_INTENT_KEY);
}

export function takeScratchpadIntent(store: KeyValueStore): boolean {
  const raw = store.getItem(SCRATCHPAD_INTENT_KEY);
  store.removeItem(SCRATCHPAD_INTENT_KEY);
  return raw !== null;
}

/**
 * PRD 019 Req 10+11: the one-page-load hand-off from the sign-in gate to the
 * platform. HostedShell resolves a /scratchpad visit and rewrites the URL to
 * `/?workspace=<id>` BEFORE the app mounts; the platform, created later, must
 * still learn that this particular binding is a scratchpad visit (fresh
 * scratch buffer, prompt-exempt). Read-and-clear so a reload of the rewritten
 * URL boots as a plain workspace binding, exactly as PRD 019 Req 3 demands.
 */
export function storeScratchBoot(store: KeyValueStore, workspaceId: string): void {
  store.setItem(SCRATCH_BOOT_KEY, workspaceId);
}

export function takeScratchBoot(store: KeyValueStore): string | null {
  const raw = store.getItem(SCRATCH_BOOT_KEY);
  store.removeItem(SCRATCH_BOOT_KEY);
  return raw;
}

/** What the redirect leg of the PKCE flow must remember across navigation. */
export interface PendingSignIn {
  state: string;
  verifier: string;
  tenantId: string;
  clientId: string;
  /** The server-pinned scope string, echoed in the token exchange (issue #184). */
  scope: string;
}

export function storePendingSignIn(store: KeyValueStore, pending: PendingSignIn): void {
  store.setItem(PENDING_KEY, JSON.stringify(pending));
}

/**
 * Read-and-clear the pending sign-in. One-shot on purpose: a verifier or
 * state left behind could be replayed against a later callback.
 */
export function takePendingSignIn(store: KeyValueStore): PendingSignIn | null {
  const raw = store.getItem(PENDING_KEY);
  store.removeItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSignIn>;
    if (
      typeof parsed.state === 'string' &&
      typeof parsed.verifier === 'string' &&
      typeof parsed.tenantId === 'string' &&
      typeof parsed.clientId === 'string' &&
      typeof parsed.scope === 'string'
    ) {
      return {
        state: parsed.state,
        verifier: parsed.verifier,
        tenantId: parsed.tenantId,
        clientId: parsed.clientId,
        scope: parsed.scope,
      };
    }
  } catch {
    // corrupt sessionStorage entry — treat as absent
  }
  return null;
}
