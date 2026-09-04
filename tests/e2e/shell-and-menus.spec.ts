import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import pkg from '../../package.json' with { type: 'json' };
import {
  addComment,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  menuItem,
  openFolderRoot,
  openSettings,
  openWelcomeViaHelp,
  PHRASE,
  revealToolbar,
  seedFolders,
  selectPhrase,
  stableBox,
  TOOLBAR_WAIT,
  WELCOME,
} from './helpers';

// App shell: launch, toolbar chrome, splash, About, native desktop menus,
// aux windows and the sliding panes.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E1: launch shows the clean empty state; Help opens the welcome doc fully rendered', async ({ page }) => {
  // beforeEach opened welcome — reset to a pristine launch for this test.
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const hint = page.getByTestId('empty-hint');
  await expect(hint).toBeVisible();
  // SPEC27 §4.1 amendment (revised): the empty state is the icon splash.
  await expect(page.getByTestId('splash-mark')).toBeVisible();
  await expect(hint).toContainText('Drop a file to open');
  await expect(page.getByTestId('doc')).toHaveText(''); // no document content
  // SPEC5 §1 (amended, issue #197): the toolbar never shows the badge — the
  // title slot is empty when nothing is named there.
  await expect(page.getByTestId('docname').getByTestId('app-badge')).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  await openWelcomeViaHelp(page);
  const doc = page.getByTestId('doc');
  await expect(doc.locator('h1')).toContainText('Welcome to Marky Mark');
  await expect(doc.locator('pre code')).toBeVisible();
  await expect(doc.locator('table')).toBeVisible();
  await expect(doc.locator('table')).toContainText('Switch theme');
  await expect(doc.locator('input[type="checkbox"]').first()).toBeVisible();
});

test('E141: no document open — the edit hotkey and toolbar control leave the splash in preview; no editor mounts, nothing goes dirty (#40)', async ({
  page,
}) => {
  // beforeEach opened welcome — reset to a pristine launch for this test.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const hint = page.getByTestId('empty-hint');
  await expect(hint).toBeVisible();

  // Issue #40: the toggleEdit hotkey must be inert with no document open —
  // no editor surface, no phantom untitled buffer.
  await page.keyboard.press('Control+e');
  await expect(hint).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveCount(0);

  // The toolbar's mode control dispatches the same command — inert too.
  await revealToolbar(page);
  await page.getByTestId('edit-toggle').click();
  await expect(hint).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E13: the menu leads the toolbar on the left and holds exactly the gated groups; menu Save persists', async ({
  page,
}) => {
  // Old toolbar buttons are gone.
  await expect(page.getByTestId('theme-picker')).toHaveCount(0);
  await expect(page.getByTestId('open-file')).toHaveCount(0);
  await expect(page.getByTestId('settings-btn')).toHaveCount(0);

  await revealToolbar(page);
  // PRD 009 Req 7: the hamburger is the toolbar's first element — its right
  // edge sits left of the document name's left edge.
  const btnBox = (await page.getByTestId('menu-btn').boundingBox())!;
  const nameBox = (await page.getByTestId('docname').boundingBox())!;
  expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(nameBox.x);

  await page.getByTestId('menu-btn').click();
  const menu = page.getByTestId('app-menu');
  // …and the popover is anchored to the button, not the toolbar's right edge.
  const menuBox = (await menu.boundingBox())!;
  expect(Math.abs(menuBox.x - btnBox.x)).toBeLessThan(12);

  // PRD 009 Req 8/9: the item set for this flavor and mode — a local file open
  // (single-file mode) on a shim that can honour every workspace flow. No New
  // File outside workspace mode, no Close Workspace outside it. Exactly these,
  // in this order: still the one overflow menu of SPEC4 §5.2, still carrying
  // SPEC10 §6's About row.
  const rows = await menu.locator('button').evaluateAll((els) => els.map((el) => el.dataset.testid));
  expect(rows).toEqual([
    'menu-open',
    'menu-close-file',
    'menu-new-workspace',
    'menu-open-workspace',
    'menu-save',
    'menu-save-as',
    'menu-view',
    'menu-settings',
    'menu-help',
    'menu-about',
  ]);
  // Five surviving groups ⇒ four separators, one between each pair — the menu
  // never starts or ends with one.
  await expect(menu.getByTestId('menu-sep')).toHaveCount(4);
  await expect(menu.getByTestId('menu-view')).toHaveAttribute('aria-haspopup', 'menu');
  await expect(menu.getByTestId('menu-save')).toBeEnabled();
  await page.keyboard.press('Escape');
  await revealToolbar(page);
  await page.getByTestId('docname').click(); // close menu

  // Dirty the buffer, then save via the menu.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('MENUSAVE ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, WELCOME)).toContain('MENUSAVE');
});

test('E14: hovering the filename reveals the full on-disk path (title attribute)', async ({ page }) => {
  await expect(page.getByTestId('docname')).toHaveAttribute('title', WELCOME);
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
});

