import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addComment, menuSave, openSettings, pasteImage } from './helpers';

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

// --- the hosted Platform implementation (PRD 007 Req 2/8/9) ------------------

/** A workspace whose `members` are added to the creator, each with `role`. */
async function sharedWorkspace(
  request: APIRequestContext,
  ownerToken: string,
  name: string,
  members: Array<{ id: string; role: string }>,
): Promise<string> {
  const headers = { Authorization: `Bearer ${ownerToken}` };
  const id = await createWorkspace(request, ownerToken, name);
  const { manifest } = (await (
    await request.get(`${HOSTED}/api/workspaces/${id}/manifest`, { headers })
  ).json()) as { manifest: { members: Array<{ id: string; role: string }> } };
  manifest.members.push(...members);
  const update = await request.put(`${HOSTED}/api/workspaces/${id}/manifest`, { headers, data: manifest });
  expect(update.status()).toBe(200);
  return id;
}

/** Sign in through the UI as `username` with the page bound to a workspace. */
async function signInTo(page: Page, username: string, workspace?: string): Promise<void> {
  await page.goto(`${HOSTED}/${workspace ? `?workspace=${workspace}` : ''}`);
  await page.getByTestId('hosted-sign-in-username').fill(username);
  await page.getByTestId('hosted-sign-in-submit').click();
}

/** Drop the stored session so the next load is a fresh signed-out browser. */
async function signOut(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.clear());
}

/** Open a document from the hosted workspace's folder sidebar. */
async function openFromSidebar(page: Page, name: string): Promise<void> {
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.getByTestId('folder-item').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('docname')).toContainText(name);
}

const PHRASE = 'anchored in the shared document';
const SHARED_DOC = `# Shared\n\nA line ${PHRASE} for both members to see.\n`;

test('E175: a comment one member writes is a workspace blob the next member reads back', async ({
  page,
  request,
}) => {
  // PRD 007 Req 2+8: the hosted platform IS the seam — the sidebar, the
  // document and the comment sidecar all resolve through the REST API. The
  // sidecar lands inside the workspace prefix, so a second signed-in member
  // opening the same document sees the comment.
  const ada = await signIn(request, 'ada');
  const id = await sharedWorkspace(request, ada, `E175 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Editor' },
  ]);
  const put = await request.put(`${HOSTED}/api/workspaces/${id}/files/shared.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: SHARED_DOC,
  });
  expect(put.status()).toBe(200);

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'shared.md');
  await addComment(page, PHRASE, 'Ada was here');
  await expect(page.getByTestId('comment-card')).toHaveCount(1);

  // The sidecar is a blob under the workspace prefix (Req 8), not browser
  // storage — the API sees it as an ordinary workspace file.
  const sidecar = `${HOSTED}/api/workspaces/${id}/files/shared.md.comments.json`;
  await expect
    .poll(async () => (await request.get(sidecar, { headers: { Authorization: `Bearer ${ada}` } })).status(), {
      timeout: 10_000,
    })
    .toBe(200);

  // A DIFFERENT signed-in member, in a fresh session, opens the same document.
  await signOut(page);
  await signInTo(page, 'grace', id);
  await openFromSidebar(page, 'shared.md');
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('comment-card')).toContainText('Ada was here');
});

