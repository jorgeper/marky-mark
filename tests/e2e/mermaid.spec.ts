// PRD 013 (issue #160): mermaid fences draw as diagrams in the rendered
// panes — the real mermaid library, lazily loaded through the vite dev
// server, behind the fence-renderer seam. The edit pane is #162's, not here.
import { expect, test } from './fixtures';
import { addComment, freshApp, fsRead, fsWrite, landInPreview, openPath, openSettings, stableBox } from './helpers';

const DOC_PATH = '/docs/diagrams.md';

const DOC = `# Diagrams

An anchor phrase to comment on lives here.

\`\`\`mermaid
graph TD
  A[Start] --> B[Finish]
\`\`\`

A middle paragraph between the fences.

\`\`\`mermaid
this is not a diagram at all
\`\`\`

\`\`\`js
const x = 1;
\`\`\`
`;

// The first diagram of a session waits on mermaid's dynamic import — under
// the dev server's cold transform that comfortably outruns the default 5s.
const FIRST_DRAW = { timeout: 20_000 };

async function openDiagramDoc(page: import('@playwright/test').Page): Promise<void> {
  await freshApp(page);
  await fsWrite(page, DOC_PATH, DOC);
  await openPath(page, DOC_PATH);
  await landInPreview(page);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Diagrams');
}

test('E354: a valid mermaid fence draws automatically; an invalid one keeps its code plus an error note; the rest of the document renders', async ({
  page,
}) => {
  await openDiagramDoc(page);
  const doc = page.getByTestId('doc');

  // PRD 013 Req 2: the valid fence drew — no button, no toggle was touched.
  const diagram = doc.getByTestId('mm-diagram');
  await expect(diagram).toBeVisible(FIRST_DRAW);
  await expect(diagram.locator('svg')).toBeVisible();

  // Its code block is hidden from view but still in the tree (Req 3).
  const drawnPre = doc.locator('pre[data-mm-diagram="done"]');
  await expect(drawnPre).toBeHidden();
  await expect(drawnPre).toContainText('A[Start]', { useInnerText: false });

  // PRD 013 Req 10: the invalid fence kept today's code block, visibly, plus
  // the renderer's message — and never stopped the valid one from drawing.
  const failedPre = doc.locator('pre[data-mm-diagram="error"]');
  await expect(failedPre).toBeVisible(FIRST_DRAW);
  await expect(failedPre).toContainText('this is not a diagram at all');
  await expect(doc.getByTestId('mm-diagram-error')).toBeVisible();
  await expect(diagram).toHaveCount(1);

  // The failure leaked none of mermaid's own error artwork outside the block
  // (render() works in a temp body-level container; it must be gone).
  await expect(page.locator('body > div[id^="dmm-"], body > svg')).toHaveCount(0);

  // Fences in other languages render exactly as today: visible, undecorated.
  const jsPre = doc.locator('pre', { hasText: 'const x = 1;' });
  await expect(jsPre).toBeVisible();
  await expect(jsPre).not.toHaveAttribute('data-mm-diagram', /./);
});

test('E310: sidecar comments in a document with a mermaid fence still resolve to the same targets and highlight', async ({
  page,
}) => {
  await openDiagramDoc(page);
  const doc = page.getByTestId('doc');
  await expect(doc.getByTestId('mm-diagram')).toBeVisible(FIRST_DRAW);

  // PRD 013 Req 3: anchoring works over the diagram-bearing DOM — the drawn
  // fence contributed no text nodes, so the phrase's offsets are unmoved.
  await addComment(page, 'anchor phrase', 'still anchors beside a diagram');
  await expect(page.locator('mark.hl')).toHaveText('anchor phrase');

  // And from cold: reopen the document so the sidecar re-resolves against a
  // preview that draws its diagram again.
  await openPath(page, '/docs/welcome.md');
  await expect(doc.locator('h1')).toContainText('Welcome to Marky Mark');
  await openPath(page, DOC_PATH);
  await landInPreview(page);
  await expect(doc.getByTestId('mm-diagram')).toBeVisible(FIRST_DRAW);
  await expect(page.locator('mark.hl')).toHaveText('anchor phrase');
});

