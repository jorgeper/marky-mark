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
    {
      id: 'mock-grace',
      username: 'grace',
      displayName: 'Grace Hopper',
      // PRD 007 Req 6: results point avatars at the app's own origin.
      avatarUrl: '/api/directory/users/mock-grace/photo',
    },
  ]);
  // Substring matching spans display names and usernames.
  const kat = await request.get(`${HOSTED}/api/directory/search?q=kath`, { headers });
  expect((await kat.json()) as unknown[]).toEqual([
    expect.objectContaining({ displayName: 'Katherine Johnson' }),
  ]);
  const none = await request.get(`${HOSTED}/api/directory/search?q=zz-nobody`, { headers });
  expect(await none.json()).toEqual([]);
});

test('E172: directory search results carry working same-origin avatar URLs and the photo endpoint serves image bytes', async ({
  request,
}) => {
  // PRD 007 Req 6: avatars flow through the directory seam — the SPA never
  // sees a Graph URL, only /api/directory/users/<id>/photo on its own origin.
  const token = await signIn(request, 'ada');
  const headers = { Authorization: `Bearer ${token}` };
  const search = await request.get(`${HOSTED}/api/directory/search?q=hopper`, { headers });
  expect(search.status()).toBe(200);
  const [grace] = (await search.json()) as { avatarUrl?: string }[];
  expect(grace.avatarUrl).toBe('/api/directory/users/mock-grace/photo');
  const photo = await request.get(`${HOSTED}${grace.avatarUrl}`, { headers });
  expect(photo.status()).toBe(200);
  expect(photo.headers()['content-type']).toContain('image/');
  const bytes = await photo.body();
  expect(bytes.length).toBeGreaterThan(0);
  // Deterministic: the seeded avatar is the same picture on every fetch.
  const again = await request.get(`${HOSTED}${grace.avatarUrl}`, { headers });
  expect(await again.body()).toEqual(bytes);
});

test('E173: a user with no photo and an unknown user both answer 404 on photo — and unknown on lookup too', async ({
  request,
}) => {
  // PRD 007 Req 6: katherine is seeded without a photo (the initials-
  // fallback path); a vanished user 404s on lookup and photo alike.
  const token = await signIn(request, 'grace');
  const headers = { Authorization: `Bearer ${token}` };
  const kat = await request.get(`${HOSTED}/api/directory/users/mock-katherine`, { headers });
  expect(kat.status()).toBe(200);
  expect(await kat.json()).toEqual({
    id: 'mock-katherine',
    username: 'katherine',
    displayName: 'Katherine Johnson',
  });
  const noPhoto = await request.get(`${HOSTED}/api/directory/users/mock-katherine/photo`, { headers });
  expect(noPhoto.status()).toBe(404);
  const goneLookup = await request.get(`${HOSTED}/api/directory/users/mock-nobody`, { headers });
  expect(goneLookup.status()).toBe(404);
  const gonePhoto = await request.get(`${HOSTED}/api/directory/users/mock-nobody/photo`, { headers });
  expect(gonePhoto.status()).toBe(404);
});