test('E176: a pasted image is a workspace blob that renders for a second member', async ({ page, request }) => {
  // PRD 007 Req 8: writeBinaryFile PUTs the bytes into the workspace, and
  // resolveAssetSrc maps the doc-relative ref to a same-origin URL the
  // signed-in webview can load — for every member with doc.read.
  const TINY_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const ada = await signIn(request, 'ada');
  const id = await sharedWorkspace(request, ada, `E176 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Editor' },
  ]);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/pics.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# Pics\n\nPaste lands here.\n',
  });

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'pics.md');
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await pasteImage(page, TINY_PNG);
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('![pics 1](images/pics%201.png)');

  // The bytes are a workspace blob, served back with an image media type.
  const asset = `${HOSTED}/api/workspaces/${id}/files/images/pics 1.png?raw=1`;
  await expect
    .poll(async () => (await request.get(asset, { headers: { Authorization: `Bearer ${ada}` } })).status(), {
      timeout: 10_000,
    })
    .toBe(200);
  const bytes = await request.get(asset, { headers: { Authorization: `Bearer ${ada}` } });
  expect(bytes.headers()['content-type']).toBe('image/png');
  expect((await bytes.body()).length).toBeGreaterThan(0);

  // Ada saves the document, then Grace opens it and the image renders for her.
  await page.keyboard.press('Control+s');
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.get(`${HOSTED}/api/workspaces/${id}/files/pics.md`, {
              headers: { Authorization: `Bearer ${ada}` },
            })
          ).json()) as { content: string }
        ).content,
      { timeout: 10_000 },
    )
    .toContain('images/pics%201.png');

  await signOut(page);
  await signInTo(page, 'grace', id);
  await openFromSidebar(page, 'pics.md');
  const img = page.getByTestId('doc').locator('img[alt="pics 1"]');
  await expect(img).toBeVisible();
  // The src is the app's own origin carrying the signed-in session — never a
  // data: URI trapped in the pasting member's browser.
  expect(await img.getAttribute('src')).toContain(`/api/workspaces/${id}/files/images/pics%201.png?raw=1`);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test('E177: the User settings layer roams per user while the Workspace layer comes from the manifest', async ({
  page,
  request,
}) => {
  // PRD 007 Req 9: the PRD 002 layers in the hosted flavor — User is a
  // per-user blob behind /api/me/files (outside every workspace prefix),
  // Workspace is the manifest's own `settings` slot.
  const ada = await signIn(request, 'ada');
  const grace = await signIn(request, 'grace');
  // Per-user blobs outlive a test run (that is the point of roaming), so
  // start both users from a clean User layer — otherwise "the theme Ada
  // picked" could be whatever a previous run left behind.
  for (const token of [ada, grace]) {
    await request.delete(`${HOSTED}/api/me/files/settings.json`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  const id = await sharedWorkspace(request, ada, `E177 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Editor' },
  ]);
  // The workspace pins a W-scoped setting in its manifest.
  const headers = { Authorization: `Bearer ${ada}` };
  const { manifest } = (await (
    await request.get(`${HOSTED}/api/workspaces/${id}/manifest`, { headers })
  ).json()) as { manifest: Record<string, unknown> };
  const pinned = await request.put(`${HOSTED}/api/workspaces/${id}/manifest`, {
    headers,
    data: { ...manifest, settings: { imageFolder: 'shared-assets' } },
  });
  expect(pinned.status()).toBe(200);

  // Ada changes a personal (User-layer) setting in the app.
  await signInTo(page, 'ada', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await openSettings(page);
  const themeSelect = page.getByTestId('settings-theme-light');
  const chosen = await themeSelect.evaluate((el: HTMLSelectElement) => {
    const other = [...el.options].find((o) => o.value !== el.value)!;
    return other.value;
  });
  await themeSelect.selectOption(chosen);
  // The Workspace layer is already in force: it came from the manifest.
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('image-folder')).toHaveValue('shared-assets');
  await page.getByTestId('settings-close').click();

  // It is stored server-side under her own prefix, not in this browser.
  await expect
    .poll(
      async () => {
        const res = await request.get(`${HOSTED}/api/me/files/settings.json`, { headers });
        return res.ok() ? ((await res.json()) as { content: string }).content : '';
      },
      { timeout: 10_000 },
    )
    .toContain(chosen);

  // A fresh browser session as the SAME user gets the setting back (roaming),
  // and the manifest's pinned Workspace-layer value applies as well.
  await signOut(page);
  await signInTo(page, 'ada', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId('settings-theme-light')).toHaveValue(chosen);
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('image-folder')).toHaveValue('shared-assets');
  await page.getByTestId('settings-close').click();

  // A DIFFERENT user inherits neither: their own User layer is untouched…
  await signOut(page);
  await signInTo(page, 'grace', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId('settings-theme-light')).not.toHaveValue(chosen);
  // …while the Workspace layer, which belongs to the workspace and not to a
  // person, applies to her too.
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('image-folder')).toHaveValue('shared-assets');
});

// --- workspace lifecycle: create, open, delete (PRD 007 Req 10/11/12) --------

/** A row of `GET /api/workspaces` (PRD 007 Req 11). */
interface WorkspaceRow {
  id: string;
  name: string;
  modified: string;
  owners: string[];
  access: boolean;
}

/** The listing row for `id`, as `GET /api/workspaces` reports it to `token`. */
async function listingFor(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<WorkspaceRow | undefined> {
  const res = await request.get(`${HOSTED}/api/workspaces`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  const listed = (await res.json()) as WorkspaceRow[];
  return listed.find((w) => w.id === id);
}

/** Open the workspace switcher's menu (the hosted shell's lifecycle entry point). */
async function openSwitcher(page: Page): Promise<void> {
  await page.getByTestId('workspace-switcher-chip').click();
  await expect(page.getByTestId('workspace-switcher-menu')).toBeVisible();
}

test('E179: POST /api/workspaces takes initial members and everyone-access, validates roles, and keeps the creator Owner', async ({
  request,
}) => {
  // PRD 007 Req 10: the create endpoint's contract. Name-only bodies (the
  // createWorkspace helper above, and every existing caller) keep working.
  const token = await signIn(request, 'ada');
  const headers = { Authorization: `Bearer ${token}` };

  const created = await request.post(`${HOSTED}/api/workspaces`, {
    headers,
    data: {
      name: `E179 shared w${test.info().workerIndex}`,
      // A body that tries to demote the creator cannot: Owner is retained.
      members: [
        { id: 'mock-grace', role: 'Editor' },
        { id: 'mock-ada', role: 'Viewer' },
      ],
      everyone: { enabled: true },
    },
  });
  expect(created.status()).toBe(201);
  const { manifest } = (await created.json()) as {
    manifest: { members: Array<{ id: string; role: string }>; everyone: unknown };
  };
  expect(manifest.members).toEqual([
    { id: 'mock-ada', role: 'Owner' },
    { id: 'mock-grace', role: 'Editor' },
  ]);
  // PRD 007 Req 16: everyone-access with no role named defaults to Viewer.
  expect(manifest.everyone).toEqual({ enabled: true, role: 'Viewer' });

  // An unknown role is a 400 — never a member who silently resolves to nothing.
  const bogus = await request.post(`${HOSTED}/api/workspaces`, {
    headers,
    data: { name: 'E179 bogus', members: [{ id: 'mock-grace', role: 'Superuser' }] },
  });
  expect(bogus.status()).toBe(400);
  expect(((await bogus.json()) as { error: string }).error).toContain('Superuser');
});

test('E180: the workspace list carries owners and an access flag while contents stay 403 for a non-member', async ({
  request,
}) => {
  // PRD 007 Req 11 (+17): list metadata is readable to any signed-in user;
  // file contents and the manifest are not. The flag is what lets the Open
  // dialog tell the two cases apart without attempting a forbidden read.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E180 private w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/secret.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: 'members only',
  });

  const alan = await signIn(request, 'alan');
  const row = await listingFor(request, alan, id);
  expect(row?.owners).toEqual(['mock-ada']);
  expect(row?.access).toBe(false);
  expect(JSON.stringify(row)).not.toContain('members only');
  expect(row).not.toHaveProperty('settings');

  const alanHeaders = { Authorization: `Bearer ${alan}` };
  for (const path of [`/api/workspaces/${id}/manifest`, `/api/workspaces/${id}/files/secret.md`]) {
    const res = await request.get(`${HOSTED}${path}`, { headers: alanHeaders });
    expect(res.status(), path).toBe(403);
  }
  // The owner's own row says access: true.
  expect((await listingFor(request, ada, id))?.access).toBe(true);
});

