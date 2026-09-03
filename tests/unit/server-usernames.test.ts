import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import type { AuthUser, StorageProvider } from '../../server/providers/types';
import { ensureUsername, usernameClaimBlob, usernameRecordBlob } from '../../server/usernames';
import { createMemoryStorage } from './storage-contract';

// PRD 020 Req 12+13: username assignment and scratch-by-username resolution
// over HTTP (the server-scratchpad.test.ts harness), plus the storage races
// driven directly against ensureUsername with the in-memory seam.

describe('PRD 020 Req 12 username assignment', () => {
  const { provider, blobs } = createMemoryStorage();
  const auth = createMockAuthProvider();
  let server: Server;
  let base = '';
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    server = createServer(
      createApp('/nonexistent-static', { auth, storage: provider, directory: createMockDirectoryProvider() }, 'local'),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const username of ['ada', 'grace', 'alan', 'mary']) {
      const result = await auth.signIn({ username });
      if (result?.kind !== 'token') throw new Error('mock sign-in failed');
      tokens[username] = result.token;
    }
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (user: string, method: string, path: string, body?: string): Promise<Response> =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${tokens[user]}` }, body });

  const me = async (user: string): Promise<{ username: string; handle: string }> => {
    const res = await call(user, 'GET', '/api/me');
    expect(res.status).toBe(200);
    return (await res.json()) as { username: string; handle: string };
  };

  it('U1067: /api/me assigns the handle at first touch — stored per-user, claimed deployment-wide, and read back, never re-derived', async () => {
    const first = await me('ada');
    // A field distinct from `username` (the UPN); ada's alias slugifies to itself.
    expect(first.username).toBe('ada');
    expect(first.handle).toBe('ada');
    // The per-user record and the deployment-wide claim both exist.
    expect(JSON.parse(blobs.get(usernameRecordBlob('mock-ada'))!)).toEqual({ username: 'ada' });
    expect(JSON.parse(blobs.get(usernameClaimBlob('ada'))!)).toEqual({ userId: 'mock-ada' });
    // Later sign-ins read the STORED value even if it no longer matches what
    // derivation would say — proven by editing the record out from under it.
    await provider.write(usernameRecordBlob('mock-ada'), JSON.stringify({ username: 'renamed-alias' }));
    expect((await me('ada')).handle).toBe('renamed-alias');
    blobs.clear();
  });

  it('U1068: GET /api/scratch/<username> resolves for the owner’s members and 404s identically for unknown and inaccessible', async () => {
    // Assign handles and provision ada's scratch workspace.
    expect((await me('ada')).handle).toBe('ada');
    const resolve = await call('ada', 'POST', '/api/me/scratchpad');
    expect(resolve.status).toBe(200);
    const { id } = (await resolve.json()) as { id: string };
    // The owner resolves it by username, whatever the visited casing — the
    // canonical stored casing comes back for the address bar.
    const own = await call('ada', 'GET', '/api/scratch/Ada');
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ id, owner: 'ada' });
    // PRD 020 Req 13: a caller the access model does not admit gets 404…
    const denied = await call('grace', 'GET', '/api/scratch/ada');
    expect(denied.status).toBe(404);
    // …byte-identical to an unknown username — no probe can tell them apart.
    const unknown = await call('grace', 'GET', '/api/scratch/nobody');
    expect(unknown.status).toBe(404);
    expect(await denied.json()).toEqual(await unknown.json());
    // …and identical again for a user who exists but has no scratch yet.
    expect((await me('grace')).handle).toBe('grace');
    const unprovisioned = await call('alan', 'GET', '/api/scratch/grace');
    expect(unprovisioned.status).toBe(404);
    // A member the owner added CAN resolve it (PRD 019 Req 8's listing
    // exclusion stands; this route is what makes the link followable).
    const added = await call('ada', 'POST', `/api/workspaces/${id}/members`, JSON.stringify({ id: 'mock-grace', role: 'Viewer' }));
    expect(added.status).toBe(200);
    const member = await call('grace', 'GET', '/api/scratch/ada');
    expect(member.status).toBe(200);
    expect(((await member.json()) as { id: string }).id).toBe(id);
    // The listing still never carries ada's scratch row for grace.
    const listed = (await (await call('grace', 'GET', '/api/workspaces')).json()) as { id: string }[];
    expect(listed.some((row) => row.id === id)).toBe(false);
    blobs.clear();
  });
});

describe('PRD 020 Req 12 assignment races (storage seam)', () => {
  const user = (id: string, username: string, email?: string): AuthUser => ({
    id,
    username,
    displayName: username,
    ...(email !== undefined ? { email } : {}),
  });

  it('U1069: a contested slug goes to exactly one user — the loser dedupes onto the next suffix', async () => {
    const { provider, blobs } = createMemoryStorage();
    // Both derivations must observe the same "nothing taken yet" listing
    // before either claims: park list() until both callers have arrived.
    let waiting: (() => void)[] = [];
    const storage: StorageProvider = {
      ...provider,
      list(prefix) {
        return new Promise((resolve) => {
          waiting.push(() => resolve(provider.list(prefix)));
          if (waiting.length === 2) {
            const release = waiting;
            waiting = [];
            for (const go of release) go();
          }
        });
      },
    };
    const [a, b] = await Promise.all([
      ensureUsername(storage, user('user-1', 'ada@contoso.com')),
      ensureUsername(storage, user('user-2', 'Ada@fabrikam.com')),
    ]);
    expect(new Set([a, b])).toEqual(new Set(['ada', 'ada-2']));
    // Each claim names its winner, and each record matches its claim.
    for (const [id, name] of [['user-1', a] as const, ['user-2', b] as const]) {
      expect(JSON.parse(blobs.get(usernameClaimBlob(name!))!)).toEqual({ userId: id });
      expect(JSON.parse(blobs.get(usernameRecordBlob(id))!)).toEqual({ username: name });
    }
  });

  it('U1070: two concurrent first calls by the SAME user mint exactly one username and leave no orphan claim', async () => {
    const { provider, blobs } = createMemoryStorage();
    // Park the record reads so both calls observe "no record yet".
    const record = usernameRecordBlob('user-1');
    let waiting: (() => void)[] = [];
    const storage: StorageProvider = {
      ...provider,
      read(path) {
        if (path === record && waiting.length < 2 && !blobs.has(record)) {
          return new Promise((resolve) => {
            waiting.push(() => resolve(provider.read(path)));
            if (waiting.length === 2) for (const go of waiting) go();
          });
        }
        return provider.read(path);
      },
    };
    const [a, b] = await Promise.all([
      ensureUsername(storage, user('user-1', 'grace@contoso.com')),
      ensureUsername(storage, user('user-1', 'grace@contoso.com')),
    ]);
    expect(a).toBe('grace');
    expect(b).toBe('grace');
    expect(JSON.parse(blobs.get(record)!)).toEqual({ username: 'grace' });
    // Exactly one claim blob exists — nothing leaked from the losing call.
    expect([...blobs.keys()].filter((path) => path.startsWith('usernames/'))).toEqual([
      usernameClaimBlob('grace'),
    ]);
    // And the assignment is idempotent afterwards: no new blobs, same answer.
    expect(await ensureUsername(storage, user('user-1', 'changed@contoso.com'))).toBe('grace');
    expect([...blobs.keys()].filter((path) => path.startsWith('usernames/')).length).toBe(1);
  });

  it('U1071: reserved words and guest identities — the stored assignment never shadows a route word', async () => {
    const { provider } = createMemoryStorage();
    expect(await ensureUsername(provider, user('user-1', 'scratch@contoso.com'))).toBe('scratch-2');
    expect(
      await ensureUsername(provider, user('user-2', 'jane_gmail.com#EXT#@contoso.onmicrosoft.com', 'jane@gmail.com')),
    ).toBe('jane');
  });
});
