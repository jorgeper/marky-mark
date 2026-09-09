import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  clickCharBoundary,
  clickWord,
  editorBottomGutterLine,
  editorTopGutterLine,
  enableActiveLine,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  openSettings,
  previewSelectionAnnotation,
  previewTopAnchorLines,
  saveSettings,
  selectPhraseInPane,
  selectSpanInPane,
  splitApp,
  stableBox,
} from './helpers';

// Side-by-side edit: the divider, scroll sync, selection mirroring, mode
// carry-over, the caret-line tint and the scroll-neutral preview click.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E39: side-by-side edit shows editor plus live preview; typing updates the right pane', async ({ page }) => {
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await saveSettings(page);

  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(page.getByTestId('split-preview').locator('h1')).toContainText('Welcome to Marky Mark');

  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('LIVEMARK ');
  await expect(page.getByTestId('split-preview')).toContainText('LIVEMARK', { timeout: 1000 });

  // The toggle returns to the reading preview (comments surface).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
});

test('E40: the split divider drags within bounds, persists its ratio, and double-click resets', async ({
  page,
}) => {
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await saveSettings(page);
  await page.keyboard.press('Control+e');

  const wsBox = (await page.locator('.workspace.split').boundingBox())!;
  const editorFraction = async () => {
    const e = (await page.locator('.split-editor').boundingBox())!;
    return e.width / wsBox.width;
  };
  // The ratio lands with the mount (issue #328: no slide); polled so the
  // divider below is grabbed once the layout has settled.
  await expect.poll(async () => Math.abs((await editorFraction()) - 0.5)).toBeLessThanOrEqual(0.05);

  // Drag the divider to ~30% of the window.
  const divider = page.getByTestId('split-divider');
  const d1 = await stableBox(divider);
  await page.mouse.move(d1.x + d1.width / 2, d1.y + 200);
  await page.mouse.down();
  await page.mouse.move(wsBox.x + wsBox.width * 0.3, d1.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect.poll(editorFraction).toBeGreaterThanOrEqual(0.25);
  await expect.poll(editorFraction).toBeLessThanOrEqual(0.35);

  // The ratio survives leaving and re-entering edit mode, and reaches disk.
  await page.keyboard.press('Control+e');
  await page.keyboard.press('Control+e');
  await expect.poll(editorFraction).toBeLessThanOrEqual(0.35);
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { splitRatio?: number }).splitRatio : null;
    })
    .toBeLessThanOrEqual(0.35);

  // Dragging far left clamps at the 0.2 floor.
  const d2 = await stableBox(divider);
  await page.mouse.move(d2.x + d2.width / 2, d2.y + 200);
  await page.mouse.down();
  await page.mouse.move(wsBox.x + 5, d2.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect.poll(editorFraction).toBeGreaterThanOrEqual(0.19);
  await expect.poll(editorFraction).toBeLessThanOrEqual(0.22);

  // Double-click resets to an even split.
  await divider.dblclick();
  await expect.poll(editorFraction).toBeGreaterThanOrEqual(0.45);
  await expect.poll(editorFraction).toBeLessThanOrEqual(0.55);
});

test('E57: split scroll sync — the preview follows the editor, ends clamp, blocks stay aligned', async ({
  page,
}) => {
  await splitApp(page);
  const editor = page.locator('.cm-scroller');
  const preview = page.locator('.split-preview');

  // End clamp: editor to bottom → preview bottoms out.
  await editor.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect
    .poll(() => preview.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(3);

  // Back to top → preview zeroes.
  await editor.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => preview.evaluate((el) => el.scrollTop)).toBeLessThan(3);

  // Mid-document: the editor's top visible line falls between the preview's
  // top bracketing anchors (±one block, SPEC15 §1.2).
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.4));
  await expect
    .poll(async () => {
      const line = await editorTopGutterLine(page);
      const { before, after } = await previewTopAnchorLines(page);
      return line >= before - 5 && line <= after + 5;
    })
    .toBe(true);
});

test('E58: split scroll sync — the editor follows the preview; no feedback oscillation', async ({ page }) => {
  await splitApp(page);
  const preview = page.locator('.split-preview');

  // Scroll the preview so Marker 30 sits at the pane top.
  await preview.evaluate((el) => {
    const doc = el.querySelector('.doc')!;
    const target = Array.from(doc.querySelectorAll('h2')).find((h) => h.textContent === 'Marker 30')!;
    el.scrollTop = el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  const markerLine = await preview.evaluate((el) => {
    const target = Array.from(el.querySelectorAll<HTMLElement>('[data-mm-line]')).find(
      (n) => n.textContent === 'Marker 30'
    )!;
    return Number(target.dataset.mmLine);
  });
  await expect.poll(async () => Math.abs((await editorTopGutterLine(page)) - markerLine)).toBeLessThan(6);

  // Settle check: both panes come to rest — the same pair of scroll offsets
  // on two consecutive polls (the stableBox pattern). A feedback loop keeps
  // the offsets moving, so the poll times out and fails; the old two-frame
  // equality snapshot also failed when a late smooth-scroll frame landed
  // between samples under CPU load, which is a runner artifact, not a loop.
  const snap = () =>
    page.evaluate(() => ({
      e: document.querySelector('.cm-scroller')!.scrollTop,
      p: document.querySelector('.split-preview')!.scrollTop,
    }));
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const current = JSON.stringify(await snap());
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { intervals: [100, 100, 250, 250, 500], timeout: 5000 }
    )
    .toBe(true);
});

test('E59: mode toggling carries the reading position — edit ↔ preview stay on the same block', async ({
  page,
}) => {
  await splitApp(page, false); // full edit on the long doc
  const editor = page.locator('.cm-scroller');
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.5));
  await expect.poll(() => editorTopGutterLine(page)).toBeGreaterThan(1);
  const line = await editorTopGutterLine(page);

  await page.keyboard.press('Control+e'); // → preview: same block at the top
  await expect(page.getByTestId('doc').locator('h2').first()).toBeVisible();
  await expect
    .poll(async () => {
      const { before, after } = await previewTopAnchorLines(page, '.workspace');
      return line >= before - 5 && line <= after + 5;
    })
    .toBe(true);

  await page.keyboard.press('Control+e'); // → back to edit: same line at the top
  await expect.poll(() => editorTopGutterLine(page)).toBeGreaterThan(line - 6);
  expect(await editorTopGutterLine(page)).toBeLessThan(line + 6);
});

test('E80: split-preview selections mirror into the editor as exact source ranges; fallback covers lines', async ({
  page,
}) => {
  const FILLER = Array.from({ length: 60 }, (_, i) => `filler line ${i + 1}`).join('\n\n');
  await fsWrite(
    page,
    '/docs/mirror.md',
    `# Mirror Title\n\n${FILLER}\n\nThe **quick brown** fox jumps far.\n\nrepeat me and repeat me.\n`
  );
  await page.goto('/#open=/docs/mirror.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Mirror Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  // The lazy editor must be mounted (its selection hook registered) first.
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  // Real flow: the user's mousedown in the preview blurs the editor before
  // the drag-selection exists (a focused CM re-asserts its own selection).
  await page.getByTestId('split-preview').click({ position: { x: 10, y: 10 } });

  // A phrase crossing a bold boundary lands on the exact SOURCE spelling.
  const edScroller = page.locator('[data-testid="editor"] .cm-scroller');
  const edTopBefore = await edScroller.evaluate((el) => el.scrollTop);
  await selectSpanInPane(page, '[data-testid="split-preview"] .doc', 'brown', 'fox jumps');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('brown** fox jumps');
  // SPEC23 §1.3 (amended by issue #278): the mirror is scroll-neutral — the
  // editor does NOT scroll to the mirrored range (E464 covers both panes).
  await page.waitForTimeout(300); // outlast any jolt-and-settle
  expect(Math.abs((await edScroller.evaluate((el) => el.scrollTop)) - edTopBefore)).toBeLessThan(2);
  // The unfocused editor still DRAWS the selection — visible once the user
  // scrolls to it themselves.
  await edScroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect
    .poll(() => page.locator('[data-testid="editor"] .cm-selectionBackground').count())
    .toBeGreaterThan(0);
  // The preview's own selection survived the mirror.
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('brown fox jumps');

  // A collapsed selection (click/caret) never touches the editor selection.
  await page.evaluate(() => {
    const sel = window.getSelection()!;
    sel.collapseToStart();
  });
  await page.waitForTimeout(300); // debounce window
  expect(await page.evaluate(() => window.__mmEdit?.selText)).toBe('brown** fox jumps');

  // Ambiguous text (two identical phrases in range) → covering-line fallback.
  await selectPhraseInPane(page, '[data-testid="split-preview"] .doc', 'repeat me');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('repeat me and repeat me.');
});

test('E464: Issue #278 — a preview selection is scroll-neutral: neither pane moves, sync scrolling on or off', async ({
  page,
}) => {
  await splitApp(page); // long doc, split edit, sync scrolling on (default)
  const editor = page.locator('[data-testid="editor"] .cm-scroller');
  const preview = page.getByTestId('split-preview');
  const scrollTops = async () => ({
    editor: await editor.evaluate((el) => el.scrollTop),
    preview: await preview.evaluate((el) => el.scrollTop),
  });
  // SPEC23 §1.3 (amended by issue #278): selecting `phrase` in the preview
  // mirrors it into the editor and moves NEITHER pane's scroll position.
  const expectScrollNeutralSelection = async (phrase: string) => {
    const before = await scrollTops();
    await selectPhraseInPane(page, '[data-testid="split-preview"] .doc', phrase);
    await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe(phrase);
    await page.waitForTimeout(300); // outlast any jolt-and-settle
    const after = await scrollTops();
    expect(Math.abs(after.editor - before.editor)).toBeLessThan(2);
    expect(Math.abs(after.preview - before.preview)).toBeLessThan(2);
  };

  // Mid-document: scroll the editor half-way; the SPEC15 follower aligns
  // the preview.
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.5));
  await expect.poll(() => preview.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  // Blur the editor the way a real preview interaction does (pointerdown);
  // the click's caret placement is itself scroll-neutral now (SPEC44 §4 as
  // amended by issue #345) — let it settle all the same.
  await preview.click({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(400);
  await expectScrollNeutralSelection('Marker 30');

  // Sync scrolling OFF: the editor must not jump on its own either.
  await page.getByTestId('sync-scroll-toggle').click();
  await expect(page.getByTestId('sync-scroll-toggle')).toHaveAttribute('data-state', 'off');
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.25));
  await preview.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.6));
  await page.waitForTimeout(300); // free-scroll: no follower, just settle
  await expectScrollNeutralSelection('Marker 12');
});