test('E311: switching the active theme redraws the on-screen diagram with the new side', async ({ page }) => {
  await openDiagramDoc(page);
  const svg = page.getByTestId('doc').getByTestId('mm-diagram').locator('svg');
  await expect(svg).toBeVisible(FIRST_DRAW);
  const lightSide = await svg.evaluate((el) => el.outerHTML);

  // PRD 013 Req 9: a dark theme chosen into the light slot IS the active
  // side — no document edit, no mode switch, the diagram redraws in place.
  await openSettings(page, 'appearance');
  await page.getByTestId('settings-theme-light').selectOption('monokai');
  await expect
    .poll(() => svg.evaluate((el) => el.outerHTML), FIRST_DRAW)
    .not.toBe(lightSide);
  await expect(svg).toBeVisible();
});

// PRD 013 Req 12 (issue #162): the edit-pane side, over the bundled fixture
// document (fixtures/diagrams.md — seeded into the shim's vfs at /docs).
const FIXTURE_PATH = '/docs/diagrams.md';

async function openFixtureInEditor(page: import('@playwright/test').Page) {
  await freshApp(page);
  await openPath(page, FIXTURE_PATH);
  await landInPreview(page);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Diagrams');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  return editor;
}

test('E312: edit pane — the valid fence draws as an in-place widget by default, the invalid one keeps its source plus the error note, and a click yields the source back at the caret', async ({
  page,
}) => {
  const editor = await openFixtureInEditor(page);
  const content = editor.locator('.cm-content');
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // PRD 013 Req 5: the valid fence is simply a DIAGRAM — SVG drawn, raw
  // syntax hidden, no toggle touched, the dirty dot off.
  const drawn = editor.getByTestId('mm-diagram');
  await expect(drawn).toBeVisible(FIRST_DRAW);
  await expect(drawn.locator('svg')).toBeVisible();
  await expect.poll(text).not.toContain('A[Write]');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // PRD 013 Req 10: the invalid fence keeps its source visible in the
  // widget, plus the renderer's message in the unobtrusive badge — and it
  // never stopped the valid one from drawing.
  await expect(editor.getByTestId('mm-diagram-error')).toBeVisible(FIRST_DRAW);
  expect(await text()).toContain('this is not a diagram at all');
  await expect(editor.locator('.mm-editor-diagram')).toHaveCount(2);

  // Fences in unregistered languages keep today's edit-pane rendering.
  expect(await text()).toContain('const x = 1;');

  // PRD 013 Req 5: a click on the diagram yields the fence source back at
  // the caret; the other diagram fence stays put.
  await drawn.click();
  await expect(content).toContainText('A[Write]');
  await expect(editor.getByTestId('mm-diagram')).toHaveCount(0);
  await expect(editor.getByTestId('mm-diagram-error')).toBeVisible();

  // Moving the caret out re-renders it. Nothing was ever text-changed.
  await editor.locator('.cm-line').filter({ hasText: 'Ordinary code blocks' }).click();
  await expect(editor.getByTestId('mm-diagram')).toBeVisible(FIRST_DRAW);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E313: the Diagram ▸ toggle and the Settings checkbox flip and persist ONE setting; the preview pane is unaffected by it', async ({
  page,
}) => {
  const editor = await openFixtureInEditor(page);
  const content = editor.locator('.cm-content');
  await expect(editor.getByTestId('mm-diagram')).toBeVisible(FIRST_DRAW);

  // PRD 013 Req 6: Diagram ▸ "Show Raw Diagrams" — every fence drops to
  // source at once, with no text change.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-diagram').click();
  await expect(page.getByTestId('smart-edit-toggle-diagrams')).toHaveText(/Show Raw Diagrams/);
  await page.getByTestId('smart-edit-toggle-diagrams').click();
  await expect(editor.locator('.mm-editor-diagram')).toHaveCount(0);
  // Raw means today's rendering: the fence body is editor text again (the
  // issue #157 card, since codeBlockView is on, hides only the delimiters).
  await expect(content).toContainText('A[Write]');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // Both surfaces agree: the menu label flipped, and the Settings checkbox
  // reads the same state and drives the diagrams back on.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-diagram').click();
  await expect(page.getByTestId('smart-edit-toggle-diagrams')).toHaveText(/Show Rendered Diagrams/);
  await page.getByTestId('smart-edit-toggle-diagrams').click();
  await expect(editor.getByTestId('mm-diagram')).toBeVisible(FIRST_DRAW);

  await openSettings(page, 'editor');
  await expect(page.getByTestId('settings-diagram-view')).toBeChecked();
  await page.getByTestId('settings-diagram-view').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(editor.locator('.mm-editor-diagram')).toHaveCount(0);
  await expect(content).toContainText('A[Write]');

  // The setting survives a reload: reopen the document into the edit pane —
  // the fences are still raw.
  await page.reload();
  await openPath(page, FIXTURE_PATH);
  await landInPreview(page);
  await page.keyboard.press('Control+e');
  await expect(content).toBeVisible();
  await expect(content).toContainText('A[Write]');
  await expect(editor.locator('.mm-editor-diagram')).toHaveCount(0);

  // …and the preview pane is unaffected by its value: diagrams still draw.
  await page.keyboard.press('Control+e');
  const doc = page.getByTestId('doc');
  await expect(doc.getByTestId('mm-diagram')).toBeVisible(FIRST_DRAW);
  await expect(doc.getByTestId('mm-diagram-error')).toBeVisible();
});