test('E17: hamburger and outline-balloon SVG icons replace the glyph/emoji', async ({ page }) => {
  const menuBtn = page.getByTestId('menu-btn');
  await expect(menuBtn.getByTestId('menu-icon')).toBeVisible();
  expect(await menuBtn.evaluate((el) => el.querySelector('svg') !== null)).toBe(true);
  expect(await menuBtn.textContent()).not.toContain('⋯');

  const commentsBtn = page.getByTestId('comments-toggle');
  await expect(commentsBtn.getByTestId('comments-icon')).toBeVisible();
  expect(await commentsBtn.evaluate((el) => el.querySelector('svg') !== null)).toBe(true);
  expect(await commentsBtn.textContent()).not.toContain('💬');
  // The balloon is an outline: stroked, unfilled path.
  const path = commentsBtn.locator('svg path');
  await expect(path).toHaveAttribute('fill', 'none');
  await expect(path).toHaveAttribute('stroke', 'currentColor');
});

test('E25: toolbar auto-hides after launch, reveals on top-edge hover (with shadow), pins while the menu is open', async ({
  page,
}) => {
  // Auto-hide is opt-in as of SPEC5 — enable it first (persists in settings).
  await openSettings(page, 'general');
  await page.getByTestId('settings-autohide').check();
  await page.getByTestId('settings-close').click();

  // Fresh load with the mouse parked away from the top edge (freshApp leaves
  // it in the hot zone, which would legitimately pin the bar forever).
  await page.mouse.move(500, 400);
  // Issue #81: a relaunch never reopens the document — open it explicitly
  // via the hash (no toolbar interaction, so the mouse stays parked).
  await page.goto('/#open=/docs/welcome.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  const shell = page.getByTestId('toolbar-shell');
  // Visible during the launch grace period…
  await expect(shell).toHaveAttribute('data-visible', 'true');
  // …then slides up and away (grace ≈ 2.5 s).
  await expect(shell).toHaveAttribute('data-visible', 'false', { timeout: 6000 });
  // data-visible flips at animation start — poll until the slide-out transition
  // actually carries the bar past the threshold (slow CI runners sample mid-flight).
  await expect
    .poll(() => shell.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42), { timeout: 5000 })
    .toBeLessThan(-30); // moved out through the top

  // Mouse into the top hot zone → toolbar returns, wearing its faint shadow.
  await page.mouse.move(500, 8);
  await expect(shell).toHaveAttribute('data-visible', 'true');
  const shadow = await page.locator('.toolbar').evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe('none');

  // Mouse away → hides again after the hide delay.
  await page.mouse.move(500, 400);
  await expect(shell).toHaveAttribute('data-visible', 'false', { timeout: 3000 });

  // Pinned while the app menu is open, even with the mouse elsewhere.
  await page.mouse.move(500, 8);
  await expect(shell).toHaveAttribute('data-visible', 'true');
  await page.getByTestId('menu-btn').click();
  await expect(page.getByTestId('app-menu')).toBeVisible();
  await page.mouse.move(500, 400);
  await page.waitForTimeout(TOOLBAR_WAIT);
  await expect(shell).toHaveAttribute('data-visible', 'true'); // still pinned
  await page.keyboard.press('Escape');
  await page.mouse.click(500, 400); // close the menu, mouse away from the bar
  await expect(shell).toHaveAttribute('data-visible', 'false', { timeout: 3000 });
});

test('E28: the toolbar title slot stays empty when nothing is named; titles say Marky Mark', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  const docname = page.getByTestId('docname');
  // SPEC5 §1 (amended, issue #197): the badge never renders in the toolbar —
  // the slot holds no badge, no SVG, no app-name text.
  await expect(docname.getByTestId('app-badge')).toHaveCount(0);
  expect(await docname.evaluate((el) => el.querySelector('svg') === null)).toBe(true);
  expect((await docname.textContent())?.trim()).toBe(''); // empty — no app-name text

  expect(await page.title()).toContain('Marky Mark');
  expect(await page.title()).not.toContain('Markimark');

  // With a document open, the filename shows — and the badge is still absent.
  await openWelcomeViaHelp(page);
  await expect(docname).toContainText('welcome.md');
  await expect(docname.getByTestId('app-badge')).toHaveCount(0);
});

test('E29: the toolbar stays put by default; the auto-hide setting turns hiding on and back off', async ({
  page,
}) => {
  const shell = page.getByTestId('toolbar-shell');

  // Default: mouse parked mid-screen, well past grace+delay — still visible.
  await page.mouse.move(500, 400);
  await page.waitForTimeout(TOOLBAR_WAIT);
  await expect(shell).toHaveAttribute('data-visible', 'true');

  // Enable auto-hide → it hides once the mouse is away.
  await openSettings(page, 'general');
  await page.getByTestId('settings-autohide').check();
  await page.getByTestId('settings-close').click();
  await page.mouse.move(500, 400);
  await expect(shell).toHaveAttribute('data-visible', 'false', { timeout: 6000 });

  // Hover reveals; unchecking the setting is exercised (the pinned-forever
  // default it returns to is what the first assertion of this test already
  // proved — re-proving it cost a second 3.2s wall-clock sleep; owner call
  // 2026-08-03 to drop it).
  await page.mouse.move(500, 8);
  await expect(shell).toHaveAttribute('data-visible', 'true');
  await openSettings(page, 'general');
  await page.getByTestId('settings-autohide').uncheck();
  await page.getByTestId('settings-close').click();
});

