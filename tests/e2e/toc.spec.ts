import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { editorTopGutterLine, freshApp, fsRead, fsWrite, openFolderRoot, openPath, seedFolders } from './helpers';

// PRD 012 (issue #132): the sidebar's second view — the table of contents.
// Reqs 1–6, 8, 9, 12: one pane with two mutually exclusive views, the heading
// tree from the section model, expand/collapse, click-to-navigate in both
// modes, live re-derivation, and the two buttons that drive it.
//
// PRD 012 (issue #134): Reqs 10–11 — the toggleToc hotkey, which is the TOC
// button's action reached from the keyboard, and the persisted last view the
// app reopens the sidebar in.

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
  // PRD 012 Req 11 (issue #134): no click needed — the VIEW is persisted, so
  // the pane comes back on the TOC. The folds inside it are what does not.
  await expect(page.getByTestId('toc-panel')).toBeVisible();
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

// PRD 012 Req 7 (issue #133): the TOC tracks the reader — the section at the
// top of the viewport is the highlighted one, in both modes, and a highlighted
// row buried under a collapsed ancestor digs itself out.

/** The `data-toc-id` of the one row claiming to be active, or null for none. */
const activeTocId = (page: Page) =>
  page.$$eval('[data-testid="toc-item"]', (els) => {
    const on = els.filter((e) => e.getAttribute('aria-current') === 'true');
    // Never more than one: the highlight is one resolver answer, not a set.
    if (on.length > 1) return `MULTIPLE(${on.length})`;
    const row = on[0];
    if (!row) return null;
    // The class and `data-active` hook must agree with the ARIA state.
    if (!row.classList.contains('toc-active') || row.getAttribute('data-active') !== 'true') {
      return `DISAGREES(${row.className}|${row.getAttribute('data-active')})`;
    }
    return row.getAttribute('data-toc-id');
  });

/** Scroll the preview so the given source line sits at the viewport top. */
const scrollPreviewToLine = (page: Page, line: number) =>
  page.evaluate((l) => {
    const ws = document.querySelector('.workspace')!;
    const el = document.querySelector(`.doc [data-mm-line="${l}"]`)!;
    ws.scrollTop += el.getBoundingClientRect().top - ws.getBoundingClientRect().top;
  }, line);

/**
 * Scroll the EDITOR so the given source line sits at its viewport top. One
 * nudge per poll: CodeMirror only renders gutters near the viewport, so a far
 * line is reached by extrapolating from a rendered neighbour and re-measuring.
 */
const scrollEditorToLine = async (page: Page, line: number) => {
  await expect
    .poll(
      async () => {
        await page.evaluate((l) => {
          const s = document.querySelector('.cm-scroller')!;
          const base = s.getBoundingClientRect().top;
          const gs = Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
            .map((el) => ({ n: Number(el.textContent), r: el.getBoundingClientRect() }))
            // CodeMirror's gutter carries a zero-height width SPACER ('999')
            // ahead of the real numbers — measuring off it inverts everything.
            .filter((g) => Number.isFinite(g.n) && g.n > 0 && g.r.height > 0)
            .sort((a, b) => a.r.top - b.r.top);
          if (gs.length === 0) return;
          const exact = gs.find((g) => g.n === l);
          if (exact) {
            s.scrollTop += exact.r.top - base;
            return;
          }
          const span = gs[gs.length - 1].n - gs[0].n;
          const h = span > 0 ? (gs[gs.length - 1].r.top - gs[0].r.top) / span : 20;
          s.scrollTop += gs[0].r.top - base + (l - gs[0].n) * h;
        }, line);
        return editorTopGutterLine(page);
      },
      { timeout: 20000 }
    )
    .toBe(line);
};

/** `data-line` of every TOC row, keyed by its `data-toc-id`. */
const rowLines = (page: Page) =>
  page.$$eval('[data-testid="toc-item"]', (els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute('data-toc-id')!, Number(e.getAttribute('data-line'))]))
  );

