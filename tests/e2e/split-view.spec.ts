import { expect, test } from './fixtures';
import {
  clickWord,
  editorTopGutterLine,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  openSettings,
  previewTopAnchorLines,
  selectPhraseInPane,
  selectSpanInPane,
  splitApp,
  stableBox,
} from './helpers';

// Side-by-side edit: the divider, scroll sync, selection mirroring, mode
// carry-over and the word placement cues.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E39: side-by-side edit shows editor plus live preview; typing updates the right pane', async ({ page }) => {
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await page.getByTestId('settings-close').click();

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
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');

  const wsBox = (await page.locator('.workspace.split').boundingBox())!;
  const editorFraction = async () => {
    const e = (await page.locator('.split-editor').boundingBox())!;
    return e.width / wsBox.width;
  };
  // The preview slides in over 180ms (paneSlide.ts): poll the ratio instead of
  // sampling it mid-flight — and the divider below must be grabbed at rest.
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
  await selectSpanInPane(page, '[data-testid="split-preview"] .doc', 'brown', 'fox jumps');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('brown** fox jumps');
  // The unfocused editor draws the selection and scrolled it into view.
  expect(await page.locator('[data-testid="editor"] .cm-selectionBackground').count()).toBeGreaterThan(0);
  expect(
    await page.locator('[data-testid="editor"] .cm-scroller').evaluate((el) => el.scrollTop)
  ).toBeGreaterThan(0);
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
  // PRD 003 Req 10: the reopen slides in now — let it settle before measuring.
  await expect
    .poll(() => page.getByTestId('split-preview').evaluate((el) => getComputedStyle(el).transform))
    .toBe('none');
  const previewBox = (await page.getByTestId('split-preview').boundingBox())!;
  const collapseBox = (await collapse.boundingBox())!;
  expect(collapseBox.x + collapseBox.width).toBeGreaterThan(previewBox.x + previewBox.width - 24); // hugs the right edge
  expect(collapseBox.y).toBeLessThan(previewBox.y + 64); // near the top

  // Clicking it closes the split (today's full-screen editor), persisted.
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
  // The chevron re-pins once the preview has finished sliding away.
  await expect
    .poll(async () => {
      const b = (await expand.boundingBox())!;
      return b.x + b.width;
    })
    .toBeGreaterThan(viewport.width - 24);
  await expand.click();
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(expand).toHaveCount(0);
  await expect(collapse).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"splitEdit": true');

  // Req 8: the Settings checkbox stays in sync with chevron clicks, and
  // drives the same surface back.
  await openSettings(page, 'general');
  await expect(page.getByTestId('set-split-edit')).toBeChecked();
  await page.getByTestId('settings-close').click();
  await collapse.click();
  await openSettings(page, 'general');
  await expect(page.getByTestId('set-split-edit')).not.toBeChecked();
  await page.getByTestId('set-split-edit').check();
  await page.getByTestId('settings-close').click();
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

test('E124: split mode — caret word darkens in both panes, position-exact on repeats, selection clears it, typing re-anchors', async ({
  page,
}) => {
  await fsWrite(page, '/docs/place.md', '# Title\n\nalpha beta gamma\n\ncat and cat again\n\n- one two\n- three four\n- five six\n');
  await page.goto('/#open=/docs/place.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  // Caret inside "alpha": the editor decoration and BOTH preview cues appear.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'alpha beta gamma' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  const edWord = page.locator('.cm-content .mm-active-word');
  const pvWord = page.locator('[data-testid="split-preview"] .doc mark.mm-active-word');
  const pvBlock = page.locator('[data-testid="split-preview"] .doc .mm-active-block');
  await expect(edWord).toHaveText('alpha');
  await expect(pvWord).toHaveText('alpha');
  await expect(pvBlock).toHaveCount(1);
  await expect(pvBlock).toContainText('alpha beta gamma');
  // Inert to the comment machinery.
  expect(await pvWord.getAttribute('data-cid')).toBeNull();

  // Arrow into "beta": both sides re-target.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await expect(edWord).toHaveText('beta');
  await expect(pvWord).toHaveText('beta');

  // Repeats mark the CARET's occurrence: caret in the second "cat".
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'cat and cat again' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await expect(edWord).toHaveText('cat');
  await expect(pvWord).toHaveText('cat');
  await expect(pvWord).toHaveCount(1);
  const info = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="split-preview"] .doc mark.mm-active-word')!;
    const blk = m.closest('[data-mm-line]')!;
    const r = document.createRange();
    r.setStart(blk, 0);
    r.setEndBefore(m);
    return { word: m.textContent, before: r.toString() };
  });
  expect(info.word).toBe('cat');
  expect(info.before).toBe('cat and '); // the SECOND cat carries the mark

  // A real selection outranks the word cue; the block tint stays.
  await page.keyboard.press('Shift+End');
  await expect(edWord).toHaveCount(0);
  await expect(pvWord).toHaveCount(0);
  await expect(pvBlock).toHaveCount(1);

  // Typing keeps the cues anchored through the re-render.
  await page.keyboard.press('End');
  await page.keyboard.type(' zeta');
  await expect(edWord).toHaveText('zeta');
  await expect(pvWord).toHaveText('zeta');

  // A stamped block can be a whole LIST — the tint stays on the caret's item.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'three four' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(pvWord).toHaveText('three');
  await expect(pvBlock).toHaveCount(1);
  await expect(pvBlock).toContainText('three four');
  await expect(pvBlock).not.toContainText('one two');
});