test('E30: the empty-state hint sits in the true center of the window', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const hint = page.getByTestId('empty-hint');
  await expect(hint).toBeVisible();

  const box = (await hint.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThanOrEqual(40);
  expect(Math.abs(box.y + box.height / 2 - vp.height / 2)).toBeLessThanOrEqual(40);
});

test('E31: the edit-mode text column aligns with the preview column', async ({ page }) => {
  const previewTextLeft = () =>
    page
      .getByTestId('doc')
      .evaluate((el) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
  const editorTextLeft = () => page.locator('.cm-line').first().evaluate((el) => el.getBoundingClientRect().left);

  // Exact alignment with the gutter off — in FULL-SCREEN edit (this test is
  // about the swap alignment; split edit is the default now and has its own
  // geometry, so switch it off here).
  await page.evaluate(() => window.__mmDispatch!('toggleLineNumbers')); // issue #10: off
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await page.getByTestId('settings-close').click();

  const p1 = await previewTextLeft();
  await page.keyboard.press('Control+e');
  // The editor mounts and measures asynchronously — poll the alignment rather
  // than sampling the column the instant the swap starts.
  await expect.poll(async () => Math.abs((await editorTextLeft()) - p1)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Control+e');

  // Margins move both columns together.
  await openSettings(page);
  await page.getByTestId('settings-margins').selectOption('wide');
  await page.getByTestId('settings-close').click();
  // The margins change re-lays the column out; wait for it to land before
  // measuring, then hold that measurement.
  await expect.poll(previewTextLeft).toBeGreaterThan(p1); // narrower column starts further right
  const p2 = await previewTextLeft();
  await page.keyboard.press('Control+e');
  await expect.poll(async () => Math.abs((await editorTextLeft()) - p2)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Control+e');

  // With the gutter on, the text may shift by at most the gutter width.
  await page.evaluate(() => window.__mmDispatch!('toggleLineNumbers')); // issue #10: back on
  await page.keyboard.press('Control+e');
  // .cm-gutters is sized on a rAF scheduled by the pane ResizeObserver
  // (Editor.tsx:1238) — the same deferral that broke E136.
  await expect
    .poll(async () => {
      const gutterW = await page.locator('.cm-gutters').evaluate((el) => el.getBoundingClientRect().width);
      return Math.abs((await editorTextLeft()) - p2) - gutterW;
    })
    .toBeLessThanOrEqual(2);
});

test('E45: About dialog shows name, exact build version, alpha notice, developer, and MIT; Escape closes it', async ({
  page,
}) => {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-about').click();

  const dlg = page.getByTestId('about-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('about-name')).toHaveText('Marky Mark');
  // The version comes from __APP_VERSION__, baked at build time from
  // package.json — pre-release identifier intact (SPEC10 §2–§3).
  await expect(dlg.getByTestId('about-version')).toHaveText(`v${pkg.version}`);
  expect(pkg.version).toContain('-'); // alpha builds carry a pre-release id
  await expect(dlg.getByTestId('about-alpha')).toContainText(/alpha/i);
  await expect(dlg.getByTestId('about-developer')).toContainText('Developer: Jorge Pereira');
  await expect(dlg.getByTestId('about-license')).toContainText('MIT');
  await expect(dlg.getByTestId('about-repo')).toHaveAttribute('href', 'https://github.com/jorgeper/marky-mark');

  await dlg.getByTestId('about-close').click();
  await expect(dlg).toHaveCount(0);
});

test('E46: network isolation — adversarial doc renders with zero non-localhost requests; placeholders shown; links never navigate the app', async ({
  page,
}) => {
  // Block-and-log anything that tries to leave localhost, context-wide.
  const external: string[] = [];
  await page.context().route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    external.push(route.request().url());
    return route.abort();
  });

  const adversarial = readFileSync(fileURLToPath(new URL('../../fixtures/adversarial.md', import.meta.url)), 'utf8');
  await fsWrite(page, '/docs/adversarial.md', adversarial);
  page.once('dialog', (d) => void d.accept('/docs/adversarial.md'));
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-open').click();
  await expect(page.getByTestId('docname')).toContainText('adversarial.md');

  // Both remote images became inert placeholders naming the blocked origin;
  // no element in the doc points at a remote URL.
  const placeholders = page.locator('.mm-blocked-remote');
  await expect(placeholders).toHaveCount(2);
  await expect(placeholders.first()).toContainText('remote image (evil.example.com');
  await expect(placeholders.first()).toContainText('Marky Mark is local-only');
  await expect(page.getByTestId('doc').locator('img[src*="evil"]')).toHaveCount(0);

  // Remote link: managed hand-off (SPEC11 §4) — recorded, app never navigates.
  const before = page.url();
  await page.getByRole('link', { name: 'click me' }).click();
  await expect(page.getByTestId('docname')).toContainText('adversarial.md');
  expect(page.url()).toBe(before);
  const opens = await page.evaluate(() => (window as unknown as { __mmExternalOpens?: string[] }).__mmExternalOpens ?? []);
  expect(opens).toEqual(['https://evil.example.com/phone-home']);

  // Fragment link stays local and inert-safe.
  await page.getByRole('link', { name: 'back to top' }).click();
  expect(page.url()).toBe(before);

  // The guarantee: not one request attempted to leave localhost.
  expect(external).toEqual([]);
});

test('E47: nativeMenu mode renders no header; the window title is the only filename/dirty display', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  // Chromeless (SPEC12 §2.1): no toolbar shell, hot zone, or hamburger at all.
  await expect(page.getByTestId('toolbar-shell')).toHaveCount(0);
  await expect(page.getByTestId('toolbar-hotzone')).toHaveCount(0);
  await expect(page.getByTestId('menu-btn')).toHaveCount(0);
  // No document: bare app name (SPEC12 §2.2).
  await expect(page).toHaveTitle('Marky Mark');

  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await expect(page).toHaveTitle('welcome.md — Marky Mark');
  // Still chromeless above the document area: the file tab strip (PRD 013,
  // issue #144) is the only thing there — it starts at the very top of the
  // window and the workspace sits directly under it. No toolbar band.
  const strip = await page.getByTestId('file-tab-strip').boundingBox();
  expect(strip!.y).toBe(0);
  const box = await page.locator('.workspace').boundingBox();
  expect(box!.y).toBe(strip!.y + strip!.height);

  await menuClick(page, 'toggleMode');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('TITLEMARK ');
  await expect(page).toHaveTitle('welcome.md • — Marky Mark');
  await menuClick(page, 'save');
  await expect(page).toHaveTitle('welcome.md — Marky Mark');
});

test('E48: the installed menu spec drives every command, and re-installs with live checkmarks and count', async ({
  page,
}) => {
  // Kitchen-sink by design (~25s: every menu command through the registry) —
  // it sat at the 30s default timeout, so any machine load timed it out.
  test.slow();
  await freshNativeMenuApp(page);
  const titles = await page.evaluate(() => window.__mmMenu!.spec!.submenus.map((m) => m.title));
  expect(titles).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Help']));

  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  // Edit Mode checkmark follows the mode through re-installed specs.
  expect((await menuItem(page, 'toggleMode'))!.checked).toBe(false);
  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect.poll(async () => (await menuItem(page, 'toggleMode'))!.checked).toBe(true);

  // Save through the menu persists to disk, exactly like the toolbar path.
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('MENUMARK ');
  await menuClick(page, 'save');
  await expect(page).toHaveTitle('welcome.md — Marky Mark');
  expect(await fsRead(page, WELCOME)).toContain('MENUMARK');

  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect.poll(async () => (await menuItem(page, 'toggleMode'))!.checked).toBe(false);

  // Comment count lands in the label; the toggle hides the panel and unchecks.
  await addComment(page, 'MENUMARK', 'menu comment');
  await expect.poll(async () => (await menuItem(page, 'toggleComments'))!.label).toBe('Comments (1)');
  await menuClick(page, 'toggleComments');
  await expect(page.getByTestId('panel')).toHaveCount(0);
  await expect.poll(async () => (await menuItem(page, 'toggleComments'))!.checked).toBe(false);
  await menuClick(page, 'toggleComments');
  await expect(page.getByTestId('panel')).toBeVisible();

  // Settings and About open through the registry — in their own windows (SPEC13).
  const settingsPopup = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await settingsPopup;
  await expect(sp.getByTestId('settings-panel')).toBeVisible();
  await sp.close();
  const aboutPopup = page.waitForEvent('popup');
  await menuClick(page, 'about');
  const ap = await aboutPopup;
  await expect(ap.getByTestId('about-dialog')).toBeVisible();
  // Esc closes the window on keydown — the page can die before the paired
  // keyup is delivered, interrupting press(); the poll asserts the outcome.
  await ap.keyboard.press('Escape').catch(() => {});
  await expect.poll(() => ap.isClosed()).toBe(true);

  // Save As… switches to the new document; Open… routes through the dialog.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/copy.md';
  });
  await menuClick(page, 'saveAs');
  await expect(page).toHaveTitle('copy.md — Marky Mark');
  page.once('dialog', (d) => void d.accept('/docs/welcome.md'));
  await menuClick(page, 'open');
  await expect(page).toHaveTitle('welcome.md — Marky Mark');
});

