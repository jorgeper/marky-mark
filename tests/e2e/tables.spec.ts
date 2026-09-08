import { expect, test } from './fixtures';
import {
  caretInto,
  freshApp,
  fsRead,
  fsWrite,
  menuSave,
  openGridDoc,
  openSettings,
  saveSettings,
  smartEditAnnotation,
  wordRect,
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
  await saveSettings(page);
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
  await saveSettings(page);
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
  await saveSettings(page);
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

test('E324: issue #164 — a selection inside a rendered grid cell paints the band above the wash: drag, Shift+Arrow, ⌘A, and the preview table stays selectable', async ({
  page,
}) => {
  await openGridDoc(page, '/docs/v164.md', `top\n\n${COMPACT}\n\nbottom`, 'top');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  await expect.poll(text).toContain('| 1   | 2   |');

  // The stacking that kills the reporter's symptom (the same shape as the
  // #163 fence-card fix, asserted E317-style): the wash lives on a ::before
  // BELOW drawSelection's .cm-selectionLayer, and the grid line itself is
  // transparent — relative order, not the numbers CodeMirror hands out.
  const headerLine = editor.locator('.cm-line').filter({ hasText: '| aaa | b   |' }).first();
  const stack = await headerLine.evaluate((el) => ({
    line: getComputedStyle(el).backgroundColor,
    beforeZ: Number(getComputedStyle(el, '::before').zIndex),
    beforeBg: getComputedStyle(el, '::before').backgroundColor,
    layerZ: Number(
      getComputedStyle(el.closest('.cm-scroller')!.querySelector('.cm-selectionLayer')!).zIndex
    ),
  }));
  expect(stack.line).toBe('rgba(0, 0, 0, 0)');
  expect(stack.beforeBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(stack.beforeZ).toBeLessThan(stack.layerZ);

  // The header cell's glyphs, and the probe every case below shares: does some
  // .cm-selectionBackground rect of real width cover their midpoint?
  const aaa = await wordRect(page, '[data-testid="editor"] .cm-line.mm-table-mode-line', 'aaa');
  const mid = { x: aaa.x + aaa.width / 2, y: aaa.y + aaa.height / 2 };
  const bandCoversMid = () =>
    editor.locator('.cm-selectionBackground').evaluateAll(
      (els, pt) =>
        els.some((el) => {
          const r = el.getBoundingClientRect();
          return r.top <= pt.y && r.bottom >= pt.y && r.left <= pt.x && r.right >= pt.x && r.width > 0;
        }),
      mid
    );

  // ⌘A: the SPEC39 §2.1 cell-select path — 'aaa' is selected in state AND its
  // glyphs sit under a drawn band.
  await caretInto(page, '| aaa | b   |', 3);
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('aaa');
  await expect.poll(bandCoversMid).toBe(true);

  // Shift+Arrow: a one-character selection inside the cell is tinted too.
  await caretInto(page, '| aaa | b   |', 3);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('a');
  await expect.poll(bandCoversMid).toBe(true);

  // Mouse drag across the cell's glyphs: non-empty in state, tinted on screen.
  await page.mouse.move(aaa.x + 1, mid.y);
  await page.mouse.down();
  await page.mouse.move(aaa.x + aaa.width - 1, mid.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText ?? '')).toMatch(/^aa?a?$/);
  await expect.poll(bandCoversMid).toBe(true);

  // Selections dirtied nothing and the grid never moved.
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(3);

  // The preview pane's real <table> stays selectable by mouse (the other
  // reading of the report).
  await page.keyboard.press('Control+e');
  const th = page.getByTestId('doc').locator('th').first();
  await expect(th).toHaveText('aaa');
  const box = (await th.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString() ?? '')).toMatch(/aa/);
});

// ---------------------------------------------------------------------------
// Issue #346 (SPEC39 §2.1): a ranged selection with an endpoint in a WRAPPED
// cell clamps to the whole cell — every display line it wraps onto — not the
// fragment on the pivot's line. The fixture's Detail cell is 38 four-char
// tokens (151 chars): at the default 1280px viewport the column lays out
// ~61 wide, 15 tokens per line, so the cell wraps to exactly three lines
// (it stays three anywhere between 51 and 75 columns).

const WRAP_WORDS = Array.from({ length: 38 }, (_, i) => `k${String(i + 1).padStart(2, '0')}`);
const WRAP_CELL = WRAP_WORDS.join(' ');
const WRAP_SOURCE = `top\n\n| Name | Detail |\n| --- | --- |\n| zq | ${WRAP_CELL} |\n| b | short |\n\nbottom\n`;
const EDITOR_PANE = '[data-testid="editor"] .cm-content';

