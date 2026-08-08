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
const filler = (word: string) => `${word} padding prose.\n\n`.repeat(40);

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

// --- PRD 011 Reqs 25–27 (#118): real summaries, on demand -------------------
// Everything below configures a provider through the LLM providers tab and
// drives the shim's LOCAL FAKE (PRD 011 Req 35) — no real provider is ever
// contacted. The fake is scripted through the shim's own handle
// (`src/platform/browser.ts`), which exists in no other flavor.

/** The shim's fake, as an e2e sees it: script an outcome, count what was asked. */
interface ShimFakeHandle {
  fake: {
    calls: unknown[];
    respondWith(outcome: unknown): void;
    queue(...outcomes: unknown[]): void;
    reset(): void;
  };
  delayMs: number;
}

declare global {
  interface Window {
    __mmFakeLlm?: ShimFakeHandle;
  }
}

/** Settings → LLM providers → a configured, ready provider (PRD 011 Req 9). */
async function configureProvider(page: Page): Promise<void> {
  await openSettings(page, 'llm');
  await page.getByTestId('llm-model-preset').selectOption('claude-opus-5');
  await page.getByTestId('llm-api-key').fill('sk-e235-secret');
  await expect(page.getByTestId('llm-availability')).toContainText('Ready');
  await page.getByTestId('settings-close').click();
}

/**
 * PRD 011 Req 33 (#119): entering a level that would actually spend something
 * now asks first. Proceed starts exactly the run #118 already started, so every
 * case below that expects real summaries clicks through this one confirmation.
 */
async function proceedSummaries(page: Page): Promise<void> {
  await expect(page.getByTestId('summary-confirm')).toBeVisible();
  await page.getByTestId('summary-confirm-proceed').click();
  await expect(page.getByTestId('summary-confirm')).toHaveCount(0);
}

const fakeCalls = (page: Page): Promise<number> =>
  page.evaluate(() => window.__mmFakeLlm?.fake.calls.length ?? 0);

const scriptFake = (page: Page, script: { text?: string; delayMs?: number; queue?: unknown[] }): Promise<void> =>
  page.evaluate((s) => {
    const handle = window.__mmFakeLlm;
    if (!handle) throw new Error('the shim installed no fake LLM');
    handle.fake.reset();
    handle.delayMs = s.delayMs ?? 0;
    if (s.text !== undefined) handle.fake.respondWith({ outcome: 'text', text: s.text });
    if (s.queue) handle.fake.queue(...s.queue);
  }, script);

test('E235: PRD 011 Req 25 — a zoomed level fills its blocks, and typing, saving and opening ask nothing', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);
  await configureProvider(page);
  await scriptFake(page, { text: 'A generated summary.' });

  // Opening the document and typing at L5 cost NOTHING: no request is made on
  // open, on a settings change, on mount or on a timer (PRD 011 Req 16).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('typed at L5 ');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty')).toHaveCount(0);
  expect(await fakeCalls(page)).toBe(0);

  // Entering L4 is what asks. Every block is a real summary, and the view says
  // these are summaries rather than claiming they are excerpts.
  await page.getByTestId('semantic-zoom-out').click();
  await proceedSummaries(page);
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(4);
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('A generated summary.');
  await expect(page.getByTestId('semantic-zoom-summary-note')).toHaveCount(1);
  await expect(page.getByTestId('semantic-zoom-excerpt-note')).toHaveCount(0);
  expect(await fakeCalls(page)).toBe(4);

  // Re-entering the SAME level asks nothing again: every key is a cache hit.
  await page.getByTestId('semantic-zoom-full').click();
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await page.getByTestId('semantic-zoom-slider').fill('4');
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('A generated summary.');
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  expect(await fakeCalls(page)).toBe(4);
});