test('E255: the preview scroll moves the highlight to the section at the viewport top, the preamble highlights nothing, and a click leaves its own row active', async ({
  page,
}) => {
  await openTree(page);
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-item')).toHaveCount(5);
  const lines = await rowLines(page);

  // PRD 012 Req 7: parked in the preamble — above the first heading — nothing
  // claims to be active. The preamble is not a row, so it cannot be one.
  await expect.poll(() => activeTocId(page)).toBeNull();

  // Scrolling alone moves the highlight — no click anywhere in this block.
  await scrollPreviewToLine(page, lines['1']); // # Alpha
  await expect.poll(() => activeTocId(page)).toBe('1');
  await scrollPreviewToLine(page, lines['1.1']); // ## Notes
  await expect.poll(() => activeTocId(page)).toBe('1.1');
  await scrollPreviewToLine(page, lines['1.1.1']); // ### Deep one
  await expect.poll(() => activeTocId(page)).toBe('1.1.1');
  await scrollPreviewToLine(page, lines['2']); // # Beta
  await expect.poll(() => activeTocId(page)).toBe('2');

  // Body text below a heading still belongs to that heading, and scrolling
  // back to the very top gives the highlight up again.
  await scrollPreviewToLine(page, lines['2'] + 2);
  await expect.poll(() => activeTocId(page)).toBe('2');
  await page.evaluate(() => {
    document.querySelector('.workspace')!.scrollTop = 0;
  });
  await expect.poll(() => activeTocId(page)).toBeNull();

  // PRD 012 Reqs 5–7: a clicked row is the active row once the scroll settles —
  // the second `Notes`, so the duplicate title cannot be what matched.
  await page.getByTestId('toc-item').filter({ hasText: 'Notes' }).nth(1).click();
  await expect.poll(() => activeTocId(page)).toBe('1.2');

  // The highlight is a readout, not a selection: it never steals focus from
  // the document, and it is not the folder row's `selected` treatment.
  expect(await page.evaluate(() => document.querySelectorAll('.toc-item.selected').length)).toBe(0);
});

test('E256: scrolling the editor moves the highlight too, in the split and in full edit', async ({
  page,
}) => {
  test.slow();
  await openTree(page);
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-item')).toHaveCount(5);
  const lines = await rowLines(page);

  // `splitEdit` is on by default, so this is the SPLIT: the editor pane on the
  // left, the preview on the right, one scroll position between them.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-divider')).toBeVisible();

  // PRD 012 Req 7 in edit mode: the editor's own top visible line decides.
  await scrollEditorToLine(page, lines['1']);
  await expect.poll(() => activeTocId(page)).toBe('1');
  await scrollEditorToLine(page, lines['1.1.1']); // ### Deep one
  await expect.poll(() => activeTocId(page)).toBe('1.1.1');
  await scrollEditorToLine(page, lines['1.2']); // the second ## Notes
  await expect.poll(() => activeTocId(page)).toBe('1.2');

  // Back above the first heading: no row again.
  await page.evaluate(() => {
    document.querySelector('.cm-scroller')!.scrollTop = 0;
  });
  await expect.poll(() => activeTocId(page)).toBeNull();

  // Full edit — the same, with no preview pane in the picture at all. Wait for
  // the split's slide-out to finish: while it runs, SPEC15 is still holding
  // the two panes together and would undo the scroll under the test.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  await scrollEditorToLine(page, lines['2']); // # Beta
  await expect.poll(() => activeTocId(page)).toBe('2');

  // PRD 012 Reqs 6–7: a click in edit mode leaves its own row active.
  await page.getByTestId('toc-item').filter({ hasText: 'Deep one' }).click();
  await expect.poll(() => activeTocId(page)).toBe('1.1.1');
});

/**
 * Two sibling trees, so "the chain expanded and NOTHING else did" is a
 * statement this document can actually make.
 */
