import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  bootEditorOn,
  caretInto,
  clickCharBoundary,
  dragAcrossText,
  editorTopGutterLine,
  freshApp,
  fsRead,
  fsWrite,
  menuSave,
  openGridDoc,
  openSettings,
  previewTopAnchorLines,
  saveSettings,
  selectPhraseInPane,
  selectSpanInPane,
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

  // SPEC39 §2.1 (issue #356): Shift+End from cell 1's content start clamps
  // to the ANCHOR's cell — the head walks to the line end (cell 2's side)
  // and lands on cell 1's content end.
  await caretInto(page, '| 1   | 2   |', 2);
  await page.keyboard.press('Shift+End');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('1');
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
async function openWrappedGrid(page: Page, path: string): Promise<string[]> {
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

const editState = (page: Page) =>
  page.evaluate(() => ({
    selText: window.__mmEdit?.selText ?? '',
    selFrom: window.__mmEdit?.selFrom ?? -1,
    selTo: window.__mmEdit?.selTo ?? -1,
    // SPEC39 §2.1 (issue #356): the unordered pair — a drag's anchor never moves.
    selAnchor: window.__mmEdit?.selAnchor ?? -1,
    selHead: window.__mmEdit?.selHead ?? -1,
  }));

/** The editor text's [k01 … last fragment end] slice — the whole-cell union in doc bytes. */
async function wholeCellUnion(page: Page, frags: string[]): Promise<string> {
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
  // exactly one cell — the ANCHOR's (SPEC39 §2.1, issue #356), so the head
  // lands on the Detail cell's content start: k01 through the anchor, no
  // pipe, no `zq`. (Collapse the whole-cell selection first: a mousedown
  // INSIDE a selected range starts a drag-and-drop of it, not a new selection.)
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await editState(page)).selText).toBe('');
  const k05 = await wordRect(page, EDITOR_PANE, 'k05');
  const zq = await wordRect(page, EDITOR_PANE, 'zq');
  await page.mouse.move(k05.x + 2, k05.y + k05.height / 2);
  await page.mouse.down();
  await page.mouse.move(zq.x - 3, zq.y + zq.height / 2, { steps: 10 });
  await page.mouse.up();
  // The mousedown two pixels into `k05` lands before its first character,
  // so the range runs through the space that precedes it.
  await expect.poll(async () => (await editState(page)).selText).toBe('k01 k02 k03 k04 ');
  const d = await editState(page);
  expect(d.selTo).toBe(d.selAnchor);
  expect(d.selText).not.toMatch(/[|]|zq/);
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

// ---------------------------------------------------------------------------
// SPEC39 §2.1 (issue #356): in-cell pointer selection — the ANCHOR's cell
// confines every step of a drag, the head snaps to its nearest content and
// the range never collapses; an outside anchor holds the head at the grid
// edge; click-count gestures select the word / the clicked cell.

const FLAT_SOURCE = 'top\n\n| Name | Detail |\n| --- | --- |\n| quick brown fox | lazy dog |\n| second | row two |\n\nbottom\n';
const LONG_CELL = 'the lazy dog sleeps under the old oak tree';
const LONG_SOURCE = `top\n\n| Name | Detail |\n| --- | --- |\n| quick brown fox | ${LONG_CELL} |\n\nbottom\n`;

/** Open an unwrapped grid fixture at a width that keeps every row on one display line. */
async function openFlatGrid(page: Page, path: string, source: string, rows: number): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 720 });
  await openGridDoc(page, path, source, 'top');
  const gridLines = () => page.getByTestId('editor').locator('.cm-line.mm-table-mode-line').count();
  await expect.poll(gridLines).toBe(rows);
}

/**
 * The editor's document text in DOC offsets, read off the seam: ⌘A in a
 * cell selects that cell, a second ⌘A the document (SPEC39 §2.1), and
 * `selText` is then the whole buffer. Leaves the caret collapsed in `word`.
 */
async function editorDocText(page: Page, word: string): Promise<string> {
  await caretInto(page, word, 2);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(async () => (await editState(page)).selText).toContain('bottom');
  const text = (await editState(page)).selText;
  await caretInto(page, word, 2);
  await expect.poll(async () => (await editState(page)).selText).toBe('');
  return text;
}

/** Screen x/y for `chars` into `word` (left edge of that character), in the editor pane. */
async function charPoint(page: Page, word: string, chars: number, nth = 0): Promise<{ x: number; y: number; w: number }> {
  const r = await wordRect(page, EDITOR_PANE, word, nth, { from: chars, to: chars + 1 });
  return { x: r.x + 1, y: r.y + r.height / 2, w: r.width };
}