test('E181: DELETE /api/workspaces/<id> needs workspace.delete and removes every blob under the prefix', async ({
  request,
}) => {
  // PRD 007 Req 12: manifest, files, comment sidecars and pasted images alike.
  const ada = await signIn(request, 'ada');
  const adaHeaders = { Authorization: `Bearer ${ada}` };
  const id = await sharedWorkspace(request, ada, `E181 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Editor' },
  ]);
  for (const rel of ['doc.md', 'doc.md.comments.json', 'images/pic.png']) {
    const put = await request.put(`${HOSTED}/api/workspaces/${id}/files/${rel}`, {
      headers: adaHeaders,
      data: 'x',
    });
    expect(put.status()).toBe(200);
  }

  // An Editor holds file.delete but not workspace.delete: 403 naming the verb.
  const grace = { Authorization: `Bearer ${await signIn(request, 'grace')}` };
  const refused = await request.delete(`${HOSTED}/api/workspaces/${id}`, { headers: grace });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: 'forbidden', required: 'workspace.delete' });
  // An unknown id is a 404, before any permission talk.
  const missing = await request.delete(`${HOSTED}/api/workspaces/no-such-workspace`, { headers: adaHeaders });
  expect(missing.status()).toBe(404);

  const gone = await request.delete(`${HOSTED}/api/workspaces/${id}`, { headers: adaHeaders });
  expect(gone.status()).toBe(200);

  // It no longer lists, and every blob it held is unreachable.
  expect(await listingFor(request, ada, id)).toBeUndefined();
  for (const rel of ['doc.md', 'doc.md.comments.json', 'images/pic.png']) {
    const res = await request.get(`${HOSTED}/api/workspaces/${id}/files/${rel}`, { headers: adaHeaders });
    expect([403, 404], `${rel} after delete`).toContain(res.status());
  }
  const manifestRes = await request.get(`${HOSTED}/api/workspaces/${id}/manifest`, { headers: adaHeaders });
  expect(manifestRes.status()).toBe(404);
});

test('E182: the New Workspace flow names a workspace, grants a member a role, and opens it with the creator as Owner', async ({
  page,
  request,
}) => {
  // PRD 007 Req 10: the create flow end to end in the running hosted app —
  // reachable from the workspace switcher, reusing the #74 membership picker.
  const name = `E182 created w${test.info().workerIndex}`;
  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  await openSwitcher(page);
  await page.getByTestId('workspace-switcher-new').click();
  await expect(page.getByTestId('new-workspace-dialog')).toBeVisible();
  await page.getByTestId('new-workspace-name').fill(name);

  // The reused MembershipPicker searches the live directory endpoints.
  await page.getByTestId('membership-picker-input').fill('hopper');
  await page.getByTestId('membership-picker-result-mock-grace').click();
  await page.getByTestId('new-workspace-role-mock-grace').selectOption('Editor');
  await page.getByTestId('new-workspace-create').click();

  // Creating opens it: the page rebinds to ?workspace=<id> and the sidebar
  // renders the (empty) workspace.
  await expect(page).toHaveURL(/\?workspace=/);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('workspace-switcher-chip')).toHaveText(name);

  const ada = await signIn(request, 'ada');
  const id = new URL(page.url()).searchParams.get('workspace')!;
  const { manifest } = (await (
    await request.get(`${HOSTED}/api/workspaces/${id}/manifest`, { headers: { Authorization: `Bearer ${ada}` } })
  ).json()) as { manifest: { name: string; members: Array<{ id: string; role: string }> } };
  expect(manifest.name).toBe(name);
  expect(manifest.members).toEqual([
    { id: 'mock-ada', role: 'Owner' },
    { id: 'mock-grace', role: 'Editor' },
  ]);
});

test('E183: the Open Workspace dialog lists every workspace, filters as you type, and opens an accessible one', async ({
  page,
  request,
}) => {
  // PRD 007 Req 11: the whole deployment is listable; fuzzy search runs over
  // the fetched list, with no per-keystroke server round trip.
  const w = test.info().workerIndex;
  const ada = await signIn(request, 'ada');
  const mine = `E183 zebra notes w${w}`;
  const other = `E183 quokka plans w${w}`;
  const mineId = await createWorkspace(request, ada, mine);
  await createWorkspace(request, ada, other);

  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openSwitcher(page);
  await page.getByTestId('workspace-switcher-open').click();
  await expect(page.getByTestId('open-workspace-dialog')).toBeVisible();
  await expect(page.getByTestId(`open-workspace-item-${mineId}`)).toBeVisible();
  // Name and last-modified both show on the row.
  await expect(page.getByTestId(`open-workspace-item-${mineId}`)).toContainText(mine);
  await expect(page.getByTestId(`open-workspace-modified-${mineId}`)).not.toBeEmpty();

  // Search-as-you-type narrows the already-fetched list.
  await page.getByTestId('open-workspace-search').fill('quokka');
  await expect(page.getByTestId(`open-workspace-item-${mineId}`)).toHaveCount(0);
  await page.getByTestId('open-workspace-search').fill('zebra');
  await expect(page.getByTestId(`open-workspace-item-${mineId}`)).toBeVisible();

  await page.getByTestId(`open-workspace-item-${mineId}`).click();
  await expect(page).toHaveURL(new RegExp(`\\?workspace=${mineId}`));
  await expect(page.getByTestId('folder-panel')).toBeVisible();
});

test('E184: choosing a workspace the signed-in user cannot access shows a no-access message naming its Owners', async ({
  page,
  request,
}) => {
  // PRD 007 Req 11: the refusal is in-dialog and names who to ask, resolved
  // through the directory — never a forbidden read to discover it.
  const ada = await signIn(request, 'ada');
  const name = `E184 locked w${test.info().workerIndex}`;
  const id = await createWorkspace(request, ada, name);

  await signInTo(page, 'alan');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openSwitcher(page);
  await page.getByTestId('workspace-switcher-open').click();
  await page.getByTestId('open-workspace-search').fill(name);
  await page.getByTestId(`open-workspace-item-${id}`).click();

  await expect(page.getByTestId('open-workspace-no-access')).toContainText('Ada Lovelace');
  await expect(page.getByTestId('open-workspace-no-access')).toContainText(name);
  // Still in the dialog, still no workspace bound.
  await expect(page.getByTestId('open-workspace-dialog')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('workspace')).toBeNull();
});

test('E185: Workspace settings deletes the workspace behind an exact-name gate and returns to the start page', async ({
  page,
  request,
}) => {
  // PRD 007 Req 12: the destructive action, its confirm-name gate, and the
  // server-side removal it performs.
  const ada = await signIn(request, 'ada');
  const name = `E185 doomed w${test.info().workerIndex}`;
  const id = await createWorkspace(request, ada, name);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/note.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# note\n',
  });

  await signInTo(page, 'ada', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await openSettings(page, 'general');
  await page.getByTestId('settings-scope-workspace').click();
  await expect(page.getByTestId('workspace-delete-section')).toBeVisible();

  // Inert until the exact name is typed — a near-miss does not arm it.
  const submit = page.getByTestId('workspace-delete-submit');
  await expect(submit).toBeDisabled();
  await page.getByTestId('workspace-delete-confirm').fill(`${name} `);
  await expect(submit).toBeDisabled();
  await page.getByTestId('workspace-delete-confirm').fill(name);
  await expect(submit).toBeEnabled();
  await submit.click();

  // Back on the start page with no workspace bound…
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('workspace')).toBeNull();
  // …and the workspace is gone server-side, files included.
  expect(await listingFor(request, ada, id)).toBeUndefined();
  const file = await request.get(`${HOSTED}/api/workspaces/${id}/files/note.md`, {
    headers: { Authorization: `Bearer ${ada}` },
  });
  expect([403, 404]).toContain(file.status());
});

test('E186: a member without workspace.delete never sees the delete action', async ({ page, request }) => {
  // PRD 007 Req 12 + Req 17: the control is hidden for non-holders, and the
  // endpoint refuses them regardless (E181).
  const ada = await signIn(request, 'ada');
  const id = await sharedWorkspace(request, ada, `E186 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Editor' },
  ]);

  await signInTo(page, 'grace', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await openSettings(page, 'general');
  await page.getByTestId('settings-scope-workspace').click();
  await expect(page.getByTestId('settings-scope-content-workspace')).toBeVisible();
  await expect(page.getByTestId('workspace-delete-section')).toHaveCount(0);
});

