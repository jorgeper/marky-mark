import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { editorTopGutterLine, freshApp, fsRead, fsWrite, openFolderRoot, seedFolders } from './helpers';

// PRD 014 (issue #151): the Search view of the sidebar — the third, mutually
// exclusive occupant of the PRD 012 pane. Reqs 1–2: the switch button and the
// view round trip that loses no folder or TOC state. Reqs 4–5: the folder-tree
// scope (dotfiles and non-markdown excluded, unsaved buffers searched in
// memory, the no-roots message). Req 7: debounced live results grouped by
// file, counts, highlighted line context, collapsible groups. Req 8:
// click-to-open landing on the match without losing the result list.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

/** The searchable tree E272–E275 build on top of seedFolders' /notes. */
const seedSearchTree = async (page: Page) => {
  await seedFolders(page);
  await fsWrite(page, '/notes/apple.md', 'a line with cherry\nplain second line\ncherry and cherry again\n');
  await fsWrite(page, '/notes/cherry.md', 'nothing here\n');
};

const searchFor = async (page: Page, query: string) => {
  await page.getByTestId('search-input').fill(query);
};

test('E272: the Search view — the third switch button, one view at a time, and a round trip that loses no folder or TOC state', async ({
  page,
}) => {
  await seedFolders(page);
  await fsWrite(page, '/notes/tree.md', '# Alpha\n\nalpha body\n\n## Child\n\nchild body\n');
  await openFolderRoot(page);

  // PRD 014 Req 2: the button sits beside the other two with the same
  // semantics — its own testid, aria-pressed/data-active/title.
  const searchBtn = page.getByTestId('sidebar-view-search');
  await expect(searchBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(searchBtn).toHaveAttribute('data-active', 'false');
  await expect(searchBtn).toHaveAttribute('title', /search/i);

  // Folder state to carry through the round trip: an expanded directory and
  // a selected (open) file.
  await page.locator('[data-path="/notes/sub"]').click();
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();
  await page.locator('[data-path="/notes/tree.md"]').click();
  await expect(page.locator('.folder-item.selected[data-path="/notes/tree.md"]')).toBeVisible();

  // PRD 014 Req 2: pressing it while another view shows swaps to Search —
  // exactly one view renders — and the query box takes focus.
  await searchBtn.click();
  await expect(page.getByTestId('search-panel')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-search')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('search-input')).toBeFocused();

  // PRD 014 Req 1: back to Folders — roots, expansion and selection intact,
  // nothing re-fetched or reset by the round trip.
  await page.getByTestId('sidebar-view-folders').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();
  await expect(page.locator('.folder-item.selected[data-path="/notes/tree.md"]')).toBeVisible();

  // And the TOC's state survives the same trip: collapse Alpha, visit Search,
  // come back — still collapsed.
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-item')).toHaveCount(2);
  await page.getByTestId('toc-twisty').click();
  await expect(page.getByTestId('toc-item')).toHaveCount(1);
  await page.getByTestId('sidebar-view-search').click();
  await expect(page.getByTestId('search-panel')).toBeVisible();
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-item')).toHaveCount(1);

  // PRD 014 Req 2: pressing Search while Search is showing hides the sidebar.
  await page.getByTestId('sidebar-view-search').click();
  await expect(page.getByTestId('search-panel')).toBeVisible();
  await page.getByTestId('sidebar-view-search').click();
  await expect(page.getByTestId('search-panel')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-search')).toHaveAttribute('aria-pressed', 'false');
});

test('E273: a query scans the folder tree — grouped by file, filename matches first, counts and highlighted context; dotfiles and non-markdown never match', async ({
  page,
}) => {
  await seedSearchTree(page);
  await openFolderRoot(page);
  await page.getByTestId('sidebar-view-search').click();

  // PRD 014 Req 7: grouped by file — the filename match (cherry.md, a group
  // with 0 content matches) lists before the content matches, each group
  // carrying its per-file count.
  await searchFor(page, 'cherry');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  const groups = page.getByTestId('search-file');
  await expect(groups.nth(0)).toHaveAttribute('data-path', '/notes/cherry.md');
  await expect(groups.nth(0)).toHaveAttribute('data-name-match', 'true');
  await expect(groups.nth(0).getByTestId('search-file-count')).toHaveText('0');
  await expect(groups.nth(1)).toHaveAttribute('data-path', '/notes/apple.md');
  await expect(groups.nth(1).getByTestId('search-file-count')).toHaveText('3');
  // Two hits on one line are two rows; every row highlights its hit in context.
  await expect(page.getByTestId('search-match')).toHaveCount(3);
  await expect(page.getByTestId('search-match').nth(0)).toContainText('a line with cherry');
  await expect(page.getByTestId('search-match').nth(0).locator('mark')).toHaveText('cherry');

  // PRD 014 Req 7: a group collapses with the folder rows' disclosure and the
  // state survives while the query is unchanged — a view round trip included.
  await page.getByTestId('search-twisty').click();
  await expect(page.getByTestId('search-match')).toHaveCount(0);
  await page.getByTestId('sidebar-view-folders').click();
  await page.getByTestId('sidebar-view-search').click();
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  await expect(page.getByTestId('search-match')).toHaveCount(0); // still collapsed
  await page.getByTestId('search-twisty').click();
  await expect(page.getByTestId('search-match')).toHaveCount(3); // expanded again

  // PRD 014 Req 4: non-markdown files are never read — their content finds
  // nothing ('binary-ish' lives only in pic.png, 'plain second line' matches
  // apple.md but zzz.txt's 'plain' body never joins it) — and the dot-dir's
  // secret.md ('# no') is invisible to the scan.
  await searchFor(page, 'binary-ish');
  await expect(page.getByTestId('search-file')).toHaveCount(0);
  await searchFor(page, 'plain');
  await expect(page.getByTestId('search-file')).toHaveCount(1);
  await expect(page.getByTestId('search-file')).toHaveAttribute('data-path', '/notes/apple.md');
  await searchFor(page, '# no');
  await expect(page.getByTestId('search-file')).toHaveCount(0);
});

test('E274: unsaved edits are searched in memory — active and parked buffers alike — and deleted-but-unsaved text is not found', async ({
  page,
}) => {
  await seedSearchTree(page);
  await fsWrite(page, '/notes/vanish.md', 'the vanishing line\n');
  await openFolderRoot(page);

  // Open vanish.md and replace its whole text WITHOUT saving.
  await page.locator('[data-path="/notes/vanish.md"]').click();
  await expect(page.getByTestId('doc')).toContainText('vanishing');
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('replaced cherrynew content');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // PRD 014 Req 5: the ACTIVE buffer's unsaved text is findable…
  await page.getByTestId('sidebar-view-search').click();
  await searchFor(page, 'cherrynew');
  await expect(page.getByTestId('search-file')).toHaveCount(1);
  await expect(page.getByTestId('search-file')).toHaveAttribute('data-path', '/notes/vanish.md');
  // …and the deleted-but-unsaved text is NOT, even though the disk still has it.
  await searchFor(page, 'vanishing');
  await expect(page.getByTestId('search-file')).toHaveCount(0);
  await expect(page.getByTestId('search-input')).toHaveValue('vanishing');

  // Park vanish.md behind another file: its PARKED buffer answers the same way.
  await page.getByTestId('sidebar-view-folders').click();
  await page.locator('[data-path="/notes/apple.md"]').click();
  await expect(page.locator('.folder-item.selected[data-path="/notes/apple.md"]')).toBeVisible();
  await page.getByTestId('sidebar-view-search').click();
  await searchFor(page, 'cherrynew');
  await expect(page.getByTestId('search-file')).toHaveCount(1);
  await searchFor(page, 'vanishing');
  await expect(page.getByTestId('search-file')).toHaveCount(0);
});

test('E275: clicking a content match opens the file AT the match (preview and edit), and a filename match opens the file — the results never reset', async ({
  page,
}) => {
  await seedSearchTree(page);
  const LONG_DOC = [
    '# Long doc',
    '',
    ...Array.from({ length: 40 }, (_, i) => [`padding paragraph ${i + 1} sits here.`, '']).flat(),
    'The needleword sits in this paragraph.',
    '',
    // Long enough BELOW the match that the scroller can still put its block
    // at the viewport top — a match near the end cannot scroll that far.
    ...Array.from({ length: 30 }, (_, i) => [`trailing paragraph ${i + 1} sits here.`, '']).flat(),
  ].join('\n');
  const needleLine = LONG_DOC.split('\n').findIndex((l) => l.includes('needleword')) + 1;
  await fsWrite(page, '/notes/long.md', LONG_DOC);
  await openFolderRoot(page);
  await page.locator('[data-path="/notes/a.md"]').click(); // a DIFFERENT file is active
  await expect(page.getByTestId('doc')).toContainText('A doc');

  await page.getByTestId('sidebar-view-search').click();
  await searchFor(page, 'needleword');
  await expect(page.getByTestId('search-match')).toHaveCount(1);

  // PRD 014 Req 8: the click opens long.md and the preview lands on the
  // match's block (the SPEC16 anchor path — the block sits at the top).
  await page.getByTestId('search-match').click();
  await expect(page.getByTestId('doc')).toContainText('needleword');
  const deltaOf = (line: number) =>
    page.evaluate((l) => {
      const ws = document.querySelector('.workspace')!;
      const el = document.querySelector(`.doc [data-mm-line="${l}"]`);
      return el ? Math.abs(el.getBoundingClientRect().top - ws.getBoundingClientRect().top) : 1e6;
    }, needleLine);
  await expect.poll(() => deltaOf(needleLine)).toBeLessThan(120);

  // The Search view kept its query and its results across the open.
  await expect(page.getByTestId('search-panel')).toBeVisible();
  await expect(page.getByTestId('search-input')).toHaveValue('needleword');
  await expect(page.getByTestId('search-match')).toHaveCount(1);

  // PRD 014 Req 8, edit half: the same click in edit mode goes through the
  // editor handle — scrolled to the match's line with the hit selected.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('search-match').click();
  await expect.poll(() => editorTopGutterLine(page)).toBeGreaterThan(needleLine - 40);
  await expect(page.locator('.cm-line').filter({ hasText: 'needleword' })).toBeVisible();
  await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();

  // A FILENAME match's click opens that file; the results still stand.
  await searchFor(page, 'cherry');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  await page.locator('[data-testid="search-file"][data-path="/notes/cherry.md"]').click();
  await expect(page.getByTestId('editor')).toContainText('nothing here');
  await expect(page.getByTestId('search-panel')).toBeVisible();
  await expect(page.getByTestId('search-input')).toHaveValue('cherry');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
});

test('E276: with no folder root open the Search view says so plainly', async ({ page }) => {
  // PRD 007 Req 22's root-less state: a fresh local workspace with no folder.
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/w/empty.marky-workspace';
  });
  await page.getByTestId('start-newWorkspace').click();
  await expect(page.getByTestId('folder-add-btn')).toBeVisible();

  await page.getByTestId('sidebar-view-search').click();
  await expect(page.getByTestId('search-panel')).toBeVisible();
  // PRD 014 Req 4: a message the reader can act on, never an empty result list.
  await expect(page.getByTestId('search-no-roots')).toContainText('Open a folder');
  await expect(page.getByTestId('search-file')).toHaveCount(0);
});

test('E280: the searchAllFiles hotkey opens the sidebar on Search with the query box focused, hides it again — even from inside the box — and never crosses with Mod+F', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);
  // A document for Mod+F to act on: `find` is gated on an open document.
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.locator('.folder-item.selected[data-path="/notes/a.md"]')).toBeVisible();

  // PRD 014 Req 3: Mod+F keeps its `find` meaning — the in-document bar, not
  // the Search view.
  await page.keyboard.press('Control+F');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await expect(page.getByTestId('search-panel')).toHaveCount(0);
  await page.getByTestId('find-input').press('Escape');
  await expect(page.getByTestId('find-bar')).toHaveCount(0);

  // Sidebar hidden → the hotkey opens it in Search view with the query box
  // focused, and the in-document find bar never appeared.
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('search-panel')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-search')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('search-input')).toBeFocused();
  await expect(page.getByTestId('find-bar')).toHaveCount(0);

  // PRD 014 Req 3: showing Search → the sidebar hides, INCLUDING when focus
  // sits inside the query box — the listener runs in the capture phase.
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('search-panel')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-search')).toHaveAttribute('aria-pressed', 'false');

  // Exactly the button's action, from either surface: the button opens it and
  // the hotkey hides what the button opened.
  await page.getByTestId('sidebar-view-search').click();
  await expect(page.getByTestId('search-panel')).toBeVisible();
  // Past SPEC12 §1.3's exactly-once window first: button and hotkey dispatch
  // the SAME command id, so a keypress inside 150ms of the click is swallowed
  // as a duplicate arrival — which is itself the proof they are one action.
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('search-panel')).toHaveCount(0);
});

