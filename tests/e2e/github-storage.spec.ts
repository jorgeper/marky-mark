import type { APIRequestContext, Page } from '@playwright/test';
import {
  LANE_APP_SLUG,
  LANE_BYO_REPO,
  LANE_INSTALLATION_ID,
  LANE_SEEDED_DOC,
  LANE_SEEDED_TEXT,
  LANE_SERVER_PORT,
  laneRoot,
} from '../../server/e2eGithubLane.ts';
import { expect, test } from './fixtures';
import { menuSave, revealToolbar } from './helpers';

// PRD 010 Req 22: the GitHub-backed half of the hosted e2e matrix — the
// storage-choice flow, the connect-your-repo wizard and concurrent saves,
// against a server on the github backend. The lane is booted by the third
// `webServer` entry in playwright.config.ts (`npm run server:github`: the
// local GitHub API fake on loopback, an App keypair made at boot, the server
// pointed at the fake), so every "GitHub" call here — installations, contents,
// commits — is answered from memory in the lane's own process. No credential,
// no GitHub host anywhere (U477 fails the unit suite if one appears here) and
// no manual step: a clean checkout runs this.
const GITHUB = `http://localhost:${LANE_SERVER_PORT}`;

/** The repo the wizard connects, as the pick-repo step names it. */
const BYO_FULL_NAME = `${LANE_BYO_REPO.owner}/${LANE_BYO_REPO.repo}`;

// Each test here drives the app as a DIFFERENT seeded user. On this backend a
// per-user file (`users/<id>/foldertree.json`) is a commit on one branch, and
// PRD 010 Req 11 bounds an unconditional write's retry at one — so two
// workers running as the same user would race for real. Distinct users make
// the lane's parallelism a property of the tests, not of that bound.
const PAGE_USER = { choice: 'ada', wizard: 'grace', restart: 'alan', merge: 'katherine', conflict: 'ada' };

