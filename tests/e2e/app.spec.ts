import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import pkg from '../../package.json' with { type: 'json' };
import {
  addComment,
  selectPhraseInPane,
  selectSpanInPane,
  freshApp,
  fsRead,
  fsWrite,
  openSettings,
  openWelcomeViaHelp,
  revealToolbar,
  selectPhrase,
  selectSpan,
  waitForSidecar,
  WELCOME,
  WELCOME_SIDECAR,
} from './helpers';

// A phrase from fixtures/welcome.md that lives inside one paragraph.
const PHRASE = 'saved to a sidecar file next to the document';
// Longer than TOOLBAR_GRACE_MS (2500) + TOOLBAR_HIDE_DELAY_MS (400).
const TOOLBAR_WAIT = 3200;

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
  await expect(page.getByTestId('docname').getByTestId('app-badge')).toBeVisible();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  await openWelcomeViaHelp(page);
  const doc = page.getByTestId('doc');
  await expect(doc.locator('h1')).toContainText('Welcome to Marky Mark');
  await expect(doc.locator('pre code')).toBeVisible();
  await expect(doc.locator('table')).toBeVisible();
  await expect(doc.locator('table')).toContainText('Switch theme');
  await expect(doc.locator('input[type="checkbox"]').first()).toBeVisible();
});

test('E2: Settings lists the 7 built-in themes; Monokai changes the background; choice persists across reload', async ({
  page,
}) => {
  await openSettings(page);
  const select = page.getByTestId('settings-theme-light');
  for (const id of ['crisp', 'claude', 'monokai', 'dracula', 'nord', 'solarized-light', 'one-dark']) {
    await expect(select.locator(`option[value="${id}"]`)).toHaveCount(1);
  }

  const before = await page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(before).toBe('rgb(255, 255, 255)'); // Crisp default (#ffffff)

  await select.selectOption('monokai');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)'); // Monokai #272822
  await page.getByTestId('settings-close').click();

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)');
  await openSettings(page);
  await expect(page.getByTestId('settings-theme-light')).toHaveValue('monokai');
});

test('E3: dropping a user theme into the config themes dir + Reload themes (in Settings) makes it appear and apply', async ({
  page,
}) => {
  const css = `/* @name: Midnight Ocean\n   @author: e2e\n   @variant: dark */\n.theme-root { --mm-bg: #010203; --mm-fg: #d8e2ec; }`;
  await fsWrite(page, '/config/themes/midnight-ocean.css', css);

  await openSettings(page);
  await page.getByTestId('reload-themes').click();
  const select = page.getByTestId('settings-theme-light');
  const option = select.locator('option[value="midnight-ocean"]');
  await expect(option).toHaveCount(1);
  await expect(option).toHaveText(/Midnight Ocean/);
  await select.selectOption('midnight-ocean');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(1, 2, 3)');
});

test('E4: hotkey toggles into edit mode showing markdown source; editing reflects in preview after toggling back', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.cm-content')).toContainText('# Welcome to Marky Mark');
  await expect(page.getByTestId('doc')).toHaveCount(0); // swap, never side-by-side

  // Click the first line (the H1) so the typed text lands in rendered output,
  // not in a non-rendering spot like a table delimiter or fence info string.
  await editor.locator('.cm-line').first().click();
  await page.keyboard.type('EDITMARK ');

  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('doc')).toContainText('EDITMARK');
});

test('E5: Cmd/Ctrl+S in edit mode persists the buffer to disk and clears the dirty indicator', async ({ page }) => {
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('SAVEMARK ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const onDisk = await fsRead(page, WELCOME);
  expect(onDisk).toContain('SAVEMARK');
});

test('E6: remapping the edit-toggle hotkey in settings takes effect immediately; the old combo stops working', async ({
  page,
}) => {
  await openSettings(page, 'hotkeys');
  await page.getByTestId('hotkey-toggleEdit').click();
  // SPEC34: the fixture combo moved off Mod+Shift+E — that is now the
  // folder sidebar's DEFAULT binding, so the conflict detector (rightly)
  // refuses it. The test's semantics are unchanged: remap, old dies, new works.
  await page.keyboard.press('Control+Shift+Y');
  await page.getByTestId('settings-close').click();

  await page.keyboard.press('Control+e'); // old combo — must do nothing
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('doc')).toBeVisible();

  await page.keyboard.press('Control+Shift+Y'); // new combo
  await expect(page.getByTestId('editor')).toBeVisible();

  // Persisted to settings.json in the config dir.
  const settings = await fsRead(page, '/config/settings.json');
  expect(settings).toContain('"toggleEdit": "Mod+Shift+Y"'); // the REBOUND key, precisely
});

test('E7: select text → Add comment → highlight in DOM and card in panel with the body text', async ({ page }) => {
  await selectPhrase(page, PHRASE);
  await expect(page.getByTestId('add-comment-btn')).toBeVisible();
  await page.getByTestId('add-comment-btn').click();
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.getByTestId('composer-input').fill('First note');
  await page.getByTestId('composer-submit').click();

  const mark = page.locator('mark.hl');
  await expect(mark.first()).toBeVisible();
  await expect(mark.first()).toContainText('saved to a sidecar file');
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('First note');
});

test('E8: comments, highlights, and thread state persist across reload via the sidecar', async ({ page }) => {
  await addComment(page, PHRASE, 'Persistent note');
  await waitForSidecar(page, (s) => !!s && s.includes('Persistent note'));

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('Persistent note');
  await expect(page.locator('mark.hl').first()).toBeVisible();

  const sidecar = await fsRead(page, WELCOME_SIDECAR);
  expect(sidecar).toContain('"exact"');
  expect(sidecar).toContain('"prefix"');
  expect(sidecar).toContain('"suffix"');
});

test('E9: reply, edit reply, resolve (highlight gone, card in Resolved), reopen (highlight returns)', async ({
  page,
}) => {
  // SPEC7 §4 flipped the showResolved default to true; this test exercises
  // the collapsed-section behavior, so turn it off explicitly (assertions
  // below are unchanged from SPEC2).
  await openSettings(page, 'general');
  await page.getByTestId('show-resolved').uncheck();
  await page.getByTestId('settings-close').click();

  await addComment(page, PHRASE, 'Root comment');

  await page.getByTestId('reply-btn').click();
  await page.getByTestId('reply-input').fill('A reply');
  await page.getByTestId('submit-reply').click();
  await expect(page.getByTestId('thread-entry')).toHaveCount(2);
  await expect(page.getByTestId('reply-body')).toHaveText('A reply');

  await page.getByTestId('edit-reply').click();
  await page.getByTestId('edit-input').fill('An edited reply');
  await page.getByTestId('save-edit').click();
  await expect(page.getByTestId('reply-body')).toHaveText('An edited reply');

  await page.getByTestId('resolve-btn').click();
  await expect(page.locator('mark.hl')).toHaveCount(0);
  const resolvedSection = page.getByTestId('resolved-section');
  await expect(resolvedSection).toContainText('Resolved (1)');
  await resolvedSection.locator('summary').click();
  await expect(resolvedSection.getByTestId('comment-card')).toHaveCount(1);

  await resolvedSection.getByTestId('reopen-btn').click();
  await expect(page.locator('mark.hl').first()).toBeVisible();
});

test('E10: a comment spanning two blocks highlights in both; deleting it (confirmed) removes card and sidecar entry', async ({
  page,
}) => {
  // From inside the "Reading" paragraph into the blockquote further down.
  await selectSpan(page, 'GitHub-flavored markdown', 'A task list');
  await page.getByTestId('add-comment-btn').click();
  await page.getByTestId('composer-input').fill('Spanning comment');
  await page.getByTestId('composer-submit').click();

  const markCount = await page.locator('mark.hl').count();
  expect(markCount).toBeGreaterThanOrEqual(2);
  await waitForSidecar(page, (s) => !!s && s.includes('Spanning comment'));

  await page.getByTestId('delete-btn').click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);
  // Last comment deleted → the sidecar file itself is removed.
  await waitForSidecar(page, (s) => s === null);
});

test('E11: edit-survival — inserting a paragraph near the top re-anchors the comment to the same text', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'Survivor');
  await waitForSidecar(page, (s) => !!s && s.includes('Survivor'));

  const md = (await fsRead(page, WELCOME))!;
  const edited = md.replace(
    '## Reading',
    'A freshly inserted paragraph that shifts every offset in this document by a good amount.\n\n## Reading'
  );
  expect(edited).not.toBe(md);
  await fsWrite(page, WELCOME, edited);

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  const highlighted = await page.locator('mark.hl').allTextContents();
  expect(highlighted.join('')).toBe(PHRASE);
  await expect(page.getByTestId('orphan-badge')).toHaveCount(0);
});

test('E12: orphan — deleting the anchored sentence yields an orphan badge, no highlight, no console errors', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'Orphan-to-be');
  await waitForSidecar(page, (s) => !!s && s.includes('Orphan-to-be'));

  const md = (await fsRead(page, WELCOME))!;
  const sentence =
    'Your note is saved to a sidecar file next to the document (`welcome.md.comments.json`), so the markdown itself stays untouched.';
  expect(md).toContain(sentence);
  await fsWrite(page, WELCOME, md.replace(sentence, ''));

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('orphan-badge')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toContainText('Orphan-to-be');
  await expect(page.locator('mark.hl')).toHaveCount(0);
  // consoleGuard fixture asserts zero console errors at teardown.
});

test('E13: toolbar is minimal — one overflow menu with exactly Open/Save/Save As/Settings; menu Save persists', async ({
  page,
}) => {
  // Old toolbar buttons are gone.
  await expect(page.getByTestId('theme-picker')).toHaveCount(0);
  await expect(page.getByTestId('open-file')).toHaveCount(0);
  await expect(page.getByTestId('settings-btn')).toHaveCount(0);

  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  const menu = page.getByTestId('app-menu');
  await expect(menu.getByTestId('menu-new')).toBeVisible(); // SPEC21 §5.6 amendment
  await expect(menu.getByTestId('menu-open')).toBeVisible();
  await expect(menu.getByTestId('menu-save')).toBeVisible();
  await expect(menu.getByTestId('menu-save-as')).toBeVisible();
  await expect(menu.getByTestId('menu-help')).toBeVisible();
  await expect(menu.getByTestId('menu-about')).toBeVisible();
  await expect(menu.getByTestId('menu-settings')).toBeVisible();
  await expect(menu.locator('button')).toHaveCount(7); // exactly these seven (SPEC4 §5.2 + SPEC10 §6 + SPEC21)
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

test('E15: embedded mode — comments autosave into an invisible trailer, sidecar removed, reload restores', async ({
  page,
}) => {
  // Seed a sidecar first so the migration (sidecar → embedded) is exercised.
  await addComment(page, PHRASE, 'Embedded note');
  await waitForSidecar(page, (s) => !!s && s.includes('Embedded note'));

  await openSettings(page, 'general');
  await page.getByTestId('comment-storage').selectOption('embedded');
  await page.getByTestId('settings-close').click();

  // Any comment change triggers the embedded autosave + sidecar cleanup.
  await page.getByTestId('reply-btn').click();
  await page.getByTestId('reply-input').fill('embedded reply');
  await page.getByTestId('submit-reply').click();

  await expect.poll(async () => (await fsRead(page, WELCOME))?.includes('marky-mark-comments')).toBe(true);
  await expect.poll(async () => fsRead(page, WELCOME_SIDECAR), { timeout: 5000 }).toBe(null);
  const onDisk = (await fsRead(page, WELCOME))!;
  expect(onDisk).toContain('Embedded note');
  expect(onDisk.trimEnd().endsWith('-->')).toBe(true);

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('card-body')).toHaveText('Embedded note');
  await expect(page.locator('mark.hl').first()).toBeVisible();

  // The trailer is invisible everywhere: preview text and edit buffer.
  await expect(page.getByTestId('doc')).not.toContainText('marky-mark-comments');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('marky-mark-comments');
});

test('E16: embedded autosave never flushes unsaved text edits; explicit save writes both', async ({ page }) => {
  await openSettings(page, 'general');
  await page.getByTestId('comment-storage').selectOption('embedded');
  await page.getByTestId('settings-close').click();

  // Dirty the buffer without saving.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTYMARK ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Comment autosave rewrites the file from the LAST SAVED text.
  await addComment(page, PHRASE, 'while dirty');
  await expect.poll(async () => (await fsRead(page, WELCOME))?.includes('marky-mark-comments')).toBe(true);
  const afterAutosave = (await fsRead(page, WELCOME))!;
  expect(afterAutosave).not.toContain('DIRTYMARK');
  expect(afterAutosave).toContain('while dirty');
  await expect(page.getByTestId('dirty-dot')).toBeVisible(); // still dirty

  // Explicit save writes buffer + trailer together.
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const afterSave = (await fsRead(page, WELCOME))!;
  expect(afterSave).toContain('DIRTYMARK');
  expect(afterSave).toContain('marky-mark-comments');
  expect(afterSave).toContain('while dirty');
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

test('E18: Save As writes the buffer (and sidecar) to the chosen path and switches to it', async ({ page }) => {
  await addComment(page, PHRASE, 'travels along');
  await waitForSidecar(page, (s) => !!s && s.includes('travels along'));

  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/copy.md';
  });
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-save-as').click();

  await expect(page.getByTestId('docname')).toContainText('copy.md');
  await expect(page.getByTestId('docname')).toHaveAttribute('title', '/docs/copy.md');
  const copied = await fsRead(page, '/docs/copy.md');
  expect(copied).toContain('# Welcome to Marky Mark');
  // Sidecar mode: comments were written next to the NEW file and still show.
  const sidecar = await fsRead(page, '/docs/copy.md.comments.json');
  expect(sidecar).toContain('travels along');
  await expect(page.getByTestId('card-body')).toHaveText('travels along');
});

test('E19: customized font size applies to the document; Auto restores the theme default', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('fontsize-custom').check();
  await page.getByTestId('fontsize-input').fill('20');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('20px');

  await page.getByTestId('fontsize-auto').check();
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('16px'); // Crisp's --mm-font-size
});

test('E20: zoom scales only the document text — the settings UI keeps its size; Reset restores 100%', async ({
  page,
}) => {
  await openSettings(page);
  // Let the async settings load apply the default font override first —
  // the baseline must be the settled UI, not the boot-time theme value.
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('12px');
  const modalFontBefore = await page.getByTestId('settings-panel').evaluate((el) => getComputedStyle(el).fontSize);

  await page.getByTestId('zoom-select').selectOption('150');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('18px'); // 12px default × 1.5 — document text only

  // The UI is NOT zoomed: settings modal font size unchanged, root not CSS-zoomed.
  expect(await page.getByTestId('settings-panel').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
    modalFontBefore
  );
  expect(await page.locator('.theme-root').evaluate((el) => getComputedStyle(el).zoom)).toBe('1');

  await page.getByTestId('zoom-reset').click();
  await expect(page.getByTestId('zoom-select')).toHaveValue('100');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('12px');
});

test('E21: light/dark theme pair follows the OS scheme; unchecking uses the light theme everywhere', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('crisp');
  await page.getByTestId('settings-theme-dark').selectOption('one-dark');
  const useDark = page.getByTestId('use-dark-theme');
  if (!(await useDark.isChecked())) await useDark.check();
  await page.getByTestId('settings-close').click();

  const bg = () => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe('rgb(40, 44, 52)'); // One Dark #282c34
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(bg).toBe('rgb(255, 255, 255)'); // Crisp

  // Uncheck "Use separate theme in dark mode" → dark scheme keeps the light theme.
  await openSettings(page);
  await page.getByTestId('use-dark-theme').uncheck();
  await page.getByTestId('settings-close').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe('rgb(255, 255, 255)');
});

test('E22: Wide text margins narrow the column; line numbers gutter follows its setting', async ({ page }) => {
  // The app default is the super-narrow 76rem column (narrowest margins).
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).maxWidth))
    .toBe('1216px');

  await openSettings(page);
  await page.getByTestId('settings-margins').selectOption('super-narrow');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).maxWidth))
    .toBe('1216px'); // 76rem — even fewer margins than narrow

  await page.getByTestId('settings-margins').selectOption('wide');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).maxWidth))
    .toBe('608px'); // 38rem
  await page.getByTestId('settings-close').click();

  // Default: gutter present.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-lineNumbers')).toBeVisible();
  await page.keyboard.press('Control+e');

  await openSettings(page, 'general');
  await page.getByTestId('settings-line-numbers').uncheck();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('editor').locator('.cm-lineNumbers')).toHaveCount(0);
});

test('E23: vim navigation — off by default, full motion set when enabled, never fires while typing', async ({
  page,
}) => {
  const scrollTop = () => page.locator('.workspace').evaluate((el) => el.scrollTop);

  // Disabled (default): j does nothing.
  await revealToolbar(page);
  await page.getByTestId('docname').click();
  await page.keyboard.press('j');
  await page.waitForTimeout(150);
  expect(await scrollTop()).toBe(0);

  await openSettings(page, 'general');
  await page.getByTestId('settings-vimnav').check();
  await page.getByTestId('settings-close').click();

  // j scrolls down, k back up.
  await page.keyboard.press('j');
  await expect.poll(scrollTop).toBeGreaterThan(0);
  const afterJ = await scrollTop();
  await page.keyboard.press('k');
  await expect.poll(scrollTop).toBeLessThan(afterJ);

  // Ctrl+d jumps about half a viewport; gg returns to top; G reaches bottom.
  await page.keyboard.press('Control+d');
  const viewport = await page.locator('.workspace').evaluate((el) => el.clientHeight);
  await expect.poll(scrollTop).toBeGreaterThanOrEqual(viewport / 2 - 80);
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(scrollTop).toBe(0);
  await page.keyboard.press('Shift+G');
  const max = await page.locator('.workspace').evaluate((el) => el.scrollHeight - el.clientHeight);
  await expect.poll(scrollTop).toBeGreaterThanOrEqual(max - 2);

  // Typing j into the composer inserts a "j" and does not scroll.
  await page.keyboard.press('g'); // reset: gg to top
  await page.keyboard.press('g');
  await expect.poll(scrollTop).toBe(0);
  await selectPhrase(page, PHRASE);
  await page.getByTestId('add-comment-btn').click();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  // Bring the composer on-screen first — otherwise Chromium scrolls the
  // focused textarea into view on the first keystroke (unrelated to vim nav).
  await page.getByTestId('composer-input').scrollIntoViewIfNeeded();
  // Let the composer autofocus/card-alignment scrolling settle, then measure.
  await expect
    .poll(async () => {
      const a = await scrollTop();
      await page.waitForTimeout(120);
      return (await scrollTop()) - a;
    })
    .toBe(0);
  const composerScroll = await scrollTop();
  await page.getByTestId('composer-input').pressSequentially('jjj');
  await expect(page.getByTestId('composer-input')).toHaveValue('jjj');
  expect(await scrollTop()).toBe(composerScroll);
});

test('E24: the new Claude theme — Typora-derived paper, serif body, tight headings, 752px column', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('claude');
  // The margins setting now defaults to super-narrow, which overrides any
  // theme column — this test is about the THEME's own width, so pick
  // "Theme default" explicitly.
  await page.getByTestId('settings-margins').selectOption('default');
  await page.getByTestId('settings-close').click();

  const doc = page.getByTestId('doc');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(250, 249, 245)'); // #faf9f5 paper
  expect(await doc.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia'); // serif body stack
  await expect.poll(() => doc.evaluate((el) => getComputedStyle(el).maxWidth)).toBe('960px'); // 60rem (SPEC4 §7)
  expect(await doc.locator('h1').first().evaluate((el) => getComputedStyle(el).fontSize)).toBe('22px'); // 1.375rem
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
  await page.reload();
  // SPEC30 §4.1 amendment: the relaunch reopens the last document now.
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  const shell = page.getByTestId('toolbar-shell');
  // Visible during the launch grace period…
  await expect(shell).toHaveAttribute('data-visible', 'true');
  // …then slides up and away (grace ≈ 2.5 s).
  await expect(shell).toHaveAttribute('data-visible', 'false', { timeout: 6000 });
  const ty = await shell.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);
  expect(ty).toBeLessThan(-30); // moved out through the top

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

test('E26: settings shows four left tabs with the right content on each; controls work through their tabs', async ({
  page,
}) => {
  await openSettings(page);
  const tabs = page.getByTestId('settings-tabs');
  await expect(tabs.locator('button')).toHaveCount(4); // SPEC20 §1 added Editor
  await expect(page.getByTestId('settings-tab-appearance')).toHaveClass(/active/); // default tab

  // Appearance: font size present, General/Hotkeys content absent.
  await expect(page.getByTestId('fontsize-auto')).toBeVisible();
  await expect(page.getByTestId('comment-storage')).toHaveCount(0);
  await expect(page.getByTestId('hotkey-toggleEdit')).toHaveCount(0);

  // General: comments + navigation, no appearance controls.
  await page.getByTestId('settings-tab-general').click();
  await expect(page.getByTestId('comment-storage')).toBeVisible();
  await expect(page.getByTestId('settings-vimnav')).toBeVisible();
  await expect(page.getByTestId('zoom-select')).toHaveCount(0);

  // Hotkeys tab.
  await page.getByTestId('settings-tab-hotkeys').click();
  await expect(page.getByTestId('hotkey-toggleEdit')).toBeVisible();
  await expect(page.getByTestId('fontsize-auto')).toHaveCount(0);

  // A control still works through its tab: change author in General, persists.
  await page.getByTestId('settings-tab-general').click();
  await page.getByTestId('author-input').fill('TabTester');
  await page.getByTestId('settings-close').click();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('TabTester');
});

test('E27: opening another file with unsaved changes prompts Save / Don’t save / Cancel; clean opens never prompt', async ({
  page,
}) => {
  // Clean buffer → Open another file via the dialog: no prompt.
  page.once('dialog', (d) => void d.accept('/docs/field-guide.md'));
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-open').click();
  await expect(page.getByTestId('docname')).toContainText('field-guide.md');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);

  // Dirty the buffer.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('GUARDMARK ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Help (a different file) → prompt. Cancel keeps everything.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('docname')).toContainText('field-guide.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Help again → Don't save: welcome opens, the edit never reached disk.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click();
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  expect(await fsRead(page, '/docs/field-guide.md')).not.toContain('GUARDMARK');

  // Dirty welcome, then Open field-guide → Save: edit persisted, then opened.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('GUARDMARK2 ');
  await page.keyboard.press('Control+e');
  page.once('dialog', (d) => void d.accept('/docs/field-guide.md'));
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-open').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-save').click();
  await expect(page.getByTestId('docname')).toContainText('field-guide.md');
  expect(await fsRead(page, WELCOME)).toContain('GUARDMARK2');
});

