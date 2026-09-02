// PRD 018 Reqs 30–32 (issue #206): computed-style verification that the
// chrome primitives are one system — representative controls from different
// surfaces agree via getComputedStyle, under a light and a dark bundled
// theme, and a chrome-token override actually moves a primitive. Computed
// styles rather than screenshots: the assertions name the exact properties
// the primitives own (border-radius, font-family, font-size, padding, and
// the token-derived colours), so a drift fails with the property spelled
// out instead of a pixel diff.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { dirtyActiveDoc, freshApp, openSettings, openWelcomeViaHelp, revealToolbar } from './helpers';

// PRD 007 Req 4: the hosted backend in local dev mode (see hosted.spec.ts)
// — E394/E395 sample the pre-auth sign-in page and a workspace settings
// surface, which only exist on this flavor.
const HOSTED = 'http://localhost:4924';

/** Sign in as a seeded mock user via the API (hosted.spec.ts's signIn, local
 * to that file too) and return the Authorization header the roaming and
 * workspace endpoints want. */
async function hostedAuthHeaders(page: Page, username: string): Promise<{ Authorization: string }> {
  const auth = await page.request.post(`${HOSTED}/api/auth/sign-in`, { data: { username } });
  expect(auth.status()).toBe(200);
  return { Authorization: `Bearer ${((await auth.json()) as { token: string }).token}` };
}

/** Delete one of the user's roaming files, tolerating its absence. A
 * leftover draft.json would trap the boot under the restore overlay (see
 * hosted.spec.ts's signInTo), so every UI entry here starts draft-free. */
async function dropRoamingFile(page: Page, headers: { Authorization: string }, file: string): Promise<void> {
  const dropped = await page.request.delete(`${HOSTED}/api/me/files/${file}`, { headers });
  expect([200, 404]).toContain(dropped.status());
}

/** The computed properties PRD 018 Req 30 makes the agreement contract. */
type ChromeSample = {
  radius: string;
  family: string;
  size: string;
  padding: string;
  bg: string;
};

function sampleControl(control: Locator): Promise<ChromeSample> {
  return control.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      radius: s.borderRadius,
      family: s.fontFamily,
      size: s.fontSize,
      padding: s.padding,
      bg: s.backgroundColor,
    };
  });
}

/**
 * Resolve a token to the browser-normalized rgb() color it computes to
 * under `rootSelector` — via a probe element painted with the token, not
 * raw getPropertyValue text, so color-mix() and hex forms compare equal.
 */
function resolvedColor(page: Page, rootSelector: string, token: string): Promise<string> {
  return page.evaluate(
    ([sel, name]) => {
      const root = document.querySelector(sel);
      if (!root) throw new Error(`no ${sel} to resolve ${name} against`);
      const probe = document.createElement('span');
      probe.style.backgroundColor = `var(${name})`;
      root.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    },
    [rootSelector, token] as const,
  );
}

/** PRD 018 Req 30: two controls sharing a primitive variant agree on the
 * four properties the primitive owns. */
function expectSameGeometry(pair: string, a: ChromeSample, b: ChromeSample): void {
  expect(b.radius, `${pair}: border-radius`).toBe(a.radius);
  expect(b.family, `${pair}: font-family`).toBe(a.family);
  expect(b.size, `${pair}: font-size`).toBe(a.size);
  expect(b.padding, `${pair}: padding`).toBe(a.padding);
}

/**
 * The one assertion set E392 and E393 both run (PRD 018 Reqs 30–31), from
 * the state freshApp leaves (welcome open in preview, active theme already
 * applied): toolbar icon buttons agree with each other, the Settings
 * primary with a dialog's primary action, and the splash's neutral action
 * — reached via a reload, which always lands on the splash (issue #81) —
 * with a dialog's neutral action; the neutral background is the theme's
 * own --mm-bg-elevated.
 */
