import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { dirtyActiveDoc, freshApp, fsRead, fsWrite, openNotesRoot, revealToolbar, seedFolders } from './helpers';

// PRD 013 (issue #144): the file tab strip — presence, the tab list,
// activation, labels and the View-menu toggle. A pure view of the SPEC36
// open set: every assertion here reads the strip while the sidebar/model
// behaviour it mirrors stays covered by its own suites.
// PRD 013 Reqs 5–7 (issue #145, E272+): the close affordances — the ●/✕
// trailing slot, middle-click, and the tab context menu's close walks.
// PRD 013 Req 8 (issue #146, E292+): the untitled tab's close affordances —
// the same slot, closing through App's existing dirty-untitled guard, and
// the Save As replacement by the saved file's real tab.

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

/** E272+ setup: a, sub/b and deep/c open (strip order c, b, a), c active. */
async function openThree(page: Page): Promise<void> {
  await seedFolders(page);
  await openNotesRoot(page);
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('c.md');
  expect(await tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md']);
}

const tab = (page: Page, path: string) => page.locator(`[data-tab="${path}"]`);

test('E272: the trailing slot — dirty ● on the active and on a parked dirty tab, hover swaps it for ✕, a clean unhovered tab shows neither, no width jitter', async ({
  page,
}) => {
  await openThree(page);
  // All clean, pointer over the sidebar (last click): no ● anywhere, ✕ hidden.
  await expect(page.getByTestId('file-tab-dirty')).toHaveCount(0);
  await expect(tab(page, '/notes/sub/deep/c.md').getByTestId('file-tab-close')).toBeHidden();

  // Dirty the ACTIVE c: its tab carries the ● (pointer moved clear first).
  await dirtyActiveDoc(page, 'DOTC ');
  await page.mouse.move(4, 300);
  const cTab = tab(page, '/notes/sub/deep/c.md');
  await expect(cTab.getByTestId('file-tab-dirty')).toBeVisible();
  await expect(cTab.getByTestId('file-tab-close')).toBeHidden();

  // Park c dirty by activating b: the ● stays on the PARKED tab (SPEC36 §3.6
  // via dirtyOpenFiles — same source as the sidebar row's ●).
  await tab(page, '/notes/sub/b.md').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await page.mouse.move(4, 300);
  await expect(cTab).toHaveAttribute('data-active', 'false');
  await expect(cTab.getByTestId('file-tab-dirty')).toBeVisible();

  // Hover swaps ● for ✕ — and the slot reserves the footprint, so the tab
  // neither grows nor reflows its label (#144/E268 clipping intact).
  const before = (await cTab.boundingBox())!;
  await cTab.hover();
  await expect(cTab.getByTestId('file-tab-dirty')).toBeHidden();
  await expect(cTab.getByTestId('file-tab-close')).toBeVisible();
  const during = (await cTab.boundingBox())!;
  expect(Math.round(during.width)).toBe(Math.round(before.width));
  // Off again: the ● comes back.
  await page.mouse.move(4, 300);
  await expect(cTab.getByTestId('file-tab-dirty')).toBeVisible();
  await expect(cTab.getByTestId('file-tab-close')).toBeHidden();

  // The clean active b: neither ● nor (unhovered) ✕ in its slot.
  await expect(tab(page, '/notes/sub/b.md').getByTestId('file-tab-dirty')).toHaveCount(0);
  await expect(tab(page, '/notes/sub/b.md').getByTestId('file-tab-close')).toBeHidden();
});

test('E273: ✕ on a clean INACTIVE tab removes it without activating it — active file, buffer and mode untouched, no modal', async ({
  page,
}) => {
  await openThree(page);
  const aTab = tab(page, '/notes/a.md');
  await aTab.hover();
  await expect(aTab.getByTestId('file-tab-close')).toBeVisible();
  await aTab.getByTestId('file-tab-close').click();

  // a left the set; c never lost the active state (the ✕'s pointerdown/click
  // are stopped, so the close did not first switch tabs), and no prompt.
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md']);
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await expect(tab(page, '/notes/sub/deep/c.md')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/a.md"]')).not.toHaveClass(/\bopen\b/);
});

test('E274: ✕ on the ACTIVE tab activates closeOpen\'s nextActive; the last close lands on the splash', async ({
  page,
}) => {
  await openThree(page);
  // Close active c: the tree-order neighbour b activates (SPEC36 §3.5).
  const cTab = tab(page, '/notes/sub/deep/c.md');
  await cTab.hover();
  await cTab.getByTestId('file-tab-close').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/b.md', '/notes/a.md']);
  await expect(tab(page, '/notes/sub/b.md')).toHaveAttribute('data-active', 'true');

  // Close active b: a activates.
  await tab(page, '/notes/sub/b.md').hover();
  await tab(page, '/notes/sub/b.md').getByTestId('file-tab-close').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/a.md']);

  // Close the LAST open file: the in-workspace splash, and no strip at all.
  await tab(page, '/notes/a.md').hover();
  await tab(page, '/notes/a.md').getByTestId('file-tab-close').click();
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
});

test('E275: ✕ on a dirty parked tab activates it and prompts — Cancel keeps it open and dirty, Don\'t Save closes, Save writes then closes', async ({
  page,
}) => {
  await openThree(page);
  // Dirty b, then park it by activating a.
  await tab(page, '/notes/sub/b.md').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await dirtyActiveDoc(page, 'BDIRT ');
  await tab(page, '/notes/a.md').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // ✕ on parked dirty b: it activates FIRST (visible behind the modal,
  // SPEC36 §3.4) and the modal names it.
  const bTab = tab(page, '/notes/sub/b.md');
  await bTab.hover();
  await bTab.getByTestId('file-tab-close').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.getByTestId('open-prompt')).toContainText('b.md');

  // Cancel: b stays open, active and dirty; nothing closed.
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  expect(await tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md']);
  await expect(bTab).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Don't Save: b closes unwritten; the neighbour a activates (§3.5).
  await bTab.hover();
  await bTab.getByTestId('file-tab-close').click();
  await page.getByTestId('open-discard').click();
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/a.md']);
  await expect(page.getByTestId('docname')).toContainText('a.md');
  expect(await fsRead(page, '/notes/sub/b.md')).not.toContain('BDIRT');

  // Save: the dirty ACTIVE a writes to disk, then closes.
  await dirtyActiveDoc(page, 'ASAVE ');
  const aTab = tab(page, '/notes/a.md');
  await aTab.hover();
  await aTab.getByTestId('file-tab-close').click();
  await expect(page.getByTestId('open-prompt')).toContainText('a.md');
  await page.getByTestId('open-save').click();
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/deep/c.md']);
  await expect(page.getByTestId('docname')).toContainText('c.md');
  expect(await fsRead(page, '/notes/a.md')).toContain('ASAVE');
});

test('E276: middle-click closes through the same path — a clean tab goes silently without activating, a dirty one activates and prompts', async ({
  page,
}) => {
  await openThree(page);
  // Clean inactive a: middle-click closes it; c never loses the active state.
  await tab(page, '/notes/a.md').click({ button: 'middle' });
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md']);
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);

  // Dirty parked b: middle-click activates it and raises the SAME prompt.
  await tab(page, '/notes/sub/b.md').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await dirtyActiveDoc(page, 'MIDB ');
  await tab(page, '/notes/sub/deep/c.md').click();
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await tab(page, '/notes/sub/b.md').click({ button: 'middle' });
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.getByTestId('open-prompt')).toContainText('b.md');
  await page.getByTestId('open-discard').click();
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/deep/c.md']);
  await expect(page.getByTestId('docname')).toContainText('c.md');
});

