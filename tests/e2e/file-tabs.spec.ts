import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { dirtyActiveDoc, freshApp, fsRead, fsWrite, openNotesRoot, openSettings, revealToolbar, seedFolders } from './helpers';

// PRD 013 (issue #144): the file tab strip — presence, the tab list,
// activation, labels and the View-menu toggle. A pure view of the SPEC36
// open set: every assertion here reads the strip while the sidebar/model
// behaviour it mirrors stays covered by its own suites.
// PRD 013 Reqs 5–7 (issue #145, E272+): the close affordances — the ●/✕
// trailing slot, middle-click, and the tab context menu's close walks.
// PRD 013 Req 8 (issue #146, E292+): the untitled tab's close affordances —
// the same slot, closing through App's existing dirty-untitled guard, and
// the Save As replacement by the saved file's real tab.
// PRD 013 Reqs 10–12 (issue #148, E305+): the plane treatment — the three
// surfaces (strip / inactive middle / active front) read from computed
// styles, in the light default and a dark theme.
// PRD 013 Req 16 (issue #149): the coverage sweep — E271 and E302 extended
// (only-open mode, a watched external write, a partly clipped tab click);
// the web guard for Req 14 is W16 in web.spec.ts.

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

test('E271: a pure view of the open set — Ctrl+Tab moves the active tab; a rename remaps label and position; a delete prunes; only-open mode and a watched external write change nothing', async ({
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

  // PRD 013 Reqs 3+15 (issue #149): only-open-files mode is a SIDEBAR view
  // (SPEC36 §5) — the strip keeps the same tree-ordered tabs, and a tab click
  // still activates while the flat list is up.
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/b.md', '/notes/z.md']);
  await page.getByTestId('folder-open-only').click();
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/filter-on/);
  expect(await tabPaths(page)).toEqual(['/notes/sub/b.md', '/notes/z.md']);
  await expect(page.locator('[data-tab="/notes/sub/b.md"]')).toHaveAttribute('data-active', 'true');
  await page.locator('[data-tab="/notes/z.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('z.md');
  await expect(page.locator('[data-tab="/notes/z.md"]')).toHaveAttribute('data-active', 'true');

  // PRD 013 Req 15 (issue #149): an external write reaching the clean active
  // doc through the file watcher refreshes the CONTENT only — same tabs, same
  // active one, and no dirty ● (the reload is not a local edit).
  await fsWrite(page, '/notes/z.md', '# Z fresh\n');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Z fresh');
  expect(await tabPaths(page)).toEqual(['/notes/sub/b.md', '/notes/z.md']);
  await expect(page.locator('[data-tab="/notes/z.md"]')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('file-tab-dirty')).toHaveCount(0);
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
const untitledTab = (page: Page) => tab(page, '');

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
  const t = untitledTab(page);
  // ✕: exactly closeFile's clean-untitled arm — closeToSplash, no modal.
  await t.hover();
  await t.getByTestId('file-tab-close').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);

  // Middle-click on a fresh clean untitled tab: the same silent path.
  await page.evaluate(() => window.__mmDispatch!('newFile'));
  await expect(t).toBeVisible();
  await t.click({ button: 'middle' });
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
  const t = untitledTab(page);
  await t.hover();
  await t.getByTestId('file-tab-close').click();
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
  await expect(tab(page, '/notes/saved.md')).toHaveCount(1);
  await expect(tab(page, '/notes/saved.md')).toHaveAttribute('data-active', 'true');
  await expect
    .poll(() => tabPaths(page))
    .toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md', '/notes/saved.md']);

  // On disk with the typed text, and in the persisted open set (SPEC36).
  expect(await fsRead(page, '/notes/saved.md')).toContain('USAVED');
  await expect.poll(() => fsRead(page, '/config/session/untitled.json')).toContain('/notes/saved.md');
});

// PRD 013 Req 9 (issue #147, E299+): overflow — the scrolling rail, the
// end-anchored arrows, wheel scrolling and reveal-on-activation.

/** A basename long enough to pin its tab at the 160px max width. */
const ovf = (i: number) => `/notes/ovf-t${String(i).padStart(2, '0')}-abcdefghijklmnopqrstuvwx.md`;

