// PRD 013 (issue #160): mermaid fences draw as diagrams in the rendered
// panes — the real mermaid library, lazily loaded through the vite dev
// server, behind the fence-renderer seam. The edit pane is #162's, not here.
import { expect, test } from './fixtures';
import { addComment, freshApp, fsRead, fsWrite, landInPreview, openPath, openSettings } from './helpers';

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

test('E309: a valid mermaid fence draws automatically; an invalid one keeps its code plus an error note; the rest of the document renders', async ({
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