test('E277: the tab context menu — exactly Close, Close Others, Close All; right-click never activates; Escape and outside clicks dismiss; Close = the ✕', async ({
  page,
}) => {
  await openThree(page);
  // Right-click the INACTIVE a: the menu opens, the tab does NOT activate.
  await tab(page, '/notes/a.md').click({ button: 'right' });
  await expect(page.getByTestId('file-tab-menu')).toBeVisible();
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await expect(tab(page, '/notes/a.md')).toHaveAttribute('data-active', 'false');
  // Exactly three items, in order.
  await expect(page.getByTestId('file-tab-menu').locator('button')).toHaveText([
    'Close',
    'Close Others',
    'Close All',
  ]);

  // Escape dismisses without closing anything.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('file-tab-menu')).toHaveCount(0);
  expect(await tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md']);

  // An outside pointer-down dismisses too.
  await tab(page, '/notes/a.md').click({ button: 'right' });
  await expect(page.getByTestId('file-tab-menu')).toBeVisible();
  await page.getByTestId('doc').click();
  await expect(page.getByTestId('file-tab-menu')).toHaveCount(0);

  // Close on a clean inactive tab: identical to its ✕ — removed, no
  // activation, no modal.
  await tab(page, '/notes/a.md').click({ button: 'right' });
  await page.getByTestId('file-tab-menu-close').click();
  await expect(page.getByTestId('file-tab-menu')).toHaveCount(0);
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md']);
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
});

test('E278: Close Others walks tree order one prompt at a time — Cancel stops the rest; a re-run completes and leaves the kept file active', async ({
  page,
}) => {
  await openThree(page);
  // Dirty b (parked), then make a the active file: strip is [c, b, a].
  await tab(page, '/notes/sub/b.md').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await dirtyActiveDoc(page, 'OTHERSB ');
  await tab(page, '/notes/a.md').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Close Others on a: targets [c, b] in tree order. Clean c goes at once;
  // dirty b activates and prompts — exactly one modal, naming b.
  await tab(page, '/notes/a.md').click({ button: 'right' });
  await page.getByTestId('file-tab-menu-close-others').click();
  await expect(page.getByTestId('open-prompt')).toContainText('b.md');
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/b.md', '/notes/a.md']);

  // Cancel: the walk stops. c stays closed, b stays open/active/dirty, a
  // stays open — and no further prompt appears.
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  expect(await tabPaths(page)).toEqual(['/notes/sub/b.md', '/notes/a.md']);
  await expect(tab(page, '/notes/sub/b.md')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);

  // Asked again: the prompt resumes on b; Don't Save finishes the walk —
  // the right-clicked a is the only open file AND the active one.
  await tab(page, '/notes/a.md').click({ button: 'right' });
  await page.getByTestId('file-tab-menu-close-others').click();
  await expect(page.getByTestId('open-prompt')).toContainText('b.md');
  await page.getByTestId('open-discard').click();
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/a.md']);
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(tab(page, '/notes/a.md')).toHaveAttribute('data-active', 'true');
  expect(await fsRead(page, '/notes/sub/b.md')).not.toContain('OTHERSB');
});

test('E279: Close All closes every open-set file one at a time and lands on the splash with the tree selection cleared', async ({
  page,
}) => {
  await openThree(page);
  // Dirty b (parked); c stays the active file.
  await tab(page, '/notes/sub/b.md').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await dirtyActiveDoc(page, 'ALLB ');
  await tab(page, '/notes/sub/deep/c.md').click();
  await expect(page.getByTestId('docname')).toContainText('c.md');

  // Close All: clean active c closes (b activates as its §3.5 neighbour),
  // dirty b prompts in turn — Don't Save — then clean a closes, ending on
  // the splash: empty open set, no strip, no selected row.
  await tab(page, '/notes/sub/deep/c.md').click({ button: 'right' });
  await page.getByTestId('file-tab-menu-close-all').click();
  await expect(page.getByTestId('open-prompt')).toContainText('b.md');
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  await expect(page.locator('.folder-item.selected')).toHaveCount(0);
  await expect(page.locator('.folder-item.open')).toHaveCount(0);
  expect(await fsRead(page, '/notes/sub/b.md')).not.toContain('ALLB');
});

/** The ephemeral untitled tab — SPEC36 §2.6 keeps it outside the open set,
 *  so it renders with an empty data-tab after the set's tabs. */
const untitledTab = (page: Page) => page.locator('[data-tab=""]');

/** E292+ setup: the untitled tab alone — welcome closed, then File → New. */
async function openUntitledAlone(page: Page): Promise<void> {
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.evaluate(() => window.__mmDispatch!('newFile'));
  await expect(page.getByTestId('file-tab')).toHaveCount(1);
  await expect(untitledTab(page)).toHaveAttribute('data-active', 'true');
}

/** Type into the untitled buffer (startUntitled lands in edit mode). */
async function dirtyUntitled(page: Page, text: string): Promise<void> {
  await page.locator('.cm-line').first().click();
  await page.keyboard.type(text);
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
}

test('E292: the untitled tab carries the trailing slot — clean shows neither, dirty shows the ● from App\'s own flag, hover swaps it for ✕, no width jitter', async ({
  page,
}) => {
  await openUntitledAlone(page);
  const t = untitledTab(page);
  // Clean, pointer clear: neither ● nor ✕ — same as a clean open-set tab.
  await page.mouse.move(4, 300);
  await expect(t.getByTestId('file-tab-dirty')).toHaveCount(0);
  await expect(t.getByTestId('file-tab-close')).toBeHidden();

  // Clean hover: the ✕ appears; the always-reserved slot keeps the width
  // fixed, so the "Untitled" label never reflows.
  const before = (await t.boundingBox())!;
  await t.hover();
  await expect(t.getByTestId('file-tab-close')).toBeVisible();
  expect(Math.round((await t.boundingBox())!.width)).toBe(Math.round(before.width));

  // Dirty the buffer: the ● shows — read from App's dirty flag, since the
  // untitled buffer sits outside dirtyOpenFiles (SPEC36 §2.6).
  await dirtyUntitled(page, 'UDOT ');
  await page.mouse.move(4, 300);
  await expect(t.getByTestId('file-tab-dirty')).toBeVisible();
  await expect(t.getByTestId('file-tab-close')).toBeHidden();

  // Hover swaps ● for ✕ with no width change; off again, the ● returns.
  await t.hover();
  await expect(t.getByTestId('file-tab-dirty')).toBeHidden();
  await expect(t.getByTestId('file-tab-close')).toBeVisible();
  expect(Math.round((await t.boundingBox())!.width)).toBe(Math.round(before.width));
  await page.mouse.move(4, 300);
  await expect(t.getByTestId('file-tab-dirty')).toBeVisible();
  await expect(t.getByTestId('file-tab-close')).toBeHidden();
});

test('E293: a CLEAN untitled tab closes silently — ✕ and middle-click both land on the splash through closeFile, no prompt', async ({
  page,
}) => {
  await openUntitledAlone(page);
  // ✕: exactly closeFile's clean-untitled arm — closeToSplash, no modal.
  await untitledTab(page).hover();
  await untitledTab(page).getByTestId('file-tab-close').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);

  // Middle-click on a fresh clean untitled tab: the same silent path.
  await page.evaluate(() => window.__mmDispatch!('newFile'));
  await expect(untitledTab(page)).toBeVisible();
  await untitledTab(page).click({ button: 'middle' });
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
});