test('E28: the toolbar title slot shows the app badge when empty; titles say Marky Mark', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  const docname = page.getByTestId('docname');
  await expect(docname.getByTestId('app-badge')).toBeVisible();
  expect(await docname.evaluate((el) => el.querySelector('svg') !== null)).toBe(true);
  expect((await docname.textContent())?.trim()).toBe(''); // icon only — no app-name text

  expect(await page.title()).toContain('Marky Mark');
  expect(await page.title()).not.toContain('Markimark');

  // With a document open, the filename replaces the badge.
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

  // Hover reveals; disabling the setting pins it permanently again.
  await page.mouse.move(500, 8);
  await expect(shell).toHaveAttribute('data-visible', 'true');
  await openSettings(page, 'general');
  await page.getByTestId('settings-autohide').uncheck();
  await page.getByTestId('settings-close').click();
  await page.mouse.move(500, 400);
  await page.waitForTimeout(TOOLBAR_WAIT);
  await expect(shell).toHaveAttribute('data-visible', 'true');
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
  await openSettings(page, 'general');
  await page.getByTestId('settings-line-numbers').uncheck();
  await page.getByTestId('set-split-edit').uncheck();
  await page.getByTestId('settings-close').click();

  const p1 = await previewTextLeft();
  await page.keyboard.press('Control+e');
  expect(Math.abs((await editorTextLeft()) - p1)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Control+e');

  // Margins move both columns together.
  await openSettings(page);
  await page.getByTestId('settings-margins').selectOption('wide');
  await page.getByTestId('settings-close').click();
  const p2 = await previewTextLeft();
  expect(p2).toBeGreaterThan(p1); // narrower column starts further right
  await page.keyboard.press('Control+e');
  expect(Math.abs((await editorTextLeft()) - p2)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Control+e');

  // With the gutter on, the text may shift by at most the gutter width.
  await openSettings(page, 'general');
  await page.getByTestId('settings-line-numbers').check();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  const gutterW = await page.locator('.cm-gutters').evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs((await editorTextLeft()) - p2)).toBeLessThanOrEqual(gutterW + 2);
});

test('E32: activating a buried comment glides it level with its highlight; cards wear a faint shadow', async ({
  page,
}) => {
  // Three comments anchored inside one paragraph → a stack near one line.
  await addComment(page, 'saved to a sidecar file', 'first note');
  await addComment(page, 'markdown itself stays untouched', 'second note');
  await addComment(page, 'cards instead of being lost', 'third note');
  await expect(page.getByTestId('comment-card')).toHaveCount(3);

  // Cards have the faint balloon shadow.
  const shadow = await page.getByTestId('comment-card').first().evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe('none');

  // Activate the LAST card (bottom of the stack).
  const third = page.locator('[data-testid="comment-card"]', { hasText: 'third note' });
  await third.click();
  await expect(third).toHaveClass(/active/);

  // Word behavior: its top animates level with its highlight (±10 px).
  await expect
    .poll(async () => {
      const cardTop = (await third.boundingBox())!.y;
      const markTop = (await page
        .locator('mark.hl')
        .filter({ hasText: 'instead of being lost' })
        .first()
        .boundingBox())!.y;
      return Math.abs(cardTop - markTop);
    })
    .toBeLessThanOrEqual(10);

  // The earlier cards moved out of the way (fully above the active card) —
  // polled, since their 180ms glide finishes after the active card's does.
  const first = page.locator('[data-testid="comment-card"]', { hasText: 'first note' });
  await expect
    .poll(async () => {
      const f = (await first.boundingBox())!;
      const t = (await third.boundingBox())!;
      return f.y + f.height - t.y;
    })
    .toBeLessThanOrEqual(0);
});

test('E33: resolved comments can be shown ghosted in place, reopened from the ghost, and re-collapsed', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'ghost me');
  await page.getByTestId('resolve-btn').click();

  // Show-resolved defaults ON (SPEC7 §4): ghost card in the flow + ghost
  // highlight in the text, with the toggle now living in Settings.
  const ghost = page.locator('.card.resolved-ghost');
  await expect(ghost).toHaveCount(1);
  await expect(ghost).toContainText('ghost me');
  expect(await ghost.evaluate((el) => parseFloat(getComputedStyle(el).opacity))).toBeLessThan(1);
  await expect(page.locator('mark.hl.ghost').first()).toBeVisible();
  await expect(page.getByTestId('resolved-section')).toHaveCount(0);

  // Reopen from the ghost: normal card + normal highlight return.
  await ghost.getByTestId('reopen-btn').click();
  await expect(page.locator('.card.resolved-ghost')).toHaveCount(0);
  await expect(page.locator('mark.hl:not(.ghost)').first()).toBeVisible();
  await expect(page.getByTestId('card-body')).toHaveText('ghost me');

  // Resolve again and turn the toggle off (in Settings) → collapsed section.
  await page.getByTestId('resolve-btn').click();
  await openSettings(page, 'general');
  await page.getByTestId('show-resolved').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('resolved-section')).toContainText('Resolved (1)');
  await expect(page.locator('mark.hl')).toHaveCount(0);
});

test('E34: the theme catalog lists 27+ themes; new classics apply their canonical backgrounds', async ({
  page,
}) => {
  await openSettings(page);
  const select = page.getByTestId('settings-theme-light');
  expect(await select.locator('option').count()).toBeGreaterThanOrEqual(27);

  const bg = () => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);

  await select.selectOption('gruvbox-dark');
  await expect.poll(bg).toBe('rgb(40, 40, 40)'); // #282828

  await select.selectOption('github-dark');
  await expect.poll(bg).toBe('rgb(13, 17, 23)'); // #0d1117

  await select.selectOption('phosphor');
  await expect.poll(bg).toBe('rgb(10, 15, 10)'); // near-black CRT
  // Phosphor is a mono theme — the document body uses a monospace stack.
  expect(
    await page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase())
  ).toContain('mono');
});

test('E35: the settings dialog keeps one fixed size across all three tabs', async ({ page }) => {
  await openSettings(page);
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const tab of ['appearance', 'general', 'hotkeys'] as const) {
    await page.getByTestId(`settings-tab-${tab}`).click();
    await expect(page.getByTestId(`settings-tab-${tab}`)).toHaveClass(/active/);
    boxes.push((await page.getByTestId('settings-panel').boundingBox())!);
  }
  for (const b of boxes.slice(1)) {
    expect(Math.abs(b.width - boxes[0].width)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - boxes[0].height)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.x - boxes[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y - boxes[0].y)).toBeLessThanOrEqual(1);
  }
});

test('E36: disabling comments hides every comment affordance non-destructively; re-enabling restores', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'still here');
  await waitForSidecar(page, (s) => !!s && s.includes('still here'));
  await expect(page.locator('mark.hl').first()).toBeVisible();
  await expect(page.getByTestId('comments-toggle')).toBeVisible();

  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').uncheck();
  await page.getByTestId('settings-close').click();

  // Highlights, panel, and the toolbar toggle are gone — the doc reads clean.
  await expect(page.locator('mark.hl')).toHaveCount(0);
  await expect(page.getByTestId('panel')).toHaveCount(0);
  await expect(page.getByTestId('comments-toggle')).toHaveCount(0);

  // Selecting text produces no floating button, and typing starts no composer.
  await selectPhrase(page, PHRASE);
  await page.waitForTimeout(200);
  await expect(page.getByTestId('add-comment-btn')).toHaveCount(0);
  await page.keyboard.press('x');
  await page.waitForTimeout(150);
  await expect(page.getByTestId('composer')).toHaveCount(0);

  // The stored comment was never touched.
  expect(await fsRead(page, WELCOME_SIDECAR)).toContain('still here');

  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').check();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.locator('mark.hl').first()).toBeVisible();
  await expect(page.getByTestId('comments-toggle')).toBeVisible();
});

test('E37: typing over a selection opens the composer seeded with the keystroke; off → button only', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await expect(page.getByTestId('add-comment-btn')).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toHaveValue('x');
  await expect(page.getByTestId('composer-input')).toBeFocused();
  // The caret sits after the seed: continuing to type appends.
  await page.keyboard.type('yz');
  await expect(page.getByTestId('composer-input')).toHaveValue('xyz');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('card-body')).toHaveText('xyz');

  // Setting off → typing over a selection does nothing; the button still works.
  await openSettings(page, 'general');
  await page.getByTestId('set-type-to-comment').uncheck();
  await page.getByTestId('settings-close').click();
  await selectPhrase(page, 'GitHub-flavored markdown');
  await expect(page.getByTestId('add-comment-btn')).toBeVisible();
  await page.keyboard.press('q');
  await page.waitForTimeout(150);
  await expect(page.getByTestId('composer')).toHaveCount(0);
});

test('E38: resolving defaults to a faint ghost in place; the toggle lives in Settings, not the panel', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'fade me');
  await page.getByTestId('resolve-btn').click();

  // The panel grew no header toggle — the switch moved to Settings (SPEC7 §4).
  await expect(page.getByTestId('panel').getByTestId('show-resolved')).toHaveCount(0);

  // Default ON: the ghost card renders in the flow at 0.40 opacity (±0.02).
  const ghost = page.locator('.card.resolved-ghost');
  await expect(ghost).toHaveCount(1);
  await page.mouse.move(30, 300); // hover brightens ghosts; measure unhovered
  await expect
    .poll(() => ghost.evaluate((el) => parseFloat(getComputedStyle(el).opacity)))
    .toBeGreaterThanOrEqual(0.38);
  await expect
    .poll(() => ghost.evaluate((el) => parseFloat(getComputedStyle(el).opacity)))
    .toBeLessThanOrEqual(0.42);
  await expect(page.locator('mark.hl.ghost').first()).toBeVisible();

  // Turning the setting off collapses resolved comments as before.
  await openSettings(page, 'general');
  await page.getByTestId('show-resolved').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('resolved-section')).toContainText('Resolved (1)');
  await expect(page.locator('mark.hl')).toHaveCount(0);
});

test('E39: side-by-side edit shows editor plus live preview; typing updates the right pane', async ({ page }) => {
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await page.getByTestId('settings-close').click();

  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(page.getByTestId('split-preview').locator('h1')).toContainText('Welcome to Marky Mark');

  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('LIVEMARK ');
  await expect(page.getByTestId('split-preview')).toContainText('LIVEMARK', { timeout: 1000 });

  // The toggle returns to the reading preview (comments surface).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
});

test('E40: the split divider drags within bounds, persists its ratio, and double-click resets', async ({
  page,
}) => {
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');

  const wsBox = (await page.locator('.workspace.split').boundingBox())!;
  const editorFraction = async () => {
    const e = (await page.locator('.split-editor').boundingBox())!;
    return e.width / wsBox.width;
  };
  expect(Math.abs((await editorFraction()) - 0.5)).toBeLessThanOrEqual(0.05);

  // Drag the divider to ~30% of the window.
  const divider = page.getByTestId('split-divider');
  const d1 = (await divider.boundingBox())!;
  await page.mouse.move(d1.x + d1.width / 2, d1.y + 200);
  await page.mouse.down();
  await page.mouse.move(wsBox.x + wsBox.width * 0.3, d1.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect.poll(editorFraction).toBeGreaterThanOrEqual(0.25);
  await expect.poll(editorFraction).toBeLessThanOrEqual(0.35);

  // The ratio survives leaving and re-entering edit mode, and reaches disk.
  await page.keyboard.press('Control+e');
  await page.keyboard.press('Control+e');
  await expect.poll(editorFraction).toBeLessThanOrEqual(0.35);
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { splitRatio?: number }).splitRatio : null;
    })
    .toBeLessThanOrEqual(0.35);

  // Dragging far left clamps at the 0.2 floor.
  const d2 = (await divider.boundingBox())!;
  await page.mouse.move(d2.x + d2.width / 2, d2.y + 200);
  await page.mouse.down();
  await page.mouse.move(wsBox.x + 5, d2.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect.poll(editorFraction).toBeGreaterThanOrEqual(0.19);
  await expect.poll(editorFraction).toBeLessThanOrEqual(0.22);

  // Double-click resets to an even split.
  await divider.dblclick();
  await expect.poll(editorFraction).toBeGreaterThanOrEqual(0.45);
  await expect.poll(editorFraction).toBeLessThanOrEqual(0.55);
});

test('E41: undo/redo hotkeys work for edits, and history survives a preview↔edit toggle', async ({ page }) => {
  await page.keyboard.press('Control+e');
  const content = page.getByTestId('editor').locator('.cm-content');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('UNDOMARK');
  await expect(content).toContainText('UNDOMARK');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).not.toContainText('UNDOMARK');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(content).toContainText('UNDOMARK');

  // Toggle to preview and back: the pre-toggle edit is still undoable.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toContainText('UNDOMARK');
  await page.keyboard.press('Control+e');
  await expect(content).toContainText('UNDOMARK');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).not.toContainText('UNDOMARK');
});

// E42–E44 are reserved for SPEC8 (scroll continuity), which stays unimplemented.

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

// --- SPEC12: native desktop menus & chromeless window (shim ?nativeMenu=1) ------

/** Re-launch the shim in desktop-menu mode: no header, spec on window.__mmMenu. */
async function freshNativeMenuApp(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?nativeMenu=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload(); // fresh boot — fixtures re-seed
  await expect(page.getByTestId('empty-hint')).toBeVisible(); // shim ready
  // Same pane-floor pin as freshApp — see helpers.ts.
  await page.evaluate(() =>
    window.__mmfs!.write('/config/settings.json', JSON.stringify({ paneMinWidth: 240 }))
  );
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
}

const menuClick = (page: import('@playwright/test').Page, command: string) =>
  page.evaluate((c) => window.__mmMenu!.click(c), command);

const menuItem = (page: import('@playwright/test').Page, command: string) =>
  page.evaluate(
    (c) =>
      window
        .__mmMenu!.spec!.submenus.flatMap((m) => m.items)
        .find((i) => i.type === 'command' && i.command === c) as
        | { label: string; checked?: boolean }
        | undefined,
    command
  );

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
  // The document area starts at the very top of the window.
  const box = await page.locator('.workspace').boundingBox();
  expect(box!.y).toBe(0);

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
  await expect(sp.getByTestId('settings-line-numbers')).toBeVisible();
  await expect(sp.getByTestId('settings-autohide')).toHaveCount(0);
  // Force a settings write; the autoHideToolbar key must survive it (SPEC12 §4.2).
  // Persistence still goes through the main window — the sole settings owner.
  await sp.getByTestId('settings-line-numbers').click();
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? 'autoHideToolbar' in (JSON.parse(raw) as Record<string, unknown>) : false;
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

// --- SPEC13: native Settings & About windows (shim popups + BroadcastChannel) ----

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

  // Toggle line numbers in the popup → the main editor gutter reacts live…
  await sp.getByTestId('settings-tab-general').click();
  await sp.getByTestId('settings-line-numbers').click();
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
  // …and persists through the main window (the sole owner of settings.json).
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { lineNumbers?: boolean }).lineNumbers : undefined;
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

// --- SPEC14: comment navigation (hotkeys + fixed navigator pill) ----------------

// Three phrases from fixtures/welcome.md, in document order.
const NAV_P1 = 'lightweight, fast markdown viewer';
const NAV_P2 = 'renders GitHub-flavored markdown';
const NAV_P3 = 'seven built-in themes';

test('E54: fixed navigator pill — appears on selection, steps in order, wraps, never moves; click-away dismisses', async ({
  page,
}) => {
  await addComment(page, NAV_P1, 'first');
  await addComment(page, NAV_P2, 'second');
  await addComment(page, NAV_P3, 'third');

  // Start from a clean deactivated state, then select the first comment.
  await page.getByTestId('doc').locator('h1').click();
  await expect(page.getByTestId('comment-nav')).toBeHidden(); // fades out, stays mounted
  await page.locator('mark.hl').first().click();
  await expect(page.getByTestId('comment-nav')).toBeVisible();
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 3');

  // The don't-move-the-mouse guarantee: once shown, stepping never moves the
  // pill (measure after the first step so the entrance slide has settled —
  // the invariant is about stepping, not the appear animation).
  await page.getByTestId('comment-nav-next').click();
  await expect(page.getByTestId('comment-nav-count')).toHaveText('2 / 3');
  const box = await page.getByTestId('comment-nav').boundingBox();
  await page.getByTestId('comment-nav-next').click();
  await expect(page.getByTestId('comment-nav-count')).toHaveText('3 / 3');
  expect(await page.getByTestId('comment-nav').boundingBox()).toEqual(box);
  await page.getByTestId('comment-nav-next').click(); // wrap forward
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 3');
  expect(await page.getByTestId('comment-nav').boundingBox()).toEqual(box);
  await page.getByTestId('comment-nav-prev').click(); // wrap back
  await expect(page.getByTestId('comment-nav-count')).toHaveText('3 / 3');
  expect(await page.getByTestId('comment-nav').boundingBox()).toEqual(box);
  // Stepping keeps an active highlight in the document and never killed the pill.
  await expect(page.locator('mark.hl.active').first()).toBeVisible();

  // Click-away (not on a mark) deactivates and the pill disappears.
  await page.getByTestId('doc').locator('h1').click();
  await expect(page.getByTestId('comment-nav')).toBeHidden(); // fades out, stays mounted
});

test('E55: nav hotkeys — defaults enter at first/last; rebinding Next takes effect immediately and persists', async ({
  page,
}) => {
  await addComment(page, NAV_P1, 'first');
  await addComment(page, NAV_P3, 'second');

  await page.getByTestId('doc').locator('h1').click(); // deactivate
  await expect(page.getByTestId('comment-nav')).toBeHidden(); // fades out, stays mounted
  await page.keyboard.press('Control+Alt+ArrowDown'); // nothing active → first
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 2');
  await page.getByTestId('doc').locator('h1').click();
  await page.keyboard.press('Control+Alt+ArrowUp'); // nothing active → last
  await expect(page.getByTestId('comment-nav-count')).toHaveText('2 / 2');

  await openSettings(page, 'hotkeys');
  await page.getByTestId('hotkey-nextComment').click();
  await page.keyboard.press('Control+Shift+J');
  await page.getByTestId('settings-close').click();

  await page.keyboard.press('Control+Alt+ArrowDown'); // old combo — must do nothing
  await expect(page.getByTestId('comment-nav-count')).toHaveText('2 / 2');
  await page.keyboard.press('Control+Shift+J'); // new combo — wraps 2 → 1
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 2');
  expect(await fsRead(page, '/config/settings.json')).toContain('Mod+Shift+J');
});

