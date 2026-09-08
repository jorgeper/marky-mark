import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  cancelSettings,
  dirtyActiveDoc,
  freshApp,
  fsRead,
  fsWrite,
  landInPreview,
  openCommentsPane,
  openNotesRoot,
  openSettings,
  revealToolbar,
  saveSettings,
  seedFolders,
  viewMenuClick,
} from './helpers';

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

/**
 * PRD 013 Req 13 (issue #258): the strip's toggle is a Settings ▸ Appearance
 * checkbox — the View row is gone — so every flow below drives it there.
 */
function fileTabsBox(page: Page): Locator {
  return page.getByTestId('settings-file-tabs');
}

/** Flip the Appearance checkbox and commit it. */
async function toggleFileTabsViaSettings(page: Page): Promise<void> {
  await openSettings(page, 'appearance');
  await fileTabsBox(page).click();
  // Issue #246: the dialog no longer applies live — the flip only lands on Save.
  await saveSettings(page);
}

/** The checkbox's state, read with the dialog open, then closed again. */
async function fileTabsChecked(page: Page): Promise<boolean> {
  await openSettings(page, 'appearance');
  const checked = await fileTabsBox(page).isChecked();
  // Issue #246: a pure read changes nothing, so it leaves the clean way — no
  // pending edits means Cancel closes with no discard prompt.
  await cancelSettings(page);
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

test('E269: the Settings ▸ Appearance toggle hides and shows the strip without touching the open set — dirty parked buffer included', async ({
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

  // Checked on by default; clearing the Appearance checkbox removes the strip
  // immediately — count 0, not a hidden or empty bar.
  expect(await fileTabsChecked(page)).toBe(true);
  await toggleFileTabsViaSettings(page);
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  expect(await fileTabsChecked(page)).toBe(false);

  // The open set, the active file and the parked dirty state are untouched:
  // the sidebar still shows a selected, b open with its ●.
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeVisible();

  // Back on: same tabs, same active file, and b's parked buffer restores
  // with the typed text — the toggle altered nothing.
  await toggleFileTabsViaSettings(page);
  await expect(page.getByTestId('file-tab-strip')).toBeVisible();
  expect(await tabPaths(page)).toEqual(['/notes/sub/b.md', '/notes/a.md']);
  await expect(page.locator('[data-tab="/notes/a.md"]')).toHaveAttribute('data-active', 'true');
  await page.locator('[data-tab="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.locator('.cm-content').first()).toContainText('KEEPME');
});

test('E270: the setting persists across a restart — off stays off (checkbox clear), on brings the strip back', async ({
  page,
}) => {
  // Off, persisted: the settings pipeline writes fileTabs: false.
  await toggleFileTabsViaSettings(page);
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"fileTabs": false');

  // Restart (relaunch lands on the splash — no strip there regardless), then
  // reopen a document: the strip stays hidden and the checkbox clear.
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.goto('/#open=/docs/welcome.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  expect(await fileTabsChecked(page)).toBe(false);

  // On again, persisted, and it survives the next restart too. (goto('/')
  // drops the #open fragment — a fragment-removing navigation is a full
  // reload, so this boots clean onto the splash like the reload above.)
  await toggleFileTabsViaSettings(page);
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
  // Issue #257: the mode is entered from View ▸ Only Open Files now — the
  // flat open-set list replacing the tree is what says it took (SPEC36 §5.3).
  await viewMenuClick(page, 'toggleOpenOnly');
  await expect(page.locator('.folder-item-dir')).toHaveCount(0);
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

test('E348: the untitled tab carries the trailing slot — clean shows neither, dirty shows the ● from App\'s own flag, hover swaps it for ✕, no width jitter', async ({
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

test('E349: no arrows while the tabs fit; overflow grows them in, a resize that removes the overflow removes them — one row, fixed strip height', async ({
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

test('E350: arrows step the rail and die at their own ends — the open set, active file and tab order untouched by all of it', async ({
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

test('E351: wheel over the strip scrolls the rail — plain vertical and horizontal deltas alike — without moving the preview or the page, even at the range ends', async ({
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

test('E352: activation reveals the tab from every path — sidebar row, Ctrl+Tab and a click on a partly clipped tab — minimally, and user scrolling never snaps back', async ({
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

// ---- PRD 025 Reqs 6, 17–18 (issue #331; amended by issue #340): the page
// and its tabs, from computed styles. PRD 013 Reqs 10–12's three planes stay
// retired: the strip is a flat --mm-bg-elevated band on the ground with no
// shadow or radius of its own; the page proper below it carries the radius,
// the shadow and a 1px --mm-border outline; every tab is outlined and casts
// --mm-tab-shadow on the page's plane, the active tab the page's own --mm-bg
// joined to it through a break in the page's top hairline — no seam overlay.

/** A computed color's 0–255 channels — accepts the rgb()/rgba() legacy
 *  serialization AND color(srgb r g b), which is how Chromium serializes a
 *  color-mix(in srgb, …) computed value. */
const channels = (color: string): number[] => {
  const rgb = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = color.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!srgb) throw new Error(`unexpected computed color: ${color}`);
  return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])].map((v) => v * 255);
};

const bgOf = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);

/** A chrome token's value as the theme root computes it (`6px`, `#d1d9e0`…). */
const tokenOf = (page: Page, name: string) =>
  page.locator('.theme-root').evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

/** A colour token resolved to a computed colour: painted through a probe
 *  child of the theme root, so `#d1d9e0` and `rgb(209, 217, 224)` compare. */
const colorTokenOf = (page: Page, name: string) =>
  page.locator('.theme-root').evaluate((el, n) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${n})`;
    el.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);

/** Chromium's serialised box-shadow, taken apart: `rgba(r, g, b, a) x y blur spread`. */
const parseShadow = (shadow: string) => {
  const m = shadow.match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\) (-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px ([\d.]+)px$/);
  if (!m) throw new Error(`unexpected computed shadow: ${shadow}`);
  return {
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
    alpha: m[4] === undefined ? 1 : Number(m[4]),
    x: Number(m[5]),
    y: Number(m[6]),
    blur: Number(m[7]),
    spread: Number(m[8]),
  };
};

/** A shadow token's value as the browser computes it: painted through a
 *  probe child of the theme root, as colorTokenOf does for colours. */
const shadowTokenOf = (page: Page, name: string) =>
  page.locator('.theme-root').evaluate((el, n) => {
    const probe = document.createElement('div');
    probe.style.boxShadow = `var(${n})`;
    el.appendChild(probe);
    const v = getComputedStyle(probe).boxShadow;
    probe.remove();
    return v;
  }, name);

/** The painted colour of the one CSS pixel at (x, y): a 1×1 clip of a
 *  screenshot, decoded in-page through an <img> + <canvas> (the suite runs
 *  at device scale 1, so the clip is exactly one pixel). */
async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, png.toString('base64'));
}

/** The sheet treatment an element carries, from computed styles: its radius
 *  shorthand, its shadow, and its border widths as [top, right, bottom,
 *  left]. Passed to `Locator.evaluate`, so it runs in the page. */
const sheetOf = (el: Element) => {
  const st = getComputedStyle(el);
  return {
    radius: st.borderRadius,
    shadow: st.boxShadow,
    widths: [st.borderTopWidth, st.borderRightWidth, st.borderBottomWidth, st.borderLeftWidth],
  };
};
/** What everything on the ground plane reads — the column, the band, the
 *  sidebar and the body row carry no treatment of their own in any state. */
const flatSheet = { radius: '0px', shadow: 'none', widths: ['0px', '0px', '0px', '0px'] };

/** The page-and-tabs assertions of issue #340 (PRD 025 Reqs 6, 17–18 as
 *  amended), valid under any theme currently on and any number of
 *  open-but-inactive tabs (openThree leaves two of them): the strip band is
 *  flat ground; the page proper below it carries the radius, the shadow and
 *  a 1px outline on four sides; every tab is outlined and shadowed on the
 *  page's plane; the active tab has the page's fill, no bottom edge, and
 *  overhangs the page's top hairline so the two are one surface. */
async function assertPageAndTabs(page: Page): Promise<void> {
  const active = page.locator('.file-tab.active');
  const inactive = page.locator('.file-tab:not(.active)');
  const strip = page.getByTestId('file-tab-strip');
  const pageProper = page.locator('.workspace-stack > .workspace');
  await expect(active).toHaveCount(1);
  const border = channels(await colorTokenOf(page, '--mm-border'));
  const radius = await tokenOf(page, '--mm-radius-small');

  // Req 17: the strip is the ground's own colour — the folder panel's and
  // the body row's (one continuous --mm-bg-elevated plane) — and, above the
  // page's corner, nothing on that plane paints a shadow, hairline or radius
  // (issue #340 point A): not the band, not the column around it, not the
  // sidebar, not the ground.
  const stripBg = channels(await bgOf(strip));
  expect(stripBg).toEqual(channels(await bgOf(page.getByTestId('folder-panel'))));
  expect(stripBg).toEqual(channels(await bgOf(page.locator('.body-row'))));
  expect(await strip.evaluate(sheetOf)).toEqual(flatSheet);
  for (const sel of ['.workspace-stack', '.folder-wrap', '.body-row']) {
    expect(await page.locator(sel).evaluate(sheetOf)).toEqual(flatSheet);
  }
  expect(await page.getByTestId('folder-panel').evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');

  // Req 6 (amended; issue #349): the page proper is the theme root's --mm-bg
  // sheet with the tabs' radius on its top corners, its own --mm-page-shadow
  // (E605 pins its geometry), a 1px --mm-border outline on all four sides,
  // and no ::after seam overlay anywhere on the column.
  const pageBg = channels(await bgOf(page.locator('.theme-root')));
  expect(channels(await bgOf(pageProper))).toEqual(pageBg);
  const sheet = await pageProper.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      shadow: s.boxShadow,
      radiusLeft: s.borderTopLeftRadius,
      radiusRight: s.borderTopRightRadius,
      widths: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
      colors: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor],
    };
  });
  expect(sheet.shadow).not.toBe('none');
  expect(sheet.radiusLeft).toBe(radius);
  expect(sheet.radiusRight).toBe(radius);
  expect(sheet.widths).toEqual(['1px', '1px', '1px', '1px']);
  for (const c of sheet.colors) expect(channels(c)).toEqual(border);
  expect(await page.locator('.workspace-stack').evaluate((el) => getComputedStyle(el, '::after').content)).toBe(
    'none'
  );

  // Req 17 (amended): every tab — active and inactive — stands on the page's
  // plane: a 1px --mm-border outline on top and sides, the page's radius on
  // its top corners, and a shadow that resolves through --mm-tab-shadow
  // (the page's shadow at tab scale). No stacking. The active tab has no
  // bottom edge; an inactive tab's bottom edge is the hairline itself.
  expect(await tokenOf(page, '--mm-tab-shadow')).not.toBe('');
  const tabShadow = await shadowTokenOf(page, '--mm-tab-shadow');
  const tabStyles = await page.locator('.file-tab').evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return {
        active: el.classList.contains('active'),
        bg: s.backgroundColor,
        topWidth: s.borderTopWidth,
        leftWidth: s.borderLeftWidth,
        rightWidth: s.borderRightWidth,
        topColor: s.borderTopColor,
        bottomWidth: s.borderBottomWidth,
        bottomColor: s.borderBottomColor,
        radius: s.borderTopLeftRadius,
        shadow: s.boxShadow,
        z: s.zIndex,
      };
    })
  );
  expect(tabStyles.length).toBeGreaterThan(1);
  for (const st of tabStyles) {
    expect(st.topWidth).toBe('1px');
    expect(st.leftWidth).toBe('1px');
    expect(st.rightWidth).toBe('1px');
    expect(channels(st.topColor)).toEqual(border);
    if (st.active) expect(st.bottomWidth).toBe('0px');
    else {
      expect(st.bottomWidth).toBe('1px');
      expect(channels(st.bottomColor)).toEqual(border);
    }
    expect(st.radius).toBe(radius);
    expect(st.shadow).not.toBe('none');
    expect(st.z).toBe('auto');
    // The one shadow system: the tab's resolved shadow IS the token's value
    // (same colour and softness family as the page's --mm-page-shadow,
    // issue #349 — E605 pins the alpha match).
    expect(st.shadow).toBe(tabShadow);
  }
  const activeStyle = tabStyles.find((st) => st.active)!;
  const activeBg = channels(activeStyle.bg);
  expect(activeBg).toEqual(pageBg);
  expect(activeBg).not.toEqual(stripBg);
  for (const st of tabStyles.filter((t) => !t.active)) expect(channels(st.bg)).toEqual(stripBg);

  // The join: every tab is one box — same top, same bottom, reaching 1px
  // past the page's top edge onto its hairline row (E268 / E349's one-row
  // contract holds). On that row the ACTIVE tab is what paints
  // (elementFromPoint under its centre is the tab), with no bottom border
  // and the page's opaque colour — the hairline is broken there; an
  // inactive tab's 1px --mm-border bottom edge (asserted above) is the
  // hairline continuing under it.
  const seam = await page.evaluate(() => {
    const pageTop = document.querySelector('.workspace-stack > .workspace')!.getBoundingClientRect().top;
    const a = document.querySelector('.file-tab.active')!;
    const i = document.querySelector('.file-tab:not(.active)')!;
    const ar = a.getBoundingClientRect();
    const ir = i.getBoundingClientRect();
    const underActive = document.elementFromPoint((ar.left + ar.right) / 2, pageTop + 0.5);
    return {
      activeOverhang: ar.bottom - pageTop,
      inactiveOverhang: ir.bottom - pageTop,
      topsAligned: Math.abs(ar.top - ir.top),
      heightsEqual: Math.abs(ar.height - ir.height),
      activePaintsSeam: underActive !== null && a.contains(underActive),
      activeOpaque: getComputedStyle(a).backgroundColor,
    };
  });
  expect(Math.abs(seam.activeOverhang - 1)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(seam.inactiveOverhang - 1)).toBeLessThanOrEqual(0.5);
  expect(seam.topsAligned).toBeLessThanOrEqual(0.5);
  expect(seam.heightsEqual).toBeLessThanOrEqual(0.5);
  expect(seam.activePaintsSeam).toBe(true);
  expect(seam.activeOpaque).not.toMatch(/rgba\(.*, 0\)$/);

  // Inactive pills hover through --mm-hover; the active tab does not change.
  const hoverBg = channels(await colorTokenOf(page, '--mm-hover'));
  await inactive.first().hover();
  expect(channels(await bgOf(inactive.first()))).toEqual(hoverBg);
  await active.hover();
  expect(channels(await bgOf(active))).toEqual(pageBg);
  await page.mouse.move(0, 0);
}

test('E353: PRD 025 Reqs 6, 17–18 as amended by issue #340 — from computed styles: the strip band is flat ground with no shadow or radius, the page proper below it is rounded, shadowed and outlined 1px on four sides, every tab is outlined and shadowed on the page\'s plane, and the active tab has the page\'s fill and breaks its top hairline', async ({
  page,
}) => {
  await openThree(page);
  await assertPageAndTabs(page);
});

test('E306: the page-and-tabs treatment holds in a dark theme — ground / page contrast under One Dark, the active tab still the page surface, tabs outlined in the theme\'s border and shadowed, the page outlined and shadowed', async ({
  page,
}) => {
  await openThree(page);
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('crisp');
  await page.getByTestId('settings-theme-dark').selectOption('one-dark');
  const useDark = page.getByTestId('use-dark-theme');
  if (!(await useDark.isChecked())) await useDark.check();
  await saveSettings(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() => bgOf(page.locator('.theme-root')))
    .toBe('rgb(40, 44, 52)'); // One Dark #282c34
  await assertPageAndTabs(page);
});

// ---- PRD 025 Reqs 1–9 (issue #331): the centred page, from geometry.

const rectOf = (loc: Locator) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    // Issue #339 (E594): the vertical fields too — the pane's top and height
    // are read against the page's and the strip's.
    return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom, height: r.height };
  });

/** `max(var(--mm-content-width), var(--mm-pane-min))` in px, resolved by
 *  the browser from the theme root's live custom properties (the 46rem
 *  fallback included) through a probe box — never hardcoded. */
const pagePaneWidth = (page: Page) =>
  page.locator('.theme-root').evaluate((el) => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.width = 'max(var(--mm-content-width, 46rem), var(--mm-pane-min))';
    el.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return Math.round(w);
  });

/** The page's inner width: its client box less its own horizontal padding. */
const pageInnerWidth = (page: Page) =>
  page.locator('.workspace-stack').evaluate((el) => {
    const s = getComputedStyle(el);
    return Math.round(el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight));
  });

const ensureEditMode = async (page: Page) => {
  if ((await page.locator('.cm-content').count()) === 0) await page.keyboard.press('Control+e');
  await expect(page.locator('.cm-content')).toBeVisible();
};

test('E583: PRD 025 Reqs 2, 8, 10–11 (issue #331) — at 1800px the ground left of the sidebar equals the ground right of the comments column, both panes hug the page, and the sidebar alone centres with the page the same way', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openThree(page);
  await page.getByTestId('comments-expand').click();
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  const body = page.locator('.body-row');
  const stack = page.locator('.workspace-stack');
  const folder = page.locator('.folder-wrap');
  const comments = page.locator('.comments-wrap');

  // Both panes: equal ground outside the cluster, none inside it.
  await expect
    .poll(async () => {
      const [b, f, c] = await Promise.all([rectOf(body), rectOf(folder), rectOf(comments)]);
      return Math.abs(f.left - b.left - (b.right - c.right));
    })
    .toBeLessThanOrEqual(1);
  const [b, f, s, c] = await Promise.all([rectOf(body), rectOf(folder), rectOf(stack), rectOf(comments)]);
  expect(f.left - b.left).toBeGreaterThan(0);
  expect(Math.abs(f.right - s.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(s.right - c.left)).toBeLessThanOrEqual(1);

  // One pane: the sidebar + page pair is the cluster, centred by the same rule.
  await page.getByTestId('comments-collapse').click();
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect
    .poll(async () => {
      const [b2, f2, s2] = await Promise.all([rectOf(body), rectOf(folder), rectOf(stack)]);
      return Math.abs(f2.left - b2.left - (b2.right - s2.right));
    })
    .toBeLessThanOrEqual(1);
  const [b2, f2, s2] = await Promise.all([rectOf(body), rectOf(folder), rectOf(stack)]);
  expect(f2.left - b2.left).toBeGreaterThan(0);
  expect(Math.abs(f2.right - s2.left)).toBeLessThanOrEqual(1);
});

test('E584: PRD 025 Reqs 3–5 (issue #331) — the page\'s inner width is max(content-width, pane-min) editor-only, twice that plus the measured divider with the preview open, and follows the Margins setting live', async ({
  page,
}) => {
  // Wide enough for sidebar + two 76rem panes (the seeded super-narrow Margins).
  await page.setViewportSize({ width: 3200, height: 900 });
  await openThree(page);
  await ensureEditMode(page);

  // Preview open (whichever state the split chevron starts in): two panes
  // plus the divider's flow width, measured.
  if ((await page.getByTestId('preview-expand').count()) > 0) await page.getByTestId('preview-expand').click();
  await expect(page.locator('.split-divider')).toBeVisible();
  const dividerWidth = await page.locator('.split-divider').evaluate((el) => {
    const s = getComputedStyle(el);
    return el.getBoundingClientRect().width + parseFloat(s.marginLeft) + parseFloat(s.marginRight);
  });
  await expect
    .poll(() => pageInnerWidth(page))
    .toBe(Math.round(2 * (await pagePaneWidth(page)) + dividerWidth));

  // Editor-only: exactly one pane of content.
  await page.getByTestId('preview-collapse').click();
  await expect(page.locator('.split-divider')).toHaveCount(0);
  await expect.poll(() => pageInnerWidth(page)).toBe(await pagePaneWidth(page));

  // Margins: super-narrow (76rem) lifts the page above the pane floor…
  await openSettings(page);
  await page.getByTestId('settings-margins').selectOption('super-narrow');
  await saveSettings(page);
  const superNarrow = await pagePaneWidth(page);
  await expect.poll(() => pageInnerWidth(page)).toBe(superNarrow);
  // …and wide (38rem) drops it back — never below the --mm-pane-min floor
  // (the seeded paneMinWidth is small, so the column wins here; the probe's
  // max() is what the page must equal either way).
  await openSettings(page);
  await page.getByTestId('settings-margins').selectOption('wide');
  await saveSettings(page);
  const wide = await pagePaneWidth(page);
  expect(wide).toBeLessThan(superNarrow);
  expect(wide).toBeGreaterThanOrEqual(Math.round(parseFloat(await tokenOf(page, '--mm-pane-min'))));
  await expect.poll(() => pageInnerWidth(page)).toBe(wide);
});

test('E585: PRD 025 Reqs 6, 9 (issue #331; Req 6 amended by issue #340; Req 7 withdrawn by issue #348) — both panes closed at 1800px the page column is centred with equal ground either side and the page proper keeps its radius, shadow and four-sided 1px outline; reopening the sidebar changes none of that within two frames, with no transition on the page or the wrappers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openThree(page);
  const body = page.locator('.body-row');
  const stack = page.locator('.workspace-stack');
  const pageProper = page.locator('.workspace-stack > .workspace');
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);

  // Req 8 as amended by issue #348: zero panes is the same rule as one or
  // two — the column is capped at --mm-page-w and centred, ground either side.
  await expect
    .poll(async () => {
      const [b, s] = await Promise.all([rectOf(body), rectOf(stack)]);
      return Math.abs(s.left - b.left - (b.right - s.right));
    })
    .toBeLessThanOrEqual(1);
  const [b, s] = await Promise.all([rectOf(body), rectOf(stack)]);
  expect(s.left - b.left).toBeGreaterThan(0);
  // Req 7 withdrawn: the page proper carries the pane-open treatment — the
  // tabs' radius on its top corners, the shadow, and 1px on four sides.
  const radius = await tokenOf(page, '--mm-radius-small');
  const closed = await pageProper.evaluate(sheetOf);
  expect(closed.radius).toBe(`${radius} ${radius} 0px 0px`);
  expect(closed.shadow).not.toBe('none');
  expect(closed.widths).toEqual(['1px', '1px', '1px', '1px']);
  // The column never carries the treatment itself, in either state.
  expect(await stack.evaluate(sheetOf)).toEqual(flatSheet);

  // Reopen: two frames after the click the treatment is exactly what it was —
  // no transition anywhere on the page or its wrappers (Req 9).
  const after = await page.evaluate(async () => {
    (document.querySelector('[data-testid="folder-expand"]') as HTMLElement).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const read = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const st = getComputedStyle(el);
      return { duration: st.transitionDuration, transform: st.transform, willChange: st.willChange };
    };
    const st = getComputedStyle(document.querySelector('.workspace-stack > .workspace')!);
    return {
      radius: st.borderTopLeftRadius,
      shadow: st.boxShadow,
      widths: [st.borderTopWidth, st.borderRightWidth, st.borderBottomWidth, st.borderLeftWidth],
      motion: {
        stack: read('.workspace-stack'),
        page: read('.workspace-stack > .workspace'),
        body: read('.body-row'),
        folder: read('.folder-wrap'),
      },
    };
  });
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  expect(after.radius).toBe(radius);
  expect(after.shadow).toBe(closed.shadow);
  expect(after.widths).toEqual(['1px', '1px', '1px', '1px']);
  const still = { duration: '0s', transform: 'none', willChange: 'auto' };
  expect(after.motion).toEqual({ stack: still, page: still, body: still, folder: still });
  expect(await stack.evaluate(sheetOf)).toEqual(flatSheet);
});

test('E589: issue #340 point A from geometry — the page\'s shadowed, outlined element starts exactly at the strip band\'s bottom edge and spans the column\'s width, the band and the column around it paint no shadow at their sides, and the page\'s outline is 1px on four sides with a pane open and with both panes closed alike (PRD 025 Req 7 withdrawn by issue #348)', async ({
  page,
}) => {
  await openThree(page);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  const geometry = () =>
    page.evaluate(() => {
      const strip = document.querySelector('[data-testid="file-tab-strip"]')!;
      const stack = document.querySelector('.workspace-stack')!;
      const sheet = document.querySelector('.workspace-stack > .workspace')!;
      const sr = strip.getBoundingClientRect();
      const kr = stack.getBoundingClientRect();
      const pr = sheet.getBoundingClientRect();
      const st = getComputedStyle(sheet);
      return {
        sheetTopMinusStripBottom: pr.top - sr.bottom,
        sheetLeftMinusStripLeft: pr.left - sr.left,
        sheetRightMinusStripRight: pr.right - sr.right,
        sheetBottomMinusStackBottom: pr.bottom - kr.bottom,
        stripShadow: getComputedStyle(strip).boxShadow,
        stackShadow: getComputedStyle(stack).boxShadow,
        sheetShadow: st.boxShadow,
        widths: [st.borderTopWidth, st.borderRightWidth, st.borderBottomWidth, st.borderLeftWidth],
      };
    });

  const open = await geometry();
  expect(Math.abs(open.sheetTopMinusStripBottom)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(open.sheetLeftMinusStripLeft)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(open.sheetRightMinusStripRight)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(open.sheetBottomMinusStackBottom)).toBeLessThanOrEqual(0.5);
  expect(open.stripShadow).toBe('none');
  expect(open.stackShadow).toBe('none');
  expect(open.sheetShadow).not.toBe('none');
  expect(open.widths).toEqual(['1px', '1px', '1px', '1px']);

  // Both panes closed (PRD 025 Req 7 withdrawn by issue #348): nothing goes.
  // The geometry, the shadow and the four-sided outline are the pane-open
  // ones; the band and the column around the page still paint no shadow.
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  const closed = await geometry();
  expect(Math.abs(closed.sheetTopMinusStripBottom)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(closed.sheetLeftMinusStripLeft)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(closed.sheetRightMinusStripRight)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(closed.sheetBottomMinusStackBottom)).toBeLessThanOrEqual(0.5);
  expect(closed.stripShadow).toBe('none');
  expect(closed.stackShadow).toBe('none');
  expect(closed.sheetShadow).toBe(open.sheetShadow);
  expect(closed.widths).toEqual(['1px', '1px', '1px', '1px']);
});

test('E595: PRD 025 Reqs 2, 7–8 as amended by issue #348 — collapsing a pane removes only the pane: at 2000px closing the sidebar, then the comments column, leaves the page column\'s width unchanged and re-centres it with equal ground either side; with both closed the page proper keeps its radius, shadow and four 1px borders, and the preview-open column is still the Req 4 width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 900 });
  await openThree(page);
  await ensureEditMode(page);
  // Editor-only first, whichever state the split chevron starts in.
  if ((await page.getByTestId('preview-collapse').count()) > 0) await page.getByTestId('preview-collapse').click();
  await expect(page.locator('.split-divider')).toHaveCount(0);
  const body = page.locator('.body-row');
  const stack = page.locator('.workspace-stack');
  const comments = page.locator('.comments-wrap');
  const pageProper = page.locator('.workspace-stack > .workspace');
  /** The column's width and the ground either side of it, in px. */
  const ground = async () => {
    const [b, s] = await Promise.all([rectOf(body), rectOf(stack)]);
    return { left: s.left - b.left, right: b.right - s.right, width: s.width };
  };
  const centred = async () => {
    await expect
      .poll(async () => {
        const g = await ground();
        return Math.abs(g.left - g.right);
      })
      .toBeLessThanOrEqual(1);
    const g = await ground();
    expect(g.left).toBeGreaterThan(0);
    return g;
  };

  // Sidebar open, comments closed: the column is at the Req 3 max.
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  const paneW = await pagePaneWidth(page);
  await expect.poll(() => pageInnerWidth(page)).toBe(paneW);
  const withSidebar = (await rectOf(stack)).width;

  // Close the sidebar: only the pane goes — same width, re-centred.
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  const noSidebar = await centred();
  expect(Math.abs(noSidebar.width - withSidebar)).toBeLessThanOrEqual(1);

  // Comments column open: hugs the page's right edge, the page's width unchanged…
  await page.getByTestId('comments-expand').click();
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect
    .poll(async () => {
      const [s, c] = await Promise.all([rectOf(stack), rectOf(comments)]);
      return Math.abs(s.right - c.left);
    })
    .toBeLessThanOrEqual(1);
  expect(Math.abs((await rectOf(stack)).width - withSidebar)).toBeLessThanOrEqual(1);
  // …and closed again: only the column goes — same width, re-centred.
  await page.getByTestId('comments-collapse').click();
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  const noPanes = await centred();
  expect(Math.abs(noPanes.width - withSidebar)).toBeLessThanOrEqual(1);

  // Both closed: the page proper's treatment is the pane-open one (Req 7
  // withdrawn) — the tabs' radius, the shadow, 1px on four sides; the column
  // itself paints nothing (issue #340).
  const radius = await tokenOf(page, '--mm-radius-small');
  const closed = await pageProper.evaluate(sheetOf);
  expect(closed.radius).toBe(`${radius} ${radius} 0px 0px`);
  expect(closed.shadow).not.toBe('none');
  expect(closed.widths).toEqual(['1px', '1px', '1px', '1px']);
  expect(await stack.evaluate(sheetOf)).toEqual(flatSheet);

  // Preview open with both panes closed: the Req 4 width, still centred. The
  // seeded Margins make one pane wider than half of 2000px, so a 2000px
  // window would shrink the doubled page to fit (Req 5); widen the window
  // past the max first so the cap itself is what is measured.
  await page.getByTestId('preview-expand').click();
  await expect(page.locator('.split-divider')).toBeVisible();
  const dividerWidth = await page.locator('.split-divider').evaluate((el) => {
    const st = getComputedStyle(el);
    return el.getBoundingClientRect().width + parseFloat(st.marginLeft) + parseFloat(st.marginRight);
  });
  const previewMax = Math.round(2 * paneW + dividerWidth);
  await page.setViewportSize({ width: Math.max(2000, previewMax + 400), height: 900 });
  await expect.poll(() => pageInnerWidth(page)).toBe(previewMax);
  await centred();
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
  await saveSettings(page);
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

// Issue #158: the closeFile hotkey — Mod+W closes the current FILE through
// the existing command, never the window or the app.
test('E308: issue #158 — Ctrl+W closes only the active file (neighbour activates, app keeps running); on the splash the chord is a silent no-op', async ({
  page,
}) => {
  await openThree(page);
  // The real chord, not a __mmDispatch: Chromium can swallow Ctrl+W, so the
  // press itself is what this test proves. If the shim ever stops delivering
  // it, the assertions below fail rather than pass on a synthetic event.
  await page.keyboard.press('Control+w');
  // Active c closed alone; tree-order neighbour b activated (SPEC36 §3.5),
  // a stayed open, no prompt (clean file), and the app is still running.
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect.poll(() => tabPaths(page)).toEqual(['/notes/sub/b.md', '/notes/a.md']);
  await expect(tab(page, '/notes/sub/b.md')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);

  // Walk the rest down: the last close lands on the in-workspace splash —
  // the same landing as the tab ✕ (E274), still no window close.
  await page.keyboard.press('Control+w');
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await page.keyboard.press('Control+w');
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);

  // On the splash the chord changes NOTHING: no quit walk (whose workspace/
  // dirty prompts would surface), no prompt, the window still alive and
  // responsive.
  await page.keyboard.press('Control+w');
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  // The quit walk's own prompts (SPEC12 §1.5) never surfaced either.
  await expect(page.getByTestId('ws-close-prompt')).toHaveCount(0);
  await expect(page.getByTestId('close-prompt')).toHaveCount(0);
  expect(page.isClosed()).toBe(false);
  // Still fully interactive: a fresh open works.
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
});

test('E579: PRD 025 Reqs 19–20 (issue #330) — the Edit/Preview toggle is the LAST member of the strip\'s control group, gone from the toolbar, and lands in .edge-cluster with the strip off', async ({
  page,
}) => {
  // freshApp left welcome.md open with the strip up.
  const strip = page.getByTestId('file-tab-strip');
  await expect(strip).toBeVisible();
  const trail = strip.locator('.file-tab-strip-trail');
  const toggle = trail.getByTestId('edit-toggle');
  await expect(toggle).toBeVisible();

  // Req 19: a quiet button like its neighbours, labelled for the mode a click
  // moves TO, carrying the hotkey hint and the tooltip the toolbar button had.
  await expect(toggle).toHaveClass(/\bbtn\b/);
  await expect(toggle).toHaveClass(/\bbtn-quiet\b/);
  await expect(toggle).toHaveClass(/\bbtn-sm\b/);
  await expect(toggle).not.toHaveClass(/\bon\b/);
  await expect(toggle).toHaveText(/Edit/);
  await expect(toggle.locator('kbd')).toHaveText(/E/);
  await expect(toggle).toHaveAttribute('title', /Toggle edit \/ preview/);

  /** A group's element children as test ids (class name when there is none), in DOM order. */
  const childIds = (group: Locator) =>
    group.evaluate((el) => Array.from(el.children).map((c) => (c as HTMLElement).dataset.testid ?? c.className));
  const expectLast = async () => {
    const ids = await childIds(trail);
    expect(ids[ids.length - 1]).toBe('edit-toggle');
    expect(ids.indexOf('mode-switch')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('mode-switch')).toBeLessThan(ids.indexOf('edit-toggle'));
    // The comments chevron, when present, sits immediately before the toggle.
    if (ids.includes('comments-expand')) expect(ids.indexOf('comments-expand')).toBe(ids.length - 2);
  };
  await expectLast();

  // Req 19: the toolbar renders no toggle — not even once revealed; the one
  // in the page is the one in the strip.
  await revealToolbar(page);
  await expect(page.getByTestId('toolbar-shell')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('.toolbar').getByTestId('edit-toggle')).toHaveCount(0);
  await expect(page.getByTestId('edit-toggle')).toHaveCount(1);
  await expect(page.getByTestId('menu-btn')).toBeVisible();
  await expect(page.getByTestId('docname')).toContainText('welcome.md');

  // Behaviour unchanged: a click mounts the editor, the label flips to
  // Preview and the button reads `on` — and it is still the group's last
  // member with the preview chevron now in the row.
  await toggle.click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(toggle).toHaveText(/Preview/);
  await expect(toggle).toHaveClass(/\bon\b/);
  await expectLast();
  await toggle.click();
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(toggle).toHaveText(/Edit/);

  // Req 20: strip off ⇒ the same node lands in the .edge-cluster pill at the
  // page's top-right — visible, inside the pill's box, and still toggling.
  await toggleFileTabsViaSettings(page);
  await expect(strip).toHaveCount(0);
  const edge = page.locator('.edge-cluster');
  const edgeToggle = edge.getByTestId('edit-toggle');
  await expect(edgeToggle).toBeVisible();
  await expect(page.getByTestId('edit-toggle')).toHaveCount(1);
  await expect(edge.getByTestId('mode-switch')).toBeVisible();
  const ids = await childIds(edge);
  expect(ids[ids.length - 1]).toBe('edit-toggle');
  const pill = (await edge.boundingBox())!;
  const btn = (await edgeToggle.boundingBox())!;
  expect(btn.x).toBeGreaterThanOrEqual(pill.x - 0.5);
  expect(btn.x + btn.width).toBeLessThanOrEqual(pill.x + pill.width + 0.5);
  expect(btn.y).toBeGreaterThanOrEqual(pill.y - 0.5);
  expect(btn.y + btn.height).toBeLessThanOrEqual(pill.y + pill.height + 0.5);
  // The pill hugs the PAGE COLUMN's right edge, like the header inset it
  // keeps — PRD 025 Req 21 (Req 7 withdrawn by issue #348: with both panes
  // closed the column is centred, so the page's edge is not the window's).
  const column = (await page.locator('.workspace-stack').boundingBox())!;
  expect(Math.abs(pill.x + pill.width - (column.x + column.width))).toBeLessThanOrEqual(1);

  await edgeToggle.click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(edgeToggle).toHaveText(/Preview/);
  await expect(edgeToggle).toHaveClass(/\bon\b/);
  await expect(edgeToggle).toBeVisible();
  await edgeToggle.click();
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect(edgeToggle).toHaveText(/Edit/);
});

test('E594: issue #339 (PRD 025 Req 11 amended) — the comments pane\'s scroll box starts at the page\'s top edge: level with the page proper and the strip\'s bottom in full preview, split edit and plain edit, its height the body row\'s minus the band\'s, the band above it plain ground; strip hidden, pane, page and body row share one top', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openThree(page);
  await page.getByTestId('comments-expand').click();
  const pane = page.getByTestId('comments-pane');
  await expect(pane).toBeVisible();
  const body = page.locator('.body-row');
  const strip = page.getByTestId('file-tab-strip');
  const wrap = page.locator('.comments-wrap');
  // The page proper — the element issue #340 gave the outline, radius and
  // shadow; its top edge is the document scroller's top in every mode.
  const pageProper = page.locator('.workspace-stack > .workspace');
  await expect(strip).toBeVisible();

  // The one ask: the pane's top IS the page's top IS the strip's bottom.
  // Polled — layout settles a frame after the pane mounts (the E5xx idiom).
  const assertLevel = async () => {
    await expect
      .poll(async () => {
        const [p, w, s] = await Promise.all([rectOf(pane), rectOf(pageProper), rectOf(strip)]);
        return Math.max(Math.abs(p.top - w.top), Math.abs(p.top - s.bottom));
      })
      .toBeLessThanOrEqual(1);
    // …and it is the wrapper's band-high top padding that lands it there:
    // the wrapper still spans the body row's full height (E583's cluster
    // read), the pane is exactly the row minus everything above the strip's
    // bottom — the band, plus the strip's own toolbar clearance where a
    // static toolbar exists (the shim's default), never a pixel higher.
    const [p, b, s, w] = await Promise.all([rectOf(pane), rectOf(body), rectOf(strip), rectOf(wrap)]);
    expect(Math.abs(w.top - b.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(w.height - b.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.height - (b.bottom - s.bottom))).toBeLessThanOrEqual(1);
    expect(Math.abs(p.bottom - b.bottom)).toBeLessThanOrEqual(1);
  };
  await assertLevel();

  // The pane is the scroll box, with no inner clearance while the strip
  // shows (the toolbar clearance, where a static toolbar exists, rides the
  // wrapper's padding outside the box), and nothing between it and the
  // body row scrolls — so its scrollbar runs from the page's top down.
  expect(await pane.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  expect(await pane.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('0px');
  expect(await wrap.evaluate((el) => getComputedStyle(el).overflowY)).toBe('hidden');
  const bandPx = await page
    .locator('.theme-root')
    .evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--mm-tabstrip-h')));
  expect((await rectOf(strip)).height).toBe(bandPx);

  // The band-high region above the pane is ground: whatever paints there
  // has the body row's own background, and no shadow, edge or radius.
  const groundColour = await body.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [paneRect, stripRect] = await Promise.all([rectOf(pane), rectOf(strip)]);
  const above = await page.evaluate(
    ([x, y]) => {
      let el = document.elementFromPoint(x, y);
      while (el && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)') el = el.parentElement;
      if (!el) return null;
      const st = getComputedStyle(el);
      return {
        className: el.className,
        background: st.backgroundColor,
        shadow: st.boxShadow,
        radius: st.borderRadius,
        border: [st.borderTopWidth, st.borderBottomWidth],
      };
    },
    [paneRect.left + paneRect.width / 2, paneRect.top - stripRect.height / 2] as [number, number]
  );
  expect(above).toEqual({
    className: 'comments-wrap',
    background: groundColour,
    shadow: 'none',
    radius: '0px',
    border: ['0px', '0px'],
  });
  expect(await strip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(groundColour);

  // Split edit: the document scrollers are inside the page; the page's top
  // edge is still the reference and the pane still meets it.
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(pane).toBeVisible();
  await assertLevel();

  // Plain edit too.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect(pane).toBeVisible();
  await assertLevel();

  // Strip hidden: no band, so no spacer — pane, page and body row share one
  // top, and the pane mirrors whatever inner clearance the document scroller
  // keeps (the static toolbar's, where one exists; none otherwise).
  await toggleFileTabsViaSettings(page);
  await expect(strip).toHaveCount(0);
  await expect(body).not.toHaveClass(/with-tabs/);
  await expect(pane).toBeVisible();
  await expect
    .poll(async () => {
      const [p, w, b] = await Promise.all([rectOf(pane), rectOf(pageProper), rectOf(body)]);
      return Math.max(Math.abs(p.top - w.top), Math.abs(p.top - b.top));
    })
    .toBeLessThanOrEqual(1);
  const [paneClear, docClear] = await Promise.all([
    pane.evaluate((el) => getComputedStyle(el).paddingTop),
    pageProper.evaluate((el) => getComputedStyle(el).paddingTop),
  ]);
  expect(paneClear).toBe(docClear);
  expect(await wrap.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('0px');
});

// ---- Issue #349: the shadow split — the toolbar takes the wide panel
// geometry, the page casts a tighter, fainter shadow of its own, and the
// page's rounded top-right corner and right-hand shadow are no longer
// painted over by the scroller's gutter or the comments column.

test('E605: SPEC4 §2.4 and PRD 025 Req 6 as amended by issue #349 — the toolbar casts the panel shadow\'s 24px/2px geometry downward, the page proper casts its own tighter and fainter --mm-page-shadow (blur ≤ 12px, no spread, alpha ≤ 0.09) that the tabs follow, --mm-panel-shadow and the comment-nav pill are unchanged, the page\'s top-right corner reads rounded with the scrollbar present, and its shadow shows on the ground right of the page beside the open comments column', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 900 });
  await seedFolders(page);
  // A document tall enough that the page proper — the scroller — grows its
  // vertical bar, so the corner check runs with the gutter present.
  await fsWrite(page, '/notes/long.md', `# Long\n\n${'A paragraph of body text.\n\n'.repeat(120)}`);
  await openNotesRoot(page);
  await page.locator('[data-path="/notes/long.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('long.md');
  await landInPreview(page);
  await openCommentsPane(page);
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  const pageProper = page.locator('.workspace-stack > .workspace');
  await expect.poll(() => pageProper.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await pageProper.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  await expect(page.locator('.theme-root')).toHaveClass(/autohide-scrollbars/);

  // A. Shadow B — the toolbar: the panel token's blur and spread, cast down.
  const panelToken = await shadowTokenOf(page, '--mm-panel-shadow');
  expect(panelToken).toBe('rgba(0, 0, 0, 0.14) 0px 0px 24px 2px');
  const panel = parseShadow(panelToken);
  const toolbar = parseShadow(await page.locator('.toolbar').evaluate((el) => getComputedStyle(el).boxShadow));
  expect(toolbar.blur).toBe(panel.blur);
  expect(toolbar.spread).toBe(panel.spread);
  expect(toolbar.y).toBeGreaterThanOrEqual(2);
  expect(toolbar.alpha).toBeGreaterThanOrEqual(0.08);
  expect(toolbar.alpha).toBeLessThanOrEqual(0.14);
  // The comment navigator pill keeps yesterday's faint shadow — its own token now.
  expect(await page.locator('.comment-nav').evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
    'rgba(0, 0, 0, 0.08) 0px 2px 10px 0px'
  );

  // B. Shadow A — the page proper: its own token, tighter and fainter.
  const pageToken = await shadowTokenOf(page, '--mm-page-shadow');
  expect(pageToken).not.toBe('none');
  const pageShadowRaw = await pageProper.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(pageShadowRaw).toBe(pageToken);
  const pageShadow = parseShadow(pageShadowRaw);
  expect(pageShadow.blur).toBeLessThanOrEqual(12);
  expect(pageShadow.spread).toBe(0);
  expect(pageShadow.alpha).toBeLessThanOrEqual(0.09);
  // The tabs cast the page's shadow at tab scale: same alpha, no wider, no spread.
  const tabShadow = parseShadow(await shadowTokenOf(page, '--mm-tab-shadow'));
  expect(tabShadow.alpha).toBe(pageShadow.alpha);
  expect(tabShadow.rgb).toEqual(pageShadow.rgb);
  expect(tabShadow.blur).toBeLessThanOrEqual(pageShadow.blur);
  expect(tabShadow.spread).toBe(0);
  for (const s of await page.locator('.file-tab').evaluateAll((els) => els.map((el) => getComputedStyle(el).boxShadow)))
    expect(s).not.toBe('none');

  // C. The top-right corner reads rounded like the top-left with the bar
  // present: the page keeps its radius, and the pixel at the corner of its
  // box — outside the arc — is the ground (darkened only by the page's own
  // faint shadow), not the page's fill and not a scrollbar colour; the same
  // read as the top-left corner.
  const radius = await tokenOf(page, '--mm-radius-small');
  expect(await pageProper.evaluate((el) => getComputedStyle(el).borderTopRightRadius)).toBe(radius);
  const ground = channels(await bgOf(page.locator('.body-row')));
  const fill = channels(await bgOf(pageProper));
  expect(fill).not.toEqual(ground);
  const r = await rectOf(pageProper);
  const topRight = await pixelAt(page, r.right - 1, r.top);
  const topLeft = await pixelAt(page, r.left, r.top);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(topRight[i] - topLeft[i])).toBeLessThanOrEqual(8);
    expect(topRight[i]).toBeLessThanOrEqual(ground[i]);
    expect(topRight[i]).toBeGreaterThanOrEqual(ground[i] - 24);
    expect(topLeft[i]).toBeLessThanOrEqual(ground[i]);
  }
  expect(topRight).not.toEqual(fill);

  // The page's shadow falls on the ground to the RIGHT beside the comments
  // column as it does on the left beside the sidebar: the pixel 3px out from
  // either edge at mid-height is darker than the flat ground by the same
  // amount — the comments pane no longer paints a fill of its own over it.
  const midY = r.top + r.height / 2;
  const rightOut = await pixelAt(page, r.right + 2, midY);
  const leftOut = await pixelAt(page, r.left - 3, midY);
  const darkerRight = ground[1] - rightOut[1];
  const darkerLeft = ground[1] - leftOut[1];
  expect(darkerLeft).toBeGreaterThanOrEqual(2);
  expect(darkerRight).toBeGreaterThanOrEqual(darkerLeft - 1);
  // The band above the corner stays flat (issue #340): no shadow on the
  // strip, the column or the pane wrappers.
  for (const sel of ['[data-testid="file-tab-strip"]', '.workspace-stack', '.folder-wrap', '.comments-wrap']) {
    expect(await page.locator(sel).evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  }
});