test('E125: preview clicks place the caret — split moves the editor, preview-only carries into Mod+E; links stay links', async ({
  page,
}) => {
  await fsWrite(page, '/docs/click.md', '# Click\n\nalpha beta gamma\n\nplus +++ plus2\n\n[ext](https://example.com/x)\n');
  await page.goto('/#open=/docs/click.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Click');

  // Preview-only: click a word → block + word cues right there.
  await clickWord(page, '[data-testid="doc"]', 'beta');
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveText('beta');
  await expect(page.locator('[data-testid="doc"] .mm-active-block')).toContainText('alpha beta gamma');
  // A link click keeps its existing behavior — placement skipped, cue stays.
  await page.locator('[data-testid="doc"] a[href]').click();
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveText('beta');

  // Mod+E lands the editor caret on that word (the E85 contract, collapsed).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.locator('.cm-content .mm-active-word')).toHaveText('beta');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe('# Click\n\nalpha '.length);

  // Split mode: clicking a preview word moves the editor caret to it.
  await clickWord(page, '[data-testid="split-preview"] .doc', 'gamma');
  await expect(page.locator('.cm-content .mm-active-word')).toHaveText('gamma');
  await expect(page.locator('[data-testid="split-preview"] .doc mark.mm-active-word')).toHaveText('gamma');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe('# Click\n\nalpha beta '.length);

  // A no-word click (punctuation run) still moves the caret — to the block.
  await clickWord(page, '[data-testid="split-preview"] .doc', '+++');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selFrom)).toBe('# Click\n\nalpha beta gamma\n\n'.length);
  await expect(page.locator('[data-testid="split-preview"] .doc .mm-active-block')).toContainText('plus +++ plus2');
});

