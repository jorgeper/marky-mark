// SPEC16 §2 (issue #264): the Changes Since Save overlay over live-preview
// block widgets — gridded smart tables, fenced code cards and inline images.
// The sets are computed by the app over the CANONICAL buffer and painted on
// RAW editor lines, so these assert WHICH line each mark lands on, that an
// unedited document paints none at all, and that the widgets keep their own
// rendering while the diff is on.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { caretInto, freshApp, openGridDoc, openViewMenu } from './helpers';

const PATH = '/docs/diffmix.md';

/** Front matter, prose, a list, a quote, a smart table, an image and a fence. */
const MIX = [
  '---',
  'title: Diff Fixture',
  '---',
  '',
  'intro prose',
  '',
  '- list item',
  '- second item',
  '',
  '> a quote line',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  '| one | 1 |',
  '| two | 2 |',
  '',
  '![pic](/docs/pic.png)',
  '',
  '```js',
  'const answer = 42;',
  '```',
  '',
  'tail line',
  '',
].join('\n');

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

/** Open MIX in edit mode with the table gridded, and turn the overlay on. */
async function openMixWithDiff(page: Page) {
  await openGridDoc(page, PATH, MIX, 'intro prose');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-line.mm-fence-card').first()).toBeVisible();
  const view = await openViewMenu(page);
  await view.getByTestId('menu-view-toggleDiff').click();
  await expect(page.getByTestId('app-menu-view')).toHaveCount(0); // choosing a row closes the menu (E13)
  return editor;
}

/** Move the caret off a widget so the block renders again (caret reveal). */
async function caretToTail(page: Page) {
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'tail line' }).first().click();
}

test('E501: an unedited mixed document paints no changed tints and no deletion markers', async ({
  page,
}) => {
  const editor = await openMixWithDiff(page);
  // SPEC16 §2: the toggle alone changes nothing about the document.
  // Every construct is rendered: the grid ran, the card is up, the image is a widget.
  await expect(editor.locator('.cm-line.mm-table-mode-line').first()).toBeVisible();
  await expect(editor.locator('.mm-image-widget')).toHaveCount(1);
  await expect(editor.locator('.mm-copy-code-editor')).toHaveCount(1);
  // The sets ride a 200ms debounce — wait past it, then assert nothing painted.
  await page.waitForTimeout(600);
  await expect(editor.locator('.cm-line.mm-diff-changed')).toHaveCount(0);
  await expect(editor.locator('.cm-line.mm-diff-deleted-after')).toHaveCount(0);
});

test('E502: an edit below a gridded table tints its own line, and a cell edit tints its own grid row', async ({
  page,
}) => {
  // SPEC16 §2: the sets are canonical coordinates; a grid is taller than its
  // source, so this is the drift the mapping removes.
  const editor = await openMixWithDiff(page);
  const gridLines = await editor.locator('.cm-line.mm-table-mode-line').count();
  await caretToTail(page);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  // Exactly the edited line, whatever the grid's extra rows did to the count.
  await expect(editor.locator('.cm-line.mm-diff-changed')).toHaveCount(1);
  await expect(editor.locator('.cm-line.mm-diff-changed')).toHaveText('tail line!');

  // A cell edit marks the row it changed and leaves the grid's own geometry.
  await caretInto(page, '| two', 5); // just past the cell's own text
  await page.keyboard.type('X');
  await expect(editor.locator('.cm-line.mm-diff-changed')).toHaveCount(2);
  const marked = editor.locator('.cm-line.mm-diff-changed.mm-table-mode-line');
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText('X');
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(gridLines);
});