test('E644: issue #356 — a pointer drag anchored on a cell\'s second character keeps its anchor on every step and clamps the head to the cell\'s content end over the padding, the pipe and the next cell, releasing there', async ({
  page,
}) => {
  await openFlatGrid(page, '/docs/v356a.md', FLAT_SOURCE, 5);
  const doc = await editorDocText(page, 'quick brown');
  const cs = doc.indexOf('quick brown fox');
  const ce = cs + 'quick brown fox'.length;
  expect(doc[ce]).toBe(' ');
  expect(doc[ce + 1]).toBe('|');

  const start = await charPoint(page, 'quick', 1);
  const fox = await wordRect(page, EDITOR_PANE, 'fox');
  const lazy = await wordRect(page, EDITOR_PANE, 'lazy');
  const foxEnd = fox.x + fox.width;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect.poll(async () => (await editState(page)).selAnchor).toBe(cs + 1);

  // One mouse.move per step; after each the anchor is unchanged and the
  // head sits inside the cell's content (never past its end, never before
  // the anchor). Steps with a known head assert it exactly; the others only
  // the in-cell bound.
  const steps: Array<{ x: number; expectHead?: number }> = [];
  for (let k = 1; k <= 5; k++) steps.push({ x: start.x + ((foxEnd - start.x) * k) / 5 });
  steps[4].expectHead = ce; // the fifth step reaches the end of `fox`
  steps.push({ x: foxEnd + start.w * 0.5, expectHead: ce }); // the trailing padding
  steps.push({ x: foxEnd + start.w * 1.5, expectHead: ce }); // the pipe
  steps.push({ x: lazy.x + lazy.width / 2, expectHead: ce }); // the next cell
  for (const step of steps) {
    await page.mouse.move(step.x, start.y);
    await expect
      .poll(async () => {
        const s = await editState(page);
        return {
          anchor: s.selAnchor,
          inCell: s.selHead > cs + 1 && s.selHead <= ce,
          head: step.expectHead === undefined ? undefined : s.selHead,
        };
      })
      .toEqual({ anchor: cs + 1, inCell: true, head: step.expectHead });
  }
  await page.mouse.up();
  await expect.poll(async () => (await editState(page)).selText).toBe('uick brown fox');
  const st = await editState(page);
  expect([st.selAnchor, st.selHead, st.selFrom, st.selTo]).toEqual([cs + 1, ce, cs + 1, ce]);
  expect(st.selText).not.toContain('|');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E627: issue #356 — the same drag leftwards over the cell\'s leading pipe into the previous cell clamps the head to the anchor cell\'s content start', async ({
  page,
}) => {
  await openFlatGrid(page, '/docs/v356b.md', FLAT_SOURCE, 5);
  const doc = await editorDocText(page, 'quick brown');
  const ls = doc.indexOf('lazy dog');

  const start = await charPoint(page, 'lazy', 1);
  const lazy = await wordRect(page, EDITOR_PANE, 'lazy');
  const fox = await wordRect(page, EDITOR_PANE, 'fox');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect.poll(async () => (await editState(page)).selAnchor).toBe(ls + 1);
  const xs = [
    lazy.x + 1, // the first character
    lazy.x - start.w * 0.5, // the leading padding
    lazy.x - start.w * 1.5, // the pipe
    fox.x + fox.width / 2, // the previous cell
  ];
  for (const x of xs) {
    await page.mouse.move(x, start.y);
    await expect
      .poll(async () => {
        const s = await editState(page);
        return { anchor: s.selAnchor, head: s.selHead };
      })
      .toEqual({ anchor: ls + 1, head: ls });
  }
  await page.mouse.up();
  await expect.poll(async () => (await editState(page)).selText).toBe('l');
  const st = await editState(page);
  expect([st.selFrom, st.selTo]).toEqual([ls, ls + 1]);
});

