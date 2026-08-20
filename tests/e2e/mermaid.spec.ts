// PRD 013 (issue #160): mermaid fences draw as diagrams in the rendered
// panes — the real mermaid library, lazily loaded through the vite dev
// server, behind the fence-renderer seam. The edit pane is #162's, not here.
import { expect, test } from './fixtures';
import { addComment, freshApp, fsWrite, landInPreview, openPath, openSettings } from './helpers';

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