/**
 * E299+ setup: n max-width tabs, opened via real sidebar clicks (each open
 * is an activation, so the reveal keeps the newest tab in view). Ten 160px
 * tabs overflow the default 1280px viewport's rail; four fit it.
 */
async function openOverflow(page: Page, n: number): Promise<string[]> {
  await seedFolders(page);
  const paths: string[] = [];
  for (let i = 1; i <= n; i++) {
    paths.push(ovf(i));
    await fsWrite(page, ovf(i), `# T${i}\n`);
  }
  await openNotesRoot(page);
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  for (let i = 1; i <= n; i++) {
    await page.locator(`[data-path="${ovf(i)}"]`).click();
    await expect(page.getByTestId('docname')).toContainText(`ovf-t${String(i).padStart(2, '0')}`);
  }
  await expect(page.getByTestId('file-tab')).toHaveCount(n);
  return paths;
}

const rail = (page: Page) => page.getByTestId('file-tab-rail');
const railScroll = (page: Page) => rail(page).evaluate((el) => Math.round(el.scrollLeft));
const railMax = (page: Page) => rail(page).evaluate((el) => el.scrollWidth - el.clientWidth);

/** The tab is FULLY inside the rail's visible window (sub-pixel slack). */
const tabInView = (page: Page, path: string) =>
  rail(page).evaluate((el, p) => {
    const t = el.querySelector(`[data-tab="${CSS.escape(p)}"]`) as HTMLElement | null;
    if (!t) return false;
    return (
      t.offsetLeft >= el.scrollLeft - 1.5 &&
      t.offsetLeft + t.offsetWidth <= el.scrollLeft + el.clientWidth + 1.5
    );
  }, path);

/** Wheel over the strip's midpoint (moves the pointer there first). */
async function wheelOverStrip(page: Page, deltaX: number, deltaY: number): Promise<void> {
  const box = (await page.getByTestId('file-tab-strip').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(deltaX, deltaY);
}

test('E299: no arrows while the tabs fit; overflow grows them in, a resize that removes the overflow removes them — one row, fixed strip height', async ({
  page,
}) => {
  // Four max-width tabs fit the default 1280px rail: no arrow occupies strip
  // space and the rail has nowhere to scroll — the strip looks as it did.
  await openOverflow(page, 4);
  await expect(page.getByTestId('file-tab-scroll-left')).toHaveCount(0);
  await expect(page.getByTestId('file-tab-scroll-right')).toHaveCount(0);
  expect(await railMax(page)).toBeLessThanOrEqual(1);
  const stripBox = (await page.getByTestId('file-tab-strip').boundingBox())!;
  expect(Math.round(stripBox.height)).toBe(38); // --mm-tabstrip-h

  // Make the FIRST tab the active one, so the resize below (which keeps the
  // active tab revealed) parks the rail at its left end deterministically.
  await page.locator(`[data-path="${ovf(1)}"]`).click();
  await expect(page.getByTestId('docname')).toContainText('ovf-t01');

  // Narrow the window until the four tabs no longer fit: both arrows render,
  // the left one dead at scrollLeft 0 (the active first tab stays revealed),
  // the right one live — and the strip is still exactly one --mm-tabstrip-h
  // row, no wrap, no native scrollbar.
  await page.setViewportSize({ width: 700, height: 720 });
  await expect(page.getByTestId('file-tab-scroll-left')).toBeVisible();
  await expect(page.getByTestId('file-tab-scroll-right')).toBeVisible();
  await expect(page.getByTestId('file-tab-scroll-left')).toBeDisabled();
  await expect(page.getByTestId('file-tab-scroll-right')).toBeEnabled();
  expect(await railScroll(page)).toBe(0);
  const narrow = (await page.getByTestId('file-tab-strip').boundingBox())!;
  expect(Math.round(narrow.height)).toBe(38);
  // Every tab sits on the same row (one bottom edge), scrolled or clipped —
  // never wrapped below.
  const bottoms = await page
    .getByTestId('file-tab')
    .evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().bottom)))]);
  expect(bottoms).toHaveLength(1);
  // No visible native scrollbar: the rail's scrollbar is suppressed.
  expect(await rail(page).evaluate((el) => getComputedStyle(el).getPropertyValue('scrollbar-width'))).toBe('none');

  // Widen again: the overflow is gone and so are the arrows.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByTestId('file-tab-scroll-left')).toHaveCount(0);
  await expect(page.getByTestId('file-tab-scroll-right')).toHaveCount(0);
  expect(await railMax(page)).toBeLessThanOrEqual(1);
});

