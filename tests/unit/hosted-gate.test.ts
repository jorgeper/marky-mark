import { describe, expect, it } from 'vitest';
import {
  clearScratchpadIntent,
  clearToken,
  detectHostedMode,
  HOSTED_META_NAME,
  readStoredToken,
  storePendingSignIn,
  storeScratchBoot,
  storeScratchpadIntent,
  storeToken,
  takePendingSignIn,
  takeScratchBoot,
  takeScratchpadIntent,
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

// PRD 019 Req 2: the /scratchpad intent across the Entra round trip — the
// redirect URI is the origin root, so the pathname a sign-in began on rides
// this record instead. And Req 10: the one-page-load hand-off that tells the
// platform its fresh `?workspace=` binding is a scratchpad visit.
describe('PRD 019 Req 2+10 scratchpad intent and boot hand-off', () => {
  it('U1037: the sign-in intent stores, replays exactly once, and clears on an unrelated sign-in', () => {
    const store = memoryStore();
    expect(takeScratchpadIntent(store)).toBe(false);
    storeScratchpadIntent(store);
    expect(takeScratchpadIntent(store)).toBe(true);
    // One-shot: a later sign-in must not be routed into the scratchpad by a
    // leftover record.
    expect(takeScratchpadIntent(store)).toBe(false);
    // A sign-in that begins anywhere else clears an abandoned intent.
    storeScratchpadIntent(store);
    clearScratchpadIntent(store);
    expect(takeScratchpadIntent(store)).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('U1038: the scratch-boot signal carries the workspace id one page load and is gone on the next', () => {
    const store = memoryStore();
    expect(takeScratchBoot(store)).toBeNull();
    storeScratchBoot(store, 'ws-42');
    expect(takeScratchBoot(store)).toBe('ws-42');
    // Read-and-clear: a reload of the rewritten /?workspace=<id> URL boots
    // as a plain workspace binding with no scratch buffer (PRD 019 Req 3).
    expect(takeScratchBoot(store)).toBeNull();
    expect(store.size()).toBe(0);
  });
});
