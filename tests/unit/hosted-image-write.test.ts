// PRD 007 Req 8 / SPEC20 §2 (issue #267): the hosted raw binary PUT a pasted
// image lands through, driven by the REAL hosted platform against the REAL
// server over HTTP — the pair the e2e paste test exercises through a browser,
// at unit cost. The point of the file is the AUTH half: the `?raw=1` write
// must authenticate, refuse and expire exactly like the ordinary JSON
// document save that shares its `api()` seam (PRD 007 Req 5+17).

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import { createMemoryStorage } from './storage-contract';
import { hostedFilesRoot } from '../../src/lib/hostedPaths';
import {
  HOSTED_SESSION_EXPIRED,
  isHostedSessionExpired,
  type KeyValueStore,
  readStoredToken,
  storeToken,
} from '../../src/lib/hostedGate';
import { createHostedPlatform } from '../../src/platform/hosted';
import type { Platform } from '../../src/platform/types';

/** The bytes a paste hands the platform — a PNG header is enough to be one. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

interface Harness {
  base: string;
  call: (user: string, method: string, path: string, body?: string, headers?: Record<string, string>) => Promise<Response>;
  workspace: (owner: string) => Promise<string>;
  close: () => Promise<void>;
}

/** One app over the in-memory reference provider, signed in as the mock users. */
async function harness(): Promise<Harness> {
  const { provider } = createMemoryStorage();
  const server: Server = createServer(
    createApp(
      '/nonexistent-static',
      { auth: createMockAuthProvider(), storage: provider, directory: createMockDirectoryProvider() },
      'local',
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call: Harness['call'] = (user, method, path, body, headers) =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer mock:${user}`, ...headers }, body });
  return {
    base,
    call,
    async workspace(owner) {
      const created = (await (await call(owner, 'POST', '/api/workspaces', JSON.stringify({ name: 'Pastes' }))).json()) as {
        id: string;
      };
      return created.id;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Run `fn` with a hosted platform bound to `id` and signed in as `token` —
 * the browser globals `createHostedPlatform` reads, stubbed and restored
 * (the suite shares worker contexts: `isolate: false` in vitest.config.ts).
 * `store` is the localStorage the session's token lives in, handed to `fn`
 * so a test can re-arm the token or read back whether the session survived.
 */
async function withHostedPlatform(
  h: Harness,
  id: string,
  token: string,
  fn: (platform: Platform, store: KeyValueStore) => Promise<void>,
): Promise<void> {
  const realFetch = globalThis.fetch;
  const realWindow = (globalThis as { window?: unknown }).window;
  const kv = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: (k) => kv.get(k) ?? null,
    setItem: (k, v) => void kv.set(k, v),
    removeItem: (k) => void kv.delete(k),
  };
  storeToken(store, token);
  (globalThis as { window?: unknown }).window = {
    localStorage: store,
    sessionStorage: {
      getItem: (k: string) => (k === 'marky-mark.hosted.boot' ? JSON.stringify({ workspaceId: id }) : null),
      setItem: () => {},
      removeItem: () => {},
    },
    location: { search: '' },
  };
  // Relative (same-origin) paths get the test server's origin; the harness's
  // own absolute calls pass straight through.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return realFetch(url.startsWith('http') ? url : `${h.base}${url}`, init);
  }) as typeof fetch;
  try {
    await fn(createHostedPlatform(), store);
  } finally {
    globalThis.fetch = realFetch;
    (globalThis as { window?: unknown }).window = realWindow;
  }
}

/** Grant `user` a custom role holding exactly `permissions` in workspace `id`. */
async function memberWith(h: Harness, id: string, user: string, permissions: string[]): Promise<void> {
  const role = `Role${user}`;
  const made = await h.call('ada', 'POST', `/api/workspaces/${id}/roles`, JSON.stringify({ name: role, permissions }));
  expect(made.status).toBe(200);
  const added = await h.call('ada', 'POST', `/api/workspaces/${id}/members`, JSON.stringify({ id: `mock-${user}`, role }));
  expect(added.status).toBe(200);
}

describe('PRD 007 Req 8 (SPEC20 §2) hosted pasted-image write', () => {
  it('U1177: the raw image PUT carries the same session credential the JSON save does — the bytes land as a workspace blob', async () => {
    const h = await harness();
    try {
      const id = await h.workspace('ada');
      const root = hostedFilesRoot(id);
      await withHostedPlatform(h, id, 'mock:ada', async (platform) => {
        // The document save and the pasted image go through one seam: both
        // authenticate, in the one session, with no per-call credential.
        await platform.writeTextFile(`${root}/notes.md`, '# notes\n');
        await platform.writeBinaryFile?.(`${root}/images/pasted 1.png`, PNG);
      });
      // PRD 007 Req 8: stored as a blob under the document's image folder,
      // byte for byte, and served back to every member holding doc.read.
      await memberWith(h, id, 'grace', ['doc.read']);
      const got = await h.call('grace', 'GET', `/api/workspaces/${id}/files/images/pasted%201.png?raw=1`);
      expect(got.status).toBe(200);
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
      expect(got.headers.get('content-type')).toBe('image/png');
    } finally {
      await h.close();
    }
  });

  it('U1178: an expired session on the image write is a sign-in-again outcome, not a bare 401 — and the dead token is dropped', async () => {
    const h = await harness();
    try {
      const id = await h.workspace('ada');
      const root = hostedFilesRoot(id);
      // The session's Entra access token expired mid-edit: the client holds
      // no refresh token, so the stored bearer is simply no longer accepted.
      await withHostedPlatform(h, id, 'mock:ada', async (platform, store) => {
        storeToken(store, 'mock:expired-session');
        const failed = await platform.writeBinaryFile?.(`${root}/images/pasted 1.png`, PNG).catch((e: unknown) => e);
        expect(isHostedSessionExpired(failed)).toBe(true);
        expect((failed as Error).message).toBe(HOSTED_SESSION_EXPIRED);
        expect((failed as Error).message).not.toContain('401');
        // PRD 007 Req 5: the dead token is dropped through hostedGate's one
        // owner of that key, so the gate renders sign-in on the next load
        // instead of the app running on a session that cannot write.
        expect(readStoredToken(store)).toBe(null);
      });
      // Nothing was stored under a rejected session.
      expect((await h.call('ada', 'GET', `/api/workspaces/${id}/files/images/pasted%201.png?raw=1`)).status).toBe(404);
    } finally {
      await h.close();
    }
  });

  it('U1179: a member without the write verb still gets the named 403 refusal from the image write, never a 401', async () => {
    const h = await harness();
    try {
      const id = await h.workspace('ada');
      const root = hostedFilesRoot(id);
      // A member who may edit documents but may not create files: the paste
      // lands on a path holding nothing yet, so it needs `file.create` and is
      // refused by NAME (PRD 007 Req 17), exactly as an ordinary save refuses.
      await memberWith(h, id, 'alan', ['doc.read', 'doc.edit']);
      await withHostedPlatform(h, id, 'mock:alan', async (platform, store) => {
        const failed = await platform.writeBinaryFile?.(`${root}/images/pasted 1.png`, PNG).catch((e: unknown) => e);
        expect(isHostedSessionExpired(failed)).toBe(false);
        expect((failed as Error).message).toBe('You need the file.create permission to do that.');
        // A refused verb is not a dead session — the token stays put.
        expect(readStoredToken(store)).toBe('mock:alan');
      });
    } finally {
      await h.close();
    }
  });
});