test('E236: PRD 011 Req 26 — blocks show their structure pending, and leaving the level abandons the work', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);
  await configureProvider(page);
  // A deliberately slow reply, so the pending state is observed rather than raced.
  await scriptFake(page, { text: 'Slow summary.', delayMs: 2000 });

  await page.getByTestId('semantic-zoom-slider').fill('3');
  await proceedSummaries(page);
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  // The structure is there immediately — heading, depth and folded-in list —
  // with a pending state where each summary will land.
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(3);
  await expect(page.getByTestId('semantic-zoom-pending')).toHaveCount(3);
  await expect(page.getByTestId('semantic-zoom-heading').first()).toContainText('Field Notes');
  await expect(page.getByTestId('semantic-zoom-folded').first()).toContainText('Smart edit');
  await expect(page.getByTestId('semantic-zoom-title')).toContainText('Field Notes');

  // Leaving the level abandons the run: the late results reach no view state.
  await page.getByTestId('semantic-zoom-full').click();
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  expect(await page.locator('body').innerText()).not.toContain('Slow summary.');

  // Re-entering re-plans from the cache: what completed before the run was
  // abandoned is a hit, so those blocks fill immediately.
  await scriptFake(page, { text: 'Second pass.', delayMs: 0 });
  await page.getByTestId('semantic-zoom-slider').fill('3');
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(3);
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('Slow summary.');

  // Turning the Experimental feature off from a zoomed level abandons it too.
  await scriptFake(page, { text: 'Third pass.', delayMs: 2000 });
  await page.getByTestId('semantic-zoom-slider').fill('2');
  await proceedSummaries(page);
  await expect(page.getByTestId('semantic-zoom-pending')).toHaveCount(1);
  await setSemanticZoom(page, false);
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await page.waitForTimeout(2500);
  expect(await page.locator('body').innerText()).not.toContain('Third pass.');
});

test('E237: PRD 011 Req 27 — a failed section says why, retries alone, and its siblings stay summarized', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);
  await configureProvider(page);
  // The second of the three L3 blocks fails; the others succeed.
  await scriptFake(page, {
    text: 'A generated summary.',
    queue: [
      { outcome: 'text', text: 'A generated summary.' },
      { outcome: 'failure', kind: 'rate-limited', retryAfterSeconds: 9 },
    ],
  });

  await page.getByTestId('semantic-zoom-slider').fill('3');
  await proceedSummaries(page);
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(3);
  await expect(page.getByTestId('semantic-zoom-failure')).toHaveCount(1);
  // The seam's OWN reason, with its retry hint — not a sentence this view wrote.
  await expect(page.getByTestId('semantic-zoom-failure')).toContainText('retry in 9s');
  // The failure costs the summary, not the structure: heading and folded list stay.
  await expect(page.getByTestId('semantic-zoom-heading')).toHaveCount(3);
  await expect(page.getByTestId('semantic-zoom-folded').first()).toContainText('Smart edit');
  // …and the sibling blocks keep their summaries.
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(2);
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('A generated summary.');
  const beforeRetry = await fakeCalls(page);

  // A retry that fails again stays retryable — nothing is one-shot.
  await page.evaluate(() =>
    window.__mmFakeLlm?.fake.queue({ outcome: 'failure', kind: 'unreachable-host' })
  );
  await page.getByTestId('semantic-zoom-retry').click();
  await expect(page.getByTestId('semantic-zoom-failure')).toContainText('Could not reach the provider');
  await expect(page.getByTestId('semantic-zoom-retry')).toHaveCount(1);
  expect(await fakeCalls(page)).toBe(beforeRetry + 1);

  // The successful retry re-requests exactly that section: one more call, and
  // no sibling reverts to pending or to an excerpt.
  await page.getByTestId('semantic-zoom-retry').click();
  await expect(page.getByTestId('semantic-zoom-failure')).toHaveCount(0);
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(3);
  expect(await fakeCalls(page)).toBe(beforeRetry + 2);
  await expect(page.getByTestId('semantic-zoom-excerpt-note')).toHaveCount(0);

  // One failure never empties the view: a level where every section fails still
  // renders every heading, its title and the way back.
  await scriptFake(page, {});
  await page.evaluate(() => window.__mmFakeLlm?.fake.respondWith({ outcome: 'failure', kind: 'bad-key' }));
  await page.getByTestId('semantic-zoom-slider').fill('4');
  await proceedSummaries(page);
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(4);
  await expect(page.getByTestId('semantic-zoom-failure')).toHaveCount(4);
  await expect(page.getByTestId('semantic-zoom-title')).toContainText('Field Notes');
  await expect(page.getByTestId('semantic-zoom-full')).toBeVisible();
  await page.getByTestId('semantic-zoom-full').click();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
});

// --- PRD 011 Reqs 3+30 (#120): standing the feature down --------------------
// The two one-click actions live on the LLM providers page, and the switch that
// turns the feature off leaves nothing running and deletes nothing. Still the
// shim's local fake throughout (PRD 011 Req 35).