async function assertChromeAgreement(page: Page, expectedElevated: string): Promise<void> {
  // Toolbar icon buttons (.icon-btn): the tab strip's mode switch and the
  // TOC pane header's collapse chevron are one primitive.
  const modeSwitch = await sampleControl(page.getByTestId('mode-switch'));
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  const tocCollapse = await sampleControl(page.getByTestId('toc-collapse'));
  expectSameGeometry('icon-btn: mode-switch vs toc-collapse', modeSwitch, tocCollapse);
  await page.getByTestId('toc-collapse').click();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);

  // The Settings panel's primary Close.
  await openSettings(page);
  const settingsPrimary = await sampleControl(page.getByTestId('settings-close'));
  await page.getByTestId('settings-close').click();

  // The splash's neutral action, reached the way a user reaches it — a
  // relaunch always lands on the splash — sampled before the dialog step
  // below dirties the document.
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  const splash = await sampleControl(page.getByTestId('start-openFile'));

  // PRD 018 Req 30: the neutral variant's background IS the theme's
  // elevated surface — resolved from the live theme root, and pinned to the
  // bundled theme's value so a theme that silently failed to apply cannot
  // pass this vacuously.
  const elevated = await resolvedColor(page, '.theme-root', '--mm-bg-elevated');
  expect(elevated, 'the bundled theme drives --mm-bg-elevated').toBe(expectedElevated);
  expect(splash.bg, 'neutral .btn background is --mm-bg-elevated').toBe(elevated);

  // A dialog's actions: the unsaved-changes three-way prompt (SPEC22)
  // carries a primary (Save) and a neutral (Cancel) on one .dialog surface.
  await openWelcomeViaHelp(page);
  await dirtyActiveDoc(page, 'styling probe ');
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-close-file').click();
  await expect(page.getByTestId('open-save')).toBeVisible();
  const dialogPrimary = await sampleControl(page.getByTestId('open-save'));
  const dialogNeutral = await sampleControl(page.getByTestId('open-cancel'));
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('open-save')).toHaveCount(0);

  expectSameGeometry('btn-primary: open-save vs settings-close', dialogPrimary, settingsPrimary);
  // The primary modifier changes fill only — geometry is the .btn base's.
  expectSameGeometry('btn base: open-cancel vs open-save', dialogNeutral, dialogPrimary);
  expectSameGeometry('btn neutral: start-openFile vs open-cancel', splash, dialogNeutral);
}

test('E392: chrome controls agree via computed styles under the light Crisp theme, and the neutral background is the theme’s --mm-bg-elevated', async ({
  page,
}) => {
  // PRD 018 Req 30: Crisp is the shipped default — freshApp lands on it.
  await freshApp(page);
  await assertChromeAgreement(page, 'rgb(246, 248, 250)'); // Crisp #f6f8fa
});

test('E393: the same computed-style agreement holds under the dark GitHub Dark theme, with no chrome token defined by the theme', async ({
  page,
}) => {
  // PRD 018 Req 31: the identical assertion set under a dark bundled theme
  // proves the chrome follows the theme purely through the derived token
  // defaults — github-dark.css (like every bundled theme) defines contract
  // variables only, not one chrome token.
  await freshApp(page);
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('github-dark');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(13, 17, 23)'); // github-dark --mm-bg, the theme has applied
  await page.getByTestId('settings-close').click();
  await assertChromeAgreement(page, 'rgb(22, 27, 34)'); // github-dark #161b22
});