test('E300: arrows step the rail and die at their own ends — the open set, active file and tab order untouched by all of it', async ({
  page,
}) => {
  const paths = await openOverflow(page, 10);
  const before = await tabPaths(page);

  // The last open (t10) was the last activation: the rail sits revealed at
  // its far-right end — right arrow dead, left live.
  expect(await tabInView(page, ovf(10))).toBe(true);
  await expect(page.getByTestId('file-tab-scroll-right')).toBeDisabled();
  await expect(page.getByTestId('file-tab-scroll-left')).toBeEnabled();

  // One left step: the rail moves toward 0 and the right arrow revives.
  const atMax = await railScroll(page);
  await page.getByTestId('file-tab-scroll-left').click();
  const stepped = await railScroll(page);
  expect(stepped).toBeLessThan(atMax);
  await expect(page.getByTestId('file-tab-scroll-right')).toBeEnabled();
  await expect(page.getByTestId('file-tab-scroll-left')).toBeEnabled(); // mid-range: both live

  // Walk to the far left: the left arrow goes dead exactly at 0.
  for (let i = 0; i < 12 && (await railScroll(page)) > 0; i++) {
    await page.getByTestId('file-tab-scroll-left').click();
  }
  expect(await railScroll(page)).toBe(0);
  await expect(page.getByTestId('file-tab-scroll-left')).toBeDisabled();
  await expect(page.getByTestId('file-tab-scroll-right')).toBeEnabled();
  expect(await tabInView(page, ovf(1))).toBe(true);

  // And back to the far right: the right arrow dies at max scroll.
  for (let i = 0; i < 12 && (await railScroll(page)) < Math.floor(await railMax(page)); i++) {
    await page.getByTestId('file-tab-scroll-right').click();
  }
  await expect(page.getByTestId('file-tab-scroll-right')).toBeDisabled();
  expect(await railScroll(page)).toBeGreaterThanOrEqual(Math.floor(await railMax(page)) - 1);

  // All that clicking activated, closed and reordered NOTHING: same tabs in
  // the same order, t10 still the active document, no prompt anywhere.
  expect(await tabPaths(page)).toEqual(before);
  await expect(page.getByTestId('docname')).toContainText('ovf-t10');
  await expect(page.locator(`[data-tab="${paths[9]}"]`)).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
});

test('E301: wheel over the strip scrolls the rail — plain vertical and horizontal deltas alike — without moving the preview or the page, even at the range ends', async ({
  page,
}) => {
  await openOverflow(page, 10);
  const before = await tabPaths(page);
  const scrollTops = () =>
    page.evaluate(() => ({
      doc: document.scrollingElement!.scrollTop,
      workspace: document.querySelector('.workspace')!.scrollTop,
    }));
  const rest = await scrollTops();

  // The rail sits at its right end (t10 revealed). A plain VERTICAL wheel —
  // a mouse with no horizontal axis — scrolls the strip horizontally: the
  // issue #139 mapping. Wheel-up walks left…
  const atMax = await railScroll(page);
  await wheelOverStrip(page, 0, -240);
  const afterUp = await railScroll(page);
  expect(afterUp).toBeLessThan(atMax);
  // …and wheel-down walks right again.
  await wheelOverStrip(page, 0, 120);
  expect(await railScroll(page)).toBeGreaterThan(afterUp);

  // A HORIZONTAL (trackpad) delta drives it directly.
  await wheelOverStrip(page, -240, 0);
  expect(await railScroll(page)).toBeLessThan(afterUp + 120 + 1);

  // Nothing else scrolled or bounced: the page and the preview column sit
  // exactly where they were.
  expect(await scrollTops()).toEqual(rest);

  // At an end of the range the strip cannot move — and must not trap the
  // event in a broken way: wheeling further neither moves the rail past its
  // end nor scrolls the surroundings.
  for (let i = 0; i < 12 && (await railScroll(page)) > 0; i++) {
    await wheelOverStrip(page, 0, -480);
  }
  expect(await railScroll(page)).toBe(0);
  await wheelOverStrip(page, 0, -480);
  expect(await railScroll(page)).toBe(0);
  expect(await scrollTops()).toEqual(rest);

  // The open set is untouched by all the wheeling.
  expect(await tabPaths(page)).toEqual(before);
  await expect(page.getByTestId('docname')).toContainText('ovf-t10');
});