test('E56: the native menu carries Next/Previous Comment; clicking steps; the master switch removes them', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await addComment(page, NAV_P1, 'first');
  await addComment(page, NAV_P3, 'second');

  expect((await menuItem(page, 'nextComment'))!.label).toBe('Next Comment');
  expect((await menuItem(page, 'prevComment'))!.label).toBe('Previous Comment');
  const accel = await page.evaluate(
    () =>
      (window
        .__mmMenu!.spec!.submenus.flatMap((m) => m.items)
        .find((i) => i.type === 'command' && i.command === 'nextComment') as { accelerator?: string })?.accelerator
  );
  expect(accel).toBe('Mod+Alt+ArrowDown');

  // The last add left the second comment active — menu Next wraps to the first.
  await menuClick(page, 'nextComment');
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 2');

  // Master switch off (via the settings aux window) → both items leave the spec.
  const popup = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popup;
  await sp.getByTestId('settings-panel').waitFor();
  await sp.getByTestId('settings-tab-general').click();
  await sp.getByTestId('set-comments-enabled').click();
  await expect.poll(async () => (await menuItem(page, 'nextComment')) === undefined).toBe(true);
  await expect.poll(async () => (await menuItem(page, 'prevComment')) === undefined).toBe(true);
});

// --- SPEC15: synchronized split scrolling ---------------------------------------

/** Long fixture + doc open + edit mode (split by default, full when false). */
async function splitApp(page: import('@playwright/test').Page, split = true): Promise<void> {
  await freshApp(page);
  await page.evaluate(() => {
    const sections: string[] = [];
    for (let i = 1; i <= 40; i++) {
      sections.push(`## Marker ${i}\n`);
      if (i === 20) sections.push('```\n' + 'code line\n'.repeat(60) + '```\n');
      else sections.push(`Paragraph for section ${i}. `.repeat(8) + '\n');
    }
    window.__mmfs!.write('/docs/long.md', sections.join('\n'));
  });
  await page.evaluate((s) => {
    const raw = window.__mmfs!.read('/config/settings.json');
    const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.__mmfs!.write('/config/settings.json', JSON.stringify({ ...settings, splitEdit: s }));
  }, split);
  await page.reload(); // boot again so the app reads splitEdit from settings.json
  await page.goto('/#open=/docs/long.md'); // hashchange → the shim's onOpenFile
  await expect(page.getByTestId('doc').locator('h2').first()).toContainText('Marker 1');
  await page.keyboard.press('Control+e');
  if (split) await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
}

/** First fully/partially visible gutter line number in the editor pane. */
const editorTopGutterLine = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')!;
    const top = scroller.getBoundingClientRect().top;
    const gutters = Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement'));
    const first = gutters.find((g) => g.getBoundingClientRect().bottom > top + 1 && /\d/.test(g.textContent ?? ''));
    return first ? Number(first.textContent) : -1;
  });

/** Source lines of the anchors bracketing the given scroller's top edge. */
const previewTopAnchorLines = (page: import('@playwright/test').Page, scrollerSel = '.split-preview') =>
  page.evaluate((sel) => {
    const scroller = document.querySelector(sel)!;
    const doc = scroller.querySelector('.doc')!;
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const y = scroller.scrollTop;
    const anchors = Array.from(doc.querySelectorAll<HTMLElement>('[data-mm-line]')).map((el) => ({
      line: Number(el.dataset.mmLine),
      top: el.getBoundingClientRect().top - base,
    }));
    let before = 1;
    let after = Number.MAX_SAFE_INTEGER;
    for (const a of anchors) {
      if (a.top <= y + 1) before = a.line;
      else {
        after = a.line;
        break;
      }
    }
    return { before, after };
  }, scrollerSel);

test('E57: split scroll sync — the preview follows the editor, ends clamp, blocks stay aligned', async ({
  page,
}) => {
  await splitApp(page);
  const editor = page.locator('.cm-scroller');
  const preview = page.locator('.split-preview');

  // End clamp: editor to bottom → preview bottoms out.
  await editor.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect
    .poll(() => preview.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(3);

  // Back to top → preview zeroes.
  await editor.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => preview.evaluate((el) => el.scrollTop)).toBeLessThan(3);

  // Mid-document: the editor's top visible line falls between the preview's
  // top bracketing anchors (±one block, SPEC15 §1.2).
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.4));
  await expect
    .poll(async () => {
      const line = await editorTopGutterLine(page);
      const { before, after } = await previewTopAnchorLines(page);
      return line >= before - 5 && line <= after + 5;
    })
    .toBe(true);
});

test('E58: split scroll sync — the editor follows the preview; no feedback oscillation', async ({ page }) => {
  await splitApp(page);
  const preview = page.locator('.split-preview');

  // Scroll the preview so Marker 30 sits at the pane top.
  await preview.evaluate((el) => {
    const doc = el.querySelector('.doc')!;
    const target = Array.from(doc.querySelectorAll('h2')).find((h) => h.textContent === 'Marker 30')!;
    el.scrollTop = el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  const markerLine = await preview.evaluate((el) => {
    const target = Array.from(el.querySelectorAll<HTMLElement>('[data-mm-line]')).find(
      (n) => n.textContent === 'Marker 30'
    )!;
    return Number(target.dataset.mmLine);
  });
  await expect.poll(async () => Math.abs((await editorTopGutterLine(page)) - markerLine)).toBeLessThan(6);

  // Settle check: both panes hold still across two frames — no loop.
  await page.waitForTimeout(150);
  const snap = () =>
    page.evaluate(() => ({
      e: document.querySelector('.cm-scroller')!.scrollTop,
      p: document.querySelector('.split-preview')!.scrollTop,
    }));
  const a = await snap();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const b = await snap();
  expect(b).toEqual(a);
});

test('E59: mode toggling carries the reading position — edit ↔ preview stay on the same block', async ({
  page,
}) => {
  await splitApp(page, false); // full edit on the long doc
  const editor = page.locator('.cm-scroller');
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.5));
  await expect.poll(() => editorTopGutterLine(page)).toBeGreaterThan(1);
  const line = await editorTopGutterLine(page);

  await page.keyboard.press('Control+e'); // → preview: same block at the top
  await expect(page.getByTestId('doc').locator('h2').first()).toBeVisible();
  await expect
    .poll(async () => {
      const { before, after } = await previewTopAnchorLines(page, '.workspace');
      return line >= before - 5 && line <= after + 5;
    })
    .toBe(true);

  await page.keyboard.press('Control+e'); // → back to edit: same line at the top
  await expect.poll(() => editorTopGutterLine(page)).toBeGreaterThan(line - 6);
  expect(await editorTopGutterLine(page)).toBeLessThan(line + 6);
});

// --- SPEC16: review bundles, reading memory, palette, chip -----------------------

test('E60: reading position memory — reopening a document restores where you were, across reloads', async ({
  page,
}) => {
  await splitApp(page, false); // long doc, currently in full edit
  await page.keyboard.press('Control+e'); // back to preview
  await expect(page.getByTestId('doc').locator('h2').first()).toBeVisible();

  const ws = page.locator('.workspace');
  await ws.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.4));
  // The debounced capture lands in positions.json.
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/positions.json');
      if (!raw) return 0;
      const store = JSON.parse(raw) as { entries: Array<{ path: string; line: number }> };
      return store.entries.find((e) => e.path === '/docs/long.md')?.line ?? 0;
    })
    .toBeGreaterThan(10);
  const savedScroll = await ws.evaluate((el) => el.scrollTop);

  // Restart the app (localStorage persists): SPEC30 §2 reopens the document
  // by itself — no manual #open needed (§4.1 amendment, strengthened).
  await page.goto('/');
  await expect(page.getByTestId('doc').locator('h2').first()).toBeAttached();
  await expect
    .poll(() => page.locator('.workspace').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(savedScroll * 0.8);
  expect(await page.locator('.workspace').evaluate((el) => el.scrollTop)).toBeLessThan(savedScroll * 1.2);
});

test('E61: heading palette — Mod+K opens, fuzzy-filters, Enter jumps preview and editor; Esc closes', async ({
  page,
}) => {
  await splitApp(page, false); // long doc, entered full edit
  await page.keyboard.press('Control+e'); // back to preview
  await expect(page.getByTestId('doc').locator('h2').first()).toBeVisible();

  // Capture the source line of a mid-document marker while the DOM has it.
  const marker25Line = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll<HTMLElement>('.doc [data-mm-line]')).find(
      (h) => h.textContent === 'Marker 25'
    )!;
    return Number(el.dataset.mmLine);
  });

  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('heading-palette')).toBeVisible();
  await page.getByTestId('heading-palette-input').fill('marker 15');
  await expect(page.getByTestId('heading-palette-item').first()).toContainText('Marker 15');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('heading-palette')).toHaveCount(0);
  // The heading sits at the viewport top (±120px).
  const delta = await page.evaluate(() => {
    const ws = document.querySelector('.workspace')!;
    const el = Array.from(document.querySelectorAll('.doc h2')).find((h) => h.textContent === 'Marker 15')!;
    return Math.abs(el.getBoundingClientRect().top - ws.getBoundingClientRect().top);
  });
  expect(delta).toBeLessThan(120);

  // Esc closes without jumping.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('heading-palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('heading-palette')).toHaveCount(0);

  // Edit mode: the editor scrolls to the chosen heading's source line.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByTestId('heading-palette-input').fill('marker 25');
  await expect(page.getByTestId('heading-palette-item').first()).toContainText('Marker 25');
  await page.keyboard.press('Enter');
  // CI's 2-core runners need real time for CM's iterative scroll-measure
  // convergence (heavier since the SPEC23/30 editor extensions) — timeout
  // headroom only, the assertion is unchanged.
  await expect.poll(() => editorTopGutterLine(page), { timeout: 20000 }).toBeGreaterThan(marker25Line - 6);
  expect(await editorTopGutterLine(page)).toBeLessThan(marker25Line + 6);
});

test('E62: word-count chip — document counts, selection counts, live edit updates', async ({ page }) => {
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  const chip = page.getByTestId('word-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/^\d[\d,]* words · \d+ min$/);
  const full = await chip.textContent();
  const fullWords = Number(full!.split(' ')[0].replace(/,/g, ''));

  // Selecting a phrase shrinks the count to the selection.
  await selectPhrase(page, PHRASE);
  await expect
    .poll(async () => Number((await chip.textContent())!.split(' ')[0].replace(/,/g, '')))
    .toBeLessThan(fullWords);

  // Typing in edit mode grows the count.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('several brand new counted words ');
  await expect
    .poll(async () => Number((await chip.textContent())!.split(' ')[0].replace(/,/g, '')))
    .toBeGreaterThan(fullWords);
});

test('E64: the word-count chip toggles with Mod+Shift+W and the choice persists', async ({ page }) => {
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await expect(page.getByTestId('word-chip')).toBeVisible();

  await page.keyboard.press('Control+Shift+W');
  await expect(page.getByTestId('word-chip')).toHaveCount(0);
  // Persisted: the setting survives in settings.json…
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { showWordCount?: boolean }).showWordCount : undefined;
    })
    .toBe(false);
  // …and across a restart.
  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('word-chip')).toHaveCount(0);

  await page.keyboard.press('Control+Shift+W');
  await expect(page.getByTestId('word-chip')).toBeVisible();
});

test('E63: Export HTML writes a fully static reading page with comments as numbered notes', async ({ page }) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await addComment(page, NAV_P1, 'first review note');
  await addComment(page, NAV_P3, 'second review note');

  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/welcome.review.html';
  });
  // SPEC17: Export… opens the dialog; the defaults (HTML, both includes on)
  // produce the same bundle the old one-shot export did.
  await menuClick(page, 'exportDoc');
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByTestId('export-format-html')).toHaveCount(0); // HTML-only: no format choice
  await page.getByTestId('export-run').click();
  await expect
    .poll(async () => ((await fsRead(page, '/docs/welcome.review.html')) ? 'written' : 'missing'))
    .toBe('written');

  const page63 = (await fsRead(page, '/docs/welcome.review.html'))!;
  // SPEC18 §1: a fully static reading page — no scripts, no app, no payload.
  expect(page63).not.toContain('<script');
  expect(page63).not.toContain('mm-review-doc');
  expect(page63).toContain('<title>welcome.md</title>');
  expect(page63).toContain('Welcome to Marky Mark'); // the rendered document
  // Comments as numbered static notes.
  expect(page63).toContain('<h2>Comments</h2>');
  expect(page63).toContain('id="mm-comment-1"');
  expect(page63).toContain('href="#mm-comment-1"');
  expect(page63).toContain('first review note');
  expect(page63).toContain('second review note');
});

test('E65: the Export dialog — defaults, cancel paths, and the include options shape the bundle', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await addComment(page, NAV_P1, 'optional note');

  // Defaults: HTML, both includes on, remembered theme ('current' initially).
  await menuClick(page, 'exportDoc');
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByTestId('export-include-comments')).toBeChecked();
  await expect(page.getByTestId('export-include-wordcount')).toBeChecked();
  await expect(page.getByTestId('export-theme')).toHaveValue('current');

  // Esc cancels without exporting.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
  expect(await fsRead(page, '/docs/welcome.review.html')).toBeNull();

  // Comments off → no trailer; word count on → stats line at the end.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/welcome.review.html';
  });
  await menuClick(page, 'exportDoc');
  await page.getByTestId('export-include-comments').uncheck();
  await page.getByTestId('export-run').click();
  await expect.poll(async () => ((await fsRead(page, '/docs/welcome.review.html')) ? 'ok' : 'no')).toBe('ok');
  const artifact = (await fsRead(page, '/docs/welcome.review.html'))!;
  // Comments off ⇒ no highlights, no notes section; word count on ⇒ stats line.
  expect(artifact).not.toContain('<h2>Comments</h2>');
  expect(artifact).not.toContain('mark class="hl"');
  expect(artifact).not.toContain('optional note');
  expect(artifact).toMatch(/[\d,]+ words · \d+ min read/);
  expect(artifact).not.toContain('<script');
});

test('E66: the export theme is sticky — survives reopening the dialog and an app restart; lands in the artifact', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  await menuClick(page, 'exportDoc');
  await page.getByTestId('export-theme').selectOption('dracula');
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/sticky.review.html';
  });
  await page.getByTestId('export-run').click();
  await expect.poll(async () => ((await fsRead(page, '/docs/sticky.review.html')) ? 'ok' : 'no')).toBe('ok');
  // The chosen theme's CSS travels inside the static page.
  expect((await fsRead(page, '/docs/sticky.review.html'))!).toContain('@name: Dracula');

  // Sticky in the same session…
  await menuClick(page, 'exportDoc');
  await expect(page.getByTestId('export-theme')).toHaveValue('dracula');
  await page.getByTestId('export-cancel').click();
  expect(await fsRead(page, '/config/settings.json')).toContain('"exportTheme": "dracula"');

  // …and across a restart (wait for the menu to reinstall after boot).
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!window.__mmMenu)).toBe(true);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await menuClick(page, 'exportDoc');
  await expect(page.getByTestId('export-theme')).toHaveValue('dracula');
});

test('E67: File → Print… invokes the platform native print of the current window', async ({ page }) => {
  await freshNativeMenuApp(page);
  // No document → silent no-op.
  await menuClick(page, 'printDoc');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as { __mmPrints?: string[] }).__mmPrints?.length ?? 0)).toBe(0);

  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await menuClick(page, 'printDoc');
  await expect.poll(() => page.evaluate(() => (window as { __mmPrints?: string[] }).__mmPrints?.length ?? 0)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __mmPrints: string[] }).__mmPrints[0])).toBe(
    'print-current'
  );
});

test('E68: word count off is honored — no count anywhere in the exported page', async ({ page }) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  // HTML.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/nocount.html';
  });
  await menuClick(page, 'exportDoc');
  await page.getByTestId('export-include-wordcount').uncheck();
  await page.getByTestId('export-run').click();
  await expect.poll(async () => ((await fsRead(page, '/docs/nocount.html')) ? 'ok' : 'no')).toBe('ok');
  const artifact = (await fsRead(page, '/docs/nocount.html'))!;
  expect(artifact).not.toContain('min read');
  expect(artifact).not.toMatch(/\d+ words/);

});

// --- SPEC19: Check for Updates… (shim mock via window.__mmUpdate) ----------------

test('E69: the update dialog walks available → progress → restart, and reports up-to-date honestly', async ({
  page,
}) => {
  await freshNativeMenuApp(page);

  // An update is available: version + notes shown, install runs to 100%,
  // restart is recorded on the mock.
  await page.evaluate(() => {
    window.__mmUpdate = {
      next: { version: '9.9.9', notes: 'Big fixes and bigger features.' },
      progress: [],
      installed: false,
      restarted: false,
    };
  });
  await menuClick(page, 'checkUpdates');
  await expect(page.getByTestId('update-dialog')).toBeVisible();
  await expect(page.getByTestId('update-available')).toContainText('9.9.9');
  await expect(page.getByTestId('update-available')).toContainText('Big fixes');
  await page.getByTestId('update-install').click();
  await expect(page.getByTestId('update-restart')).toBeVisible();
  expect(await page.evaluate(() => window.__mmUpdate!.installed)).toBe(true);
  expect(await page.evaluate(() => window.__mmUpdate!.progress.at(-1))).toBe(100);
  await page.getByTestId('update-restart').click();
  await expect.poll(() => page.evaluate(() => window.__mmUpdate!.restarted)).toBe(true);
  await page.keyboard.press('Escape');

  // Up to date: the dialog says so, with the current version.
  await page.evaluate(() => {
    window.__mmUpdate!.next = null;
  });
  await menuClick(page, 'checkUpdates');
  await expect(page.getByTestId('update-none')).toContainText('up to date');
  await expect(page.getByTestId('update-none')).toContainText('v0.');
});

test('E70: update-check failures are honest and recoverable — never a crash', async ({ page }) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  await page.evaluate(() => {
    window.__mmUpdate = { next: { error: 'offline: could not reach github.com' }, progress: [], installed: false, restarted: false };
  });
  await menuClick(page, 'checkUpdates');
  await expect(page.getByTestId('update-error')).toContainText('offline');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('update-dialog')).toHaveCount(0);

  // Fully alive afterwards…
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  await menuClick(page, 'toggleMode');

  // …and a second check can succeed (state resets).
  await page.evaluate(() => {
    window.__mmUpdate!.next = { version: '9.9.9', notes: '' };
  });
  await menuClick(page, 'checkUpdates');
  await expect(page.getByTestId('update-available')).toContainText('9.9.9');
});

// --- SPEC20: image paste + preview resize -----------------------------------

// A 1×1 red PNG for paste payloads (constructed at runtime — never a file).
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// A 200×100 PNG so resize has real geometry to drag against.
const WIDE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAABM5OhcAAABG0lEQVR4nO3SQQkAIADAQCMax4jGsoRDkIMLsMfGXBuuG88L+JKxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLxAH1LBknHE0F8AAAAABJRU5ErkJggg==';

/** Dispatch a synthetic image paste into the CodeMirror editor. */
async function pasteImage(page: import('@playwright/test').Page, b64: string) {
  await page.evaluate((data) => {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    document
      .querySelector('.cm-content')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, b64);
}

test('E71: pasting an image in edit mode writes the file, inserts the reference, and renders in preview', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await pasteImage(page, TINY_PNG);

  // Inserted at the cursor: default pattern {doc} {n} against welcome.md.
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toContainText('![welcome 1](images/welcome%201.png)');

  // The bytes landed next to the doc, under the configured folder.
  const stored = await fsRead(page, '/docs/images/welcome 1.png');
  expect(stored).not.toBeNull();
  expect(stored!.startsWith('data:image/png;base64,')).toBe(true);

  // And the preview renders it (the shim serves the data: URI back).
  await page.keyboard.press('Control+e');
  const img = page.getByTestId('doc').locator('img[alt="welcome 1"]');
  await expect(img).toBeVisible();
  expect(await img.getAttribute('src')).toContain('data:image/png');
});

test('E72: a second paste numbers {n}=2; pasting into an untitled buffer shows the save-first notice', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await pasteImage(page, TINY_PNG);
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('images/welcome%201.png');
  await pasteImage(page, TINY_PNG);
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('images/welcome%202.png');
  expect(await fsRead(page, '/docs/images/welcome 2.png')).not.toBeNull();

  // Untitled buffer (fresh app, no document open): paste writes nothing.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await pasteImage(page, TINY_PNG);
  await expect(page.getByTestId('notice')).toContainText('Save the document first');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('![');
  const files = await page.evaluate(() => window.__mmfs!.list());
  expect(files.filter((f) => f.includes('/images/'))).toEqual([]);
});

test('E73: the Editor settings tab holds the image fields — defaults, live example, folder validation, persistence', async ({
  page,
}) => {
  await openSettings(page, 'general');
  await page.getByTestId('settings-tab-editor').click();

  // Defaults per SPEC20 §1.
  await expect(page.getByTestId('image-folder')).toHaveValue('images');
  await expect(page.getByTestId('image-pattern')).toHaveValue('{doc} {n}');
  await expect(page.getByTestId('image-pattern-example')).toContainText('welcome 1.png');

  // The example tracks the pattern live.
  await page.getByTestId('image-pattern').fill('img-{n}');
  await expect(page.getByTestId('image-pattern-example')).toContainText('img-1.png');

  // Invalid folder: inline error, the last valid value stays in settings.
  await page.getByTestId('image-folder').fill('a/b');
  await expect(page.getByTestId('image-folder-error')).toBeVisible();
  // Valid folder commits and the error clears.
  await page.getByTestId('image-folder').fill('assets');
  await expect(page.getByTestId('image-folder-error')).toHaveCount(0);

  await page.getByTestId('settings-close').click();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"imageFolder": "assets"');
  expect(await fsRead(page, '/config/settings.json')).toContain('"imageNamePattern": "img-{n}"');
});