test('E394: the hosted sign-in submit and the post-login splash actions are one neutral button, pre-auth page included', async ({
  page,
}) => {
  // PRD 018 Req 30: the pre-auth page mounts outside .theme-root, so this
  // pair only agrees because the chrome-token layer is scoped onto
  // .hosted-signin too (styles.css CHROME TOKENS block) — the regression
  // this test exists to catch is that page silently losing the tokens and
  // its primitives collapsing to browser defaults.
  await page.goto(`${HOSTED}/`);
  await expect(page.getByTestId('hosted-sign-in-submit')).toBeVisible();
  const signInSubmit = await sampleControl(page.getByTestId('hosted-sign-in-submit'));
  // The neutral background is the elevated surface, resolved against the
  // pre-auth page's own root (its Crisp-fallback contract).
  expect(signInSubmit.bg).toBe(await resolvedColor(page, '.hosted-signin', '--mm-bg-elevated'));

  // Reset ada's roaming state before entering the app: beside the usual
  // draft, a leftover theme choice (settings.json) would restyle the splash
  // side of the pair this test compares against the theme-less sign-in page.
  const headers = await hostedAuthHeaders(page, 'ada');
  for (const file of ['draft.json', 'settings.json']) {
    await dropRoamingFile(page, headers, file);
  }

  await page.getByTestId('hosted-sign-in-username').fill('ada');
  await page.getByTestId('hosted-sign-in-submit').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  const splash = await sampleControl(page.getByTestId('start-openFile'));
  expectSameGeometry('btn neutral: hosted-sign-in-submit vs start-openFile', signInSubmit, splash);
  expect(splash.bg).toBe(await resolvedColor(page, '.theme-root', '--mm-bg-elevated'));
});

test('E395: the workspace settings destructive button is the danger fill on the shared .btn geometry', async ({
  page,
}) => {
  // PRD 018 Req 30: the destructive control from a workspace settings
  // surface — .btn-danger.btn-primary — keeps the .btn geometry and takes
  // its fill from the one danger token.
  const headers = await hostedAuthHeaders(page, 'ada');
  const created = await page.request.post(`${HOSTED}/api/workspaces`, {
    headers,
    data: { name: `E395 styling w${test.info().workerIndex}` },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;

  await dropRoamingFile(page, headers, 'draft.json');
  await page.goto(`${HOSTED}/?workspace=${id}`);
  await page.getByTestId('hosted-sign-in-username').fill('ada');
  await page.getByTestId('hosted-sign-in-submit').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  // Issue #183 §1: the danger zone lives at the foot of the People tab.
  await openSettings(page, 'people');
  await expect(page.getByTestId('workspace-delete-section')).toBeVisible();
  const destructive = await sampleControl(page.getByTestId('workspace-delete-submit'));
  const settingsPrimary = await sampleControl(page.getByTestId('settings-close'));
  expectSameGeometry('danger fill keeps .btn geometry', settingsPrimary, destructive);
  expect(destructive.bg, 'destructive fill is --mm-danger').toBe(
    await resolvedColor(page, '.theme-root', '--mm-danger'),
  );
});

test('E396: overriding chrome tokens at the theme scope restyles the primitives — the override story is real', async ({
  page,
}) => {
  // PRD 018 Req 32 (proving Req 6): a stylesheet override on .theme-root —
  // exactly what a theme may ship — moves the primitives' computed styles.
  // The pre-override values are asserted too, so the override provably
  // changed something rather than matching an accident.
  await freshApp(page);
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-about').click();
  await expect(page.getByTestId('about-dialog')).toBeVisible();

  expect((await sampleControl(page.getByTestId('mode-switch'))).radius).toBe('6px'); // --mm-radius-small
  expect((await sampleControl(page.getByTestId('about-close'))).radius).toBe('10px'); // --mm-radius-medium

  // Appended after the theme's <style>, same specificity, later in the
  // cascade — the exact position a user theme's override lands in.
  await page.addStyleTag({
    content: '.theme-root { --mm-radius-small: 2px; --mm-radius-medium: 3px; }',
  });

  expect((await sampleControl(page.getByTestId('mode-switch'))).radius, '.icon-btn follows --mm-radius-small').toBe(
    '2px',
  );
  expect((await sampleControl(page.getByTestId('about-close'))).radius, '.btn follows --mm-radius-medium').toBe(
    '3px',
  );
});