test('E83: editor selections mirror into the split preview as synthetic marks; both directions coexist loop-free', async ({
  page,
}) => {
  await fsWrite(page, '/docs/rev.md', '# Rev Title\n\nThe **quick brown** fox jumps far.\n\nsame para\n\nsame para\n');
  await page.goto('/#open=/docs/rev.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Rev Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  // Keyboard-select the whole bold-bearing source line.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'quick brown' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');

  // The preview shows the rendered sentence as synthetic marks.
  const marks = page.locator('[data-testid="split-preview"] .doc mark.mm-mirror-sel');
  await expect.poll(async () => (await marks.allTextContents()).join('')).toBe('The quick brown fox jumps far.');
  // Inert to the comment machinery: not .hl, no data-cid.
  expect(await page.locator('[data-testid="split-preview"] .doc mark.hl').count()).toBe(0);
  expect(await marks.first().getAttribute('data-cid')).toBeNull();
  // The editor's own selection is undisturbed — no feedback loop.
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('The **quick brown** fox jumps far.');

  // Collapsing clears the marks.
  await page.keyboard.press('End');
  await expect(marks).toHaveCount(0);

  // Cross-block selection (rendered blocks have no separator) → region fallback.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'same para' }).first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+End');
  await expect.poll(async () => (await marks.allTextContents()).join('')).toBe('same parasame para');

  // The forward direction still works afterwards, and the unfocused report
  // that its CM dispatch produces clears the reverse marks.
  await page.getByTestId('split-preview').click({ position: { x: 10, y: 10 } });
  await selectSpanInPane(page, '[data-testid="split-preview"] .doc', 'quick', 'fox');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('quick brown** fox');
  await expect(marks).toHaveCount(0);
});

test('E84: ⌘\\ toggles split live — buffer, selection, and undo survive; setting persists; menu checkbox drives it', async ({
  page,
}) => {
  // PRD 003 Reqs 6–7 scope: full preview is a different surface, not a
  // "closed preview" — neither edge chevron renders there.
  await expect(page.getByTestId('preview-collapse')).toHaveCount(0);
  await expect(page.getByTestId('preview-expand')).toHaveCount(0);

  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toBeVisible(); // default on

  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('SPLITMARK ');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toContain('SPLITMARK');

  // Toggle to full-screen edit: everything carried across the remount.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('SPLITMARK');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toContain('SPLITMARK');
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"splitEdit": false');

  // Undo still reaches across the remount and removes the typed run.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('SPLITMARK');

  // Back to split.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"splitEdit": true');

  // PRD 003 Reqs 6–7: the edge chevrons drive the same toggle. Split open →
  // the collapse chevron sits at the preview's top-right corner (and the
  // expand one doesn't exist).
  const collapse = page.getByTestId('preview-collapse');
  const expand = page.getByTestId('preview-expand');
  await expect(collapse).toBeVisible();
  await expect(expand).toHaveCount(0);
  // Req 13: each preview chevron carries its tooltip + aria-label pair.
  await expect(collapse).toHaveAttribute('title', 'Hide the preview pane');
  await expect(collapse).toHaveAttribute('aria-label', 'Hide the preview pane');
  // Issue #328: the reopen mounts in place — settled means transform-free.
  await expect
    .poll(() => page.getByTestId('split-preview').evaluate((el) => getComputedStyle(el).transform))
    .toBe('none');
  const previewBox = (await page.getByTestId('split-preview').boundingBox())!;
  const collapseBox = (await collapse.boundingBox())!;
  // Issue #284 (PRD 023 §14): the comments chevron is the right-most edge
  // tab now — the preview chevron sits immediately to ITS left.
  const commentsBox = (await page.getByTestId('comments-expand').boundingBox())!;
  // PRD 025 Req 19 (issue #330): the labelled Edit toggle closes the group
  // and hugs the right edge; the comments chevron sits immediately left of it.
  const toggleBox = (await page.getByTestId('edit-toggle').boundingBox())!;
  expect(toggleBox.x + toggleBox.width).toBeGreaterThan(previewBox.x + previewBox.width - 24); // hugs the right edge
  expect(commentsBox.x + commentsBox.width).toBeLessThanOrEqual(toggleBox.x + 1);
  expect(collapseBox.x + collapseBox.width).toBeLessThanOrEqual(commentsBox.x + 1);
  expect(commentsBox.x - (collapseBox.x + collapseBox.width)).toBeLessThan(8);
  expect(collapseBox.y).toBeLessThan(previewBox.y + 64); // near the top

  // Clicking it closes the split (today's full-screen editor), persisted.
  // SPEC12 §1.3 cross-source dedup window: the pane switches instantly now
  // (issue #328), so nothing else spaces this toggle from the last one.
  await page.waitForTimeout(250);
  await collapse.click();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect(collapse).toHaveCount(0);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"splitEdit": false');

  // Closed → the expand chevron pins at the full-screen editor's top-right
  // edge and reopens the split.
  await expect(expand).toBeVisible();
  await expect(expand).toHaveAttribute('title', 'Show the preview pane');
  await expect(expand).toHaveAttribute('aria-label', 'Show the preview pane');
  const viewport = page.viewportSize()!;
  // The chevron re-pins once the preview has left the DOM.
  // Issue #284: the comments chevron sits right of the preview chevron, which
  // re-pins immediately left of it; PRD 025 Req 19 (issue #330): the labelled
  // Edit toggle holds the corner itself, right of the comments chevron.
  const commentsLeftGap = async () => {
    const b = (await expand.boundingBox())!;
    const c = (await page.getByTestId('comments-expand').boundingBox())!;
    return c.x - (b.x + b.width);
  };
  await expect.poll(commentsLeftGap).toBeLessThan(8);
  expect(await commentsLeftGap()).toBeGreaterThanOrEqual(-1);
  // PRD 025 Req 7 withdrawn by issue #348: the corner is the PAGE COLUMN's,
  // which stays centred with both panes closed — never the window's edge.
  const cornerBox = (await page.getByTestId('edit-toggle').boundingBox())!;
  const column = (await page.locator('.workspace-stack').boundingBox())!;
  expect(column.x + column.width).toBeLessThanOrEqual(viewport.width);
  expect(cornerBox.x + cornerBox.width).toBeGreaterThan(column.x + column.width - 24);
  await expand.click();
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(expand).toHaveCount(0);
  await expect(collapse).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"splitEdit": true');

  // Req 8: the Settings checkbox stays in sync with chevron clicks, and
  // drives the same surface back.
  await openSettings(page, 'general');
  await expect(page.getByTestId('set-split-edit')).toBeChecked();
  await saveSettings(page);
  await collapse.click();
  await openSettings(page, 'general');
  await expect(page.getByTestId('set-split-edit')).not.toBeChecked();
  await page.getByTestId('set-split-edit').check();
  await saveSettings(page);
  await expect(collapse).toBeVisible();

  // Native-menu surface: View carries the checkbox and click() toggles it.
  await freshNativeMenuApp(page);
  const splitItem = () =>
    page.evaluate(() => {
      const view = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!;
      return view.items.find((i) => i.type === 'command' && i.command === 'toggleSplit') as {
        label?: string;
        checked?: boolean;
        accelerator?: string;
      };
    });
  expect((await splitItem()).label).toBe('Split Edit');
  expect((await splitItem()).checked).toBe(true); // fresh settings → default on
  expect((await splitItem()).accelerator).toBe('Mod+\\');
  await menuClick(page, 'toggleSplit');
  await expect.poll(async () => (await splitItem()).checked).toBe(false);

  // Req 8: a chevron click drives the native checkbox too. Split is off now —
  // open a doc, enter edit, and the expand chevron reopens the split.
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await page.keyboard.press('Control+e');
  await page.getByTestId('preview-expand').click();
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect.poll(async () => (await splitItem()).checked).toBe(true);
});

test('E85: the selection survives ⌘E in both directions, in full and split layouts', async ({ page }) => {
  await fsWrite(
    page,
    '/docs/carry.md',
    '# Carry Title\n\nThe **quick brown** fox jumps far.\n\nanother paragraph entirely.\n'
  );
  await page.goto('/#open=/docs/carry.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Carry Title');

  // Preview → edit (split): the preview selection becomes the exact source
  // selection, and the reverse mirror lights the split preview.
  await selectSpanInPane(page, '[data-testid="doc"]', 'quick', 'fox jumps');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('quick brown** fox jumps');
  const marks = page.locator('[data-testid="split-preview"] .doc mark.mm-mirror-sel');
  await expect.poll(async () => (await marks.allTextContents()).join('')).toBe('quick brown fox jumps');

  // Split → full edit (⌘\): the selection rides the parked editor state.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('quick brown** fox jumps');

  // Edit → preview: the carried range becomes a NATIVE selection of the
  // rendered text (markers stripped).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe(
    'quick brown fox jumps'
  );

  // Preview → edit again with a different phrase (full-screen edit now).
  await selectPhraseInPane(page, '[data-testid="doc"]', 'another paragraph');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('another paragraph');
  // It is a real selection: typing over it replaces the text.
  await page.keyboard.type('REPLACED');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('REPLACED entirely.');
  await page.keyboard.press('ControlOrMeta+z');

  // Collapsed selections carry nothing: collapse in the editor, toggle to
  // preview — no native selection materializes there.
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__mmEdit && window.__mmEdit.selFrom === window.__mmEdit.selTo)).toBe(
    true
  );
  await page.keyboard.press('Control+e'); // to preview
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Carry Title');
  await page.waitForTimeout(250); // past the restore effect's window
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe('');
});