// --- issue #76: folder management, single-file transfer, ETag concurrency ---

/** A workspace where `username` holds exactly `permissions` (a custom role). */
async function workspaceWithRole(
  request: APIRequestContext,
  ownerToken: string,
  name: string,
  username: string,
  permissions: string[],
): Promise<string> {
  const headers = { Authorization: `Bearer ${ownerToken}` };
  const id = await createWorkspace(request, ownerToken, name);
  const { manifest } = (await (
    await request.get(`${HOSTED}/api/workspaces/${id}/manifest`, { headers })
  ).json()) as {
    manifest: { members: Array<{ id: string; role: string }>; roles: Array<unknown> };
  };
  manifest.roles.push({ name: 'Limited', permissions });
  manifest.members.push({ id: `mock-${username}`, role: 'Limited' });
  expect((await request.put(`${HOSTED}/api/workspaces/${id}/manifest`, { headers, data: manifest })).status()).toBe(200);
  return id;
}

/** Right-click the sidebar's empty area and pick a root-menu item. */
async function rootMenu(page: Page, item: string): Promise<void> {
  await page.locator('.folder-list').click({ button: 'right', position: { x: 40, y: 140 } });
  await page.getByTestId(`folder-menu-${item}`).click();
}

/** Right-click a named row and pick an item from its menu. */
async function rowMenu(page: Page, name: string, item: string): Promise<void> {
  await page.getByTestId('folder-item').filter({ hasText: name }).first().click({ button: 'right' });
  await page.getByTestId(`folder-menu-${item}`).click();
}

/** Type into the in-place rename input and commit. */
async function christen(page: Page, name: string): Promise<void> {
  const input = page.getByTestId('folder-rename-input');
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press('Enter');
}

/** Drag one sidebar row onto another (HTML5 drag-and-drop, one DataTransfer). */
async function dragRowOnto(page: Page, source: string, target: string): Promise<void> {
  const dt = await page.evaluateHandle(() => new DataTransfer());
  const from = page.getByTestId('folder-item').filter({ hasText: source }).first();
  const onto = page.getByTestId('folder-item').filter({ hasText: target }).first();
  await from.dispatchEvent('dragstart', { dataTransfer: dt });
  await onto.dispatchEvent('dragover', { dataTransfer: dt });
  await onto.dispatchEvent('drop', { dataTransfer: dt });
}