test('E49: the auto-hide toolbar setting is absent under native menus, present otherwise; the key round-trips', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  const popup = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popup;
  await sp.getByTestId('settings-panel').waitFor();
  await sp.getByTestId('settings-tab-general').click();
  // Positive control: the General body really rendered, so the absence below
  // means "the row is gone", not "nothing painted". (This was the deleted
  // line-numbers row's other job; autosaveOnToggle sits in the same spot.)
  await expect(sp.getByTestId('autosave-toggle')).toBeVisible();
  await expect(sp.getByTestId('settings-autohide')).toHaveCount(0);
  // Issue #10 removed the line-numbers row; editorSyntax is another U-scope
  // checkbox and serves the same purpose here.
  await sp.getByTestId('settings-tab-editor').click();
  await expect(sp.getByTestId('editor-syntax')).toBeVisible();
  // Force a settings write; other keys must survive it (SPEC12 §4.2). Since
  // PRD 002 §E18, settings.json is the sparse User LAYER — the edit patches
  // editorSyntax in and leaves the seeded paneMinWidth untouched.
  await sp.getByTestId('editor-syntax').click();
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      return parsed.editorSyntax === false && parsed.paneMinWidth === 240;
    })
    .toBe(true);
  await sp.close();

  // Classic (web-style) mode keeps the checkbox.
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openSettings(page, 'general');
  await expect(page.getByTestId('settings-autohide')).toBeVisible();
});