// PRD 015 Req 4 (issue #170): both surfaces draw the persisted `width=N`.
const WIDTH_DOC_PATH = '/docs/sized-diagrams.md';
const WIDTH_DOC = `# Sized diagrams

\`\`\`mermaid width=500
graph TD
  A[Start] --> B[Finish]
\`\`\`

\`\`\`mermaid
graph TD
  A[Start] --> B[Finish]
\`\`\`

\`\`\`mermaid width=99px
graph TD
  A[Start] --> B[Finish]
\`\`\`
`;

test('E316: a width=N fence draws at N px in the preview and in the edit-pane widget; unadorned and malformed-width fences stay at natural size, the text untouched', async ({
  page,
}) => {
  await freshApp(page);
  await fsWrite(page, WIDTH_DOC_PATH, WIDTH_DOC);
  await openPath(page, WIDTH_DOC_PATH);
  await landInPreview(page);
  const doc = page.getByTestId('doc');
  await expect(doc.locator('h1')).toContainText('Sized diagrams');

  // PRD 015 Req 4, preview: all three fences draw (a malformed width is
  // ignored, never a failure state — PRD 015 Req 3 / PRD 013 Reqs 10–11).
  const diagrams = doc.getByTestId('mm-diagram');
  await expect(diagrams).toHaveCount(3, FIRST_DRAW);
  await expect(doc.getByTestId('mm-diagram-error')).toHaveCount(0);
  const svgAt = (i: number) => diagrams.nth(i).locator('svg');

  // The measured box, not a style string: 500 CSS px wide, height following
  // the drawing's own viewBox aspect — the whole drawing scales, no crop.
  const sized = await svgAt(0).boundingBox();
  expect(sized!.width).toBeCloseTo(500, 0);
  const [vbW, vbH] = (await svgAt(0).getAttribute('viewBox'))!.split(/\s+/).slice(2).map(Number);
  expect(sized!.height).toBeCloseTo((500 * vbH) / vbW, 0);

  // The unadorned fence keeps its natural width (500 is wider than this
  // drawing lays out, so honouring the token IS the difference)…
  const natural = await svgAt(1).boundingBox();
  expect(natural!.width).toBeGreaterThan(0);
  expect(Math.abs(natural!.width - 500)).toBeGreaterThan(50);
  // …and the malformed-width fence draws exactly like it.
  const malformed = await svgAt(2).boundingBox();
  expect(malformed!.width).toBeCloseTo(natural!.width, 0);

  // PRD 015 Req 4, edit pane: the same widths inside the mm-editor-diagram
  // widgets, drawn by the same painter over the same persisted token.
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  const widgets = editor.locator('.mm-editor-diagram').getByTestId('mm-diagram');
  await expect(widgets).toHaveCount(3, FIRST_DRAW);
  const widgetSized = await widgets.nth(0).locator('svg').boundingBox();
  expect(widgetSized!.width).toBeCloseTo(500, 0);
  const widgetNatural = await widgets.nth(1).locator('svg').boundingBox();
  expect(Math.abs(widgetNatural!.width - 500)).toBeGreaterThan(50);
  const widgetMalformed = await widgets.nth(2).locator('svg').boundingBox();
  expect(widgetMalformed!.width).toBeCloseTo(widgetNatural!.width, 0);

  // PRD 015 Req 3: reading the width mutated nothing — no dirty dot ever
  // appeared, and the stored document is byte-identical (no rewrite).
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, WIDTH_DOC_PATH)).toBe(WIDTH_DOC);
});