/** The workspace's file paths, straight from the API. */
async function listFiles(request: APIRequestContext, token: string, id: string): Promise<string[]> {
  const res = await request.get(`${HOSTED}/api/workspaces/${id}/files`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await res.json()) as { path: string }[]).map((f) => f.path);
}

test('E187: the hosted sidebar creates a file and an EMPTY folder, and both survive a reload', async ({
  page,
  request,
}) => {
  // PRD 007 Req 18: blob storage has no directories, so an empty folder only
  // exists if the implementation makes it exist — this test is what proves
  // the placeholder blob does that, and that it is never a visible row.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E187 w${test.info().workerIndex}`);
  await signInTo(page, 'ada', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  await rootMenu(page, 'new-folder');
  await christen(page, 'ideas');
  await expect(page.getByTestId('folder-item').filter({ hasText: 'ideas' })).toHaveCount(1);

  await rootMenu(page, 'new-file');
  await christen(page, 'notes.md');
  await expect(page.getByTestId('docname')).toContainText('notes.md');

  // Both are still there in a brand-new page load…
  await page.reload();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('folder-item').filter({ hasText: 'ideas' })).toHaveCount(1);
  await expect(page.getByTestId('folder-item').filter({ hasText: 'notes.md' })).toHaveCount(1);
  // …the empty folder IS a marker blob, and the marker is never a row.
  expect(await listFiles(request, ada, id)).toEqual(
    expect.arrayContaining(['ideas/.mmkeep', 'notes.md']),
  );
  await expect(page.getByTestId('folder-item').filter({ hasText: '.mmkeep' })).toHaveCount(0);
});

test('E188: renaming, then moving — by context menu and by drag-and-drop — with the change surviving a reload', async ({
  page,
  request,
}) => {
  // PRD 007 Req 18: the same rename seam serves both gestures, and a moved
  // FOLDER takes its contents with it.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E188 w${test.info().workerIndex}`);
  const headers = { Authorization: `Bearer ${ada}` };
  await request.put(`${HOSTED}/api/workspaces/${id}/files/draft.md`, { headers, data: '# draft\n' });
  await request.put(`${HOSTED}/api/workspaces/${id}/files/sub/deep.md`, { headers, data: '# deep\n' });
  await request.post(`${HOSTED}/api/workspaces/${id}/folders`, { headers, data: { path: 'archive' } });

  await signInTo(page, 'ada', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  // Rename through the context menu.
  await rowMenu(page, 'draft.md', 'rename');
  await christen(page, 'final.md');
  await expect(page.getByTestId('folder-item').filter({ hasText: 'final.md' })).toHaveCount(1);

  // Move a FILE onto a folder row by dragging it there.
  await dragRowOnto(page, 'final.md', 'archive');
  await expect
    .poll(() => listFiles(request, ada, id))
    .toEqual(expect.arrayContaining(['archive/final.md']));

  // Move a FOLDER (with contents) by dragging it onto another folder.
  await dragRowOnto(page, 'sub', 'archive');
  await expect
    .poll(() => listFiles(request, ada, id))
    .toEqual(expect.arrayContaining(['archive/sub/deep.md']));

  // The tree shows the new shape after a reload, and the old paths are gone.
  await page.reload();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.getByTestId('folder-item').filter({ hasText: 'archive' }).first().click();
  await expect(page.getByTestId('folder-item').filter({ hasText: 'final.md' })).toHaveCount(1);
  const paths = await listFiles(request, ada, id);
  expect(paths).not.toContain('draft.md');
  expect(paths).not.toContain('sub/deep.md');
});

test('E189: an upload lands and reads back; oversize and disallowed uploads are refused by the UI and the server alike', async ({
  page,
  request,
}) => {
  // PRD 007 Req 19: three entry points, one rule — enforced client-side with
  // a message naming what failed, and independently server-side.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E189 w${test.info().workerIndex}`);
  const headers = { Authorization: `Bearer ${ada}` };
  await signInTo(page, 'ada', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  // (1) The folder context menu's Upload File… — the real file chooser.
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.folder-list').click({ button: 'right', position: { x: 40, y: 140 } });
  await page.getByTestId('folder-menu-upload').click();
  await (await chooser).setFiles({
    name: 'uploaded.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# uploaded\n\nfrom the picker\n'),
  });
  await expect(page.getByTestId('folder-item').filter({ hasText: 'uploaded.md' })).toHaveCount(1);
  // It reads back byte-identical and opens in the editor.
  const read = await request.get(`${HOSTED}/api/workspaces/${id}/files/uploaded.md`, { headers });
  expect(((await read.json()) as { content: string }).content).toBe('# uploaded\n\nfrom the picker\n');
  await openFromSidebar(page, 'uploaded.md');

  // (2) Dropping an OS file onto the sidebar uploads it too.
  const drop = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['# dropped\n'], 'dropped.md', { type: 'text/markdown' }));
    return dt;
  });
  await page.locator('.folder-list').dispatchEvent('drop', { dataTransfer: drop });
  await expect(page.getByTestId('folder-item').filter({ hasText: 'dropped.md' })).toHaveCount(1);

  // (3) A disallowed type is refused with a message naming the extension, and
  // NOTHING is written.
  const badChooser = page.waitForEvent('filechooser');
  await page.locator('.folder-list').click({ button: 'right', position: { x: 40, y: 140 } });
  await page.getByTestId('folder-menu-upload').click();
  await (await badChooser).setFiles({
    name: 'payload.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('MZ'),
  });
  await expect(page.getByTestId('folder-notice')).toContainText('.exe');
  expect(await listFiles(request, ada, id)).not.toContain('payload.exe');
  await page.getByTestId('folder-notice-dismiss').click();
  await expect(page.getByTestId('folder-notice')).toHaveCount(0);

  // …and a hand-rolled request bypassing the UI gets the same answers from
  // the server: 415 for the type, 413 for the size, both naming the reason.
  const type415 = await request.put(`${HOSTED}/api/workspaces/${id}/upload/payload.exe`, {
    headers,
    data: 'MZ',
  });
  expect(type415.status()).toBe(415);
  expect(((await type415.json()) as { error: string }).error).toMatch(/\.exe/);
  const size413 = await request.put(`${HOSTED}/api/workspaces/${id}/upload/huge.md`, {
    headers,
    data: 'x'.repeat(20 * 1024 * 1024 + 1),
  });
  expect(size413.status()).toBe(413);
  expect(((await size413.json()) as { error: string }).error).toMatch(/20 MB/);
  expect(await listFiles(request, ada, id)).not.toContain('huge.md');
});

