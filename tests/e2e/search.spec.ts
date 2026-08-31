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

test('E339: the Search view — the third switch button, one view at a time, and a round trip that loses no folder or TOC state', async ({
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

test('E340: a query scans the folder tree — grouped by file, filename matches first, counts and highlighted context; dotfiles and non-markdown never match', async ({
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

test('E341: unsaved edits are searched in memory — active and parked buffers alike — and deleted-but-unsaved text is not found', async ({
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

test('E342: clicking a content match opens the file AT the match (preview and edit), and a filename match opens the file — the results never reset', async ({
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

test('E343: with no folder root open the Search view says so plainly', async ({ page }) => {
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

// PRD 014 Req 6 (issue #152): the query box's three toggles — case-sensitive,
// whole-word, regex — combine, re-run the current query live with no
// re-typing, and an invalid regex shows compileQuery's inline error while
// matching nothing (never a literal fallback).

/** The toggle tree E280–E283 build on top of seedFolders' /notes. */
const seedToggleTree = async (page: Page) => {
  await seedFolders(page);
  await fsWrite(page, '/notes/words.md', 'Cat sat\nconcatenate\ncut\n');
  await fsWrite(page, '/notes/case.md', 'CAT CALLED\n');
};

const openSearchView = async (page: Page) => {
  await openFolderRoot(page);
  await page.getByTestId('sidebar-view-search').click();
  await expect(page.getByTestId('search-panel')).toBeVisible();
};

test('E280: the case-sensitive toggle — pressed state, a changed multi-file result set, and a live re-run with no re-typing', async ({
  page,
}) => {
  await seedToggleTree(page);
  await openSearchView(page);

  // PRD 014 Req 6: three labelled toggles ride the query box, each with a
  // pressed state — and the default is all off.
  for (const id of ['search-opt-case', 'search-opt-word', 'search-opt-regex']) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId(id)).toHaveAttribute('data-active', 'false');
  }
  await expect(page.getByTestId('search-opt-case')).toHaveAttribute('aria-label', 'Match case');
  await expect(page.getByTestId('search-opt-word')).toHaveAttribute('aria-label', 'Whole word');
  await expect(page.getByTestId('search-opt-regex')).toHaveAttribute('aria-label', 'Regular expression');

  // All off = case-insensitive literal: 'cat' hits words.md (Cat, concatenate)
  // and case.md (CAT) — two files, three matches.
  await searchFor(page, 'cat');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  await expect(page.getByTestId('search-match')).toHaveCount(3);

  // PRD 014 Req 7 + Req 6: a toggle flip is a NEW query for the fold state
  // too, so collapse words.md first — the match counts below then only add up
  // if the flip re-expanded it, rather than carrying the stale fold over.
  await page
    .locator('[data-testid="search-file"][data-path="/notes/words.md"] [data-testid="search-twisty"]')
    .click();
  await expect(page.getByTestId('search-match')).toHaveCount(1);

  // One click — no re-typing, the input untouched — repaints the result set:
  // case-sensitive 'cat' leaves only 'concatenate', so case.md drops out.
  await page.getByTestId('search-opt-case').click();
  await expect(page.getByTestId('search-opt-case')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('search-opt-case')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('search-input')).toHaveValue('cat');
  await expect(page.getByTestId('search-file')).toHaveCount(1);
  await expect(page.getByTestId('search-file')).toHaveAttribute('data-path', '/notes/words.md');
  await expect(page.getByTestId('search-match')).toHaveCount(1);
  await expect(page.getByTestId('search-match').locator('mark')).toHaveText('cat');

  // Flipping it back restores the wider set — still the same typed query.
  await page.getByTestId('search-opt-case').click();
  await expect(page.getByTestId('search-opt-case')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  await expect(page.getByTestId('search-match')).toHaveCount(3);
});

test('E281: the whole-word toggle stops substring containment — and combined with case-sensitive the two apply as a conjunction', async ({
  page,
}) => {
  await seedToggleTree(page);
  await openSearchView(page);

  await searchFor(page, 'cat');
  await expect(page.getByTestId('search-match')).toHaveCount(3);

  // PRD 014 Req 6: whole-word 'cat' keeps the word hits (Cat, CAT) and drops
  // 'concatenate' — still case-insensitive, still both files.
  await page.getByTestId('search-opt-word').click();
  await expect(page.getByTestId('search-opt-word')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  await expect(page.getByTestId('search-match')).toHaveCount(2);
  // Both surviving hits are the standalone word, never the substring.
  for (const hit of await page.getByTestId('search-match').locator('mark').allTextContents()) {
    expect(hit.toLowerCase()).toBe('cat');
  }

  // PRD 014 Req 6: whole-word AND case-sensitive — no lowercase word 'cat'
  // exists anywhere, so the conjunction finds nothing at all.
  await page.getByTestId('search-opt-case').click();
  await expect(page.getByTestId('search-file')).toHaveCount(0);
  await expect(page.getByTestId('search-match')).toHaveCount(0);
  await expect(page.getByTestId('search-input')).toHaveValue('cat');
});

test('E282: the regex toggle compiles the pattern — c.t matches cat where literal mode does not — and case-sensitive regex combines', async ({
  page,
}) => {
  await seedToggleTree(page);
  await openSearchView(page);

  // Literal 'c.t' matches nothing: no file contains that exact text.
  await searchFor(page, 'c.t');
  await expect(page.getByTestId('search-file')).toHaveCount(0);

  // PRD 014 Req 6: regex on — the same typed query now matches Cat, the cat
  // inside concatenate, cut and CAT.
  await page.getByTestId('search-opt-regex').click();
  await expect(page.getByTestId('search-opt-regex')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  await expect(page.getByTestId('search-match')).toHaveCount(4);

  // PRD 014 Req 6: case-sensitive regex is the conjunction — the uppercase
  // hits (Cat, CAT) drop, the lowercase ones stay.
  await page.getByTestId('search-opt-case').click();
  await expect(page.getByTestId('search-file')).toHaveCount(1);
  await expect(page.getByTestId('search-file')).toHaveAttribute('data-path', '/notes/words.md');
  await expect(page.getByTestId('search-match')).toHaveCount(2);
});

test('E283: an invalid regex shows the inline error and matches NOTHING — no literal fallback — and correcting it (or regex off) recovers live', async ({
  page,
}) => {
  await seedToggleTree(page);
  // '[cherry' exists LITERALLY in this file — the proof that an invalid
  // pattern is never quietly re-run as a literal.
  await fsWrite(page, '/notes/brackets.md', 'pick [cherry today\n');
  await openSearchView(page);
  const pageErrors: Error[] = [];
  page.on('pageerror', (e) => pageErrors.push(e));

  // A valid regex query first, so the error state has results to clear.
  await page.getByTestId('search-opt-regex').click();
  await searchFor(page, 'c.t');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  await expect(page.getByTestId('search-error')).toHaveCount(0);

  // PRD 014 Req 6: '[cherry' is an invalid pattern — the inline error shows
  // (compileQuery's own message names the input), the previous results clear,
  // and the literal hit in brackets.md is NOT found: no fallback, no throw.
  await searchFor(page, '[cherry');
  await expect(page.getByTestId('search-error')).toBeVisible();
  await expect(page.getByTestId('search-error')).toContainText('[cherry');
  await expect(page.getByTestId('search-file')).toHaveCount(0);
  await expect(page.getByTestId('search-match')).toHaveCount(0);

  // Turning regex OFF clears the error and the same text matches literally.
  await page.getByTestId('search-opt-regex').click();
  await expect(page.getByTestId('search-error')).toHaveCount(0);
  await expect(page.getByTestId('search-file')).toHaveCount(1);
  await expect(page.getByTestId('search-file')).toHaveAttribute('data-path', '/notes/brackets.md');

  // Regex back on: invalid again. Correcting the pattern to '\[cherry'
  // clears the error and results return on the debounce path — no reload,
  // no re-focus, no extra keystroke beyond the edit itself.
  await page.getByTestId('search-opt-regex').click();
  await expect(page.getByTestId('search-error')).toBeVisible();
  await expect(page.getByTestId('search-file')).toHaveCount(0);
  await searchFor(page, '\\[cherry');
  await expect(page.getByTestId('search-error')).toHaveCount(0);
  await expect(page.getByTestId('search-file')).toHaveCount(1);
  await expect(page.getByTestId('search-match').locator('mark')).toHaveText('[cherry');

  // PRD 014 Req 6: nothing escaped to the page — the invalid state never threw.
  expect(pageErrors).toEqual([]);
});

// PRD 014 Req 3 (issue #155): the searchAllFiles hotkey (Mod+Shift+F) is the
// Search switch button's action from the keyboard — the same `toggleSearch`
// command id, so it shows, switches in place, focuses the query box and hides
// exactly as the button does, without crossing Mod+F's in-document find.

test('E284: the searchAllFiles hotkey opens the sidebar on Search with the query box focused, hides it again — even from inside the box — and never crosses with Mod+F', async ({
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

test('E285: with the folder tree showing, the hotkey switches the pane to Search in place, and Mod+Shift+E keeps its meaning', async ({
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

test('E286: with no workspace open the searchAllFiles hotkey is inert — nothing opens and nothing is written', async ({
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

// PRD 014 Req 9 (issue #153): scan state — the totals line while results
// exist, the loud no-results block for a query that matches nothing, the
// scanning indicator that clears on every settle path, and chunked scans that
// keep the UI responsive with supersession checked between chunks.

/** Seed `count` bulk files (each one 'needle' hit) plus one 'needle42' file. */
const seedBulkTree = async (page: Page, count: number) => {
  await seedFolders(page);
  await page.evaluate((n) => {
    for (let i = 0; i < n; i++) {
      window.__mmfs!.write(`/notes/bulk/n-${String(i).padStart(3, '0')}.md`, 'a needle sits here\n');
    }
    window.__mmfs!.write('/notes/bulk/special.md', 'the needle42 hit\n');
  }, count);
};

/** PRD 014 Req 9: make every readTextFile slow, so a scan is observably in flight. */
const setReadDelay = (page: Page, ms: number) =>
  page.evaluate((n) => {
    window.__mmfs!.readDelayMs = n;
  }, ms);

test('E287: while results exist the panel totals BOTH numbers — grammatical at 1, updating as the query narrows, absent with nothing to total', async ({
  page,
}) => {
  await seedSearchTree(page);
  await openSearchView(page);

  // PRD 014 Req 9: one element, both numbers — apple.md's 3 content matches
  // plus cherry.md's name-only hit make 3 matches across 2 files.
  await searchFor(page, 'cherry');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  await expect(page.getByTestId('search-totals')).toHaveText('3 matches in 2 files');

  // Narrowing the query updates the totals — and at 1 the wording is
  // grammatical ('1 match', '1 file' — never '1 files').
  await searchFor(page, 'cherry again');
  await expect(page.getByTestId('search-totals')).toHaveText('1 match in 1 file');

  // A name-only hit is a real result with 0 content matches.
  await searchFor(page, 'apple');
  await expect(page.getByTestId('search-totals')).toHaveText('0 matches in 1 file');

  // Nothing to total: an emptied query drops the totals with the results.
  await searchFor(page, '');
  await expect(page.getByTestId('search-totals')).toHaveCount(0);
  await expect(page.getByTestId('search-file')).toHaveCount(0);
});

test('E288: a query that matches nothing shows the LOUD no-results block naming the query — clearing when it matches again, never beside the inline error', async ({
  page,
}) => {
  await seedSearchTree(page);
  await openSearchView(page);

  // PRD 014 Req 9: a styled block naming the query, not a silently empty list
  // — and no totals, because there is nothing to total.
  await searchFor(page, 'xyzzy-nothing');
  await expect(page.getByTestId('search-no-results')).toBeVisible();
  await expect(page.getByTestId('search-no-results')).toContainText('xyzzy-nothing');
  await expect(page.getByTestId('search-file')).toHaveCount(0);
  await expect(page.getByTestId('search-totals')).toHaveCount(0);

  // A query that matches again clears the block and repaints results.
  await searchFor(page, 'cherry');
  await expect(page.getByTestId('search-file')).toHaveCount(2);
  await expect(page.getByTestId('search-no-results')).toHaveCount(0);

  // An invalid regex is the inline search-error's state ALONE — the two
  // never show at once (the literal '[cherry' text exists in no file, so
  // without the exclusion the block would claim this state).
  await page.getByTestId('search-opt-regex').click();
  await searchFor(page, '[cherry');
  await expect(page.getByTestId('search-error')).toBeVisible();
  await expect(page.getByTestId('search-no-results')).toHaveCount(0);

  // And an emptied query shows neither — nothing was searched.
  await searchFor(page, '');
  await expect(page.getByTestId('search-no-results')).toHaveCount(0);
  await expect(page.getByTestId('search-error')).toHaveCount(0);
});

test('E289: the scanning indicator shows while a scan is in flight and clears on every settle — results, no-results, an emptied query, an invalid regex', async ({
  page,
}) => {
  await seedBulkTree(page, 120);
  await openSearchView(page);
  await setReadDelay(page, 5); // ~120 slow reads: the scan is observably in flight

  // In flight → indicator up; settled on results → indicator gone, totals up.
  await searchFor(page, 'needle');
  await expect(page.getByTestId('search-scanning')).toBeVisible();
  await expect(page.getByTestId('search-scanning')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId('search-totals')).toContainText('matches in');

  // Settling on a NO-RESULTS outcome clears it too — the block never shows
  // while the scan is still in flight (the indicator owns that window).
  await searchFor(page, 'zqxwv-none');
  await expect(page.getByTestId('search-scanning')).toBeVisible();
  await expect(page.getByTestId('search-no-results')).toHaveCount(0);
  await expect(page.getByTestId('search-scanning')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId('search-no-results')).toBeVisible();

  // The query going EMPTY clears the indicator immediately — no waiting for
  // the abandoned scan to finish its reads.
  await searchFor(page, 'needle');
  await expect(page.getByTestId('search-scanning')).toBeVisible();
  await searchFor(page, '');
  await expect(page.getByTestId('search-scanning')).toHaveCount(0);
  await expect(page.getByTestId('search-totals')).toHaveCount(0);

  // An invalid regex mid-flight clears it the same way — the inline error
  // owns the panel, never a stuck spinner beside it.
  await page.getByTestId('search-opt-regex').click();
  await searchFor(page, 'needle');
  await expect(page.getByTestId('search-scanning')).toBeVisible();
  await searchFor(page, 'needle[');
  await expect(page.getByTestId('search-error')).toBeVisible();
  await expect(page.getByTestId('search-scanning')).toHaveCount(0);
});

test('E290: a large tree scan never blocks typing — keystrokes land while the indicator is up, and a superseded query\'s late results never paint over the newer one', async ({
  page,
}) => {
  await seedBulkTree(page, 200); // the ~200-file tree the sidebar's seams realistically hand back
  await openSearchView(page);
  await setReadDelay(page, 5);

  // Start a broad scan (201 matching files, ~1s of slow reads)…
  await searchFor(page, 'needle');
  await expect(page.getByTestId('search-scanning')).toBeVisible();

  // …and keep typing WHILE it runs. Responsiveness is asserted through the
  // observable interaction — every keystroke lands in the input, character by
  // character — not through wall-clock thresholds.
  await page.getByTestId('search-input').press('4');
  await expect(page.getByTestId('search-input')).toHaveValue('needle4');
  await page.getByTestId('search-input').press('2');
  await expect(page.getByTestId('search-input')).toHaveValue('needle42');

  // The narrowed query settles: exactly the one file that holds 'needle42',
  // labelled with ITS totals.
  await expect(page.getByTestId('search-totals')).toHaveText('1 match in 1 file', { timeout: 15000 });
  await expect(page.getByTestId('search-file')).toHaveCount(1);
  await expect(page.getByTestId('search-file')).toHaveAttribute('data-path', '/notes/bulk/special.md');
  await expect(page.getByTestId('search-scanning')).toHaveCount(0);

  // The superseded 'needle' scan (201 files) was abandoned between chunks —
  // give any late stragglers time to arrive, then confirm nothing repainted:
  // the panel still shows one completed scan of the CURRENT query.
  await page.waitForTimeout(600);
  await expect(page.getByTestId('search-file')).toHaveCount(1);
  await expect(page.getByTestId('search-totals')).toHaveText('1 match in 1 file');
});