// PRD 015 Reqs 5–8/10–11 (issue #171): click-to-select and corner-handle
// resize for full-preview diagrams. The overlay is chrome beside the doc —
// its own testids, the SPEC20 CSS — and every release persists through the
// buffer path typing uses.
const RESIZE_DOC_PATH = '/docs/resize-diagram.md';
const RESIZE_DOC = `# Resize

A paragraph to click away on.

\`\`\`mermaid
graph TD
  A[Start] --> B[Finish]
\`\`\`
`;

async function openResizeDoc(page: import('@playwright/test').Page, doc = RESIZE_DOC) {
  await freshApp(page);
  await fsWrite(page, RESIZE_DOC_PATH, doc);
  await openPath(page, RESIZE_DOC_PATH);
  await landInPreview(page);
  const diagram = page.getByTestId('doc').getByTestId('mm-diagram');
  await expect(diagram).toBeVisible(FIRST_DRAW);
  return diagram;
}

/** The drawn SVG's viewBox [width, height] — the drag's natural bounds. */
async function viewBoxOf(diagram: import('@playwright/test').Locator): Promise<[number, number]> {
  const vb = (await diagram.locator('svg').getAttribute('viewBox'))!.split(/\s+/).slice(2).map(Number);
  return [vb[0], vb[1]];
}

test('E356: a click selects the drawn diagram — outline, four corner handles, a live size badge — and Escape or a click away deselects; all overlay-only', async ({
  page,
}) => {
  const diagram = await openResizeDoc(page);
  const doc = page.getByTestId('doc');
  const docText = () => doc.evaluate((el) => el.textContent ?? '');
  const textBefore = await docText();

  // PRD 015 Req 5: click → outline + four handles + a W × H badge.
  await diagram.click();
  const overlay = page.getByTestId('diagram-resize-overlay');
  await expect(overlay).toBeVisible();
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    await expect(page.getByTestId(`diagram-resize-handle-${corner}`)).toBeVisible();
  }
  const svgBox = await stableBox(diagram.locator('svg'));
  await expect(page.getByTestId('diagram-size-badge')).toHaveText(
    `${Math.round(svgBox.width)} × ${Math.round(svgBox.height)}`
  );

  // Escape deselects; a fresh click reselects; a click away deselects.
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await diagram.click();
  await expect(overlay).toBeVisible();
  await doc.locator('p', { hasText: 'click away' }).click();
  await expect(overlay).toHaveCount(0);

  // PRD 015 Req 5: overlay-only — no text mutation anywhere: the rendered
  // text, the stored bytes and the dirty dot are all exactly as before.
  expect(await docText()).toBe(textBefore);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, RESIZE_DOC_PATH)).toBe(RESIZE_DOC);
});

