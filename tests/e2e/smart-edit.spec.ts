import { expect, test } from './fixtures';
import {
  freshApp,
  fsWrite,
  openSettings,
} from './helpers';

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