/** Open the fixture and return the wrapped cell's three per-line fragments. */
async function openWrappedGrid(page: import('@playwright/test').Page, path: string): Promise<string[]> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGridDoc(page, path, WRAP_SOURCE, 'top');
  const editor = page.getByTestId('editor');
  const gridLines = () => editor.locator('.cm-line.mm-table-mode-line').allTextContents();
  // header, separator, THREE lines of row 0, separator, row 1
  await expect.poll(async () => (await gridLines()).length).toBe(7);
  const lines = await gridLines();
  const frags = lines.slice(2, 5).map((l) => l.split('|')[2].trim());
  expect(frags.join(' ')).toBe(WRAP_CELL);
  expect(frags.every((f) => f.length > 0)).toBe(true);
  return frags;
}

const editState = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    selText: window.__mmEdit?.selText ?? '',
    selFrom: window.__mmEdit?.selFrom ?? -1,
    selTo: window.__mmEdit?.selTo ?? -1,
  }));

/** The editor text's [k01 … last fragment end] slice — the whole-cell union in doc bytes. */
async function wholeCellUnion(page: import('@playwright/test').Page, frags: string[]): Promise<string> {
  const text = await page.getByTestId('editor').locator('.cm-content').evaluate((el) => (el as HTMLElement).innerText);
  const start = text.indexOf(frags[0]);
  const last = frags[frags.length - 1];
  const end = text.indexOf(last, start) + last.length;
  return text.slice(start, end);
}

test('E613: issue #346 — a pointer drag from a wrapped cell\'s first line to its last selects the WHOLE cell (three tinted lines), a drag into the neighbouring cell stays confined to one cell, and ⌘C lands the joined visible text on the clipboard', async ({
  page,
}) => {
  const frags = await openWrappedGrid(page, '/docs/v346a.md');
  const editor = page.getByTestId('editor');
  const union = await wholeCellUnion(page, frags);
  expect(union.split('\n')).toHaveLength(3);
  expect(union).toContain('|');

  // (a) A real drag: from the gutter just left of k01 (line 1) to the padding
  // right of the last token (line 3). Both ends snap onto the cell's own
  // fragments — the union of the three fragments' content offsets.
  const first = await wordRect(page, EDITOR_PANE, 'k01');
  const last = await wordRect(page, EDITOR_PANE, WRAP_WORDS[WRAP_WORDS.length - 1]);
  await page.mouse.move(first.x - 4, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width + 24, last.y + last.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await editState(page)).selText).toBe(union);
  const st = await editState(page);
  expect(st.selTo - st.selFrom).toBe(union.length);
  // The tint covers all three wrapped lines: a selection rect intersects each line's box.
  const lineBoxes = await editor.locator('.cm-line.mm-table-mode-line').evaluateAll((els) =>
    els.slice(2, 5).map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    })
  );
  const coveredLines = () =>
    editor.locator('.cm-selectionBackground').evaluateAll(
      (els, boxes) =>
        boxes.filter((b) =>
          els.some((el) => {
            const r = el.getBoundingClientRect();
            const mid = (b.top + b.bottom) / 2;
            return r.width > 0 && r.top <= mid && r.bottom >= mid;
          })
        ).length,
      lineBoxes
    );
  await expect.poll(coveredLines).toBe(3);

  // (e) ⌘C over the whole-cell selection: the cell's visible text, wraps
  // joined with single spaces — no pipes, padding or newlines.
  await page.keyboard.press('ControlOrMeta+c');
  const clip = () => page.evaluate(() => (window.__mmClipboard ?? []).slice(-1)[0]);
  await expect.poll(clip).toBe(WRAP_CELL);
  // The menu's Copy takes the same route.
  await page.keyboard.press('Control+.');
  await page.getByTestId('smart-edit-copy').click();
  await expect.poll(() => page.evaluate(() => (window.__mmClipboard ?? []).length)).toBe(2);
  expect(await clip()).toBe(WRAP_CELL);

  // (d) A drag from the wrapped cell into the neighbouring cell: confined to
  // exactly one cell — the head's (SPEC39 §2.1's pivot), no pipe in it.
  // (Collapse the whole-cell selection first: a mousedown INSIDE a selected
  // range starts a drag-and-drop of it, not a new selection.)
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await editState(page)).selText).toBe('');
  const k05 = await wordRect(page, EDITOR_PANE, 'k05');
  const zq = await wordRect(page, EDITOR_PANE, 'zq');
  await page.mouse.move(k05.x + 2, k05.y + k05.height / 2);
  await page.mouse.down();
  await page.mouse.move(zq.x - 3, zq.y + zq.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await editState(page)).selText).toBe('zq');
  // Nothing dirtied; the grid never moved.
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(7);
});