test('E318: a corner drag rescales the drawing live within [40px, natural]; the release writes width=N through the typing path and mermaid never re-runs', async ({
  page,
}) => {
  const diagram = await openResizeDoc(page);
  const svg = diagram.locator('svg');
  await diagram.click();
  await expect(page.getByTestId('diagram-resize-overlay')).toBeVisible();
  const [vbW, vbH] = await viewBoxOf(diagram);
  const start = await stableBox(svg);

  const handle = await stableBox(page.getByTestId('diagram-resize-handle-se'));
  const hx = handle.x + handle.width / 2;
  const hy = handle.y + handle.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();

  // PRD 015 Req 6: far past the floor the drawing clamps live at 40px wide,
  // its height following the viewBox aspect — and the badge tracks it.
  await page.mouse.move(hx - start.width - 600, hy, { steps: 4 });
  await expect.poll(async () => (await svg.boundingBox())!.width).toBeCloseTo(40, 0);
  expect((await svg.boundingBox())!.height).toBeCloseTo((40 * vbH) / vbW, 0);
  await expect(page.getByTestId('diagram-size-badge')).toHaveText(/^40 × /);

  // Settle on a mid-range width and watch the release: the drawing must stay
  // continuously visible, and no block may re-enter `pending`.
  const target = Math.max(50, Math.round(vbW * 0.6));
  await page.mouse.move(hx + (target - start.width), hy, { steps: 4 });
  await expect.poll(async () => (await svg.boundingBox())!.width).toBeCloseTo(target, 0);
  await page.evaluate(() => {
    const w = { frames: 0, missing: 0, pending: 0, stop: false };
    (window as unknown as { __mmWatch: typeof w }).__mmWatch = w;
    const doc = document.querySelector('[data-testid="doc"]');
    doc?.querySelector<HTMLElement>('.mm-diagram')?.setAttribute('data-mm-before-release', '1');
    const tick = () => {
      if (w.stop) return;
      w.frames += 1;
      if (!doc?.querySelector('.mm-diagram')?.shadowRoot?.querySelector('svg')) w.missing += 1;
      if (doc?.querySelector('pre[data-mm-diagram="pending"]')) w.pending += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.up();

  // PRD 015 Req 7: the buffer path typing uses — the dirty dot is up, the
  // preview re-rendered with the diagram still selected, the overlay
  // re-bound to the re-rendered host and the badge reading the new size.
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect.poll(() => diagram.evaluate((el) => el.hasAttribute('data-mm-before-release'))).toBe(false);
  await expect
    .poll(async () => Math.abs((await svg.boundingBox())!.width - target))
    .toBeLessThanOrEqual(2);
  await expect(page.getByTestId('diagram-resize-overlay')).toBeVisible();
  await expect(page.getByTestId('diagram-size-badge')).toHaveText(/^\d+ × \d+$/);

  // ⌘S writes the file exactly as a typed edit would: the fence line carries
  // width=N (inside the clamp, at the pointer), everything else verbatim.
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect
    .poll(async () => (await fsRead(page, RESIZE_DOC_PATH)) ?? '', { timeout: 10_000 })
    .toContain('```mermaid width=');
  const written = (await fsRead(page, RESIZE_DOC_PATH))!;
  const n = Number(/```mermaid width=(\d+)\n/.exec(written)![1]);
  expect(Math.abs(n - target)).toBeLessThanOrEqual(2);
  expect(n).toBeGreaterThanOrEqual(40);
  expect(n).toBeLessThanOrEqual(Math.ceil(vbW));
  expect(written).toBe(RESIZE_DOC.replace('```mermaid\n', `\`\`\`mermaid width=${n}\n`));
  await expect(page.getByTestId('diagram-size-badge')).toHaveText(new RegExp(`^${n} × `));

  // Across the whole release nothing vanished or flashed raw source.
  const watch = await page.evaluate(() => {
    const w = (window as unknown as { __mmWatch: { frames: number; missing: number; pending: number; stop: boolean } })
      .__mmWatch;
    w.stop = true;
    return w;
  });
  expect(watch.frames).toBeGreaterThan(0);
  expect(watch.missing).toBe(0); // the drawing never disappeared
  expect(watch.pending).toBe(0); // no block re-entered pending: mermaid never re-ran

  // PRD 015 Req 7: after ⌘E the edit-pane widget draws the same N.
  await page.keyboard.press('Control+e');
  const widget = page.getByTestId('editor').locator('.mm-editor-diagram').getByTestId('mm-diagram');
  await expect(widget).toBeVisible(FIRST_DRAW);
  expect((await stableBox(widget.locator('svg'))).width).toBeCloseTo(n, 0);
});

test('E319: releasing at the width the fence already carries writes nothing — no dirty dot, bytes identical', async ({
  page,
}) => {
  const diagram = await openResizeDoc(page);
  const svg = diagram.locator('svg');
  await diagram.click();
  const [vbW] = await viewBoxOf(diagram);

  // First release: drag far past the natural width — the clamp writes N once.
  const dragPastMax = async () => {
    const handle = await stableBox(page.getByTestId('diagram-resize-handle-se'));
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 600, hy, { steps: 4 });
    await page.mouse.up();
  };
  await dragPastMax();
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect
    .poll(async () => (await fsRead(page, RESIZE_DOC_PATH)) ?? '', { timeout: 10_000 })
    .toContain('width=');
  const saved = (await fsRead(page, RESIZE_DOC_PATH))!;
  const n = Number(/width=(\d+)/.exec(saved)![1]);
  expect(n).toBeLessThanOrEqual(Math.ceil(vbW)); // the natural-width clamp held
  await expect.poll(async () => (await svg.boundingBox())!.width).toBeCloseTo(n, 0);

  // Second release at the same clamped width: rewriteFenceWidth returns the
  // line unchanged, so the buffer is never touched — no dirty dot, no save.
  await expect(page.getByTestId('diagram-resize-overlay')).toBeVisible();
  await dragPastMax();
  await page.waitForTimeout(400); // a beat for any (wrong) write to land
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, RESIZE_DOC_PATH)).toBe(saved);
});

test('E320: double-click removes the width token and restores natural size; a second double-click is a no-op', async ({
  page,
}) => {
  const sized = RESIZE_DOC.replace('```mermaid\n', '```mermaid width=100\n');
  const diagram = await openResizeDoc(page, sized);
  const svg = diagram.locator('svg');
  expect((await stableBox(svg)).width).toBeCloseTo(100, 0);

  // PRD 015 Req 8: the token goes (and the single space before it), the
  // drawing returns to natural size, and the write is a buffer edit.
  await diagram.dblclick();
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect.poll(async () => (await svg.boundingBox())!.width).toBeGreaterThan(110);
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect
    .poll(async () => (await fsRead(page, RESIZE_DOC_PATH)) ?? '', { timeout: 10_000 })
    .toBe(RESIZE_DOC);

  // A widthless fence double-clicked again: no write, no dirty dot.
  await diagram.dblclick();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, RESIZE_DOC_PATH)).toBe(RESIZE_DOC);
});