test('E238: PRD 011 Req 30 — the page reports what the cache holds, and one click really empties it', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);
  await configureProvider(page);
  await scriptFake(page, { text: 'A generated summary.' });

  // Summarize one level, so the store holds exactly what that run produced.
  await page.getByTestId('semantic-zoom-slider').fill('4');
  await proceedSummaries(page);
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  expect(await fakeCalls(page)).toBe(4);
  await page.getByTestId('semantic-zoom-full').click();

  // Opening the page is the whole action: the size is read from the store and
  // reported in a sentence. The desktop cache is the reader's own, so there is
  // no shared-cache warning.
  await openSettings(page, 'llm');
  await expect(page.getByTestId('summary-cache-size')).toContainText('4 summaries');
  await expect(page.getByTestId('summary-cache-size')).toContainText('about');
  await expect(page.getByTestId('summary-cache-shared')).toHaveCount(0);

  // One click clears. The report updates in place, without reopening Settings,
  // and clearing asks the provider for nothing.
  await page.getByTestId('summary-cache-clear').click();
  await expect(page.getByTestId('summary-cache-size')).toContainText('Empty');
  await expect(page.getByTestId('summary-cache-clear-failure')).toHaveCount(0);
  expect(await fakeCalls(page)).toBe(4);
  await page.getByTestId('settings-close').click();

  // The store really is empty: a fresh read on a reopened page says so too.
  await openSettings(page, 'llm');
  await expect(page.getByTestId('summary-cache-size')).toContainText('Empty');
  await page.getByTestId('settings-close').click();

  // …and the session memo went with it. Re-entering the SAME level asks the
  // fake again instead of being served from memory.
  await page.getByTestId('semantic-zoom-slider').fill('4');
  // PRD 011 Req 33: no second confirmation — this is the SAME run identity the
  // reader already approved above (same document, content, level and
  // provider/model), and the question is asked at most once per identity.
  await expect(page.getByTestId('summary-confirm')).toHaveCount(0);
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('A generated summary.');
  expect(await fakeCalls(page)).toBe(8);
});

test('E239: PRD 011 Req 3 — the Experimental row routes to Remove key, and removal drops back to excerpts', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);
  await configureProvider(page);
  await scriptFake(page, { text: 'A generated summary.' });

  await page.getByTestId('semantic-zoom-slider').fill('4');
  await proceedSummaries(page);
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  const before = await fakeCalls(page);

  // Discoverability: the Experimental row names where the stand-down actions
  // are and lands on that page itself, in one click.
  await openSettings(page, 'experimental');
  await expect(page.getByTestId('experimental-semantic-zoom-stand-down')).toContainText('deletes nothing');
  await page.getByTestId('experimental-semantic-zoom-stand-down-link').click();
  await expect(page.getByTestId('llm-api-key')).toBeVisible();

  // One click takes the key out, and the area answers with the no-key sentence.
  await page.getByTestId('llm-remove-key').click();
  await expect(page.getByTestId('llm-api-key')).toHaveValue('');
  await expect(page.getByTestId('llm-availability')).toContainText('No API key configured');
  await expect(page.getByTestId('llm-test')).toBeDisabled();
  await expect(page.getByTestId('llm-test')).toHaveAttribute('title', /No API key configured/);
  // With nothing to remove, the action cannot claim to have removed anything.
  await expect(page.getByTestId('llm-remove-key')).toBeDisabled();
  // Removing the key did NOT clear the cache: two actions, side by side.
  await expect(page.getByTestId('summary-cache-size')).toContainText('4 summaries');
  await page.getByTestId('settings-close').click();

  // The open level falls back to #117's excerpts and its notice — no error
  // state, no empty view, and no request made along the way.
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  await expect(page.getByTestId('semantic-zoom-excerpt-note')).toHaveCount(1);
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('Opening prose');
  expect(await fakeCalls(page)).toBe(before);

  // The key is gone from the file it was stored in, and appears in no other.
  expect((await fsRead(page, '/config/settings.json')) ?? '').not.toContain('sk-e235-secret');
});