test('E50: menu Quit/Close with unsaved changes shows the guard prompt; cancel keeps the document', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await menuClick(page, 'toggleMode');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('GUARDMARK3 ');
  await expect(page).toHaveTitle('welcome.md • — Marky Mark');

  await menuClick(page, 'close');
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  await page.getByTestId('close-cancel').click();
  await expect(page.getByTestId('close-prompt')).toHaveCount(0);
  // Nothing lost: still dirty, edit still in the buffer.
  await expect(page).toHaveTitle('welcome.md • — Marky Mark');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('GUARDMARK3');
});

test('E51: Settings opens its own window — no in-page overlay; edits apply live in main and persist; menu zoom echoes back', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc')).toBeVisible();
  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();

  const popupPromise = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popupPromise;
  await sp.getByTestId('settings-panel').waitFor();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0); // never an overlay on desktop

  await expect(sp.getByTestId('settings-tab-appearance')).toBeVisible();
  await expect(sp.getByTestId('settings-tab-general')).toBeVisible();
  await expect(sp.getByTestId('settings-tab-hotkeys')).toBeVisible();

  // Toggle editor syntax highlighting in the popup → main reacts live…
  // (issue #10 moved line numbers to the View menu, so this half rides on
  // another U-scope Editor setting; E136 covers the menu route.)
  await sp.getByTestId('settings-tab-editor').click();
  await expect(page.locator('.mm-md-h1').first()).toBeVisible();
  await sp.getByTestId('editor-syntax').click();
  await expect(page.locator('.mm-md-h1')).toHaveCount(0);
  // …and persists through the main window (the sole owner of settings.json).
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { editorSyntax?: boolean }).editorSyntax : undefined;
    })
    .toBe(false);

  // Canonical echo: zoom stepped via the main window's menu lands in the popup control.
  await sp.getByTestId('settings-tab-appearance').click();
  await menuClick(page, 'zoomIn');
  await expect(sp.getByTestId('zoom-select')).toHaveValue('110');
});

test('E52: rebinding Save in the settings window updates the menu accelerator; old combo dead, new combo saves', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc')).toBeVisible();

  const popupPromise = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popupPromise;
  await sp.getByTestId('settings-panel').waitFor();
  await sp.getByTestId('settings-tab-hotkeys').click();
  await sp.getByTestId('hotkey-save').click();
  await sp.keyboard.press('Control+Shift+D');

  // The main window's installed menu spec follows the rebind (SPEC13 §1.5).
  await expect
    .poll(async () => {
      const item = await page.evaluate(
        () =>
          window
            .__mmMenu!.spec!.submenus.flatMap((m) => m.items)
            .find((i) => i.type === 'command' && i.command === 'save') as { accelerator?: string } | undefined
      );
      return item?.accelerator;
    })
    .toBe('Mod+Shift+D');

  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('REBINDMARK ');
  await page.keyboard.press('Control+s'); // old combo — must do nothing
  await expect(page).toHaveTitle('welcome.md • — Marky Mark');
  await page.keyboard.press('Control+Shift+D'); // new combo — saves, exactly once
  await expect(page).toHaveTitle('welcome.md — Marky Mark');
  expect(await fsRead(page, WELCOME)).toContain('REBINDMARK');
});