test('E321: an error diagram and a fence without a data-mm-line stamp are inert — no overlay from their code, badge or drawing', async ({
  page,
}) => {
  // A list-nested fence draws but is unstamped (stampSourceLines marks only
  // direct children of the root) — selecting it could aim a rewrite at the
  // wrong line, so it must not select at all (PRD 015 Req 11).
  const doc = `# Inert

- a list item
  \`\`\`mermaid
  graph TD
    A[Start] --> B[Finish]
  \`\`\`

\`\`\`mermaid
this is not a diagram at all
\`\`\`
`;
  await freshApp(page);
  await fsWrite(page, RESIZE_DOC_PATH, doc);
  await openPath(page, RESIZE_DOC_PATH);
  await landInPreview(page);
  const pane = page.getByTestId('doc');
  const nested = pane.getByTestId('mm-diagram');
  await expect(nested).toBeVisible(FIRST_DRAW);
  await expect(pane.getByTestId('mm-diagram-error')).toBeVisible(FIRST_DRAW);
  const overlay = page.getByTestId('diagram-resize-overlay');

  // The drawn-but-unstamped diagram: a click grows nothing.
  await nested.click();
  await expect(overlay).toHaveCount(0);

  // PRD 015 Req 11: the error diagram — its visible code block and its
  // failure badge both read exactly as today, and neither click selects.
  await pane.locator('pre[data-mm-diagram="error"]').click();
  await expect(overlay).toHaveCount(0);
  await pane.getByTestId('mm-diagram-error').click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, RESIZE_DOC_PATH)).toBe(doc);
});

test('E322: a pending diagram is inert — while the renderer never settles, clicking its code block grows no overlay', async ({
  page,
}) => {
  await freshApp(page);
  // Stall mermaid's lazy chunk at the network: the fence stays honestly in
  // the `pending` state (PRD 013 Req 11) for the whole test.
  await page.route('**/*mermaid*', () => {
    /* never fulfilled — the import hangs */
  });
  await fsWrite(page, RESIZE_DOC_PATH, RESIZE_DOC);
  await openPath(page, RESIZE_DOC_PATH);
  await landInPreview(page);
  const pending = page.getByTestId('doc').locator('pre[data-mm-diagram="pending"]');
  await expect(pending).toBeVisible();
  await pending.click();
  await expect(page.getByTestId('diagram-resize-overlay')).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await page.unroute('**/*mermaid*');
});