// E74–E75 retired by SPEC41 §4 — the preview-pane resizer is gone (resize
// now lives in the edit pane, E122). Numbers reserved like E42–E44.

test('E76: Insert Image… (menu) copies the picked file into the images folder and references it at the cursor', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  // In preview the command only nudges toward edit mode.
  await menuClick(page, 'insertImage');
  await expect(page.getByTestId('notice')).toContainText('edit mode');

  // Seed a picture elsewhere in the virtual fs, then insert it in edit mode.
  await fsWrite(page, '/docs/downloads/logo.png', `data:image/png;base64,${TINY_PNG}`);
  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  page.once('dialog', (d) => void d.accept('/docs/downloads/logo.png'));
  await menuClick(page, 'insertImage');

  // Copied next to the doc under the configured folder, referenced at cursor.
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('![logo](images/logo.png)');
  expect(await fsRead(page, '/docs/images/logo.png')).toContain('data:image/png');

  // Picking a file already inside the folder references it without recopying.
  page.once('dialog', (d) => void d.accept('/docs/images/logo.png'));
  await menuClick(page, 'insertImage');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('![logo](images/logo.png)!');
  const files = await page.evaluate(() => window.__mmfs!.list());
  expect(files.filter((f) => f.startsWith('/docs/images/'))).toEqual(['/docs/images/logo.png']);
});

test('E77: image resize lives in the EDIT pane — a chip drag persists into the buffer, the split preview renders it with no handles', async ({
  page,
}) => {
  // SPEC41 §4 amendment: this test drove the removed preview resizer; it now
  // pins the replacement — the same resize journey through the edit pane.
  await fsWrite(page, '/docs/pic.png', `data:image/png;base64,${WIDE_PNG}`);
  await fsWrite(page, '/docs/pic.md', '# Pic\n\n![p](pic.png)\nA line right after the image.\n');
  await page.goto('/#open=/docs/pic.md');
  await expect(page.getByTestId('doc').locator('img[alt="p"]')).toBeVisible();

  // Split edit: the editor renders the WIDGET (real pixels, raw syntax hidden).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  const widgetImg = page.getByTestId('editor').locator('.mm-image-widget img');
  await expect(widgetImg).toBeVisible();
  await widgetImg.click();
  await expect(page.getByTestId('image-chip-layer')).toBeVisible();

  // Drag the corner chip 60px left → the SPEC20 rewrite lands in the buffer.
  const chip = await page.getByTestId('image-resize-wh').boundingBox();
  await page.mouse.move(chip!.x + chip!.width / 2, chip!.y + chip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(chip!.x + chip!.width / 2 - 60, chip!.y + chip!.height / 2, { steps: 5 });
  await page.mouse.up();

  // Arrow into the span: the raw rewrite reveals — the <img> form, a width,
  // no height (corner = natural aspect).
  await page.keyboard.press('ArrowRight');
  const content = page.getByTestId('editor').locator('.cm-content');
  await expect(content).toContainText('<img src="pic.png" alt="p" width="');
  const revealed = await content.evaluate((el) => (el as HTMLElement).innerText);
  expect(revealed).not.toContain('height=');

  // The blank-line rule kept the following sentence out of the HTML block:
  // the live preview shows the resized image AND the sentence…
  const previewImg = page.getByTestId('split-preview').locator('img[alt="p"]');
  await expect(previewImg).toBeVisible();
  await expect(page.getByTestId('split-preview')).toContainText('A line right after the image.');

  // …and never grows handles or an overlay (SPEC41 §4).
  await previewImg.click();
  await expect(page.getByTestId('img-resize-overlay')).toHaveCount(0);
  await expect(page.getByTestId('img-size-badge')).toHaveCount(0);
});

test('E78: ⌘N opens an untitled buffer — no dialog, nothing on disk; first ⌘S runs Save As (cancel keeps the buffer)', async ({
  page,
}) => {
  // Pristine launch (like E1): the splash shows both hints with live combos.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const hint = page.getByTestId('empty-hint');
  await expect(hint).toBeVisible();
  // SPEC27 §4.1 amendment: the key-combo hint lines no longer exist — the
  // splash carries a single drop hint (the hotkeys themselves are E78's
  // subject below and unchanged).
  await expect(hint).toContainText('Drop a file to open');

  const before = await page.evaluate(() => window.__mmfs!.list());
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  // No dialog ran and nothing was written.
  expect(await page.evaluate(() => window.__mmfs!.list())).toEqual(before);

  // Type → dirty; a cancelled Save As keeps the dirty untitled buffer.
  await page.getByTestId('editor').locator('.cm-content').click();
  await page.keyboard.type('# Fresh Start');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = null;
  });
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Save with a chosen path writes the buffer and switches to the real file.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/fresh.md';
  });
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('docname')).toContainText('fresh.md');
  await expect(page.getByTestId('docname')).toHaveAttribute('title', '/docs/fresh.md');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, '/docs/fresh.md')).toContain('# Fresh Start');
});

test('E79: unsaved-changes guard — around New, and Save-through when opening over a dirty untitled buffer', async ({
  page,
}) => {
  // Dirty the welcome doc.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTYMARK ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // ⌘N → three-way prompt; Cancel keeps the dirty doc, no buffer swap.
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await expect(page.getByTestId('open-prompt')).toContainText('starting a new file');
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // ⌘N again → Don’t save → fresh untitled buffer; the edit never hit disk.
  await page.keyboard.press('Control+n');
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, WELCOME)).not.toContain('DIRTYMARK');

  // Dirty untitled + open → prompt names Untitled; Save routes through Save
  // As (armed path), then the requested document opens.
  await page.getByTestId('editor').locator('.cm-content').click();
  await page.keyboard.type('# Keep me');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/kept.md';
  });
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click(); // opens welcome → guard fires
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await expect(page.getByTestId('open-prompt')).toContainText('“Untitled” has unsaved changes');
  await page.getByTestId('open-save').click();
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
  expect(await fsRead(page, '/docs/kept.md')).toContain('# Keep me');
});

test('E80: split-preview selections mirror into the editor as exact source ranges; fallback covers lines', async ({
  page,
}) => {
  const FILLER = Array.from({ length: 60 }, (_, i) => `filler line ${i + 1}`).join('\n\n');
  await fsWrite(
    page,
    '/docs/mirror.md',
    `# Mirror Title\n\n${FILLER}\n\nThe **quick brown** fox jumps far.\n\nrepeat me and repeat me.\n`
  );
  await page.goto('/#open=/docs/mirror.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Mirror Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  // The lazy editor must be mounted (its selection hook registered) first.
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  // Real flow: the user's mousedown in the preview blurs the editor before
  // the drag-selection exists (a focused CM re-asserts its own selection).
  await page.getByTestId('split-preview').click({ position: { x: 10, y: 10 } });

  // A phrase crossing a bold boundary lands on the exact SOURCE spelling.
  await selectSpanInPane(page, '[data-testid="split-preview"] .doc', 'brown', 'fox jumps');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('brown** fox jumps');
  // The unfocused editor draws the selection and scrolled it into view.
  expect(await page.locator('[data-testid="editor"] .cm-selectionBackground').count()).toBeGreaterThan(0);
  expect(
    await page.locator('[data-testid="editor"] .cm-scroller').evaluate((el) => el.scrollTop)
  ).toBeGreaterThan(0);
  // The preview's own selection survived the mirror.
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('brown fox jumps');

  // A collapsed selection (click/caret) never touches the editor selection.
  await page.evaluate(() => {
    const sel = window.getSelection()!;
    sel.collapseToStart();
  });
  await page.waitForTimeout(300); // debounce window
  expect(await page.evaluate(() => window.__mmEdit?.selText)).toBe('brown** fox jumps');

  // Ambiguous text (two identical phrases in range) → covering-line fallback.
  await selectPhraseInPane(page, '[data-testid="split-preview"] .doc', 'repeat me');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('repeat me and repeat me.');
});

test('E81: editor vim nav — Esc inert with the setting off; full modal keyset on; buffer stays byte-identical', async ({
  page,
}) => {
  const DOC = Array.from({ length: 40 }, (_, i) => `line number ${i + 1}`).join('\n\n');
  await fsWrite(page, '/docs/vim.md', `${DOC}\n`);
  await page.goto('/#open=/docs/vim.md');
  await expect(page.getByTestId('doc')).toContainText('line number 1');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();

  // Setting off (default): Esc does nothing — no badge, typing still edits.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vim-badge')).toHaveCount(0);
  await page.keyboard.type('OFFCHECK ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+s'); // clean slate for the byte-identical check
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // Enable vim, back to the editor.
  await openSettings(page, 'general');
  await page.getByTestId('settings-vimnav').check();
  await page.getByTestId('settings-close').click();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.press('Control+Home'); // deterministic start (native nav still works)

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vim-badge')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.nav)).toBe(true);

  // Motions move the cursor.
  const headLine = () => page.evaluate(() => window.__mmEdit?.headLine);
  const head = () => page.evaluate(() => window.__mmEdit?.head);
  await expect.poll(headLine).toBe(1);
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect.poll(headLine).toBe(3);
  await page.keyboard.press('k');
  await expect.poll(headLine).toBe(2);
  await page.keyboard.press('j'); // line 3: "line number 2"
  const atLineStart = (await head())!;
  await page.keyboard.press('w');
  expect((await head())!).toBeGreaterThan(atLineStart);
  await page.keyboard.press('$');
  const atEnd = (await head())!;
  await page.keyboard.press('0');
  expect((await head())!).toBeLessThan(atEnd);
  await page.keyboard.press('G');
  await expect.poll(headLine).toBeGreaterThan(70); // 40 lines + blanks
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(headLine).toBe(1);
  await page.keyboard.press('Control+d');
  const afterHalf = (await headLine())!;
  expect(afterHalf).toBeGreaterThan(1);
  await page.keyboard.press('Control+u');
  await expect.poll(headLine).toBeLessThan(afterHalf);

  // Editing keys are inert: the buffer stays byte-identical (never dirty).
  for (const k of ['x', 'q', 'Backspace', 'Delete', 'Enter', 'Tab', '#']) {
    await page.keyboard.press(k);
  }
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(page.getByTestId('vim-badge')).toBeVisible();

  // i exits to typing; typing edits again.
  await page.keyboard.press('i');
  await expect(page.getByTestId('vim-badge')).toHaveCount(0);
  await page.keyboard.type('ONCHECK');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Esc → nav, then a mode roundtrip re-enters typing mode.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vim-badge')).toBeVisible();
  await page.keyboard.press('Control+e'); // to preview (accelerators pass through nav mode)
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await page.keyboard.press('Control+e'); // back to edit
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('vim-badge')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.nav)).toBe(false);
});

test('E82: markdown highlighting — themed token classes on by default, live toggle keeps undo, persists', async ({
  page,
}) => {
  await fsWrite(page, '/docs/hl.md', '# Big Title\n\nsome **bold** and `code` here\n');
  await page.goto('/#open=/docs/hl.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Big Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();

  // On by default: token classes present.
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.mm-md-h1:not(.mm-md-mark)').first()).toContainText('Big Title');
  await expect(editor.locator('.mm-md-strong:not(.mm-md-mark)').first()).toContainText('bold');
  await expect(editor.locator('.mm-md-code:not(.mm-md-mark)').first()).toContainText('code');
  expect(await editor.locator('.mm-md-mark').count()).toBeGreaterThan(0); // dimmed # / ** / `

  // Type A (undo baseline), toggle the setting off live.
  await editor.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('AAA');
  await openSettings(page, 'general');
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('editor-syntax').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(editor.locator('[class*="mm-md-"]')).toHaveCount(0);

  // Undo history survived the live reconfigure: type BBB, undo removes it only.
  await editor.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('BBB');
  await expect(editor.locator('.cm-content')).toContainText('AAABBB');
  await page.keyboard.press('ControlOrMeta+z'); // CM's own history keymap wants the real Mod
  await expect(editor.locator('.cm-content')).toContainText('AAA');
  await expect(editor.locator('.cm-content')).not.toContainText('BBB');

  // The setting persisted.
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"editorSyntax": false');
  await page.reload();
  await page.goto('/#open=/docs/hl.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Big Title'); // app booted
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('editor').locator('[class*="mm-md-"]')).toHaveCount(0);
});

test('E83: editor selections mirror into the split preview as synthetic marks; both directions coexist loop-free', async ({
  page,
}) => {
  await fsWrite(page, '/docs/rev.md', '# Rev Title\n\nThe **quick brown** fox jumps far.\n\nsame para\n\nsame para\n');
  await page.goto('/#open=/docs/rev.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Rev Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  // Keyboard-select the whole bold-bearing source line.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'quick brown' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');

  // The preview shows the rendered sentence as synthetic marks.
  const marks = page.locator('[data-testid="split-preview"] .doc mark.mm-mirror-sel');
  await expect.poll(async () => (await marks.allTextContents()).join('')).toBe('The quick brown fox jumps far.');
  // Inert to the comment machinery: not .hl, no data-cid.
  expect(await page.locator('[data-testid="split-preview"] .doc mark.hl').count()).toBe(0);
  expect(await marks.first().getAttribute('data-cid')).toBeNull();
  // The editor's own selection is undisturbed — no feedback loop.
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('The **quick brown** fox jumps far.');

  // Collapsing clears the marks.
  await page.keyboard.press('End');
  await expect(marks).toHaveCount(0);

  // Cross-block selection (rendered blocks have no separator) → region fallback.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'same para' }).first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+End');
  await expect.poll(async () => (await marks.allTextContents()).join('')).toBe('same parasame para');

  // The forward direction still works afterwards, and the unfocused report
  // that its CM dispatch produces clears the reverse marks.
  await page.getByTestId('split-preview').click({ position: { x: 10, y: 10 } });
  await selectSpanInPane(page, '[data-testid="split-preview"] .doc', 'quick', 'fox');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('quick brown** fox');
  await expect(marks).toHaveCount(0);
});

test('E84: ⌘\\ toggles split live — buffer, selection, and undo survive; setting persists; menu checkbox drives it', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toBeVisible(); // default on

  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('SPLITMARK ');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toContain('SPLITMARK');

  // Toggle to full-screen edit: everything carried across the remount.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('SPLITMARK');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toContain('SPLITMARK');
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"splitEdit": false');

  // Undo still reaches across the remount and removes the typed run.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('SPLITMARK');

  // Back to split.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"splitEdit": true');

  // Native-menu surface: View carries the checkbox and click() toggles it.
  await freshNativeMenuApp(page);
  const splitItem = () =>
    page.evaluate(() => {
      const view = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!;
      return view.items.find((i) => i.type === 'command' && i.command === 'toggleSplit') as {
        label?: string;
        checked?: boolean;
        accelerator?: string;
      };
    });
  expect((await splitItem()).label).toBe('Split Edit');
  expect((await splitItem()).checked).toBe(true); // fresh settings → default on
  expect((await splitItem()).accelerator).toBe('Mod+\\');
  await menuClick(page, 'toggleSplit');
  await expect.poll(async () => (await splitItem()).checked).toBe(false);
});

test('E85: the selection survives ⌘E in both directions, in full and split layouts', async ({ page }) => {
  await fsWrite(
    page,
    '/docs/carry.md',
    '# Carry Title\n\nThe **quick brown** fox jumps far.\n\nanother paragraph entirely.\n'
  );
  await page.goto('/#open=/docs/carry.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Carry Title');

  // Preview → edit (split): the preview selection becomes the exact source
  // selection, and the reverse mirror lights the split preview.
  await selectSpanInPane(page, '[data-testid="doc"]', 'quick', 'fox jumps');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('quick brown** fox jumps');
  const marks = page.locator('[data-testid="split-preview"] .doc mark.mm-mirror-sel');
  await expect.poll(async () => (await marks.allTextContents()).join('')).toBe('quick brown fox jumps');

  // Split → full edit (⌘\): the selection rides the parked editor state.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('quick brown** fox jumps');

  // Edit → preview: the carried range becomes a NATIVE selection of the
  // rendered text (markers stripped).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe(
    'quick brown fox jumps'
  );

  // Preview → edit again with a different phrase (full-screen edit now).
  await selectPhraseInPane(page, '[data-testid="doc"]', 'another paragraph');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('another paragraph');
  // It is a real selection: typing over it replaces the text.
  await page.keyboard.type('REPLACED');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('REPLACED entirely.');
  await page.keyboard.press('ControlOrMeta+z');

  // Collapsed selections carry nothing: collapse in the editor, toggle to
  // preview — no native selection materializes there.
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__mmEdit && window.__mmEdit.selFrom === window.__mmEdit.selTo)).toBe(
    true
  );
  await page.keyboard.press('Control+e'); // to preview
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Carry Title');
  await page.waitForTimeout(250); // past the restore effect's window
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe('');
});