test('E124: split mode — the caret line alone is tinted in the editor; no word or block cue in either pane on caret moves, repeats, selection or typing', async ({
  page,
}) => {
  await fsWrite(page, '/docs/place.md', '# Title\n\nalpha beta gamma\n\ncat and cat again\n\n- one two\n- three four\n- five six\n');
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await page.goto('/#open=/docs/place.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  // Issue #345: the editor keeps CodeMirror's caret-line tint and nothing
  // else; the preview paints no cue at all (SPEC44 §2.2 and §3 withdrawn).
  const edLine = page.locator('.cm-content .cm-activeLine');
  const edWord = page.locator('.cm-content .mm-active-word');
  const pvWord = page.locator('[data-testid="split-preview"] .doc mark.mm-active-word');
  const pvBlock = page.locator('[data-testid="split-preview"] .doc .mm-active-block');
  // The invisible head-row anchor the split follower reads (issue #310).
  const pvHead = page.locator('[data-testid="split-preview"] .doc [data-mm-head]');
  const noCues = async () => {
    await expect(edWord).toHaveCount(0);
    await expect(pvWord).toHaveCount(0);
    await expect(pvBlock).toHaveCount(0);
  };

  // Caret inside "alpha": the caret line is tinted, no word cue anywhere.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'alpha beta gamma' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(edLine).toHaveCount(1);
  await expect(edLine).toHaveText('alpha beta gamma');
  await noCues();
  await expect(pvHead).toHaveCount(1);
  await expect(pvHead).toContainText('alpha beta gamma');

  // Arrow into "beta": still only the line.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe('# Title\n\nalpha b'.length);
  await expect(edLine).toHaveText('alpha beta gamma');
  await noCues();

  // Repeats: the invisible anchor is position-exact — the caret's own
  // occurrence (its text offset inside the paragraph), never a text search.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'cat and cat again' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await expect(edLine).toHaveText('cat and cat again');
  await noCues();
  await expect(pvHead).toHaveCount(1);
  await expect(pvHead).toHaveAttribute('data-mm-head', '9'); // after "cat and c"
  await expect(pvHead).toContainText('cat and cat again');
  // Nothing was inserted for it: the paragraph is still ONE text node.
  expect(await pvHead.evaluate((el) => el.childNodes.length)).toBe(1);

  // A real selection: the line tint stays, still no cue in either pane.
  await page.keyboard.press('Shift+End');
  await expect(edLine).toHaveCount(1);
  await noCues();
  await expect(pvHead).toHaveCount(1);

  // Typing: the re-render brings no cue back.
  await page.keyboard.press('End');
  await page.keyboard.type(' zeta');
  await expect(page.getByTestId('split-preview')).toContainText('cat and cat again zeta');
  await noCues();
  await expect(pvHead).toContainText('zeta');

  // A stamped block can be a whole LIST — no tint on it or its items; the
  // anchor still lands on the caret's own item.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'three four' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(edLine).toContainText('three four');
  await noCues();
  await expect(pvHead).toHaveCount(1);
  await expect(pvHead).toContainText('three four');
  await expect(pvHead).not.toContainText('one two');
  expect(await pvHead.evaluate((el) => el.tagName)).toBe('LI');
});

test('E125: preview clicks place the caret with no cue and no scroll — split silently, preview-only carried into Mod+E; links stay links', async ({
  page,
}) => {
  await fsWrite(page, '/docs/click.md', '# Click\n\nalpha beta gamma\n\nplus +++ plus2\n\n[ext](https://example.com/x)\n');
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await page.goto('/#open=/docs/click.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Click');
  const docCues = page.locator('[data-testid="doc"] .mm-active-block, [data-testid="doc"] mark.mm-active-word');
  const pvCues = page.locator(
    '[data-testid="split-preview"] .doc .mm-active-block, [data-testid="split-preview"] .doc mark.mm-active-word'
  );
  const edWord = page.locator('.cm-content .mm-active-word');
  const edLine = page.locator('.cm-content .cm-activeLine');

  // Preview-only: click a word → nothing visible changes (issue #345), the
  // pane does not scroll, and the caret is parked for Mod+E.
  const ws = page.locator('.workspace');
  const wsBefore = await ws.evaluate((el) => el.scrollTop);
  await clickWord(page, '[data-testid="doc"]', 'beta');
  await page.waitForTimeout(300);
  await expect(docCues).toHaveCount(0);
  expect(Math.abs((await ws.evaluate((el) => el.scrollTop)) - wsBefore)).toBeLessThan(2);
  // A link click keeps its existing behavior — placement skipped, so the
  // parked caret from the word click survives it.
  await page.locator('[data-testid="doc"] a[href]').click();
  await expect(docCues).toHaveCount(0);

  // Mod+E lands the editor caret on that word (the E85 contract, collapsed).
  // Issue #178: at the exact CLICKED offset inside it (clickWord aims at the
  // word's center), no longer pinned to the word's start.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  const betaBase = '# Click\n\nalpha '.length;
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBeGreaterThanOrEqual(betaBase);
  expect(await page.evaluate(() => window.__mmEdit?.selFrom)).toBeLessThanOrEqual(betaBase + 'beta'.length);
  await expect(edLine).toHaveText('alpha beta gamma');
  await expect(edWord).toHaveCount(0);

  // Split mode: clicking a preview word moves the editor caret to it
  // (Issue #178: to the clicked offset within it) — silently: no cue in
  // either pane, no scroll of either pane, the editor not focused.
  const editor = page.locator('[data-testid="editor"] .cm-scroller');
  const preview = page.getByTestId('split-preview');
  const edBefore = await editor.evaluate((el) => el.scrollTop);
  const pvBefore = await preview.evaluate((el) => el.scrollTop);
  await clickWord(page, '[data-testid="split-preview"] .doc', 'gamma');
  const gammaBase = '# Click\n\nalpha beta '.length;
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBeGreaterThanOrEqual(gammaBase);
  expect(await page.evaluate(() => window.__mmEdit?.selFrom)).toBeLessThanOrEqual(gammaBase + 'gamma'.length);
  await page.waitForTimeout(300);
  await expect(pvCues).toHaveCount(0);
  await expect(edWord).toHaveCount(0);
  await expect(edLine).toHaveText('alpha beta gamma');
  expect(await page.evaluate(() => window.__mmEdit?.focused)).toBe(false);
  expect(Math.abs((await editor.evaluate((el) => el.scrollTop)) - edBefore)).toBeLessThan(2);
  expect(Math.abs((await preview.evaluate((el) => el.scrollTop)) - pvBefore)).toBeLessThan(2);

  // A no-word click (punctuation run) still moves the caret — Issue #178:
  // into the clicked run via the flat prefix, not just to the block start.
  // The invisible head anchor follows it; still nothing painted.
  await clickWord(page, '[data-testid="split-preview"] .doc', '+++');
  const plusBase = '# Click\n\nalpha beta gamma\n\nplus '.length;
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBeGreaterThanOrEqual(plusBase);
  expect(await page.evaluate(() => window.__mmEdit?.selFrom)).toBeLessThanOrEqual(plusBase + '+++'.length);
  const pvHead = page.locator('[data-testid="split-preview"] .doc [data-mm-head]');
  await expect(pvHead).toHaveCount(1);
  await expect(pvHead).toContainText('plus +++ plus2');
  await expect(pvCues).toHaveCount(0);
  await expect(edLine).toHaveText('plus +++ plus2');
});

test('E373: Issue #178 — a collapsed preview caret carries into edit at the exact clicked offset', async ({ page }) => {
  await fsWrite(page, '/docs/caret.md', '# Caret\n\nThe **quick brown** fox jumps far.\n\ncat and cat again.\n');
  await page.goto('/#open=/docs/caret.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Caret');

  // The boundary before the 'm' of 'jumps': the source offset is exact even
  // though the stripped ** markers shift everything after them.
  await clickCharBoundary(page, '[data-testid="doc"]', 'jumps', 2);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  const at = '# Caret\n\nThe **quick brown** fox ju'.length;
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe(at);
  expect(await page.evaluate(() => window.__mmEdit?.selTo)).toBe(at);
  // The caret is on-screen: the whole 5-line document sits in the viewport.
  await expect.poll(() => editorTopGutterLine(page)).toBeLessThanOrEqual(3);

  // A repeated word resolves by the CARET's occurrence, not the first match.
  await page.keyboard.press('Control+e'); // back to preview
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Caret');
  await clickCharBoundary(page, '[data-testid="doc"]', 'cat', 1, 1); // 2nd 'cat', offset 1
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  const at2 = '# Caret\n\nThe **quick brown** fox jumps far.\n\ncat and c'.length;
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe(at2);
  expect(await page.evaluate(() => window.__mmEdit?.selTo)).toBe(at2);
});

test('E374: Issue #178 — the collapsed caret and top line survive edit → preview → edit; a scrolled preview keeps scroll authority', async ({
  page,
}) => {
  await splitApp(page, false); // long doc, currently in full edit
  // A collapsed caret a few characters into the first line.
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe(5);
  expect(await page.evaluate(() => window.__mmEdit?.selTo)).toBe(5);

  // Round trip with NO preview interaction: the exact caret and the top
  // visible line both return (parked history + the SPEC16 §3.2 carry).
  await page.keyboard.press('Control+e'); // → preview
  await expect(page.getByTestId('doc').locator('h2').first()).toBeVisible();
  await page.waitForTimeout(250); // past the selection-restore window (E85)
  await page.keyboard.press('Control+e'); // → edit
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe(5);
  expect(await page.evaluate(() => window.__mmEdit?.selTo)).toBe(5);
  await expect.poll(() => editorTopGutterLine(page)).toBeLessThanOrEqual(3);

  // Scroll the preview before toggling back: the editor opens at the
  // scrolled-to position and the restored off-screen caret does NOT yank
  // the viewport up to itself.
  await page.keyboard.press('Control+e'); // → preview (at the top)
  await expect(page.getByTestId('doc').locator('h2').first()).toBeVisible();
  const ws = page.locator('.workspace');
  await ws.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.5));
  const anchors = await previewTopAnchorLines(page, '.workspace');
  await page.keyboard.press('Control+e'); // → edit
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  // The caret survived untouched…
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe(5);
  // …while the viewport stayed with the scroll carry, far below line 1.
  await expect.poll(() => editorTopGutterLine(page), { timeout: 20000 }).toBeGreaterThanOrEqual(anchors.before - 2);
  expect(await editorTopGutterLine(page)).toBeLessThanOrEqual(anchors.after + 2);
  expect(await editorTopGutterLine(page)).toBeGreaterThan(20);
});