test('E294: dirty untitled ✕ raises the close-untitled prompt — Cancel and a cancelled Save As leave it open and dirty; Don\'t save discards', async ({
  page,
}) => {
  await openUntitledAlone(page);
  await dirtyUntitled(page, 'UGUARD ');
  const t = untitledTab(page);

  // ✕ ⇒ the very prompt File → Close File raises, naming the buffer.
  await t.hover();
  await t.getByTestId('file-tab-close').click();
  await expect(page.getByTestId('open-prompt')).toContainText('Untitled');

  // Cancel: still open, active and dirty — the tab keeps its ●.
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(t).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.mouse.move(4, 300);
  await expect(t.getByTestId('file-tab-dirty')).toBeVisible();

  // Save with the Save As dialog cancelled (SPEC22 §2.3): the close aborts
  // — the buffer stays open and dirty rather than closing.
  await t.hover();
  await t.getByTestId('file-tab-close').click();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = null;
  });
  await page.getByTestId('open-save').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(t).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.mouse.move(4, 300);
  await expect(t.getByTestId('file-tab-dirty')).toBeVisible();

  // Don't save: the buffer discards to the splash, nothing written.
  await t.hover();
  await t.getByTestId('file-tab-close').click();
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
});

test('E295: Save in the untitled close prompt runs Save As (SPEC22 §2.2), writes the buffer, then finishes the close', async ({
  page,
}) => {
  await openUntitledAlone(page);
  await dirtyUntitled(page, 'UKEEP ');
  await untitledTab(page).hover();
  await untitledTab(page).getByTestId('file-tab-close').click();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/kept.md';
  });
  await page.getByTestId('open-save').click();
  // Save As landed the bytes, then the close-untitled intent completed —
  // the splash, with no tab (Untitled or kept.md) left behind.
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  expect(await fsRead(page, '/docs/kept.md')).toContain('UKEEP');
});