test('E86: front matter becomes a dismissable card — never rendered markdown; View menu and setting govern it', async ({
  page,
}) => {
  const FM_DOC =
    '---\ndate: 2026-07-05\nkind: article\ntags:\n  - agentic-engineering\n  - llm\n---\n\n# FM Title\n\nBody paragraph here.\n';
  await fsWrite(page, '/docs/fm.md', FM_DOC);
  await page.goto('/#open=/docs/fm.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('FM Title');

  // The old failure mode is gone: no top hr, no "date:" paragraph mush.
  expect(await page.getByTestId('doc').locator('hr').count()).toBe(0);
  await expect(page.getByTestId('doc')).not.toContainText('date:');

  // The card lists keys, values, and the joined list.
  const card = page.getByTestId('fm-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('date');
  await expect(card).toContainText('2026-07-05');
  await expect(card).toContainText('agentic-engineering, llm');

  // ✕ hides it for the session — split preview included.
  await page.getByTestId('fm-close').click();
  await expect(page.getByTestId('fm-card')).toHaveCount(0);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(page.getByTestId('fm-card')).toHaveCount(0);
  await page.keyboard.press('Control+e');

  // Setting off ⇒ the next open starts hidden (doc renders as ever).
  await openSettings(page, 'general');
  await page.getByTestId('settings-frontmatter').uncheck();
  await page.getByTestId('settings-close').click();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"showFrontmatter": false');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('FM Title');
  await expect(page.getByTestId('fm-card')).toHaveCount(0);

  // Fresh boot with defaults + native menu: the View checkbox drives the card.
  await freshNativeMenuApp(page);
  await fsWrite(page, '/docs/fm.md', FM_DOC);
  await page.goto('/?nativeMenu=1#open=/docs/fm.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('FM Title');
  await expect(page.getByTestId('fm-card')).toBeVisible();
  const fmItem = () =>
    page.evaluate(() => {
      const view = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!;
      return view.items.find(
        (i) => i.type === 'command' && (i as { command?: string }).command === 'toggleFrontmatter'
      ) as { checked?: boolean };
    });
  expect((await fmItem()).checked).toBe(true);
  await menuClick(page, 'toggleFrontmatter');
  await expect(page.getByTestId('fm-card')).toHaveCount(0);
  await expect.poll(async () => (await fmItem()).checked).toBe(false);
  await menuClick(page, 'toggleFrontmatter');
  await expect(page.getByTestId('fm-card')).toBeVisible();

  // A document without front matter never shows a card.
  await fsWrite(page, '/docs/plain.md', '# Plain Doc\n\ntext\n');
  await page.goto('/?nativeMenu=1#open=/docs/plain.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Plain Doc');
  await expect(page.getByTestId('fm-card')).toHaveCount(0);
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

  // Opening a document removes the splash entirely; the badge chip remains.
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect(page.getByTestId('splash-mark')).toHaveCount(0);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('docname').click(); // close menu
});

test('E88: Open Recent — MRU order, persistence, guarded reopen, vanished-file cleanup, Clear Menu', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await fsWrite(page, '/docs/ra.md', '# Doc RA\n');
  await fsWrite(page, '/docs/rb.md', '# Doc RB\n');

  const recents = () =>
    page.evaluate(() => {
      const file = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'File')!;
      const sub = file.items.find((i) => i.type === 'submenu') as { items: Array<{ type: string; path?: string }> };
      return sub.items.filter((i) => i.type === 'recent').map((i) => i.path);
    });

  // Open both (ra then rb): MRU order, newest first.
  await page.goto('/?nativeMenu=1#open=/docs/ra.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Doc RA');
  await page.goto('/?nativeMenu=1#open=/docs/rb.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Doc RB');
  await expect.poll(recents).toEqual(['/docs/rb.md', '/docs/ra.md']);

  // Persisted: a reload (the #open hash reopens rb) keeps the stored list.
  expect(await fsRead(page, '/config/recent.json')).toContain('/docs/ra.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Doc RB');
  await expect.poll(recents).toEqual(['/docs/rb.md', '/docs/ra.md']);

  // Picking the older doc reopens it and bumps it to the front.
  await page.evaluate(() => window.__mmMenu!.clickRecent('/docs/ra.md'));
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Doc RA');
  await expect.poll(recents).toEqual(['/docs/ra.md', '/docs/rb.md']);

  // A vanished file: notice + the entry drops off (and stays off on disk).
  await page.evaluate(() => window.__mmfs!.remove('/docs/rb.md'));
  await page.evaluate(() => window.__mmMenu!.clickRecent('/docs/rb.md'));
  await expect(page.getByTestId('notice')).toContainText('rb.md');
  await expect.poll(recents).toEqual(['/docs/ra.md']);
  await expect.poll(() => fsRead(page, '/config/recent.json')).not.toContain('/docs/rb.md');

  // Clear Menu empties the list.
  await menuClick(page, 'clearRecent');
  await expect.poll(recents).toEqual([]);
  await expect.poll(() => fsRead(page, '/config/recent.json')).not.toContain('/docs/ra.md');
});

test('E89: find in preview — live count, themed marks, wrap-around navigation, lossless close, prefill', async ({
  page,
}) => {
  const before = await page.getByTestId('doc').evaluate((el) => el.textContent);

  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await page.getByTestId('find-input').fill('markdown');
  await expect(page.getByTestId('find-count')).toContainText('of');
  const total = Number((await page.getByTestId('find-count').textContent())!.split('of')[1]!.trim());
  expect(total).toBeGreaterThan(1);
  expect(await page.locator('.doc mark.mm-find').count()).toBeGreaterThanOrEqual(total);
  await expect(page.locator('.doc mark.mm-find-active').first()).toBeVisible();
  // Never the comment machinery's marks.
  expect(await page.locator('.doc mark.mm-find[data-cid]').count()).toBe(0);
  expect(await page.locator('.doc mark.hl.mm-find').count()).toBe(0);

  // Enter advances, Shift+Enter wraps back around to the last match.
  await expect(page.getByTestId('find-count')).toHaveText(`1 of ${total}`);
  await page.getByTestId('find-input').press('Enter');
  await expect(page.getByTestId('find-count')).toHaveText(`2 of ${total}`);
  await page.getByTestId('find-input').press('Shift+Enter');
  await page.getByTestId('find-input').press('Shift+Enter');
  await expect(page.getByTestId('find-count')).toHaveText(`${total} of ${total}`);

  // No matches state.
  await page.getByTestId('find-input').fill('zzqqxx-nothing');
  await expect(page.getByTestId('find-count')).toHaveText('No matches');

  // Esc closes and the document text is byte-identical, zero marks left.
  await page.getByTestId('find-input').press('Escape');
  await expect(page.getByTestId('find-bar')).toHaveCount(0);
  expect(await page.locator('.doc mark.mm-find').count()).toBe(0);
  expect(await page.getByTestId('doc').evaluate((el) => el.textContent)).toBe(before);

  // Selection prefill.
  await selectPhraseInPane(page, '[data-testid="doc"]', 'sidecar file');
  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-input')).toHaveValue('sidecar file');
  await page.getByTestId('find-input').press('Escape');

  // The Edit → Find… menu item drives the same bar (native-menu shim).
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await menuClick(page, 'find');
  await expect(page.getByTestId('find-bar')).toBeVisible();
});

test('E90: find & replace in the editor — CM decorations, replace one/all on the undo path, query survives toggles', async ({
  page,
}) => {
  await fsWrite(page, '/docs/fr.md', '# T\n\nalpha beta alpha\n\ngamma alpha\n');
  await page.goto('/#open=/docs/fr.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('T');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toBeVisible(); // split default

  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await expect(page.getByTestId('find-replace-input')).toBeVisible(); // edit mode has the replace row
  await page.getByTestId('find-input').fill('alpha');
  await expect(page.getByTestId('find-count')).toContainText('of 3');
  expect(await page.locator('.cm-searchMatch').count()).toBe(3);
  // The bar drives the EDITOR in split mode — the split preview stays unmarked.
  expect(await page.locator('[data-testid="split-preview"] .doc mark.mm-find').count()).toBe(0);

  await page.getByTestId('find-next').click();
  await expect(page.getByTestId('find-count')).toContainText('2 of 3');

  // Replace one (advances), then all (reports via the notice).
  await page.getByTestId('find-replace-input').fill('OMEGA');
  await page.getByTestId('find-replace-one').click();
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('OMEGA');
  await expect(page.getByTestId('find-count')).toContainText('of 2');
  await page.getByTestId('find-replace-all').click();
  await expect(page.getByTestId('notice')).toContainText('Replaced 2 matches');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('alpha');

  // replace-all was ONE undo step (focus back in the editor first — ⌘Z
  // targets the focused field, as it should).
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('alpha');

  // The query survives a mode toggle and re-applies in preview.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await expect(page.getByTestId('find-input')).toHaveValue('alpha');
  await expect(page.getByTestId('find-count')).toContainText('of');
  expect(await page.locator('.doc mark.mm-find').count()).toBeGreaterThan(0);
});

test('E91: reopen on launch — restores the last doc, loses to explicit opens, honors the setting, skips missing files', async ({
  page,
}) => {
  await fsWrite(page, '/docs/r1.md', '# R One\n');
  await fsWrite(page, '/docs/r2.md', '# R Two\n');
  await page.goto('/#open=/docs/r1.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('R One');

  // A hash-less relaunch reopens r1 by itself.
  await page.goto('/');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('R One');

  // An explicit #open at boot beats reopen.
  await page.goto('/#open=/docs/r2.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('R Two');

  // Setting off ⇒ splash.
  await openSettings(page, 'general');
  await page.getByTestId('settings-reopen').uncheck();
  await page.getByTestId('settings-close').click();
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  // Back on, but the top recent has vanished ⇒ splash, entry retained.
  await openSettings(page, 'general');
  await page.getByTestId('settings-reopen').check();
  await page.getByTestId('settings-close').click();
  await page.evaluate(() => window.__mmfs!.remove('/docs/r2.md'));
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  expect(await fsRead(page, '/config/recent.json')).toContain('/docs/r2.md');
});

test('E92: crash-safe drafts — shadow write, restore, discard, staleness after save, untitled buffers', async ({
  page,
}) => {
  // Dirty the welcome doc; the shadow copy lands after the idle debounce.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DRAFTMARK ');
  await expect.poll(() => fsRead(page, '/config/draft.json'), { timeout: 20000 }).toContain('DRAFTMARK');

  // "Crash" (reload): the boot reopens welcome, then offers the draft.
  await page.reload();
  await expect(page.getByTestId('restore-prompt')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('restore-prompt')).toContainText('welcome.md');
  await page.getByTestId('restore-yes').click();
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('DRAFTMARK');
  await expect.poll(() => fsRead(page, '/config/draft.json')).toBeNull();

  // Saving makes future boots quiet (clean transition also deletes).
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome');
  await expect(page.getByTestId('restore-prompt')).toHaveCount(0);

  // Discard path.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DRAFT2 ');
  await expect.poll(() => fsRead(page, '/config/draft.json'), { timeout: 20000 }).toContain('DRAFT2');
  await page.reload();
  await expect(page.getByTestId('restore-prompt')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('restore-no').click();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(page.getByTestId('doc')).not.toContainText('DRAFT2');
  await expect.poll(() => fsRead(page, '/config/draft.json')).toBeNull();

  // Untitled buffers draft too (docPath null → a fresh untitled restore).
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-content').click();
  await page.keyboard.type('ScratchDraft');
  await expect.poll(() => fsRead(page, '/config/draft.json'), { timeout: 20000 }).toContain('ScratchDraft');
  await page.reload();
  await expect(page.getByTestId('restore-prompt')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('restore-prompt')).toContainText('Untitled');
  await page.getByTestId('restore-yes').click();
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('ScratchDraft');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
});

const seedFolders = async (page: import('@playwright/test').Page) => {
  await fsWrite(page, '/notes/a.md', '# A doc\n');
  await fsWrite(page, '/notes/pic.png', 'binary-ish');
  await fsWrite(page, '/notes/zzz.txt', 'plain');
  await fsWrite(page, '/notes/.hidden/secret.md', '# no\n');
  await fsWrite(page, '/notes/sub/b.md', '# B doc\n');
  await fsWrite(page, '/notes/sub/deep/c.md', '# C doc\n');
  await fsWrite(page, '/other/d.md', '# D doc\n');
};

test('E93: folder tree — empty state, listing, sorting, dotfiles, expansion persistence, guarded md opens, inert others', async ({
  page,
}) => {
  await seedFolders(page);

  // Hotkey opens the panel; no root yet ⇒ the empty state.
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('folder-open-btn')).toBeVisible();

  // Open Folder… (hook-armed): root lists — folders first, dotfiles hidden.
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await expect(page.getByTestId('folder-header')).toContainText('notes');
  const names = () =>
    page.$$eval('[data-testid="folder-item"]', (els) => els.map((e) => e.getAttribute('data-path')));
  // Non-markdown files are hidden by default — folders and markdown only.
  await expect.poll(names).toEqual(['/notes/sub', '/notes/a.md']);

  // The # filter toggle reveals them: dim and inert, # glyphs only on
  // markdown. Accent # = markdown-only; grey # = everything. All three
  // header icons carry tooltips.
  await expect(page.getByTestId('folder-filter')).toHaveAttribute('title', 'Show all files');
  await expect(page.getByTestId('folder-sync')).toHaveAttribute('title', 'Navigate to the open file');
  await expect(page.getByTestId('folder-close')).toHaveAttribute('title', 'Close the folder panel');
  await expect(page.getByTestId('folder-filter')).toHaveClass(/filter-on/);
  await page.getByTestId('folder-filter').click();
  await expect(page.getByTestId('folder-filter')).toHaveAttribute('title', 'Show markdown files only');
  await expect(page.getByTestId('folder-filter')).not.toHaveClass(/filter-on/);
  await expect.poll(names).toEqual(['/notes/sub', '/notes/a.md', '/notes/pic.png', '/notes/zzz.txt']);
  await expect(page.locator('[data-path="/notes/a.md"] .folder-glyph svg')).toBeVisible();
  await expect(page.locator('[data-path="/notes/pic.png"] .folder-glyph svg')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/pic.png"]')).toHaveClass(/folder-item-dim/);
  await page.locator('[data-path="/notes/pic.png"]').click({ force: true });
  await expect(page.getByTestId('docname')).toContainText('welcome.md'); // unchanged

  // Expand sub → children appear; expansion persists to foldertree.json.
  await page.locator('[data-path="/notes/sub"]').click();
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).toContain('/notes/sub');

  // Restart: panel visibility, root, and expansion all survive.
  await page.reload();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();

  // Clicking a markdown row opens it (selected class follows).
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);

  // The selected tab floats clear of the panel's left edge — the pill must
  // not widen the scroll range, and the reveal must not scroll the gap away.
  const pill = await page.evaluate(() => {
    const list = document.querySelector('.folder-list')!;
    const sel = document.querySelector('.folder-item.selected')!;
    return {
      gap: sel.getBoundingClientRect().left - list.getBoundingClientRect().left,
      scrollLeft: list.scrollLeft,
    };
  });
  expect(pill.scrollLeft).toBe(0);
  expect(pill.gap).toBeGreaterThanOrEqual(10);

  // The eye choice survived the reload above (foldertree.json); hiding
  // again drops the rows without collapsing sub or losing the selection.
  await expect.poll(names).toContain('/notes/pic.png');
  await page.getByTestId('folder-filter').click();
  await expect.poll(names).not.toContain('/notes/pic.png');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);

  // The unsaved-changes guard applies to tree opens too.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTY ');
  await page.keyboard.press('Control+e');
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
});

test('E94: folder chrome — divider resize persists, × / View checkbox / hotkey all flip the setting', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);

  await menuClick(page, 'toggleFolders');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  // Drag the divider ~+80px; width and the persisted setting follow.
  const before = await page.getByTestId('folder-panel').evaluate((el) => el.getBoundingClientRect().width);
  const box = (await page.getByTestId('folder-divider').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 200, { steps: 5 });
  await page.mouse.up();
  const after = await page.getByTestId('folder-panel').evaluate((el) => el.getBoundingClientRect().width);
  expect(after).toBeGreaterThan(before + 40);
  await expect.poll(async () => JSON.parse((await fsRead(page, '/config/settings.json'))!).folderWidth).toBeGreaterThan(
    before + 40
  );

  // × closes; the View checkbox reflects it; the hotkey reopens.
  const foldersItem = () =>
    page.evaluate(() => {
      const view = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!;
      return view.items.find((i) => i.type === 'command' && (i as { command?: string }).command === 'toggleFolders') as {
        checked?: boolean;
      };
    });
  expect((await foldersItem()).checked).toBe(true);
  await page.getByTestId('folder-close').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect.poll(async () => (await foldersItem()).checked).toBe(false);
  await page.waitForTimeout(200); // SPEC12 §1.3 cross-source dedup window
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  // Visibility persists across a restart.
  await page.reload();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
});

test('E95: reveal — auto on open, sync button, outside-root retarget, hidden panel stays hidden, untitled clears', async ({
  page,
}) => {
  await seedFolders(page);
  await page.keyboard.press('Control+Shift+E');
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  // Opening a nested file walks the tree open and selects its row.
  await page.goto('/#open=/notes/sub/deep/c.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('C doc');
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);

  // Collapse everything; the sync button re-reveals.
  await page.locator('[data-path="/notes/sub"]').first().click(); // collapse sub
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveCount(0);
  await page.getByTestId('folder-sync').click();
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);

  // A file OUTSIDE the root retargets the root to its directory.
  await page.goto('/#open=/other/d.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('D doc');
  await expect(page.getByTestId('folder-header')).toContainText('other');
  await expect(page.locator('[data-path="/other/d.md"]')).toHaveClass(/selected/);
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).toContain('"/other"');

  // Hidden panel: opening files never forces it open.
  await page.getByTestId('folder-close').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await page.goto('/#open=/notes/a.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('A doc');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);

  // Untitled buffers clear the selection. (Human pacing: the automation just
  // clicked × milliseconds ago — the SPEC12 §1.3 cross-source dedup window
  // would rightly treat an instant hotkey as the same physical action.)
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.locator('.folder-item.selected')).toHaveCount(0);
});

test('E96: folder context menu — per-kind items, dismissal, left-click inertness, copy and reveal record', async ({
  page,
}) => {
  await seedFolders(page);
  await page.keyboard.press('Control+Shift+E');
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  const menuIds = () =>
    page.$$eval('[data-testid="folder-menu"] [data-testid^="folder-menu-"]', (els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('folder-menu-', ''))
    );

  // Directory row: the full set, in SPEC35 §2.5 order.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  expect(await menuIds()).toEqual([
    'new-file',
    'new-folder',
    'rename',
    'delete',
    'reveal',
    'copy-path',
    'copy-relative-path',
  ]);
  // Esc dismisses.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // Markdown file row.
  await page.locator('[data-path="/notes/a.md"]').click({ button: 'right' });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  expect(await menuIds()).toEqual(['reveal', 'rename', 'delete', 'copy-path', 'copy-relative-path']);
  // Any outside pointer-down dismisses. (The title span: the header's center
  // is the SPEC36 open-only toggle now — an inert surface keeps the intent.)
  await page.locator('.folder-title').click();
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // A dim non-markdown row offers the same file menu.
  await page.getByTestId('folder-filter').click(); // show all files
  await expect(page.locator('[data-path="/notes/pic.png"]')).toBeVisible();
  await page.locator('[data-path="/notes/pic.png"]').click({ button: 'right' });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  expect(await menuIds()).toEqual(['reveal', 'rename', 'delete', 'copy-path', 'copy-relative-path']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // The list's empty area: the root menu (no rename/delete, no relative copy).
  await page.locator('.folder-list').click({ button: 'right', position: { x: 60, y: 400 } });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  expect(await menuIds()).toEqual(['new-file', 'new-folder', 'reveal', 'copy-path']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // Left click never opens the menu (row click behavior unchanged).
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // Copy Path / Copy Relative Path land the exact strings on __mmClipboard.
  await page.locator('[data-path="/notes/sub"]').click(); // expand
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-copy-path').click();
  await expect.poll(() => page.evaluate(() => window.__mmClipboard)).toEqual(['/notes/sub/b.md']);
  await page.locator('[data-path="/notes/sub/b.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-copy-relative-path').click();
  await expect.poll(() => page.evaluate(() => window.__mmClipboard)).toEqual(['/notes/sub/b.md', 'sub/b.md']);

  // Reveal records on __mmReveals; invoking an item dismissed the menu.
  await page.locator('[data-path="/notes/a.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-reveal').click();
  await expect.poll(() => page.evaluate(() => window.__mmReveals)).toEqual(['/notes/a.md']);
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);
});

test('E97: create — New File / New Folder land in the clicked directory, inline-rename handoff, numbered placeholders', async ({
  page,
}) => {
  await seedFolders(page);
  await page.keyboard.press('Control+Shift+E');
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await page.locator('[data-path="/notes/sub"]').click(); // expand
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();

  // New File under the nested directory: an empty Untitled.md is written and
  // the new row immediately enters in-place rename.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-new-file').click();
  const input = page.getByTestId('folder-rename-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('Untitled.md');
  await expect.poll(() => fsRead(page, '/notes/sub/Untitled.md')).toBe('');
  // Esc keeps the placeholder name — and the new file still opens.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('docname')).toContainText('Untitled.md');
  await expect(page.locator('[data-path="/notes/sub/Untitled.md"]')).toHaveClass(/selected/);

  // The second run numbers itself before the extension; typing replaces the
  // preselected stem, Enter commits, and the file opens.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-new-file').click();
  await expect(input).toHaveValue('Untitled 2.md');
  await page.keyboard.type('story');
  await expect(input).toHaveValue('story.md');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('docname')).toContainText('story.md');
  await expect(page.locator('[data-path="/notes/sub/story.md"]')).toHaveClass(/selected/);
  await expect.poll(() => fsRead(page, '/notes/sub/story.md')).toBe('');
  expect(await fsRead(page, '/notes/sub/Untitled 2.md')).toBeNull();

  // New Folder: created collapsed, renames in place, opens nothing.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-new-folder').click();
  await expect(input).toHaveValue('New Folder');
  await page.keyboard.type('drafts'); // directories preselect the whole name
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-path="/notes/sub/drafts"]')).toBeVisible();
  await expect(page.getByTestId('docname')).toContainText('story.md'); // unchanged

  // The empty-area menu creates against the root.
  await page.locator('.folder-list').click({ button: 'right', position: { x: 60, y: 400 } });
  await page.getByTestId('folder-menu-new-file').click();
  await expect(input).toHaveValue('Untitled.md');
  await page.keyboard.press('Enter'); // unchanged value ⇒ the cancel path — still opens
  await expect(page.getByTestId('docname')).toContainText('Untitled.md');
  await expect.poll(() => fsRead(page, '/notes/Untitled.md')).toBe('');
});