test('E126: hygiene — comments anchor across a click, find marks stand alone, the find bar leaves no word cue, --mm-active-line drives the editor line, doc switch leaves nothing', async ({
  page,
}) => {
  await fsWrite(page, '/docs/hyg.md', '# Hyg\n\nalpha beta gamma delta\n');
  await fsWrite(page, '/docs/other.md', '# Other\n\nplain here\n');
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await page.goto('/#open=/docs/hyg.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Hyg');
  const docCues = page.locator('[data-testid="doc"] .mm-active-block, [data-testid="doc"] mark.mm-active-word');
  const edWord = page.locator('.cm-content .mm-active-word');

  // A click parks the caret and paints nothing (issue #345)…
  await clickWord(page, '[data-testid="doc"]', 'beta');
  await expect(docCues).toHaveCount(0);
  // …and the comment coordinate space is undisturbed: a comment over a span
  // crossing the clicked word anchors exactly (no synthetic mark ever
  // fragmented the paragraph's text node).
  expect(await page.locator('[data-testid="doc"] p').first().evaluate((el) => el.childNodes.length)).toBe(1);
  await selectSpanInPane(page, '[data-testid="doc"]', 'beta', 'delta');
  // Issue #286: the popup is gone — the Insert Comment hotkey authors it.
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await page.getByTestId('composer-input').fill('anchored fine');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(async () => (await page.locator('[data-testid="doc"] mark.hl').allTextContents()).join(''))
    .toContain('beta gamma delta');

  // Find marks stand alone in the preview — no word cue beside them.
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByTestId('find-input').fill('beta');
  await expect(page.locator('[data-testid="doc"] mark.mm-find')).toHaveCount(1);
  await expect(docCues).toHaveCount(0);
  await page.keyboard.press('Escape');

  // In edit mode the caret line is tinted and no word cue exists — before
  // the find bar opens, while it is open, and after it closes.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'alpha beta' }).click();
  await expect(page.locator('.cm-content .cm-activeLine')).toHaveText('alpha beta gamma delta');
  await expect(edWord).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByTestId('find-input')).toBeVisible();
  await expect(edWord).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Click back into the editor: focus returns, the find-match selection
  // collapses, and the line tint is all that shows.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'alpha beta' }).click();
  await expect(page.locator('.cm-content .cm-activeLine')).toHaveText('alpha beta gamma delta');
  await expect(edWord).toHaveCount(0);

  // SPEC44 §2.1 (issue #345): the theme token drives the line tint — a
  // theme overriding --mm-active-line recolours CodeMirror's active line.
  const color = await page.evaluate(() => {
    document.querySelector<HTMLElement>('.theme-root')!.style.setProperty('--mm-active-line', 'rgb(1, 2, 3)');
    const line = document.querySelector('.cm-content .cm-activeLine')!;
    return getComputedStyle(line).backgroundColor;
  });
  expect(color).toBe('rgb(1, 2, 3)');

  // A doc switch leaves nothing on the incoming document.
  await page.keyboard.press('Control+e');
  await page.goto('/#open=/docs/other.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Other');
  await expect(docCues).toHaveCount(0);
  await expect(page.locator('[data-testid="doc"] [data-mm-head]')).toHaveCount(0);
});

test('E127: granularity invariant — drags, punctuation carets, table cells, quotes, whitespace clicks tint nothing; the invisible head anchor lands on ONE innermost container', async ({
  page,
}) => {
  await fsWrite(
    page,
    '/docs/grain.md',
    '# G\n\n- one two\n- three four\n- pp +++ qq\n\n| h1 | h2 |\n| -- | -- |\n| ca | cb |\n\n> quoted words here\n'
  );
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await page.goto('/#open=/docs/grain.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('G');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  // Issue #345: no block tint ever; the SPEC44 §3.1 one-innermost-container
  // invariant now holds for the invisible `data-mm-head` stamp the split
  // follower reads (issue #310) — an attribute no rule styles.
  const tint = page.locator('[data-testid="split-preview"] .doc .mm-active-block');
  const head = page.locator('[data-testid="split-preview"] .doc [data-mm-head]');

  // Multi-word drag INSIDE one bullet: exactly that li, siblings excluded.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'three four' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect(head).toHaveCount(1);
  await expect(head).toContainText('three four');
  await expect(head).not.toContainText('one two');
  expect(await head.evaluate((el) => el.tagName)).toBe('LI');
  await expect(tint).toHaveCount(0);

  // Drag across two bullets: the HEAD's li wins, live.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'one two' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(head).toHaveCount(1);
  await expect(head).toContainText('three four');
  await expect(head).not.toContainText('one two');
  await expect(tint).toHaveCount(0);

  // Collapsed caret on a punctuation run inside a bullet: that li.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'pp +++ qq' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); // inside +++
  await expect(head).toHaveCount(1);
  await expect(head).toContainText('pp +++ qq');
  await expect(head).not.toContainText('three four');
  expect(await head.evaluate((el) => el.tagName)).toBe('LI');
  await expect(tint).toHaveCount(0);

  // Caret inside a table cell: the td, not the table.
  await page.getByTestId('editor').locator('.cm-line', { hasText: '| ca | cb |' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(head).toHaveCount(1);
  await expect(head).toHaveText(/ca/);
  await expect(head).not.toContainText('cb');
  expect(await head.evaluate((el) => el.tagName)).toBe('TD');
  await expect(tint).toHaveCount(0);

  // Caret in a blockquote: the inner container, never the whole quote.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'quoted words here' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(head).toHaveCount(1);
  await expect(head).toContainText('quoted words here');
  expect(await head.evaluate((el) => el.tagName)).not.toBe('BLOCKQUOTE');
  await expect(tint).toHaveCount(0);

  // Preview punctuation-click inside a bullet: that bullet's li — silently.
  await clickWord(page, '[data-testid="split-preview"] .doc', '+++');
  await expect(head).toHaveCount(1);
  await expect(head).toContainText('pp +++ qq');
  await expect(head).not.toContainText('one two');
  await expect(tint).toHaveCount(0);
  await expect(page.locator('[data-testid="split-preview"] .doc mark.mm-active-word')).toHaveCount(0);
});

test('E128: cue-anchored split sync — the caret row stays level with the invisible head row in both panes while either pane scrolls', async ({
  page,
}) => {
  const paras = Array.from({ length: 40 }, (_, i) => `para ${i} filler text line\n`).join('\n');
  await fsWrite(page, '/docs/sync.md', `# S\n\n${paras}\n## target word here\n\n${paras}`);
  await page.goto('/#open=/docs/sync.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('S');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  // Scroll the (virtualized) editor until the heading renders, then click
  // into it — the caret lands mid-document and the invisible head anchor
  // (issue #345: no word mark any more) follows onto the heading.
  const target = page.getByTestId('editor').locator('.cm-line', { hasText: 'target word here' });
  await page.getByTestId('editor').locator('.cm-content').hover();
  for (let i = 0; i < 80 && (await target.count()) === 0; i++) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(40);
  }
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); // past '## '
  const pvHead = page.locator('[data-testid="split-preview"] .doc [data-mm-head]');
  await expect(pvHead).toHaveText('target word here');
  await expect(page.locator('[data-testid="split-preview"] .doc mark.mm-active-word')).toHaveCount(0);
  await expect(page.locator('[data-testid="split-preview"] .doc .mm-active-block')).toHaveCount(0);

  // The editor's caret row (the drawn cursor) against the preview's head
  // row (the character at the stamped offset) — the issue #310 yardstick.
  const levels = () => caretLevelGap(page);

  // Scroll the editor a few steps: the row stays LEVEL — a small stable
  // structural offset (font/margin asymmetry) is allowed, drift is not.
  await page.getByTestId('editor').locator('.cm-content').hover();
  let base: number | null = null;
  for (const dy of [200, 200, -150]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(250);
    const d = await levels();
    expect(d).toBeLessThan(90);
    if (base === null) base = d;
    expect(Math.abs(d - base)).toBeLessThan(15); // tracks, no drift
  }

  // Preview leads: same contract.
  await page.getByTestId('split-preview').hover();
  for (const dy of [220, -180]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(250);
    const d = await levels();
    expect(d).toBeLessThan(90);
    expect(Math.abs(d - base!)).toBeLessThan(15);
  }
});

// --- Issue #345: no cues, no scroll on a preview click ------------------------

test('E623: Issue #345 — a plain split-preview click far below the editor viewport places the caret and scrolls NEITHER pane, sync on', async ({
  page,
}) => {
  // The E464 long document, with a NARROW editor pane (the persisted ratio
  // seeds the mount, E40) so its wrapped rows cover far fewer sections than
  // the wide preview shows: the preview's lowest visible paragraph sits well
  // below the editor's last visible line.
  await freshApp(page);
  await page.evaluate(() => {
    const sections: string[] = [];
    for (let i = 1; i <= 40; i++) {
      sections.push(`## Marker ${i}\n`);
      sections.push(`Paragraph for section ${i}. `.repeat(8) + '\n');
    }
    window.__mmfs!.write('/docs/far.md', sections.join('\n'));
    const raw = window.__mmfs!.read('/config/settings.json');
    const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.__mmfs!.write('/config/settings.json', JSON.stringify({ ...settings, splitEdit: true, splitRatio: 0.25 }));
  });
  await page.reload();
  await page.goto('/#open=/docs/far.md');
  await expect(page.getByTestId('doc').locator('h2').first()).toContainText('Marker 1');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('sync-scroll-toggle')).toHaveAttribute('data-state', 'on');
  const editor = page.locator('[data-testid="editor"] .cm-scroller');
  const preview = page.getByTestId('split-preview');
  await page.waitForTimeout(300); // the mount-time realign settles

  // The lowest paragraph fully inside the preview viewport, and its source
  // line — far below the editor's last visible row (the precondition that
  // makes a `reveal` visible as an editor scroll).
  const section = await preview.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const ps = Array.from(el.querySelectorAll('.doc p')).filter((p) => {
      const b = p.getBoundingClientRect();
      return b.top >= r.top && b.bottom <= r.bottom;
    });
    const m = /section (\d+)\./.exec(ps[ps.length - 1]?.textContent ?? '');
    return m ? Number(m[1]) : -1;
  });
  expect(section).toBeGreaterThan(1);
  const text = (await fsRead(page, '/docs/far.md'))!;
  const pStart = text.indexOf(`Paragraph for section ${section}. `);
  const pLine = text.slice(0, pStart).split('\n').length;
  expect(pLine).toBeGreaterThan((await editorBottomGutterLine(page)) + 3);

  const edBefore = await editor.evaluate((el) => el.scrollTop);
  const pvBefore = await preview.evaluate((el) => el.scrollTop);
  await clickWord(page, '[data-testid="split-preview"] .doc', `section ${section}.`);
  // The caret landed inside the clicked sentence (issue #178)…
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBeGreaterThanOrEqual(pStart);
  expect(await page.evaluate(() => window.__mmEdit?.selFrom)).toBeLessThanOrEqual(pStart + `Paragraph for section ${section}.`.length);
  expect(await page.evaluate(() => window.__mmEdit?.focused)).toBe(false);
  // …silently: after a settle neither pane moved, and nothing was painted.
  await page.waitForTimeout(400);
  expect(Math.abs((await editor.evaluate((el) => el.scrollTop)) - edBefore)).toBeLessThan(2);
  expect(Math.abs((await preview.evaluate((el) => el.scrollTop)) - pvBefore)).toBeLessThan(2);
  await expect(
    page.locator('[data-testid="split-preview"] .doc .mm-active-block, [data-testid="split-preview"] .doc mark.mm-active-word')
  ).toHaveCount(0);
  await expect(page.locator('.cm-content .mm-active-word')).toHaveCount(0);
  // The caret's line is still off-screen: the editor really did not reveal it.
  expect(await editorBottomGutterLine(page)).toBeLessThan(pLine);
});

