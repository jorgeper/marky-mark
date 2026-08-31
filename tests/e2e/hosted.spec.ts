import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
// PRD 017 Req 6: the deployment-settings blob sits under the reserved
// deployment/ prefix the API itself refuses (E363), so the policy tests
// write it the way an operator's storage tooling would — straight to
// Azurite through the same well-known dev account the local server reads.
import { BlobServiceClient } from '@azure/storage-blob';
import { AZURITE_CONNECTION_STRING } from '../../server/config';
// PRD 017 Req 33 (issue #190): the invited-guest id comes from the module
// that owns the rule, so a renamed scheme fails here loudly.
import { mockInvitationId } from '../../server/providers/mock/directory';
import {
  CREATE_REFUSAL_HINTS,
  DEPLOYMENT_SETTINGS_BLOB,
  serializeDeploymentSettings,
  type DeploymentSettings,
} from '../../src/lib/deploymentSettings';
// PRD 017 Req 16: the byte figures the Management table renders come from
// the module that owns the format, so a rephrased size fails here loudly.
import { formatByteSize } from '../../src/lib/deploymentAdmin';
import { expect, test } from './fixtures';
import { addComment, landInPreview, menuSave, openSettings, pasteImage, revealToolbar, selectPhrase } from './helpers';
// PRD 011 Req 9 (#121): the sentence under test comes from the module that
// owns it, so a reworded message fails E246 rather than passing a stale copy.
import { NO_LLM_CONFIGURED_MESSAGE } from '../../src/lib/llmDeployment';
// Issue #179: E325 poisons the store with a real draft payload, built by the
// module that owns the format so a schema change fails the test loudly.
import { serializeDraft } from '../../src/lib/drafts';

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
  // PRD 017 Req 3: beside the bare user, /api/me reports admin status and
  // the creation-policy verdict — ada is no admin, and under the default
  // (absent) settings anyone may create, so no createRefusal rides along.
  expect(await me.json()).toEqual({
    id: 'mock-ada',
    username: 'ada',
    displayName: 'Ada Lovelace',
    admin: false,
    canCreateWorkspaces: true,
  });
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