test('E496: an edit inside a code card tints the code line in the card’s own layer, chrome intact', async ({
  page,
}) => {
  // SPEC16 §2: the tint has to read against the card's opaque background.
  const editor = await openMixWithDiff(page);
  await editor.locator('.cm-line').filter({ hasText: 'const answer' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' // note');
  await caretToTail(page); // caret out of the block: the card renders again
  const marked = editor.locator('.cm-line.mm-diff-changed');
  await expect(marked).toHaveCount(1);
  await expect(marked).toHaveClass(/mm-fence-card/);
  await expect(marked).toContainText('// note');
  // The tint composites into the card's own background layer, so it is not
  // hidden behind the opaque --mm-code-bg the card paints there.
  const before = await marked.evaluate((el) => getComputedStyle(el, '::before').backgroundImage);
  expect(before).toContain('gradient');
  // Card chrome: the ring's pseudo-element, the rounded edges and the copy
  // control are all still there while the diff is on.
  await expect(editor.locator('.cm-line.mm-fence-card-first')).toHaveCount(1);
  await expect(editor.locator('.cm-line.mm-fence-card-last')).toHaveCount(1);
  await expect(editor.locator('.mm-copy-code-editor')).toHaveCount(1);
});

test('E497: a fence delimiter edit marks the card’s own delimiter row, and that row is visible', async ({
  page,
}) => {
  // SPEC16 §2: the delimiter-row attribution rule (Editor.tsx's citation).
  const editor = await openMixWithDiff(page);
  // Click the card's first row: the block reveals raw, so the ```js line is
  // editable text under the caret.
  await editor.locator('.cm-line.mm-fence-card-first').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('python');
  await caretToTail(page);
  const marked = editor.locator('.cm-line.mm-diff-changed');
  await expect(marked).toHaveCount(1);
  // The mark stays on the delimiter row — the card's top edge — rather than
  // being re-attributed to a code line that did not change.
  await expect(marked).toHaveClass(/mm-fence-card-first/);
  const box = await marked.boundingBox();
  expect(box!.height).toBeGreaterThan(0);
});

test('E498: an image line edit and a whole added image line are marked, widgets intact', async ({
  page,
}) => {
  // SPEC16 §2: an ImageWidget replace must not swallow the line's mark.
  const editor = await openMixWithDiff(page);
  const imageLine = editor.locator('.cm-line').filter({ has: page.locator('.mm-image-widget') });
  await imageLine.click(); // caret reveal: the raw ![pic](…) is editable
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.type('X');
  await caretToTail(page);
  await expect(editor.locator('.cm-line.mm-diff-changed')).toHaveCount(1);
  // The ImageWidget's replace does not swallow the line mark, and the image
  // still renders exactly once.
  await expect(editor.locator('.cm-line.mm-diff-changed .mm-image-widget')).toHaveCount(1);
  await expect(editor.locator('.mm-image-widget')).toHaveCount(1);

  // Adding a whole image line marks the added line too.
  await imageLine.first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('![two](/docs/pic.png)');
  await caretToTail(page);
  await expect(editor.locator('.cm-line.mm-diff-changed')).toHaveCount(2);
  await expect(editor.locator('.mm-image-widget')).toHaveCount(2);
});

test('E499: a deletion before the first line marks line 1, which the user can see', async ({
  page,
}) => {
  // SPEC16 §2: `deletedAfter` 0 means the saved text lost lines before line 1.
  const editor = await openMixWithDiff(page);
  await editor.locator('.cm-line').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Backspace');
  const marked = editor.locator('.cm-line.mm-diff-deleted-after');
  await expect(marked).toHaveCount(1);
  // It rides the first line — the only line above the removed text.
  await expect(editor.locator('.cm-line').first()).toHaveClass(/mm-diff-deleted-after/);
  const box = await marked.boundingBox();
  expect(box!.height).toBeGreaterThan(0);
});

test('E500: removing a whole fenced block leaves ONE deletion marker, not one per removed line', async ({
  page,
}) => {
  // SPEC16 §2: one marker per deleted RUN, at the surviving anchor line.
  const editor = await openMixWithDiff(page);
  await editor.locator('.cm-line.mm-fence-card-first').click(); // reveals the raw block
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Backspace');
  await caretToTail(page);
  await expect(editor.locator('.cm-line.mm-fence-card')).toHaveCount(0);
  await expect(editor.locator('.cm-line.mm-diff-deleted-after')).toHaveCount(1);
  await expect(editor.locator('.cm-line.mm-diff-changed')).toHaveCount(0);
});