test('E53: About opens its own window, Esc closes it; aux windows are singletons — reinvoke focuses', async ({
  page,
}) => {
  await freshNativeMenuApp(page);

  const aboutPromise = page.waitForEvent('popup');
  await menuClick(page, 'about');
  const ap = await aboutPromise;
  await ap.getByTestId('about-dialog').waitFor();
  await expect(ap.getByTestId('about-version')).toContainText('v');
  // Esc closes the window on keydown — the page can die before the paired
  // keyup is delivered, interrupting press(); the poll asserts the outcome.
  await ap.keyboard.press('Escape').catch(() => {});
  await expect.poll(() => ap.isClosed()).toBe(true);

  const settingsPromise = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await settingsPromise;
  await sp.getByTestId('settings-panel').waitFor();
  await menuClick(page, 'settings'); // second invoke: focus the existing window, never a second one
  await expect
    .poll(() => page.evaluate(() => window.__mmAux))
    .toEqual({ opened: { settings: 1, about: 1 }, focused: { settings: 1, about: 0 } });
  await expect(sp.getByTestId('settings-panel')).toBeVisible();
});

test('E87: the splash — glyph on the cloud, About info, one drop hint, no key-combo text', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const hint = page.getByTestId('empty-hint');
  await expect(hint).toBeVisible();
  await expect(page.getByTestId('splash-mark')).toBeVisible();
  await expect(page.getByTestId('splash-badge')).toBeVisible(); // the app icon, no title text
  await expect(hint).toContainText(`v${pkg.version}`); // exact build version, like About
  await expect(hint).toContainText('Alpha — pre-release software, expect rough edges.');
  await expect(hint).toContainText('Developer: Jorge Pereira');
  await expect(hint).toContainText('MIT License');
  await expect(hint).toContainText('github.com/jorgeper/marky-mark');
  await expect(hint).toContainText('Drop a file to open');
  // The old key-combo hints are gone for good.
  await expect(hint).not.toContainText('⌘O');
  await expect(hint).not.toContainText('⌘N');
  await expect(hint).not.toContainText('press');

  // Opening a document removes the splash entirely. (The toolbar badge chip
  // is gone for good — SPEC27 §4.2 as amended by issue #197.)
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect(page.getByTestId('splash-mark')).toHaveCount(0);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('docname').click(); // close menu
});

test('E132: scope notes add no layout height — shared settings rows measure identically in both scopes (#25)', async ({
  page,
}) => {
  // Issue #25: the §E19 scope/override notes used to render as paragraphs
  // under many rows in one scope but not the other, stretching the list.
  await seedFolders(page);
  await openFolderRoot(page);
  await openSettings(page, 'general');

  // comment-storage is a W-scoped `.field` row: its note shows in User scope.
  const storageField = page.locator('.settings-modal .field', { has: page.getByTestId('comment-storage') });
  // split-edit is an M-scoped `.checkbox-row`: its note shows in Workspace scope.
  const splitRow = page.locator('.settings-modal .checkbox-row', { has: page.getByTestId('set-split-edit') });

  // §E19 discoverability: a locked row still explains why and where to edit.
  const note = page.getByTestId('scope-note-commentStorage');
  await expect(note).toBeVisible();
  await expect(note).toHaveAttribute('title', /Workspace setting/);

  const userStorage = (await storageField.boundingBox())!;
  const userSplit = (await splitRow.boundingBox())!;

  await page.getByTestId('settings-scope-workspace').click();
  await expect(page.getByTestId('scope-note-commentStorage')).toHaveCount(0);
  const wsStorage = (await storageField.boundingBox())!;
  const wsSplit = (await splitRow.boundingBox())!;

  // Same row height and same distance between the two rows in both scopes —
  // on the old rendering the User-scope notes made both differ by ~18px each.
  expect(Math.abs(wsStorage.height - userStorage.height)).toBeLessThan(1);
  expect(Math.abs(wsSplit.height - userSplit.height)).toBeLessThan(1);
  expect(Math.abs((wsStorage.y - wsSplit.y) - (userStorage.y - userSplit.y))).toBeLessThan(1);

  // And in Workspace scope the notes that DO render there (M/U!-scoped keys)
  // are equally weightless: the General tab's rows line up with User scope.
  const wsNotes = page.locator('.settings-modal [data-testid^="scope-note-"]');
  expect(await wsNotes.count()).toBeGreaterThan(0);
});