test('E624: Issue #345 — a preview-only click scrolls nothing and paints nothing, still carries into Mod+E; a click-drag still authors a highlight', async ({
  page,
}) => {
  const paras = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} holds token tok${i}x and a few more words.\n`).join('\n');
  await fsWrite(page, '/docs/pv-click.md', `# PV\n\n${paras}`);
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await page.goto('/#open=/docs/pv-click.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('PV');
  const ws = page.locator('.workspace');
  await ws.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.5));
  await page.waitForTimeout(200);
  const before = await ws.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(100);

  // The first paragraph fully inside the viewport — its token is what we click.
  const n = await ws.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const p = Array.from(el.querySelectorAll('[data-testid="doc"] p')).find((c) => {
      const b = c.getBoundingClientRect();
      return b.top >= r.top && b.bottom <= r.bottom;
    });
    const m = /tok(\d+)x/.exec(p?.textContent ?? '');
    return m ? Number(m[1]) : -1;
  });
  expect(n).toBeGreaterThan(0);
  const token = `tok${n}x`;
  await clickWord(page, '[data-testid="doc"]', token);
  await page.waitForTimeout(400);
  expect(Math.abs((await ws.evaluate((el) => el.scrollTop)) - before)).toBeLessThan(2);
  await expect(
    page.locator('[data-testid="doc"] .mm-active-block, [data-testid="doc"] mark.mm-active-word, [data-testid="doc"] [data-mm-head]')
  ).toHaveCount(0);

  // Mod+E: the parked caret lands inside the clicked token (issue #178).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  const text = (await fsRead(page, '/docs/pv-click.md'))!;
  const at = text.indexOf(token);
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBeGreaterThanOrEqual(at);
  expect(await page.evaluate(() => window.__mmEdit?.selFrom)).toBeLessThanOrEqual(at + token.length);
  await expect(page.locator('.cm-content .mm-active-word')).toHaveCount(0);
  await expect(page.locator('.cm-content .cm-activeLine')).toContainText(token);

  // Back in the preview, a click-drag selection is the ONE visible selection
  // and still feeds the annotation flows (PRD 023 §13): the button appears
  // and a highlight is created from it.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('PV');
  await page.waitForTimeout(250); // past the selection-restore window (E85)
  await selectPhraseInPane(page, '[data-testid="doc"]', `${token} and a few`);
  await expect(page.getByTestId('smart-edit-selection')).toBeVisible();
  await previewSelectionAnnotation(page, 'highlight', 'hl-yellow');
  const mark = page.locator('[data-testid="doc"] mark.hl[data-color="yellow"]');
  await expect(mark.first()).toBeVisible();
  await expect(mark.first()).toContainText(token);
  await expect(page.locator('[data-testid="doc"] .mm-active-block, [data-testid="doc"] mark.mm-active-word')).toHaveCount(0);
});

test('E625: Issue #345 — --mm-active-line defaults to the accent at ~10% and is what paints the editor caret line; --mm-active-word is gone', async ({
  page,
}) => {
  await fsWrite(page, '/docs/tint.md', '# Tint\n\nfirst line here\n\nsecond line here\n');
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await page.goto('/#open=/docs/tint.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Tint');
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.theme-root')!);
    return { line: cs.getPropertyValue('--mm-active-line').trim(), word: cs.getPropertyValue('--mm-active-word').trim() };
  });
  // The TOKEN, not a pixel: raised from 5.5% to the 9–10% band.
  expect(tokens.line).toMatch(/color-mix\(/);
  expect(tokens.line).toMatch(/\b(9(\.\d+)?|10)%/);
  expect(tokens.word).toBe('');

  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'second line here' }).click();
  const line = page.locator('.cm-content .cm-activeLine');
  await expect(line).toHaveText('second line here');
  await expect(page.locator('.cm-content .mm-active-word')).toHaveCount(0);
  // Binding: the line reads the token — a fixed override shows through
  // unchanged, so CodeMirror's hardcoded base-theme pick is no longer what
  // paints it.
  const color = await page.evaluate(() => {
    document.querySelector<HTMLElement>('.theme-root')!.style.setProperty('--mm-active-line', 'rgb(4, 5, 6)');
    return getComputedStyle(document.querySelector('.cm-content .cm-activeLine')!).backgroundColor;
  });
  expect(color).toBe('rgb(4, 5, 6)');
});

test('E247: issue #125 — the edit/preview switch sits left of the preview chevron and flips the mode', async ({
  page,
}) => {
  const sw = page.getByTestId('mode-switch');
  const collapse = page.getByTestId('preview-collapse');

  // Preview: the switch is up (a document is open and editable), names the
  // move it makes, and its glyph shows the mode a click moves TO (pencil).
  await expect(sw).toBeVisible();
  await expect(sw).toHaveAttribute('data-mode', 'preview');
  await expect(sw).toHaveAttribute('title', 'Switch to edit');
  await expect(sw).toHaveAttribute('aria-label', 'Switch to edit');
  await expect(page.getByTestId('mode-switch-icon')).toHaveAttribute('data-icon', 'pencil');
  // PRD 003 Reqs 6–7: full preview is not a closed split — no preview
  // chevron there. Issue #284 (PRD 023 §14): the comments chevron IS there
  // (every mode), with the switch immediately left of it. PRD 025 Req 19
  // (issue #330): the labelled Edit toggle is the group's LAST member and
  // holds the corner, immediately right of the comments chevron.
  await expect(collapse).toHaveCount(0);
  await expect(page.getByTestId('preview-expand')).toHaveCount(0);
  const viewport = page.viewportSize()!;
  const commentsChevron = page.getByTestId('comments-expand');
  const editToggle = page.getByTestId('edit-toggle');
  await expect(commentsChevron).toBeVisible();
  const soloBox = (await stableBox(sw))!;
  const commentsSolo = (await stableBox(commentsChevron))!;
  const toggleSolo = (await stableBox(editToggle))!;
  // PRD 025 Req 7 withdrawn by issue #348: the corner is the centred page
  // column's, not the window's.
  const column = (await page.locator('.workspace-stack').boundingBox())!;
  expect(column.x + column.width).toBeLessThanOrEqual(viewport.width);
  expect(toggleSolo.x + toggleSolo.width).toBeGreaterThan(column.x + column.width - 24);
  expect(commentsSolo.x + commentsSolo.width).toBeLessThanOrEqual(toggleSolo.x + 1);
  expect(soloBox.x + soloBox.width).toBeLessThanOrEqual(commentsSolo.x + 1);

  // It dispatches toggleMode: preview → edit, exactly like ⌘E.
  await sw.click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('doc')).toHaveCount(0);
  await expect(sw).toHaveAttribute('data-mode', 'edit');
  await expect(sw).toHaveAttribute('title', 'Switch to preview');
  await expect(page.getByTestId('mode-switch-icon')).toHaveAttribute('data-icon', 'eye');

  // In edit mode both tabs are up, and the switch sits immediately to the
  // LEFT of the chevron — adjacent, on the same row, never overlapping.
  await expect(collapse).toBeVisible();
  const switchBox = (await stableBox(sw))!;
  const chevronBox = (await stableBox(collapse))!;
  expect(switchBox.x + switchBox.width).toBeLessThanOrEqual(chevronBox.x + 1);
  expect(chevronBox.x - (switchBox.x + switchBox.width)).toBeLessThan(8);
  expect(Math.abs(switchBox.y - chevronBox.y)).toBeLessThan(4);
  // Issue #284: the comments chevron sits right of the preview chevron;
  // issue #330: the Edit toggle sits right of THAT and takes the edge-hugging
  // spot.
  const commentsEdit = (await stableBox(commentsChevron))!;
  expect(chevronBox.x + chevronBox.width).toBeLessThanOrEqual(commentsEdit.x + 1);
  const toggleEdit = (await stableBox(editToggle))!;
  expect(commentsEdit.x + commentsEdit.width).toBeLessThanOrEqual(toggleEdit.x + 1);
  expect(toggleEdit.x + toggleEdit.width).toBeGreaterThan(viewport.width - 24);

  // The chevron still drives the split alone — the switch does not move.
  await collapse.click();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect(sw).toHaveAttribute('data-mode', 'edit');
  await page.getByTestId('preview-expand').click();
  await expect(page.getByTestId('split-preview')).toBeVisible();

  // And back: edit → preview through the same switch.
  await sw.click();
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(sw).toHaveAttribute('data-mode', 'preview');

  // PRD 007 Req 17 + issue #40: no document, no switch — the splash is
  // preview-only. (The labelled Edit toggle has a wider gate and stays on
  // the splash, inert — E141; PRD 025 Req 19, issue #330.)
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(sw).toHaveCount(0);
});