test('E190: downloading a file from the sidebar delivers the workspace blob’s own bytes', async ({
  page,
  request,
}) => {
  // PRD 007 Req 19: the download is the blob, under the file's own basename.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E190 w${test.info().workerIndex}`);
  const body = '# downloadable\n\nexact bytes — ✓ 私\n';
  await request.put(`${HOSTED}/api/workspaces/${id}/files/report.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: body,
  });
  await signInTo(page, 'ada', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  const download = page.waitForEvent('download');
  await rowMenu(page, 'report.md', 'download');
  const file = await download;
  expect(file.suggestedFilename()).toBe('report.md');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString('utf8')).toBe(body);
});

test('E191: a member without file.upload/file.download/file.rename sees no affordance — and the API refuses them anyway', async ({
  page,
  request,
}) => {
  // PRD 007 Req 17: the UI hides what the user cannot do, and the server
  // refuses it regardless of what any UI showed.
  const ada = await signIn(request, 'ada');
  const id = await workspaceWithRole(request, ada, `E191 w${test.info().workerIndex}`, 'grace', ['doc.read']);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/readonly.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# read only\n',
  });

  await signInTo(page, 'grace', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  // The file row's menu offers nothing but Copy Path — no rename, no delete,
  // no download; the empty-area menu offers no creation or upload at all.
  await page.getByTestId('folder-item').filter({ hasText: 'readonly.md' }).first().click({ button: 'right' });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  for (const item of ['rename', 'delete', 'download', 'upload']) {
    await expect(page.getByTestId(`folder-menu-${item}`)).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await page.locator('.folder-list').click({ button: 'right', position: { x: 40, y: 140 } });
  for (const item of ['new-file', 'new-folder', 'upload']) {
    await expect(page.getByTestId(`folder-menu-${item}`)).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  // No hidden upload input is even mounted.
  await expect(page.getByTestId('upload-input')).toHaveCount(0);

  // The endpoints answer 403 to the same user, naming the verb each needs.
  const grace = await signIn(request, 'grace');
  const headers = { Authorization: `Bearer ${grace}` };
  const cases: Array<[Promise<import('@playwright/test').APIResponse>, string]> = [
    [request.put(`${HOSTED}/api/workspaces/${id}/upload/x.md`, { headers, data: '# x' }), 'file.upload'],
    [request.get(`${HOSTED}/api/workspaces/${id}/download/readonly.md`, { headers }), 'file.download'],
    [
      request.post(`${HOSTED}/api/workspaces/${id}/move-file`, {
        headers,
        data: { from: 'readonly.md', to: 'moved.md' },
      }),
      'file.rename',
    ],
    [
      request.post(`${HOSTED}/api/workspaces/${id}/folders`, { headers, data: { path: 'nope' } }),
      'folder.manage',
    ],
  ];
  for (const [pending, required] of cases) {
    const res = await pending;
    expect(res.status(), required).toBe(403);
    expect(((await res.json()) as { required: string }).required).toBe(required);
  }
  // …and nothing of theirs landed.
  expect(await listFiles(request, ada, id)).toEqual(['readonly.md']);
});

test('E192: a save against a file another member has written is refused — Reload takes theirs, Overwrite takes yours', async ({
  page,
  request,
}) => {
  // PRD 007 Req 20: no save silently loses another member's write.
  const ada = await signIn(request, 'ada');
  const grace = await signIn(request, 'grace');
  const id = await sharedWorkspace(request, ada, `E192 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Editor' },
  ]);
  const file = `${HOSTED}/api/workspaces/${id}/files/shared.md`;
  const adaHeaders = { Authorization: `Bearer ${ada}` };
  const graceHeaders = { Authorization: `Bearer ${grace}` };
  await request.put(file, { headers: adaHeaders, data: '# shared\n\noriginal line\n' });

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'shared.md');
  await page.keyboard.press('Control+e'); // into edit mode
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('ada was typing\n');

  // Grace saves first, from another session entirely.
  expect((await request.put(file, { headers: graceHeaders, data: '# shared\n\ngrace got here first\n' })).status()).toBe(200);

  // Ada's save is refused; the prompt offers two real choices.
  await menuSave(page);
  await expect(page.getByTestId('save-conflict-prompt')).toBeVisible();
  // Cancelling leaves the buffer dirty and the server holding Grace's text.
  await page.getByTestId('save-conflict-cancel').click();
  await expect(page.getByTestId('save-conflict-prompt')).toHaveCount(0);
  expect(((await (await request.get(file, { headers: adaHeaders })).json()) as { content: string }).content).toBe(
    '# shared\n\ngrace got here first\n',
  );

  // Reload brings Grace's newer version into the editor.
  await menuSave(page);
  await expect(page.getByTestId('save-conflict-prompt')).toBeVisible();
  await page.getByTestId('save-conflict-reload').click();
  await expect(page.getByTestId('save-conflict-prompt')).toHaveCount(0);
  const surface = page.locator('[data-testid="editor"], [data-testid="doc"]').first();
  await expect(surface).toContainText('grace got here first');
  await expect(surface).not.toContainText('ada was typing');

  // The Overwrite branch: Grace writes again, Ada edits and overwrites — and
  // Ada's content is what the server keeps, with the next save re-armed.
  await request.put(file, { headers: graceHeaders, data: '# shared\n\ngrace again\n' });
  if ((await page.getByTestId('editor').count()) === 0) await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('ada overwrites\n');
  await menuSave(page);
  await expect(page.getByTestId('save-conflict-prompt')).toBeVisible();
  await page.getByTestId('save-conflict-overwrite').click();
  await expect(page.getByTestId('save-conflict-prompt')).toHaveCount(0);
  await expect
    .poll(async () => ((await (await request.get(file, { headers: adaHeaders })).json()) as { content: string }).content)
    .toContain('ada overwrites');
});