const REVEAL_DOC = [
  'Preamble before any heading.',
  '',
  '# One',
  '',
  filler('one'),
  '',
  '## One A',
  '',
  filler('one-a'),
  '',
  '### One A deep',
  '',
  filler('one-a-deep'),
  '',
  '# Two',
  '',
  filler('two'),
  '',
  '## Two A',
  '',
  filler('two-a', 60),
  '',
].join('\n');

test('E257: scrolling into a manually collapsed subtree auto-expands the chain to reveal the active row, and only that chain', async ({
  page,
}) => {
  await fsWrite(page, '/docs/reveal.md', REVEAL_DOC);
  await openPath(page, '/docs/reveal.md');
  await page.getByTestId('sidebar-view-toc').click();
  await expect.poll(() => rowLabels(page)).toEqual(['1:One', '2:One A', '3:One A deep', '1:Two', '2:Two A']);
  const lines = await rowLines(page);

  // PRD 012 Req 4: fold both top-level sections by hand.
  await page.getByTestId('toc-item').filter({ hasText: 'One' }).first().getByTestId('toc-twisty').click();
  await page.getByTestId('toc-item').filter({ hasText: 'Two' }).first().getByTestId('toc-twisty').click();
  await expect.poll(() => rowLabels(page)).toEqual(['1:One', '1:Two']);

  // PRD 012 Req 7: scrolling into the buried `### One A deep` digs out its
  // ancestors — and `Two`'s unrelated fold survives untouched.
  await scrollPreviewToLine(page, lines['1.1.1']);
  await expect.poll(() => rowLabels(page)).toEqual(['1:One', '2:One A', '3:One A deep', '1:Two']);
  await expect.poll(() => activeTocId(page)).toBe('1.1.1');

  // A further scroll that leaves the active row visible changes no folds: the
  // reveal is idempotent, so `Two` stays exactly as the reader left it.
  await scrollPreviewToLine(page, lines['1.1.1'] + 2);
  await expect.poll(() => activeTocId(page)).toBe('1.1.1');
  expect(await rowLabels(page)).toEqual(['1:One', '2:One A', '3:One A deep', '1:Two']);

  // The reveal became the document's own state: the re-expanded `One` folds
  // again by hand, and the collapse set did not accumulate anything strange.
  await page.getByTestId('toc-item').filter({ hasText: 'One' }).first().getByTestId('toc-twisty').click();
  await expect.poll(() => rowLabels(page)).toEqual(['1:One', '1:Two']);

  // PRD 012 Req 4: another document's folds were never touched.
  await fsWrite(page, '/docs/tree.md', TREE_DOC);
  await openPath(page, '/docs/tree.md');
  await expect.poll(() => rowLabels(page)).toEqual(['1:Alpha', '2:Notes', '3:Deep one', '2:Notes', '1:Beta']);
});

test('E258: the toggleToc hotkey opens the sidebar on the TOC, hides it again, and is inert with no document open', async ({
  page,
}) => {
  // PRD 012 Req 12: the splash — no document, so no TOC button exists and the
  // hotkey has nothing to show. Issue #81: a hash-less launch lands here.
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('sidebar-view-toc')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  // Inert means inert: nothing was opened and nothing was written.
  const seeded = JSON.parse((await fsRead(page, '/config/settings.json'))!);
  expect(seeded.showFolders).toBeUndefined();
  expect(seeded.sidebarView).toBeUndefined();

  await openTree(page);

  // PRD 012 Req 10: sidebar hidden → it opens showing the TOC.
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  await expect(page.getByTestId('sidebar-view-toc')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => rowLabels(page)).toEqual([
    '1:Alpha',
    '2:Notes',
    '3:Deep one',
    '2:Notes',
    '1:Beta',
  ]);

  // PRD 012 Req 10: showing the TOC → the sidebar hides.
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-toc')).toHaveAttribute('aria-pressed', 'false');

  // Exactly the button's action, from either surface: the button opens it and
  // the hotkey hides what the button opened.
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  // Past SPEC12 §1.3's exactly-once window first: button and hotkey dispatch
  // the SAME command id, so a keypress inside 150ms of the click is swallowed
  // as a duplicate arrival — which is itself the proof they are one action.
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
});