test('E248: issue #125 — the last chosen mode is remembered: a new document, and a restart, land in it', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__mmfs!.write('/docs/one.md', '# One\n\nFirst document.\n');
    window.__mmfs!.write('/docs/two.md', '# Two\n\nSecond document.\n');
  });

  // Preview is still the shipped default: nothing chosen yet, so a fresh open
  // reads as it always did.
  await page.goto('/#open=/docs/one.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('One');
  // Nothing chosen yet ⇒ nothing recorded: the User layer carries the key
  // only once the reader picks a mode.
  expect(await fsRead(page, '/config/settings.json')).not.toContain('lastViewMode');

  // Choose edit through the new switch — the choice is persisted, not just
  // held in memory.
  await page.getByTestId('mode-switch').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"lastViewMode": "edit"');

  // Opening a DIFFERENT document now lands in edit mode — and with splitEdit
  // on (the default), that is the editor plus the live preview.
  await page.goto('/#open=/docs/two.md');
  await expect(page.locator('.cm-content')).toContainText('Second document');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(page.getByTestId('split-preview').locator('h1')).toContainText('Two');

  // Switching back to an already-open (parked) tab keeps the remembered mode.
  await page.goto('/#open=/docs/one.md');
  await expect(page.locator('.cm-content')).toContainText('First document');
  await expect(page.getByTestId('editor')).toBeVisible();

  // A restart reads the mode back off disk: relaunch, open a document, and
  // the editor is what comes up.
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('First document');
  await page.goto('/#open=/docs/two.md');
  await expect(page.locator('.cm-content')).toContainText('Second document');
  await expect(page.getByTestId('editor')).toBeVisible();

  // Choosing preview again is remembered the same way, in both directions.
  await page.getByTestId('mode-switch').click();
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"lastViewMode": "preview"');
  await page.goto('/#open=/docs/one.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('One');
  await expect(page.getByTestId('editor')).toHaveCount(0);
});

test('E315: issue #167 — the sync toggle rides beside the mode switch, frees the panes, realigns on re-enable, hides via Settings', async ({
  page,
}) => {
  await splitApp(page);
  const btn = page.getByTestId('sync-scroll-toggle');
  const sw = page.getByTestId('mode-switch');

  // On by default, saying the move a click makes, immediately LEFT of the
  // edit/preview switch — adjacent, same row (the E247 idiom).
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('data-state', 'on');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAttribute('title', 'Scroll panes independently');
  const b = (await stableBox(btn))!;
  const s = (await stableBox(sw))!;
  expect(b.x + b.width).toBeLessThanOrEqual(s.x + 1);
  expect(s.x - (b.x + b.width)).toBeLessThan(8);
  expect(Math.abs(b.y - s.y)).toBeLessThan(4);

  // Absent where sync can mean nothing: full preview, and the collapsed split.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect(btn).toHaveCount(0);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await page.getByTestId('preview-collapse').click();
  await expect(btn).toHaveCount(0);
  await page.getByTestId('preview-expand').click();
  await expect(page.getByTestId('split-preview')).toBeVisible();

  // Off: the persisted flag flips and the panes free-scroll both ways.
  await btn.click();
  await expect(btn).toHaveAttribute('data-state', 'off');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveAttribute('title', 'Scroll panes together');
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"syncScroll": false');

  const editor = page.locator('.cm-scroller');
  const preview = page.getByTestId('split-preview');
  // Let any boot-time restore scrolls go idle so the fade assertion is clean.
  await expect
    .poll(() => preview.evaluate((el) => el.getAttribute('data-scrollbars')), { timeout: 4000 })
    .not.toBe('active');

  const previewTop = await preview.evaluate((el) => el.scrollTop);
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.5));
  await page.waitForTimeout(300);
  expect(Math.abs((await preview.evaluate((el) => el.scrollTop)) - previewTop)).toBeLessThan(2);
  // Issue #167 auto-hide is per surface: the editor's own bar woke, the idle
  // preview's did not.
  await expect(editor).toHaveAttribute('data-scrollbars', 'active');
  await expect(preview).not.toHaveAttribute('data-scrollbars', 'active');

  await preview.evaluate((el) => (el.scrollTop = 600));
  const editorTop = await editor.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(300);
  expect(Math.abs((await editor.evaluate((el) => el.scrollTop)) - editorTop)).toBeLessThan(2);

  // Back on: the preview realigns to the editor's half-way point THIS instant
  // — no new scroll event is fired here, only the toggle.
  await preview.evaluate((el) => (el.scrollTop = 0));
  await btn.click();
  await expect(btn).toHaveAttribute('data-state', 'on');
  await expect.poll(() => preview.evaluate((el) => el.scrollTop), { timeout: 2000 }).toBeGreaterThan(100);

  // Off again, restart: the persisted value survives and the button agrees
  // with it on load.
  await btn.click();
  await expect(btn).toHaveAttribute('data-state', 'off');
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"syncScroll": false');
  await page.reload();
  await expect(page.getByTestId('split-divider')).toBeVisible({ timeout: 20_000 });
  await expect(btn).toHaveAttribute('data-state', 'off');
  // Still free after the restart — wherever the restore left the preview, a
  // fresh editor scroll does not move it.
  await page.waitForTimeout(300); // let any boot-time restore scrolls settle
  const restoredTop = await preview.evaluate((el) => el.scrollTop);
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.25));
  await page.waitForTimeout(300);
  expect(Math.abs((await preview.evaluate((el) => el.scrollTop)) - restoredTop)).toBeLessThan(2);

  // The Settings switch hides only the button — the sync state is untouched.
  await openSettings(page, 'general');
  await page.getByTestId('settings-sync-scroll-button').uncheck();
  await saveSettings(page);
  await expect(btn).toHaveCount(0);
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"showSyncScrollButton": false');
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"syncScroll": false');
});

/** What E316's toggle observer records, parked on `window` so it outlives the
 *  evaluate that installs it (issue #165). */
interface ToggleWatch {
  /** The preview pane has been seen in the DOM — the fields below are set. */
  paneSeen: boolean;
  /** Rendered children of `.doc` at the frame the pane entered the DOM. */
  docChildrenAtMount: number;
  /** The Suspense fallback appeared at any point — i.e. the Editor remounted. */
  loadingSeen: boolean;
  /** The workspace carried a slide phase at any point (issue #328: never). */
  slideSeen: boolean;
  /** Disconnects the observer. */
  stop: () => void;
}

