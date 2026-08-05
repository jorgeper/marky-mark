import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';

// PRD 007 Req 1+4: the hosted backend in local dev mode — booted by the
// second `webServer` entry in playwright.config.ts (`npm run server:local`:
// Azurite storage emulator + seeded mock auth/directory + the built SPA), on
// 4924 so it never collides with the shim server's 4923. Everything here is
// localhost-only: zero Azure resources, zero external network.
const HOSTED = 'http://localhost:4924';

/** Sign in as a seeded mock user and return the bearer token. */
async function signIn(request: APIRequestContext, username: string): Promise<string> {
  const res = await request.post(`${HOSTED}/api/auth/sign-in`, { data: { username } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { kind: string; token: string };
  expect(body.kind).toBe('token');
  return body.token;
}

test('E159: unauthenticated API requests are rejected with 401 — /api/me, files, and directory alike', async ({
  request,
}) => {
  // PRD 007 Req 3: every endpoint but sign-in demands a valid bearer token.
  for (const path of ['/api/me', '/api/files', '/api/files/notes/a.md', '/api/directory/search?q=ada']) {
    const res = await request.get(`${HOSTED}${path}`);
    expect(res.status(), `${path} without a token`).toBe(401);
  }
  // A garbage token is exactly as unauthenticated as no token.
  const garbage = await request.get(`${HOSTED}/api/me`, {
    headers: { Authorization: 'Bearer not-a-real-token' },
  });
  expect(garbage.status()).toBe(401);
});

test('E160: sign-in as a seeded mock user succeeds and the token authenticates /api/me', async ({
  request,
}) => {
  // PRD 007 Req 4: the local dev mode's mock auth with seeded test users.
  const token = await signIn(request, 'ada');
  const me = await request.get(`${HOSTED}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  expect(me.status()).toBe(200);
  expect(await me.json()).toEqual({ id: 'mock-ada', username: 'ada', displayName: 'Ada Lovelace' });
  // An unknown username is refused sign-in outright.
  const nobody = await request.post(`${HOSTED}/api/auth/sign-in`, { data: { username: 'mallory' } });
  expect(nobody.status()).toBe(401);
});

test('E161: a file written through the API reads back identical — a real round-trip through Azurite', async ({
  request,
}) => {
  // PRD 007 Req 4: the storage provider is the real Azure Blob Storage code
  // pointed at Azurite's dev endpoint, so this write/read exercises the same
  // path production uses — offline.
  const token = await signIn(request, 'grace');
  const headers = { Authorization: `Bearer ${token}` };
  const content = `# Round trip\n\nunicode: héllo — ✓ 私\n\nline three at ${test.info().workerIndex}\n`;
  const path = `e2e/roundtrip-${test.info().workerIndex}.md`;

  const put = await request.put(`${HOSTED}/api/files/${path}`, { headers, data: content });
  expect(put.status()).toBe(200);
  const { etag } = (await put.json()) as { etag: string };
  expect(etag).not.toBe('');

  const get = await request.get(`${HOSTED}/api/files/${path}`, { headers });
  expect(get.status()).toBe(200);
  expect(await get.json()).toEqual({ path, content, etag });

  // The file also shows up in the listing with its metadata.
  const list = await request.get(`${HOSTED}/api/files?prefix=e2e/`, { headers });
  expect(list.status()).toBe(200);
  const listed = (await list.json()) as { path: string; etag: string }[];
  expect(listed.map((f) => f.path)).toContain(path);
});

test('E162: user-directory search returns the seeded mock users', async ({ request }) => {
  // PRD 007 Req 4: the directory provider is the seeded mock in local mode.
  const token = await signIn(request, 'alan');
  const headers = { Authorization: `Bearer ${token}` };
  const grace = await request.get(`${HOSTED}/api/directory/search?q=hopper`, { headers });
  expect(grace.status()).toBe(200);
  expect(await grace.json()).toEqual([
    { id: 'mock-grace', username: 'grace', displayName: 'Grace Hopper' },
  ]);
  // Substring matching spans display names and usernames.
  const kat = await request.get(`${HOSTED}/api/directory/search?q=kath`, { headers });
  expect((await kat.json()) as unknown[]).toEqual([
    expect.objectContaining({ displayName: 'Katherine Johnson' }),
  ]);
  const none = await request.get(`${HOSTED}/api/directory/search?q=zz-nobody`, { headers });
  expect(await none.json()).toEqual([]);
});

test('E163: the server serves the built SPA HTML at / from the same origin as the API', async ({
  request,
}) => {
  // PRD 007 Req 1: one origin for SPA and API. The SPA needs no auth (the
  // sign-in UI is the sibling hosted-front-end issue); deep links fall back
  // to index.html.
  const home = await request.get(`${HOSTED}/`);
  expect(home.status()).toBe(200);
  expect(home.headers()['content-type']).toContain('text/html');
  const html = await home.text();
  expect(html).toContain('<div id="root">');
  // SPA fallback: a client-side route serves the same document, not a 404.
  const deep = await request.get(`${HOSTED}/some/client/route`);
  expect(deep.status()).toBe(200);
  expect(await deep.text()).toContain('<div id="root">');
});

test('E164: a malformed percent-escape in the path answers 400 — on static and API routes alike', async ({
  request,
}) => {
  // decodeURIComponent throws on bad escapes like %zz; the server must
  // answer 400 (not crash) whichever handler the path lands in.
  const staticBad = await request.get(`${HOSTED}/%zz`);
  expect(staticBad.status()).toBe(400);
  const token = await signIn(request, 'ada');
  const headers = { Authorization: `Bearer ${token}` };
  const fileBad = await request.get(`${HOSTED}/api/files/%zz`, { headers });
  expect(fileBad.status()).toBe(400);
  const userBad = await request.get(`${HOSTED}/api/directory/users/%zz`, { headers });
  expect(userBad.status()).toBe(400);
  // And the server is still alive to serve the next request.
  const home = await request.get(`${HOSTED}/`);
  expect(home.status()).toBe(200);
});