test('E174: the avatar photo endpoint sits inside the auth guard — 401 without a token', async ({
  request,
}) => {
  // PRD 007 Req 6 + Req 3: the photo proxy is as guarded as every other
  // /api/ endpoint.
  const bare = await request.get(`${HOSTED}/api/directory/users/mock-ada/photo`);
  expect(bare.status()).toBe(401);
  const garbage = await request.get(`${HOSTED}/api/directory/users/mock-ada/photo`, {
    headers: { Authorization: 'Bearer not-a-real-token' },
  });
  expect(garbage.status()).toBe(401);
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

test('E165: an unauthenticated visit to the hosted server shows only the sign-in page', async ({ page }) => {
  // PRD 007 Req 5: the served HTML carries the hosted marker, so the SPA
  // gates on sign-in — no editor, sidebar, menus, or document content.
  await page.goto(`${HOSTED}/`);
  await expect(page.getByTestId('hosted-sign-in')).toBeVisible();
  await expect(page.getByTestId('hosted-sign-in-username')).toBeVisible();
  for (const id of ['editor', 'doc', 'empty-hint', 'folder-panel', 'toolbar-shell', 'panel']) {
    await expect(page.getByTestId(id), `${id} must not render pre-auth`).toHaveCount(0);
  }
});

test('E166: signing in as a seeded mock user renders the app shell', async ({ page }) => {
  // PRD 007 Req 5: local dev mode signs in end to end — mock user in, the
  // normal start page (splash) out, sign-in page gone.
  await page.goto(`${HOSTED}/`);
  await page.getByTestId('hosted-sign-in-username').fill('ada');
  await page.getByTestId('hosted-sign-in-submit').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('hosted-sign-in')).toHaveCount(0);
});

test('E167: the signed-in session survives a page reload', async ({ page }) => {
  // PRD 007 Req 5: the stored token is revalidated on boot via GET /api/me
  // (a bearer-carrying API call), so a reload lands in the app, not sign-in.
  await page.goto(`${HOSTED}/`);
  await page.getByTestId('hosted-sign-in-username').fill('grace');
  await page.getByTestId('hosted-sign-in-submit').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('hosted-sign-in')).toHaveCount(0);
});