test('E614: issue #346 — Shift+ArrowDown extends within the wrapped cell line by line then holds at its content end, Shift+End stays inside the cell, ⌘A selects the whole cell and a second ⌘A the document', async ({
  page,
}) => {
  const frags = await openWrappedGrid(page, '/docs/v346b.md');
  const editor = page.getByTestId('editor');
  const union = await wholeCellUnion(page, frags);
  const lineTexts = await editor.locator('.cm-line.mm-table-mode-line').allTextContents();
  const col = lineTexts[2].indexOf('k01');
  const sel = () => editState(page).then((s) => s.selText);

  // (b) From the start of line 1, Shift+ArrowDown walks the head down the
  // cell: two lines, three lines, then the separator line clamps it to the
  // cell's content end — and it stays there.
  await caretInto(page, 'k01', col);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(sel).toMatch(new RegExp(`^${frags[0]}[\\s\\S]*\\n[^\\n]*$`));
  expect((await sel()).split('\n')).toHaveLength(2);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await sel()).split('\n').length).toBe(3);
  expect((await sel()).startsWith(frags[0])).toBe(true);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(sel).toBe(union);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(sel).toBe(union);
  expect(await sel()).not.toContain('short');

  // Shift+ArrowUp from the cell's last line back to its first: the head
  // walks up to the separator above and clamps to the content start.
  await caretInto(page, frags[2].slice(0, 3), col + 2);
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(sel).toBe(union.slice(0, union.length - frags[2].length + 2));

  // Shift+End with the head on a middle line: within the cell's span, snapped
  // to that line's fragment end — no pipe, no padding.
  await caretInto(page, frags[1].slice(0, 3), col + 4);
  await page.keyboard.press('Shift+End');
  await expect.poll(sel).toBe(frags[1].slice(4));

  // (c) ⌘A with the caret on line 2 selects the whole cell…
  await caretInto(page, frags[1].slice(0, 3), col + 4);
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(sel).toBe(union);
  // …and a second ⌘A selects the document.
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(sel).toContain('top');
  expect(await sel()).toContain('bottom');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E615: issue #346 (SPEC39 §2.6) — typing over a whole-cell selection replaces the cell\'s content, the grid survives, and one ⌘Z restores the three lines', async ({
  page,
}) => {
  const frags = await openWrappedGrid(page, '/docs/v346c.md');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);
  const before = await text();
  const lineTexts = await editor.locator('.cm-line.mm-table-mode-line').allTextContents();
  const col = lineTexts[2].indexOf('k01');

  await caretInto(page, frags[1].slice(0, 3), col + 4);
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => editState(page).then((s) => s.selText)).toContain(frags[2]);
  await page.keyboard.type('X');
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBe(5);
  await expect.poll(text).toContain('| zq   | X');
  expect(await text()).toContain('| b    | short');
  expect(await text()).not.toContain('k01');
  // The caret sits after the X, inside the cell, collapsed — on the row's line.
  await expect.poll(() => editState(page).then((s) => s.selText)).toBe('');
  expect(await page.evaluate(() => window.__mmEdit?.headLine)).toBe(5);
  // ONE ⌘Z restores the three lines (one document change, one undo step).
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(text).toBe(before);
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(7);

  // Backspace over the whole cell empties it in one step; ⌘Z restores.
  await caretInto(page, 'k01', col + 1);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBe(5);
  await expect.poll(text).toContain('| zq   |     ');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(text).toBe(before);
});

test('E616: issue #346 — a highlight over a whole-cell selection anchors to the canonical cell text, paints on every wrapped line, and survives save + reload in the editor and the preview', async ({
  page,
}) => {
  const DOC = '/docs/v346d.md';
  const frags = await openWrappedGrid(page, DOC);
  const editor = page.getByTestId('editor');
  const lineTexts = await editor.locator('.cm-line.mm-table-mode-line').allTextContents();
  const col = lineTexts[2].indexOf('k01');
  const records = async () => {
    const raw = await fsRead(page, `${DOC}.comments.json`);
    return raw ? (JSON.parse(raw).comments as Array<{ anchor: { exact: string } }>) : [];
  };
  const painted = () =>
    editor.locator('.mm-hl[data-color="yellow"]').evaluateAll((els) => ({
      text: els.map((el) => el.textContent ?? '').join(''),
      lines: new Set(els.map((el) => el.closest('.cm-line'))).size,
    }));

  await caretInto(page, frags[1].slice(0, 3), col + 4);
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => editState(page).then((s) => s.selText)).toContain(frags[2]);
  await smartEditAnnotation(page, 'highlight', 'hl-yellow');
  await expect.poll(async () => (await records()).map((r) => r.anchor.exact), { timeout: 5000 }).toEqual([WRAP_CELL]);
  // One mark per wrapped line, the three together reading the cell.
  await expect.poll(painted).toEqual({ text: frags.join(''), lines: 3 });

  await menuSave(page);
  await page.reload();
  await expect(page.getByTestId('docname')).toContainText('v346d.md', { timeout: 15000 });
  await expect(page.getByTestId('doc').or(page.getByTestId('editor')).first()).toBeVisible();
  if (await page.getByTestId('editor').count()) await page.keyboard.press('Control+e');
  const doc = page.getByTestId('doc');
  await expect(doc).toBeVisible();
  await expect(doc.locator('td mark.hl[data-color="yellow"]').first()).toHaveText(WRAP_CELL);
  await page.keyboard.press('Control+e');
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBe(7);
  await expect.poll(painted).toEqual({ text: frags.join(''), lines: 3 });
});
