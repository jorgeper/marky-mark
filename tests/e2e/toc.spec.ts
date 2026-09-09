import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  editorCaret,
  editorTopGutterLine,
  enableActiveLine,
  freshApp,
  fsRead,
  fsWrite,
  openFolderRoot,
  openPath,
  seedFolders,
  showToc,
} from './helpers';

// PRD 012 (issue #132): the sidebar's second view — the table of contents.
// Reqs 1–6, 8, 9, 12: one pane with two mutually exclusive views, the heading
// tree from the section model, expand/collapse, click-to-navigate in both
// modes, live re-derivation, and the two buttons that drive it.
//
// PRD 012 (issue #134): Reqs 10–11 — the toggleToc hotkey, which is the TOC
// button's action reached from the keyboard, and the persisted last view the
// app reopens the sidebar in.
//
// PRD 012 Req 4 (issue #255): the in-pane heading search — E530–E533, which
// carry the coverage the retired ⌘K palette's E61 used to hold.

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

/**
 * PRD 012 Req 4 (issue #255): the row titles alone, in the order drawn — what a
 * search asserts on, where `rowLabels` above asserts on the tree's shape too
 * (a filtered list is flat, so its depth prefix says nothing).
 */
const searchRows = (page: Page) =>
  page.$$eval('[data-testid="toc-item"]', (els) =>
    els.map((e) => e.querySelector('.toc-label')!.textContent)
  );

const openTree = async (page: Page) => {
  await fsWrite(page, '/docs/tree.md', TREE_DOC);
  await openPath(page, '/docs/tree.md');
  await expect(page.getByTestId('doc')).toContainText('Alpha');
};

