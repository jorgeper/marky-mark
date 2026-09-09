import { expect, test } from './fixtures';
import { editorCaret, enableActiveLine, freshApp, fsWrite, openSettings, saveSettings } from './helpers';

// Smart Edit: the gutter button, formatting commands, the context menu and
// its hotkeys.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

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
  // The button re-anchors on CodeMirror's next measure after the click.
  await expect
    .poll(async () => Math.abs((await btn.boundingBox())!.y - lineBox.y))
    .toBeLessThan(4);
  let btnBox = (await btn.boundingBox())!;

  // It follows the caret.
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await btn.boundingBox())!.y).toBeGreaterThan(btnBox.y);

  // In the content area, not the gutter strip: never a descendant of
  // .cm-gutters, which now holds only the line numbers (the extra 26px
  // smart column is gone).
  await expect(editor.locator('.cm-gutters [data-testid="smart-edit-gutter"]')).toHaveCount(0);
  await expect(editor.locator('.cm-gutter.mm-smart-gutter')).toHaveCount(0);
  const numBox = (await editor.locator('.cm-gutter.cm-lineNumbers').boundingBox())!;
  const guttersBox = (await editor.locator('.cm-gutters').boundingBox())!;
  expect(guttersBox.width).toBeLessThanOrEqual(numBox.width + 2);
  // Right of the line numbers, inside the content area, immediately left of
  // the cursor line's text ("gamma delta" after the ArrowDown above).
  const contentBox = (await editor.locator('.cm-content').boundingBox())!;
  const gammaBox = (await editor.locator('.cm-line').filter({ hasText: /^gamma delta$/ }).boundingBox())!;
  btnBox = (await btn.boundingBox())!;
  expect(btnBox.x).toBeGreaterThanOrEqual(numBox.x + numBox.width - 1);
  expect(btnBox.x).toBeGreaterThanOrEqual(contentBox.x);
  expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(gammaBox.x + 1);
  expect(gammaBox.x - (btnBox.x + btnBox.width)).toBeLessThan(12);
  // The icon is the theme accent at rest (crisp: #0969da), not the muted
  // line-number gray.
  await expect(btn).toHaveCSS('color', 'rgb(9, 105, 218)');
  // The text never reflows because of the button: "beta" starts at the same
  // x with the button elsewhere as it did with the button on its line.
  const betaX = (await editor.locator('.cm-line').filter({ hasText: /^beta$/ }).boundingBox())!.x;
  expect(Math.abs(betaX - lineBox.x)).toBeLessThan(1);

  // Line numbers off (SPEC3 §2): the smart gutter stands alone. Issue #10:
  // driven by the View command now, not a Settings checkbox.
  await page.evaluate(() => window.__mmDispatch!('toggleLineNumbers'));
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
  // …and so does an outside pointer-down. Issue #157 amendment: the menu
  // grew a row (Code Block) and now viewport-clamps up over x≈200, so the
  // outside point moved right — same dismissal contract.
  await btn.click();
  await expect(menu).toBeVisible();
  const content = editor.locator('.cm-content');
  const menuBox = (await menu.boundingBox())!;
  const paneBox = (await content.boundingBox())!;
  const outsideX = menuBox.x + menuBox.width + 20; // 20px clear of the menu's right edge
  expect(outsideX).toBeLessThan(paneBox.x + paneBox.width); // the point IS inside the pane
  await content.click({ position: { x: outsideX - paneBox.x, y: 10 } });
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
  await saveSettings(page);

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
  await saveSettings(page);
  await page.getByTestId('smart-edit-gutter').click();
  await expect(page.getByTestId('smart-edit-bold').locator('.menu-hotkey')).toHaveText(/(⌘B|Ctrl\+B)/);
});

// --- SPEC43 §11 (issue #270): the Link submenu, the rendered-links view and
// open-link — one command, three entry points.

const LINK_DOC = [
  'intro line',
  'go [site](https://example.com/page) here',
  'jump [down](#target) now',
  ...Array.from({ length: 40 }, (_, i) => `filler ${i}`),
  '## Target',
  'tail text',
].join('\n\n');