test('E240: PRD 011 Req 3 — off leaves nothing running, deletes nothing, and back on still serves the cache', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);
  await configureProvider(page);
  await scriptFake(page, { text: 'A generated summary.' });

  await page.getByTestId('semantic-zoom-slider').fill('4');
  await proceedSummaries(page);
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  expect(await fakeCalls(page)).toBe(4);
  await page.getByTestId('semantic-zoom-full').click();

  // Off, then on again: the feature comes back with no restart, and the cache
  // still serves — turning the switch off deleted nothing behind the reader.
  await setSemanticZoom(page, false);
  await expect(page.getByTestId('semantic-zoom-control')).toHaveCount(0);
  await setSemanticZoom(page, true);
  await page.getByTestId('semantic-zoom-slider').fill('4');
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  expect(await fakeCalls(page)).toBe(4);
  await page.getByTestId('semantic-zoom-full').click();
  await setSemanticZoom(page, false);

  // With the feature off, on a document that HAS cached summaries: nothing is
  // asked on a document open, on typing, on saving, or from any of the three
  // accelerators — the feature is absent, so no path can build a request.
  await fsWrite(page, '/docs/other.md', '# Other\n\nOther prose.\n');
  await page.goto('/#open=/docs/other.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Other');
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  expect(await fakeCalls(page)).toBe(4);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('typed with the feature off ');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+Minus');
  await page.keyboard.press('Control+Shift+Equal');
  await page.keyboard.press('Control+Shift+0');
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  expect(await fakeCalls(page)).toBe(4);

  // And the switch destroyed nothing: the pasted key and the paid-for cache are
  // both still there, offered for removal rather than removed.
  await openSettings(page, 'llm');
  await expect(page.getByTestId('llm-api-key')).toHaveValue('sk-e235-secret');
  await expect(page.getByTestId('llm-availability')).toContainText('Ready');
  await expect(page.getByTestId('summary-cache-size')).toContainText('4 summaries');
  // PRD 011 Req 4: the page, its tab and Test connection are not gated on the
  // Experimental switch at all.
  await expect(page.getByTestId('llm-test')).toBeEnabled();
  await page.getByTestId('settings-close').click();
});

// --- PRD 011 Reqs 31–33 (#119): cost transparency ---------------------------
// The curated recommendation and its price, the measured usage the providers
// actually reported, and the question asked before anything is spent. Still the
// shim's local fake throughout (PRD 011 Req 35) — no provider is contacted.

/** Script the fake with an outcome that carries provider-reported usage. */
const scriptFakeWithUsage = (page: Page, usage: { inputTokens: number; outputTokens: number } | null): Promise<void> =>
  page.evaluate((u) => {
    const handle = window.__mmFakeLlm;
    if (!handle) throw new Error('the shim installed no fake LLM');
    handle.fake.reset();
    handle.delayMs = 0;
    handle.fake.respondWith({ outcome: 'text', text: 'A generated summary.', ...(u ? { usage: u } : {}) });
  }, usage);

test('E241: PRD 011 Req 31 — the page names a recommended model, its price and the caveat', async ({ page }) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');

  await openSettings(page, 'llm');
  // The default provider is Anthropic: a curated model, both prices, one caveat.
  await expect(page.getByTestId('llm-recommended-model')).toContainText('claude-haiku-4-5');
  await expect(page.getByTestId('llm-recommended-price')).toContainText('per million input tokens');
  await expect(page.getByTestId('llm-recommended-price')).toContainText('per million output tokens');
  await expect(page.getByTestId('llm-recommended-price')).toContainText('USD');
  await expect(page.getByTestId('llm-price-caveat')).toContainText('as of');
  await expect(page.getByTestId('llm-price-caveat')).toContainText('check the provider');
  await expect(page.getByTestId('llm-recommended-none')).toHaveCount(0);

  // The recommendation is selectable from the chooser it names.
  await page.getByTestId('llm-model-preset').selectOption('claude-haiku-4-5');
  await expect(page.getByTestId('llm-model')).toHaveValue('claude-haiku-4-5');

  // PRD 011 Req 31: a custom endpoint has its own sentence — no blank, no zero.
  await page.getByTestId('llm-provider').selectOption('custom');
  await expect(page.getByTestId('llm-recommended-none')).toContainText('custom endpoint');
  await expect(page.getByTestId('llm-recommended-price')).toHaveCount(0);
  await expect(page.getByTestId('llm-price-caveat')).toContainText('as of');
  await page.getByTestId('settings-close').click();
});