test('E281: with the folder tree showing, the hotkey switches the pane to Search in place, and Mod+Shift+E keeps its meaning', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);

  // Folder state worth losing: an expanded subdirectory and a selected file.
  await page.locator('[data-path="/notes/sub"]').click();
  const bRow = page.locator('[data-testid="folder-item"][data-path="/notes/sub/b.md"]');
  await expect(bRow).toBeVisible();
  await bRow.click();
  await expect(bRow).toHaveClass(/selected/);

  // PRD 014 Req 3: sidebar showing folders → the pane switches to Search in
  // place, query box focused.
  const folderBox = (await page.getByTestId('folder-panel').boundingBox())!;
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('search-panel')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('search-input')).toBeFocused();

  // …and it stays put: same edge, same width, and the closed pane's edge
  // chevron never appeared, so nothing slid.
  const searchBox = (await page.getByTestId('search-panel').boundingBox())!;
  expect(Math.round(searchBox.x)).toBe(Math.round(folderBox.x));
  expect(Math.round(searchBox.width)).toBe(Math.round(folderBox.width));
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);

  // Mod+Shift+E keeps its existing meaning — the folders route — and the tree
  // is exactly as it was left.
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('search-panel')).toHaveCount(0);
  await expect(bRow).toBeVisible();
  await expect(bRow).toHaveClass(/selected/);

  // From folders, the Search hotkey switches again; pressed on Search it
  // hides the pane, and the folders seam's chevron is back.
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('search-panel')).toBeVisible();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('search-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();
});

test('E282: with no workspace open the searchAllFiles hotkey is inert — nothing opens and nothing is written', async ({
  page,
}) => {
  // PRD 014 Req 3: the splash — no workspace, so the toggleSearch gate has
  // nothing to show. Issue #81: a hash-less launch lands here.
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('sidebar-view-search')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('search-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  // Inert means inert: nothing was opened and nothing was written.
  const seeded = JSON.parse((await fsRead(page, '/config/settings.json'))!);
  expect(seeded.showFolders).toBeUndefined();
  expect(seeded.sidebarView).toBeUndefined();
});