// --- Workspace settings: membership and custom roles (PRD 007 Req 15+16) -----

/** Open Workspace settings for the bound workspace and wait for its content. */
async function openWorkspaceSettings(page: Page): Promise<void> {
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await openSettings(page, 'general');
  await page.getByTestId('settings-scope-workspace').click();
  await expect(page.getByTestId('settings-scope-content-workspace')).toBeVisible();
}

/** Write a file as `token` and report the status — what a role actually allows. */
async function writeAs(
  request: APIRequestContext,
  token: string,
  id: string,
  path: string,
): Promise<number> {
  const res = await request.put(`${HOSTED}/api/workspaces/${id}/files/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: '# written\n',
  });
  return res.status();
}

test('E193: an Owner adds a member through the settings picker, and that member can then open the workspace', async ({
  page,
  request,
}) => {
  // PRD 007 Req 16: the people section mounts the existing membership picker
  // against the live directory; the grant is server-side, so a second session
  // as the added user gets in.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E193 w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/note.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# note\n',
  });
  // Grace is not a member yet — the API says so before any UI runs.
  const grace = await signIn(request, 'grace');
  expect((await listingFor(request, grace, id))?.access).toBe(false);

  await signInTo(page, 'ada', id);
  await openWorkspaceSettings(page);
  await expect(page.getByTestId('workspace-members-section')).toBeVisible();
  await page.getByTestId('membership-picker-input').fill('hopper');
  await page.getByTestId('membership-picker-result-mock-grace').click();
  // She lands in the list with the least-privileged default role.
  await expect(page.getByTestId('workspace-member-role-mock-grace')).toHaveValue('Viewer');

  expect((await listingFor(request, grace, id))?.access).toBe(true);
  await signOut(page);
  await signInTo(page, 'grace', id);
  await openFromSidebar(page, 'note');
});

test('E194: changing a member’s role through the settings control changes what that member can do', async ({
  page,
  request,
}) => {
  // PRD 007 Req 16: the role select offers the built-ins and the workspace's
  // own custom roles, and the change is enforced server-side immediately.
  const ada = await signIn(request, 'ada');
  const grace = await signIn(request, 'grace');
  const id = await sharedWorkspace(request, ada, `E194 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Viewer' },
  ]);
  expect(await writeAs(request, grace, id, 'graces.md')).toBe(403);

  await signInTo(page, 'ada', id);
  await openWorkspaceSettings(page);
  await page.getByTestId('workspace-member-role-mock-grace').selectOption('Editor');
  await expect(page.getByTestId('workspace-member-role-mock-grace')).toHaveValue('Editor');

  expect(await writeAs(request, grace, id, 'graces.md')).toBe(200);

  // Removing her through the picker's × revokes it again.
  await page.getByTestId('membership-picker-remove-mock-grace').click();
  await expect(page.getByTestId('workspace-member-role-mock-grace')).toHaveCount(0);
  expect(await writeAs(request, grace, id, 'graces.md')).toBe(403);
});