test('E133: pane slides — panes mount/unmount cleanly through the toggles, settings persist, reduced motion is instant', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  // The rAF interpolation sampler that used to live here (E25-pattern,
  // shared with the removed E135) is gone — frame sampling under CPU load is
  // inherently flaky (owner call, 2026-08-03, with E135's removal). This
  // test keeps the functional guarantees: panes mount/unmount cleanly
  // through the toggles, steady state carries no transform, settings
  // persist, and reduced motion is instant.

  // Folder close (Req 9): from a settled steady state, the pane unmounts.
  await expect
    .poll(() => page.getByTestId('folder-panel').evaluate((el) => getComputedStyle(el).transform))
    .toBe('none');
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  // Req 12: end state and persistence identical to an instant toggle.
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"showFolders": false');

  // Folder open: slides in from the left edge, then rests transform-free
  // (steady state keeps no transform — the context menu is fixed-position).
  await page.waitForTimeout(250); // SPEC12 §1.3 cross-source dedup window
  await page.getByTestId('folder-expand').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect
    .poll(() => page.getByTestId('folder-panel').evaluate((el) => getComputedStyle(el).transform))
    .toBe('none');

  // Split preview (Req 10): same language from/toward the RIGHT edge.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect
    .poll(() => page.getByTestId('split-preview').evaluate((el) => getComputedStyle(el).transform))
    .toBe('none');
  await page.waitForTimeout(250);
  await page.getByTestId('preview-collapse').click();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"splitEdit": false');

  await page.waitForTimeout(250);
  await page.getByTestId('preview-expand').click();
  await expect(page.getByTestId('split-preview')).toBeVisible();

  // Req 11: prefers-reduced-motion switches both panes instantly — gone
  // within a frame or two of the toggle, no slide.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(250);
  const instant = await page.evaluate(async () => {
    const twoFrames = () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    (document.querySelector('[data-testid="preview-collapse"]') as HTMLElement).click();
    await twoFrames();
    const previewGone = !document.querySelector('[data-testid="split-preview"]');
    (document.querySelector('[data-testid="folder-collapse"]') as HTMLElement).click();
    await twoFrames();
    const folderGone = !document.querySelector('[data-testid="folder-panel"]');
    return { previewGone, folderGone };
  });
  expect(instant).toEqual({ previewGone: true, folderGone: true });
});

test('E134: split mode — the editor column hugs its pane, leaving no blank strip at the folder seam (#7)', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Issue #7's geometry: a text column narrower than the editor pane (wide
  // margins, then the divider dragged right). Centering the gutter+content
  // pair there strands a dead editor-background strip between the folder
  // seam and the gutter — the "blank folder pane" of the issue screenshot.
  await openSettings(page);
  await page.getByTestId('settings-margins').selectOption('wide');
  await page.getByTestId('settings-close').click();
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();

  const wsBox = (await page.locator('.workspace.split').boundingBox())!;
  const divider = page.getByTestId('split-divider');
  const d = await stableBox(divider);
  await page.mouse.move(d.x + d.width / 2, d.y + 200);
  await page.mouse.down();
  await page.mouse.move(wsBox.x + wsBox.width * 0.8, d.y + 200, { steps: 8 });
  await page.mouse.up();

  const box = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, width: b.width };
      });
  // Distance from the editor pane's left edge to the start of its column.
  const strip = async () => {
    const pane = await box('.split-editor');
    return Math.round((await box('.split-editor .cm-gutters')).left - pane.left);
  };

  // Guard: the pane really is wider than gutter+column, or there would be no
  // leftover width to strand and the assertions below would prove nothing.
  // Polled because the dragged width lands a frame later (as E40 does too).
  const paneSlack = async () =>
    (await box('.split-editor')).width - (await box('.split-editor .cm-content')).width;
  await expect.poll(paneSlack).toBeGreaterThan(100);

  // Folder pane OPEN: the column starts at the pane's own left edge, flush
  // against the folder seam — no blank strip between the two.
  await expect.poll(strip).toBeLessThanOrEqual(2);
  const seam = (await box('[data-testid="folder-panel"]')).right;
  expect(Math.abs((await box('.split-editor .cm-gutters')).left - seam)).toBeLessThanOrEqual(2);

  // Folder pane CLOSED (the issue screenshot's state): the column follows the
  // pane to the workspace's left edge, so the reopen chevron floats over the
  // gutter's own strip rather than over a blank ghost pane.
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();
  await expect.poll(strip).toBeLessThanOrEqual(2);
  expect((await box('.split-editor .cm-gutters')).left).toBeLessThanOrEqual(2);

  // SPEC6 §1 is untouched where the pane IS the window: closing the preview
  // re-centers the column, with matching margins either side (as E31 checks
  // against the reading preview).
  await page.getByTestId('preview-collapse').click();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  const full = await box('.editor-wrap');
  const gutters = await box('.editor-wrap .cm-gutters');
  const content = await box('.editor-wrap .cm-content');
  expect(gutters.left - full.left).toBeGreaterThan(100);
  expect(Math.abs(gutters.left - full.left - (full.right - content.right))).toBeLessThanOrEqual(2);
});


test('E155: a native-menu install that REJECTS falls back to the in-app toolbar — never menu-less and toolbar-less', async ({
  page,
}) => {
  // The shim seam (issue #38): ?nativeMenu=fail advertises setAppMenu but
  // every install rejects — the platform claims a menu it cannot deliver.
  await page.goto('/?nativeMenu=fail');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  // No menu was installed…
  expect(await page.evaluate(() => typeof window.__mmMenu)).toBe('undefined');
  // …so the toolbar chrome must be present and working (fixtures' console
  // guard doubles as the no-unhandled-rejection assertion).
  await revealToolbar(page);
  await expect(page.getByTestId('menu-btn')).toBeVisible();

  // The fallback chrome is fully functional: Help opens the welcome doc and
  // the comment flow — the very thing issue #38 reports losing — works.
  await openWelcomeViaHelp(page);
  await selectPhrase(page, PHRASE);
  await expect(page.getByTestId('marker-popup')).toBeVisible();
});

