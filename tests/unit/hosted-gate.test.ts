import { describe, expect, it } from 'vitest';
import {
  clearToken,
  clearVisitIntent,
  detectHostedMode,
  HOSTED_META_NAME,
  readStoredToken,
  storeHostedBoot,
  storePendingSignIn,
  storeToken,
  storeVisitIntent,
  takeHostedBoot,
  takePendingSignIn,
  takeVisitIntent,
  type KeyValueStore,
} from '../../src/lib/hostedGate';

/** A fake document exposing one meta tag (or none). */
function docWithMeta(content: string | null) {
  return {
    querySelector: (selector: string) =>
      content !== null && selector === `meta[name="${HOSTED_META_NAME}"]`
        ? { getAttribute: (name: string) => (name === 'content' ? content : null) }
        : null,
  };
}

/** An in-memory Storage stand-in. */
function memoryStore(): KeyValueStore & { size(): number } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    size: () => map.size,
  };
}

// PRD 007 Req 5: hosted-mode detection via the server-injected marker, and
// the sign-in session's storage round trips.
describe('PRD 007 Req 5 hosted-mode gate', () => {
  it('U237: the injected meta marker selects the mode; absent or bogus markers mean not hosted', () => {
    expect(detectHostedMode(docWithMeta('local'))).toBe('local');
    expect(detectHostedMode(docWithMeta('azure'))).toBe('azure');
    // Unmarked HTML — Tauri, the dev shim, static hosting — never gates.
    expect(detectHostedMode(docWithMeta(null))).toBeNull();
    expect(detectHostedMode(docWithMeta(''))).toBeNull();
    expect(detectHostedMode(docWithMeta('aws'))).toBeNull();
  });

  it('U238: the session token stores, reads back, and clears', () => {
    const store = memoryStore();
    expect(readStoredToken(store)).toBeNull();
    storeToken(store, 'mock:ada');
    expect(readStoredToken(store)).toBe('mock:ada');
    clearToken(store);
    expect(readStoredToken(store)).toBeNull();
  });

  it('U239: the pending PKCE sign-in is one-shot and rejects corrupt or partial entries', () => {
    const store = memoryStore();
    const pending = { state: 's', verifier: 'v', tenantId: 't', clientId: 'c', scope: 'openid api://c/access_as_user' };
    storePendingSignIn(store, pending);
    expect(takePendingSignIn(store)).toEqual(pending);
    // One-shot: a second take finds nothing — a leftover verifier could be
    // replayed against a later callback.
    expect(takePendingSignIn(store)).toBeNull();
    expect(store.size()).toBe(0);
    // Corrupt JSON and shape mismatches are treated as absent, and cleared.
    // A scope-less entry is the pre-#184 shape: absent too, so the sign-in
    // restarts cleanly instead of exchanging with the wrong scopes.
    store.setItem('marky-mark.hosted.pending-sign-in', 'not json');
    expect(takePendingSignIn(store)).toBeNull();
    store.setItem('marky-mark.hosted.pending-sign-in', JSON.stringify({ state: 's' }));
    expect(takePendingSignIn(store)).toBeNull();
    store.setItem(
      'marky-mark.hosted.pending-sign-in',
      JSON.stringify({ state: 's', verifier: 'v', tenantId: 't', clientId: 'c' }),
    );
    expect(takePendingSignIn(store)).toBeNull();
  });
});

// PRD 020 Req 9 (generalizing PRD 019 Req 2): the visited URL across the
// Entra round trip — the redirect URI is the origin root, so the deep link a
// sign-in began on rides this record instead. And PRD 020 Req 5+6
// (generalizing PRD 019 Req 10): the one-page-load boot hand-off that tells
// the platform which workspace (and file) the resolved visit bound.
describe('PRD 020 Req 5+6+9 visit intent and boot hand-off', () => {
  it('U1037: the sign-in visit intent stores, replays exactly once, and clears on an unrelated sign-in', () => {
    const store = memoryStore();
    expect(takeVisitIntent(store)).toBeNull();
    const visit = { pathname: '/notes/guides/intro.md', search: '', hash: '#setup' };
    storeVisitIntent(store, visit);
    expect(takeVisitIntent(store)).toEqual(visit);
    // One-shot: a later sign-in must not be routed into the deep link by a
    // leftover record.
    expect(takeVisitIntent(store)).toBeNull();
    // A sign-in that begins anywhere else clears an abandoned intent.
    storeVisitIntent(store, visit);
    clearVisitIntent(store);
    expect(takeVisitIntent(store)).toBeNull();
    // Corrupt or shape-mismatched entries read as absent.
    store.setItem('marky-mark.hosted.visit-intent', 'not json');
    expect(takeVisitIntent(store)).toBeNull();
    store.setItem('marky-mark.hosted.visit-intent', JSON.stringify({ pathname: '/x' }));
    expect(takeVisitIntent(store)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it('U1038: the boot record carries the resolved binding one page load and is gone on the next', () => {
    const store = memoryStore();
    expect(takeHostedBoot(store)).toBeNull();
    storeHostedBoot(store, { workspaceId: 'ws-42', uniqueName: 'notes', file: 'guides/intro.md' });
    expect(takeHostedBoot(store)).toEqual({ workspaceId: 'ws-42', uniqueName: 'notes', file: 'guides/intro.md' });
    // Read-and-clear: the gate re-mints the record from the canonical URL on
    // every page load, so nothing stale can bind a later page (PRD 019 Req 3
    // kept: a reload boots as a plain workspace binding, no scratch buffer).
    expect(takeHostedBoot(store)).toBeNull();
    storeHostedBoot(store, { workspaceId: 'ws-42', scratch: true });
    expect(takeHostedBoot(store)).toEqual({ workspaceId: 'ws-42', scratch: true });
    // Corrupt entries read as absent.
    store.setItem('marky-mark.hosted.boot', JSON.stringify({ uniqueName: 'no-id' }));
    expect(takeHostedBoot(store)).toBeNull();
    expect(store.size()).toBe(0);
  });
});