test('E296: dirty untitled middle-click prompts through the same guard; right-click opens NO tab menu; an open-set tab\'s menu still walks only the set', async ({
  page,
}) => {
  await openThree(page);
  await page.evaluate(() => window.__mmDispatch!('newFile'));
  await expect(page.getByTestId('file-tab')).toHaveCount(4);
  await dirtyUntitled(page, 'UMID ');
  const t = untitledTab(page);

  // Middle-click: the same close-untitled prompt; Cancel keeps it open,
  // active and dirty.
  await t.click({ button: 'middle' });
  await expect(page.getByTestId('open-prompt')).toContainText('Untitled');
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(t).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Right-click: NO tab context menu — its walks are SPEC36 open-set walks
  // and the untitled buffer sits outside the set (§2.6).
  await t.click({ button: 'right' });
  await expect(page.getByTestId('file-tab-menu')).toHaveCount(0);

  // The menu from an OPEN-SET tab is unchanged: Close All walks c, b, a
  // (clean — no prompts) and leaves the untitled buffer as the active
  // document, its edit intact.
  await tab(page, '/notes/sub/deep/c.md').click({ button: 'right' });
  await expect(page.getByTestId('file-tab-menu')).toBeVisible();
  await page.getByTestId('file-tab-menu-close-all').click();
  await expect.poll(() => tabPaths(page)).toEqual(['']);
  await expect(t).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.locator('.cm-content').first()).toContainText('UMID');
});

