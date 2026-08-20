import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { freshApp, fsRead, fsWrite, openNotesRoot, revealToolbar, seedFolders } from './helpers';

// PRD 013 (issue #144): the file tab strip — presence, the tab list,
// activation, labels and the View-menu toggle. A pure view of the SPEC36
// open set: every assertion here reads the strip while the sidebar/model
// behaviour it mirrors stays covered by its own suites.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

/** The strip's tabs, as their data-tab paths in render order. */
const tabPaths = (page: Page) =>
  page.getByTestId('file-tab').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.tab));

/** Open the in-app View ▸ flyout and hand back its File Tabs row. */
async function openFileTabsRow(page: Page): Promise<Locator> {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-view').click();
  return page.getByTestId('app-menu-view').getByTestId('menu-view-toggleFileTabs');
}

/** Choose View ▸ File Tabs (the click closes the whole menu itself). */
async function toggleFileTabsViaMenu(page: Page): Promise<void> {
  await (await openFileTabsRow(page)).click();
}

/** The File Tabs row's aria-checked, read with the flyout open, then closed. */
async function fileTabsChecked(page: Page): Promise<string | null> {
  const checked = await (await openFileTabsRow(page)).getAttribute('aria-checked');
  // The menu dismisses on an outside mousedown (Toolbar.tsx), not Escape —
  // the inert `.docname` span is E215's dismiss target.
  await page.getByTestId('docname').click();
  await expect(page.getByTestId('app-menu')).toHaveCount(0);
  return checked;
}