test('E242: PRD 011 Reqs 32+33 — Cancel spends nothing, Proceed reports what it spent', async ({ page }) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);
  await configureProvider(page);
  await scriptFakeWithUsage(page, { inputTokens: 1_000_000, outputTokens: 200_000 });

  // Entering a level that would spend asks first, naming the sections and an
  // estimate — and it is labelled an estimate, not a measurement.
  await page.getByTestId('semantic-zoom-slider').fill('4');
  await expect(page.getByTestId('summary-confirm')).toBeVisible();
  await expect(page.getByTestId('summary-confirm-sections')).toContainText('4 sections');
  await expect(page.getByTestId('summary-confirm-cost')).toContainText('Estimated');
  await expect(page.getByTestId('summary-confirm-note')).toContainText('estimates');
  expect(await fakeCalls(page)).toBe(0);

  // Cancel makes zero requests, and the level stays usable on the excerpts.
  await page.getByTestId('summary-confirm-cancel').click();
  await expect(page.getByTestId('summary-confirm')).toHaveCount(0);
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  await expect(page.getByTestId('semantic-zoom-excerpt-note')).toHaveCount(1);
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('Opening prose');
  expect(await fakeCalls(page)).toBe(0);

  // Leaving and re-entering asks again — no reload needed.
  await page.getByTestId('semantic-zoom-full').click();
  await page.getByTestId('semantic-zoom-slider').fill('4');
  await expect(page.getByTestId('summary-confirm')).toBeVisible();
  await page.getByTestId('summary-confirm-proceed').click();
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('A generated summary.');
  expect(await fakeCalls(page)).toBe(4);

  // PRD 011 Req 32: the measured figures, from the counts the provider returned.
  await openSettings(page, 'llm');
  await expect(page.getByTestId('llm-usage-last')).toContainText('4,000,000 input');
  await expect(page.getByTestId('llm-usage-last')).toContainText('800,000 output');
  await expect(page.getByTestId('llm-usage-total')).toContainText('4,000,000 input');
  await expect(page.getByTestId('llm-usage-total')).not.toContainText('Nothing summarized yet');
  await page.getByTestId('settings-close').click();
});

test('E243: PRD 011 Reqs 32+33 — “don’t ask again” is reversible, and Reset empties only the total', async ({
  page,
}) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);
  await configureProvider(page);
  await scriptFakeWithUsage(page, { inputTokens: 500_000, outputTokens: 100_000 });

  // Tick "don't ask again" on the way through the first confirmation.
  await page.getByTestId('semantic-zoom-slider').fill('4');
  await expect(page.getByTestId('summary-confirm')).toBeVisible();
  await page.getByTestId('summary-confirm-dont-ask').check();
  await page.getByTestId('summary-confirm-proceed').click();
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  await page.getByTestId('semantic-zoom-full').click();

  // A later level with real work to do summarizes with no confirmation at all.
  await page.getByTestId('semantic-zoom-slider').fill('3');
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(3);
  await expect(page.getByTestId('summary-confirm')).toHaveCount(0);
  expect(await fakeCalls(page)).toBe(7);
  await page.getByTestId('semantic-zoom-full').click();

  await openSettings(page, 'llm');
  // The suppression is visible where it can be undone — no one-way door.
  await expect(page.getByTestId('llm-confirm-summaries')).not.toBeChecked();
  await expect(page.getByTestId('llm-usage-total')).toContainText('3,500,000 input');

  // Reset empties the running total in one click and touches nothing else.
  await page.getByTestId('llm-usage-reset').click();
  await expect(page.getByTestId('llm-usage-total')).toContainText('Nothing summarized yet');
  await expect(page.getByTestId('llm-usage-last')).toContainText('1,500,000 input');
  await expect(page.getByTestId('llm-api-key')).toHaveValue('sk-e235-secret');
  await expect(page.getByTestId('llm-model')).toHaveValue('claude-opus-5');
  await expect(page.getByTestId('summary-cache-size')).toContainText('7 summaries');

  // Turning confirmations back on makes the next spending level ask again.
  await page.getByTestId('llm-confirm-summaries').check();
  await page.getByTestId('settings-close').click();
  await page.getByTestId('semantic-zoom-slider').fill('2');
  await expect(page.getByTestId('summary-confirm')).toBeVisible();
  await page.getByTestId('summary-confirm-cancel').click();
  expect(await fakeCalls(page)).toBe(7);
});

test('E244: PRD 011 Req 32 — a provider that returns no usage is said so, not shown as zero', async ({ page }) => {
  await fsWrite(page, '/docs/zoom.md', ZOOM_DOC);
  await page.goto('/#open=/docs/zoom.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
  await setSemanticZoom(page, true);
  await configureProvider(page);
  // The same scripted reply, with no usage block at all.
  await scriptFakeWithUsage(page, null);

  await page.getByTestId('semantic-zoom-slider').fill('4');
  await proceedSummaries(page);
  await expect(page.getByTestId('semantic-zoom-body')).toHaveCount(4);
  expect(await fakeCalls(page)).toBe(4);

  await openSettings(page, 'llm');
  await expect(page.getByTestId('llm-usage-last')).toContainText('The provider returned no usage data');
  await expect(page.getByTestId('llm-usage-last')).toContainText('4 calls could not be measured');
  await expect(page.getByTestId('llm-usage-last')).not.toContainText('USD 0.00');
  await expect(page.getByTestId('llm-usage-total')).toContainText('The provider returned no usage data');
  await page.getByTestId('settings-close').click();
});
