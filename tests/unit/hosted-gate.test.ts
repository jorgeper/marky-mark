import { describe, expect, it } from 'vitest';
import {
  clearToken,
  detectHostedMode,
  HOSTED_META_NAME,
  readStoredToken,
  storePendingSignIn,
  storeToken,
  takePendingSignIn,
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
    const pending = { state: 's', verifier: 'v', tenantId: 't', clientId: 'c' };
    storePendingSignIn(store, pending);
    expect(takePendingSignIn(store)).toEqual(pending);
    // One-shot: a second take finds nothing — a leftover verifier could be
    // replayed against a later callback.
    expect(takePendingSignIn(store)).toBeNull();
    expect(store.size()).toBe(0);
    // Corrupt JSON and shape mismatches are treated as absent, and cleared.
    store.setItem('marky-mark.hosted.pending-sign-in', 'not json');
    expect(takePendingSignIn(store)).toBeNull();
    store.setItem('marky-mark.hosted.pending-sign-in', JSON.stringify({ state: 's' }));
    expect(takePendingSignIn(store)).toBeNull();
  });
});
