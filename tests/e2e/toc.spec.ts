import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { editorTopGutterLine, freshApp, fsWrite, openFolderRoot, openPath, seedFolders } from './helpers';

// PRD 012 (issue #132): the sidebar's second view — the table of contents.
// Reqs 1–6, 8, 9, 12: one pane with two mutually exclusive views, the heading
// tree from the section model, expand/collapse, click-to-navigate in both
// modes, live re-derivation, and the two buttons that drive it.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

/** Filler that makes the document taller than the viewport, so jumps scroll. */
const filler = (tag: string, n = 14) =>
  Array.from({ length: n }, (_, i) => `${tag} paragraph ${i + 1}.`).join('\n\n');

/**
 * PRD 012 Reqs 2/3: preamble before the first heading, a duplicate `## Notes`
 * pair, a skipped level, and a `#` line inside a fenced code block — every
 * consequence the model's derivation is supposed to produce, in one document.
 */
const TREE_DOC = [
  'Preamble text that belongs to no heading at all.',
  '',
  '# Alpha',
  '',
  filler('alpha'),
  '',
  '## Notes',
  '',
  '```',
  '# Not a heading',
  '```',
  '',
  filler('notes-one'),
  '',
  '### Deep one',
  '',
  filler('deep'),
  '',
  '## Notes',
  '',
  filler('notes-two'),
  '',
  '# Beta',
  '',
  // Long enough that the editor can still put `# Beta` at its viewport top —
  // a heading near the end of a short document cannot scroll that far.
  filler('beta', 60),
  '',
].join('\n');

const rowLabels = (page: Page) =>
  page.$$eval('[data-testid="toc-item"]', (els) =>
    els.map((e) => `${e.getAttribute('data-depth')}:${e.querySelector('.toc-label')!.textContent}`)
  );

const openTree = async (page: Page) => {
  await fsWrite(page, '/docs/tree.md', TREE_DOC);
  await openPath(page, '/docs/tree.md');
  await expect(page.getByTestId('doc')).toContainText('Alpha');
};

test('E249: TOC view — the button shows and hides it, the tree comes from the section model, and no folder DOM appears in file mode', async ({
  page,
}) => {
  await openTree(page);

  // PRD 012 Req 12: file mode has no folder seam — no folders button, no
  // panel, no chevron — and the TOC button is there all the same.
  await expect(page.getByTestId('sidebar-view-folders')).toHaveCount(0);
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);
  const tocBtn = page.getByTestId('sidebar-view-toc');
  await expect(tocBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(tocBtn).toHaveAttribute('data-active', 'false');
  await expect(tocBtn).toHaveAttribute('title', /table of contents/i);
  await expect(tocBtn).toHaveAttribute('aria-label', /table of contents/i);

  // PRD 012 Req 9: press it — the sidebar opens on the TOC view and the
  // button says so.
  await tocBtn.click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  await expect(page.getByTestId('sidebar-view-toc')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);

  // PRD 012 Reqs 2/3: every H1–H6 in document order, indented under its
  // nearest shallower heading. The preamble is no row, the fenced `#` line is
  // no row, and the two `Notes` headings are two rows.
  await expect.poll(() => rowLabels(page)).toEqual([
    '1:Alpha',
    '2:Notes',
    '3:Deep one',
    '2:Notes',
    '1:Beta',
  ]);
  await expect(page.getByTestId('toc-item').filter({ hasText: 'Not a heading' })).toHaveCount(0);
  // The indent is real, not just an attribute: deeper rows start further right.
  const lefts = await page.$$eval('[data-testid="toc-item"]', (els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().left + parseFloat(getComputedStyle(e).paddingLeft)))
  );
  expect(lefts[1]).toBeGreaterThan(lefts[0]);
  expect(lefts[2]).toBeGreaterThan(lefts[1]);
  expect(lefts[3]).toBe(lefts[1]);
  expect(lefts[4]).toBe(lefts[0]);

  // PRD 012 Req 9: pressing it while the TOC shows hides the sidebar.
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-toc')).toHaveAttribute('aria-pressed', 'false');
});