test('E126: hygiene — comments anchor through the cues, find coexists/suppresses, themes override, doc switch resets', async ({
  page,
}) => {
  await fsWrite(page, '/docs/hyg.md', '# Hyg\n\nalpha beta gamma delta\n');
  await fsWrite(page, '/docs/other.md', '# Other\n\nplain here\n');
  await page.goto('/#open=/docs/hyg.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Hyg');

  // Cues active…
  await clickWord(page, '[data-testid="doc"]', 'beta');
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveText('beta');
  // …and the comment coordinate space is undisturbed: a comment over a span
  // CROSSING the marked word (the mark fragments text nodes) anchors exactly.
  await selectSpanInPane(page, '[data-testid="doc"]', 'beta', 'delta');
  await page.getByTestId('add-comment-btn').click();
  await page.keyboard.type('anchored fine');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(async () => (await page.locator('[data-testid="doc"] mark.hl').allTextContents()).join(''))
    .toContain('beta gamma delta');

  // Find marks and the active word coexist in the preview.
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByTestId('find-input').fill('beta');
  await expect(page.locator('[data-testid="doc"] mark.mm-find')).toHaveCount(1);
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // In edit mode the open find bar suppresses the editor's word cue.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'alpha beta' }).click();
  await expect(page.locator('.cm-content .mm-active-word')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByTestId('find-input')).toBeVisible();
  await expect(page.locator('.cm-content .mm-active-word')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Click back into the editor: focus returns, the find-match selection
  // collapses, and the cue re-derives now that the bar is gone.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'alpha beta' }).click();
  await expect(page.locator('.cm-content .mm-active-word')).toHaveCount(1);

  // Theme variables drive both cue colors.
  const color = await page.evaluate(() => {
    document.querySelector<HTMLElement>('.theme-root')!.style.setProperty('--mm-active-word', 'rgb(1, 2, 3)');
    const m = document.querySelector('.cm-content .mm-active-word')!;
    return getComputedStyle(m).backgroundColor;
  });
  expect(color).toBe('rgb(1, 2, 3)');

  // A doc switch drops the cues — nothing stale on the incoming document.
  await page.keyboard.press('Control+e');
  await page.goto('/#open=/docs/other.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Other');
  await expect(page.locator('[data-testid="doc"] mark.mm-active-word')).toHaveCount(0);
  await expect(page.locator('[data-testid="doc"] .mm-active-block')).toHaveCount(0);
});

test('E127: tint granularity invariant — drags, punctuation carets, table cells, quotes, whitespace clicks all land on ONE container', async ({
  page,
}) => {
  await fsWrite(
    page,
    '/docs/grain.md',
    '# G\n\n- one two\n- three four\n- pp +++ qq\n\n| h1 | h2 |\n| -- | -- |\n| ca | cb |\n\n> quoted words here\n'
  );
  await page.goto('/#open=/docs/grain.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('G');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  const tint = page.locator('[data-testid="split-preview"] .doc .mm-active-block');

  // Multi-word drag INSIDE one bullet: exactly that li, siblings excluded.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'three four' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect(tint).toHaveCount(1);
  await expect(tint).toContainText('three four');
  await expect(tint).not.toContainText('one two');
  expect(await tint.evaluate((el) => el.tagName)).toBe('LI');

  // Drag across two bullets: the HEAD's li wins, live.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'one two' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(tint).toHaveCount(1);
  await expect(tint).toContainText('three four');
  await expect(tint).not.toContainText('one two');

  // Collapsed caret on a punctuation run inside a bullet: that li.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'pp +++ qq' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); // inside +++
  await expect(tint).toHaveCount(1);
  await expect(tint).toContainText('pp +++ qq');
  await expect(tint).not.toContainText('three four');
  expect(await tint.evaluate((el) => el.tagName)).toBe('LI');

  // Caret inside a table cell: the td, not the table.
  await page.getByTestId('editor').locator('.cm-line', { hasText: '| ca | cb |' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tint).toHaveCount(1);
  await expect(tint).toHaveText(/ca/);
  await expect(tint).not.toContainText('cb');
  expect(await tint.evaluate((el) => el.tagName)).toBe('TD');

  // Caret in a blockquote: the inner container, never the whole quote.
  await page.getByTestId('editor').locator('.cm-line', { hasText: 'quoted words here' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tint).toHaveCount(1);
  await expect(tint).toContainText('quoted words here');
  expect(await tint.evaluate((el) => el.tagName)).not.toBe('BLOCKQUOTE');

  // Preview punctuation-click inside a bullet: that bullet's li tints.
  await clickWord(page, '[data-testid="split-preview"] .doc', '+++');
  await expect(tint).toHaveCount(1);
  await expect(tint).toContainText('pp +++ qq');
  await expect(tint).not.toContainText('one two');
});

test('E128: cue-anchored split sync — the selected word stays level in both panes while either pane scrolls', async ({
  page,
}) => {
  const paras = Array.from({ length: 40 }, (_, i) => `para ${i} filler text line\n`).join('\n');
  await fsWrite(page, '/docs/sync.md', `# S\n\n${paras}\n## target word here\n\n${paras}`);
  await page.goto('/#open=/docs/sync.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('S');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  // Scroll the (virtualized) editor until the heading renders, then click
  // into it — the caret lands mid-document and the word cue follows.
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
  await expect(page.locator('[data-testid="split-preview"] .doc mark.mm-active-word')).toHaveText('target');

  const levels = () =>
    page.evaluate(() => {
      const ed = document.querySelector('.cm-content .mm-active-word');
      const pv = document.querySelector('[data-testid="split-preview"] .doc mark.mm-active-word');
      if (!ed || !pv) return null;
      return Math.abs(ed.getBoundingClientRect().top - pv.getBoundingClientRect().top);
    });

  // Scroll the editor a few steps: the word stays LEVEL — a small stable
  // structural offset (font/margin asymmetry) is allowed, drift is not.
  await page.getByTestId('editor').locator('.cm-content').hover();
  let base: number | null = null;
  for (const dy of [200, 200, -150]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(250);
    const d = await levels();
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(90);
    if (base === null) base = d!;
    expect(Math.abs(d! - base)).toBeLessThan(15); // tracks, no drift
  }

  // Preview leads: same contract.
  await page.getByTestId('split-preview').hover();
  for (const dy of [220, -180]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(250);
    const d = await levels();
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(90);
    expect(Math.abs(d! - base!)).toBeLessThan(15);
  }
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
  // PRD 003 Reqs 6–7: full preview is not a closed split — no chevron there,
  // so the switch has the corner to itself and hugs the right edge.
  await expect(collapse).toHaveCount(0);
  await expect(page.getByTestId('preview-expand')).toHaveCount(0);
  const viewport = page.viewportSize()!;
  const soloBox = (await stableBox(sw))!;
  expect(soloBox.x + soloBox.width).toBeGreaterThan(viewport.width - 24);

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
  expect(chevronBox.x + chevronBox.width).toBeGreaterThan(viewport.width - 24);

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
  // preview-only, the same gate the toolbar's Edit button uses.
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