/** External-open hand-offs the desktop shim recorded (browser.ts seam). */
const externalOpens = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __mmExternalOpens?: string[] }).__mmExternalOpens ?? []);

async function openLinkDoc(page: import('@playwright/test').Page) {
  await fsWrite(page, '/docs/links270.md', LINK_DOC);
  await page.goto('/#open=/docs/links270.md');
  await expect(page.getByTestId('doc')).toContainText('intro line');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  return editor;
}

test('E483: SPEC43 §11 — the Link ▸ submenu after Diagram: toggle, the moved Create Link (⌘⇧K), Open Link with its hotkey; no top-level link row', async ({
  page,
}) => {
  const editor = await openLinkDoc(page);
  await editor.locator('.cm-line').filter({ hasText: 'intro line' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await expect(page.getByTestId('smart-edit-menu')).toBeVisible();

  // The submenu row exists; the top-level inline group has NO link row (the
  // `smart-edit-link` id only appears once the flyout opens, as Create Link).
  await expect(page.getByTestId('smart-edit-link-view')).toBeVisible();
  await expect(page.getByTestId('smart-edit-link-view')).toHaveText(/^Link/);
  await expect(page.getByTestId('smart-edit-bold')).toBeVisible();
  await expect(page.getByTestId('smart-edit-link')).toHaveCount(0);

  // The flyout: Show Raw Links (view ships on), Create Link with the kept
  // ⌘⇧K binding, Open Link documenting its own binding — disabled here
  // (caret on plain text), never absent.
  await page.getByTestId('smart-edit-link-view').click();
  await expect(page.getByTestId('smart-edit-toggle-links')).toHaveText(/Show Raw Links/);
  await expect(page.getByTestId('smart-edit-toggle-links')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-link')).toContainText('Create Link');
  await expect(page.getByTestId('smart-edit-link').locator('.menu-hotkey')).toHaveText(/(⌘⇧K|Ctrl\+Shift\+K)/);
  await expect(page.getByTestId('smart-edit-link')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-open-link')).toContainText('Open Link');
  await expect(page.getByTestId('smart-edit-open-link').locator('.menu-hotkey')).toHaveText(/(⌘⌥O|Ctrl\+Alt\+O)/);
  await expect(page.getByTestId('smart-edit-open-link')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('smart-edit-menu')).toHaveCount(0);

  // Create Link still wraps a selection exactly as before, from its new home.
  await editor.locator('.cm-line').filter({ hasText: 'intro line' }).dblclick();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toMatch(/^(intro|line)$/);
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-link-view').click();
  await page.getByTestId('smart-edit-link').click();
  await expect(editor.locator('.cm-content')).toContainText('](url)');
  await page.keyboard.press('Control+z');
});

test('E477: SPEC43 §11 — Show Rendered/Raw Links flips the view and the label, the Settings checkbox mirrors it, and the choice survives a reload', async ({
  page,
}) => {
  const editor = await openLinkDoc(page);
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  await editor.locator('.cm-line').filter({ hasText: 'intro line' }).click();

  // Ships rendered: the syntax is not visible, the text is.
  expect(await text()).not.toContain('](https://example.com/page)');
  await expect(content).toContainText('go site here');

  // Show Raw Links: every link drops to raw syntax at once; no dirty dot.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-link-view').click();
  await page.getByTestId('smart-edit-toggle-links').click();
  await expect(content).toContainText('[site](https://example.com/page)');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The label flipped; the Settings checkbox reflects the flip.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-link-view').click();
  await expect(page.getByTestId('smart-edit-toggle-links')).toHaveText(/Show Rendered Links/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('settings-link-view')).not.toBeChecked();
  await saveSettings(page);

  // The choice persists across a reload (user-scoped like its siblings).
  await page.reload();
  await expect(content).toBeVisible();
  await expect(content).toContainText('[site](https://example.com/page)');

  // The Settings checkbox drives it back on.
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('settings-link-view').check();
  await saveSettings(page);
  expect(await text()).not.toContain('](https://example.com/page)');
});

test('E478: SPEC43 §11 — a link renders collapsed as styled text with the URL tooltip, reveals raw when the caret enters it, and re-collapses on leave', async ({
  page,
}) => {
  const editor = await openLinkDoc(page);
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  await editor.locator('.cm-line').filter({ hasText: 'intro line' }).click();

  // Collapsed: the styled text span carries the URL as its title.
  const span = editor.locator('.mm-link-view').first();
  await expect(span).toHaveText('site');
  await expect(span).toHaveAttribute('title', 'https://example.com/page');
  expect(await text()).not.toContain('[site]');

  // Caret into the link (arrow through 'go ' — the construct reveals whole
  // and stays editable in place).
  await editor.locator('.cm-line').filter({ hasText: 'go ' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(content).toContainText('[site](https://example.com/page)');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // Caret out — it collapses again; the document text never changed.
  await editor.locator('.cm-line').filter({ hasText: 'intro line' }).click();
  expect(await text()).not.toContain('[site]');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E479: SPEC43 §11 — Ctrl/⌘-click on link text hands the URL to the host seam in BOTH views; a plain click just places the caret', async ({
  page,
}) => {
  const editor = await openLinkDoc(page);
  const content = editor.locator('.cm-content');
  await editor.locator('.cm-line').filter({ hasText: 'intro line' }).click();

  // Rendered view: modifier-click the collapsed text span.
  await editor.locator('.mm-link-view').first().click({ modifiers: ['Control'] });
  await expect.poll(() => externalOpens(page)).toContain('https://example.com/page');
  const afterFirst = (await externalOpens(page)).length;

  // A plain click never opens — it just places the caret (the link reveals).
  await editor.locator('.mm-link-view').first().click();
  await expect(content).toContainText('[site](https://example.com/page)');
  expect((await externalOpens(page)).length).toBe(afterFirst);

  // Raw view: same click, same seam — resolution is by document offset,
  // not a rendered-only DOM attribute.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-link-view').click();
  await page.getByTestId('smart-edit-toggle-links').click();
  await expect(content).toContainText('[site](https://example.com/page)');
  await editor.locator('.mm-md-link').first().click({ modifiers: ['Control'] });
  await expect.poll(async () => (await externalOpens(page)).length).toBe(afterFirst + 1);
  expect((await externalOpens(page)).at(-1)).toBe('https://example.com/page');
});

test('E480: SPEC43 §11 — the openLink hotkey opens with the caret inside a link and is a no-op outside one', async ({
  page,
}) => {
  const editor = await openLinkDoc(page);
  const content = editor.locator('.cm-content');

  // Caret inside the link text (reveal, then step inside).
  await editor.locator('.cm-line').filter({ hasText: 'go ' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(content).toContainText('[site](https://example.com/page)');
  await page.keyboard.press('Control+Alt+o');
  await expect.poll(() => externalOpens(page)).toContain('https://example.com/page');
  const opens = (await externalOpens(page)).length;

  // Outside any link: silent no-op — nothing opens, nothing changes.
  await editor.locator('.cm-line').filter({ hasText: 'intro line' }).click();
  await page.keyboard.press('Control+Alt+o');
  await page.waitForTimeout(150);
  expect((await externalOpens(page)).length).toBe(opens);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E481: SPEC43 §11 — Link ▸ Open Link opens through the seam with the caret in a link, and a #anchor link follows the preview rule instead of leaving the app', async ({
  page,
}) => {
  const editor = await openLinkDoc(page);
  const content = editor.locator('.cm-content');
  const appUrl = page.url();

  // Caret into the https link's text — the menu row is enabled and invokes
  // the ONE command; the menu closes and the URL reaches the host seam.
  await editor.locator('.cm-line').filter({ hasText: 'go ' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(content).toContainText('[site](https://example.com/page)');
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-link-view').click();
  await expect(page.getByTestId('smart-edit-open-link')).toBeEnabled();
  await page.getByTestId('smart-edit-open-link').click();
  await expect(page.getByTestId('smart-edit-menu')).toHaveCount(0);
  await expect.poll(() => externalOpens(page)).toContain('https://example.com/page');
  const opens = (await externalOpens(page)).length;

  // Caret into the anchor link: the shared managed-link rule (SPEC11 §4)
  // handles #target exactly as a preview click would — it is NEVER handed to
  // the browser and the app never navigates. Issue #268: "exactly as a
  // preview click would" now means it LANDS — the fragment resolves through
  // the same PRD 020 Req 18 heading anchors and the editor scrolls to that
  // heading's source line (the E337 path), where it used to resolve to a
  // no-op `getElementById` lookup.
  const editorScrollTop = () => editor.locator('.cm-scroller').evaluate((el) => el.scrollTop);
  await editor.locator('.cm-line').filter({ hasText: 'jump' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await expect(content).toContainText('[down](#target)');
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-link-view').click();
  await expect(page.getByTestId('smart-edit-open-link')).toBeEnabled();
  const beforeJump = await editorScrollTop();
  await page.getByTestId('smart-edit-open-link').click();
  await expect.poll(editorScrollTop).toBeGreaterThan(beforeJump + 200);
  await expect(editor.locator('.cm-line').filter({ hasText: '## Target' })).toBeInViewport();
  // PRD 012 Req 6 (issue #300): the landing is the TOC jump's — the caret
  // rests on the heading's TEXT, after the `## ` markers, as an empty
  // selection, so typing continues in the title.
  await expect.poll(() => editorCaret(page)).toEqual({ column: 3, collapsed: true, text: '## Target' });
  expect((await externalOpens(page)).length).toBe(opens); // not handed off
  expect(page.url()).toBe(appUrl); // the app never navigated
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

// --- Issue #263: the button never paints inside a fenced-code card ----------

test('E490: issue #263 — the smart-edit button sits entirely left of a fence card on every card line (delimiters, body, one-line, list- and quote-nested), keeps prose geometry and stays clickable', async ({
  page,
}) => {
  // SPEC43 §3 (issue #263): the cursor-line button is chrome in .cm-content's
  // left padding, so a fence card's 16px text inset must not drag it onto the
  // card. Line indices: 2-5 plain block, 8-10 nested in a list item, 13-15
  // nested in a blockquote, 17 a one-line (unclosed, doc-final) block.
  const DOC = [
    'intro',
    '',
    '```js',
    'const a = 1;',
    'const b = 2;',
    '```',
    '',
    '- item',
    '  ```sh',
    '  echo hi',
    '  ```',
    '',
    '> quoted',
    '> ```py',
    '> x = 1',
    '> ```',
    '',
    '```txt', // no trailing newline: the block is this single line
  ].join('\n');
  await fsWrite(page, '/docs/card263.md', DOC);
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await page.goto('/#open=/docs/card263.md');
  await expect(page.getByTestId('doc')).toContainText('intro');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  const btn = page.getByTestId('smart-edit-gutter');
  const line = (i: number) => editor.locator('.cm-line').nth(i);

  // Every fenced block became a card: 4 + 3 + 3 + 1 rows, the last one
  // drawing all four edges on its own.
  await expect(editor.locator('.cm-line.mm-fence-card')).toHaveCount(11);
  await expect(
    editor.locator('.cm-line.mm-fence-card-first.mm-fence-card-last')
  ).toHaveCount(1);

  // Park the caret on line `i` and return the button's box once it has
  // re-anchored there (CodeMirror re-measures after the click).
  const parkOn = async (i: number) => {
    await line(i).click();
    const lineBox = (await line(i).boundingBox())!;
    await expect
      .poll(async () => Math.abs((await btn.boundingBox())!.y - lineBox.y))
      .toBeLessThan(4);
    return { lineBox, btnBox: (await btn.boundingBox())! };
  };

  // The prose baseline (E105's geometry): the button hangs in .cm-content's
  // left padding, right of the pane edge, left of the line's text.
  const contentBox = (await editor.locator('.cm-content').boundingBox())!;
  const prose = await parkOn(0);
  expect(prose.btnBox.x).toBeGreaterThanOrEqual(contentBox.x - 1);
  expect(prose.btnBox.x + prose.btnBox.width).toBeLessThanOrEqual(prose.lineBox.x + 1);

  // The contract on a card line: the card's painted left edge is the
  // .cm-line box's left edge (the card ::before is inset: 0), and the whole
  // button is left of it — never the reported half-in overlap. It also lands
  // in exactly the prose column, so nothing is pushed out of the pane.
  const offTheCard = async (i: number) => {
    await expect(line(i)).toHaveClass(/mm-fence-card/);
    const { lineBox, btnBox } = await parkOn(i);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(lineBox.x + 1);
    expect(btnBox.x).toBeGreaterThanOrEqual(contentBox.x - 1);
    expect(Math.abs(btnBox.x - prose.btnBox.x)).toBeLessThan(1);
  };

  // Parking the caret on a card line reveals that block (its delimiters show
  // raw) and the row keeps mm-fence-card and its 16px inset — so every case
  // below is also the "revealed card" case.
  await offTheCard(2); // opening delimiter row
  await expect(editor.locator('.cm-content')).toContainText('```js');
  await offTheCard(3); // interior body row
  await offTheCard(5); // closing delimiter row
  await offTheCard(9); // body row, fence nested in a list item
  await offTheCard(8); // its opening delimiter row
  await offTheCard(14); // body row, fence nested in a blockquote
  await offTheCard(15); // its closing delimiter row
  await offTheCard(17); // the one-line block

  // The card's own text inset is untouched: the chrome moved, the document
  // did not. Issue #163's 16px inset now resolves through --mm-fence-inset,
  // so assert the computed value the way editor.spec.ts does — an undefined
  // variable would compute to 0px here.
  await expect(line(3)).toHaveCSS('padding-left', '16px');

  // Line numbers off (SPEC3 §2): the button is still fully inside the editor
  // pane on a card line — the offset does not push it out to be clipped.
  await page.evaluate(() => window.__mmDispatch!('toggleLineNumbers'));
  await expect(editor.locator('.cm-gutter.cm-lineNumbers')).toHaveCount(0);
  const narrow = await parkOn(4);
  const paneBox = (await editor.boundingBox())!;
  const noNumbersContent = (await editor.locator('.cm-content').boundingBox())!;
  expect(narrow.btnBox.x).toBeGreaterThanOrEqual(paneBox.x - 1);
  expect(narrow.btnBox.x).toBeGreaterThanOrEqual(noNumbersContent.x - 1);
  expect(narrow.btnBox.x + narrow.btnBox.width).toBeLessThanOrEqual(narrow.lineBox.x + 1);
  await page.evaluate(() => window.__mmDispatch!('toggleLineNumbers'));

  // Still the live affordance on a code line: the click opens the smart menu
  // and moves neither the caret nor the document.
  const active = (await editor.locator('.cm-line.cm-activeLine').boundingBox())!;
  await btn.click();
  await expect(page.getByTestId('smart-edit-menu')).toBeVisible();
  await expect(editor.locator('.cm-line.cm-activeLine.mm-fence-card')).toHaveCount(1);
  expect(
    Math.abs((await editor.locator('.cm-line.cm-activeLine').boundingBox())!.y - active.y)
  ).toBeLessThan(2);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

// --- Issue #318: GitHub-alert callouts — tinted in the preview, rendered in
// the edit pane behind the Callout ▸ toggle and the Settings checkbox.

const CALLOUT_DOC = [
  'intro line',
  '> [!NOTE]\n> note body',
  '> [!TIP]\n> tip body',
  '> [!IMPORTANT]\n> important body',
  '> [!WARNING]\n> warning body',
  '> [!CAUTION]\n> caution body',
  '> [!HINT]\n> not a callout',
  '> plain quote',
].join('\n\n');

test('E540: Issue #318 — the five callout kinds render tinted with a title row and no marker text in the preview; Show Raw/Rendered Callouts flips the edit pane and its label, the Settings checkbox mirrors it', async ({
  page,
}) => {
  await fsWrite(page, '/docs/callouts318.md', CALLOUT_DOC);
  await page.goto('/#open=/docs/callouts318.md');
  const doc = page.getByTestId('doc');
  await expect(doc).toContainText('intro line');

  // Preview: one callout per kind, each with its label row and a distinct
  // tint; the literal marker is gone from the rendered text.
  const kinds = ['note', 'tip', 'important', 'warning', 'caution'] as const;
  const labels = ['Note', 'Tip', 'Important', 'Warning', 'Caution'];
  const tints = new Set<string>();
  for (const [i, kind] of kinds.entries()) {
    const block = doc.locator(`blockquote.mm-callout.mm-callout-${kind}`);
    await expect(block).toHaveCount(1);
    await expect(block.locator('.mm-callout-title')).toHaveText(labels[i]);
    await expect(block).toContainText(`${kind} body`);
    tints.add(await block.evaluate((el) => getComputedStyle(el).backgroundColor));
  }
  expect(tints.size).toBe(5);
  const docText = await doc.innerText();
  for (const kind of kinds) expect(docText).not.toContain(`[!${kind.toUpperCase()}]`);
  // Not callouts: the unknown kind and the plain quote stay bare blockquotes
  // with their text intact.
  expect(docText).toContain('[!HINT]');
  await expect(doc.locator('blockquote')).toHaveCount(7);
  await expect(doc.locator('blockquote.mm-callout')).toHaveCount(5);

  // Edit pane, shipped rendered: every kind's lines carry the tint class and
  // the marker reads as its label, not as `[!KIND]`.
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  await editor.locator('.cm-line').filter({ hasText: 'intro line' }).click();
  await expect(page.getByTestId('callout-label')).toHaveCount(5);
  await expect(page.getByTestId('callout-label').first()).toHaveText('Note');
  for (const kind of kinds) {
    await expect(editor.locator(`.cm-line.mm-callout-line.mm-callout-${kind}`)).toHaveCount(2);
  }
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  expect(await text()).not.toContain('[!NOTE]');
  expect(await text()).toContain('[!HINT]'); // never a callout, never hidden

  // The caret on the marker line reveals the raw marker for that block only.
  await editor.locator('.cm-line').filter({ hasText: 'Note' }).first().click();
  await expect(content).toContainText('[!NOTE]');
  await expect(page.getByTestId('callout-label')).toHaveCount(4);

  // Show Raw Callouts: the first row of Smart Edit ▸ Callout; every block
  // drops to raw markdown at once; no dirty dot.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-callout').click();
  await expect(page.getByTestId('smart-edit-toggle-callouts')).toHaveText(/Show Raw Callouts/);
  await page.getByTestId('smart-edit-toggle-callouts').click();
  await expect(page.getByTestId('callout-label')).toHaveCount(0);
  await expect(editor.locator('.cm-line.mm-callout-line')).toHaveCount(0);
  await expect(content).toContainText('[!CAUTION]');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The label flipped; the Settings checkbox reflects the flip.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-callout').click();
  await expect(page.getByTestId('smart-edit-toggle-callouts')).toHaveText(/Show Rendered Callouts/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('settings-callout-view')).not.toBeChecked();

  // The Settings checkbox drives it back on, live: every block tints again,
  // and four labels return — the caret is still parked on the Note marker
  // line from the reveal step above, so that block keeps showing raw.
  await page.getByTestId('settings-callout-view').check();
  await saveSettings(page);
  await expect(editor.locator('.cm-line.mm-callout-line')).toHaveCount(10);
  await expect(page.getByTestId('callout-label')).toHaveCount(4);
  await expect(content).toContainText('[!NOTE]');
});