test('E214: PRD 009 Req 12 — View ▸ opens the shared View items: checked, greyed, dispatching, and closing the menu', async ({
  page,
}) => {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  const menu = page.getByTestId('app-menu');
  const view = page.getByTestId('app-menu-view');
  await expect(view).toHaveCount(0);

  // The parent row is not an action: it opens the flyout and stays behind it.
  await menu.getByTestId('menu-view').click();
  await expect(view).toBeVisible();
  await expect(menu).toBeVisible();

  // Req 12: the rows are menuSpec's View items — single-file mode on the
  // desktop shim, comments on, preview mode (so no Changes Since Save).
  const rows = await view.locator('button').evaluateAll((els) => els.map((el) => el.dataset.testid));
  expect(rows).toEqual([
    'menu-view-toggleFolders',
    'menu-view-toggleOpenOnly',
    'menu-view-nextFile',
    'menu-view-prevFile',
    // PRD 013 Req 13 (issue #144): the strip's toggle rides the layout rows.
    'menu-view-toggleFileTabs',
    'menu-view-toggleMode',
    'menu-view-toggleSplit',
    // Issue #167: sync scrolling rides directly under the split it modifies.
    'menu-view-toggleSyncScroll',
    'menu-view-toggleComments',
    'menu-view-nextComment',
    'menu-view-prevComment',
    'menu-view-headingPalette',
    'menu-view-toggleWordCount',
    'menu-view-toggleFrontmatter',
    'menu-view-toggleLineNumbers',
    'menu-view-zoomIn',
    'menu-view-zoomOut',
    'menu-view-zoomReset',
  ]);
  // One divider, before the zoom group — the panel neither starts nor ends
  // with one.
  await expect(view.getByTestId('menu-sep')).toHaveCount(1);
  // …and the frozen top-level item set (E13) is untouched by the flyout.
  const top = await menu.locator('button').evaluateAll((els) => els.map((el) => el.dataset.testid));
  expect(top.filter((id) => id?.startsWith('menu-view-'))).toEqual([]);

  // Checked state is visible and live; a momentarily inapplicable row is a
  // real disabled button (PRD 009 Req 9), not a missing one.
  await expect(view.getByTestId('menu-view-toggleLineNumbers')).toHaveAttribute('aria-checked', 'true');
  await expect(view.getByTestId('menu-view-toggleWordCount')).toHaveAttribute('aria-checked', 'true');
  await expect(view.getByTestId('menu-view-toggleMode')).toHaveAttribute('aria-checked', 'false');
  await expect(view.getByTestId('menu-view-toggleFolders')).toBeDisabled();
  await expect(view.getByTestId('menu-view-nextFile')).toBeDisabled();
  await expect(view.getByTestId('menu-view-headingPalette')).toBeEnabled();

  // Choosing a row dispatches its existing command and closes the whole menu.
  await expect(page.getByTestId('word-chip')).toBeVisible();
  await view.getByTestId('menu-view-toggleWordCount').click();
  await expect(page.getByTestId('word-chip')).toHaveCount(0);
  await expect(view).toHaveCount(0);
  await expect(menu).toHaveCount(0);

  // Reopening shows the flipped check — the submenu reads live state.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-view').click();
  await expect(page.getByTestId('app-menu-view').getByTestId('menu-view-toggleWordCount')).toHaveAttribute(
    'aria-checked',
    'false'
  );

  // A click outside closes both panels (one menuRef subtree, one handler).
  await page.getByTestId('docname').click();
  await expect(page.getByTestId('app-menu-view')).toHaveCount(0);
  await expect(page.getByTestId('app-menu')).toHaveCount(0);
});

test('E216: PRD 009 Req 3 — Close File on the last open file lands on the initial page, driven through the menu row', async ({
  page,
}) => {
  // Req 18 asks for this path through the real menu wiring, not the
  // `__mmDispatch` command seam E210 uses for its setup: the row has to exist,
  // be enabled, and reach `closeFile`.
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  const row = page.getByTestId('menu-close-file');
  await expect(row).toBeEnabled();
  await row.click();

  // Req 3: the last file closed ⇒ the initial page, with its start actions and
  // drop hint back and no document behind them.
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('start-drop')).toBeVisible();
  await expect(page.getByTestId('start-openFile')).toBeVisible();
  await expect(page.getByTestId('doc').locator('h1')).toHaveCount(0);
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toHaveText('');

  // Req 9: with nothing open the row that got us here is gone — Close File is
  // hidden, not a greyed leftover, while Save/Save As… stay as greyed rows.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await expect(page.getByTestId('menu-close-file')).toHaveCount(0);
  await expect(page.getByTestId('menu-save')).toBeDisabled();
  await expect(page.getByTestId('menu-save-as')).toBeDisabled();
});
