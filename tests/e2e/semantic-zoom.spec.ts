// PRD 011 Reqs 1/2/17/18/19/20/21/22 (#117): the Experimental section and the
// excerpt-backed semantic zoom view, on the desktop shim with no LLM provider
// configured at all. Nothing here contacts a provider (PRD 011 Req 35).
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { freshApp, fsRead, fsWrite, openSettings } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

/** Long enough that the full document really scrolls (PRD 011 Req 19). */
const filler = (word: string) => `${`${word} padding prose.\n\n`.repeat(40)}`;

const ZOOM_DOC = `# Field Notes

Opening prose for the whole document. It runs a little long on purpose.

## Editing

Editing prose lives here. A second sentence follows it.

${filler('Editing')}
### Smart edit

Smart edit prose sits one level deeper.

${filler('Smart')}
## Viewing

Viewing prose lives here.

${filler('Viewing')}`;

/** Settings → Experimental → flip the semantic-zoom checkbox (PRD 011 Req 1). */
async function setSemanticZoom(page: Page, on: boolean): Promise<void> {
  await openSettings(page, 'experimental');
  const box = page.getByTestId('experimental-semantic-zoom');
  if (on) await box.check();
  else await box.uncheck();
  await page.getByTestId('settings-close').click();
}

test('E229: PRD 011 Reqs 1+2 — the Experimental section ships off, and off means the feature is absent', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');

  // Off by default: no control, no zoomed view, no View row, no accelerator.
  await expect(page.getByTestId('semantic-zoom-control')).toHaveCount(0);
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+Minus');
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');

  // The section itself: one row, unchecked, described, and warned about once.
  await openSettings(page, 'experimental');
  await expect(page.getByTestId('experimental-semantic-zoom')).not.toBeChecked();
  await expect(page.getByTestId('experimental-semantic-zoom-description')).toContainText('five levels');
  await expect(page.getByTestId('experimental-warning')).toHaveCount(1);
  await expect(page.getByTestId('experimental-warning')).toContainText('may change');
  await page.getByTestId('settings-close').click();

  // On: the control exists. Off again: it is gone, with no restart.
  await setSemanticZoom(page, true);
  await expect(page.getByTestId('semantic-zoom-control')).toBeVisible();
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  await setSemanticZoom(page, false);
  await expect(page.getByTestId('semantic-zoom-control')).toHaveCount(0);
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
});

test('E230: PRD 011 Reqs 17+21+22 — all five levels work on excerpts with no provider configured', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);

  // L5: the untouched document, and `+` is inert at the top of the range.
  await expect(page.getByTestId('semantic-zoom-level')).toContainText('Full document');
  await expect(page.getByTestId('semantic-zoom-in')).toBeDisabled();
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);

  // L4: every heading, one block each, all of them excerpts.
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(4);
  await expect(page.getByTestId('semantic-zoom-excerpt-note')).toHaveCount(1);
  await expect(page.getByTestId('semantic-zoom-excerpt-note')).toContainText('excerpts');
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('Opening prose');

  // L3: headings to depth 2, the deeper one folded into its kept ancestor.
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(3);
  await expect(page.getByTestId('semantic-zoom-folded').first()).toContainText('Smart edit');

  // L2: top-level headings only. L1: the document in one block.
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(1);
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-level')).toContainText('Whole document');
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(1);
  // Bottom of the range: `−` is inert rather than wrapping.
  await expect(page.getByTestId('semantic-zoom-out')).toBeDisabled();

  // The draggable handle drives the SAME state as the buttons and the keys.
  await page.getByTestId('semantic-zoom-slider').fill('4');
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(4);
  await page.keyboard.press('Control+Shift+Equal');
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
});

test('E231: PRD 011 Req 18 — a zoomed level is read-only and leaves the buffer byte-identical', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);

  // Enter edit mode first: zooming out from it is allowed and reversible.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  // No editor to type into at a zoomed level.
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await page.getByTestId('semantic-zoom-title').click();
  await page.keyboard.type('THIS MUST NOT LAND');
  await page.keyboard.press('Control+b');

  // Back to L5: the same editable buffer, the same mode, byte-identical.
  await page.getByTestId('semantic-zoom-full').click();
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('THIS MUST NOT LAND');
  await expect(page.getByTestId('dirty')).toHaveCount(0);
  await page.keyboard.press('Control+s');
  expect(await fsRead(page, '/docs/zoom.md')).toBe(ZOOM_DOC);
});

test('E232: PRD 011 Req 19 — clicking a heading dives one level, and L5 lands on that section', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);

  // Down to L3, then dive: one click = one level toward L5.
  await page.getByTestId('semantic-zoom-slider').fill('3');
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(3);
  await page.getByTestId('semantic-zoom-heading').nth(2).click(); // "Viewing"
  await expect(page.getByTestId('semantic-zoom-level')).toContainText('L4');
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(4);

  // One more dive lands at L5 — the full document, scrolled to that section.
  await page.getByTestId('semantic-zoom-heading').nth(3).click(); // "Viewing"
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  // The landing scroll is retried until the full document has been injected,
  // so poll rather than sampling the first frame.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ws = document.querySelector('.workspace');
        const el = document.querySelector<HTMLElement>('[data-testid="doc"] h2:last-of-type');
        if (!ws || !el) return null;
        return Math.abs(el.getBoundingClientRect().top - ws.getBoundingClientRect().top);
      })
    )
    .toBeLessThan(24);

  // "Back to full document" works from every level, including the deepest.
  await page.getByTestId('semantic-zoom-slider').fill('1');
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  await page.getByTestId('semantic-zoom-full').click();
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
});

test('E234: PRD 011 Req 22 — the excerpt notice routes to the LLM providers area itself', async ({ page }) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);

  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  // The desktop shim has an LLM path, so the notice offers the route rather
  // than the no-path message.
  await expect(page.getByTestId('semantic-zoom-no-llm')).toHaveCount(0);
  await page.getByTestId('semantic-zoom-configure').click();
  // Landing on the providers tab itself — not on General with the tab to hunt.
  await expect(page.getByTestId('llm-provider')).toBeVisible();
  await page.getByTestId('settings-close').click();

  // Every other way in still opens on General, unchanged.
  await openSettings(page, 'experimental');
  await expect(page.getByTestId('experimental-semantic-zoom')).toBeChecked();
  await page.getByTestId('settings-close').click();
});

test('E233: PRD 011 Req 20 — the level is view state: every document opens at L5', async ({ page }) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await fsWrite(page, '/docs/other.md', '# Other\n\nOther prose.\n');
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);

  await page.getByTestId('semantic-zoom-slider').fill('2');
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();

  // Opening another document lands at L5, not at the level just left behind.
  await page.goto('/#open=/docs/other.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Other');
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await expect(page.getByTestId('semantic-zoom-level')).toContainText('Full document');

  // Reopening the zoomed document lands at L5 too — nothing was persisted.
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await expect(page.getByTestId('semantic-zoom-level')).toContainText('Full document');

  // …and the level appears in no file the app writes: settings.json carries
  // the Experimental switch and nothing about which level was last shown.
  const settings = (await fsRead(page, '/config/settings.json')) ?? '';
  expect(settings).toContain('semanticZoom');
  expect(settings).not.toMatch(/zoomLevel|semanticZoomLevel|"semanticZoom":\s*[0-9]/);
});