test('E195: the last Owner cannot be demoted or removed — the refusal is visible and the server agrees', async ({
  page,
  request,
}) => {
  // PRD 007 Req 16: the invariant is the server's; the UI shows its message
  // rather than pretending a disabled control is the enforcement.
  const ada = await signIn(request, 'ada');
  const id = await sharedWorkspace(request, ada, `E195 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Editor' },
  ]);

  await signInTo(page, 'ada', id);
  await openWorkspaceSettings(page);
  await page.getByTestId('workspace-member-role-mock-ada').selectOption('Viewer');
  await expect(page.getByTestId('workspace-members-error')).toContainText('at least one Owner');
  // She is still the Owner: the refused change never landed.
  await expect(page.getByTestId('workspace-member-role-mock-ada')).toHaveValue('Owner');

  // The endpoint refuses the same act directly — 400, not merely disabled UI.
  const removed = await request.delete(`${HOSTED}/api/workspaces/${id}/members/mock-ada`, {
    headers: { Authorization: `Bearer ${ada}` },
  });
  expect(removed.status()).toBe(400);
  expect(((await removed.json()) as { error: string }).error).toContain('at least one Owner');
});

test('E196: everyone-access grants its default role to non-members while an explicit member keeps their own', async ({
  page,
  request,
}) => {
  // PRD 007 Req 16: the toggle plus its Owner-chosen role, and the override
  // rule — an explicit Viewer does NOT get promoted by an Editor everyone-role.
  const ada = await signIn(request, 'ada');
  const grace = await signIn(request, 'grace');
  const alan = await signIn(request, 'alan');
  const id = await sharedWorkspace(request, ada, `E196 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Viewer' },
  ]);
  expect((await listingFor(request, alan, id))?.access).toBe(false);

  await signInTo(page, 'ada', id);
  await openWorkspaceSettings(page);
  // The toggle is driven by the stored manifest, so it settles once the
  // server has answered — it starts at the Viewer default it was created with.
  await page.getByTestId('workspace-everyone-enabled').click();
  await expect(page.getByTestId('workspace-everyone-enabled')).toBeChecked();
  await expect(page.getByTestId('workspace-everyone-role')).toHaveValue('Viewer');
  await page.getByTestId('workspace-everyone-role').selectOption('Editor');
  await expect(page.getByTestId('workspace-everyone-role')).toHaveValue('Editor');

  // Alan, a non-member, is in as an Editor…
  expect(await writeAs(request, alan, id, 'alans.md')).toBe(200);
  // …while Grace's explicit Viewer role still overrides the everyone-role.
  expect(await writeAs(request, grace, id, 'graces.md')).toBe(403);

  await page.getByTestId('workspace-everyone-enabled').click();
  await expect(page.getByTestId('workspace-everyone-enabled')).not.toBeChecked();
  await expect(page.getByTestId('workspace-everyone-role')).toHaveCount(0);
  expect(await writeAs(request, alan, id, 'alans.md')).toBe(403);
});

test('E197: a custom role created in the roles editor is grantable to a member and cannot be deleted while held', async ({
  page,
  request,
}) => {
  // PRD 007 Req 15: create a named catalog subset, grant it, and watch the
  // in-use refusal name the role rather than the delete silently doing nothing.
  const ada = await signIn(request, 'ada');
  const grace = await signIn(request, 'grace');
  const role = `Reviewer${test.info().workerIndex}`;
  const id = await sharedWorkspace(request, ada, `E197 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Viewer' },
  ]);

  await signInTo(page, 'ada', id);
  await openWorkspaceSettings(page);
  await expect(page.getByTestId('workspace-roles-section')).toBeVisible();
  // Built-ins are listed, but as fixed rows with no edit or delete control.
  await expect(page.getByTestId('workspace-builtin-role-Owner')).toBeVisible();
  await expect(page.getByTestId('workspace-role-edit-Owner')).toHaveCount(0);

  await page.getByTestId('workspace-role-name').fill(role);
  for (const permission of ['doc.read', 'doc.edit', 'comment.read']) {
    await page.getByTestId(`workspace-role-permission-${permission}`).check();
  }
  await page.getByTestId('workspace-role-save').click();
  await expect(page.getByTestId(`workspace-role-${role}`)).toContainText('3 permissions');

  // A built-in name is refused with the server's own message.
  await page.getByTestId('workspace-role-name').fill('Owner');
  await page.getByTestId('workspace-role-save').click();
  await expect(page.getByTestId('workspace-roles-error')).toContainText('built-in');

  // The fresh role is grantable straight away, and it really grants doc.edit.
  await page.getByTestId('workspace-member-role-mock-grace').selectOption(role);
  await expect(page.getByTestId('workspace-member-role-mock-grace')).toHaveValue(role);
  expect(await writeAs(request, grace, id, 'graces.md')).toBe(200);

  // Held: the delete is refused, naming the role, and it stays in the list.
  await page.getByTestId(`workspace-role-delete-${role}`).click();
  await expect(page.getByTestId('workspace-roles-error')).toContainText(role);
  await expect(page.getByTestId('workspace-roles-error')).toContainText('in use');
  await expect(page.getByTestId(`workspace-role-${role}`)).toBeVisible();

  // Free it and the same delete goes through.
  await page.getByTestId('workspace-member-role-mock-grace').selectOption('Viewer');
  await page.getByTestId(`workspace-role-delete-${role}`).click();
  await expect(page.getByTestId(`workspace-role-${role}`)).toHaveCount(0);
});

test('E198: a member without workspace.members or workspace.roles sees neither settings section', async ({
  page,
  request,
}) => {
  // PRD 007 Req 17: the sections are gated on the resolved permissions, the
  // same way the delete action is (E186) — and the endpoints refuse anyway.
  const ada = await signIn(request, 'ada');
  const grace = await signIn(request, 'grace');
  const id = await sharedWorkspace(request, ada, `E198 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Editor' },
  ]);

  await signInTo(page, 'grace', id);
  await openWorkspaceSettings(page);
  await expect(page.getByTestId('workspace-members-section')).toHaveCount(0);
  await expect(page.getByTestId('workspace-roles-section')).toHaveCount(0);

  // Each endpoint answers 403 naming its one verb, not 404 or a silent no-op.
  const headers = { Authorization: `Bearer ${grace}` };
  const forbidden: Array<[Promise<APIResponse>, string]> = [
    [request.post(`${HOSTED}/api/workspaces/${id}/members`, { headers, data: { id: 'mock-alan', role: 'Viewer' } }), 'workspace.members'],
    [request.put(`${HOSTED}/api/workspaces/${id}/everyone`, { headers, data: { enabled: true } }), 'workspace.members'],
    [request.post(`${HOSTED}/api/workspaces/${id}/roles`, { headers, data: { name: 'Sneaky', permissions: [] } }), 'workspace.roles'],
  ];
  for (const [pending, required] of forbidden) {
    const res = await pending;
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { required: string }).required).toBe(required);
  }
});