test('E259: with the folder tree showing, the hotkey switches the pane to the TOC in place, and Mod+Shift+E keeps its meaning', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);
  await fsWrite(page, '/notes/sub/head.md', '# Head\n\n## Sub head\n');

  // Folder state worth losing: an expanded subdirectory and a selected file.
  await page.getByTestId('folder-item').filter({ hasText: 'sub' }).first().click();
  const headRow = page.locator('[data-testid="folder-item"][data-path="/notes/sub/head.md"]');
  await expect(headRow).toBeVisible();
  await headRow.click();
  await expect(headRow).toHaveClass(/selected/);

  // PRD 012 Req 10: sidebar showing folders → the pane switches to the TOC.
  const folderBox = (await page.getByTestId('folder-panel').boundingBox())!;
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect.poll(() => rowLabels(page)).toEqual(['1:Head', '2:Sub head']);

  // …and it stays put: same edge, same width, and the closed pane's edge
  // chevron never appeared, so nothing slid.
  const tocBox = (await page.getByTestId('toc-panel').boundingBox())!;
  expect(Math.round(tocBox.x)).toBe(Math.round(folderBox.x));
  expect(Math.round(tocBox.width)).toBe(Math.round(folderBox.width));
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);

  // Mod+Shift+E keeps its existing meaning — the folders route — and the tree
  // is exactly as it was left.
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-header')).toContainText('notes');
  await expect(headRow).toBeVisible();
  await expect(headRow).toHaveClass(/selected/);

  // From folders, the TOC hotkey switches again; pressed on the TOC it hides
  // the pane, and the folders seam's chevron is back.
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();
});

test('E260: the sidebar reopens in the view it was left on — the TOC across a restart, folders unchanged', async ({
  page,
}) => {
  await openTree(page);
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('toc-panel')).toBeVisible();

  // PRD 012 Req 11: the view lives in the existing settings store beside the
  // two SPEC34 keys — no new persistence file.
  await expect
    .poll(async () => JSON.parse((await fsRead(page, '/config/settings.json'))!).sidebarView)
    .toBe('toc');
  const files = await page.evaluate(() => window.__mmfs!.list().sort());

  // Restart with the same document open: the pane comes back on the TOC, with
  // no click, and the store gained no file for it.
  await page.goto('/#open=/docs/tree.md');
  await expect(page.getByTestId('doc')).toContainText('Alpha');
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  await expect(page.getByTestId('sidebar-view-toc')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => rowLabels(page)).toEqual([
    '1:Alpha',
    '2:Notes',
    '3:Deep one',
    '2:Notes',
    '1:Beta',
  ]);
  expect(await page.evaluate(() => window.__mmfs!.list().sort())).toEqual(files);
  // SPEC34 §2.2: the sidebar's own visibility key is untouched by all this —
  // it still says "open", and the new key only says which view is in the pane.
  const stored = JSON.parse((await fsRead(page, '/config/settings.json'))!);
  expect(stored.showFolders).toBe(true);

  // Left on the folders view, the existing behaviour is unchanged: a folder
  // route puts the pane on the tree, and a restart reopens it there.
  await seedFolders(page);
  await openFolderRoot(page);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect
    .poll(async () => JSON.parse((await fsRead(page, '/config/settings.json'))!).sidebarView)
    .toBe('folders');

  // Issue #81: a hash-less restart lands on the splash; reopening the folder
  // shows the tree, not the TOC the reader left two steps ago.
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openFolderRoot(page);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
});