test('E98: rename in place — open dirty file remaps path/title/recents, dir rename remaps state, invalid names refuse', async ({
  page,
}) => {
  await seedFolders(page);
  await page.keyboard.press('Control+Shift+E');
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await page.locator('[data-path="/notes/sub"]').click(); // expand
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');

  // Dirty the buffer (autosave-on-toggle is off by default).
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTY ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  // The tab mirrors it (SPEC36 unified the dirty marker: `folder-dirty`).
  await expect(page.getByTestId('folder-dirty')).toBeVisible();

  // Rename the open, dirty file: the stem is preselected.
  await page.locator('[data-path="/notes/sub/b.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  const input = page.getByTestId('folder-rename-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('b.md');
  await page.keyboard.type('renamed');
  await expect(input).toHaveValue('renamed.md');
  await page.keyboard.press('Enter');

  // Path, window title, tree selection, and recents all remap; the buffer,
  // dirty flag, and on-disk content are untouched.
  await expect(page.getByTestId('docname')).toContainText('renamed.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect.poll(() => page.title()).toContain('renamed.md •');
  await expect(page.locator('[data-path="/notes/sub/renamed.md"]')).toHaveClass(/selected/);
  await expect.poll(() => fsRead(page, '/notes/sub/renamed.md')).toBe('# B doc\n');
  expect(await fsRead(page, '/notes/sub/b.md')).toBeNull();
  await expect.poll(() => fsRead(page, '/config/recent.json')).toContain('/notes/sub/renamed.md');
  expect(await fsRead(page, '/config/recent.json')).not.toContain('/notes/sub/b.md');

  // The next ⌘S writes the new path; the old path stays gone.
  await page.keyboard.press('Control+s');
  await expect.poll(() => fsRead(page, '/notes/sub/renamed.md')).toContain('DIRTY');
  expect(await fsRead(page, '/notes/sub/b.md')).toBeNull();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(page.getByTestId('folder-dirty')).toHaveCount(0);

  // Rename the directory ABOVE the open file: docPath/expanded/selection
  // remap and foldertree.json reflects it.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  await expect(input).toHaveValue('sub');
  await page.keyboard.type('stuff'); // directories select the whole name
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-path="/notes/stuff/renamed.md"]')).toBeVisible(); // still expanded
  await expect(page.locator('[data-path="/notes/stuff/renamed.md"]')).toHaveClass(/selected/);
  await expect(page.getByTestId('docname')).toContainText('renamed.md');
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).toContain('/notes/stuff');
  await expect.poll(() => fsRead(page, '/config/recent.json')).toContain('/notes/stuff/renamed.md');

  // Collision (case-insensitive, against live siblings) refuses to commit.
  await page.locator('[data-path="/notes/a.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  await input.fill('STUFF');
  await expect(input).toHaveClass(/invalid/);
  await page.keyboard.press('Enter'); // cancels instead of committing
  await expect(input).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/a.md"]')).toBeVisible();
  await expect.poll(() => fsRead(page, '/notes/a.md')).toBe('# A doc\n');

  // Windows-reserved names refuse with the reason in the tooltip; Esc restores.
  await page.locator('[data-path="/notes/a.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  await input.fill('con.md');
  await expect(input).toHaveClass(/invalid/);
  await expect(input).toHaveAttribute('title', /reserved/i);
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/a.md"]')).toBeVisible();
});

test('E99: delete — cancel no-op, dim file trashes, open dirty file to splash, expanded directory prunes', async ({
  page,
}) => {
  await seedFolders(page);
  await page.keyboard.press('Control+Shift+E');
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await page.getByTestId('folder-filter').click(); // show all files

  // Cancel is a no-op.
  await page.locator('[data-path="/notes/zzz.txt"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await expect(page.getByTestId('folder-delete-prompt')).toBeVisible();
  await expect(page.getByTestId('folder-delete-prompt')).toContainText('Move “zzz.txt” to the Trash?');
  await page.getByTestId('folder-delete-cancel').click();
  await expect(page.getByTestId('folder-delete-prompt')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/zzz.txt"]')).toBeVisible();
  expect(await page.evaluate(() => window.__mmTrash ?? [])).toEqual([]);

  // Esc is the same no-op.
  await page.locator('[data-path="/notes/zzz.txt"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-delete-prompt')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/zzz.txt"]')).toBeVisible();

  // Deleting a dim file removes its row and records on __mmTrash.
  await page.locator('[data-path="/notes/pic.png"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await page.getByTestId('folder-delete-confirm').click();
  await expect(page.locator('[data-path="/notes/pic.png"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__mmTrash)).toEqual(['/notes/pic.png']);

  // Deleting the open DIRTY file: the prompt says so; confirm lands on the
  // splash and prunes recents and the crash draft.
  await page.locator('[data-path="/notes/sub"]').click(); // expand
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTY ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/draft.json'), { timeout: 20000 }).toContain('/notes/sub/b.md');
  await page.locator('[data-path="/notes/sub/b.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await expect(page.getByTestId('folder-delete-prompt')).toContainText('Move “b.md” to the Trash?');
  await expect(page.getByTestId('folder-delete-prompt')).toContainText('It has unsaved changes.');
  await page.getByTestId('folder-delete-confirm').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.locator('.folder-item.selected')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveCount(0);
  await expect.poll(() => fsRead(page, '/config/recent.json')).not.toContain('/notes/sub/b.md');
  await expect.poll(() => fsRead(page, '/config/draft.json')).toBeNull();
  expect(await page.evaluate(() => window.__mmTrash)).toEqual(['/notes/pic.png', '/notes/sub/b.md']);

  // Deleting an EXPANDED directory containing the open (clean) doc: all of
  // the above plus the expanded set prunes.
  await page.locator('[data-path="/notes/sub/deep"]').click(); // expand
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await expect(page.getByTestId('folder-delete-prompt')).toContainText('Move “sub” and its contents to the Trash?');
  await expect(page.getByTestId('folder-delete-prompt')).not.toContainText('unsaved');
  await page.getByTestId('folder-delete-confirm').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub"]')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveCount(0);
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).not.toContain('/notes/sub');
  await expect.poll(() => fsRead(page, '/config/recent.json')).not.toContain('c.md');
  expect(await page.evaluate(() => window.__mmTrash)).toEqual(['/notes/pic.png', '/notes/sub/b.md', '/notes/sub']);
});

// --- SPEC36: multiple open files as sidebar tabs --------------------------------

/** Set the folder root to /notes through the armed Open Folder… hook. */
const openNotesRoot = async (page: import('@playwright/test').Page) => {
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await expect(page.getByTestId('folder-header')).toContainText('notes');
};

/** Type `text` at the top of the buffer in edit mode, then back to preview. */
const dirtyActiveDoc = async (page: import('@playwright/test').Page, text: string) => {
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type(text);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
};

test('E100: Mod+click opens IN ADDITION — front/behind tab classes, no prompts across dirty switches, plain-click replaces', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);

  // Plain click replaces the (clean) welcome doc — one file open.
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Mod+click opens b IN ADDITION and activates it: b is the front tab
  // (selected), a sits behind (open, not selected).
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/a.md"]')).not.toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).not.toHaveClass(/\bopen\b/);

  // Mod+click on the ACTIVE row is a no-op.
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);

  // Dirty the active file, then Mod+click the open row a — NO prompt, park.
  await dirtyActiveDoc(page, 'TABDIRTY ');
  await page.locator('[data-path="/notes/a.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/selected/);

  // Plain click on the open row b just activates — still no prompt, and the
  // parked dirty buffer is intact (dirty dot + the typed text).
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.getByTestId('doc')).toContainText('TABDIRTY');

  // Plain click on a NOT-open file replaces the active (dirty) one — the
  // guard prompts; Don't Save closes b out of the set; the count stays 2.
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);
});

test('E101: only-open-files mode — button/hotkey/View menu, flat tree-order list, # disabled, empty state, sync returns, persists', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);
  await menuClick(page, 'toggleFolders');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  const openOnlyItem = () =>
    page.evaluate(() => {
      const view = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!;
      return view.items.find(
        (i) => i.type === 'command' && (i as { command?: string }).command === 'toggleOpenOnly'
      ) as { checked?: boolean };
    });

  // Nothing open: the header button still works (root set) — empty state,
  // # filter disabled, View checkbox on, accent class on.
  await page.getByTestId('folder-open-only').click();
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/filter-on/);
  await expect(page.getByTestId('folder-open-empty')).toBeVisible();
  await expect(page.getByTestId('folder-filter')).toBeDisabled();
  await expect.poll(async () => (await openOnlyItem()).checked).toBe(true);

  // The hotkey flips it back to the tree.
  await page.waitForTimeout(200); // SPEC12 §1.3 cross-source dedup window
  await page.keyboard.press('Control+Shift+O');
  await expect(page.getByTestId('folder-open-empty')).toHaveCount(0);
  await expect.poll(async () => (await openOnlyItem()).checked).toBe(false);

  // Open three files across depths, then enter the mode via the View menu.
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page).toHaveTitle(/c\.md/);
  await page.waitForTimeout(200);
  await menuClick(page, 'toggleOpenOnly');

  // Flat list in visible tree order — folders gone, no chevron rows, the
  // active file front, the others behind as pills.
  const names = () =>
    page.$$eval('[data-testid="folder-item"]', (els) => els.map((e) => e.getAttribute('data-path')));
  await expect.poll(names).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md']);
  await expect(page.locator('.folder-item-dir')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);

  // Sync returns to the tree with the active row revealed and selected.
  await page.getByTestId('folder-sync').click();
  await expect(page.getByTestId('folder-open-only')).not.toHaveClass(/filter-on/);
  await expect(page.locator('[data-path="/notes/sub"]')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);
  await expect(page.getByTestId('folder-filter')).toBeEnabled();

  // Mode + set survive a reload (openOnly rides foldertree.json).
  await page.waitForTimeout(200);
  await page.getByTestId('folder-open-only').click();
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/filter-on/);
  await page.reload();
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/filter-on/);
  await expect.poll(names).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md']);
  await expect(page).toHaveTitle(/c\.md/);
});

test('E102: Ctrl+Tab cycles in tree order with wrap, Ctrl+Shift+Tab reverses, edits survive, single file no-ops, edit-mode safe', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // A single open file: cycling is a no-op.
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Open b and c — tree order is [c, b, a] (deepest directories first).
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('docname')).toContainText('c.md');

  // Forward from c → b.
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('b.md');

  // Dirty b in EDIT mode, cycle straight from the editor — no prompt, no
  // inserted tab character, lands on a.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('CYCLEDIRTY ');
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Wrap forward from the last entry back to c; reverse wraps back to a.
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Reverse again to b: the mid-cycle edit is intact, dirty dot and all,
  // and no literal tab landed in the buffer.
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.getByTestId('doc')).toContainText('CYCLEDIRTY');
  expect(await page.evaluate(() => document.querySelector('[data-testid="doc"]')!.textContent)).not.toContain('\t');
});

test('E103: dirty lifecycle — free switching, ● markers, hover ✕, cancel/discard closes, neighbor activation, splash on last', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });

  // Dirty b (active), switch to a with no prompt, dirty a too.
  await dirtyActiveDoc(page, 'DIRTYB ');
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await dirtyActiveDoc(page, 'DIRTYA ');

  // Both rows carry the ● (active-dirty and parked-dirty alike).
  await expect(page.locator('[data-path="/notes/a.md"] [data-testid="folder-dirty"]')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeVisible();

  // Hover swaps ● for ✕ on that row.
  await page.locator('[data-path="/notes/sub/b.md"]').hover();
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-tab-close"]')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeHidden();

  // ✕ on the dirty background b: it activates first, then prompts; Cancel
  // keeps it open AND active.
  await page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-tab-close"]').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);

  // ✕ again, Don't Save: b closes, the tree-order neighbor a takes the
  // front with its own dirty buffer intact.
  await page.locator('[data-path="/notes/sub/b.md"]').hover();
  await page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-tab-close"]').click();
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).not.toHaveClass(/\bopen\b/);
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.getByTestId('doc')).toContainText('DIRTYA');

  // A clean background file closes silently: open c, return to a, ✕ c.
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').hover();
  await page.locator('[data-path="/notes/sub/deep/c.md"] [data-testid="folder-tab-close"]').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).not.toHaveClass(/\bopen\b/);
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Closing the LAST open file (dirty ⇒ prompt) lands on the splash with
  // the selection cleared.
  await page.locator('[data-path="/notes/a.md"]').hover();
  await page.locator('[data-path="/notes/a.md"] [data-testid="folder-tab-close"]').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.locator('.folder-item.selected')).toHaveCount(0);
});

test('E104: quit walks every dirty file in order (save/cancel paths), restore survives relaunch, the setting gates it', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);
  await menuClick(page, 'toggleFolders');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-open-btn').click();
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  // Open a then b, dirty BOTH (a parks dirty behind b).
  await page.locator('[data-path="/notes/a.md"]').click();
  await menuClick(page, 'toggleMode');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('QUITA ');
  await menuClick(page, 'toggleMode');
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });
  await menuClick(page, 'toggleMode');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('QUITB ');
  await menuClick(page, 'toggleMode');
  await expect(page).toHaveTitle(/b\.md •/);

  // Quit: the walk starts at the tree-order first dirty file — b — which is
  // already active. Cancel aborts the WHOLE quit; both stay open and dirty.
  await menuClick(page, 'close');
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  await expect(page.getByTestId('close-prompt')).toContainText('b.md');
  await page.getByTestId('close-cancel').click();
  await expect(page.getByTestId('close-prompt')).toHaveCount(0);
  await expect(page).toHaveTitle(/b\.md •/);
  await expect(page.locator('[data-path="/notes/a.md"] [data-testid="folder-dirty"]')).toBeVisible();

  // Quit again: Save writes b to disk, then the walk activates a (visible
  // behind its own prompt); Cancel there still aborts with a intact.
  await menuClick(page, 'close');
  await expect(page.getByTestId('close-prompt')).toContainText('b.md');
  await page.getByTestId('close-save').click();
  await expect.poll(() => fsRead(page, '/notes/sub/b.md')).toContain('QUITB');
  await expect(page.getByTestId('close-prompt')).toContainText('a.md');
  await expect(page).toHaveTitle(/a\.md •/);
  await page.getByTestId('close-cancel').click();
  await expect(page.getByTestId('close-prompt')).toHaveCount(0);
  await expect(page).toHaveTitle(/a\.md •/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/\bopen\b/);

  // Clean up a, add c to the set, then delete c on disk: the restore drops
  // the vanished path and falls back to the first survivor as active.
  await menuClick(page, 'save');
  await expect(page).toHaveTitle(/a\.md — /);
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page).toHaveTitle(/c\.md/);
  await page.evaluate(() => window.__mmfs!.remove('/notes/sub/deep/c.md'));
  await page.reload();
  await expect(page).toHaveTitle(/b\.md/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);

  // Setting off: boot ignores the set (single reopen-last-doc behavior) but
  // foldertree.json KEEPS it — flipping back on revives both tabs.
  await page.evaluate(() => {
    const s = JSON.parse(window.__mmfs!.read('/config/settings.json') ?? '{}');
    s.restoreOpenFiles = false;
    window.__mmfs!.write('/config/settings.json', JSON.stringify(s));
  });
  await page.reload();
  await expect(page).toHaveTitle(/b\.md/);
  await expect(page.locator('[data-path="/notes/a.md"]')).not.toHaveClass(/\bopen\b/);
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).toContain('/notes/a.md');
  await page.evaluate(() => {
    const s = JSON.parse(window.__mmfs!.read('/config/settings.json') ?? '{}');
    s.restoreOpenFiles = true;
    window.__mmfs!.write('/config/settings.json', JSON.stringify(s));
  });
  await page.reload();
  await expect(page).toHaveTitle(/b\.md/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);
});

// ---------------------------------------------------------------------------
// SPEC43: Smart Edit (E105–E108)

test('E105: smart-edit gutter button — cursor line only, follows the caret, right of line numbers, survives numbers-off, opens the menu', async ({
  page,
}) => {
  await fsWrite(page, '/docs/smart.md', 'alpha\nbeta\ngamma delta\n');
  await page.goto('/#open=/docs/smart.md');
  await expect(page.getByTestId('doc')).toContainText('alpha');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();

  // One button, on the cursor's line.
  const btn = page.getByTestId('smart-edit-gutter');
  await expect(btn).toHaveCount(1);
  await editor.locator('.cm-line').filter({ hasText: /^beta$/ }).click();
  const lineBox = (await editor.locator('.cm-line').filter({ hasText: /^beta$/ }).boundingBox())!;
  let btnBox = (await btn.boundingBox())!;
  expect(Math.abs(btnBox.y - lineBox.y)).toBeLessThan(4);

  // It follows the caret.
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await btn.boundingBox())!.y).toBeGreaterThan(btnBox.y);

  // Right of the line-number gutter.
  const numBox = (await editor.locator('.cm-gutter.cm-lineNumbers').boundingBox())!;
  btnBox = (await btn.boundingBox())!;
  expect(btnBox.x).toBeGreaterThan(numBox.x);

  // Line numbers off (SPEC3 §2): the smart gutter stands alone.
  await openSettings(page);
  await page.getByTestId('settings-tab-general').click();
  await page.getByTestId('settings-line-numbers').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(editor.locator('.cm-gutter.cm-lineNumbers')).toHaveCount(0);
  await expect(btn).toBeVisible();

  // Click opens the menu with hotkey labels rendered.
  await btn.click();
  const menu = page.getByTestId('smart-edit-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('smart-edit-bold').locator('.menu-hotkey')).toHaveText(/(⌘B|Ctrl\+B)/);
  await expect(menu.getByTestId('smart-edit-heading')).toBeVisible();

  // Esc dismisses…
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // …and so does an outside pointer-down.
  await btn.click();
  await expect(menu).toBeVisible();
  await editor.locator('.cm-content').click({ position: { x: 200, y: 10 } });
  await expect(menu).toHaveCount(0);

  // Preview mode shows no gutter button.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toContainText('alpha');
  await expect(page.getByTestId('smart-edit-gutter')).toHaveCount(0);
});