test('E302: activation reveals the tab from every path — sidebar row, Ctrl+Tab and a click on a partly clipped tab — minimally, and user scrolling never snaps back', async ({
  page,
}) => {
  await openOverflow(page, 10);

  // Sidebar row click on t01, whose tab is far off-view to the LEFT: the
  // reveal brings it fully in, left-aligned (nearest edge ⇒ scrollLeft 0 for
  // the first tab), not centred.
  await page.locator(`[data-path="${ovf(1)}"]`).click();
  await expect(page.getByTestId('docname')).toContainText('ovf-t01');
  expect(await tabInView(page, ovf(1))).toBe(true);
  expect(await railScroll(page)).toBe(0);

  // Minimal: activating the NEIGHBOUR t02 — already fully visible — moves
  // the rail not a pixel.
  await page.locator(`[data-tab="${ovf(2)}"]`).click();
  await expect(page.getByTestId('docname')).toContainText('ovf-t02');
  expect(await railScroll(page)).toBe(0);

  // Sidebar row click on t10, far off-view to the RIGHT: revealed at the
  // right edge.
  await page.locator(`[data-path="${ovf(10)}"]`).click();
  await expect(page.getByTestId('docname')).toContainText('ovf-t10');
  expect(await tabInView(page, ovf(10))).toBe(true);

  // Ctrl+Tab cycling: wherever it lands, the newly active tab is in view.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+Tab');
    const active = await page
      .locator('.file-tab[data-active="true"]')
      .getAttribute('data-tab');
    expect(active).toBeTruthy();
    expect(await tabInView(page, active!)).toBe(true);
  }

  // No fighting the user: park the rail where the ACTIVE tab is out of view,
  // then re-render the strip without an activation (dirtying the document
  // changes dirtyFiles) — the rail stays exactly where the user put it.
  await page.locator(`[data-path="${ovf(10)}"]`).click();
  await expect(page.getByTestId('docname')).toContainText('ovf-t10');
  for (let i = 0; i < 12 && (await railScroll(page)) > 0; i++) {
    await page.getByTestId('file-tab-scroll-left').click();
  }
  expect(await railScroll(page)).toBe(0);
  expect(await tabInView(page, ovf(10))).toBe(false); // active t10 parked out of view
  await dirtyActiveDoc(page, 'NOSNAP ');
  await expect(page.locator(`[data-tab="${ovf(10)}"] [data-testid="file-tab-dirty"]`)).toHaveCount(1);
  expect(await railScroll(page)).toBe(0); // still where the user left it

  // PRD 013 Req 9 (issue #149): "by any means" includes the tab itself — a
  // click on a PARTLY CLIPPED tab. Park the rail so t08 sits half over the
  // right edge, then click its visible left corner with the raw mouse (a
  // locator click would auto-scroll the tab in and defeat the assertion):
  // the click activates it and the app's own reveal pulls it fully in.
  const clipped = ovf(8);
  const corner = await rail(page).evaluate((el, p) => {
    const t = el.querySelector<HTMLElement>(`[data-tab="${CSS.escape(p)}"]`)!;
    el.scrollLeft = Math.max(0, t.offsetLeft + t.offsetWidth / 2 - el.clientWidth);
    // The rail scrolls instantly (no scroll-behavior), so the rect read here
    // already carries the parked position — viewport coordinates for a
    // mouse click, no rail-box arithmetic needed.
    const box = t.getBoundingClientRect();
    return { x: box.x, y: box.y + box.height / 2 };
  }, clipped);
  expect(await tabInView(page, clipped)).toBe(false); // clipped, not hidden
  await page.mouse.click(corner.x + 10, corner.y); // 10px in from its left corner
  await expect(page.getByTestId('docname')).toContainText('ovf-t08');
  await expect(page.locator(`[data-tab="${clipped}"]`)).toHaveAttribute('data-active', 'true');
  expect(await tabInView(page, clipped)).toBe(true);
});