// PRD 015 Req 9 (issue #172): the resize gesture is invisible to the comment
// layer — the rendered-text coordinate space never moves (the diagram
// contributes zero text nodes, PRD 013 Req 3), so sidecar anchors above AND
// below a diagram are the same bytes before and after the whole gesture.
const ANCHOR_DOC_PATH = '/docs/resize-anchor.md';
const ANCHOR_SIDECAR_PATH = '/docs/resize-anchor.md.comments.json';
const ANCHOR_DOC = `# Anchor Invariance

A phrase above the diagram to comment on.

\`\`\`mermaid
graph TD
  A[Start] --> B[Finish]
\`\`\`

A phrase below the diagram to comment on.
`;

test('E357: PRD 015 Req 9 — comments above and below a diagram keep resolving, their anchor bytes unchanged, across select, corner-drag resize, double-click reset and a cold reopen', async ({
  page,
}) => {
  await freshApp(page);
  await fsWrite(page, ANCHOR_DOC_PATH, ANCHOR_DOC);
  await openPath(page, ANCHOR_DOC_PATH);
  await landInPreview(page);
  const doc = page.getByTestId('doc');
  const diagram = doc.getByTestId('mm-diagram');
  await expect(diagram).toBeVisible(FIRST_DRAW);
  const svg = diagram.locator('svg');

  await addComment(page, 'above the diagram', 'anchored above');
  await addComment(page, 'below the diagram', 'anchored below');
  const expectResolved = async () => {
    // Both highlights on the same phrases, both cards present, no orphans.
    await expect(page.locator('mark.hl')).toHaveText(['above the diagram', 'below the diagram']);
    await expect(page.getByTestId('comment-card')).toHaveCount(2);
    await expect(page.getByTestId('orphan-badge')).toHaveCount(0);
  };
  await expectResolved();

  // The stored anchors, or none while the sidecar is still unwritten.
  const anchorsOf = async (): Promise<unknown[]> => {
    const raw = await fsRead(page, ANCHOR_SIDECAR_PATH);
    return raw ? JSON.parse(raw).comments.map((c: { anchor: unknown }) => c.anchor) : [];
  };
  // Wait for the sidecar autosave (debounced 800 ms) to land both anchors.
  await expect.poll(async () => (await anchorsOf()).length).toBe(2);
  const anchorsBefore = await anchorsOf();

  const docText = () => doc.evaluate((el) => el.textContent ?? '');
  const textBefore = await docText();

  // Select: overlay chrome only — text and highlights untouched.
  await diagram.click();
  await expect(page.getByTestId('diagram-resize-overlay')).toBeVisible();
  expect(await docText()).toBe(textBefore);
  await expectResolved();

  // Corner drag to a mid-range width (E318's shape), released and saved.
  const [vbW] = await viewBoxOf(diagram);
  const start = await stableBox(svg);
  const handle = await stableBox(page.getByTestId('diagram-resize-handle-se'));
  const hx = handle.x + handle.width / 2;
  const hy = handle.y + handle.height / 2;
  const target = Math.max(50, Math.round(vbW * 0.6));
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + (target - start.width), hy, { steps: 4 });
  expect(await docText()).toBe(textBefore); // mid-drag: still byte-identical
  await page.mouse.up();
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect
    .poll(async () => (await fsRead(page, ANCHOR_DOC_PATH)) ?? '', { timeout: 10_000 })
    .toContain('```mermaid width=');
  expect(await docText()).toBe(textBefore); // after the release
  await expectResolved();
  // PRD 015 Req 9: the same numbers, not merely still-resolving ones.
  expect(await anchorsOf()).toEqual(anchorsBefore);

  // Double-click reset: the token goes, the bytes return to the original.
  await diagram.dblclick();
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect
    .poll(async () => (await fsRead(page, ANCHOR_DOC_PATH)) ?? '', { timeout: 10_000 })
    .toBe(ANCHOR_DOC);
  expect(await docText()).toBe(textBefore); // after the reset
  await expectResolved();
  expect(await anchorsOf()).toEqual(anchorsBefore);

  // From cold (E310's shape): the untouched sidecar re-resolves against a
  // freshly drawn diagram.
  await openPath(page, '/docs/welcome.md');
  await expect(doc.locator('h1')).toContainText('Welcome to Marky Mark');
  await openPath(page, ANCHOR_DOC_PATH);
  await landInPreview(page);
  await expect(diagram).toBeVisible(FIRST_DRAW);
  await expectResolved();
  expect(await docText()).toBe(textBefore);
  expect(await anchorsOf()).toEqual(anchorsBefore);
});