test('E266: strip presence — one tab per open file in tree order, single-tab and untitled cases, sidebar-independent, absent with no document', async ({
  page,
}) => {
  // freshApp left welcome.md open: ONE document ⇒ the strip still renders,
  // with a single active tab carrying the basename and the full-path tooltip.
  const strip = page.getByTestId('file-tab-strip');
  await expect(strip).toBeVisible();
  await expect(page.getByTestId('file-tab')).toHaveCount(1);
  await expect(page.getByTestId('file-tab')).toContainText('welcome.md');
  await expect(page.getByTestId('file-tab')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('file-tab')).toHaveAttribute('title', '/docs/welcome.md');

  // Workspace open but no file: the strip does not render at all — no empty
  // bar, no reserved element.
  await seedFolders(page);
  await openNotesRoot(page);
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await expect(strip).toHaveCount(0);

  // Three opens in NON-tree order: the strip renders them in the sidebar's
  // tree order (folders first — sub/deep/c, sub/b, then a), not open order.
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await expect(page.getByTestId('file-tab')).toHaveCount(3);
  expect(await tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md']);
  // The active file's tab is the distinct one — exactly one carries the state.
  await expect(page.locator('[data-tab="/notes/sub/deep/c.md"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-tab="/notes/sub/deep/c.md"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.file-tab.active')).toHaveCount(1);

  // Hiding the sidebar leaves the strip present and unchanged (Req 2).
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(strip).toBeVisible();
  await expect(page.getByTestId('file-tab')).toHaveCount(3);

  // An untitled buffer renders as an ephemeral ACTIVE tab labeled Untitled,
  // appended after the open set's tabs, which all go inactive (docPath null).
  await page.evaluate(() => window.__mmDispatch!('newFile'));
  await expect(page.getByTestId('file-tab')).toHaveCount(4);
  const untitledTab = page.getByTestId('file-tab').nth(3);
  await expect(untitledTab).toContainText('Untitled');
  await expect(untitledTab).toHaveAttribute('data-active', 'true');
  await expect(page.locator('.file-tab.active')).toHaveCount(1);
});

test('E267: clicking an inactive tab activates through the SPEC36 park/restore path; clicking the active tab is a no-op', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');

  // Dirty b in edit mode and STAY in edit — the parked buffer to restore.
  await page.keyboard.press('Control+e');
  await page.locator('.cm-line').first().click();
  await page.keyboard.type('TABTEXT ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Tab click activates a — b parks with its dirty flag (sidebar ● stays).
  await page.locator('[data-tab="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.locator('[data-tab="/notes/a.md"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-tab="/notes/sub/b.md"]')).toHaveAttribute('data-active', 'false');
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeVisible();

  // Tab click back on b: the parked buffer is restored exactly — dirty flag,
  // typed text, edit mode — the sidebar-click activation, not a re-read.
  await page.locator('[data-tab="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.locator('.cm-content').first()).toContainText('TABTEXT');

  // Clicking the ACTIVE tab is a no-op: no re-open from disk (the dirty
  // buffer would be replaced by the saved bytes), no mode change, no prompt.
  await page.locator('[data-tab="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('mode-switch')).toHaveAttribute('data-mode', 'edit');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.locator('.cm-content').first()).toContainText('TABTEXT');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
});

test('E268: a long basename clips with a CSS ellipsis inside the max tab width, and the tooltip carries the full path', async ({
  page,
}) => {
  const long = '/docs/a-very-long-file-name-meant-to-overflow-the-tab-strip-max-width.md';
  await fsWrite(page, long, '# Long\n');
  await page.goto(`/#open=${long}`);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Long');

  // Two tabs — the long one first in tree order; it stays inside the bounded
  // tab width instead of growing the strip.
  await expect(page.getByTestId('file-tab')).toHaveCount(2);
  const tab = page.locator(`[data-tab="${long}"]`);
  await expect(tab).toHaveAttribute('data-active', 'true');
  const box = (await tab.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(160);
  // Same height as its short-named neighbour: no wrap, no strip growth.
  const other = (await page.locator('[data-tab="/docs/welcome.md"]').boundingBox())!;
  expect(Math.round(box.height)).toBe(Math.round(other.height));

  // The ellipsis mechanism itself: the label is the clipped element…
  const label = tab.locator('.file-tab-label');
  const style = await label.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { textOverflow: cs.textOverflow, overflowX: cs.overflowX, whiteSpace: cs.whiteSpace };
  });
  expect(style).toEqual({ textOverflow: 'ellipsis', overflowX: 'hidden', whiteSpace: 'nowrap' });
  // …and it really is clipping (the full basename does not fit).
  expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // The hover tooltip disambiguates: the full path, not the clipped label.
  await expect(tab).toHaveAttribute('title', long);
});

test('E269: the View-menu toggle hides and shows the strip without touching the open set — dirty parked buffer included', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();

  // Dirty b, then park it by activating a — the set now holds a dirty
  // PARKED buffer, the state the toggle must not disturb.
  await page.keyboard.press('Control+e');
  await page.locator('.cm-line').first().click();
  await page.keyboard.type('KEEPME ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.locator('[data-tab="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeVisible();

  // Checked on by default; choosing it removes the strip immediately —
  // count 0, not a hidden or empty bar.
  expect(await fileTabsChecked(page)).toBe('true');
  await toggleFileTabsViaMenu(page);
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  expect(await fileTabsChecked(page)).toBe('false');

  // The open set, the active file and the parked dirty state are untouched:
  // the sidebar still shows a selected, b open with its ●.
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeVisible();

  // Back on: same tabs, same active file, and b's parked buffer restores
  // with the typed text — the toggle altered nothing.
  await toggleFileTabsViaMenu(page);
  await expect(page.getByTestId('file-tab-strip')).toBeVisible();
  expect(await tabPaths(page)).toEqual(['/notes/sub/b.md', '/notes/a.md']);
  await expect(page.locator('[data-tab="/notes/a.md"]')).toHaveAttribute('data-active', 'true');
  await page.locator('[data-tab="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.locator('.cm-content').first()).toContainText('KEEPME');
});

test('E270: the setting persists across a restart — off stays off (item unchecked), on brings the strip back', async ({
  page,
}) => {
  // Off, persisted: the settings pipeline writes fileTabs: false.
  await toggleFileTabsViaMenu(page);
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"fileTabs": false');

  // Restart (relaunch lands on the splash — no strip there regardless), then
  // reopen a document: the strip stays hidden and the View item unchecked.
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.goto('/#open=/docs/welcome.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  expect(await fileTabsChecked(page)).toBe('false');

  // On again, persisted, and it survives the next restart too. (goto('/')
  // drops the #open fragment — a fragment-removing navigation is a full
  // reload, so this boots clean onto the splash like the reload above.)
  await toggleFileTabsViaMenu(page);
  await expect(page.getByTestId('file-tab-strip')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"fileTabs": true');
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.goto('/#open=/docs/welcome.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await expect(page.getByTestId('file-tab-strip')).toBeVisible();
  await expect(page.getByTestId('file-tab')).toHaveCount(1);
});

test('E271: a pure view of the open set — Ctrl+Tab moves the active tab; a rename remaps label and position; a delete prunes', async ({
  page,
}) => {
  await seedFolders(page);
  await fsWrite(page, '/notes/m.md', '# M doc\n');
  await openNotesRoot(page);
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/m.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('m.md');
  expect(await tabPaths(page)).toEqual(['/notes/a.md', '/notes/m.md']);
  await expect(page.locator('[data-tab="/notes/m.md"]')).toHaveAttribute('data-active', 'true');

  // SPEC36 §6: Ctrl+Tab cycles — the strip's active tab follows immediately.
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.locator('[data-tab="/notes/a.md"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-tab="/notes/m.md"]')).toHaveAttribute('data-active', 'false');

  // Rename the active a.md → z.md: the tab's label updates AND the tab moves
  // to its new tree-order position (after m.md now); it stays the active one.
  await page.locator('[data-path="/notes/a.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  const input = page.getByTestId('folder-rename-input');
  await expect(input).toHaveValue('a.md');
  await page.keyboard.type('z');
  await expect(input).toHaveValue('z.md');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('docname')).toContainText('z.md');
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/m.md', '/notes/z.md']);
  await expect(page.locator('[data-tab="/notes/z.md"]')).toContainText('z.md');
  await expect(page.locator('[data-tab="/notes/z.md"]')).toHaveAttribute('data-active', 'true');

  // Delete the parked m.md: its tab is pruned; the active tab is untouched.
  await page.locator('[data-path="/notes/m.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await page.getByTestId('folder-delete-confirm').click();
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/z.md']);
  await expect(page.getByTestId('docname')).toContainText('z.md');
  await expect(page.locator('[data-tab="/notes/z.md"]')).toHaveAttribute('data-active', 'true');
});