test('E250: TOC click in preview scrolls the heading to the viewport top, and duplicate titles reach their own occurrence', async ({
  page,
}) => {
  await openTree(page);
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-item')).toHaveCount(5);

  // PRD 012 Req 3: the two `Notes` rows carry different source lines.
  const notes = page.getByTestId('toc-item').filter({ hasText: 'Notes' });
  const firstLine = Number(await notes.nth(0).getAttribute('data-line'));
  const secondLine = Number(await notes.nth(1).getAttribute('data-line'));
  expect(secondLine).toBeGreaterThan(firstLine);

  // PRD 012 Req 5: the SPEC16 §4 preview path — the heading lands at the top.
  const deltaOf = (line: number) =>
    page.evaluate((l) => {
      const ws = document.querySelector('.workspace')!;
      const el = document.querySelector(`.doc [data-mm-line="${l}"]`);
      return el ? Math.abs(el.getBoundingClientRect().top - ws.getBoundingClientRect().top) : 1e6;
    }, line);

  await notes.nth(1).click();
  await expect.poll(() => deltaOf(secondLine)).toBeLessThan(120);
  expect(await deltaOf(firstLine)).toBeGreaterThan(200); // the other occurrence is far away

  await notes.nth(0).click();
  await expect.poll(() => deltaOf(firstLine)).toBeLessThan(120);
});

test('E251: TOC expand/collapse — default expanded, the collapsed row stays, state is per file and dies on restart', async ({
  page,
}) => {
  await openTree(page);
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-item')).toHaveCount(5);

  // PRD 012 Req 4: collapse Alpha — its descendants go, Alpha stays, Beta
  // (no ancestor of it) stays.
  const alpha = page.getByTestId('toc-item').filter({ hasText: 'Alpha' });
  await alpha.getByTestId('toc-twisty').click();
  await expect.poll(() => rowLabels(page)).toEqual(['1:Alpha', '1:Beta']);
  await expect(alpha.getByTestId('toc-twisty')).toHaveAttribute('aria-expanded', 'false');

  // Per file: another document has its own (untouched) state…
  await fsWrite(page, '/docs/other.md', '# Other\n\n## Child\n');
  await openPath(page, '/docs/other.md');
  await expect.poll(() => rowLabels(page)).toEqual(['1:Other', '2:Child']);

  // …and coming back keeps the fold.
  await openPath(page, '/docs/tree.md');
  await expect.poll(() => rowLabels(page)).toEqual(['1:Alpha', '1:Beta']);

  // Re-expanding restores the descendants.
  await alpha.getByTestId('toc-twisty').click();
  await expect.poll(() => rowLabels(page)).toEqual([
    '1:Alpha',
    '2:Notes',
    '3:Deep one',
    '2:Notes',
    '1:Beta',
  ]);
  await alpha.getByTestId('toc-twisty').click();
  await expect.poll(() => rowLabels(page)).toEqual(['1:Alpha', '1:Beta']);

  // PRD 012 Req 4: session only — a restart discards it, and nothing was
  // written to the store to remember it by.
  const before = await page.evaluate(() => window.__mmfs!.list().sort());
  await page.reload();
  await openPath(page, '/docs/tree.md');
  await page.getByTestId('sidebar-view-toc').click();
  await expect.poll(() => rowLabels(page)).toEqual([
    '1:Alpha',
    '2:Notes',
    '3:Deep one',
    '2:Notes',
    '1:Beta',
  ]);
  expect(await page.evaluate(() => window.__mmfs!.list().sort())).toEqual(before);
});