test('E628: issue #356 — double-click selects one word of the cell (a word abutting the cell edge included); triple-click on a non-first cell selects exactly that cell\'s content', async ({
  page,
}) => {
  await openFlatGrid(page, '/docs/v356c.md', FLAT_SOURCE, 5);
  const doc = await editorDocText(page, 'quick brown');
  const sel = () => editState(page).then((s) => s.selText);

  const brown = await wordRect(page, EDITOR_PANE, 'brown');
  await page.mouse.dblclick(brown.x + brown.width / 2, brown.y + brown.height / 2);
  await expect.poll(sel).toBe('brown');
  const fox = await wordRect(page, EDITOR_PANE, 'fox');
  await page.mouse.dblclick(fox.x + fox.width / 2, fox.y + fox.height / 2);
  await expect.poll(sel).toBe('fox');

  // Triple-click on the SECOND cell: its content, not the display line, the
  // pipes or the first cell.
  const dog = await wordRect(page, EDITOR_PANE, 'dog');
  await page.mouse.click(dog.x + dog.width / 2, dog.y + dog.height / 2, { clickCount: 3 });
  await expect.poll(sel).toBe('lazy dog');
  const st = await editState(page);
  expect([st.selFrom, st.selTo]).toEqual([doc.indexOf('lazy dog'), doc.indexOf('lazy dog') + 'lazy dog'.length]);
  // …and on the first cell.
  await page.mouse.click(brown.x + brown.width / 2, brown.y + brown.height / 2, { clickCount: 3 });
  await expect.poll(sel).toBe('quick brown fox');
  // A triple-click on prose still selects the line.
  const top = await wordRect(page, EDITOR_PANE, 'top');
  await page.mouse.click(top.x + 2, top.y + top.height / 2, { clickCount: 3 });
  await expect.poll(sel).toContain('top');
  expect(await sel()).not.toContain('|');
});