test('E355: issue #165 — the split opens over rendered content, the editor instance survives with scroll and caret, and the toggle is instant', async ({
  page,
}) => {
  // Full edit on the long doc, pane closed — the state an opening toggle
  // starts from.
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await splitApp(page, false);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);

  // State a fresh CodeMirror mount would lose: a scrolled viewport, a caret
  // parked on a mid-document line, and a marker stamped on the live
  // .cm-editor node itself. The caret goes onto a VISIBLE line (the long
  // doc's paragraphs are unique per section) so its line stays rendered
  // through the toggle despite CodeMirror's viewport virtualization.
  await page.evaluate(() => {
    const cm = document.querySelector('.cm-editor') as HTMLElement;
    cm.dataset.mm165 = 'survivor';
    (cm.querySelector('.cm-scroller') as HTMLElement).scrollTop = 600;
  });
  const eb = (await page.getByTestId('editor').boundingBox())!;
  await page.mouse.click(eb.x + 120, eb.y + eb.height / 2);
  const before = await page.evaluate(() => ({
    scrollTop: Math.round(document.querySelector('.cm-scroller')!.scrollTop),
    activeText: document.querySelector('.cm-activeLine')?.textContent ?? '',
  }));
  expect(before.scrollTop).toBeGreaterThan(0); // the scroll check must have teeth
  expect(before.activeText.length).toBeGreaterThan(0);
  const topLineBefore = await editorTopGutterLine(page);
  expect(topLineBefore).toBeGreaterThan(1); // really scrolled away from the top
  // The column's transform, which must be 'none' in both settled states (a
  // resting transform would become the containing block for fixed-position
  // menus). Issue #272 removed the column glide entirely — the column is
  // flush-left at both ends, so nothing may translate it at any point.
  const columnTransform = () =>
    page.locator('.split-editor .cm-scroller > .cm-content').evaluate((el) => getComputedStyle(el).transform);
  expect(await columnTransform()).toBe('none');

  // Watch the toggle happen: what the preview pane holds THE MOMENT it enters
  // the DOM (issue #165's blank-pane symptom: it used to arrive empty and
  // fill ~200ms later), whether a slide phase ever appeared (PRD 025 Req 22,
  // issue #328: it must not — the pane mounts in place), and whether the
  // Suspense fallback (= an Editor remount) ever appeared. Structural facts,
  // not frame sampling — E135 was removed for that flakiness.
  const watchToggle = () =>
    page.evaluate(() => {
      const rec: ToggleWatch = {
        paneSeen: false,
        docChildrenAtMount: -1,
        loadingSeen: false,
        slideSeen: false,
        stop: () => {},
      };
      const mo = new MutationObserver(() => {
        if (!rec.paneSeen) {
          const pane = document.querySelector('[data-testid="split-preview"]');
          if (pane) {
            rec.paneSeen = true;
            rec.docChildrenAtMount = pane.querySelector('.doc')?.childElementCount ?? 0;
          }
        }
        if (document.querySelector('[data-testid="editor-loading"]')) rec.loadingSeen = true;
        // Any `preview-*` phase class on the workspace (the retired slide
        // phases were `preview-sliding` / `preview-out`) — matched by prefix
        // so a renamed phase cannot slip past.
        const ws = document.querySelector('.workspace');
        if (ws && Array.from(ws.classList).some((c) => c.startsWith('preview-'))) rec.slideSeen = true;
      });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      rec.stop = () => mo.disconnect();
      (window as unknown as { __mm165: ToggleWatch }).__mm165 = rec;
    });
  const watched = () =>
    page.evaluate(() => {
      const rec = (window as unknown as { __mm165: ToggleWatch }).__mm165;
      rec.stop();
      const { docChildrenAtMount, loadingSeen, slideSeen } = rec;
      return { docChildrenAtMount, loadingSeen, slideSeen };
    });

  await watchToggle();
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  // Settled: the steady state carries no transform (fixed-position menus).
  await expect
    .poll(() => page.getByTestId('split-preview').evaluate((el) => getComputedStyle(el).transform))
    .toBe('none');
  const open = await watched();
  expect(open.slideSeen).toBe(false); // no preview-* slide phase, ever (retired by issue #328)
  expect(open.docChildrenAtMount).toBeGreaterThan(0); // content from the first frame
  expect(open.loadingSeen).toBe(false); // no Suspense fallback = no remount window

  // The very same editor instance, same caret line, same scroll position.
  const afterOpen = await page.evaluate(() => ({
    marker: (document.querySelector('.cm-editor') as HTMLElement)?.dataset.mm165 ?? null,
    activeText: document.querySelector('.cm-activeLine')?.textContent ?? '',
  }));
  expect(afterOpen.marker).toBe('survivor');
  // Numeric scrollTop legitimately shifts when the narrower pane rewraps
  // lines (CodeMirror anchors the visible content) — the READING POSITION is
  // what must hold: the same document line still tops the viewport, and the
  // caret still sits on the same (uniquely worded) line.
  expect(Math.abs((await editorTopGutterLine(page)) - topLineBefore)).toBeLessThanOrEqual(2);
  expect(afterOpen.activeText).toBe(before.activeText);
  // And the text column stays transform-free (issue #272: it never moves).
  await expect.poll(columnTransform).toBe('none');

  // Close unmounts the pane in place and hands back the same editor.
  await page.waitForTimeout(250); // SPEC12 §1.3 cross-source dedup window
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  const afterClose = await page.evaluate(() => ({
    marker: (document.querySelector('.cm-editor') as HTMLElement)?.dataset.mm165 ?? null,
    activeText: document.querySelector('.cm-activeLine')?.textContent ?? '',
  }));
  expect(afterClose.marker).toBe('survivor');
  expect(afterClose.activeText).toBe(before.activeText);
  expect(Math.abs((await editorTopGutterLine(page)) - topLineBefore)).toBeLessThanOrEqual(2);
  await expect.poll(columnTransform).toBe('none'); // still flush-left, transform-free

  // PRD 025 Req 22 (issue #328): the reopen is the same instant switch —
  // no slide phases at all — and the pane STILL arrives already holding
  // content. (This leg used to run under prefers-reduced-motion; instant is
  // the one behaviour now, so the media emulation is gone.)
  await page.waitForTimeout(250);
  await watchToggle();
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  const reopened = await watched();
  expect(reopened.slideSeen).toBe(false);
  expect(reopened.docChildrenAtMount).toBeGreaterThan(0);
  expect(
    await page.getByTestId('split-preview').evaluate((el) => getComputedStyle(el).transform)
  ).toBe('none');
});

// --- Issue #310: the preview follows the editor caret ------------------------
// A long document with a uniquely worded heading, a long wrapped paragraph
// mid-way (so a caret can walk visual rows without leaving its block) and a
// run of blank lines the editor shows as rows but the preview collapses (so
// following produces a large, predictable preview move), plus filler on both
// sides so neither pane sits at an end clamp.
const CARET_SYNC_DOC = (() => {
  const filler = (tag: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${tag} filler paragraph ${i} carrying a few plain words\n`).join('\n');
  const walk = Array.from({ length: 60 }, (_, i) => `walk${i}`).join(' ');
  const blankRun = '\n'.repeat(9); // eight blank source lines
  return `# Top\n\n${filler('upper', 30)}\n## Heading Target Here\n\n${walk}\n\nlower anchor sentence\n${blankRun}gap landing sentence\n\n${filler('lower', 30)}`;
})();

async function caretSyncApp(page: Page): Promise<void> {
  await fsWrite(page, '/docs/caret-sync.md', CARET_SYNC_DOC);
  await page.goto('/#open=/docs/caret-sync.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Top');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('split-divider')).toBeVisible();
}

/**
 * Scroll the (virtualized) editor until the line renders, then click its
 * top-left corner (the E128 idiom) — a wrapped paragraph is one `.cm-line`,
 * so the caret lands at its FIRST row's start, not somewhere mid-paragraph.
 */
async function clickEditorLine(page: Page, text: string): Promise<void> {
  const target = page.getByTestId('editor').locator('.cm-line', { hasText: text });
  await page.getByTestId('editor').locator('.cm-content').hover();
  for (let i = 0; i < 80 && (await target.count()) === 0; i++) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(40);
  }
  await target.scrollIntoViewIfNeeded();
  await target.click({ position: { x: 4, y: 6 } });
}

/** Put the caret's line mid-viewport (an editor lead — the preview follows), away from both end clamps.
 *  Issue #358: the caret line is found through the DOM selection (editorCaret's
 *  technique) — `.cm-activeLine` is opt-in now and off in these boots. */
const centreEditorOnCaret = (page: Page) =>
  page.evaluate(() => {
    const sc = document.querySelector('.cm-scroller')!;
    const r0 = document.getSelection()!.getRangeAt(0);
    const start = r0.startContainer instanceof Element ? r0.startContainer : r0.startContainer.parentElement!;
    const line = start.closest('.cm-line')!;
    const r = line.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    sc.scrollTop += r.top - s.top - s.height / 2;
  });

/**
 * Issue #310's yardstick: the vertical centre of the editor caret's visual
 * row (the drawn cursor — coordsAtPos geometry) against the centre of the
 * preview head row — the character at the `data-mm-head` offset the host
 * stamps on the head's innermost container (issue #345: the invisible
 * channel; no word mark or block tint exists any more), read through a
 * Range exactly as the split controller reads it.
 */
const caretLevelGap = (page: Page) =>
  page.evaluate(() => {
    const pv = document.querySelector('[data-testid="split-preview"] .doc');
    const ed = document.querySelector('.cm-cursor-primary');
    if (!pv || !ed) return Infinity;
    let c: DOMRect | undefined;
    const block = pv.querySelector<HTMLElement>('[data-mm-head]');
    if (!block) return Infinity;
    const offset = Number(block.dataset.mmHead);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const len = (node as Text).data.length;
      if (offset < acc + len) {
        const range = document.createRange();
        range.setStart(node, offset - acc);
        range.setEnd(node, offset - acc + 1);
        c = range.getClientRects()[0];
        break;
      }
      acc += len;
    }
    if (!c) return Infinity;
    const e = ed.getClientRects()[0] ?? ed.getBoundingClientRect();
    if (c.height === 0 || e.height === 0) return Infinity;
    return Math.abs((c.top + c.bottom) / 2 - (e.top + e.bottom) / 2);
  });

const editorScrollTop = (page: Page) => page.locator('.cm-scroller').evaluate((el) => el.scrollTop);
const previewScrollTop = (page: Page) => page.getByTestId('split-preview').evaluate((el) => el.scrollTop);
/**
 * Screen top of CodeMirror's drawn cursor. CM repositions it a frame after a
 * caret move — poll it to the new row so a level check cannot pass on the old.
 */
const cursorTop = (page: Page) => page.locator('.cm-cursor-primary').evaluate((el) => el.getBoundingClientRect().top);

/** Screen point on the first visible `.cm-line` row at least `dy` px below the caret's row. */
const editorRowBelowCaret = (page: Page, dy: number) =>
  page.evaluate((delta) => {
    const cursor = document.querySelector('.cm-cursor-primary')!.getBoundingClientRect();
    const sc = document.querySelector('.cm-scroller')!.getBoundingClientRect();
    const lines = Array.from(document.querySelectorAll('.cm-line')).filter((l) => /filler|walk|anchor/.test(l.textContent ?? ''));
    const line = lines.find((l) => {
      const r = l.getBoundingClientRect();
      return r.top >= cursor.top + delta && r.bottom <= sc.bottom - 40;
    })!;
    const r = line.getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 8 };
  }, dy);