test('E328: creating a workspace yields a manifest blob under its own prefix with the creator as Owner', async ({
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
  // Issue #180: the manifest snapshots the display name known at add time.
  expect(manifest.members).toEqual([{ id: 'mock-ada', role: 'Owner', displayName: 'Ada Lovelace' }]);
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

test('E329: a member granted Viewer can read workspace files but gets 403 writing — the verb is named', async ({
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

test('E330: a non-member of a workspace without everyone-access gets 403 reading file content', async ({
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
  // Issue #179: discard any crash-safe draft (SPEC30 §3's draft.json, written
  // to the user's roaming config blob) that a test killed mid-edit left
  // behind — otherwise the app boots into the "Restore unsaved changes?"
  // overlay, every click under it is intercepted, and one kill cascades
  // through the rest of the suite. Every UI test starts draft-free.
  const token = await signIn(page.request, username);
  const dropped = await page.request.delete(`${HOSTED}/api/me/files/draft.json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([200, 404]).toContain(dropped.status());
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
  await landInPreview(page);
}

const PHRASE = 'anchored in the shared document';
const SHARED_DOC = `# Shared\n\nA line ${PHRASE} for both members to see.\n`;

test('E331: a comment one member writes is a workspace blob the next member reads back', async ({
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

test('E332: a pasted image is a workspace blob that renders for a second member', async ({ page, request }) => {
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

test('E333: the User settings layer roams per user while the Workspace layer comes from the manifest', async ({
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

/**
 * Open the in-app menu — PRD 009 Req 7/8/11: the hamburger on the left is the
 * hosted shell's lifecycle entry point now that the switcher chip is gone.
 */
async function openAppMenu(page: Page): Promise<void> {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await expect(page.getByTestId('app-menu')).toBeVisible();
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
    { id: 'mock-ada', role: 'Owner', displayName: 'Ada Lovelace' },
    { id: 'mock-grace', role: 'Editor', displayName: 'Grace Hopper' },
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
  // reachable from the in-app menu (PRD 009 Req 11 retired the switcher
  // chip), reusing the #74 membership picker.
  const name = `E182 created w${test.info().workerIndex}`;
  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  await openAppMenu(page);
  await page.getByTestId('menu-new-workspace').click();
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
  // PRD 009 Req 11: the workspace's name shows in the toolbar's document
  // affordance — the chip that used to carry it is gone.
  await expect(page.getByTestId('docname-workspace')).toHaveText(name);

  const ada = await signIn(request, 'ada');
  const id = new URL(page.url()).searchParams.get('workspace')!;
  const { manifest } = (await (
    await request.get(`${HOSTED}/api/workspaces/${id}/manifest`, { headers: { Authorization: `Bearer ${ada}` } })
  ).json()) as { manifest: { name: string; members: Array<{ id: string; role: string }> } };
  expect(manifest.name).toBe(name);
  expect(manifest.members).toEqual([
    { id: 'mock-ada', role: 'Owner', displayName: 'Ada Lovelace' },
    { id: 'mock-grace', role: 'Editor', displayName: 'Grace Hopper' },
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
  await openAppMenu(page);
  await page.getByTestId('menu-open-workspace').click();
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
  await openAppMenu(page);
  await page.getByTestId('menu-open-workspace').click();
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
  // Issue #183 §1: the danger zone now lives at the foot of the People tab.
  await openSettings(page, 'people');
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
  // Issue #183 §1: without workspace.delete (or members/roles) there is no
  // People tab at all — and no delete section anywhere else either.
  await page.getByTestId('settings-scope-workspace').click();
  await expect(page.getByTestId('settings-scope-content-workspace')).toBeVisible();
  await expect(page.getByTestId('settings-tab-people')).toHaveCount(0);
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
  // PRD 007 Req 20: no save silently loses another member's write. PRD 016
  // Req 8: a stale save whose edits do NOT overlap the other member's now
  // merges instead (U792/U796 cover that on this backend), so both writers
  // here edit the SAME line — the conflict prompt is for real conflicts.
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

  // Grace saves first, from another session entirely — rewriting the very
  // heading line Ada is typing into.
  const graceDoc = '# shared, grace got here first\n\noriginal line\n';
  expect((await request.put(file, { headers: graceHeaders, data: graceDoc })).status()).toBe(200);

  // Ada's save is refused; the prompt offers two real choices.
  await menuSave(page);
  await expect(page.getByTestId('save-conflict-prompt')).toBeVisible();
  // Cancelling leaves the buffer dirty and the server holding Grace's text.
  await page.getByTestId('save-conflict-cancel').click();
  await expect(page.getByTestId('save-conflict-prompt')).toHaveCount(0);
  expect(((await (await request.get(file, { headers: adaHeaders })).json()) as { content: string }).content).toBe(
    graceDoc,
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

/** Append `text` to the open document's FIRST line, in edit mode. */
async function editFirstLine(page: Page, text: string): Promise<void> {
  if ((await page.getByTestId('editor').count()) === 0) await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
}

/** The stored text of a workspace file, as the API reports it. */
async function storedText(request: APIRequestContext, token: string, id: string, path: string): Promise<string> {
  const res = await request.get(`${HOSTED}/api/workspaces/${id}/files/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { content: string }).content;
}

const MERGE_BASE_DOC = '# Shared\n\nline one\nline two\nline three\n';

test('E224: a concurrent save that does not overlap is merged — merged notice, merged text, clean buffer', async ({
  page,
  request,
}) => {
  // PRD 016 Req 8+9: the stale conditional save carries the base the client
  // loaded, so it gets one chance to become a merge before it becomes a 412 —
  // and the merged bytes are what the editor then holds: saved, no dialog.
  const worker = test.info().workerIndex;
  const katherine = await signIn(request, 'katherine');
  const ada = await signIn(request, 'ada');
  const id = await sharedWorkspace(request, katherine, `E224 w${worker}`, [{ id: 'mock-ada', role: 'Editor' }]);
  const file = `${HOSTED}/api/workspaces/${id}/files/shared.md`;
  expect(
    (await request.put(file, { headers: { Authorization: `Bearer ${katherine}` }, data: MERGE_BASE_DOC })).status(),
  ).toBe(200);

  await signInTo(page, 'katherine', id);
  await openFromSidebar(page, 'shared.md');
  await editFirstLine(page, ' — katherine edited the heading');

  // The other member saves to the SAME file, at the other end of the
  // document — a second writer this session knows nothing about.
  expect(
    (
      await request.put(file, {
        headers: { Authorization: `Bearer ${ada}` },
        data: `${MERGE_BASE_DOC}ada appended a line\n`,
      })
    ).status(),
  ).toBe(200);

  // Katherine's save is stale, merges, and says so without asking anything.
  await menuSave(page);
  await expect(page.getByTestId('notice')).toContainText('merged');
  await expect(page.getByTestId('save-conflict-prompt')).toHaveCount(0);
  const surface = page.locator('[data-testid="editor"], [data-testid="doc"]').first();
  await expect(surface).toContainText('katherine edited the heading');
  await expect(surface).toContainText('ada appended a line');
  // The buffer is SAVED at the merged bytes — not dirty, not re-armed.
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  const stored = await storedText(request, katherine, id, 'shared.md');
  expect(stored).toContain('katherine edited the heading');
  expect(stored).toContain('ada appended a line');
});

test('E225: a concurrent save that overlaps still fails 412 and shows the unchanged conflict prompt', async ({
  page,
  request,
}) => {
  // PRD 016 Req 8: a merge is offered only where the changes do not collide.
  // An overlapping one keeps PRD 007 Req 20's behaviour byte for byte — the
  // save-conflict prompt with its three answers.
  const worker = test.info().workerIndex;
  const ada = await signIn(request, 'ada');
  const grace = await signIn(request, 'grace');
  const id = await sharedWorkspace(request, ada, `E225 w${worker}`, [{ id: 'mock-grace', role: 'Editor' }]);
  const file = `${HOSTED}/api/workspaces/${id}/files/shared.md`;
  expect(
    (await request.put(file, { headers: { Authorization: `Bearer ${ada}` }, data: MERGE_BASE_DOC })).status(),
  ).toBe(200);

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'shared.md');
  await editFirstLine(page, ' — ada rewrote the heading');

  // Grace changes the very line Ada is editing.
  const graceDoc = MERGE_BASE_DOC.replace('# Shared', '# Shared, by grace');
  expect(
    (await request.put(file, { headers: { Authorization: `Bearer ${grace}` }, data: graceDoc })).status(),
  ).toBe(200);

  await menuSave(page);
  await expect(page.getByTestId('save-conflict-prompt')).toBeVisible();
  for (const choice of ['save-conflict-cancel', 'save-conflict-overwrite', 'save-conflict-reload']) {
    await expect(page.getByTestId(choice)).toBeVisible();
  }
  await expect(page.getByTestId('notice')).toHaveCount(0);

  // Cancel leaves the buffer dirty and the server holding Grace's text.
  await page.getByTestId('save-conflict-cancel').click();
  await expect(page.getByTestId('save-conflict-prompt')).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  expect(await storedText(request, ada, id, 'shared.md')).toBe(graceDoc);
});

// --- Workspace settings: membership and custom roles (PRD 007 Req 15+16) -----

/** Issue #183 §1: open the People tab of Settings for the bound workspace. */
async function openWorkspaceSettings(page: Page): Promise<void> {
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  // The tab button appears once the panel has the manifest + permissions;
  // the click auto-waits for it.
  await openSettings(page, 'people');
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
  // PRD 007 Req 13 (#79): doc.edit is the SAVE verb — a PUT of a path that
  // holds nothing yet is a create and wants file.create — so the proof below
  // writes over a file the Owner has already put there.
  await request.put(`${HOSTED}/api/workspaces/${id}/files/graces.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# the Owner’s\n',
  });

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

  // The fresh role is grantable straight away, and it really grants doc.edit:
  // the member can now save over the Owner's file.
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
  // Issue #183 §1: for a member with neither verb the People tab itself is
  // absent — no permission-denied placeholder — so open General and look.
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await openSettings(page, 'general');
  await page.getByTestId('settings-scope-workspace').click();
  await expect(page.getByTestId('settings-scope-content-workspace')).toBeVisible();
  await expect(page.getByTestId('settings-tab-people')).toHaveCount(0);
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

// Renumbered from E360 (issue #189): the parallel issue-#188 merge already
// used E360–E362, and test IDs are unique — the newer tests took the next
// unused numbers.
test('E364: People is its own settings tab, immediately after Editor, holding members, roles and the danger zone — and absent without a workspace', async ({
  page,
  request,
}) => {
  // Issue #183 §1: a real destination in the tab rail, not sections appended
  // to the General tab's Workspace scope.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E364 w${test.info().workerIndex}`);

  await signInTo(page, 'ada', id);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await openSettings(page, 'general');
  await expect(page.getByTestId('settings-tab-people')).toBeVisible();
  await expect(page.getByTestId('settings-tabs').locator('button')).toHaveText([
    'General',
    'Appearance',
    'Editor',
    'People',
    'Hotkeys',
    'LLM providers',
    'Experimental',
  ]);
  // The sections are no longer appended to the General tab — in either scope.
  await expect(page.getByTestId('workspace-members-section')).toHaveCount(0);
  await expect(page.getByTestId('workspace-delete-section')).toHaveCount(0);
  await page.getByTestId('settings-scope-workspace').click();
  await expect(page.getByTestId('settings-scope-content-workspace')).toBeVisible();
  await expect(page.getByTestId('workspace-members-section')).toHaveCount(0);
  await expect(page.getByTestId('workspace-delete-section')).toHaveCount(0);
  // People is workspace-tied, not layer-tied: it opens from Workspace scope
  // too, and one tab holds all three sections.
  await page.getByTestId('settings-tab-people').click();
  await expect(page.getByTestId('workspace-members-section')).toBeVisible();
  await expect(page.getByTestId('workspace-roles-section')).toBeVisible();
  await expect(page.getByTestId('workspace-delete-section')).toBeVisible();
  await page.getByTestId('settings-close').click();

  // Without a workspace bound there is no People tab at all.
  await signOut(page);
  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openSettings(page, 'general');
  await expect(page.getByTestId('settings-tab-hotkeys')).toBeVisible();
  await expect(page.getByTestId('settings-tab-people')).toHaveCount(0);
});

test('E365: Add people autocompletes from the directory — guest badge, ↑/↓/Enter/Esc, and inline empty/error answers', async ({
  page,
  request,
}) => {
  // Issue #183 §3: the suggestions dropdown over the local mock directory.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E365 w${test.info().workerIndex}`);

  await signInTo(page, 'ada', id);
  await openWorkspaceSettings(page);
  const input = page.getByTestId('membership-picker-input');
  const dropdown = page.getByTestId('membership-picker-dropdown');

  // 'jackson' matches the seeded guest — badged as such in the suggestion.
  await input.fill('jackson');
  await expect(dropdown).toBeVisible();
  const mary = page.getByTestId('membership-picker-result-mock-mary');
  await expect(mary).toBeVisible();
  await expect(mary.locator('.membership-guest-badge')).toHaveText('Guest');

  // Esc closes the dropdown — and only the dropdown; typing reopens it.
  await input.press('Escape');
  await expect(dropdown).toHaveCount(0);
  await expect(page.getByTestId('settings-panel')).toBeVisible();

  // 'a' matches grace, alan, katherine and mary (ada is a member already —
  // never offered twice). ↑/↓ move the highlight and Enter adds it: down
  // twice and up once lands on Alan Turing.
  await input.fill('a');
  await expect(page.getByTestId('membership-picker-results')).toBeVisible();
  const active = page.locator('.membership-result.active');
  await expect(active).toHaveCount(1);
  await expect(active).toContainText('Grace Hopper');
  await input.press('ArrowDown');
  await expect(active).toContainText('Alan Turing');
  await input.press('ArrowDown');
  await expect(active).toContainText('Katherine Johnson');
  await input.press('ArrowUp');
  await expect(active).toContainText('Alan Turing');
  await input.press('Enter');
  // The pick lands as a member with the default role, and the box resets.
  await expect(page.getByTestId('workspace-member-role-mock-alan')).toHaveValue('Viewer');
  await expect(input).toHaveValue('');
  await expect(dropdown).toHaveCount(0);

  // A non-empty query that resolves to nobody says so inline…
  await input.fill('zzz-nobody');
  await expect(page.getByTestId('membership-picker-empty')).toContainText('No people match');

  // …and a directory failure is an inline error, not a silent nothing (the
  // #184 live-tenant OBO failure surfaced as exactly this 500).
  await page.route('**/api/directory/search*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"obo exchange failed"}' }),
  );
  await input.fill('grace');
  await expect(page.getByTestId('membership-picker-error')).toContainText('directory');
  await page.unroute('**/api/directory/search*');
});

test('E366: the Add people input and the role select share the one text-input rule — box, border, font and edges — in a light and a dark theme', async ({
  page,
  request,
}) => {
  // Issue #183 §2: asserted as computed styles (this style assertion IS the
  // two-theme visual check the spec calls for). The shared .modal rule reads
  // theme variables, so the pair must agree in Crisp and One Dark alike.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E366 w${test.info().workerIndex}`);
  await signInTo(page, 'ada', id);
  await openWorkspaceSettings(page);

  const input = page.getByTestId('membership-picker-input');
  const select = page.getByTestId('workspace-member-role-mock-ada');
  const styleKey = (el: Element) => {
    const s = getComputedStyle(el);
    return [
      s.paddingTop,
      s.paddingRight,
      s.paddingBottom,
      s.paddingLeft,
      s.borderTopWidth,
      s.borderTopColor,
      s.borderTopLeftRadius,
      s.borderBottomRightRadius,
      s.fontFamily,
      s.fontSize,
    ].join(' | ');
  };
  const borderOf = (el: Element) => getComputedStyle(el).borderTopColor;

  const seenBorders: string[] = [];
  for (const theme of ['crisp', 'one-dark']) {
    await page.getByTestId('settings-tab-appearance').click();
    await page.getByTestId('settings-theme-light').selectOption(theme);
    await page.getByTestId('settings-tab-people').click();
    await expect(input).toBeVisible();
    if (seenBorders.length > 0) {
      // Wait for the theme swap to actually repaint the border variable.
      await expect.poll(() => input.evaluate(borderOf)).not.toBe(seenBorders[seenBorders.length - 1]);
    }

    // Same padding, border colour/width, radius and font, from the one rule.
    expect(await select.evaluate(styleKey)).toBe(await input.evaluate(styleKey));
    seenBorders.push(await input.evaluate(borderOf));

    // Left/right edges align, and the boxes stand equally tall.
    const ib = (await input.boundingBox())!;
    const sb = (await select.boundingBox())!;
    expect(Math.abs(ib.x - sb.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(ib.x + ib.width - (sb.x + sb.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(ib.height - sb.height)).toBeLessThanOrEqual(1);
  }
  // Two genuinely different themes were measured, off the same variables.
  expect(seenBorders[0]).not.toBe(seenBorders[1]);
});

test('E201: the hosted start page offers exactly Open File + the two workspace flows — no Open Folder, on the page or in the menu', async ({
  page,
}) => {
  // PRD 007 Req 21: signed in with no workspace bound, the start page is the
  // splash with its action list. The hosted platform DOES define
  // openFolderDialog (it answers the bound workspace's blob root so the
  // sidebar renders) — the list is derived from the local-folder capability
  // instead, so Open Folder… appears nowhere.
  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('start-drop')).toBeVisible();
  for (const id of ['openFile', 'newWorkspace', 'openWorkspace']) {
    await expect(page.getByTestId(`start-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('start-openFolder')).toHaveCount(0);
  await expect(page.getByTestId('start-actions').getByRole('button')).toHaveCount(3);

  // PRD 009 Req 7: the hamburger leads the toolbar — its right edge sits left
  // of the document name's — and the popover is anchored to it, not to the
  // toolbar's right edge (E13 pins the same for the shim).
  await revealToolbar(page);
  const btnBox = (await page.getByTestId('menu-btn').boundingBox())!;
  const nameBox = (await page.getByTestId('docname').boundingBox())!;
  expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(nameBox.x);

  await openAppMenu(page);
  const menu = page.getByTestId('app-menu');
  const menuBox = (await menu.boundingBox())!;
  expect(Math.abs(menuBox.x - btnBox.x)).toBeLessThan(12);

  // …and nowhere else either: the hosted chrome's menu offers no folder
  // opening, and PRD 009 Req 8/9 pins the rest of its initial-page item set —
  // the workspace group present (the capability exists), no New File, no
  // Close File, no Close Workspace, Save / Save As… greyed rather than gone.
  await expect(menu).not.toContainText('Open Folder');
  const rows = await menu.locator('button').evaluateAll((els) => els.map((el) => el.dataset.testid));
  expect(rows).toEqual([
    'menu-open',
    'menu-new-workspace',
    'menu-open-workspace',
    'menu-save',
    'menu-save-as',
    'menu-view',
    // PRD 009 Req 8/17: hosted auth exists here, so Sign out leads the app
    // group. It is not mode-dependent — this is the initial page.
    'menu-sign-out',
    'menu-settings',
    'menu-help',
    'menu-about',
  ]);
  await expect(menu.getByTestId('menu-sep')).toHaveCount(4);
  await expect(menu.getByTestId('menu-save')).toBeDisabled();
  await expect(menu.getByTestId('menu-save-as')).toBeDisabled();
  // PRD 009 Req 11: no workspace is bound, so nothing names one.
  await expect(page.getByTestId('docname-workspace')).toHaveCount(0);
});

test('E202: a local Markdown file opened on the hosted start page renders client-side — nothing uploaded, no workspace bound', async ({
  page,
}) => {
  // PRD 007 Req 21: hosted local-file mode. The picker fallback is forced so
  // the <input type=file> path (automatable) runs.
  await page.addInitScript(() => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  const writes: string[] = [];
  page.on('request', (req) => {
    if (['PUT', 'POST', 'PATCH'].includes(req.method()) && req.url().includes('/api/workspaces')) {
      writes.push(`${req.method()} ${req.url()}`);
    }
  });

  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('start-openFile').click();
  await (
    await chooser
  ).setFiles({
    name: 'local-only.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Local only\n\nA paragraph that never left this browser.\n'),
  });

  // It opens, renders and is editable — with no workspace open behind it.
  await expect(page.getByTestId('docname')).toContainText('local-only.md');
  await landInPreview(page);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Local only');
  await expect(page.getByTestId('docname-workspace')).toHaveCount(0);
  await page.getByTestId('edit-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('typed locally ');
  await menuSave(page);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // Nothing about the document went to the server.
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => window.location.search)).toBe('');
});

test('E203: New Workspace… and Open Workspace… on the hosted start page land in a workspace', async ({
  page,
  request,
}) => {
  // PRD 007 Req 21: the start-page rows drive the hosted lifecycle flows the
  // menu's workspace rows offer, and choosing one lands in that workspace.
  const ada = await signIn(request, 'ada');
  const name = `E203 existing w${test.info().workerIndex}`;
  const existing = await createWorkspace(request, ada, name);

  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.getByTestId('start-openWorkspace').click();
  await expect(page.getByTestId('open-workspace-dialog')).toBeVisible();
  await page.getByTestId(`open-workspace-item-${existing}`).click();
  await expect(page).toHaveURL(new RegExp(`workspace=${existing}`));
  await expect(page.getByTestId('docname-workspace')).toContainText(name);
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  // New Workspace… from the start page creates one and opens it.
  await page.evaluate(() => window.localStorage.clear());
  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  const fresh = `E203 fresh w${test.info().workerIndex}`;
  await page.getByTestId('start-newWorkspace').click();
  await expect(page.getByTestId('new-workspace-dialog')).toBeVisible();
  await page.getByTestId('new-workspace-name').fill(fresh);
  await page.getByTestId('new-workspace-create').click();
  await expect(page).toHaveURL(/workspace=/);
  await expect(page.getByTestId('docname-workspace')).toContainText(fresh);
});

// PRD 007 Req 13+17 (#79): end-to-end permission enforcement — the UI offers
// only what the signed-in member's role allows, and every route refuses the
// rest regardless of what any UI showed.

/** Read a workspace file as `token`; `null` when the read was refused. */
async function readAs(
  request: APIRequestContext,
  token: string,
  id: string,
  path: string,
): Promise<string | null> {
  const res = await request.get(`${HOSTED}/api/workspaces/${id}/files/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok() ? ((await res.json()) as { content: string }).content : null;
}

/** The `required` verb a refused response names (null when it was not a 403). */
async function requiredVerb(res: APIResponse): Promise<string | null> {
  if (res.status() !== 403) return null;
  return ((await res.json()) as { required?: string }).required ?? null;
}

test('E205: a Commenter comments on a document they cannot edit, and a second member reads it', async ({
  page,
  request,
}) => {
  // PRD 007 Req 14+17: the headline of #79 — the sidecar write is
  // comment.write, not doc.edit, so the built-in Commenter role can finally
  // do the one thing it is named for.
  const ada = await signIn(request, 'ada');
  const id = await sharedWorkspace(request, ada, `E205 w${test.info().workerIndex}`, [
    { id: 'mock-grace', role: 'Commenter' },
  ]);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/shared.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: SHARED_DOC,
  });

  await signInTo(page, 'grace', id);
  await openFromSidebar(page, 'shared.md');
  // The document itself is read-only for them, and the app says why.
  await expect(page.getByTestId('read-only-doc')).toBeVisible();
  await expect(page.getByTestId('edit-toggle')).toHaveCount(0);
  // …but commenting is offered, and works.
  await addComment(page, PHRASE, 'Grace may comment');
  await expect(page.getByTestId('comment-card')).toContainText('Grace may comment');

  // The sidecar really landed as a workspace blob — no doc.edit involved.
  await expect
    .poll(async () => await readAs(request, ada, id, 'shared.md.comments.json'), { timeout: 10_000 })
    .toContain('Grace may comment');
  // And the document they may not save is byte-for-byte the Owner's.
  expect(await readAs(request, ada, id, 'shared.md')).toBe(SHARED_DOC);

  // A second member opens the same document and reads the comment.
  await signOut(page);
  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'shared.md');
  await expect(page.getByTestId('comment-card')).toContainText('Grace may comment');
});

test('E206: without doc.edit the editor is read-only with no Edit Mode or Save — and the PUT is refused anyway', async ({
  page,
  request,
}) => {
  // PRD 007 Req 17: the UI hides the write routes; the server is what makes
  // that a rule rather than a suggestion.
  const ada = await signIn(request, 'ada');
  const id = await workspaceWithRole(request, ada, `E206 w${test.info().workerIndex}`, 'grace', [
    'doc.read',
    'comment.read',
  ]);
  const stored = '# Untouchable\n\nThe stored bytes.\n';
  await request.put(`${HOSTED}/api/workspaces/${id}/files/locked.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: stored,
  });

  await signInTo(page, 'grace', id);
  await openFromSidebar(page, 'locked.md');
  await expect(page.getByTestId('read-only-doc')).toBeVisible();
  // No Edit toggle on the toolbar, and no Save rows in its menu.
  await expect(page.getByTestId('edit-toggle')).toHaveCount(0);
  await page.getByTestId('menu-btn').click();
  await expect(page.getByTestId('app-menu')).toBeVisible();
  await expect(page.getByTestId('menu-save')).toHaveCount(0);
  await expect(page.getByTestId('menu-save-as')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The hotkeys the missing items mirror are just as inert: no editor opens,
  // and the Save that would follow is never issued.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await page.keyboard.press('Control+s');

  // The endpoint refuses the same write by name, whatever any client tried.
  const grace = await signIn(request, 'grace');
  const put = await request.put(`${HOSTED}/api/workspaces/${id}/files/locked.md`, {
    headers: { Authorization: `Bearer ${grace}` },
    data: 'stomped\n',
  });
  expect(await requiredVerb(put)).toBe('doc.edit');
  // …and the stored bytes are exactly what the Owner wrote.
  expect(await readAs(request, ada, id, 'locked.md')).toBe(stored);
});

test('E323: without doc.edit a diagram still draws but grows no resize overlay — a click selects nothing and the bytes stay put', async ({
  page,
  request,
}) => {
  // PRD 015 Req 10 (issue #171): handles appear only where the document may
  // be edited — the gate is docGrants.edit, the same grant as Edit mode. On
  // a read-only document the click does nothing at all.
  const ada = await signIn(request, 'ada');
  const id = await workspaceWithRole(request, ada, `E323 w${test.info().workerIndex}`, 'grace', [
    'doc.read',
    'comment.read',
  ]);
  const stored = '# Locked diagram\n\n```mermaid width=150\ngraph TD\n  A[Start] --> B[Finish]\n```\n';
  await request.put(`${HOSTED}/api/workspaces/${id}/files/diagram.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: stored,
  });

  await signInTo(page, 'grace', id);
  await openFromSidebar(page, 'diagram.md');
  await expect(page.getByTestId('read-only-doc')).toBeVisible();
  const diagram = page.getByTestId('doc').getByTestId('mm-diagram');
  await expect(diagram).toBeVisible({ timeout: 20_000 }); // cold mermaid import
  await diagram.click();
  await expect(page.getByTestId('diagram-resize-overlay')).toHaveCount(0);
  await expect(page.getByTestId('diagram-size-badge')).toHaveCount(0);
  await expect(page.getByTestId('diagram-resize-handle-se')).toHaveCount(0);
  // The stored bytes are untouched.
  expect(await readAs(request, ada, id, 'diagram.md')).toBe(stored);
});

test('E207: a role with doc.edit but not file.create may overwrite an existing path and not invent a new one', async ({
  request,
}) => {
  // PRD 007 Req 13+15: the create/save split. No built-in role separates the
  // two verbs — a custom role is exactly why they cannot share one.
  const ada = await signIn(request, 'ada');
  const id = await workspaceWithRole(request, ada, `E207 w${test.info().workerIndex}`, 'grace', [
    'doc.read',
    'doc.edit',
  ]);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/there.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: 'original\n',
  });
  const grace = await signIn(request, 'grace');
  const headers = { Authorization: `Bearer ${grace}` };

  // A path that holds nothing yet is a create — refused, and nothing lands.
  const created = await request.put(`${HOSTED}/api/workspaces/${id}/files/brand-new.md`, {
    headers,
    data: 'mine\n',
  });
  expect(await requiredVerb(created)).toBe('file.create');
  expect(await listFiles(request, ada, id)).toEqual(['there.md']);
  // A path that exists is a save — allowed.
  const saved = await request.put(`${HOSTED}/api/workspaces/${id}/files/there.md`, {
    headers,
    data: 'edited\n',
  });
  expect(saved.status()).toBe(200);
  expect(await readAs(request, ada, id, 'there.md')).toBe('edited\n');
});

test('E208: comment.read gates whether comments load at all, and comment.write whether one can be written', async ({
  page,
  request,
}) => {
  // PRD 007 Req 17: two verbs, two separate gates — and neither is enforced
  // by the UI alone.
  const ada = await signIn(request, 'ada');
  const id = await workspaceWithRole(request, ada, `E208 w${test.info().workerIndex}`, 'grace', [
    'doc.read',
    'comment.read',
  ]);
  const headers = { Authorization: `Bearer ${ada}` };
  await request.put(`${HOSTED}/api/workspaces/${id}/files/talked.md`, { headers, data: SHARED_DOC });

  // Ada leaves a comment on it.
  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'talked.md');
  await addComment(page, PHRASE, 'Ada started a thread');
  await expect
    .poll(async () => await readAs(request, ada, id, 'talked.md.comments.json'), { timeout: 10_000 })
    .toContain('Ada started a thread');

  // Grace holds comment.read but not comment.write: she sees the comment and
  // is offered no way to add one — selecting text yields no affordance.
  await signOut(page);
  await signInTo(page, 'grace', id);
  await openFromSidebar(page, 'talked.md');
  await expect(page.getByTestId('comment-card')).toContainText('Ada started a thread');
  await selectPhrase(page, PHRASE);
  await expect(page.getByTestId('add-comment-btn')).toHaveCount(0);
  const grace = await signIn(request, 'grace');
  const write = await request.put(`${HOSTED}/api/workspaces/${id}/files/talked.md.comments.json`, {
    headers: { Authorization: `Bearer ${grace}` },
    data: '{"version":1,"comments":[]}',
  });
  expect(await requiredVerb(write)).toBe('comment.write');

  // Alan holds neither comment verb: the comments are not loaded or shown at
  // all, and the sidecar read is refused by name.
  const noComments = await workspaceWithRole(request, ada, `E208b w${test.info().workerIndex}`, 'alan', ['doc.read']);
  await request.put(`${HOSTED}/api/workspaces/${noComments}/files/talked.md`, { headers, data: SHARED_DOC });
  await request.put(`${HOSTED}/api/workspaces/${noComments}/files/talked.md.comments.json`, {
    headers,
    data: await readAs(request, ada, id, 'talked.md.comments.json') ?? '',
  });
  await signOut(page);
  await signInTo(page, 'alan', noComments);
  await openFromSidebar(page, 'talked.md');
  await expect(page.getByTestId('docname')).toContainText('talked.md');
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  const alan = await signIn(request, 'alan');
  const read = await request.get(`${HOSTED}/api/workspaces/${noComments}/files/talked.md.comments.json`, {
    headers: { Authorization: `Bearer ${alan}` },
  });
  expect(await requiredVerb(read)).toBe('comment.read');
});

test('E212: on hosted, Open File… with a workspace open crosses into single-file mode and clears the ?workspace binding', async ({
  page,
  request,
}) => {
  // PRD 009 Req 4/5/6 (#90): the modes are exclusive here — a local file no
  // longer opens INSIDE the workspace (the retired PRD 007 Req 21 variant,
  // whose E209 this test replaces). The picker fallback is forced so the
  // <input type=file> path (automatable) runs.
  await page.addInitScript(() => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E212 w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/theirs.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# Theirs\n',
  });

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'theirs.md');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-open').click();
  await (
    await chooser
  ).setFiles({
    name: 'mine.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Mine\n\nHeld by this browser alone.\n'),
  });

  // Req 4: the workspace closed and the file opened — single-file mode, with
  // the initial page never the resting state of the switch.
  await expect(page.getByTestId('docname')).toContainText('mine.md');
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);

  // …and it is a local document: fully editable, nothing uploaded.
  await landInPreview(page);
  await page.getByTestId('edit-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('typed locally ');
  await menuSave(page);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await listFiles(request, ada, id)).toEqual(['theirs.md']);

  // Req 6: the URL binding went with the workspace — in place, so the file
  // being opened survived — and a reload now lands on the initial page.
  expect(await page.evaluate(() => window.location.search)).toBe('');
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('docname-workspace')).toHaveCount(0);
});

test('E213: on hosted, a handle-backed local file saves in place through the handle — and downloads instead when the permission request is denied', async ({
  page,
}) => {
  // PRD 009 Req 15: single-file mode saves the user's own file back through
  // the File System Access handle after the readwrite grant. The real picker
  // cannot be driven headlessly, so a fake handle stands in for it: it
  // records what `createWritable()` was given and answers the permission
  // seams from localStorage, so the same stub serves the grant and the
  // refusal. Everything under test — the query/request pair, the write, the
  // download fallback — is the app's own code either way.
  await page.addInitScript(() => {
    const w = window as unknown as {
      showOpenFilePicker: unknown;
      __fsWrites: string[];
      __fsPrompts: number;
    };
    w.__fsWrites = [];
    w.__fsPrompts = 0;
    let granted = false;
    w.showOpenFilePicker = async () => [
      {
        kind: 'file',
        name: 'stubbed.md',
        getFile: async () =>
          new File(['# Stubbed\n\nHeld by this browser alone.\n'], 'stubbed.md', { type: 'text/markdown' }),
        queryPermission: async () => (granted ? 'granted' : 'prompt'),
        requestPermission: async () => {
          w.__fsPrompts += 1;
          const answer = localStorage.getItem('e2e-fs-permission') ?? 'granted';
          granted = answer === 'granted';
          return answer;
        },
        createWritable: async () => {
          let buf = '';
          return {
            write: async (data: string) => {
              buf += data;
            },
            close: async () => {
              w.__fsWrites.push(buf);
            },
          };
        },
      },
    ];
  });
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  const writes: string[] = [];
  page.on('request', (req) => {
    if (['PUT', 'POST', 'PATCH'].includes(req.method()) && req.url().includes('/api/workspaces')) {
      writes.push(`${req.method()} ${req.url()}`);
    }
  });

  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.getByTestId('start-openFile').click();
  await expect(page.getByTestId('docname')).toContainText('stubbed.md');

  await landInPreview(page);
  await page.getByTestId('edit-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('typed in place ');
  await menuSave(page);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The edited buffer went into the user's own file, through the handle,
  // after exactly one grant — no download, and nothing to the server.
  const written = await page.evaluate(() => (window as unknown as { __fsWrites: string[] }).__fsWrites);
  expect(written).toHaveLength(1);
  expect(written[0]).toContain('typed in place ');
  expect(written[0]).toContain('# Stubbed');
  expect(downloads).toEqual([]);
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __fsPrompts: number }).__fsPrompts)).toBe(1);

  // A second save in the same session writes again without re-prompting.
  await page.locator('.cm-content').click();
  await page.keyboard.type('and again ');
  await menuSave(page);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const twice = await page.evaluate(() => (window as unknown as { __fsWrites: string[] }).__fsWrites);
  expect(twice).toHaveLength(2);
  expect(twice[1]).toContain('and again ');
  expect(await page.evaluate(() => (window as unknown as { __fsPrompts: number }).__fsPrompts)).toBe(1);
  expect(downloads).toEqual([]);

  // Same Save with the grant refused: the bytes still reach the user, as a
  // download, and nothing was written through the handle.
  await page.evaluate(() => localStorage.setItem('e2e-fs-permission', 'denied'));
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.getByTestId('start-openFile').click();
  await expect(page.getByTestId('docname')).toContainText('stubbed.md');
  await landInPreview(page);
  await page.getByTestId('edit-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('typed while denied ');
  const downloaded = page.waitForEvent('download');
  await menuSave(page);
  expect((await downloaded).suggestedFilename()).toBe('stubbed.md');
  expect(await page.evaluate(() => (window as unknown as { __fsWrites: string[] }).__fsWrites)).toEqual([]);
  expect(writes).toEqual([]);
});

test('E215: Sign out prompts for unsaved work, Cancel keeps the session, and going through drops the token and the workspace binding', async ({
  page,
  request,
}) => {
  // PRD 009 Req 17: the whole flow. Sign out is offered inside a workspace
  // too (it is not mode-dependent), it borrows the existing dirty-file
  // prompts rather than inventing one, Cancel anywhere aborts the sign-out
  // outright, and the completed walk leaves the browser on the sign-in
  // screen with no token and no `?workspace=` binding to walk back in on.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E214 w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/notes.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# Notes\n\nStored bytes.\n',
  });

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'notes.md');
  await page.getByTestId('edit-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('unsaved work ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // The row is there in workspace mode as well as on the initial page.
  await openAppMenu(page);
  await expect(page.getByTestId('menu-sign-out')).toBeEnabled();
  await page.getByTestId('menu-sign-out').click();

  // …and it runs the existing close prompt over the dirty document first.
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  await page.getByTestId('close-cancel').click();
  await expect(page.getByTestId('close-prompt')).toHaveCount(0);

  // Cancel aborted the sign-out entirely: still signed in, still in the
  // workspace, the document still open with its unsaved edit.
  await expect(page.getByTestId('docname')).toContainText('notes.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.getByTestId('hosted-sign-in')).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('marky-mark.hosted.token'))).toBeTruthy();
  expect(new URL(page.url()).search).toBe(`?workspace=${id}`);

  // Through the same prompt again, discarding this time.
  await openAppMenu(page);
  await page.getByTestId('menu-sign-out').click();
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  await page.getByTestId('close-discard').click();

  // The session is over: the sign-in screen, no stored token, and the URL
  // carries no workspace binding.
  await expect(page.getByTestId('hosted-sign-in')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('marky-mark.hosted.token'))).toBeNull();
  expect(new URL(page.url()).search).toBe('');

  // A reload stays signed out — and signing back in lands on the initial
  // page, not back inside the workspace that was open.
  await page.reload();
  await expect(page.getByTestId('hosted-sign-in')).toBeVisible();
  await page.getByTestId('hosted-sign-in-username').fill('ada');
  await page.getByTestId('hosted-sign-in-submit').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
});

test('E217: Close Workspace returns to the initial page and drops the ?workspace binding, so a reload stays there', async ({
  page,
  request,
}) => {
  // PRD 009 Req 3+6: the menu row, not the command seam — with a document open
  // inside the workspace, Close Workspace ends on the initial page and takes
  // the URL binding with it. E212 covers the same clearing on the *crossing*
  // path; this is the plain close, whose resting state IS the initial page.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E217 w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/kept.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# Kept\n',
  });

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'kept.md');
  expect(new URL(page.url()).search).toBe(`?workspace=${id}`);

  // PRD 009 Req 8/9: workspace mode is the one state E13 (single-file) and
  // E201 (initial page) cannot freeze — its full row set, in order, is here:
  // New File and Close Workspace present exactly because of the mode.
  await openAppMenu(page);
  const menu = page.getByTestId('app-menu');
  const rows = await menu.locator('button').evaluateAll((els) => els.map((el) => el.dataset.testid));
  expect(rows).toEqual([
    'menu-new',
    'menu-open',
    'menu-close-file',
    'menu-new-workspace',
    'menu-open-workspace',
    'menu-close-workspace',
    'menu-save',
    'menu-save-as',
    'menu-view',
    'menu-sign-out',
    'menu-settings',
    'menu-help',
    'menu-about',
  ]);
  await expect(menu.getByTestId('menu-sep')).toHaveCount(4);
  await expect(menu.getByTestId('menu-save')).toBeEnabled();

  await page.getByTestId('menu-close-workspace').click();

  // Req 3: the initial page — no sidebar, no document, the start actions back.
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('start-openFile')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);
  await expect(page.getByTestId('docname-workspace')).toHaveCount(0);
  await expect(page.getByTestId('doc').locator('h1')).toHaveCount(0);

  // Req 9: the workspace-mode rows went with the mode; the group's entry rows
  // stay because the capability does.
  await openAppMenu(page);
  await expect(page.getByTestId('menu-close-workspace')).toHaveCount(0);
  await expect(page.getByTestId('menu-close-file')).toHaveCount(0);
  await expect(page.getByTestId('menu-new')).toHaveCount(0);
  await expect(page.getByTestId('menu-open-workspace')).toBeVisible();
  await page.keyboard.press('Escape');

  // Req 6: the binding is gone from the URL in place, so a reload lands on the
  // initial page rather than walking straight back into the workspace.
  expect(new URL(page.url()).search).toBe('');
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  // The workspace itself is untouched — only this browser's binding to it.
  expect(await listFiles(request, ada, id)).toEqual(['kept.md']);
});

test('E218: workspace New File names the file in the picker, creates it through the workspace file API and opens it', async ({
  page,
  request,
}) => {
  // PRD 009 Req 13: on a flavor with no native save dialog, New File is a
  // workspace-mode row that goes through the shared picker — no floating
  // untitled buffer. tests/unit/save-picker.test.ts covers the naming rules;
  // this drives the row end to end against the real file API.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E218 w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/seed.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# Seed\n',
  });

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'seed.md');

  // Req 9: New File exists here precisely because this is workspace mode.
  await openAppMenu(page);
  await expect(page.getByTestId('menu-new')).toBeEnabled();
  await page.getByTestId('menu-new').click();

  // The picker offers a free default name and the workspace's folders.
  const picker = page.getByTestId('save-picker');
  await expect(picker).toBeVisible();
  await expect(page.getByTestId('save-picker-name')).toHaveValue('Untitled.md');
  await expect(page.getByTestId('save-picker-folder')).toBeVisible();
  await page.getByTestId('save-picker-name').fill('minted.md');
  await page.getByTestId('save-picker-confirm').click();
  await expect(picker).toHaveCount(0);

  // It became a real workspace file, and it is the current document — named
  // for its path, inside the workspace, and not an untitled buffer.
  await expect(page.getByTestId('docname')).toContainText('minted.md');
  await expect(page.getByTestId('docname')).not.toContainText('Untitled');
  await expect(page.getByTestId('docname-workspace')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(page.getByTestId('folder-item').filter({ hasText: 'minted.md' })).toBeVisible();
  await expect.poll(() => listFiles(request, ada, id)).toEqual(['minted.md', 'seed.md']);
  expect(await readAs(request, ada, id, 'minted.md')).toBe('');

  // …and it edits and saves like any other workspace document.
  await page.getByTestId('edit-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('# Minted');
  await menuSave(page);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect.poll(() => readAs(request, ada, id, 'minted.md')).toContain('# Minted');
});

test('E219: workspace Save As… writes the copy through the picker and switches to it, leaving the original intact', async ({
  page,
  request,
}) => {
  // PRD 009 Req 14: the same picker as Req 13, reaching the same end state as
  // the native Save As… dialog — the copy becomes the current document.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E219 w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/original.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# Original\n\nFirst draft.\n',
  });

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'original.md');
  await page.getByTestId('edit-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('A branching thought. ');

  await openAppMenu(page);
  await page.getByTestId('menu-save-as').click();
  const picker = page.getByTestId('save-picker');
  await expect(picker).toBeVisible();
  // Save As… suggests a free name derived from the current document.
  await expect(page.getByTestId('save-picker-name')).toHaveValue(/original/);
  await page.getByTestId('save-picker-name').fill('branch.md');
  await page.getByTestId('save-picker-confirm').click();
  await expect(picker).toHaveCount(0);

  // The copy carries the buffer — edits included — and is now the document.
  await expect(page.getByTestId('docname')).toContainText('branch.md');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect.poll(() => listFiles(request, ada, id)).toEqual(['branch.md', 'original.md']);
  await expect.poll(() => readAs(request, ada, id, 'branch.md')).toContain('A branching thought.');
  // …while the original still holds what was last saved to it.
  expect(await readAs(request, ada, id, 'original.md')).toBe('# Original\n\nFirst draft.\n');

  // Typing now lands in the copy, never back in the original. (Opening the
  // copy is a fresh openDoc — issue #125: it lands in the remembered mode
  // like any other open.)
  await landInPreview(page);
  await page.getByTestId('edit-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('Only here. ');
  await menuSave(page);
  await expect.poll(() => readAs(request, ada, id, 'branch.md')).toContain('Only here.');
  expect(await readAs(request, ada, id, 'original.md')).toBe('# Original\n\nFirst draft.\n');
});

test('E220: dropping a local file with a workspace open crosses into single-file mode — Cancel at the dirty prompt aborts the drop', async ({
  page,
  request,
}) => {
  // PRD 009 Req 4/5: drag-and-drop is the crossing action E212 does not cover
  // (it drives Open File…). The dropped file must not open INSIDE the
  // workspace (the retired behavior of E209) — it closes it first, prompts,
  // and a Cancel there leaves the workspace exactly as it was.
  const ada = await signIn(request, 'ada');
  const id = await createWorkspace(request, ada, `E220 w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/theirs.md`, {
    headers: { Authorization: `Bearer ${ada}` },
    data: '# Theirs\n',
  });

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'theirs.md');
  await page.getByTestId('edit-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('unsaved ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  /** Drop an in-page-constructed .md File onto the window. */
  const drop = () =>
    page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['# Dropped\n\nNever uploaded.\n'], 'dropped.md', { type: 'text/markdown' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });

  // Req 4: the workspace's dirty walk runs first, and Cancel aborts the whole
  // switch — still in the workspace, still dirty, nothing new opened.
  await drop();
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  await page.getByTestId('close-cancel').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('docname')).toContainText('theirs.md');
  await expect(page.getByTestId('docname')).not.toContainText('dropped.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  expect(new URL(page.url()).search).toBe(`?workspace=${id}`);

  // Discarding this time: the workspace closes and the dropped file opens in
  // single-file mode — never inside the workspace, never via the initial page.
  await drop();
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  await page.getByTestId('close-discard').click();
  await expect(page.getByTestId('docname')).toContainText('dropped.md');
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('docname-workspace')).toHaveCount(0);
  await landInPreview(page);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Dropped');

  // Req 6: the binding went with the workspace, and the drop uploaded nothing
  // — the unsaved edit to theirs.md was discarded, not written.
  expect(new URL(page.url()).search).toBe('');
  expect(await listFiles(request, ada, id)).toEqual(['theirs.md']);
  expect(await readAs(request, ada, id, 'theirs.md')).toBe('# Theirs\n');
});

// --- PRD 011 Reqs 8+9+35 (#121): the hosted flavor's LLM availability state --
// Req 35 enumerates "the settings area's availability states on each flavor".
// Desktop is E226–E228 and static web is W14; this is the hosted one. The local
// dev server names no MM_LLM_* variable, so the deployment answers
// `configured: false` and the area is in its `operator-unconfigured` state —
// the flavor's honest resting state, and the one a member is most likely to
// meet. Nothing here contacts a provider: the server makes no outbound request
// until a POST asks it to, and no test posts one.

test('E246: PRD 011 Reqs 8+9 — hosted with no operator provider says so, and offers a member no key field', async ({
  page,
}) => {
  await signInTo(page, 'ada');
  await revealToolbar(page);
  await openSettings(page, 'llm');

  // The sentence is the deployment's own (src/lib/llmDeployment.ts), not one
  // this panel composed: it names what is missing and who can fix it.
  await expect(page.getByTestId('llm-availability')).toHaveText(NO_LLM_CONFIGURED_MESSAGE);

  // Req 8: the credential is the operator's. A member is offered no field to
  // type one into, and no action to remove one they never had.
  await expect(page.getByTestId('llm-api-key')).toHaveCount(0);
  await expect(page.getByTestId('llm-remove-key')).toHaveCount(0);
  // …and no provider or model control either: choosing them is not theirs.
  await expect(page.getByTestId('llm-provider')).toHaveCount(0);
  await expect(page.getByTestId('llm-model')).toHaveCount(0);
  await expect(page.getByTestId('llm-model-preset')).toHaveCount(0);
  await expect(page.getByTestId('llm-base-url')).toHaveCount(0);
  // Nothing is configured, so there is nothing to name as in use.
  await expect(page.getByTestId('llm-hosted-provider')).toHaveCount(0);

  // Req 9: no control that cannot work. Test connection is rendered but inert,
  // and the reason it is inert is the availability sentence itself — not a
  // second wording invented for the button.
  await expect(page.getByTestId('llm-test')).toBeDisabled();
  await expect(page.getByTestId('llm-test')).toHaveAttribute('title', NO_LLM_CONFIGURED_MESSAGE);
  await expect(page.getByTestId('llm-test-result')).toHaveCount(0);

  // Req 9+30, the same rule again: on hosted the cache belongs to the
  // workspace (src/platform/hosted.ts), and this session has none open — so
  // the section is absent rather than drawn over a store that does not exist.
  await expect(page.getByTestId('summary-cache-size')).toHaveCount(0);
  await expect(page.getByTestId('summary-cache-clear')).toHaveCount(0);
  await page.getByTestId('settings-close').click();
});

test('E325: a crash-safe draft left in the store by a killed test does not hijack the next sign-in', async ({
  page,
  request,
}) => {
  // Issue #179 / SPEC30 §3: a hosted test killed mid-edit leaves its debounced
  // draft.json in the signed-in user's roaming config blob. Unhandled, every
  // later test signing in as that user boots into the "Restore unsaved
  // changes?" overlay, its clicks are intercepted, and one kill cascades
  // through the suite. Poison the store deliberately, then prove the next UI
  // sign-in starts draft-free.
  const ada = await signIn(request, 'ada');
  const headers = { Authorization: `Bearer ${ada}` };
  const poison = serializeDraft({
    version: 1,
    // An untitled buffer with content is never stale, so absent a reset this
    // draft is guaranteed to trigger the restore offer.
    docPath: null,
    content: '# poisoned\n\nleft by a test killed mid-edit\n',
    at: new Date().toISOString(),
  });
  const put = await request.put(`${HOSTED}/api/me/files/draft.json`, { headers, data: poison });
  expect(put.status()).toBe(200);

  await signInTo(page, 'ada');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  // The draft offer fires ~250ms after boot (src/App.tsx SPEC30 §3); outwait
  // it before asserting the overlay never came.
  await page.waitForTimeout(750);
  await expect(page.getByTestId('restore-prompt')).toHaveCount(0);
  // The poison is gone from the store — discarded, not merely not shown — so
  // it cannot resurface in any later test either.
  const get = await request.get(`${HOSTED}/api/me/files/draft.json`, { headers });
  expect(get.status()).toBe(404);
});

// --- the file tab strip on hosted (PRD 013 amended by issue #186) ------------
// The strip is gated on the `multiFileSession` capability, which the hosted
// flavor declares: the SPEC36 open set already ran here, only the strip was
// hidden behind the old `localFolders` gate. These cover the hosted minimum —
// presence, activation, close, the setting toggle — while every deeper strip
// behavior stays covered by file-tabs.spec.ts on the shim.

/** The hosted strip's tab for the file named `name`. */
const hostedTab = (page: Page, name: string) =>
  page.getByTestId('file-tab').filter({ hasText: name });

test('E358: hosted — the tab strip renders on the open set and a tab click activates the parked file', async ({
  page,
  request,
}) => {
  // PRD 013 Reqs 1–4 on the hosted platform: one tab per open file, the
  // active tab distinct, and activation through the SPEC36 park/restore path.
  const token = await signIn(request, 'ada');
  const headers = { Authorization: `Bearer ${token}` };
  const id = await createWorkspace(request, token, `E358 w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/alpha.md`, { headers, data: '# alpha\n' });
  await request.put(`${HOSTED}/api/workspaces/${id}/files/beta.md`, { headers, data: '# beta\n' });

  await signInTo(page, 'ada', id);
  await openFromSidebar(page, 'alpha.md');
  // A single open file already renders the strip, its one tab active.
  await expect(page.getByTestId('file-tab-strip')).toBeVisible();
  await expect(page.getByTestId('file-tab')).toHaveCount(1);
  await expect(hostedTab(page, 'alpha.md')).toHaveAttribute('data-active', 'true');

  // A second open joins the set additively (SPEC36 §3.2, issue #64 rule).
  await openFromSidebar(page, 'beta.md');
  await expect(page.getByTestId('file-tab')).toHaveCount(2);
  await expect(hostedTab(page, 'beta.md')).toHaveAttribute('data-active', 'true');
  await expect(hostedTab(page, 'alpha.md')).toHaveAttribute('data-active', 'false');

  // Clicking the inactive tab activates it — document and active state follow.
  await hostedTab(page, 'alpha.md').click();
  await expect(page.getByTestId('docname')).toContainText('alpha.md');
  await expect(hostedTab(page, 'alpha.md')).toHaveAttribute('data-active', 'true');
  await expect(hostedTab(page, 'beta.md')).toHaveAttribute('data-active', 'false');
});

test('E359: hosted — ✕ closes a tab without switching, and View ▸ File Tabs hides then restores the strip', async ({
  page,
  request,
}) => {
  const token = await signIn(request, 'grace');
  const headers = { Authorization: `Bearer ${token}` };
  const id = await createWorkspace(request, token, `E359 w${test.info().workerIndex}`);
  await request.put(`${HOSTED}/api/workspaces/${id}/files/keep.md`, { headers, data: '# keep\n' });
  await request.put(`${HOSTED}/api/workspaces/${id}/files/gone.md`, { headers, data: '# gone\n' });

  await signInTo(page, 'grace', id);
  await openFromSidebar(page, 'gone.md');
  await openFromSidebar(page, 'keep.md');
  await expect(page.getByTestId('file-tab')).toHaveCount(2);

  // PRD 013 Req 5 on hosted: ✕ on the clean INACTIVE tab removes it from the
  // open set without activating it — the active document never changes.
  await hostedTab(page, 'gone.md').hover();
  await hostedTab(page, 'gone.md').getByTestId('file-tab-close').click();
  await expect(page.getByTestId('file-tab')).toHaveCount(1);
  await expect(page.getByTestId('docname')).toContainText('keep.md');
  await expect(hostedTab(page, 'keep.md')).toHaveAttribute('data-active', 'true');

  // PRD 013 Req 13: the View ▸ File Tabs toggle exists on hosted now and
  // hides the strip; the open set is untouched, so toggling back restores it.
  // The setting roams per user (PRD 007), so this test restores what it flips.
  await openAppMenu(page);
  await page.getByTestId('menu-view').click();
  await page.getByTestId('app-menu-view').getByTestId('menu-view-toggleFileTabs').click();
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('keep.md');
  await openAppMenu(page);
  await page.getByTestId('menu-view').click();
  await page.getByTestId('app-menu-view').getByTestId('menu-view-toggleFileTabs').click();
  await expect(page.getByTestId('file-tab-strip')).toBeVisible();
  await expect(hostedTab(page, 'keep.md')).toHaveAttribute('data-active', 'true');
});

// --- deployment policies (PRD 017 Reqs 3+6–12+15, issue #188) ----------------

/**
 * PRD 017 Req 6: the settings record, written straight to Azurite (the API's
 * own routes refuse the reserved prefix — E363). The suite's workers share
 * one server, so every policy below is shaped to refuse ONLY `mary` (the
 * seeded guest no other test creates as): concurrent tests keep creating
 * workspaces as ada/grace/alan (allow-listed or members) and katherine (the
 * seeded admin, admitted under every policy).
 */
const deploymentSettingsBlob = () =>
  BlobServiceClient.fromConnectionString(AZURITE_CONNECTION_STRING)
    .getContainerClient('marky-mark')
    .getBlockBlobClient(DEPLOYMENT_SETTINGS_BLOB);

async function putDeploymentSettings(settings: DeploymentSettings): Promise<void> {
  const body = Buffer.from(serializeDeploymentSettings(settings));
  await deploymentSettingsBlob().upload(body, body.length);
}

/** PRD 017 Req 6: an ABSENT blob IS the default record — deleting restores it. */
async function resetDeploymentSettings(): Promise<void> {
  await deploymentSettingsBlob().deleteIfExists();
}

// One deployment has ONE settings blob, and each test below writes and
// restores it — run in parallel workers they would overwrite and delete each
// other's policy mid-test, so this group alone is serialized. The rest of
// the suite stays parallel (the policies above never refuse its users).
test.describe('PRD 017 deployment policies', () => {
  test.describe.configure({ mode: 'serial' });

  test('E360: under restricted, creation is disabled with the hint and 403s server-side; an allow-listed user creates normally', async ({
    page,
    request,
  }) => {
    // PRD 017 Req 8: restricted admits admins and the allow list alone — here
    // everyone but mary, so the shared lane never trips over the policy.
    await putDeploymentSettings({
      version: 1,
      creation: {
        policy: 'restricted',
        allow: [{ id: 'mock-ada', displayName: 'Ada Lovelace' }, { id: 'mock-grace' }, { id: 'mock-alan' }],
      },
      listing: { policy: 'everyone' },
    });
    try {
      // Req 8: the refusal names the deployment-level permission and nothing
      // was written — creating right after (as an allow-listed user) works.
      const mary = await signIn(request, 'mary');
      const refused = await request.post(`${HOSTED}/api/workspaces`, {
        headers: { Authorization: `Bearer ${mary}` },
        data: { name: 'E360 refused' },
      });
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toEqual({ error: 'forbidden', required: 'deployment.create' });
      // Req 3: /api/me reports the verdict and the refusal to word hints from.
      const me = await request.get(`${HOSTED}/api/me`, { headers: { Authorization: `Bearer ${mary}` } });
      expect(await me.json()).toMatchObject({ admin: false, canCreateWorkspaces: false, createRefusal: 'restricted' });

      // Req 10: the start-page action stays visible but disabled, the
      // restricted hint beneath it; the File-menu item is disabled too;
      // openWorkspace is unaffected.
      await signInTo(page, 'mary');
      const action = page.getByTestId('start-newWorkspace');
      await expect(action).toBeVisible();
      await expect(action).toBeDisabled();
      await expect(page.getByTestId('start-newWorkspace-hint')).toHaveText(CREATE_REFUSAL_HINTS.restricted);
      await expect(page.getByTestId('start-openWorkspace')).toBeEnabled();
      await openAppMenu(page);
      await expect(page.getByTestId('menu-new-workspace')).toBeDisabled();
      await expect(page.getByTestId('menu-open-workspace')).toBeEnabled();

      // Req 8: an allow-listed regular user creates exactly as before.
      const grace = await signIn(request, 'grace');
      const id = await createWorkspace(request, grace, `E360 allowed w${test.info().workerIndex}`);
      const gone = await request.delete(`${HOSTED}/api/workspaces/${id}`, {
        headers: { Authorization: `Bearer ${grace}` },
      });
      expect(gone.status()).toBe(200);
    } finally {
      await resetDeploymentSettings();
    }
  });

  test('E361: under members, the seeded guest is refused with the guest hint while a member creates', async ({
    page,
    request,
  }) => {
    // PRD 017 Req 9: the server resolves mary's guest status through the
    // directory's own entry for her (the mock answers from SEEDED_USERS).
    await putDeploymentSettings({
      version: 1,
      creation: { policy: 'members', allow: [] },
      listing: { policy: 'everyone' },
    });
    try {
      const mary = await signIn(request, 'mary');
      const refused = await request.post(`${HOSTED}/api/workspaces`, {
        headers: { Authorization: `Bearer ${mary}` },
        data: { name: 'E361 refused' },
      });
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toEqual({ error: 'forbidden', required: 'deployment.create' });
      const me = await request.get(`${HOSTED}/api/me`, { headers: { Authorization: `Bearer ${mary}` } });
      expect(await me.json()).toMatchObject({ canCreateWorkspaces: false, createRefusal: 'guest' });

      // Req 10: the guest wording, not the restricted one.
      await signInTo(page, 'mary');
      await expect(page.getByTestId('start-newWorkspace')).toBeDisabled();
      await expect(page.getByTestId('start-newWorkspace-hint')).toHaveText(CREATE_REFUSAL_HINTS.guest);

      // Req 8: a tenant member is not refused.
      const ada = await signIn(request, 'ada');
      const id = await createWorkspace(request, ada, `E361 member w${test.info().workerIndex}`);
      const gone = await request.delete(`${HOSTED}/api/workspaces/${id}`, {
        headers: { Authorization: `Bearer ${ada}` },
      });
      expect(gone.status()).toBe(200);
    } finally {
      await resetDeploymentSettings();
    }
  });

  test('E362: under members listing, a non-member’s GET /api/workspaces omits the workspace, the Open dialog never shows it, and the admin is filtered like anyone else', async ({
    page,
    request,
  }) => {
    const ada = await signIn(request, 'ada');
    const name = `E362 hidden w${test.info().workerIndex}`;
    const id = await createWorkspace(request, ada, name);
    try {
      // The slow part (a full UI sign-in) happens BEFORE the policy flips, so
      // the members-listing window the shared lane sees stays as short as the
      // few requests below (other tests assert inaccessible rows ARE listed
      // under the default policy — E177/E184).
      await signInTo(page, 'alan');
      await putDeploymentSettings({
        version: 1,
        creation: { policy: 'everyone', allow: [] },
        listing: { policy: 'members' },
      });
      // Req 11: alan holds nothing in the workspace — his listing omits the
      // row entirely; ada's keeps it, row shape unchanged (Req 12: no row, so
      // no no-access message can arise).
      const alan = await signIn(request, 'alan');
      const listedForAlan = (await (
        await request.get(`${HOSTED}/api/workspaces`, { headers: { Authorization: `Bearer ${alan}` } })
      ).json()) as { id: string }[];
      expect(listedForAlan.map((w) => w.id)).not.toContain(id);
      const listedForAda = (await (
        await request.get(`${HOSTED}/api/workspaces`, { headers: { Authorization: `Bearer ${ada}` } })
      ).json()) as { id: string; name: string; access: boolean; owners: string[] }[];
      expect(listedForAda.find((w) => w.id === id)).toMatchObject({ id, name, access: true, owners: ['mock-ada'] });

      // Req 11: the admin's ORDINARY listing is filtered the same way —
      // cross-membership browsing lives in Management only — while Req 4
      // still opens the workspace itself by id.
      const katherine = await signIn(request, 'katherine');
      const listedForAdmin = (await (
        await request.get(`${HOSTED}/api/workspaces`, { headers: { Authorization: `Bearer ${katherine}` } })
      ).json()) as { id: string }[];
      expect(listedForAdmin.map((w) => w.id)).not.toContain(id);
      const manifest = await request.get(`${HOSTED}/api/workspaces/${id}/manifest`, {
        headers: { Authorization: `Bearer ${katherine}` },
      });
      expect(manifest.status()).toBe(200);

      // Req 11: the Open Workspace dialog is that listing — the hidden row is
      // simply not there for alan.
      await openAppMenu(page);
      await page.getByTestId('menu-open-workspace').click();
      await expect(page.getByTestId('open-workspace-dialog')).toBeVisible();
      await expect(page.getByTestId(`open-workspace-item-${id}`)).toHaveCount(0);
    } finally {
      await resetDeploymentSettings();
      const gone = await request.delete(`${HOSTED}/api/workspaces/${id}`, {
        headers: { Authorization: `Bearer ${ada}` },
      });
      expect(gone.status()).toBe(200);
    }
  });

  test('E363: the legacy /api/files scaffold hides the deployment/ prefix and refuses reads, writes and deletes under it', async ({
    request,
  }) => {
    // PRD 017 Req 6: the record below matches the defaults exactly, so its
    // presence changes no behaviour for concurrent tests — it exists only to
    // prove a REAL blob under the prefix never surfaces through the scaffold.
    await putDeploymentSettings({
      version: 1,
      creation: { policy: 'everyone', allow: [] },
      listing: { policy: 'everyone' },
    });
    try {
      const token = await signIn(request, 'grace');
      const headers = { Authorization: `Bearer ${token}` };
      const listed = (await (await request.get(`${HOSTED}/api/files`, { headers })).json()) as { path: string }[];
      expect(listed.filter((f) => f.path.startsWith('deployment/'))).toEqual([]);
      for (const attempt of [
        request.get(`${HOSTED}/api/files/${DEPLOYMENT_SETTINGS_BLOB}`, { headers }),
        request.put(`${HOSTED}/api/files/${DEPLOYMENT_SETTINGS_BLOB}`, { headers, data: '{}' }),
        request.delete(`${HOSTED}/api/files/${DEPLOYMENT_SETTINGS_BLOB}`, { headers }),
      ]) {
        const res = await attempt;
        expect(res.status()).toBe(403);
      }
    } finally {
      await resetDeploymentSettings();
    }
  });

  test('E371: settings saved from the Settings tab round-trip through GET /api/admin/settings, and a corrupted blob fails closed with the parse error', async ({
    page,
    request,
  }) => {
    const ada = await signIn(request, 'ada');
    const hiddenName = `E371 fail-closed w${test.info().workerIndex}`;
    const hiddenId = await createWorkspace(request, ada, hiddenName);
    try {
      // PRD 017 Req 20: restricted with everyone but mary allow-listed — the
      // E360 rule, so the parallel lane never trips over this test's policy.
      // Each pick snapshots the display name at add time (issue #180).
      await signInTo(page, 'katherine');
      await page.getByTestId('start-management').click();
      await expect(page.getByTestId('management-panel')).toBeVisible();
      await page.getByTestId('management-tab-settings').click();
      await page.getByTestId('admin-creation-restricted').check();
      const input = page.getByTestId('membership-picker-input');
      for (const [query, rid] of [
        ['lovelace', 'mock-ada'],
        ['hopper', 'mock-grace'],
        ['turing', 'mock-alan'],
      ] as const) {
        await input.fill(query);
        await page.getByTestId(`membership-picker-result-${rid}`).click();
      }
      await page.getByTestId('admin-settings-save').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();

      // Req 14/15: the tab PUT the whole record, and the route reads it
      // back per request — no reload, no cache.
      const katherine = await signIn(request, 'katherine');
      const stored = await (
        await request.get(`${HOSTED}/api/admin/settings`, { headers: { Authorization: `Bearer ${katherine}` } })
      ).json();
      expect(stored).toEqual({
        settings: {
          version: 1,
          creation: {
            policy: 'restricted',
            allow: [
              { id: 'mock-ada', displayName: 'Ada Lovelace' },
              { id: 'mock-grace', displayName: 'Grace Hopper' },
              { id: 'mock-alan', displayName: 'Alan Turing' },
            ],
          },
          listing: { policy: 'everyone' },
        },
      });

      // Req 7: a hand-corrupted blob surfaces as the visible parse error.
      // The slow reload happens BEFORE the corruption so the fail-closed
      // window the shared lane sees is just the requests and clicks below.
      await page.reload();
      const body = Buffer.from('{"version": 99}');
      await deploymentSettingsBlob().upload(body, body.length);

      // Req 7: while corrupt, the server BEHAVES as restricted + members —
      // asserted through mary only (the E360 shared-lane rule): creation is
      // refused naming deployment.create, and her listing omits the
      // workspace she holds nothing in. Regular users see effects, no 500.
      const mary = await signIn(request, 'mary');
      const refused = await request.post(`${HOSTED}/api/workspaces`, {
        headers: { Authorization: `Bearer ${mary}` },
        data: { name: 'E371 never created' },
      });
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toEqual({ error: 'forbidden', required: 'deployment.create' });
      const me = (await (
        await request.get(`${HOSTED}/api/me`, { headers: { Authorization: `Bearer ${mary}` } })
      ).json()) as { canCreateWorkspaces: boolean; createRefusal?: string };
      expect(me.canCreateWorkspaces).toBe(false);
      expect(me.createRefusal).toBe('restricted');
      const listedForMary = (await (
        await request.get(`${HOSTED}/api/workspaces`, { headers: { Authorization: `Bearer ${mary}` } })
      ).json()) as { id: string }[];
      expect(listedForMary.map((w) => w.id)).not.toContain(hiddenId);

      await page.getByTestId('start-management').click();
      await page.getByTestId('management-tab-settings').click();
      await expect(page.getByTestId('admin-settings-parse-error')).toBeVisible();
    } finally {
      await resetDeploymentSettings();
      const gone = await request.delete(`${HOSTED}/api/workspaces/${hiddenId}`, {
        headers: { Authorization: `Bearer ${ada}` },
      });
      expect(gone.status()).toBe(200);
    }
  });
});

/**
 * PRD 017 Reqs 13+16–19 (issue #189): the Management view. These stay in the
 * parallel lane — they write no deployment settings; each restores what it
 * created in a `finally`.
 */
test.describe('PRD 017 the Management view', () => {
  test('E367: a non-admin has no Management entry and every /api/admin route answers 403 deployment.admin', async ({
    page,
    request,
  }) => {
    // PRD 017 Req 14 (Req 2 shape): ada owns workspaces all over this suite,
    // and owning every workspace still opens no deployment-wide door.
    const ada = await signIn(request, 'ada');
    const headers = { Authorization: `Bearer ${ada}` };
    const me = (await (await request.get(`${HOSTED}/api/me`, { headers })).json()) as { admin: boolean };
    expect(me.admin).toBe(false);
    for (const attempt of [
      request.get(`${HOSTED}/api/admin/workspaces`, { headers }),
      request.get(`${HOSTED}/api/admin/users`, { headers }),
      request.get(`${HOSTED}/api/admin/settings`, { headers }),
      request.put(`${HOSTED}/api/admin/settings`, {
        headers,
        data: { version: 1, creation: { policy: 'everyone', allow: [] }, listing: { policy: 'everyone' } },
      }),
    ]) {
      const res = await attempt;
      expect(res.status()).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden', required: 'deployment.admin' });
    }
    // Req 13: no entry anywhere — start page or the menu.
    await signInTo(page, 'ada');
    await expect(page.getByTestId('start-openWorkspace')).toBeVisible();
    await expect(page.getByTestId('start-management')).toHaveCount(0);
    await openAppMenu(page);
    await expect(page.getByTestId('menu-open-workspace')).toBeVisible();
    await expect(page.getByTestId('menu-management')).toHaveCount(0);
  });

  test('E368: the admin’s Workspaces tab lists a workspace they are no member of — owners, member count, file count and size as created', async ({
    page,
    request,
  }) => {
    const ada = await signIn(request, 'ada');
    const name = `E368 stats w${test.info().workerIndex}`;
    const id = await sharedWorkspace(request, ada, name, [{ id: 'mock-grace', role: 'Editor' }]);
    try {
      expect(await writeAs(request, ada, id, 'one.md')).toBe(200);
      expect(await writeAs(request, ada, id, 'notes/two.md')).toBe(200);
      // Req 16: the route's row first — the same figures the tab must show.
      const katherine = await signIn(request, 'katherine');
      const rows = (await (
        await request.get(`${HOSTED}/api/admin/workspaces`, { headers: { Authorization: `Bearer ${katherine}` } })
      ).json()) as Array<{
        id: string;
        name: string | null;
        owners: Array<{ id: string }>;
        memberIds: string[];
        fileCount: number;
        totalBytes: number;
      }>;
      const row = rows.find((r) => r.id === id);
      expect(row).toMatchObject({ name, fileCount: 2, memberIds: ['mock-ada', 'mock-grace'] });
      expect(row?.owners).toEqual([expect.objectContaining({ id: 'mock-ada' })]);
      expect(row?.totalBytes ?? 0).toBeGreaterThan(0);

      await signInTo(page, 'katherine');
      await page.getByTestId('start-management').click();
      await expect(page.getByTestId('management-panel')).toBeVisible();
      await expect(page.getByTestId(`admin-workspace-row-${id}`)).toContainText(name);
      // Owner ids resolve to directory names through resolveMembers.
      await expect(page.getByTestId(`admin-workspace-owners-${id}`)).toContainText('Ada Lovelace');
      await expect(page.getByTestId(`admin-workspace-members-${id}`)).toHaveText('2');
      await expect(page.getByTestId(`admin-workspace-files-${id}`)).toHaveText('2');
      await expect(page.getByTestId(`admin-workspace-size-${id}`)).toHaveText(formatByteSize(row?.totalBytes ?? 0));
      await expect(page.getByTestId('admin-workspaces-totals')).toContainText('workspaces');
    } finally {
      const gone = await request.delete(`${HOSTED}/api/workspaces/${id}`, {
        headers: { Authorization: `Bearer ${ada}` },
      });
      expect(gone.status()).toBe(200);
    }
  });

  test('E369: the admin opens a non-member workspace — banner up, document readable, edits refused — until they add themselves as Owner', async ({
    page,
    request,
  }) => {
    const ada = await signIn(request, 'ada');
    const name = `E369 visit w${test.info().workerIndex}`;
    const id = await createWorkspace(request, ada, name);
    try {
      await request.put(`${HOSTED}/api/workspaces/${id}/files/guide.md`, {
        headers: { Authorization: `Bearer ${ada}` },
        data: '# The guide\n\nreadable by the implicit admin union\n',
      });
      const katherine = await signIn(request, 'katherine');
      // Req 4+17: reading is implicit; a content edit is the ordinary 403
      // naming the workspace verb — never implicit write for admins.
      const refusedSave = await request.put(`${HOSTED}/api/workspaces/${id}/files/guide.md`, {
        headers: { Authorization: `Bearer ${katherine}` },
        data: '# written\n',
      });
      expect(refusedSave.status()).toBe(403);
      expect(await refusedSave.json()).toEqual({ error: 'forbidden', required: 'doc.edit' });

      await signInTo(page, 'katherine');
      await page.getByTestId('start-management').click();
      // Req 17: Open binds exactly as the Open Workspace dialog does.
      await page.getByTestId(`admin-workspace-open-${id}`).click();
      // Req 5: the persistent banner states both facts while nothing in the
      // manifest grants her a role of her own.
      await expect(page.getByTestId('admin-view-banner')).toBeVisible();
      await openFromSidebar(page, 'guide');
      await expect(page.getByTestId('admin-view-banner')).toBeVisible();
      await expect(page.getByTestId('read-only-doc')).toBeVisible();

      // She adds herself as Owner in People (workspace.members is implicit)…
      await openWorkspaceSettings(page);
      const input = page.getByTestId('membership-picker-input');
      await input.fill('katherine');
      await page.getByTestId('membership-picker-result-mock-katherine').click();
      await page.getByTestId('workspace-member-role-mock-katherine').selectOption('Owner');
      await page.getByTestId('settings-close').click();
      // …and the banner ends with the dialog: she holds a role now (Req 5).
      await expect(page.getByTestId('admin-view-banner')).toHaveCount(0);
      // The grant is real — the same save answers 200 now.
      expect(await writeAs(request, katherine, id, 'guide.md')).toBe(200);
    } finally {
      const gone = await request.delete(`${HOSTED}/api/workspaces/${id}`, {
        headers: { Authorization: `Bearer ${ada}` },
      });
      expect(gone.status()).toBe(200);
    }
  });

  test('E370: the admin deletes a non-member workspace behind the exact-name gate, and every blob under its prefix is gone', async ({
    page,
    request,
  }) => {
    const ada = await signIn(request, 'ada');
    const name = `E370 doomed w${test.info().workerIndex}`;
    const id = await createWorkspace(request, ada, name);
    try {
      expect(await writeAs(request, ada, id, 'kept/one.md')).toBe(200);
      await signInTo(page, 'katherine');
      await page.getByTestId('start-management').click();
      await page.getByTestId(`admin-workspace-delete-${id}`).click();
      await expect(page.getByTestId('admin-delete-dialog')).toBeVisible();
      // Req 18: the same exact-name gate as WorkspaceDangerZone — the wrong
      // name keeps the destructive button inert.
      await page.getByTestId('admin-delete-confirm').fill('not the name');
      await expect(page.getByTestId('admin-delete-submit')).toBeDisabled();
      await page.getByTestId('admin-delete-confirm').fill(name);
      await page.getByTestId('admin-delete-submit').click();
      // The row leaves the tab on success…
      await expect(page.getByTestId(`admin-workspace-row-${id}`)).toHaveCount(0);
      // …and the storage itself holds nothing under the prefix any more.
      const container = BlobServiceClient.fromConnectionString(AZURITE_CONNECTION_STRING).getContainerClient(
        'marky-mark',
      );
      const remaining: string[] = [];
      for await (const blob of container.listBlobsFlat({ prefix: `workspaces/${id}/` })) {
        remaining.push(blob.name);
      }
      expect(remaining).toEqual([]);
    } finally {
      // Deleted by the test when it passed; a failing run still cleans up.
      const res = await request.delete(`${HOSTED}/api/workspaces/${id}`, {
        headers: { Authorization: `Bearer ${ada}` },
      });
      expect([200, 404]).toContain(res.status());
    }
  });

  test('E372: the People tab lists all five seeded users — Guest badge on mary, Admin badge on katherine, read-only', async ({
    page,
  }) => {
    // PRD 017 Req 19: the tenant through DirectoryProvider.listUsers — the
    // mock's seeded five, badged from the directory flag and MM_ADMINS.
    await signInTo(page, 'katherine');
    await page.getByTestId('start-management').click();
    await page.getByTestId('management-tab-people').click();
    for (const id of ['mock-ada', 'mock-grace', 'mock-alan', 'mock-katherine', 'mock-mary']) {
      await expect(page.getByTestId(`admin-user-row-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('admin-user-guest-mock-mary')).toHaveText('Guest');
    await expect(page.getByTestId('admin-user-admin-mock-katherine')).toHaveText('Admin');
    await expect(page.getByTestId('admin-user-guest-mock-ada')).toHaveCount(0);
    await expect(page.getByTestId('admin-user-admin-mock-ada')).toHaveCount(0);
  });
});

// PRD 017 §Invitations (issue #190): in-app guest invitations over the mock
// directory — the whole Req 29–33 flow offline. The mock's invitation list is
// in-memory on the ONE shared server, so every test uses a worker-unique
// address and withdraws it in a `finally` (the app.ts test hook), keeping the
// directory seeded-only for every other test.
test.describe('PRD 017 in-app guest invitations', () => {
  test('E375: Management → People invites by email — the row appends with Guest and Pending badges', async ({
    page,
    request,
  }) => {
    // Req 31: the Invite… form calls Req 29 without a workspace grant.
    const email = `e375-w${test.info().workerIndex}@example.com`;
    const id = mockInvitationId(email);
    const katherine = await signIn(request, 'katherine');
    try {
      await signInTo(page, 'katherine');
      await page.getByTestId('start-management').click();
      await page.getByTestId('management-tab-people').click();
      await page.getByTestId('admin-invite-open').click();
      await page.getByTestId('admin-invite-email').fill(email);
      await page.getByTestId('admin-invite-note').fill('Welcome to the tenant!');
      await page.getByTestId('admin-invite-send').click();
      // Success appends the user row; the badges ride the directory flags.
      const row = page.getByTestId(`admin-user-row-${id}`);
      await expect(row).toBeVisible();
      await expect(page.getByTestId(`admin-user-guest-${id}`)).toHaveText('Guest');
      await expect(page.getByTestId(`admin-user-pending-${id}`)).toHaveText('Pending');
      // The form closed on success — no lingering error, ready for the next.
      await expect(page.getByTestId('admin-invite-form')).toHaveCount(0);
    } finally {
      await request.delete(`${HOSTED}/api/directory/invitations/${id}`, {
        headers: { Authorization: `Bearer ${katherine}` },
      });
    }
  });

  test('E376: the workspace picker invites an unmatched email at a chosen role — member row lands Pending, manifest carries the grant', async ({
    page,
    request,
  }) => {
    // Req 30+32: the admin-only empty-state row sends Req 29 WITH workspace.
    const email = `e376-w${test.info().workerIndex}@example.com`;
    const id = mockInvitationId(email);
    const katherine = await signIn(request, 'katherine');
    const headers = { Authorization: `Bearer ${katherine}` };
    const workspaceId = await createWorkspace(request, katherine, `E376 w${test.info().workerIndex}`);
    try {
      await signInTo(page, 'katherine', workspaceId);
      await openWorkspaceSettings(page);
      await page.getByTestId('membership-picker-input').fill(email);
      // The settled empty answer offers exactly one action: the invite row.
      await expect(page.getByTestId('membership-picker-empty')).toContainText('No people match');
      const inviteButton = page.getByTestId('membership-picker-invite');
      await expect(inviteButton).toHaveText(`Invite ${email} as`);
      await page.getByTestId('membership-picker-invite-role').selectOption('Editor');
      await inviteButton.click();
      // The member row appears at the chosen role, badged Pending until
      // acceptance (the #180 snapshot: the email is the display name).
      await expect(page.getByTestId(`workspace-member-role-${id}`)).toHaveValue('Editor');
      await expect(page.getByTestId(`workspace-member-pending-${id}`)).toHaveText('Pending');
      // Req 30 server-side: the grant landed in the manifest IN THE SAME
      // REQUEST — read it back as stored, not as the client mirrored it.
      const { manifest } = (await (
        await request.get(`${HOSTED}/api/workspaces/${workspaceId}/manifest`, { headers })
      ).json()) as { manifest: { members: { id: string; role: string; displayName?: string }[] } };
      expect(manifest.members).toContainEqual({ id, role: 'Editor', displayName: email });
    } finally {
      await request.delete(`${HOSTED}/api/directory/invitations/${id}`, { headers });
    }
  });

  test('E377: the Pending badge clears once the invitation is accepted — the guest stays a member', async ({
    page,
    request,
  }) => {
    // Req 33: externalUserState leaving PendingAcceptance (the mock's accept
    // hook) is exactly what un-badges both surfaces.
    const email = `e377-w${test.info().workerIndex}@example.com`;
    const id = mockInvitationId(email);
    const katherine = await signIn(request, 'katherine');
    const headers = { Authorization: `Bearer ${katherine}` };
    const workspaceId = await createWorkspace(request, katherine, `E377 w${test.info().workerIndex}`);
    try {
      const invited = await request.post(`${HOSTED}/api/admin/invitations`, {
        headers,
        data: { email, workspace: { id: workspaceId, role: 'Viewer' } },
      });
      expect(invited.status()).toBe(201);
      expect(await invited.json()).toEqual({ id, email, displayName: email, pending: true });

      await signInTo(page, 'katherine', workspaceId);
      await openWorkspaceSettings(page);
      await expect(page.getByTestId(`workspace-member-pending-${id}`)).toHaveText('Pending');

      const accepted = await request.post(`${HOSTED}/api/directory/invitations/${id}/accept`, { headers });
      expect(accepted.status()).toBe(200);
      // Resolution happens on mount, so a fresh visit shows the change: the
      // badge is gone while the membership (and the Guest badge) remain. The
      // session rides localStorage, so the reload lands signed-in.
      await page.reload();
      await openWorkspaceSettings(page);
      await expect(page.getByTestId(`workspace-member-role-${id}`)).toHaveValue('Viewer');
      await expect(page.getByTestId(`workspace-member-guest-${id}`)).toHaveText('Guest');
      await expect(page.getByTestId(`workspace-member-pending-${id}`)).toHaveCount(0);
    } finally {
      await request.delete(`${HOSTED}/api/directory/invitations/${id}`, { headers });
    }
  });

  test('E378: a non-admin gets no invite row in the picker and 403 deployment.admin from the route', async ({
    page,
    request,
  }) => {
    // Req 29 (Req 2 shape) + Req 32: the row is admin-gated by the pure
    // predicate, and the route refuses everyone else by name.
    const ada = await signIn(request, 'ada');
    const refused = await request.post(`${HOSTED}/api/admin/invitations`, {
      headers: { Authorization: `Bearer ${ada}` },
      data: { email: `e378-w${test.info().workerIndex}@example.com` },
    });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual({ error: 'forbidden', required: 'deployment.admin' });

    const workspaceId = await createWorkspace(request, ada, `E378 w${test.info().workerIndex}`);
    await signInTo(page, 'ada', workspaceId);
    await openWorkspaceSettings(page);
    await page.getByTestId('membership-picker-input').fill(`e378-w${test.info().workerIndex}@example.com`);
    // The empty state settles WITHOUT its admin-only action.
    await expect(page.getByTestId('membership-picker-empty')).toContainText('No people match');
    await expect(page.getByTestId('membership-picker-invite-row')).toHaveCount(0);
  });

  test("E379: a directory refusal surfaces Graph's own message inline — never a silent success", async ({
    page,
    request,
  }) => {
    // Req 29's 502 lane, drivable offline: the mock refuses an address it
    // already knows with Graph's invitedUserAlreadyExists shape.
    const email = `e379-w${test.info().workerIndex}@example.com`;
    const id = mockInvitationId(email);
    const katherine = await signIn(request, 'katherine');
    const headers = { Authorization: `Bearer ${katherine}` };
    try {
      const first = await request.post(`${HOSTED}/api/admin/invitations`, { headers, data: { email } });
      expect(first.status()).toBe(201);

      await signInTo(page, 'katherine');
      await page.getByTestId('start-management').click();
      await page.getByTestId('management-tab-people').click();
      await page.getByTestId('admin-invite-open').click();
      await page.getByTestId('admin-invite-email').fill(email);
      await page.getByTestId('admin-invite-send').click();
      await expect(page.getByTestId('admin-invite-error')).toHaveText(
        `A user with the address ${email} already exists in the directory.`,
      );
      // The refusal appended nothing beyond the API-driven invite itself.
      await expect(page.getByTestId(`admin-user-row-${id}`)).toHaveCount(1);
    } finally {
      await request.delete(`${HOSTED}/api/directory/invitations/${id}`, { headers });
    }
  });

  test('E380: the invite actions all carry the shared primary accent styling — their neighbors stay secondary', async ({
    page,
    request,
  }) => {
    // Issue #192: one shared `button.primary` rule paints all three invite
    // surfaces accent-blue, theme-variable driven; the controls beside them
    // stay non-primary so the action hierarchy still reads.
    const email = `e380-w${test.info().workerIndex}@example.com`;
    const katherine = await signIn(request, 'katherine');
    const workspaceId = await createWorkspace(request, katherine, `E380 w${test.info().workerIndex}`);

    // Resolve the theme accent where the target sits: a probe button beside
    // it inherits the same `--mm-accent`, so the comparison survives theme
    // changes instead of hard-coding one theme's blue.
    const paint = (testId: string) =>
      page.evaluate((id) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (!el || !el.parentElement) throw new Error(`missing [data-testid="${id}"]`);
        const probe = document.createElement('button');
        probe.style.backgroundColor = 'var(--mm-accent, #0969da)';
        el.parentElement.appendChild(probe);
        const accent = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { accent, background: getComputedStyle(el).backgroundColor };
      }, testId);

    await signInTo(page, 'katherine');
    await page.getByTestId('start-management').click();
    await page.getByTestId('management-tab-people').click();
    await expect(page.getByTestId('admin-invite-open')).toBeVisible();
    const inviteOpen = await paint('admin-invite-open');
    expect(inviteOpen.background).toBe(inviteOpen.accent);
    await page.getByTestId('admin-invite-open').click();
    await expect(page.getByTestId('admin-invite-send')).toBeVisible();
    const inviteSend = await paint('admin-invite-send');
    expect(inviteSend.background).toBe(inviteSend.accent);
    // The filter field beside Invite… stays a plain input.
    const filter = await paint('admin-users-filter');
    expect(filter.background).not.toBe(filter.accent);

    // Second surface, fresh load: drop the stored session first so the
    // sign-in form is there for signInTo to drive.
    await signOut(page);
    await signInTo(page, 'katherine', workspaceId);
    await openWorkspaceSettings(page);
    await page.getByTestId('membership-picker-input').fill(email);
    await expect(page.getByTestId('membership-picker-invite')).toBeVisible();
    const offer = await paint('membership-picker-invite');
    expect(offer.background).toBe(offer.accent);
    // The role select riding the same row stays secondary.
    const role = await paint('membership-picker-invite-role');
    expect(role.background).not.toBe(role.accent);
  });

  test('E381: Management → People rescinds a pending invitation behind the email-naming confirm — the row disappears; non-pending rows never offer it', async ({
    page,
    request,
  }) => {
    // Issue #193: the destructive Rescind action, Pending rows only.
    const email = `e381-w${test.info().workerIndex}@example.com`;
    const id = mockInvitationId(email);
    const katherine = await signIn(request, 'katherine');
    const headers = { Authorization: `Bearer ${katherine}` };
    try {
      const invited = await request.post(`${HOSTED}/api/admin/invitations`, { headers, data: { email } });
      expect(invited.status()).toBe(201);

      await signInTo(page, 'katherine');
      await page.getByTestId('start-management').click();
      await page.getByTestId('management-tab-people').click();
      await expect(page.getByTestId(`admin-user-pending-${id}`)).toHaveText('Pending');
      // Only the Pending row offers the action: mary is a seeded accepted
      // guest and ada a member — neither ever shows Rescind.
      await expect(page.getByTestId(`admin-user-guest-mock-mary`)).toHaveText('Guest');
      await expect(page.getByTestId('admin-rescind-mock-mary')).toHaveCount(0);
      await expect(page.getByTestId('admin-rescind-mock-ada')).toHaveCount(0);

      // The confirm step names the guest's email; Cancel changes nothing.
      await page.getByTestId(`admin-rescind-${id}`).click();
      await expect(page.getByTestId('admin-rescind-message')).toContainText(email);
      await page.getByTestId('admin-rescind-cancel').click();
      await expect(page.getByTestId('admin-rescind-dialog')).toHaveCount(0);
      await expect(page.getByTestId(`admin-user-row-${id}`)).toBeVisible();

      // Confirming deletes the guest: the row disappears, and the server
      // agrees — the tenant listing no longer carries the id.
      await page.getByTestId(`admin-rescind-${id}`).click();
      await page.getByTestId('admin-rescind-confirm').click();
      await expect(page.getByTestId(`admin-user-row-${id}`)).toHaveCount(0);
      const users = (await (await request.get(`${HOSTED}/api/admin/users`, { headers })).json()) as {
        id: string;
      }[];
      expect(users.some((u) => u.id === id)).toBe(false);
    } finally {
      await request.delete(`${HOSTED}/api/directory/invitations/${id}`, { headers });
    }
  });

  test('E382: rescinding scrubs the id from every workspace manifest — the role-at-invite grant and a later add both go', async ({
    request,
  }) => {
    // Issue #193: the same-operation membership cleanup, across manifests.
    const email = `e382-w${test.info().workerIndex}@example.com`;
    const id = mockInvitationId(email);
    const katherine = await signIn(request, 'katherine');
    const headers = { Authorization: `Bearer ${katherine}` };
    const wsA = await createWorkspace(request, katherine, `E382a w${test.info().workerIndex}`);
    const wsB = await createWorkspace(request, katherine, `E382b w${test.info().workerIndex}`);
    try {
      // One membership from the Req 30 role-at-invite grant, one added after.
      const invited = await request.post(`${HOSTED}/api/admin/invitations`, {
        headers,
        data: { email, workspace: { id: wsA, role: 'Editor' } },
      });
      expect(invited.status()).toBe(201);
      const added = await request.post(`${HOSTED}/api/workspaces/${wsB}/members`, {
        headers,
        data: { id, role: 'Viewer' },
      });
      expect(added.ok()).toBe(true);

      const rescinded = await request.delete(`${HOSTED}/api/admin/invitations/${id}`, { headers });
      expect(rescinded.status()).toBe(200);
      expect(await rescinded.json()).toEqual({ id });

      // Both manifests read back as stored, with no dangling member row.
      for (const workspaceId of [wsA, wsB]) {
        const { manifest } = (await (
          await request.get(`${HOSTED}/api/workspaces/${workspaceId}/manifest`, { headers })
        ).json()) as { manifest: { members: { id: string }[] } };
        expect(manifest.members.some((m) => m.id === id)).toBe(false);
      }
    } finally {
      await request.delete(`${HOSTED}/api/directory/invitations/${id}`, { headers });
    }
  });

  test('E383: a non-admin gets 403 deployment.admin from the rescind route — the pending guest survives', async ({
    request,
  }) => {
    // Issue #193 (Req 2 shape): the one gate for the whole admin surface.
    const email = `e383-w${test.info().workerIndex}@example.com`;
    const id = mockInvitationId(email);
    const katherine = await signIn(request, 'katherine');
    const headers = { Authorization: `Bearer ${katherine}` };
    try {
      expect((await request.post(`${HOSTED}/api/admin/invitations`, { headers, data: { email } })).status()).toBe(201);
      const ada = await signIn(request, 'ada');
      const refused = await request.delete(`${HOSTED}/api/admin/invitations/${id}`, {
        headers: { Authorization: `Bearer ${ada}` },
      });
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toEqual({ error: 'forbidden', required: 'deployment.admin' });
      const users = (await (await request.get(`${HOSTED}/api/admin/users`, { headers })).json()) as {
        id: string;
      }[];
      expect(users.some((u) => u.id === id)).toBe(true);
    } finally {
      await request.delete(`${HOSTED}/api/directory/invitations/${id}`, { headers });
    }
  });

  test('E384: an accepted guest cannot be rescinded — 409 naming why, and their People row offers no Rescind', async ({
    page,
    request,
  }) => {
    // Issue #193: acceptance ends rescindability — removal moves to Entra.
    const email = `e384-w${test.info().workerIndex}@example.com`;
    const id = mockInvitationId(email);
    const katherine = await signIn(request, 'katherine');
    const headers = { Authorization: `Bearer ${katherine}` };
    try {
      expect((await request.post(`${HOSTED}/api/admin/invitations`, { headers, data: { email } })).status()).toBe(201);
      expect((await request.post(`${HOSTED}/api/directory/invitations/${id}/accept`, { headers })).status()).toBe(200);

      const refused = await request.delete(`${HOSTED}/api/admin/invitations/${id}`, { headers });
      expect(refused.status()).toBe(409);
      const { error } = (await refused.json()) as { error: string };
      expect(error).toContain('already accepted');

      // The guest is still in the tenant, badged Guest but no longer
      // Pending — so the row never offers the destructive action.
      await signInTo(page, 'katherine');
      await page.getByTestId('start-management').click();
      await page.getByTestId('management-tab-people').click();
      await expect(page.getByTestId(`admin-user-guest-${id}`)).toHaveText('Guest');
      await expect(page.getByTestId(`admin-user-pending-${id}`)).toHaveCount(0);
      await expect(page.getByTestId(`admin-rescind-${id}`)).toHaveCount(0);
    } finally {
      await request.delete(`${HOSTED}/api/directory/invitations/${id}`, { headers });
    }
  });
});