test('E629: issue #356 — Shift+End, Shift+Home, Shift+arrows and Shift+click with the anchor in a cell select to that cell\'s edges; ⌘A selects the cell, a second ⌘A the document; ⌘A on a separator is inert', async ({
  page,
}) => {
  await openFlatGrid(page, '/docs/v356d.md', FLAT_SOURCE, 5);
  const editor = page.getByTestId('editor');
  const sel = () => editState(page).then((s) => s.selText);
  const lineTexts = await editor.locator('.cm-line.mm-table-mode-line').allTextContents();
  const lazyCol = lineTexts[2].indexOf('lazy');

  await caretInto(page, 'quick brown', 2);
  await page.keyboard.press('Shift+End');
  await expect.poll(sel).toBe('quick brown fox');

  // Shift+Home from inside the SECOND cell: the line start is in the first
  // cell, but the anchor's cell wins — the head lands on `lazy`'s start.
  await caretInto(page, 'lazy dog', lazyCol + 2);
  await page.keyboard.press('Shift+Home');
  await expect.poll(sel).toBe('la');
  await caretInto(page, 'lazy dog', lazyCol + 2);
  await page.keyboard.press('Shift+End');
  await expect.poll(sel).toBe('zy dog');
  // Shift+ArrowDown / Up walk the head onto other rows: clamped to the cell's ends.
  await caretInto(page, 'lazy dog', lazyCol + 2);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(sel).toBe('zy dog');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(sel).toBe('zy dog');
  await caretInto(page, 'lazy dog', lazyCol + 2);
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(sel).toBe('la');
  // Shift+ArrowRight past the cell's end holds there; never a collapse.
  await caretInto(page, 'lazy dog', lazyCol + 2);
  for (let i = 0; i < 'zy dog'.length + 4; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(sel).toBe('zy dog');
  await caretInto(page, 'lazy dog', lazyCol + 2);
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(sel).toBe('la');

  // Shift+click on another row's cell: the anchor's cell, whole.
  await caretInto(page, 'quick brown', 2);
  const row = await wordRect(page, EDITOR_PANE, 'row two');
  await page.keyboard.down('Shift');
  await page.mouse.click(row.x + row.width / 2, row.y + row.height / 2);
  await page.keyboard.up('Shift');
  await expect.poll(sel).toBe('quick brown fox');

  // ⌘A: the cell, then the document.
  await caretInto(page, 'lazy dog', lazyCol + 2);
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(sel).toBe('lazy dog');
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(sel).toContain('top');
  expect(await sel()).toContain('bottom');
  // ⌘A on the separator row: nothing to select.
  await caretInto(page, '---', 3);
  await expect.poll(sel).toBe('');
  await page.keyboard.press('ControlOrMeta+a');
  await page.waitForTimeout(100);
  expect(await sel()).toBe('');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E630: issue #356 — a drag from the prose above (or below) the table into a cell holds the head at the table\'s start (or end), never inside a cell', async ({
  page,
}) => {
  await openFlatGrid(page, '/docs/v356e.md', FLAT_SOURCE, 5);
  const doc = await editorDocText(page, 'quick brown');
  const tableStart = doc.indexOf('| Name');
  const tableEnd = doc.indexOf('\n\nbottom');
  expect(doc[tableEnd - 1]).toBe('|');

  const top = await wordRect(page, EDITOR_PANE, 'top');
  const brown = await wordRect(page, EDITOR_PANE, 'brown');
  await page.mouse.move(top.x + 2, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(brown.x + brown.width / 2, brown.y + brown.height / 2, { steps: 6 });
  await expect.poll(async () => (await editState(page)).selHead).toBe(tableStart);
  await page.mouse.up();
  let st = await editState(page);
  expect(st.selHead).toBe(tableStart);
  expect(st.selText).not.toContain('|');
  expect(st.selText).toContain('op');

  // From below, upwards: the head holds at the table's end.
  await caretInto(page, 'bottom', 0);
  const bottom = await wordRect(page, EDITOR_PANE, 'bottom');
  const lazy = await wordRect(page, EDITOR_PANE, 'lazy');
  await page.mouse.move(bottom.x + bottom.width - 2, bottom.y + bottom.height / 2);
  await page.mouse.down();
  await page.mouse.move(lazy.x + lazy.width / 2, lazy.y + lazy.height / 2, { steps: 6 });
  await expect.poll(async () => (await editState(page)).selHead).toBe(tableEnd);
  await page.mouse.up();
  st = await editState(page);
  expect(st.selHead).toBe(tableEnd);
  expect(st.selText).not.toContain('|');
  expect(st.selText).toContain('bottom'.slice(0, 5));
});

test('E631: issue #356 — on a wrapped cell a drag across the wrap boundary keeps the whole-cell clamp: the anchor holds, the head follows onto later lines and stops at the union\'s end', async ({
  page,
}) => {
  const frags = await openWrappedGrid(page, '/docs/v356f.md');
  const union = await wholeCellUnion(page, frags);
  const k02 = await wordRect(page, EDITOR_PANE, 'k02');
  const lastWord = WRAP_WORDS[WRAP_WORDS.length - 1];
  const last = await wordRect(page, EDITOR_PANE, lastWord);
  const line3First = await wordRect(page, EDITOR_PANE, frags[2].slice(0, 3));

  await page.mouse.move(k02.x + 1, k02.y + k02.height / 2);
  await page.mouse.down();
  await expect.poll(async () => (await editState(page)).selText).toBe('');
  const anchor = (await editState(page)).selAnchor;
  // Across the wrap boundary onto the third line's first token.
  await page.mouse.move(line3First.x + line3First.width, line3First.y + line3First.height / 2, { steps: 8 });
  await expect.poll(async () => (await editState(page)).selText.split('\n').length).toBe(3);
  let st = await editState(page);
  expect(st.selAnchor).toBe(anchor);
  expect(st.selText.startsWith('k02')).toBe(true);
  expect(st.selText.endsWith(frags[2].slice(0, 3))).toBe(true);
  // Then into the padding past the last token: the union's end, and no further.
  await page.mouse.move(last.x + last.width + 30, last.y + last.height / 2, { steps: 4 });
  await expect.poll(async () => (await editState(page)).selText).toBe(union.slice(union.indexOf('k02')));
  await page.mouse.up();
  st = await editState(page);
  expect(st.selAnchor).toBe(anchor);
  expect(st.selText).toBe(union.slice(union.indexOf('k02')));
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E632: issue #356 — a 20-step drag inside a cell records no collapsed selection after the mousedown and keeps one anchor throughout (window.__mmSelLog)', async ({
  page,
}) => {
  await openFlatGrid(page, '/docs/v356g.md', LONG_SOURCE, 3);
  const doc = await editorDocText(page, 'quick brown');
  const cs = doc.indexOf(LONG_CELL);
  const ce = cs + LONG_CELL.length;

  const start = await charPoint(page, 'the', 1);
  const tree = await wordRect(page, EDITOR_PANE, 'tree');
  await page.evaluate(() => {
    window.__mmSelLog = [];
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect.poll(async () => (await editState(page)).selAnchor).toBe(cs + 1);
  await page.mouse.move(tree.x + tree.width, start.y, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => (await editState(page)).selText).toBe(LONG_CELL.slice(1));

  const log = await page.evaluate(() => window.__mmSelLog ?? []);
  expect(log.length).toBeGreaterThanOrEqual(20);
  // Only the mousedown's own caret may be collapsed; from the first move on,
  // every recorded selection is a range anchored where the drag began.
  const firstRanged = log.findIndex((e) => e.anchor !== e.head);
  expect(firstRanged).toBeGreaterThanOrEqual(0);
  expect(firstRanged).toBeLessThanOrEqual(1);
  expect(log.slice(firstRanged).every((e) => e.anchor !== e.head)).toBe(true);
  expect(log.every((e) => e.anchor === cs + 1)).toBe(true);
  expect(log.every((e) => e.head >= cs + 1 && e.head <= ce)).toBe(true);
  // The heads never step backwards: no flicker between clamped and unclamped.
  for (let i = 1; i < log.length; i++) expect(log[i].head).toBeGreaterThanOrEqual(log[i - 1].head);
});

test('E633: issue #356 — with the grid view off, selection is ordinary text: a drag across a pipe selects the raw slice including the `|`', async ({
  page,
}) => {
  await openFlatGrid(page, '/docs/v356h.md', FLAT_SOURCE, 5);
  const editor = page.getByTestId('editor');
  await editor.locator('.cm-line').filter({ hasText: 'quick brown' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-table').click();
  await page.getByTestId('smart-edit-toggle-grid').click();
  await expect.poll(() => editor.locator('.cm-line.mm-table-mode-line').count()).toBe(0);

  await dragAcrossText(page, EDITOR_PANE, 'fox', 'lazy');
  await expect.poll(async () => (await editState(page)).selText).toBe('fox | lazy');
});

// ---------------------------------------------------------------------------
// SPEC40 §2 (issue #357): the canonical ↔ display seam, end to end. Two grid
// tables — the first tall enough (six rows, each with its own rule line) that
// raw and canonical lines drift well apart, the second with a cell that wraps
// at the split width — above a heading and prose, in split edit.

const SEAM_WORDS = Array.from({ length: 30 }, (_, i) => `seam${String(i + 1).padStart(2, '0')}`);
const SEAM_CELL = SEAM_WORDS.join(' ');
const SEAM_PHRASE = 'mirrored phrase sits below both tables';
const SEAM_T1 = [
  '| Name | Detail |',
  '| --- | --- |',
  '| quick brown fox | lazy dog |',
  '| second | row two |',
  '| third | row three |',
  '| fourth | row four |',
  '| fifth | row five |',
  '| sixth | row six |',
].join('\n');
const SEAM_T2 = `| Key | Value |\n| --- | --- |\n| zq | ${SEAM_CELL} |\n| b | short |`;
/** Canonical lines the two tables occupy (T1: 8, T2: 4). */
const SEAM_TABLE_LINES = 12;

function seamDoc(trailing = 0): string {
  const tail = Array.from({ length: trailing }, (_, i) => `trailing paragraph ${i} gives the panes room to scroll.\n\n`).join('');
  return `# Seam\n\nintro paragraph above the grids.\n\n${SEAM_T1}\n\n${SEAM_T2}\n\n## Tail Heading\n\nHere the ${SEAM_PHRASE} in prose.\n\nAnother paragraph of prose follows the first one.\n\n${tail}`;
}
const PREVIEW_PANE = '[data-testid="split-preview"] .doc';
const lineOf = (doc: string, needle: string): number => doc.slice(0, doc.indexOf(needle)).split('\n').length;

/** Boot `doc` in split edit (grid view on unless patched off) and let the mount realign settle. */
async function openSeamSplit(page: Page, path: string, doc: string, patch: Record<string, unknown> = {}): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootEditorOn(page, path, doc, { splitEdit: true, tableGridView: true, ...patch });
  await expect(page.getByTestId('split-divider')).toBeVisible();
  const grid = page.getByTestId('editor').locator('.cm-line.mm-table-mode-line');
  if (patch.tableGridView === false) await expect(grid).toHaveCount(0);
  else await expect.poll(() => grid.count()).toBeGreaterThan(SEAM_TABLE_LINES + 4); // rules + wrapped rows
  await page.waitForTimeout(300); // the mount-time realign settles
}

/** The editor's RAW text as CodeMirror lays it out: every .cm-line, newline-joined. */
const rawEditorText = (page: Page) =>
  page
    .getByTestId('editor')
    .locator('.cm-content')
    .evaluate((el) => Array.from(el.querySelectorAll('.cm-line')).map((l) => l.textContent ?? '').join('\n'));

/** The seam's report, raw and canonical. */
const seamState = (page: Page) =>
  page.evaluate(() => ({
    selText: window.__mmEdit?.selText ?? '',
    selFrom: window.__mmEdit?.selFrom ?? -1,
    selTo: window.__mmEdit?.selTo ?? -1,
    canonFrom: window.__mmEdit?.canonFrom ?? -1,
    canonTo: window.__mmEdit?.canonTo ?? -1,
    canonHead: window.__mmEdit?.canonHead ?? -1,
    headLine: window.__mmEdit?.headLine ?? -1,
    focused: window.__mmEdit?.focused ?? false,
  }));

/** How many extra editor lines the grids add over their canonical lines. */
const gridExtraLines = async (page: Page) =>
  (await page.getByTestId('editor').locator('.cm-line.mm-table-mode-line').count()) - SEAM_TABLE_LINES;

/** Blur the editor the way a user does before a preview drag (E80's model). */
const blurIntoPreview = (page: Page) => page.getByTestId('split-preview').click({ position: { x: 10, y: 10 } });

test('E634: issue #357 — a preview prose phrase below two grids mirrors into the editor as exactly that phrase: selText equals it, canonFrom/canonTo are its canonical offsets, the raw range sits past the grids\' extra bytes', async ({
  page,
}) => {
  const doc = seamDoc();
  await openSeamSplit(page, '/docs/seam634.md', doc);
  await blurIntoPreview(page);
  await selectPhraseInPane(page, PREVIEW_PANE, SEAM_PHRASE);
  await expect.poll(async () => (await seamState(page)).selText).toBe(SEAM_PHRASE);
  const at = doc.indexOf(SEAM_PHRASE);
  const st = await seamState(page);
  expect([st.canonFrom, st.canonTo]).toEqual([at, at + SEAM_PHRASE.length]);
  expect(st.headLine).toBe(lineOf(doc, SEAM_PHRASE));
  const raw = await rawEditorText(page);
  expect(raw.slice(st.selFrom, st.selTo)).toBe(SEAM_PHRASE);
  expect(st.selFrom).toBeGreaterThan(at); // the grids' padding sits between
  // The preview's own selection survived the mirror (SPEC23 §1.3).
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(SEAM_PHRASE);
});

test('E635: issue #357 — a word selected in a preview table cell selects that word in the matching grid cell: the first table\'s flat cell, then the second table\'s wrapped cell, each on a grid line', async ({
  page,
}) => {
  const doc = seamDoc();
  await openSeamSplit(page, '/docs/seam635.md', doc);
  await blurIntoPreview(page);
  const editor = page.getByTestId('editor');
  for (const word of ['brown', 'seam17', 'seam03']) {
    await selectPhraseInPane(page, PREVIEW_PANE, word);
    await expect.poll(async () => (await seamState(page)).selText).toBe(word);
    const st = await seamState(page);
    expect([st.canonFrom, st.canonTo]).toEqual([doc.indexOf(word), doc.indexOf(word) + word.length]);
    expect(st.headLine).toBe(lineOf(doc, word));
    // The raw range is the word on a grid line, inside its pipe-bounded cell.
    const raw = await rawEditorText(page);
    expect(raw.slice(st.selFrom, st.selTo)).toBe(word);
    const lineIdx = raw.slice(0, st.selFrom).split('\n').length - 1;
    const line = raw.split('\n')[lineIdx];
    const col = st.selFrom - (raw.slice(0, st.selFrom).lastIndexOf('\n') + 1);
    const cell = line.slice(line.lastIndexOf('|', col) + 1, line.indexOf('|', col));
    expect(cell.trim()).toContain(word);
    await expect(editor.locator('.cm-line').nth(lineIdx)).toHaveClass(/mm-table-mode-line/);
    // The tinted selection is drawn on that grid line (the unfocused editor still draws it).
    await expect.poll(() => editor.locator('.cm-selectionBackground').count()).toBeGreaterThan(0);
  }
});

test('E636: issue #357 — a preview selection from the end of one cell into the next lands in the editor clamped to the FIRST cell\'s selected text: non-empty, no pipe, no page error, no stray range in the selection log', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const doc = seamDoc();
  await openSeamSplit(page, '/docs/seam636.md', doc);
  await blurIntoPreview(page);
  await page.evaluate(() => {
    window.__mmSelLog = [];
  });
  await selectSpanInPane(page, PREVIEW_PANE, 'fox', 'lazy');
  await expect.poll(async () => (await seamState(page)).selText).toBe('fox');
  const st = await seamState(page);
  expect(st.selText).not.toContain('|');
  expect([st.canonFrom, st.canonTo]).toEqual([doc.indexOf('fox'), doc.indexOf('fox') + 3]);
  // Every logged range stays inside the first cell's content.
  const raw = await rawEditorText(page);
  const cs = raw.indexOf('quick brown fox');
  const ce = cs + 'quick brown fox'.length;
  const log = await page.evaluate(() => window.__mmSelLog ?? []);
  expect(log.length).toBeGreaterThan(0);
  for (const e of log) {
    expect(Math.min(e.anchor, e.head)).toBeGreaterThanOrEqual(cs);
    expect(Math.max(e.anchor, e.head)).toBeLessThanOrEqual(ce);
  }
  expect(errors).toEqual([]);
});

test('E637: issue #357 — an editor selection below two grids mirrors into the split preview as mark.mm-mirror-sel over exactly that phrase; a selection inside a grid cell mirrors onto that cell\'s text', async ({
  page,
}) => {
  const doc = seamDoc();
  await openSeamSplit(page, '/docs/seam637.md', doc);
  const marks = page.locator(`${PREVIEW_PANE} mark.mm-mirror-sel`);
  const markText = () => marks.evaluateAll((els) => els.map((m) => m.textContent ?? '').join(''));

  await dragAcrossText(page, EDITOR_PANE, 'mirrored', 'tables');
  await expect.poll(async () => (await seamState(page)).selText).toBe(SEAM_PHRASE);
  await expect.poll(markText).toBe(SEAM_PHRASE);
  // No mark strays outside the phrase's paragraph.
  expect(await marks.evaluateAll((els) => els.every((m) => m.closest('p')?.textContent?.includes('mirrored phrase')))).toBe(true);

  const brown = await wordRect(page, EDITOR_PANE, 'brown');
  await page.mouse.dblclick(brown.x + brown.width / 2, brown.y + brown.height / 2);
  await expect.poll(async () => (await seamState(page)).selText).toBe('brown');
  await expect.poll(markText).toBe('brown');
  expect(await marks.evaluateAll((els) => els.every((m) => m.closest('td') !== null))).toBe(true);
});

test('E638: issue #357 — a plain split-preview click below two grids places the editor caret on the clicked CANONICAL offset and scrolls neither pane; in preview-only mode the same click then ⌘E lands the same caret', async ({
  page,
}) => {
  const doc = seamDoc();
  await openSeamSplit(page, '/docs/seam638.md', doc, { activeLine: true }); // issue #358: the caret line is located by its tint
  const editor = page.locator('[data-testid="editor"] .cm-scroller');
  const preview = page.getByTestId('split-preview');
  // Bring the paragraph below the grids into the preview's viewport first
  // (the tall grids push it under the fold), then let the follower settle.
  await preview.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(400);
  await expect(page.locator(`${PREVIEW_PANE} p`, { hasText: 'follows' })).toBeInViewport();
  const edBefore = await editor.evaluate((el) => el.scrollTop);
  const pvBefore = await preview.evaluate((el) => el.scrollTop);
  const target = doc.indexOf('follows') + 2;
  await clickCharBoundary(page, PREVIEW_PANE, 'follows', 2);
  await expect.poll(async () => (await seamState(page)).canonHead).toBe(target);
  const st = await seamState(page);
  expect(st.canonFrom).toBe(target);
  expect(st.canonTo).toBe(target);
  expect(st.focused).toBe(false);
  expect(st.headLine).toBe(lineOf(doc, 'follows'));
  await page.waitForTimeout(400);
  expect(Math.abs((await editor.evaluate((el) => el.scrollTop)) - edBefore)).toBeLessThan(2);
  expect(Math.abs((await preview.evaluate((el) => el.scrollTop)) - pvBefore)).toBeLessThan(2);

  // Preview-only: the click parks the caret; Mod+E carries it (SPEC25 §1)
  // through the seam once the grids have adopted.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toContainText('Another paragraph');
  await page.waitForTimeout(250);
  await clickCharBoundary(page, '[data-testid="doc"]', 'follows', 2);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect.poll(async () => (await seamState(page)).canonHead).toBe(target);
  await expect(page.locator('.cm-content .cm-activeLine')).toContainText('follows');
});

test('E639: issue #357 — sync scroll speaks canonical lines: the editor scrolled to the wrapped grid row puts the preview on that table, and the preview scrolled to the prose below the grids brings the editor to that paragraph\'s DISPLAY line', async ({
  page,
}) => {
  const doc = seamDoc(40);
  await openSeamSplit(page, '/docs/seam639.md', doc);
  await expect(page.getByTestId('sync-scroll-toggle')).toHaveAttribute('data-state', 'on');
  const editor = page.getByTestId('editor');
  const scroller = editor.locator('.cm-scroller');
  const preview = page.getByTestId('split-preview');
  // Park the caret at the document's end, far from both legs, so the
  // SPEC45 cue window never applies and the SPEC15 line interpolation runs.
  await editor.locator('.cm-line').first().click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await expect.poll(async () => (await seamState(page)).headLine).toBeGreaterThan(50);
  await page.waitForTimeout(400);

  // Editor leads: the wrapped row's first display line at the viewport top.
  // CodeMirror renders only the viewport, so come back to the top (the caret
  // stays at the end) before the grid line can be found in the DOM.
  await scroller.evaluate((sc) => (sc.scrollTop = 0));
  await expect.poll(() => editorTopGutterLine(page)).toBe(1);
  await page.waitForTimeout(300);
  const t2Line = lineOf(doc, '| Key |');
  const rowRaw = await scroller.evaluate((sc) => {
    const lines = Array.from(sc.querySelectorAll('.cm-line'));
    const row = lines.find((l) => l.classList.contains('mm-table-mode-line') && (l.textContent ?? '').includes('zq'))!;
    sc.scrollTop = row.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    return lines.indexOf(row) + 1;
  });
  expect(rowRaw).toBeGreaterThan(t2Line + 2 + 4); // the raw line really drifted below the canonical one
  await expect.poll(() => editorTopGutterLine(page)).toBe(rowRaw);
  await expect
    .poll(async () => {
      const { before, after } = await previewTopAnchorLines(page);
      return before <= t2Line && after >= t2Line;
    })
    .toBe(true);

  // Preview leads: the paragraph below the grids at the preview's top.
  const pLine = lineOf(doc, 'Another paragraph');
  await preview.evaluate((sc, line) => {
    const el = sc.querySelector<HTMLElement>(`[data-mm-line="${line}"]`)!;
    sc.scrollTop = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  }, pLine);
  const expected = pLine + (await gridExtraLines(page));
  await expect.poll(() => editorTopGutterLine(page)).toBeGreaterThanOrEqual(expected - 2);
  expect(await editorTopGutterLine(page)).toBeLessThanOrEqual(expected + 2);
});

test('E640: issue #357 — Table ▸ grid toggle keeps a ranged selection: the prose phrase below the grids stays selected off and on again, and so does a word inside a cell', async ({
  page,
}) => {
  const doc = seamDoc();
  await openSeamSplit(page, '/docs/seam640.md', doc);
  const editor = page.getByTestId('editor');
  const grid = editor.locator('.cm-line.mm-table-mode-line');
  const toggle = async (expectGrid: boolean) => {
    await page.getByTestId('smart-edit-gutter').click();
    await page.getByTestId('smart-edit-table').click();
    await page.getByTestId('smart-edit-toggle-grid').click();
    if (expectGrid) await expect.poll(() => grid.count()).toBeGreaterThan(SEAM_TABLE_LINES);
    else await expect(grid).toHaveCount(0);
    await page.waitForTimeout(300); // the re-fit settles before the next gesture
  };

  await dragAcrossText(page, EDITOR_PANE, 'mirrored', 'tables');
  await expect.poll(async () => (await seamState(page)).selText).toBe(SEAM_PHRASE);
  await toggle(false);
  await expect.poll(async () => (await seamState(page)).selText).toBe(SEAM_PHRASE);
  expect((await seamState(page)).canonFrom).toBe(doc.indexOf(SEAM_PHRASE));
  await toggle(true);
  await expect.poll(async () => (await seamState(page)).selText).toBe(SEAM_PHRASE);
  expect((await seamState(page)).canonFrom).toBe(doc.indexOf(SEAM_PHRASE));

  const brown = await wordRect(page, EDITOR_PANE, 'brown');
  await page.mouse.dblclick(brown.x + brown.width / 2, brown.y + brown.height / 2);
  await expect.poll(async () => (await seamState(page)).selText).toBe('brown');
  await toggle(false);
  await expect.poll(async () => (await seamState(page)).selText).toBe('brown');
  expect((await seamState(page)).canonFrom).toBe(doc.indexOf('brown'));
  await toggle(true);
  await expect.poll(async () => (await seamState(page)).selText).toBe('brown');
  expect((await seamState(page)).canonFrom).toBe(doc.indexOf('brown'));
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E641: issue #357 — with the grid view off the seam is the identity: a preview phrase below raw tables and a word in a raw cell mirror as exactly the raw text, canonical and raw offsets equal', async ({
  page,
}) => {
  const doc = seamDoc();
  await openSeamSplit(page, '/docs/seam641.md', doc, { tableGridView: false });
  await blurIntoPreview(page);
  await selectPhraseInPane(page, PREVIEW_PANE, SEAM_PHRASE);
  await expect.poll(async () => (await seamState(page)).selText).toBe(SEAM_PHRASE);
  let st = await seamState(page);
  expect([st.selFrom, st.selTo, st.canonFrom, st.canonTo]).toEqual([
    doc.indexOf(SEAM_PHRASE),
    doc.indexOf(SEAM_PHRASE) + SEAM_PHRASE.length,
    doc.indexOf(SEAM_PHRASE),
    doc.indexOf(SEAM_PHRASE) + SEAM_PHRASE.length,
  ]);
  await selectPhraseInPane(page, PREVIEW_PANE, 'brown');
  await expect.poll(async () => (await seamState(page)).selText).toBe('brown');
  st = await seamState(page);
  expect([st.selFrom, st.selTo, st.canonFrom, st.canonTo]).toEqual([
    doc.indexOf('brown'),
    doc.indexOf('brown') + 5,
    doc.indexOf('brown'),
    doc.indexOf('brown') + 5,
  ]);
});