test('E334: TOC view — the switch shows it (and is gone while hidden), the tree comes from the section model, and no folder DOM appears in file mode', async ({
  page,
}) => {
  await openTree(page);

  // Issue #257: with the sidebar hidden the switch renders NOTHING — the
  // buttons only choose what is inside it. PRD 012 Req 12: file mode has no
  // folder seam either, so no folders button and no panel; the one control
  // left is Show sidebar, which reopens on the TOC — the only view this
  // platform/state can put up.
  await expect(page.getByTestId('sidebar-switch')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-folders')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-toc')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-search')).toHaveCount(0);
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  const expand = page.getByTestId('folder-expand');
  await expect(expand).toHaveAttribute('title', 'Show sidebar');
  await expect(expand).toHaveAttribute('aria-label', 'Show sidebar');

  // PRD 012 Req 9: press it — the sidebar opens on the TOC view, the switch
  // comes back with its fixed tooltip, and the button says which view is on.
  await expand.click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  const tocBtn = page.getByTestId('sidebar-view-toc');
  await expect(tocBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(tocBtn).toHaveAttribute('data-active', 'true');
  await expect(tocBtn).toHaveAttribute('title', 'Show the table of contents');
  await expect(tocBtn).toHaveAttribute('aria-label', 'Show the table of contents');
  await expect(page.getByTestId('sidebar-view-folders')).toHaveCount(0); // still no seam
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

  // Issue #257: pressing the button whose view is showing does NOTHING —
  // the panel stays, on the same view, still pressed. Hiding is the
  // chevron's job, and that brings the Show sidebar control back.
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  await expect(page.getByTestId('sidebar-view-toc')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('toc-collapse')).toHaveAttribute('title', 'Hide sidebar');
  await page.getByTestId('toc-collapse').click();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-toc')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();
});

test('E335: TOC click in preview scrolls the heading to the viewport top, and duplicate titles reach their own occurrence', async ({
  page,
}) => {
  await openTree(page);
  await showToc(page);
  await expect(page.getByTestId('toc-item')).toHaveCount(5);

  // PRD 012 Req 3: the two `Notes` rows carry different source lines.
  const notes = page.getByTestId('toc-item').filter({ hasText: 'Notes' });
  const firstLine = Number(await notes.nth(0).getAttribute('data-line'));
  const secondLine = Number(await notes.nth(1).getAttribute('data-line'));
  expect(secondLine).toBeGreaterThan(firstLine);

  // PRD 012 Req 5: the preview scroll-to-line path — the heading lands at the top.
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

test('E336: TOC expand/collapse — default expanded, the collapsed row stays, state is per file and dies on restart', async ({
  page,
}) => {
  await openTree(page);
  await showToc(page);
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

test('E337: TOC click in edit mode scrolls the editor and puts the caret on the heading line, in full edit and in the split', async ({
  page,
}) => {
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await openTree(page);
  await showToc(page);
  await expect(page.getByTestId('toc-item')).toHaveCount(5);

  const beta = page.getByTestId('toc-item').filter({ hasText: 'Beta' });
  const betaLine = Number(await beta.getAttribute('data-line'));

  // PRD 012 Req 6: edit mode — scrolled AND the caret is on the heading line.
  // Full edit first: splitEdit ships on, so Mod+\ closes the split that
  // Ctrl+E opened. (Issue #328: the divider leaves the DOM the same frame —
  // before that, this test's `Mod+\` leg caught the divider mid exit-slide
  // and both legs really ran in the other layout.)
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  await beta.click();
  await expect(page.locator('.cm-activeLine')).toHaveText('# Beta');
  // PRD 012 Req 6 (issue #300): on the heading's TEXT — after the `# ` run,
  // never at column 0 in front of the markers — as an empty selection.
  await expect.poll(() => editorCaret(page)).toEqual({ column: 2, collapsed: true, text: '# Beta' });
  await expect
    .poll(() => editorTopGutterLine(page), { timeout: 20000 })
    .toBeGreaterThan(betaLine - 6);
  expect(await editorTopGutterLine(page)).toBeLessThan(betaLine + 6);

  // The same click works from the split's editor pane: reopen the split.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  const deep = page.getByTestId('toc-item').filter({ hasText: 'Deep one' });
  await deep.click();
  await expect(page.locator('.cm-activeLine')).toHaveText('### Deep one');
  await expect.poll(() => editorCaret(page)).toEqual({ column: 4, collapsed: true, text: '### Deep one' });
});

test('E338: the TOC re-derives from the buffer while typing, and says so when a document has no headings', async ({
  page,
}) => {
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await fsWrite(page, '/docs/flat.md', 'Just a paragraph, no headings anywhere.\n');
  await openPath(page, '/docs/flat.md');
  await showToc(page);

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

  // Deleting the sub-heading's hashes drops the row again. PRD 012 Req 6
  // (issue #300): the jump leaves the caret on the heading's TEXT, so the
  // `## ` to remove is the three characters BEHIND it.
  await page.getByTestId('toc-item').filter({ hasText: 'Under' }).click();
  await expect(page.locator('.cm-activeLine')).toHaveText('## Under');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect.poll(() => rowLabels(page)).toEqual(['1:Typed']);
});

test('E254: one pane, two views — the buttons switch (never hide), folder-tree state survives the round trip, and the folders seams keep their meaning', async ({
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

  // Issue #257: pressing it again, with folders showing, does nothing at
  // all — the pane stays open on the same view, still pressed. The header's
  // chevron is what hides it, and then the switch is gone entirely.
  await page.getByTestId('sidebar-view-folders').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('sidebar-view-folders')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();
  await expect(page.getByTestId('sidebar-switch')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-folders')).toHaveCount(0);

  // PRD 003/012: Mod+Shift+E and the View checkbox still drive and reflect
  // the folders view exactly as before.
  // SPEC12 §1.3 cross-source dedup window: the pane switches instantly now
  // (issue #328), so nothing else spaces this toggle from the last one.
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);

  // Issue #257: the closed pane's one control reopens on the view the
  // sidebar was last showing. Hidden on folders ⇒ it comes back on folders;
  // hidden on the TOC ⇒ it comes back on the TOC.
  // SPEC12 §1.3 cross-source dedup window: the pane switches instantly now
  // (issue #328), so nothing else spaces this toggle from the last one.
  await page.waitForTimeout(250);
  await page.getByTestId('folder-expand').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  await page.getByTestId('toc-collapse').click();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await page.getByTestId('folder-expand').click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  // …and Mod+Shift+E, the folders route, switches the pane to Folders.
  // SPEC12 §1.3 cross-source dedup window: the pane switches instantly now
  // (issue #328), so nothing else spaces this toggle from the last one.
  await page.waitForTimeout(250);
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
  await showToc(page);
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
  await showToc(page);
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
  // the divider to leave the DOM (issue #328: in place, no slide): until it
  // does, SPEC15 is still holding the two panes together and would undo the
  // scroll under the test.
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
  await showToc(page);
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

  // PRD 012 Req 10: showing the TOC → the sidebar hides. Issue #257: the
  // hotkey keeps that toggle (only the BUTTONS stopped hiding), and the
  // switch goes with the sidebar.
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-view-toc')).toHaveCount(0);

  // Exactly the same action from either surface: the collapsed state's Show
  // sidebar control opens it, and the hotkey hides what it opened.
  // SPEC12 §1.3 cross-source dedup window: the pane switches instantly now
  // (issue #328), so nothing else spaces this toggle from the last one.
  await page.waitForTimeout(250);
  await page.getByTestId('folder-expand').click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  // Past SPEC12 §1.3's exactly-once window first: the chevron and the hotkey
  // dispatch the SAME command id, so a keypress inside 150ms of the click is
  // swallowed as a duplicate arrival — itself the proof they are one action.
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

test('E530: the search toggle is the TOC header\'s alone — never in Folders or Search, never while the sidebar is hidden, never a switch member', async ({
  page,
}) => {
  await seedFolders(page);
  await fsWrite(page, '/notes/head.md', TREE_DOC);
  await openFolderRoot(page);
  await page.locator('[data-testid="folder-item"][data-path="/notes/head.md"]').click();
  await expect(page.getByTestId('doc')).toContainText('Alpha');

  // The folders view is up: the header button does not exist at all.
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('toc-search-toggle')).toHaveCount(0);

  // The TOC view is up: exactly one, with the sidebar's pressed-state idiom and
  // a constant tooltip.
  await page.getByTestId('sidebar-view-toc').click();
  const toggle = page.getByTestId('toc-search-toggle');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute('title', 'Search headings');
  await expect(toggle).toHaveAttribute('aria-label', 'Search headings');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('toc-search-input')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('data-active', 'true');
  await expect(toggle).toHaveClass(/\bon\b/);

  // It is NOT a member of the view switch: the switch still carries its three
  // buttons and nothing else, in every view.
  await expect(page.getByTestId('sidebar-switch').locator('button')).toHaveCount(3);
  await expect(page.getByTestId('sidebar-view-folders')).toHaveCount(1);
  await expect(page.getByTestId('sidebar-view-toc')).toHaveCount(1);
  await expect(page.getByTestId('sidebar-view-search')).toHaveCount(1);

  // The Search view: no heading-search button anywhere in its header.
  await page.getByTestId('sidebar-view-search').click();
  await expect(page.getByTestId('search-panel')).toBeVisible();
  await expect(page.getByTestId('toc-search-toggle')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-switch').locator('button')).toHaveCount(3);

  // …and with the sidebar hidden, zero elements.
  await page.getByTestId('sidebar-view-toc').click();
  await expect(page.getByTestId('toc-search-toggle')).toHaveCount(1);
  await page.getByTestId('toc-collapse').click();
  await expect(page.getByTestId('toc-panel')).toHaveCount(0);
  await expect(page.getByTestId('toc-search-toggle')).toHaveCount(0);
});

test('E531: the box fuzzy-filters the headings in place — collapsed ancestors included, empty query is no filter, no match says so', async ({
  page,
}) => {
  await openTree(page);
  await showToc(page);
  await expect(page.getByTestId('toc-item')).toHaveCount(5);

  // PRD 012 Req 4: fold Alpha first — the filter must see what the fold hides.
  const alpha = page.getByTestId('toc-item').filter({ hasText: 'Alpha' });
  await alpha.getByTestId('toc-twisty').click();
  await expect.poll(() => rowLabels(page)).toEqual(['1:Alpha', '1:Beta']);

  // Opening the box focuses it, and leaves the list alone until something is typed.
  await page.getByTestId('toc-search-toggle').click();
  const box = page.getByTestId('toc-search-input');
  await expect(box).toBeFocused();
  await expect.poll(() => rowLabels(page)).toEqual(['1:Alpha', '1:Beta']);

  // Typing filters in place — and reaches `Deep one`, buried two levels under
  // the collapsed Alpha.
  await box.fill('deep');
  await expect.poll(() => searchRows(page)).toEqual(['Deep one']);
  // The matches are ordinary TOC rows: same testid, still carrying the id, the
  // source line and the depth the jump and the indent need.
  const deep = page.getByTestId('toc-item');
  await expect(deep).toHaveAttribute('data-toc-id', /.+/);
  await expect(deep).toHaveAttribute('data-depth', '3');
  await expect(deep).toHaveAttribute('data-line', /\d+/);

  // Fuzzy, not substring: a subsequence match reaches both `Notes` rows, and
  // ranking is `fuzzyFilter`'s.
  await box.fill('nts');
  await expect.poll(() => searchRows(page)).toEqual(['Notes', 'Notes']);

  // No match: a visible empty state, not a blank pane.
  await box.fill('zzzz');
  await expect(page.getByTestId('toc-item')).toHaveCount(0);
  await expect(page.getByTestId('toc-search-empty')).toBeVisible();
  await expect(page.getByTestId('toc-search-empty')).toContainText('zzzz');
  await expect(page.getByTestId('toc-empty')).toHaveCount(0);

  // An empty query is not a filter: the ordinary tree comes back WITH the fold
  // it had, and the empty state goes.
  await box.fill('');
  await expect(page.getByTestId('toc-search-empty')).toHaveCount(0);
  await expect.poll(() => rowLabels(page)).toEqual(['1:Alpha', '1:Beta']);

  // While a query is live, scrolling does not re-fold or reorder the list —
  // the scroll-driven reveal sits the search out.
  await box.fill('note');
  await expect.poll(() => searchRows(page)).toEqual(['Notes', 'Notes']);
  await page.locator('.workspace').evaluate((el) => (el.scrollTop = el.scrollHeight * 0.5));
  await page.waitForTimeout(300);
  expect(await searchRows(page)).toEqual(['Notes', 'Notes']);
});

test('E532: a filtered match jumps exactly as the palette did — the preview heading lands at the viewport top, and the sidebar stays put', async ({
  page,
}) => {
  await openTree(page);
  await showToc(page);
  await expect(page.getByTestId('toc-item')).toHaveCount(5);

  const deltaOf = (line: number) =>
    page.evaluate((l) => {
      const ws = document.querySelector('.workspace')!;
      const el = document.querySelector(`.doc [data-mm-line="${l}"]`);
      return el ? Math.abs(el.getBoundingClientRect().top - ws.getBoundingClientRect().top) : 1e6;
    }, line);

  await page.getByTestId('toc-search-toggle').click();
  const box = page.getByTestId('toc-search-input');
  await box.fill('beta');
  await expect.poll(() => searchRows(page)).toEqual(['Beta']);
  const betaLine = Number(await page.getByTestId('toc-item').getAttribute('data-line'));

  // Clicking the match takes the TOC's own jump: the heading at the top.
  await page.getByTestId('toc-item').click();
  await expect.poll(() => deltaOf(betaLine)).toBeLessThan(120);

  // PRD 012 Req 4 (issue #255): the jump leaves the sidebar as it is — this is
  // a filter, not a modal that dismisses itself.
  await expect(box).toBeVisible();
  await expect(box).toHaveValue('beta');
  await expect.poll(() => searchRows(page)).toEqual(['Beta']);

  // Enter jumps the top-ranked match — the palette's keyboard parity.
  await page.locator('.workspace').evaluate((el) => (el.scrollTop = 0));
  await box.fill('deep one');
  await expect.poll(() => searchRows(page)).toEqual(['Deep one']);
  const deepLine = Number(await page.getByTestId('toc-item').getAttribute('data-line'));
  await box.press('Enter');
  await expect.poll(() => deltaOf(deepLine)).toBeLessThan(120);
  await expect(box).toHaveValue('deep one');
});

test('E533: the filtered jump lands on the source line in edit mode, and Esc or the toggle restores the full list', async ({
  page,
}) => {
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await openTree(page);
  await showToc(page);
  await expect(page.getByTestId('toc-item')).toHaveCount(5);

  const betaLine = Number(
    await page.getByTestId('toc-item').filter({ hasText: 'Beta' }).getAttribute('data-line')
  );

  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('toc-search-toggle').click();
  const box = page.getByTestId('toc-search-input');
  await box.fill('beta');
  await expect.poll(() => searchRows(page)).toEqual(['Beta']);
  await box.press('Enter');

  // PRD 012 Req 6: the editor goes to the heading's source line, caret and all.
  await expect(page.locator('.cm-activeLine')).toHaveText('# Beta');
  await expect
    .poll(() => editorTopGutterLine(page), { timeout: 20000 })
    .toBeGreaterThan(betaLine - 6);
  expect(await editorTopGutterLine(page)).toBeLessThan(betaLine + 6);

  // Esc closes the box, clears the query and restores the full list.
  await box.press('Escape');
  await expect(page.getByTestId('toc-search-input')).toHaveCount(0);
  await expect(page.getByTestId('toc-search-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('toc-panel')).toBeVisible(); // the pane itself stays
  await expect.poll(() => rowLabels(page)).toEqual([
    '1:Alpha',
    '2:Notes',
    '3:Deep one',
    '2:Notes',
    '1:Beta',
  ]);

  // Reopening starts empty, and the toggle closes it the same way Esc does —
  // clearing the query and restoring the collapse state the list had.
  await page.getByTestId('toc-search-toggle').click();
  await expect(page.getByTestId('toc-search-input')).toHaveValue('');
  await page.getByTestId('toc-item').filter({ hasText: 'Alpha' }).getByTestId('toc-twisty').click();
  await expect.poll(() => rowLabels(page)).toEqual(['1:Alpha', '1:Beta']);
  await page.getByTestId('toc-search-input').fill('deep');
  await expect.poll(() => searchRows(page)).toEqual(['Deep one']);
  await page.getByTestId('toc-search-toggle').click();
  await expect(page.getByTestId('toc-search-input')).toHaveCount(0);
  await expect.poll(() => rowLabels(page)).toEqual(['1:Alpha', '1:Beta']);
});