/** Sign in as a seeded mock user and return the bearer token. */
async function signIn(request: APIRequestContext, username: string): Promise<string> {
  const res = await request.post(`${GITHUB}/api/auth/sign-in`, { data: { username } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

/** Sign in through the UI, optionally bound to a workspace. */
async function signInTo(page: Page, username: string, workspace?: string): Promise<void> {
  await page.goto(`${GITHUB}/${workspace ? `?workspace=${workspace}` : ''}`);
  await page.getByTestId('hosted-sign-in-username').fill(username);
  await page.getByTestId('hosted-sign-in-submit').click();
}

/** Open the New Workspace dialog from the in-app menu (PRD 009 Req 11). */
async function openNewWorkspace(page: Page): Promise<void> {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await expect(page.getByTestId('app-menu')).toBeVisible();
  await page.getByTestId('menu-new-workspace').click();
  await expect(page.getByTestId('new-workspace-dialog')).toBeVisible();
}

/**
 * Fill the workspace name, pick the GitHub storage choice and leave for the
 * consent page. Answers the wizard session GitHub would echo back — read off
 * the install URL the app navigated to, exactly as GitHub reads it.
 */
async function leaveForGitHub(page: Page, name: string): Promise<string> {
  await page.getByTestId('new-workspace-name').fill(name);
  await page.getByTestId('new-workspace-storage-github').click();
  await page.getByTestId('new-workspace-connect').click();
  // PRD 010 Req 16: the install URL is the deployment's App, on the web host
  // the lane points at its fake — a full navigation out of the app.
  await expect(page).toHaveURL(new RegExp(`/apps/${LANE_APP_SLUG}/installations/new\\?state=`));
  return new URL(page.url()).searchParams.get('state')!;
}

/** Come back the way GitHub does: the app's own URL, plus its parameters. */
async function returnFromGitHub(page: Page, session: string, installationId = LANE_INSTALLATION_ID): Promise<void> {
  await page.goto(`${GITHUB}/?installation_id=${installationId}&state=${encodeURIComponent(session)}&setup_action=install`);
}

/** A BYO workspace created straight through the API, at `root` in the repo. */
async function connectedWorkspace(
  request: APIRequestContext,
  token: string,
  name: string,
  root: string,
  members: Array<{ id: string; role: string }> = [],
): Promise<string> {
  const res = await request.post(`${GITHUB}/api/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name,
      members,
      storage: { kind: 'repo', owner: LANE_BYO_REPO.owner, repo: LANE_BYO_REPO.repo, branch: 'main', root },
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Open a document from the workspace's folder sidebar. */
async function openFromSidebar(page: Page, name: string): Promise<void> {
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.getByTestId('folder-item').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('docname')).toContainText(name);
}

/** The stored text of a workspace file, as the API reports it. */
async function storedText(request: APIRequestContext, token: string, id: string, path: string): Promise<string> {
  const res = await request.get(`${GITHUB}/api/workspaces/${id}/files/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { content: string }).content;
}

/** Append `text` to the open document's FIRST line, in edit mode. */
async function editFirstLine(page: Page, text: string): Promise<void> {
  if ((await page.getByTestId('editor').count()) === 0) await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
}

const BASE_DOC = '# Shared\n\nline one\nline two\nline three\n';

test('E221: the New Workspace dialog offers both storage choices, and connecting a repo leaves for the App’s install page', async ({
  page,
}) => {
  // PRD 010 Req 15: the storage choice is offered where the deployment can
  // actually connect a repo — this lane has an App configured, so the GitHub
  // choice is live rather than showing its unavailable reason.
  await signInTo(page, PAGE_USER.choice);
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openNewWorkspace(page);

  await expect(page.getByTestId('new-workspace-storage')).toBeVisible();
  await expect(page.getByTestId('new-workspace-storage-default')).toBeChecked();
  await expect(page.getByTestId('new-workspace-storage-github')).toBeEnabled();
  await expect(page.getByTestId('new-workspace-storage-unavailable')).toHaveCount(0);

  await page.getByTestId('new-workspace-storage-github').click();
  await expect(page.getByTestId('new-workspace-storage-github')).toBeChecked();
  await expect(page.getByTestId('new-workspace-storage-default')).not.toBeChecked();

  // PRD 010 Req 16: picking it and continuing leaves for the consent page,
  // carrying the state this browser's saved progress is matched against.
  const session = await leaveForGitHub(page, `E221 w${test.info().workerIndex}`);
  expect(session).not.toBe('');
});

test('E222: the connect-your-repo wizard runs end to end and lands in a workspace reading the repo branch', async ({
  page,
  request,
}) => {
  // PRD 010 Req 16+17: install → pick repo → branch + subdirectory → confirm,
  // then a created workspace whose documents are the repo's own files at the
  // connected root — a file committed before the app ever saw the repo.
  const worker = test.info().workerIndex;
  const root = laneRoot('happy', worker);
  const name = `E222 connected w${worker}`;
  await signInTo(page, PAGE_USER.wizard);
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openNewWorkspace(page);
  const session = await leaveForGitHub(page, name);

  // The return leg: the app resumes at pick-repo with the installation it
  // came back with, and the workspace fields it left with are still filled in.
  await returnFromGitHub(page, session);
  await expect(page.getByTestId('new-workspace-dialog')).toBeVisible();
  await expect(page.getByTestId('new-workspace-name')).toHaveValue(name);
  await expect(page.getByTestId('github-wizard')).toHaveAttribute('data-step', 'repo');
  await page.getByTestId(`github-wizard-repo-${BYO_FULL_NAME}`).click();

  // The branch step preselects the repo's own default branch; the
  // subdirectory is this worker's own, so parallel workers never share a root.
  await expect(page.getByTestId('github-wizard-branch')).toHaveValue('main');
  await page.getByTestId('github-wizard-root').fill(root);
  await page.getByTestId('github-wizard-next').click();

  await expect(page.getByTestId('github-wizard-summary-repo')).toHaveText(BYO_FULL_NAME);
  await expect(page.getByTestId('github-wizard-summary-branch')).toHaveText('main');
  await expect(page.getByTestId('github-wizard-summary-root')).toContainText(root);
  await page.getByTestId('github-wizard-create').click();

  // Created and opened, exactly as a default-storage create is.
  await expect(page).toHaveURL(/\?workspace=/);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('docname-workspace')).toHaveText(name);

  // The workspace IS the repo subdirectory: the seeded document lists, opens
  // and reads back with the bytes that were committed to the branch…
  await openFromSidebar(page, LANE_SEEDED_DOC);
  await expect(page.getByTestId('doc')).toContainText('committed to the repo before the app ever saw it');
  const id = new URL(page.url()).searchParams.get('workspace')!;
  const owner = await signIn(request, PAGE_USER.wizard);
  expect(await storedText(request, owner, id, LANE_SEEDED_DOC)).toBe(LANE_SEEDED_TEXT);
  // …and nothing outside the connected root leaks in as a workspace document.
  const list = await request.get(`${GITHUB}/api/workspaces/${id}/files`, {
    headers: { Authorization: `Bearer ${owner}` },
  });
  const paths = ((await list.json()) as { path: string }[]).map((f) => f.path);
  expect(paths).toContain(LANE_SEEDED_DOC);
  expect(paths).not.toContain('README.md');
});

test('E223: an abandoned round trip is offered back, and a return this browser cannot match restarts by name', async ({
  page,
}) => {
  // PRD 010 Req 16: re-entering the flow is never a stuck step and never a raw
  // status code — the two named outcomes, both from saved state alone.
  const name = `E223 abandoned w${test.info().workerIndex}`;
  await signInTo(page, PAGE_USER.restart);
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openNewWorkspace(page);
  await leaveForGitHub(page, name);

  // Abandoned: back in the app with no return parameters at all, the saved
  // progress is offered — continue where it stopped, or start over.
  await page.goto(`${GITHUB}/`);
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openNewWorkspace(page);
  await expect(page.getByTestId('new-workspace-resume')).toBeVisible();
  await expect(page.getByTestId('new-workspace-storage-github')).toBeChecked();
  await page.getByTestId('new-workspace-resume-restart').click();
  await expect(page.getByTestId('new-workspace-resume')).toHaveCount(0);
  await expect(page.getByTestId('new-workspace-storage-default')).toBeChecked();

  // Unmatched: a return whose state is not the one this browser started is a
  // restart with a sentence saying why, and the dialog is usable again.
  await returnFromGitHub(page, 'a-session-this-browser-never-started');
  await expect(page.getByTestId('new-workspace-dialog')).toBeVisible();
  await expect(page.getByTestId('new-workspace-notice')).toContainText('Start again');
  await expect(page.getByTestId('github-wizard')).toHaveCount(0);
  await expect(page.getByTestId('new-workspace-storage-default')).toBeChecked();
});

test('E224: a concurrent save that does not overlap is merged into the repo — merged notice, merged text, clean buffer', async ({
  page,
  request,
}) => {
  // PRD 010 Req 12+13: the git-backed workspace's stale conditional save gets
  // one chance to become a merge commit before it becomes a 412, and the
  // merged bytes are what the editor then holds — saved, with no dialog.
  const worker = test.info().workerIndex;
  const mine = await signIn(request, PAGE_USER.merge);
  const other = await signIn(request, 'ada');
  const id = await connectedWorkspace(request, mine, `E224 w${worker}`, laneRoot('merge', worker), [
    { id: 'mock-ada', role: 'Editor' },
  ]);
  const file = `${GITHUB}/api/workspaces/${id}/files/shared.md`;
  expect(
    (await request.put(file, { headers: { Authorization: `Bearer ${mine}` }, data: BASE_DOC })).status(),
  ).toBe(200);

  await signInTo(page, PAGE_USER.merge, id);
  await openFromSidebar(page, 'shared.md');
  await editFirstLine(page, ' — katherine edited the heading');

  // The other member commits to the SAME branch, at the other end of the
  // document — a second writer this session knows nothing about.
  expect(
    (
      await request.put(file, {
        headers: { Authorization: `Bearer ${other}` },
        data: `${BASE_DOC}ada appended a line\n`,
      })
    ).status(),
  ).toBe(200);

  // Ada's save is stale, merges, and says so without asking anything.
  await menuSave(page);
  await expect(page.getByTestId('notice')).toContainText('merged');
  await expect(page.getByTestId('save-conflict-prompt')).toHaveCount(0);
  const surface = page.locator('[data-testid="editor"], [data-testid="doc"]').first();
  await expect(surface).toContainText('katherine edited the heading');
  await expect(surface).toContainText('ada appended a line');
  // The buffer is SAVED at the merged bytes — not dirty, not re-armed.
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  const stored = await storedText(request, mine, id, 'shared.md');
  expect(stored).toContain('katherine edited the heading');
  expect(stored).toContain('ada appended a line');
});

test('E225: a concurrent save that overlaps still fails 412 and shows the unchanged conflict prompt', async ({
  page,
  request,
}) => {
  // PRD 010 Req 12: a merge is offered only where the changes do not collide.
  // An overlapping one keeps PRD 007 Req 20's behaviour byte for byte — the
  // save-conflict prompt with its three answers.
  const worker = test.info().workerIndex;
  const ada = await signIn(request, 'ada');
  const grace = await signIn(request, 'grace');
  const id = await connectedWorkspace(request, ada, `E225 w${worker}`, laneRoot('conflict', worker), [
    { id: 'mock-grace', role: 'Editor' },
  ]);
  const file = `${GITHUB}/api/workspaces/${id}/files/shared.md`;
  expect(
    (await request.put(file, { headers: { Authorization: `Bearer ${ada}` }, data: BASE_DOC })).status(),
  ).toBe(200);

  await signInTo(page, PAGE_USER.conflict, id);
  await openFromSidebar(page, 'shared.md');
  await editFirstLine(page, ' — ada rewrote the heading');

  // Grace changes the very line Ada is editing.
  const graceDoc = BASE_DOC.replace('# Shared', '# Shared, by grace');
  expect(
    (await request.put(file, { headers: { Authorization: `Bearer ${grace}` }, data: graceDoc })).status(),
  ).toBe(200);

  await menuSave(page);
  await expect(page.getByTestId('save-conflict-prompt')).toBeVisible();
  for (const choice of ['save-conflict-cancel', 'save-conflict-overwrite', 'save-conflict-reload']) {
    await expect(page.getByTestId(choice)).toBeVisible();
  }
  await expect(page.getByTestId('notice')).toHaveCount(0);

  // Cancel leaves the buffer dirty and the repo holding Grace's commit.
  await page.getByTestId('save-conflict-cancel').click();
  await expect(page.getByTestId('save-conflict-prompt')).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  expect(await storedText(request, ada, id, 'shared.md')).toBe(graceDoc);
});
