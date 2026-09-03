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
const VISIT_INTENT_KEY = 'marky-mark.hosted.visit-intent';
const BOOT_KEY = 'marky-mark.hosted.boot';

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
 * PRD 020 Req 9 (generalizing PRD 019 Req 2): the visited URL across the
 * Entra round trip. The OAuth redirect URI is the origin root, so the URL a
 * sign-in began on — a path deep link, the legacy `?workspace=` form, a
 * `#<heading-slug>` fragment, or a scratch route — does not survive the
 * navigation; this record (stored beside the pending sign-in when the
 * redirect leaves, taken when the callback completes) is what carries it.
 * Read-and-clear like the pending sign-in: a leftover intent must not route
 * a later, unrelated sign-in into someone's old deep link.
 */
export interface HostedVisit {
  pathname: string;
  search: string;
  hash: string;
}

export function storeVisitIntent(store: KeyValueStore, visit: HostedVisit): void {
  store.setItem(VISIT_INTENT_KEY, JSON.stringify(visit));
}

export function clearVisitIntent(store: KeyValueStore): void {
  store.removeItem(VISIT_INTENT_KEY);
}

export function takeVisitIntent(store: KeyValueStore): HostedVisit | null {
  const raw = store.getItem(VISIT_INTENT_KEY);
  store.removeItem(VISIT_INTENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HostedVisit>;
    if (typeof parsed.pathname === 'string' && typeof parsed.search === 'string' && typeof parsed.hash === 'string') {
      return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
    }
  } catch {
    // corrupt sessionStorage entry — treat as absent
  }
  return null;
}

/**
 * PRD 020 Req 5+6 (generalizing PRD 019 Req 10+11): the one-page-load
 * hand-off from the sign-in gate to the platform. HostedShell resolves the
 * visit — canonical path, legacy query, or /scratchpad — and rewrites the
 * URL to the canonical `/<workspace-name>[/<file…>]` form BEFORE the app
 * mounts; the platform, created later, learns from this record which
 * workspace the page is bound to, which file (if any) the path named, and
 * whether the visit was a scratchpad one (fresh scratch buffer,
 * prompt-exempt). Read-and-clear: the gate re-resolves the path on every
 * page load, so a reload re-mints the record from the URL itself — nothing
 * stale can bind a later page.
 */
export interface HostedBoot {
  workspaceId: string;
  /** The workspace's unique name — what the canonical URL is built from. */
  uniqueName?: string;
  /** The file the path named, relative to the workspace's files root. */
  file?: string;
  /** PRD 019 Req 10: this binding is a scratch visit (fresh scratch buffer). */
  scratch?: boolean;
  /**
   * PRD 020 Req 10+13: the bound workspace is a scratch workspace, owned by
   * this username — the canonical URL is `/<scratchOwner>/scratch[/…]`, never
   * the workspace's own unique-name path.
   */
  scratchOwner?: string;
}

export function storeHostedBoot(store: KeyValueStore, boot: HostedBoot): void {
  store.setItem(BOOT_KEY, JSON.stringify(boot));
}

export function takeHostedBoot(store: KeyValueStore): HostedBoot | null {
  const raw = store.getItem(BOOT_KEY);
  store.removeItem(BOOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HostedBoot>;
    if (typeof parsed.workspaceId === 'string') {
      return {
        workspaceId: parsed.workspaceId,
        ...(typeof parsed.uniqueName === 'string' ? { uniqueName: parsed.uniqueName } : {}),
        ...(typeof parsed.file === 'string' ? { file: parsed.file } : {}),
        ...(parsed.scratch === true ? { scratch: true } : {}),
        ...(typeof parsed.scratchOwner === 'string' ? { scratchOwner: parsed.scratchOwner } : {}),
      };
    }
  } catch {
    // corrupt sessionStorage entry — treat as absent
  }
  return null;
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
