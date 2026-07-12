import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import pkg from '../../package.json' with { type: 'json' };
import {
  addComment,
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
  await expect(hint).toContainText('Drag a markdown file here');
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
  await page.keyboard.press('Control+Shift+E');
  await page.getByTestId('settings-close').click();

  await page.keyboard.press('Control+e'); // old combo — must do nothing
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('doc')).toBeVisible();

  await page.keyboard.press('Control+Shift+E'); // new combo
  await expect(page.getByTestId('editor')).toBeVisible();

  // Persisted to settings.json in the config dir.
  const settings = await fsRead(page, '/config/settings.json');
  expect(settings).toContain('Mod+Shift+E');
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

  await expect.poll(async () => (await fsRead(page, WELCOME))?.includes('markimark-comments')).toBe(true);
  await expect.poll(async () => fsRead(page, WELCOME_SIDECAR), { timeout: 5000 }).toBe(null);
  const onDisk = (await fsRead(page, WELCOME))!;
  expect(onDisk).toContain('Embedded note');
  expect(onDisk.trimEnd().endsWith('-->')).toBe(true);

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('card-body')).toHaveText('Embedded note');
  await expect(page.locator('mark.hl').first()).toBeVisible();

  // The trailer is invisible everywhere: preview text and edit buffer.
  await expect(page.getByTestId('doc')).not.toContainText('markimark-comments');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('markimark-comments');
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
  await expect.poll(async () => (await fsRead(page, WELCOME))?.includes('markimark-comments')).toBe(true);
  const afterAutosave = (await fsRead(page, WELCOME))!;
  expect(afterAutosave).not.toContain('DIRTYMARK');
  expect(afterAutosave).toContain('while dirty');
  await expect(page.getByTestId('dirty-dot')).toBeVisible(); // still dirty

  // Explicit save writes buffer + trailer together.
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const afterSave = (await fsRead(page, WELCOME))!;
  expect(afterSave).toContain('DIRTYMARK');
  expect(afterSave).toContain('markimark-comments');
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
  // Theme default (Crisp) is now the narrow-margin 60rem column (SPEC4 §7).
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).maxWidth))
    .toBe('960px');

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
  await expect(page.getByTestId('empty-hint')).toBeVisible();

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

  // Restart the app (localStorage persists); reopen the doc via the hash.
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.goto('/#open=/docs/long.md');
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
  await expect.poll(() => editorTopGutterLine(page)).toBeGreaterThan(marker25Line - 6);
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

test('E74: clicking a preview image shows handles; dragging persists an <img width> and marks the doc dirty', async ({
  page,
}) => {
  await fsWrite(page, '/docs/pic.png', `data:image/png;base64,${WIDE_PNG}`);
  await fsWrite(page, '/docs/pic.md', '# Pic\n\n![p](pic.png)\n');
  await page.goto('/#open=/docs/pic.md');
  const img = page.getByTestId('doc').locator('img[alt="p"]');
  await expect(img).toBeVisible();

  // Select: outline, four handles, size badge.
  await img.click();
  await expect(page.getByTestId('img-resize-overlay')).toBeVisible();
  await expect(page.getByTestId('img-size-badge')).toContainText('200 × 100');
  for (const c of ['nw', 'ne', 'sw', 'se']) {
    await expect(page.getByTestId(`img-handle-${c}`)).toBeVisible();
  }

  // Drag the south-east handle 60px left → ~140px wide, aspect-locked.
  const handle = await page.getByTestId('img-handle-se').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x - 60, handle!.y + handle!.height / 2, { steps: 5 });
  await page.mouse.up();

  // The rewrite landed in the buffer (dirty), and the re-render keeps the size.
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  const width = Number(await page.getByTestId('doc').locator('img[alt="p"]').getAttribute('width'));
  expect(width).toBeGreaterThanOrEqual(120);
  expect(width).toBeLessThanOrEqual(160);
  await expect(page.getByTestId('img-size-badge')).toContainText(`${width} ×`);

  // The source now carries the HTML tag with the width.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText(
    `<img src="pic.png" alt="p" width="${width}">`
  );
});