test('E555: Issue #310 — a click on a lower editor row levels the preview cue with the caret while the editor stays put', async ({
  page,
}) => {
  await caretSyncApp(page);
  await clickEditorLine(page, 'lower anchor sentence');
  await centreEditorOnCaret(page);
  await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);

  // Mis-scroll the preview by hand: it leads, the editor follows, and the
  // panes settle level on the CURRENT caret. The row nine editor rows down
  // (across the collapsed blank run) is one rendered block down — far from
  // level until the caret gets there.
  await page.getByTestId('split-preview').evaluate((el) => (el.scrollTop += 140));
  await page.waitForTimeout(300);
  const edBefore = await editorScrollTop(page);
  const pvBefore = await previewScrollTop(page);

  const cursorBefore = await cursorTop(page);
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'gap landing sentence' }).click({ position: { x: 4, y: 6 } });
  await expect.poll(() => cursorTop(page)).toBeGreaterThan(cursorBefore + 100);
  // The preview realigns on the new caret's cue (body text: centres within 10 px)…
  await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);
  // …by really moving: the caret sits ~nine rows lower in the editor's
  // viewport while its rendered block is one block lower, so the preview
  // scrolled UP by the difference…
  expect(pvBefore - (await previewScrollTop(page))).toBeGreaterThan(50);
  // …while the editor pane never scrolled for the click.
  expect(Math.abs((await editorScrollTop(page)) - edBefore)).toBeLessThan(1);
  // Settled: no oscillation between frames.
  const settled = await previewScrollTop(page);
  await page.waitForTimeout(200);
  expect(Math.abs((await previewScrollTop(page)) - settled)).toBeLessThan(2);
});

test('E556: Issue #310 — ArrowDown and Shift+ArrowDown walk visual rows and the preview stays level on the head, collapsed or selecting', async ({
  page,
}) => {
  await caretSyncApp(page);
  await clickEditorLine(page, 'walk0 walk1');
  await page.keyboard.press('Home');
  await centreEditorOnCaret(page);
  await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);
  const edBefore = await editorScrollTop(page);
  const pvHead = page.locator('[data-testid="split-preview"] .doc [data-mm-head]');
  const pvCues = page.locator(
    '[data-testid="split-preview"] .doc .mm-active-block, [data-testid="split-preview"] .doc mark.mm-active-word'
  );

  // Collapsed caret: each ArrowDown lands on the next wrapped row of the
  // same paragraph; the preview keeps the word under the caret level with
  // it (the preview's own rows wrap differently, so its scrollTop is free to
  // move either way — only the level matters). Each step is checked after
  // the follower settles, so a stale pass cannot mask a missed row.
  let lastCursor = await cursorTop(page);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => cursorTop(page)).toBeGreaterThan(lastCursor + 8); // really one row down
    lastCursor = await cursorTop(page);
    await expect(pvHead).toHaveCount(1);
    await expect(pvCues).toHaveCount(0); // issue #345: nothing painted
    await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);
  }
  // Selection extension: the invisible anchor carries the head's rendered
  // offset and the panes stay level on that row — still nothing painted.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(() => cursorTop(page)).toBeLessThan(lastCursor - 8);
    lastCursor = await cursorTop(page);
    await expect(pvCues).toHaveCount(0);
    await expect(pvHead).toHaveCount(1);
    await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);
  }
  // Through it all the editor never scrolled.
  expect(Math.abs((await editorScrollTop(page)) - edBefore)).toBeLessThan(1);
});

test('E557: Issue #310 — Enter and typing low in a long document keep the preview level after the re-render; the editor does not move', async ({
  page,
}) => {
  await caretSyncApp(page);
  await clickEditorLine(page, 'lower filler paragraph 20');
  await page.keyboard.press('End');
  await centreEditorOnCaret(page);
  await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);
  const edBefore = await editorScrollTop(page);
  const pvBefore = await previewScrollTop(page);

  // Six blank lines: six editor rows the rendered preview collapses into one
  // block gap, so keeping level means the preview visibly moves.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Enter');
  await page.keyboard.type('freshly typed words');
  // The debounced live re-render landed the new paragraph…
  await expect(page.getByTestId('split-preview')).toContainText('freshly typed words');
  await expect(page.locator('[data-testid="split-preview"] .doc [data-mm-head]')).toContainText('freshly typed words');
  // …and the preview is level with the caret's new row, six rows lower.
  await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);
  // The editor never scrolled, so the caret sits six rows lower in its
  // viewport; the rendered paragraph is only one block lower, so the preview
  // had to scroll UP by the difference to keep the cue level.
  expect(pvBefore - (await previewScrollTop(page))).toBeGreaterThan(40);
  expect(Math.abs((await editorScrollTop(page)) - edBefore)).toBeLessThan(1);
  // Keep typing: still level after the next re-render, editor still put.
  await page.keyboard.type(' and more');
  await expect(page.locator('[data-testid="split-preview"] .doc [data-mm-head]')).toContainText('and more');
  await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);
  expect(Math.abs((await editorScrollTop(page)) - edBefore)).toBeLessThan(1);
});

test('E558: Issue #310 — with sync scrolling off, caret moves, selection and typing leave the preview exactly where it was', async ({
  page,
}) => {
  await caretSyncApp(page);
  await clickEditorLine(page, 'walk0 walk1');
  await page.keyboard.press('Home');
  await centreEditorOnCaret(page);
  await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);

  await page.getByTestId('sync-scroll-toggle').click();
  await expect(page.getByTestId('sync-scroll-toggle')).toHaveAttribute('data-state', 'off');
  await page.getByTestId('split-preview').evaluate((el) => (el.scrollTop += 200)); // free-scroll: nothing follows
  await page.waitForTimeout(300);
  const pvBefore = await previewScrollTop(page);
  const edBefore = await editorScrollTop(page);

  // Click back in, walk rows, extend a selection, type — the head anchor
  // still re-stamps (issue #310) but the preview's scrollTop is untouched.
  const at = await editorRowBelowCaret(page, 60);
  await page.mouse.click(at.x, at.y);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.type(' typedwhileoff');
  await expect(page.getByTestId('split-preview')).toContainText('typedwhileoff');
  await expect(page.locator('[data-testid="split-preview"] .doc [data-mm-head]')).toContainText('typedwhileoff');
  await page.waitForTimeout(300); // outlast any frame-coalesced write
  expect(Math.abs((await previewScrollTop(page)) - pvBefore)).toBeLessThan(1);
  expect(Math.abs((await editorScrollTop(page)) - edBefore)).toBeLessThan(1);
});

test('E559: Issue #310 — a heading row levels within 16 px and a body-text row within 10 px, whichever pane leads', async ({
  page,
}) => {
  await caretSyncApp(page);
  const pvHead = page.locator('[data-testid="split-preview"] .doc [data-mm-head]');

  // Heading: caret on "Heading" (past the '## ' marker).
  await clickEditorLine(page, 'Heading Target Here');
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(pvHead).toHaveText('Heading Target Here');
  expect(await pvHead.evaluate((el) => el.tagName)).toBe('H2');
  await centreEditorOnCaret(page);
  await expect.poll(() => caretLevelGap(page)).toBeLessThan(16);
  // Each wheel gets the E128 settle: the wheel lands, the follower writes,
  // and its 120 ms quiet window closes before the other pane leads.
  await page.getByTestId('editor').locator('.cm-content').hover();
  for (const dy of [200, -150]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(250);
    expect(await caretLevelGap(page)).toBeLessThan(16);
  }
  await page.getByTestId('split-preview').hover();
  for (const dy of [220, -180]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(250);
    expect(await caretLevelGap(page)).toBeLessThan(16);
  }

  // Body text: caret on "walk0", the same drill at the tighter tolerance.
  await page.waitForTimeout(250);
  await clickEditorLine(page, 'walk0 walk1');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(pvHead).toContainText('walk0 walk1');
  await centreEditorOnCaret(page);
  await expect.poll(() => caretLevelGap(page)).toBeLessThan(10);
  await page.getByTestId('editor').locator('.cm-content').hover();
  for (const dy of [200, -150]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(250);
    expect(await caretLevelGap(page)).toBeLessThan(10);
  }
  await page.getByTestId('split-preview').hover();
  for (const dy of [220, -180]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(250);
    expect(await caretLevelGap(page)).toBeLessThan(10);
  }
});

test('E564: issue #307 — the preview and comments edge toggles carry distinct glyphs, each flipping state with its own pane only', async ({
  page,
}) => {
  // Edit mode with the split open (comments are enabled by default), so both
  // edge toggles are up in the top-right cluster.
  await splitApp(page);
  await expect(page.getByTestId('split-preview')).toBeVisible();

  const previewIcon = page.getByTestId('preview-toggle-icon');
  const commentsIcon = page.getByTestId('comments-toggle-icon');
  await expect(previewIcon).toBeVisible();
  await expect(commentsIcon).toBeVisible();

  // Issue #307: the two glyphs never coincide — a split pane vs. a speech
  // bubble, not one chevron twice. Pinning each exact value also proves the
  // pair differ, here and after every toggle below.
  await expect(previewIcon).toHaveAttribute('data-icon', 'preview-open');
  await expect(commentsIcon).toHaveAttribute('data-icon', 'comments-closed');

  // Collapsing the preview flips only the preview glyph to its closed state.
  await page.getByTestId('preview-collapse').click();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect(previewIcon).toHaveAttribute('data-icon', 'preview-closed');
  await expect(commentsIcon).toHaveAttribute('data-icon', 'comments-closed');

  // Opening the comments pane flips only the comments glyph to its open state.
  await page.getByTestId('comments-expand').click();
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(commentsIcon).toHaveAttribute('data-icon', 'comments-open');
  await expect(previewIcon).toHaveAttribute('data-icon', 'preview-closed');

  // And each returns to where it started, still independently.
  await page.getByTestId('preview-expand').click();
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(previewIcon).toHaveAttribute('data-icon', 'preview-open');
  await expect(commentsIcon).toHaveAttribute('data-icon', 'comments-open');
  await page.getByTestId('comments-collapse').click();
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(commentsIcon).toHaveAttribute('data-icon', 'comments-closed');
  await expect(previewIcon).toHaveAttribute('data-icon', 'preview-open');
});