test('E297: the untitled tab never joins the open set — tabs, sidebar rows and the persisted session carry no Untitled entry, and none appears after a restart', async ({
  page,
}) => {
  await openThree(page);
  await page.evaluate(() => window.__mmDispatch!('newFile'));
  await expect(page.getByTestId('file-tab')).toHaveCount(4);

  // The strip: the three open-set tabs plus the appended untitled one — the
  // set itself is untouched, and the sidebar shows the same three rows.
  expect(await tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md', '']);
  await expect(page.locator('.folder-item.open')).toHaveCount(3);
  await expect(page.getByTestId('folder-panel')).not.toContainText('Untitled');

  // The persisted open-set state (issue #81's session slot): the three
  // paths and no "Untitled" entry.
  await expect.poll(() => fsRead(page, '/config/session/untitled.json')).toContain('/notes/a.md');
  const session = (await fsRead(page, '/config/session/untitled.json'))!;
  expect(session).toContain('/notes/sub/b.md');
  expect(session).toContain('/notes/sub/deep/c.md');
  expect(session).not.toContain('Untitled');

  // Restart: the revival brings back exactly the three files — the
  // ephemeral tab does not reappear.
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openNotesRoot(page);
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md']);
  await expect(untitledTab(page)).toHaveCount(0);
});

test('E298: Save As replaces the untitled tab with the saved file\'s real tab — active, in the open set, exactly one', async ({
  page,
}) => {
  await openThree(page);
  await page.evaluate(() => window.__mmDispatch!('newFile'));
  await expect(page.getByTestId('file-tab')).toHaveCount(4);
  await dirtyUntitled(page, 'USAVED ');

  // Save As through the armed dialog: the existing writeDocCopyTo → openDoc
  // path clears untitled and adds the saved path to the set (addOpen).
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/notes/saved.md';
    window.__mmDispatch!('saveAs');
  });
  await expect(page.getByTestId('docname')).toContainText('saved.md');

  // No Untitled tab remains; exactly one tab for the saved path — active,
  // and a member of the open set in its tree-order position.
  await expect(untitledTab(page)).toHaveCount(0);
  await expect(page.locator('[data-tab="/notes/saved.md"]')).toHaveCount(1);
  await expect(page.locator('[data-tab="/notes/saved.md"]')).toHaveAttribute('data-active', 'true');
  await expect
    .poll(() => tabPaths(page))
    .toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md', '/notes/saved.md']);

  // On disk with the typed text, and in the persisted open set (SPEC36).
  expect(await fsRead(page, '/notes/saved.md')).toContain('USAVED');
  await expect.poll(() => fsRead(page, '/config/session/untitled.json')).toContain('/notes/saved.md');
});