test('E168: a failed sign-in surfaces as an on-page error and the API guard still answers 401', async ({
  page,
  request,
}) => {
  // PRD 007 Req 5: sign-in failures are UI state, never console output, and
  // the page stays on sign-in with no app shell. The refusal is mocked with
  // an in-page intercept because a real 401 response makes Chromium itself
  // log a console error, which the fixtures' zero-console-error guard
  // (rightly) rejects; the server's own 401 for unknown users is pinned by
  // E160, and the guard across endpoints by E159 and the request below.
  await page.route('**/api/auth/sign-in', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.goto(`${HOSTED}/`);
  await page.getByTestId('hosted-sign-in-username').fill('mallory');
  await page.getByTestId('hosted-sign-in-submit').click();
  await expect(page.getByTestId('hosted-sign-in-error')).toContainText('Sign-in failed');
  await expect(page.getByTestId('hosted-sign-in')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  const unauthenticated = await request.get(`${HOSTED}/api/me`);
  expect(unauthenticated.status()).toBe(401);
});

/** Create a workspace and return its id (PRD 007 Req 10: creator → Owner). */
async function createWorkspace(request: APIRequestContext, token: string, name: string): Promise<string> {
  const res = await request.post(`${HOSTED}/api/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test('E172: creating a workspace yields a manifest blob under its own prefix with the creator as Owner', async ({
  request,
}) => {
  // PRD 007 Req 7: per-workspace prefix + manifest blob in Azurite — real
  // blob storage code, zero Azure resources. The manifest records the
  // creator as sole Owner and everyone-access off.
  const token = await signIn(request, 'ada');
  const headers = { Authorization: `Bearer ${token}` };
  const name = `E172 workspace w${test.info().workerIndex}`;
  const id = await createWorkspace(request, token, name);

  const manifestRes = await request.get(`${HOSTED}/api/workspaces/${id}/manifest`, { headers });
  expect(manifestRes.status()).toBe(200);
  const { manifest } = (await manifestRes.json()) as {
    manifest: { version: number; name: string; members: unknown[]; everyone: unknown };
  };
  expect(manifest.version).toBe(1);
  expect(manifest.name).toBe(name);
  expect(manifest.members).toEqual([{ id: 'mock-ada', role: 'Owner' }]);
  expect(manifest.everyone).toEqual({ enabled: false, role: 'Viewer' });

  // The workspace shows up in the signed-in metadata listing (PRD 007 Req 11)…
  const list = await request.get(`${HOSTED}/api/workspaces`, { headers });
  const listed = (await list.json()) as { id: string; name: string }[];
  expect(listed.map((w) => w.id)).toContain(id);
  // …its manifest blob is invisible to workspace file listings (it lives
  // outside the files/ prefix)…
  const files = await request.get(`${HOSTED}/api/workspaces/${id}/files`, { headers });
  expect(await files.json()).toEqual([]);
  // …and the legacy workspace-agnostic scaffold cannot reach or list it.
  const viaScaffold = await request.get(`${HOSTED}/api/files/workspaces/${id}/manifest.json`, { headers });
  expect(viaScaffold.status()).toBe(403);
  const scaffoldList = (await (await request.get(`${HOSTED}/api/files`, { headers })).json()) as {
    path: string;
  }[];
  expect(scaffoldList.every((f) => !f.path.startsWith('workspaces/'))).toBe(true);
});

test('E173: a member granted Viewer can read workspace files but gets 403 writing — the verb is named', async ({
  request,
}) => {
  // PRD 007 Req 13+14+17: server-side enforcement of the built-in Viewer set.
  const ada = await signIn(request, 'ada');
  const adaHeaders = { Authorization: `Bearer ${ada}` };
  const id = await createWorkspace(request, ada, `E173 workspace w${test.info().workerIndex}`);
  const put = await request.put(`${HOSTED}/api/workspaces/${id}/files/notes/shared.md`, {
    headers: adaHeaders,
    data: '# shared\n',
  });
  expect(put.status()).toBe(200);

  // Ada (Owner: workspace.settings) grants Grace the Viewer role.
  const { manifest } = (await (
    await request.get(`${HOSTED}/api/workspaces/${id}/manifest`, { headers: adaHeaders })
  ).json()) as { manifest: { members: { id: string; role: string }[] } };
  manifest.members.push({ id: 'mock-grace', role: 'Viewer' });
  const update = await request.put(`${HOSTED}/api/workspaces/${id}/manifest`, {
    headers: adaHeaders,
    data: manifest,
  });
  expect(update.status()).toBe(200);

  const grace = { Authorization: `Bearer ${await signIn(request, 'grace')}` };
  // Viewer holds doc.read: listing and reading work…
  const read = await request.get(`${HOSTED}/api/workspaces/${id}/files/notes/shared.md`, { headers: grace });
  expect(read.status()).toBe(200);
  expect(((await read.json()) as { content: string }).content).toBe('# shared\n');
  // …but doc.edit and file.delete are missing: 403, naming the one
  // required permission the endpoint documents.
  const write = await request.put(`${HOSTED}/api/workspaces/${id}/files/notes/shared.md`, {
    headers: grace,
    data: 'overwrite',
  });
  expect(write.status()).toBe(403);
  expect(await write.json()).toEqual({ error: 'forbidden', required: 'doc.edit' });
  const del = await request.delete(`${HOSTED}/api/workspaces/${id}/files/notes/shared.md`, { headers: grace });
  expect(del.status()).toBe(403);
  expect(((await del.json()) as { required: string }).required).toBe('file.delete');
});

test('E174: a non-member of a workspace without everyone-access gets 403 reading file content', async ({
  request,
}) => {
  // PRD 007 Req 13+16+17: no membership, no everyone-access → fails closed
  // with 403 on content reads (metadata listing stays open per Req 11).
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E174 workspace w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/private.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: 'members only',
  });

  const alan = { Authorization: `Bearer ${await signIn(request, 'alan')}` };
  for (const path of [`/api/workspaces/${id}/files/private.md`, `/api/workspaces/${id}/files`, `/api/workspaces/${id}/manifest`]) {
    const res = await request.get(`${HOSTED}${path}`, { headers: alan });
    expect(res.status(), path).toBe(403);
    expect(((await res.json()) as { required: string }).required).toBe('doc.read');
  }
  // The pre-permission metadata listing still names the workspace (Req 11).
  const list = await request.get(`${HOSTED}/api/workspaces`, { headers: alan });
  const listed = (await list.json()) as { id: string }[];
  expect(listed.map((w) => w.id)).toContain(id);
});
