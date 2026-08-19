import { expect, test } from './fixtures';
import {
  caretInto,
  freshApp,
  fsRead,
  fsWrite,
  openGridDoc,
  openSettings,
} from './helpers';

// Tables: the grid is how tables look — one global view, chips, wrapping,
// confinement.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

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

test('E119b: a delimiter typed at human speed never snaps mid-row — the header survives', async ({ page }) => {
  // DELIM accepts partial rows ("| -" already qualifies), so while a
  // delimiter is being typed the watcher keeps seeing a fresh candidate.
  // The snap must wait for the typing pause: firing between keystrokes
  // rewrites the region under the caret and mapPoint sends a delimiter-row
  // caret into the header, garbling the keystrokes still in flight.
  await openGridDoc(page, '/docs/v114b.md', `top\n\n${COMPACT}\n\ntail`, 'top');
  const editor = page.getByTestId('editor');
  const text = () => editor.locator('.cm-content').evaluate((el) => (el as HTMLElement).innerText);

  await editor.locator('.cm-line').filter({ hasText: 'tail' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('| new | cols |', { delay: 100 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('| --- | --- |', { delay: 100 });
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBeGreaterThan(3);
  await expect.poll(text).toContain('| new | cols |');
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
  await expect.poll(text).toBe(raw);

  // The setting persists: reload, reopen, still raw.
  await page.keyboard.press('Control+s');
  await page.reload();
  // Issue #125: the reload reopens in the remembered edit mode.
  await expect(content).toBeVisible();
  await expect(content).toContainText('top');
  await expect.poll(gridLines).toBe(0);

  // Back on from the menu: both grid again.
  await editor.locator('.cm-line').filter({ hasText: '| 1 | 2 |' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await page.getByTestId('smart-edit-toggle-grid').click();
  await expect.poll(gridLines).toBe(6);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});