test('E303: boot restore — the revived session\'s active tab is in view on first paint, arrows already live, without touching anything', async ({
  page,
}) => {
  await openOverflow(page, 10);
  await expect.poll(() => fsRead(page, '/config/session/untitled.json')).toContain(ovf(10));

  // Restart: revival brings the ten tabs and the persisted active file (t10)
  // back — its tab must be fully in view without any user scrolling, and the
  // overflow arrows are already correct (right dead at the revealed end).
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openNotesRoot(page);
  await expect.poll(() => tabPaths(page).then((t) => t.length)).toBe(10);
  await expect(page.getByTestId('docname')).toContainText('ovf-t10');
  await expect(page.locator(`[data-tab="${ovf(10)}"]`)).toHaveAttribute('data-active', 'true');
  expect(await tabInView(page, ovf(10))).toBe(true);
  await expect(page.getByTestId('file-tab-scroll-left')).toBeEnabled();
  await expect(page.getByTestId('file-tab-scroll-right')).toBeDisabled();
});

test('E304: File → New with an overflowing strip leaves the Untitled tab in view — appended past the far right and revealed', async ({
  page,
}) => {
  await openOverflow(page, 10);
  // Park the rail at the far LEFT so the appended untitled tab (rightmost)
  // starts as far out of view as it can be.
  for (let i = 0; i < 12 && (await railScroll(page)) > 0; i++) {
    await page.getByTestId('file-tab-scroll-left').click();
  }
  expect(await railScroll(page)).toBe(0);

  await page.evaluate(() => window.__mmDispatch!('newFile'));
  await expect(page.getByTestId('file-tab')).toHaveCount(11);
  await expect(untitledTab(page)).toHaveAttribute('data-active', 'true');
  expect(await tabInView(page, '')).toBe(true);
  // The open set itself is untouched — ten files plus the appended ephemeral.
  expect(await tabPaths(page)).toEqual([...Array(10).keys()].map((i) => ovf(i + 1)).concat(['']));
});

// ---- PRD 013 Reqs 10–12 (issue #148): the plane treatment, from computed
// styles. The sidebar's SPEC36 §4.1 three-plane system rotated to the top
// edge: strip on the folder pane's surface, active tab on the workspace's
// front plane, open-but-inactive tabs one shade back between the two.

/** A computed color's 0–255 channels — accepts the rgb()/rgba() legacy
 *  serialization AND color(srgb r g b), which is how Chromium serializes a
 *  color-mix(in srgb, …) computed value (the middle plane's background). */
const channels = (color: string): number[] => {
  const rgb = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = color.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!srgb) throw new Error(`unexpected computed color: ${color}`);
  return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])].map((v) => v * 255);
};

const bgOf = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);

/** The issue #148 plane assertions, valid under any theme currently on and
 *  any number of open-but-inactive tabs (openThree leaves two of them). */