test('E252: TOC click in edit mode scrolls the editor and puts the caret on the heading line, in full edit and in the split', async ({
  page,
}) => {
  await openTree(page);
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-item')).toHaveCount(5);

  const beta = page.getByTestId('toc-item').filter({ hasText: 'Beta' });
  const betaLine = Number(await beta.getAttribute('data-line'));

  // PRD 012 Req 6: edit mode — scrolled AND the caret is on the heading line.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await beta.click();
  await expect(page.locator('.cm-activeLine')).toHaveText('# Beta');
  await expect
    .poll(() => editorTopGutterLine(page), { timeout: 20000 })
    .toBeGreaterThan(betaLine - 6);
  expect(await editorTopGutterLine(page)).toBeLessThan(betaLine + 6);

  // The same click works from the split's editor pane.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  const deep = page.getByTestId('toc-item').filter({ hasText: 'Deep one' });
  await deep.click();
  await expect(page.locator('.cm-activeLine')).toHaveText('### Deep one');
});

test('E253: the TOC re-derives from the buffer while typing, and says so when a document has no headings', async ({
  page,
}) => {
  await fsWrite(page, '/docs/flat.md', 'Just a paragraph, no headings anywhere.\n');
  await openPath(page, '/docs/flat.md');
  await page.getByTestId('sidebar-view-toc').click();

  // PRD 012 Req 8: an empty state, not a blank pane.
  await expect(page.getByTestId('toc-empty')).toBeVisible();
  await expect(page.getByTestId('toc-item')).toHaveCount(0);

  // PRD 012 Req 8: typed headings appear without saving; renames follow.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.press('Control+Home'); // type at the very start, so the hashes open a line
  await page.keyboard.type('# Typed\n\n## Under\n\n');
  await expect.poll(() => rowLabels(page)).toEqual(['1:Typed', '2:Under']);
  await expect(page.getByTestId('toc-empty')).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toBeVisible(); // never saved

  // Deleting the sub-heading's hashes drops the row again.
  await page.getByTestId('toc-item').filter({ hasText: 'Under' }).click();
  await expect(page.locator('.cm-activeLine')).toHaveText('## Under');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');
  await expect.poll(() => rowLabels(page)).toEqual(['1:Typed']);
});

test('E254: one pane, two views — the buttons switch and hide, folder-tree state survives the round trip, and the folders seams keep their meaning', async ({
  page,
}) => {
  test.slow();
  await seedFolders(page);
  await openFolderRoot(page);
  await fsWrite(page, '/notes/sub/head.md', '# Head\n\n## Sub head\n');

  // Set up folder state worth losing: an expanded subdirectory and a
  // selected file inside it.
  await page.getByTestId('folder-item').filter({ hasText: 'sub' }).first().click();
  const headRow = page.locator('[data-testid="folder-item"][data-path="/notes/sub/head.md"]');
  await expect(headRow).toBeVisible();
  await headRow.click();
  await expect(headRow).toHaveClass(/selected/);

  // PRD 012 Req 1: the switch lives in the panel header in both views.
  await expect(page.getByTestId('sidebar-view-folders')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('sidebar-view-toc')).toHaveAttribute('aria-pressed', 'false');

  // Switch to the TOC: exactly one view renders.
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toHaveCount(0); // the pane is open
  await expect.poll(() => rowLabels(page)).toEqual(['1:Head', '2:Sub head']);

  // PRD 012 Req 9: the folders button switches the pane back rather than
  // hiding it — and the tree is exactly as it was.
  await page.getByTestId('sidebar-view-folders').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-header')).toContainText('notes');
  await expect(headRow).toBeVisible(); // /notes/sub is still expanded
  await expect(headRow).toHaveClass(/selected/);

  // Pressing it again, with folders showing, hides the sidebar — and the
  // legacy chevron is back on its own seam.
  await page.getByTestId('sidebar-view-folders').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();
  await expect(page.getByTestId('sidebar-view-folders')).toHaveAttribute('aria-pressed', 'false');

  // PRD 003/012: Mod+Shift+E and the View checkbox still drive and reflect
  // the folders view exactly as before.
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);

  // From the closed pane the TOC button opens the pane on the TOC view.
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  // …and Mod+Shift+E, the folders route, switches the pane to Folders.
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
});