test('E75: double-click removes the width (back to natural size); Escape deselects', async ({ page }) => {
  await fsWrite(page, '/docs/pic.png', `data:image/png;base64,${WIDE_PNG}`);
  await fsWrite(page, '/docs/pic.md', '# Pic\n\n<img src="pic.png" alt="p" width="120">\n');
  await page.goto('/#open=/docs/pic.md');
  const img = page.getByTestId('doc').locator('img[alt="p"]');
  await expect(img).toBeVisible();
  expect(await img.getAttribute('width')).toBe('120');

  // Double-click: width attribute removed, natural size restored.
  await img.dblclick();
  await expect
    .poll(() => page.getByTestId('doc').locator('img[alt="p"]').getAttribute('width'))
    .toBeNull();
  await expect(page.getByTestId('img-size-badge')).toContainText('200 × 100');

  // Escape deselects; the overlay disappears.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('img-resize-overlay')).toHaveCount(0);

  // Width removal persisted to the source (tag stays HTML, no width attr).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('<img src="pic.png" alt="p">');
});

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

test('E77: image resize works in the split-edit live preview, and the rewrite lands in the editor buffer', async ({
  page,
}) => {
  await fsWrite(page, '/docs/pic.png', `data:image/png;base64,${WIDE_PNG}`);
  await fsWrite(page, '/docs/pic.md', '# Pic\n\n![p](pic.png)\nA line right after the image.\n');
  await page.goto('/#open=/docs/pic.md');
  await expect(page.getByTestId('doc').locator('img[alt="p"]')).toBeVisible();

  // Split edit is the default mode; the live preview renders the image.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  const img = page.getByTestId('split-preview').locator('img[alt="p"]');
  await expect(img).toBeVisible();

  // Click → handles; drag the SE corner left → width persists in the buffer.
  await img.click();
  await expect(page.getByTestId('img-resize-overlay')).toBeVisible();
  const handle = await page.getByTestId('img-handle-se').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x - 60, handle!.y + handle!.height / 2, { steps: 5 });
  await page.mouse.up();

  const content = page.getByTestId('editor').locator('.cm-content');
  await expect(content).toContainText('<img src="pic.png" alt="p" width="');
  // The blank-line rule kept the following text out of the HTML block: the
  // split preview still shows both the image and the sentence after it.
  await expect(img).toBeVisible();
  await expect(page.getByTestId('split-preview')).toContainText('A line right after the image.');
});

test('E78: splash advertises ⌘N; New… is save-dialog-first — the empty file opens in edit mode; cancel is a no-op', async ({
  page,
}) => {
  // Pristine launch (like E1): the splash shows both hints with live combos.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const hint = page.getByTestId('empty-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('⌘O'); // shim reports the host OS (mac)
  await expect(hint).toContainText('to open one');
  await expect(hint).toContainText('⌘N');
  await expect(hint).toContainText('to create one');

  // Cancelled save dialog ⇒ nothing happens, nothing is written.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = null;
  });
  await page.keyboard.press('Control+n');
  await expect(hint).toBeVisible();
  expect(await page.evaluate(() => window.__mmfs!.list())).not.toContain('/docs/fresh.md');

  // Chosen path ⇒ an EMPTY file exists on disk and opens in edit mode, clean.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/fresh.md';
  });
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('docname')).toContainText('fresh.md');
  await expect(page.getByTestId('docname')).toHaveAttribute('title', '/docs/fresh.md');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, '/docs/fresh.md')).toBe('');
});

test('E79: New… with a dirty buffer runs the three-way guard; Cancel keeps everything (and drops the edit-mode intent); Don’t save opens the new file in edit mode', async ({
  page,
}) => {
  // Dirty the welcome doc.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTYMARK ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // New… → the file is created first, then the guard prompts.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/one.md';
  });
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  expect(await fsRead(page, '/docs/one.md')).toBe('');

  // Cancel: still on the dirty welcome doc.
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // The abandoned New… must not leak edit mode into the next open: reopening
  // welcome via Help (same path ⇒ no prompt) lands in preview as always.
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('editor')).toHaveCount(0);

  // Dirty again, New… again — Don’t save opens the new file in edit mode.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTYMARK ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/two.md';
  });
  await page.keyboard.press('Control+n');
  await page.getByTestId('open-discard').click();

  await expect(page.getByTestId('docname')).toContainText('two.md');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, '/docs/two.md')).toBe('');
  // Don’t save really didn’t save: the discarded edit never reached disk.
  expect(await fsRead(page, WELCOME)).not.toContain('DIRTYMARK');
});