async function assertTabPlanes(page: Page): Promise<void> {
  const active = page.locator('.file-tab.active');
  const inactive = page.locator('.file-tab:not(.active)');
  await expect(active).toHaveCount(1);

  // Req 10: the strip paints the folder pane's own surface — one continuous
  // L-shaped backdrop around the workspace's top-left corner.
  const stripBg = channels(await bgOf(page.getByTestId('file-tab-strip')));
  const panelBg = channels(await bgOf(page.getByTestId('folder-panel')));
  expect(stripBg).toEqual(panelBg);

  // Front plane: the active tab IS the workspace surface (the theme root's
  // --mm-bg — .workspace itself is transparent over it), distinct from the
  // strip surface behind it.
  const workspaceBg = channels(await bgOf(page.locator('.theme-root')));
  const activeBg = channels(await bgOf(active));
  expect(activeBg).toEqual(workspaceBg);
  expect(activeBg).not.toEqual(stripBg);

  // Middle plane: EVERY inactive tab reads as one surface distinct from both
  // the strip's and the front plane's, sitting BETWEEN them channel by
  // channel — one shade back from the front.
  const inactiveBgs = await inactive.evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).backgroundColor)
  );
  expect(inactiveBgs.length).toBeGreaterThan(0);
  for (const bg of inactiveBgs) {
    const inactiveBg = channels(bg);
    expect(inactiveBg).not.toEqual(activeBg);
    expect(inactiveBg).not.toEqual(stripBg);
    for (let i = 0; i < 3; i++) {
      const lo = Math.min(stripBg[i], activeBg[i]);
      const hi = Math.max(stripBg[i], activeBg[i]);
      expect(inactiveBg[i]).toBeGreaterThanOrEqual(lo);
      expect(inactiveBg[i]).toBeLessThanOrEqual(hi);
    }
  }

  // The lift: both planes carry a real shadow (the active one is asserted
  // stronger by stacking, not by parsing blur radii), and the active tab
  // stacks ABOVE every neighbor so that shadow falls over them, not under.
  expect(await active.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  expect(await inactive.first().evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  const activeZ = await active.evaluate((el) => Number(getComputedStyle(el).zIndex));
  const neighborZ = await inactive.evaluateAll((els) =>
    els.map((el) => Number(getComputedStyle(el).zIndex))
  );
  expect(Math.max(...neighborZ)).toBeLessThan(activeZ);
}

test('E305: the three planes from computed styles — strip on the pane surface, active tab on the workspace surface stacked above its lifted neighbors', async ({
  page,
}) => {
  await openThree(page);
  await assertTabPlanes(page);
});

test('E306: the plane ordering holds in a dark theme — strip < inactive < active, the active tab still the workspace surface (One Dark)', async ({
  page,
}) => {
  await openThree(page);
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('crisp');
  await page.getByTestId('settings-theme-dark').selectOption('one-dark');
  const useDark = page.getByTestId('use-dark-theme');
  if (!(await useDark.isChecked())) await useDark.check();
  await page.getByTestId('settings-close').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() => bgOf(page.locator('.theme-root')))
    .toBe('rgb(40, 44, 52)'); // One Dark #282c34
  await assertTabPlanes(page);
});

test('E307: Ctrl+Tab across multi-table documents — the wrap past the last tab lands the new document in the editor with no page error', async ({
  page,
}) => {
  // Issue #156 (SPEC36 §6.3 cycling over SPEC40 grids): switching tabs in
  // edit mode swaps the buffer with one whole-document replace; the OLD
  // document's grid spans used to collapse onto {0, newLength} and the
  // line-decoration builder threw "Ranges must be added sorted by `from`
  // position and `startSide`". Two tables per document is the minimum that
  // reproduced it.
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  const tables = (title: string) =>
    `# ${title}\n\n| a | b |\n| --- | --- |\n| ${title}1 | 2 |\n\nbetween\n\n| c | d |\n| --- | --- |\n| 3 | 4 |\n`;
  await seedFolders(page);
  await fsWrite(page, '/notes/t1.md', tables('One'));
  await fsWrite(page, '/notes/t2.md', tables('Two'));
  await openNotesRoot(page);
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await page.locator('[data-path="/notes/t1.md"]').click();
  await page.locator('[data-path="/notes/t2.md"]').click();
  expect(await tabPaths(page)).toEqual(['/notes/t1.md', '/notes/t2.md']);

  // Full-screen edit with the grid view on (its default): both tables grid.
  await openSettings(page);
  await page.getByTestId('settings-tab-general').click();
  await page.getByTestId('set-split-edit').uncheck();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(6);

  // t2.md is last in tree order, so this first cycle WRAPS past the end.
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('t1.md');
  await expect(page.locator('[data-tab="/notes/t1.md"]')).toHaveAttribute('data-active', 'true');
  await expect(editor.locator('.cm-content')).toContainText('One1');
  // The new document's tables re-grid (the debounced watcher) — and having
  // live spans again arms the NEXT switch, the same shape as the crash.
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(6);

  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('t2.md');
  await expect(page.locator('[data-tab="/notes/t2.md"]')).toHaveAttribute('data-active', 'true');
  await expect(editor.locator('.cm-content')).toContainText('Two1');
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(6);

  expect(errors, 'no page errors while cycling tabs').toEqual([]);
});