test('E106: formatting end-to-end — bold via menu, italic via hotkey, H2 via the flyout, multi-line bullet toggle, one undo step each, inert in preview', async ({
  page,
}) => {
  await fsWrite(page, '/docs/fmt.md', 'alpha\nbeta\ngamma delta\n');
  await page.goto('/#open=/docs/fmt.md');
  await expect(page.getByTestId('doc')).toContainText('alpha');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // Bold on a selection, via the menu.
  await editor.locator('.cm-line').filter({ hasText: /^beta$/ }).dblclick();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('beta');
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-bold').click();
  await expect(content).toContainText('**beta**');
  // Exactly one undo step restores the prior text.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).not.toContainText('**beta**');
  await expect(content).toContainText('beta');

  // Italic via its default hotkey.
  await editor.locator('.cm-line').filter({ hasText: /^beta$/ }).dblclick();
  await page.keyboard.press('Control+i');
  await expect(content).toContainText('*beta*');

  // H2 via the Heading flyout.
  await editor.locator('.cm-line').filter({ hasText: /^alpha$/ }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-heading').click();
  await expect(page.getByTestId('smart-edit-flyout-heading')).toBeVisible();
  await page.getByTestId('smart-edit-h2').click();
  await expect(content).toContainText('## alpha');

  // Bullet toggle across a two-line selection (on, then off), via its hotkey.
  const preBullets = await text();
  await editor.locator('.cm-line').filter({ hasText: /beta/ }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+Shift+8');
  await expect(content).toContainText('- *beta*');
  await expect(content).toContainText('- gamma delta');
  await page.keyboard.press('Control+Shift+8');
  expect(await text()).toBe(preBullets);
  // One undo step per action: a single undo restores the bulleted form.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).toContainText('- *beta*');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(preBullets);

  // A formatting hotkey in preview mode changes nothing.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toContainText('alpha');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+e');
  await expect(content).toBeVisible();
  expect(await text()).toBe(preBullets);
});

test('E107: right-click & context — menu at the pointer, Image ▸ flyout in context, clipboard rows, preview untouched', async ({
  page,
}) => {
  const DOC = [
    'intro text here',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '![alt](pics/x.png)',
    '',
    'plain outro',
  ].join('\n');
  await fsWrite(page, '/docs/ctx.md', DOC);
  await page.goto('/#open=/docs/ctx.md');
  await expect(page.getByTestId('doc')).toContainText('intro text here');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // Plain text: right-click opens the menu at the pointer. SPEC37 §9
  // amendment: the contextual table entry lives under the Table ▸ flyout —
  // open it and check the enabled flags instead of item absence.
  await editor.locator('.cm-line').filter({ hasText: 'plain outro' }).click();
  await editor.locator('.cm-line').filter({ hasText: 'plain outro' }).click({ button: 'right' });
  await expect(page.getByTestId('smart-edit-menu')).toBeVisible();
  await page.getByTestId('smart-edit-table').click();
  await expect(page.getByTestId('smart-edit-toggle-grid')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-insert-table')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-delete-table')).toBeDisabled();
  await expect(page.getByTestId('smart-edit-resize-image')).toHaveCount(0);
  await page.keyboard.press('Escape'); // close the flyout, keep the menu
  // Cut/Copy are disabled without a selection.
  await expect(page.getByTestId('smart-edit-cut')).toBeDisabled();
  await expect(page.getByTestId('smart-edit-copy')).toBeDisabled();
  await page.keyboard.press('Escape');

  // Cursor in the pipe table — SPEC40 §6 amendment: the table is ALREADY a
  // grid (the default view); the flyout offers the global toggle and Delete,
  // with Insert disabled inside.
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(3);
  await editor.locator('.cm-line').filter({ hasText: '| 1   | 2   |' }).click();
  await editor.locator('.cm-line').filter({ hasText: '| 1   | 2   |' }).click({ button: 'right' });
  await page.getByTestId('smart-edit-table').click();
  await expect(page.getByTestId('smart-edit-toggle-grid')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-delete-table')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-insert-table')).toBeDisabled();
  await page.keyboard.press('Escape'); // close the flyout…
  await page.keyboard.press('Escape'); // …and the menu — no view flip
  await expect(page.getByTestId('smart-edit-menu')).toHaveCount(0);
  const beforeTable = await text(); // the grid state — the baseline below

  // Cursor on the image — SPEC41 §8 amendment: the reference renders as a
  // widget; arrow into the span (caret-reveal) and use the Image ▸ flyout
  // (the SPEC43 top-level stub is gone).
  await editor.locator('.cm-line').filter({ hasText: 'plain outro' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight'); // strictly inside — the raw syntax reveals
  await expect(editor.locator('.cm-line').filter({ hasText: 'pics/x.png' })).toBeVisible();
  await editor.locator('.cm-line').filter({ hasText: 'pics/x.png' }).click({ button: 'right' });
  await expect(page.getByTestId('smart-edit-menu')).toBeVisible();
  await expect(page.getByTestId('smart-edit-resize-image')).toHaveCount(0); // stub gone
  await page.getByTestId('smart-edit-image').click();
  await expect(page.getByTestId('smart-edit-toggle-images')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-insert-image')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-delete-image')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-resize-image')).toBeEnabled();
  // Resize Image selects the image (caret parks at the span start — the
  // widget returns) and changes NO text.
  await page.getByTestId('smart-edit-resize-image').click();
  await expect(page.getByTestId('smart-edit-menu')).toHaveCount(0);
  expect(await text()).toBe(beforeTable);

  // Copy puts the exact selection on the SPEC35 clipboard seam.
  await editor.locator('.cm-line').filter({ hasText: 'plain outro' }).dblclick();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toMatch(/^(plain|outro)$/);
  const copied = await page.evaluate(() => window.__mmEdit!.selText);
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-copy').click();
  await expect.poll(() => page.evaluate(() => window.__mmClipboard?.at(-1))).toBe(copied);

  // Paste inserts the shim clipboard text at the cursor.
  await page.evaluate(() => (window.__mmClipboard ??= []).push('PASTED'));
  await editor.locator('.cm-line').filter({ hasText: 'intro text here' }).click();
  await page.keyboard.press('End');
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-paste').click();
  await expect(content).toContainText('intro text herePASTED');

  // Preview right-click never opens the smart menu.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toContainText('intro text herePASTED');
  await page.getByTestId('doc').click({ button: 'right' });
  await expect(page.getByTestId('smart-edit-menu')).toHaveCount(0);
});

test('E108: hotkeys & settings — Smart Edit recorder group, rebind updates menu + applies, conflicts refused, Mod+. opener, reset restores defaults', async ({
  page,
}) => {
  await fsWrite(page, '/docs/keys.md', 'alpha\nbeta\n');
  await page.goto('/#open=/docs/keys.md');
  await expect(page.getByTestId('doc')).toContainText('alpha');

  // The Smart Edit group renders with its recorders.
  await openSettings(page, 'hotkeys');
  await expect(page.getByTestId('hotkey-group-smart-edit')).toBeVisible();
  await expect(page.getByTestId('hotkey-group-smart-edit')).toHaveText('Smart Edit');
  const rec = page.getByTestId('hotkey-bold');
  await expect(rec).toHaveValue(/(⌘B|Ctrl\+B)/);

  // A conflict against an existing binding is refused.
  await rec.click();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('hotkey-hint')).toContainText('already bound');
  await expect(rec).toHaveValue(/(⌘B|Ctrl\+B)/);

  // Rebind bold to Mod+F6.
  await rec.click();
  await page.keyboard.press('Control+F6');
  await expect(rec).toHaveValue(/F6/);
  await page.getByTestId('settings-close').click();

  // The new combo applies; the old one no longer does.
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  await editor.locator('.cm-line').filter({ hasText: /^beta$/ }).dblclick();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('beta');
  await page.keyboard.press('Control+F6');
  await expect(content).toContainText('**beta**');
  const afterBold = await text();
  await page.keyboard.press('Control+b');
  expect(await text()).toBe(afterBold);

  // The menu row shows the rebound combo.
  await page.getByTestId('smart-edit-gutter').click();
  await expect(page.getByTestId('smart-edit-bold').locator('.menu-hotkey')).toHaveText(/F6/);
  await page.keyboard.press('Escape');

  // Mod+. opens the menu at the cursor.
  await page.keyboard.press('Control+.');
  await expect(page.getByTestId('smart-edit-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('smart-edit-menu')).toHaveCount(0);

  // Reset restores the Smart Edit defaults too.
  await openSettings(page, 'hotkeys');
  await page.getByTestId('reset-hotkeys').click();
  await expect(page.getByTestId('hotkey-bold')).toHaveValue(/(⌘B|Ctrl\+B)/);
  await page.getByTestId('settings-close').click();
  await page.getByTestId('smart-edit-gutter').click();
  await expect(page.getByTestId('smart-edit-bold').locator('.menu-hotkey')).toHaveText(/(⌘B|Ctrl\+B)/);
});

// ---------------------------------------------------------------------------
// SPEC40: the grid is how tables look — no mode, one global view (E109–E120)

/** Open `path` (fsWrite'd) in edit mode and wait for the default grid. */
async function openGridDoc(
  page: import('@playwright/test').Page,
  path: string,
  doc: string,
  probe: string
): Promise<void> {
  await fsWrite(page, path, doc);
  await page.goto(`/#open=${path}`);
  await expect(page.getByTestId('doc')).toContainText(probe);
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expect(editor.locator('.cm-line.mm-table-mode-line').first()).toBeVisible();
}

/** Put the caret `rights` characters into the line containing `lineText`. */
async function caretInto(page: import('@playwright/test').Page, lineText: string, rights: number): Promise<void> {
  const editor = page.getByTestId('editor');
  await editor.locator('.cm-line').filter({ hasText: lineText }).first().click();
  await page.keyboard.press('Home');
  for (let i = 0; i < rights; i++) await page.keyboard.press('ArrowRight');
}

const COMPACT = '| aaa | b |\n| --- | --- |\n| 1 | 2 |';
const GRID = '| aaa | b   |\n| --- | --- |\n| 1   | 2   |';

test('E109: view-flip lifecycle — grids by default, the menu toggle flips ALL tables, flips never touch history, Esc goes to vim', async ({
  page,
}) => {
  const DOC = `top\n\n${COMPACT}\n\nbottom`;
  await fsWrite(page, '/docs/v104.md', DOC);
  await page.goto('/#open=/docs/v104.md');
  await expect(page.getByTestId('doc')).toContainText('top');
  // Full-screen edit — the grid needs no split.
  await openSettings(page);
  await page.getByTestId('settings-tab-general').click();
  await page.getByTestId('set-split-edit').uncheck();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // The grid is simply there — no clicks, no mode, dirty dot off.
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(3);
  await expect.poll(text).toContain(GRID);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const gridState = await text();

  // Table ▸ "Show Raw Tables" flips every table to raw compact text.
  await editor.locator('.cm-line').filter({ hasText: '| 1   | 2   |' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await expect(page.getByTestId('smart-edit-toggle-grid')).toHaveText(/Show Raw Tables/);
  await page.getByTestId('smart-edit-toggle-grid').click();
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(0);
  await expect.poll(text).toContain(COMPACT);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // …and back, the label flipped.
  await editor.locator('.cm-line').filter({ hasText: '| 1 | 2 |' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await expect(page.getByTestId('smart-edit-toggle-grid')).toHaveText(/Show Table Grid/);
  await page.getByTestId('smart-edit-toggle-grid').click();
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(3);
  expect(await text()).toBe(gridState);

  // The flips never entered history: undo is a no-op on a pristine buffer.
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(gridState);

  // Esc reaches the vim layer directly — there is no table layer to eat it.
  await openSettings(page);
  await page.getByTestId('settings-tab-general').click();
  await page.getByTestId('settings-vimnav').check();
  await page.getByTestId('settings-close').click();
  await content.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vim-badge')).toBeVisible();
});

test('E110: live re-flow — narrow edits stay put, growth re-wraps, one undo step, separators read-only', async ({
  page,
}) => {
  await openGridDoc(page, '/docs/v105.md', `top\n\n${COMPACT}\n\nbottom`, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  await expect.poll(text).toContain(GRID);

  await caretInto(page, '| aaa | b   |', 9);
  const before = await text();
  await page.keyboard.type('x');
  const after = await text();
  expect(after).toContain('| aaa | bx  |');
  expect(after).toContain('| 1   | 2   |');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(3);

  await caretInto(page, '| aaa | b   |', 9);
  await page.keyboard.insertText(
    'this is a very long description that cannot possibly fit on one grid line in the pane'
  );
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBeGreaterThan(3);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(3);

  // Separator lines are read-only from inside (SPEC39 §2.6).
  const preSep = await text();
  await caretInto(page, '| --- | --- |', 2);
  await page.keyboard.press('Shift+End');
  await page.keyboard.type('broken');
  expect(await text()).toBe(preSep);
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(3);
});

test('E111: column chips — follow the caret, insert with landing, delete, 1-column guard', async ({ page }) => {
  await openGridDoc(page, '/docs/v106.md', `top\n\n${COMPACT}\n\nbottom`, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  await expect.poll(text).toContain(GRID);
  const before = await text();

  await caretInto(page, '| aaa | b   |', 3);
  const addLeft = page.getByTestId('table-add-col-left');
  await expect(addLeft).toBeVisible();
  await page.waitForTimeout(150);
  const x0 = (await addLeft.boundingBox())!.x;
  await caretInto(page, '| aaa | b   |', 9);
  await expect.poll(async () => (await addLeft.boundingBox())!.x).toBeGreaterThan(x0);

  await addLeft.click();
  await expect.poll(text).toContain('| aaa |     | b   |');
  await page.keyboard.type('Z');
  await expect.poll(text).toContain('| aaa | Z   | b   |');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);

  await caretInto(page, '| aaa | b   |', 3);
  await page.getByTestId('table-add-col-right').click();
  await expect.poll(text).toContain('| aaa |     | b   |');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);

  await caretInto(page, '| aaa | b   |', 9);
  await page.getByTestId('table-del-col').click();
  await expect.poll(text).toContain('| aaa |\n| --- |\n| 1   |');
  expect(await text()).not.toContain('| b');
  await caretInto(page, '| aaa', 3);
  await expect(page.getByTestId('table-del-col')).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);
});

test('E112: row chips + menu ops — separators between rows, header guards, delete, Insert/Delete Table', async ({
  page,
}) => {
  await openGridDoc(page, '/docs/v107.md', `top\n\n| aaa | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nbottom line`, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  await expect.poll(text).toContain('| 1   | 2   |\n| --- | --- |\n| 3   | 4   |');
  const before = await text();

  await caretInto(page, '| 1   | 2   |', 3);
  await expect(page.getByTestId('table-add-row-above')).toBeVisible();
  await page.getByTestId('table-add-row-above').click();
  await expect.poll(text).toContain('|     |     |\n| --- | --- |\n| 1   | 2   |');
  await page.keyboard.type('Z');
  await expect.poll(text).toContain('| Z   |     |');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);

  await caretInto(page, '| aaa | b   |', 3);
  await expect(page.getByTestId('table-add-row-above')).toHaveCount(0);
  await expect(page.getByTestId('table-del-row')).toHaveCount(0);
  await page.getByTestId('table-add-row-below').click();
  await expect.poll(text).toContain('| --- | --- |\n|     |     |\n| --- | --- |\n| 1   | 2   |');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);
  await caretInto(page, '| --- | --- |', 3);
  await expect(page.getByTestId('table-add-row-above')).toHaveCount(0);
  await expect(page.getByTestId('table-del-row')).toHaveCount(0);
  await expect(page.getByTestId('table-add-col-left')).toBeVisible();

  await caretInto(page, '| 1   | 2   |', 3);
  await page.getByTestId('table-del-row').click();
  await expect.poll(text).not.toContain('| 1   | 2   |');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);

  // Insert Table outside the grids: the starter lands and is IMMEDIATELY a
  // grid (detection), with 'Column 1' still selected in it (§5).
  await editor.locator('.cm-line').filter({ hasText: 'bottom line' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await page.getByTestId('smart-edit-insert-table').click();
  await expect(content).toContainText('| Column 1 | Column 2 | Column 3 |');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('Column 1');
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBeGreaterThan(5);
  // Insert is disabled inside; Delete Table removes it; one undo restores.
  const beforeDelete = await text();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await expect(page.getByTestId('smart-edit-insert-table')).toBeDisabled();
  await page.getByTestId('smart-edit-delete-table').click();
  await expect(content).not.toContainText('| Column 1');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(text).toBe(beforeDelete);
});

test('E113: wrapping — a too-wide table is a fitted grid by default, every display line one visual line, raw view restores one line per row', async ({
  page,
}) => {
  const LONG =
    'an extremely long description sentence that could never fit in one grid line because it just keeps going and going with many words';
  await openGridDoc(page, '/docs/v108.md', `top\n\n| Name | Description |\n| --- | --- |\n| a | ${LONG} |\n\nbottom`, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBeGreaterThan(3);
  const heights = await page.evaluate(() => {
    const base = Array.from(document.querySelectorAll('.cm-line')).find(
      (el) => !el.classList.contains('mm-table-mode-line') && (el.textContent ?? '').trim()
    )!;
    const baseH = base.getBoundingClientRect().height;
    return Array.from(document.querySelectorAll('.cm-line.mm-table-mode-line')).map(
      (el) => el.getBoundingClientRect().height / baseH
    );
  });
  for (const h of heights) expect(h).toBeLessThan(1.5);

  // Type into a wrapped fragment: the exact wrap point depends on the pane
  // width, so assert the insertion landed against whichever word follows it.
  await caretInto(page, 'keeps going', 9);
  await page.keyboard.type('re');
  await expect.poll(text).toMatch(/re(one|grid|going|line)/);
  await page.keyboard.press('ControlOrMeta+z');

  // Raw view: the sentence back on ONE line, no display markers anywhere.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await page.getByTestId('smart-edit-toggle-grid').click();
  const after = await text();
  expect(after).toContain(`| a | ${LONG} |`);
  expect(after).not.toContain('↩');
});

test('E114: the canonical view — saves write compact tables, the preview renders real tables, dirty stays honest', async ({
  page,
}) => {
  const LONG = 'a long wrapped description that will certainly span multiple grid display lines in the editor pane';
  await openGridDoc(page, '/docs/v109.md', `top\n\n| Name | Description |\n| --- | --- |\n| a | ${LONG} |\n\nbottom`, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBeGreaterThan(3);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0); // canonical == saved

  await caretInto(page, '| a', 3);
  await page.keyboard.type('X');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(editor.locator('.cm-line.mm-table-mode-line').first()).toBeVisible(); // grid stays
  const saved = (await fsRead(page, '/docs/v109.md'))!;
  expect(saved).toContain(`| aX | ${LONG} |`);
  expect(saved.includes('↩')).toBe(false);

  await expect(page.locator('[data-testid="split-preview"] table td').first()).toBeVisible();
  await expect(page.locator('[data-testid="split-preview"] table')).toContainText('aX');
});

test('E115: live re-fit — the grid re-wraps to the pane on resize, relaxes back, re-fits never pollute undo', async ({
  page,
}) => {
  const LONG =
    'a very long description sentence that wraps differently depending on how wide the editor pane happens to be right now';
  await openGridDoc(page, '/docs/v110.md', `top\n\n| Name | Description |\n| --- | --- |\n| a | ${LONG} |\n\nbottom`, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  const gridLines = () => editor.locator('.cm-line.mm-table-mode-line').count();
  await expect.poll(gridLines).toBeGreaterThan(3);
  const linesAtWide = await gridLines();

  await page.setViewportSize({ width: 900, height: 720 });
  await expect.poll(gridLines, { timeout: 5000 }).toBeGreaterThan(linesAtWide);
  const singleHeight = () =>
    page.evaluate(() => {
      const base = Array.from(document.querySelectorAll('.cm-line')).find(
        (el) => !el.classList.contains('mm-table-mode-line') && (el.textContent ?? '').trim()
      )!;
      const baseH = base.getBoundingClientRect().height;
      return Array.from(document.querySelectorAll('.cm-line.mm-table-mode-line')).every(
        (el) => el.getBoundingClientRect().height / baseH < 1.5
      );
    });
  await expect.poll(singleHeight).toBe(true);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(gridLines, { timeout: 5000 }).toBeLessThanOrEqual(linesAtWide);
  await expect.poll(singleHeight).toBe(true);

  await caretInto(page, '| a', 3);
  const before = await text();
  await page.keyboard.type('zz');
  await expect.poll(text).toContain('azz');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);
  await expect(editor.locator('.cm-line.mm-table-mode-line').first()).toBeVisible();
});

test('E116: spaces type — words land in the cell, the edge space parks the caret, saves stay canonical', async ({
  page,
}) => {
  await openGridDoc(page, '/docs/v111.md', `top\n\n${COMPACT}\n\nbottom`, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  await expect.poll(text).toContain(GRID);

  await caretInto(page, '| 1   | 2   |', 9);
  await page.keyboard.type(' hello world');
  await expect.poll(text).toContain('| 2 hello world |');
  await page.keyboard.press('Control+s');
  await expect.poll(() => fsRead(page, '/docs/v111.md')).toContain('| 1 | 2 hello world |');

  const settled = await text();
  await caretInto(page, '| 2 hello world |', 3);
  await page.keyboard.press('End');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Space');
  expect(await text()).toBe(settled);
  await expect(editor.locator('.cm-line.mm-table-mode-line').first()).toBeVisible();
});

test('E117: the two switches — menu labels flip the view, the Settings checkbox does too and stays in sync', async ({
  page,
}) => {
  await openGridDoc(page, '/docs/v112.md', `top\n\n${COMPACT}\n\nbottom`, 'top');
  const editor = page.getByTestId('editor');
  const gridLines = () => editor.locator('.cm-line.mm-table-mode-line').count();
  await expect.poll(gridLines).toBe(3);

  // Settings checkbox off → raw everywhere; the menu label follows.
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('settings-table-grid')).toBeChecked();
  await page.getByTestId('settings-table-grid').uncheck();
  await page.getByTestId('settings-close').click();
  await expect.poll(gridLines).toBe(0);
  await editor.locator('.cm-line').filter({ hasText: '| 1 | 2 |' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await expect(page.getByTestId('smart-edit-toggle-grid')).toHaveText(/Show Table Grid/);
  // Flip back from the menu; the checkbox follows.
  await page.getByTestId('smart-edit-toggle-grid').click();
  await expect.poll(gridLines).toBe(3);
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('settings-table-grid')).toBeChecked();
});

test('E118: confinement — Enter/Tab navigate, edge deletions inert, pipes self-escape, ⌘A selects the cell, pastes flatten', async ({
  page,
}) => {
  await openGridDoc(page, '/docs/v113.md', `top\n\n| aaa | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nbottom`, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  await expect.poll(text).toContain('| 1   | 2   |');
  const before = await text();

  await caretInto(page, '| aaa | b   |', 3);
  await page.keyboard.press('Enter');
  expect(await text()).toBe(before);
  await page.keyboard.type('X');
  await expect.poll(text).toContain('| 1X  | 2   |');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);

  await caretInto(page, '| 1   | 2   |', 3);
  await page.keyboard.press('Tab');
  expect(await text()).toBe(before);
  await page.keyboard.type('Y');
  await expect.poll(text).toContain('| 1   | 2Y  |');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);

  await caretInto(page, '| 1   | 2   |', 2);
  await page.keyboard.press('Backspace');
  expect(await text()).toBe(before);

  await caretInto(page, '| 1   | 2   |', 3);
  await page.keyboard.type('|');
  await expect.poll(text).toContain('| 1\\|');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);

  await caretInto(page, '| aaa | b   |', 3);
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('aaa');

  await caretInto(page, '| 3   | 4   |', 3);
  await page.keyboard.insertText('m\nn|o');
  await expect.poll(text).toContain('| 3m n\\|o | 4');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await text()).toBe(before);

  await caretInto(page, '| 1   | 2   |', 2);
  await page.keyboard.press('Shift+End');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('2');
});

test('E119: grids by default — two tables, untouched saves are byte-identical, a hand-typed table snaps to grid, breaking one leaves the other', async ({
  page,
}) => {
  // The second table carries decorative padding — the originals rule must
  // preserve it byte-for-byte through open/edit/save.
  const PADDED = '| x    | y |\n| --- | --- |\n| 7    | 8 |';
  const DOC = `top\n\n${COMPACT}\n\nmiddle\n\n${PADDED}\n\ntail`;
  await openGridDoc(page, '/docs/v114.md', DOC, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // Both tables are grids; the dirty dot is off.
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBe(6);
  await expect.poll(text).toContain(GRID);
  await expect.poll(text).toContain('| x   | y   |');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // An untouched save writes the ORIGINAL bytes — padding preserved.
  await page.keyboard.press('Control+s');
  await expect.poll(() => fsRead(page, '/docs/v114.md')).toBe(DOC);

  // A hand-typed table snaps to a grid when its delimiter completes.
  await editor.locator('.cm-line').filter({ hasText: 'tail' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('| new | cols |');
  await page.keyboard.press('Enter');
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBe(6); // not yet
  await page.keyboard.type('| --- | --- |');
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBeGreaterThan(6);
  await expect.poll(text).toContain('| new | cols |');

  // Deleting one grid's source needs a BOTH-outside selection — incremental
  // Shift+Down gets clamped the moment the head enters the grid (by design),
  // so jump across it in one gesture with a Shift+Click.
  const before = await text();
  await editor.locator('.cm-line').filter({ hasText: 'middle' }).click();
  await page.keyboard.press('Home');
  await editor.locator('.cm-line').filter({ hasText: 'tail' }).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  await expect.poll(text).not.toContain('| x   | y   |');
  await expect.poll(text).toContain(GRID); // the first grid is untouched
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(text).toBe(before);
});

test('E120: the global toggle — both tables flip together, originals restore, the setting persists across reload', async ({
  page,
}) => {
  const PADDED = '| x    | y |\n| --- | --- |\n| 7    | 8 |';
  const DOC = `top\n\n${COMPACT}\n\nmiddle\n\n${PADDED}\n\ntail`;
  await openGridDoc(page, '/docs/v115.md', DOC, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  const gridLines = () => editor.locator('.cm-line.mm-table-mode-line').count();
  await expect.poll(gridLines).toBe(6);

  // Raw view: BOTH collapse — the padded one back to its exact original.
  await editor.locator('.cm-line').filter({ hasText: '| 1   | 2   |' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await page.getByTestId('smart-edit-toggle-grid').click();
  await expect.poll(gridLines).toBe(0);
  const raw = await text();
  expect(raw).toContain(COMPACT);
  expect(raw).toContain('| x    | y |'); // decorative padding restored
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z'); // flips never enter history
  expect(await text()).toBe(raw);

  // The setting persists: reload, reopen, still raw.
  await page.keyboard.press('Control+s');
  await page.reload();
  await expect(page.getByTestId('doc')).toContainText('top');
  await page.keyboard.press('Control+e');
  await expect(content).toBeVisible();
  await expect.poll(gridLines).toBe(0);

  // Back on from the menu: both grid again.
  await editor.locator('.cm-line').filter({ hasText: '| 1 | 2 |' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await page.getByTestId('smart-edit-toggle-grid').click();
  await expect.poll(gridLines).toBe(6);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// SPEC41: images render in the editor — one global view, chips to resize
// (E121–E123)

test('E121: the rendered view — widgets by default, caret-reveal, both switches flip and persist, remote srcs stay blocked with zero requests', async ({
  page,
}) => {
  // The SPEC11 guarantee extends to the edit pane: block-and-log anything
  // that tries to leave localhost for the whole test.
  const external: string[] = [];
  await page.context().route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    external.push(route.request().url());
    return route.abort();
  });

  await fsWrite(page, '/docs/img116.png', `data:image/png;base64,${WIDE_PNG}`);
  const DOC = 'top\n\n![p](img116.png)\n\n![r](https://evil.example.com/x.png)\n\nbottom';
  await fsWrite(page, '/docs/v116.md', DOC);
  await page.goto('/#open=/docs/v116.md');
  await expect(page.getByTestId('doc')).toContainText('top');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // The local image is simply a PICTURE — real pixels via the shim's data:
  // URI, the raw syntax hidden, the dirty dot off.
  const widgetImg = editor.locator('.mm-image-widget img');
  await expect(widgetImg).toBeVisible();
  expect(await widgetImg.getAttribute('src')).toContain('data:image/png');
  expect(await text()).not.toContain('![p](img116.png)');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The remote image NEVER loads — the SPEC11 placeholder renders instead.
  const blocked = editor.locator('.mm-blocked-remote');
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText('remote image (evil.example.com');
  await expect(blocked).toContainText('Marky Mark is local-only');
  await expect(editor.locator('img[src*="evil"]')).toHaveCount(0);

  // Caret-reveal: arrow INTO the remote span — its raw markdown appears.
  await editor.locator('.cm-line').filter({ hasText: 'bottom' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); // the remote line, caret at the span start
  await page.keyboard.press('ArrowRight'); // strictly inside — reveal
  await expect(content).toContainText('![r](https://evil.example.com/x.png)');
  // …and into the local span two lines up: vertical motion lands at the
  // hidden span's start (the widget stays); one ArrowRight steps inside and
  // the picture yields to its syntax.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await expect(content).toContainText('![p](img116.png)');
  await expect(editor.locator('.mm-image-widget img')).toHaveCount(0);
  // Arrow out — the picture returns; nothing was ever text-changed.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(editor.locator('.mm-image-widget img')).toBeVisible();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // Image ▸ "Show Raw Images": ALL images drop to syntax at once.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await expect(page.getByTestId('smart-edit-toggle-images')).toHaveText(/Show Raw Images/);
  await page.getByTestId('smart-edit-toggle-images').click();
  await expect(editor.locator('.mm-image-widget')).toHaveCount(0);
  await expect(content).toContainText('![p](img116.png)');
  await expect(content).toContainText('![r](https://evil.example.com/x.png)');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The Settings checkbox reflects the flip and drives it back on.
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('settings-inline-images')).not.toBeChecked();
  await page.getByTestId('settings-inline-images').check();
  await page.getByTestId('settings-close').click();
  await expect(editor.locator('.mm-image-widget img')).toBeVisible();

  // Off again, and the setting survives a reload.
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('settings-inline-images').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(editor.locator('.mm-image-widget')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('doc')).toContainText('top');
  await page.keyboard.press('Control+e');
  await expect(content).toBeVisible();
  await expect(content).toContainText('![p](img116.png)');
  await expect(editor.locator('.mm-image-widget')).toHaveCount(0);

  // The menu label flipped; it brings the pictures back.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await expect(page.getByTestId('smart-edit-toggle-images')).toHaveText(/Show Rendered Images/);
  await page.getByTestId('smart-edit-toggle-images').click();
  await expect(editor.locator('.mm-image-widget img')).toBeVisible();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The zero-network guarantee held for the whole journey.
  expect(external).toEqual([]);
});

test('E122: resize chips — the eight-chip ring on every border and corner, edge/corner drags persist, double-click clears, 40px clamp, one ⌘Z each, preview clean', async ({
  page,
}) => {
  await fsWrite(page, '/docs/img117.png', `data:image/png;base64,${WIDE_PNG}`);
  const DOC = '# Pic\n\n![p](img117.png)\n\nafter\n';
  await fsWrite(page, '/docs/v117.md', DOC);
  await page.goto('/#open=/docs/v117.md');
  await expect(page.getByTestId('doc')).toContainText('Pic');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();

  // The buffer, read back through ⌘S (the widget hides the raw span).
  const saved = async () => {
    await page.keyboard.press('Control+s');
    return (await fsRead(page, '/docs/v117.md'))!;
  };
  const widgetImg = () => editor.locator('.mm-image-widget img');
  const dragChip = async (id: string, dx: number, dy: number) => {
    const box = (await page.getByTestId(id).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
    await page.mouse.up();
  };

  // Click → exactly EIGHT chips (SPEC42 §1), each centered ON its border
  // middle or corner.
  await widgetImg().click();
  const layer = page.getByTestId('image-chip-layer');
  await expect(layer).toBeVisible();
  await expect(layer.locator('.table-chip')).toHaveCount(8);
  const ib = (await widgetImg().boundingBox())!;
  const at = async (id: string, cx: number, cy: number) => {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(Math.abs(b.x + b.width / 2 - cx), `${id} x`).toBeLessThanOrEqual(3);
    expect(Math.abs(b.y + b.height / 2 - cy), `${id} y`).toBeLessThanOrEqual(3);
  };
  const L = ib.x;
  const R = ib.x + ib.width;
  const T = ib.y;
  const B = ib.y + ib.height;
  const MX = ib.x + ib.width / 2;
  const MY = ib.y + ib.height / 2;
  await at('image-resize-l', L, MY);
  await at('image-resize-t', MX, T);
  await at('image-resize-w', R, MY);
  await at('image-resize-h', MX, B);
  await at('image-resize-tl', L, T);
  await at('image-resize-tr', R, T);
  await at('image-resize-bl', L, B);
  await at('image-resize-wh', R, B);
  // The circles carry empty faces.
  expect(await page.getByTestId('image-resize-wh').innerText()).toBe('');
  expect(await page.getByTestId('image-resize-tl').innerText()).toBe('');

  // 1) Corner drag +50: width persists, NO height — natural aspect kept.
  await dragChip('image-resize-wh', 50, 25);
  await expect.poll(saved).toContain('<img src="img117.png" alt="p" width="250">');
  expect(await saved()).not.toContain('height=');
  const grown = (await widgetImg().boundingBox())!;
  expect(Math.abs(grown.width / grown.height - 2)).toBeLessThanOrEqual(0.05); // 200×100 ratio

  // 2) Right drag +30: width dragged AND height frozen — the box holds.
  await widgetImg().click();
  await dragChip('image-resize-w', 30, 0);
  await expect.poll(saved).toContain('width="280"');
  expect(await saved()).toContain('height="125"');

  // 3) Double-click the corner: both cleared, natural size back.
  await widgetImg().click();
  await page.getByTestId('image-resize-wh').dblclick();
  await expect.poll(saved).toContain('<img src="img117.png" alt="p">');
  expect(await saved()).not.toContain('width=');

  // 4) LEFT border drag −60 (outward): width dragged + height frozen.
  await widgetImg().click();
  await dragChip('image-resize-l', -60, 0);
  await expect.poll(saved).toContain('width="260"');
  expect(await saved()).toContain('height="100"');

  // 5) TOP-LEFT corner drag up-left: ratio locked, width only, no height.
  await widgetImg().click();
  await dragChip('image-resize-tl', -40, -20);
  await expect.poll(saved).toContain('width="300"');
  expect(await saved()).not.toContain('height=');

  // 6) Double-click a corner OTHER than bottom-right: both cleared too.
  await widgetImg().click();
  await page.getByTestId('image-resize-tr').dblclick();
  await expect.poll(saved).toContain('<img src="img117.png" alt="p">');
  expect(await saved()).not.toContain('width=');

  // 7) A hard left drag on the right chip clamps at 40px.
  await widgetImg().click();
  await dragChip('image-resize-w', -500, 0);
  await expect.poll(saved).toContain('width="40"');

  // Each release was ONE undo step: seven ⌘Z return the original bytes.
  for (let i = 0; i < 7; i++) await page.keyboard.press('ControlOrMeta+z');
  expect(await saved()).toBe(DOC);
  await expect(widgetImg()).toBeVisible();

  // The split preview renders the image with NO overlay or handles, ever.
  const previewImg = page.getByTestId('split-preview').locator('img[alt="p"]');
  await expect(previewImg).toBeVisible();
  await previewImg.click();
  await expect(page.getByTestId('img-resize-overlay')).toHaveCount(0);
  await expect(page.getByTestId('image-chip-layer')).toHaveCount(0);
});

test('E123: the Image ▸ menu — labels and flags by context, Insert dispatches the picker, Delete splices with one-step undo, grid images stay raw', async ({
  page,
}) => {
  await fsWrite(page, '/docs/img118.png', `data:image/png;base64,${WIDE_PNG}`);
  const DOC = [
    'top',
    '',
    '![a](img118.png)',
    '',
    '| h1 | h2 |',
    '| --- | --- |',
    '| ![c](img118.png) | 2 |',
    '',
    'plain outro',
  ].join('\n');
  await fsWrite(page, '/docs/v118.md', DOC);
  await page.goto('/#open=/docs/v118.md');
  await expect(page.getByTestId('doc')).toContainText('top');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // Grid exclusion: the table renders as a grid, its cell image stays RAW
  // text — only the standalone reference grew a widget.
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(3);
  await expect.poll(text).toContain('![c](img118.png)');
  await expect(editor.locator('.mm-image-widget')).toHaveCount(1);

  // Plain-text context: toggle/insert enabled, delete/resize disabled.
  await editor.locator('.cm-line').filter({ hasText: 'plain outro' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await expect(page.getByTestId('smart-edit-toggle-images')).toHaveText(/Show Raw Images/);
  await expect(page.getByTestId('smart-edit-toggle-images')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-insert-image')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-delete-image')).toBeDisabled();
  await expect(page.getByTestId('smart-edit-resize-image')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // On the image (widget click parks the caret on the span): all four live.
  await editor.locator('.mm-image-widget img').click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await expect(page.getByTestId('smart-edit-delete-image')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-resize-image')).toBeEnabled();

  // Resize Image is the pointer-free entry to the chips; Esc dismisses.
  await page.getByTestId('smart-edit-resize-image').click();
  await expect(page.getByTestId('image-chip-layer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('image-chip-layer')).toHaveCount(0);

  // Delete Image: the reference AND its blank line leave in one step…
  await editor.locator('.mm-image-widget img').click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await page.getByTestId('smart-edit-delete-image').click();
  await expect(editor.locator('.mm-image-widget')).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  expect(await text()).toContain('![c](img118.png)'); // the grid cell held on
  // …and ONE undo restores it.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor.locator('.mm-image-widget')).toHaveCount(1);

  // Insert Image… dispatches the SPEC20 picker flow (shim-observable).
  await fsWrite(page, '/docs/downloads/pic2.png', `data:image/png;base64,${WIDE_PNG}`);
  await editor.locator('.cm-line').filter({ hasText: 'plain outro' }).click();
  await page.keyboard.press('End');
  page.once('dialog', (d) => void d.accept('/docs/downloads/pic2.png'));
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await page.getByTestId('smart-edit-insert-image').click();
  // The caret rests at the end of the inserted span — caret-reveal shows the
  // fresh syntax raw; stepping away turns it into the picture.
  await expect(content).toContainText('![pic2](images/pic2.png)');
  await editor.locator('.cm-line').filter({ hasText: /^top$/ }).click();
  await expect(editor.locator('.mm-image-widget')).toHaveCount(2);
  expect(await fsRead(page, '/docs/images/pic2.png')).toContain('data:image/png');
});

// ---------------------------------------------------------------------------
// SPEC44: active line & word placement cues (E124–E126)

/** Center of the nth visible occurrence of `word` inside `paneSel`; click it. */
const clickWord = async (page: import('@playwright/test').Page, paneSel: string, word: string, nth = 0) => {
  const pt = await page.evaluate(
    ([sel, w, n]) => {
      const pane = document.querySelector(sel as string)!;
      const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue ?? '';
        for (let at = text.indexOf(w as string); at !== -1; at = text.indexOf(w as string, at + 1)) {
          if (seen++ === n) {
            const r = document.createRange();
            r.setStart(node, at);
            r.setEnd(node, at + (w as string).length);
            const b = r.getBoundingClientRect();
            return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
          }
        }
      }
      throw new Error(`word not found: ${w}`);
    },
    [paneSel, word, nth] as const
  );
  await page.mouse.click(pt.x, pt.y);
};

test('E124: split mode — caret word darkens in both panes, position-exact on repeats, selection clears it, typing re-anchors', async ({
  page,
}) => {
  await fsWrite(page, '/docs/place.md', '# Title\n\nalpha beta gamma\n\ncat and cat again\n\n- one two\n- three four\n- five six\n');
  await page.goto('/#open=/docs/place.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  // Caret inside "alpha": the editor decoration and BOTH preview cues appear.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'alpha beta gamma' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  const edWord = page.locator('.cm-content .mm-active-word');
  const pvWord = page.locator('[data-testid="split-preview"] .doc mark.mm-active-word');
  const pvBlock = page.locator('[data-testid="split-preview"] .doc .mm-active-block');
  await expect(edWord).toHaveText('alpha');
  await expect(pvWord).toHaveText('alpha');
  await expect(pvBlock).toHaveCount(1);
  await expect(pvBlock).toContainText('alpha beta gamma');
  // Inert to the comment machinery.
  expect(await pvWord.getAttribute('data-cid')).toBeNull();

  // Arrow into "beta": both sides re-target.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await expect(edWord).toHaveText('beta');
  await expect(pvWord).toHaveText('beta');

  // Repeats mark the CARET's occurrence: caret in the second "cat".
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'cat and cat again' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await expect(edWord).toHaveText('cat');
  await expect(pvWord).toHaveText('cat');
  await expect(pvWord).toHaveCount(1);
  const info = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="split-preview"] .doc mark.mm-active-word')!;
    const blk = m.closest('[data-mm-line]')!;
    const r = document.createRange();
    r.setStart(blk, 0);
    r.setEndBefore(m);
    return { word: m.textContent, before: r.toString() };
  });
  expect(info.word).toBe('cat');
  expect(info.before).toBe('cat and '); // the SECOND cat carries the mark

  // A real selection outranks the word cue; the block tint stays.
  await page.keyboard.press('Shift+End');
  await expect(edWord).toHaveCount(0);
  await expect(pvWord).toHaveCount(0);
  await expect(pvBlock).toHaveCount(1);

  // Typing keeps the cues anchored through the re-render.
  await page.keyboard.press('End');
  await page.keyboard.type(' zeta');
  await expect(edWord).toHaveText('zeta');
  await expect(pvWord).toHaveText('zeta');

  // A stamped block can be a whole LIST — the tint stays on the caret's item.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'three four' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(pvWord).toHaveText('three');
  await expect(pvBlock).toHaveCount(1);
  await expect(pvBlock).toContainText('three four');
  await expect(pvBlock).not.toContainText('one two');
});

test('E125: preview clicks place the caret — split moves the editor, preview-only carries into Mod+E; links stay links', async ({
  page,
}) => {
  await fsWrite(page, '/docs/click.md', '# Click\n\nalpha beta gamma\n\nplus +++ plus2\n\n[ext](https://example.com/x)\n');
  await page.goto('/#open=/docs/click.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Click');

  // Preview-only: click a word → block + word cues right there.
  await clickWord(page, '[data-testid="doc"]', 'beta');
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveText('beta');
  await expect(page.locator('[data-testid="doc"] .mm-active-block')).toContainText('alpha beta gamma');
  // A link click keeps its existing behavior — placement skipped, cue stays.
  await page.locator('[data-testid="doc"] a[href]').click();
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveText('beta');

  // Mod+E lands the editor caret on that word (the E85 contract, collapsed).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.locator('.cm-content .mm-active-word')).toHaveText('beta');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe('# Click\n\nalpha '.length);

  // Split mode: clicking a preview word moves the editor caret to it.
  await clickWord(page, '[data-testid="split-preview"] .doc', 'gamma');
  await expect(page.locator('.cm-content .mm-active-word')).toHaveText('gamma');
  await expect(page.locator('[data-testid="split-preview"] .doc mark.mm-active-word')).toHaveText('gamma');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe('# Click\n\nalpha beta '.length);

  // A no-word click (punctuation run) still moves the caret — to the block.
  await clickWord(page, '[data-testid="split-preview"] .doc', '+++');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe('# Click\n\nalpha beta gamma\n\n'.length);
  await expect(page.locator('[data-testid="split-preview"] .doc .mm-active-block')).toContainText('plus +++ plus2');
});

test('E126: hygiene — comments anchor through the cues, find coexists/suppresses, themes override, doc switch resets', async ({
  page,
}) => {
  await fsWrite(page, '/docs/hyg.md', '# Hyg\n\nalpha beta gamma delta\n');
  await fsWrite(page, '/docs/other.md', '# Other\n\nplain here\n');
  await page.goto('/#open=/docs/hyg.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Hyg');

  // Cues active…
  await clickWord(page, '[data-testid="doc"]', 'beta');
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveText('beta');
  // …and the comment coordinate space is undisturbed: a comment over a span
  // CROSSING the marked word (the mark fragments text nodes) anchors exactly.
  await selectSpanInPane(page, '[data-testid="doc"]', 'beta', 'delta');
  await page.getByTestId('add-comment-btn').click();
  await page.keyboard.type('anchored fine');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(async () => (await page.locator('[data-testid="doc"] mark.hl').allTextContents()).join(''))
    .toContain('beta gamma delta');

  // Find marks and the active word coexist in the preview.
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByTestId('find-input').fill('beta');
  await expect(page.locator('[data-testid="doc"] mark.mm-find')).toHaveCount(1);
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // In edit mode the open find bar suppresses the editor's word cue.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'alpha beta' }).click();
  await expect(page.locator('.cm-content .mm-active-word')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByTestId('find-input')).toBeVisible();
  await expect(page.locator('.cm-content .mm-active-word')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Click back into the editor: focus returns, the find-match selection
  // collapses, and the cue re-derives now that the bar is gone.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'alpha beta' }).click();
  await expect(page.locator('.cm-content .mm-active-word')).toHaveCount(1);

  // Theme variables drive both cue colors.
  const color = await page.evaluate(() => {
    document.querySelector<HTMLElement>('.theme-root')!.style.setProperty('--mm-active-word', 'rgb(1, 2, 3)');
    const m = document.querySelector('.cm-content .mm-active-word')!;
    return getComputedStyle(m).backgroundColor;
  });
  expect(color).toBe('rgb(1, 2, 3)');

  // A doc switch drops the cues — nothing stale on the incoming document.
  await page.keyboard.press('Control+e');
  await page.goto('/#open=/docs/other.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Other');
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveCount(0);
  await expect(page.locator('[data-testid="doc"] .mm-active-block')).toHaveCount(0);
});
