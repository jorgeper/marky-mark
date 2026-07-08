import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

/**
 * W-tests (SPEC2 §7): run against the BUILT single-file web app
 * (dist-web/index.html served statically — see playwright.web.config.ts).
 * The File System Access API is deleted via addInitScript so the suite
 * exercises the portable fallback paths (input[type=file] open, download
 * save) that work in every browser.
 */

const SAMPLE_MD = `# Web Sample\n\nA paragraph to comment on with plenty of unique text inside it.\n\n- one\n- two\n`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Force the portable fallbacks (automatable in headless Chromium).
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openWelcomeViaHelp(page);
});

async function revealToolbar(page: import('@playwright/test').Page) {
  await page.mouse.move(500, 8);
  await expect(page.getByTestId('menu-btn')).toBeVisible();
}

async function openWelcomeViaHelp(page: import('@playwright/test').Page) {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
}

async function openSettings(
  page: import('@playwright/test').Page,
  tab: 'appearance' | 'general' | 'hotkeys' = 'appearance'
) {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-panel').waitFor();
  await page.getByTestId(`settings-tab-${tab}`).click();
}

/** Drop an in-page-constructed .md File onto the window. */
async function dropFile(page: import('@playwright/test').Page, name: string, content: string) {
  await page.evaluate(
    ([n, c]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([c], n, { type: 'text/markdown' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [name, content] as const
  );
}

test('W1: single-file page loads with the welcome doc; theme change persists across reload', async ({ page }) => {
  // Welcome state already asserted in beforeEach; storage control is locked to embedded.
  await openSettings(page, 'general');
  await expect(page.getByTestId('comment-storage')).toHaveValue('embedded');
  await expect(page.getByTestId('comment-storage')).toBeDisabled();

  await page.getByTestId('settings-tab-appearance').click();
  await page.getByTestId('settings-theme-light').selectOption('monokai');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)');
  await page.getByTestId('settings-close').click();

  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)');
  await openWelcomeViaHelp(page); // the document view keeps the theme too
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)');
});

test('W2: drag-and-drop of a markdown file opens and renders it', async ({ page }) => {
  await dropFile(page, 'dropped.md', SAMPLE_MD);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Web Sample');
  await expect(page.getByTestId('doc')).toContainText('plenty of unique text');
  await expect(page.getByTestId('docname')).toContainText('dropped.md');
});

test('W3: open via file-input fallback, comment, Save downloads the file with the embedded trailer; reopening restores it', async ({
  page,
}) => {
  // Open through the hidden <input type=file> (FSAA was deleted).
  const chooserPromise = page.waitForEvent('filechooser');
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-open').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'picked.md', mimeType: 'text/markdown', buffer: Buffer.from(SAMPLE_MD) });
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Web Sample');

  // Comment on it.
  await page.evaluate(() => {
    const doc = document.querySelector('[data-testid="doc"]')!;
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue?.indexOf('plenty of unique text') ?? -1;
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'plenty of unique text'.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    throw new Error('phrase not found');
  });
  await page.getByTestId('add-comment-btn').click();
  await page.getByTestId('composer-input').fill('web comment');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('card-body')).toHaveText('web comment');

  // Save → download (no handle without FSAA).
  const downloadPromise = page.waitForEvent('download');
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-save').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('picked.md');
  const savedPath = await download.path();
  const saved = readFileSync(savedPath, 'utf8');
  expect(saved).toContain('markimark-comments');
  expect(saved).toContain('web comment');
  expect(saved.trimEnd().endsWith('-->')).toBe(true);

  // Re-open the downloaded file (drag-drop) → the comment comes back.
  await dropFile(page, 'picked-roundtrip.md', saved);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Web Sample');
  await expect(page.getByTestId('card-body')).toHaveText('web comment');
  await expect(page.locator('mark.hl').first()).toBeVisible();
  // The trailer never shows in the rendered doc.
  await expect(page.getByTestId('doc')).not.toContainText('markimark-comments');
});

test('W4: zero network requests after initial load (self-contained page)', async ({ page }) => {
  const extraRequests: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('data:') && !req.url().startsWith('blob:')) extraRequests.push(req.url());
  });

  // Exercise every subsystem: theme switch, settings, edit mode (lazy chunk
  // must be inlined, not fetched), comments UI.
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('dracula');
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('Welcome to Marky Mark');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toBeVisible();
  await dropFile(page, 'w4.md', SAMPLE_MD);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Web Sample');

  expect(extraRequests).toEqual([]);
});

test('W5: network isolation — adversarial doc: zero non-localhost requests; remote link never navigates the page; CSP baked in', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    const host = new URL(url).hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') external.push(url);
  });
  // Abort anything external context-wide (covers the hand-off tab too).
  await page.context().route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === 'localhost' || host === '127.0.0.1' ? route.continue() : route.abort();
  });

  // The page carries its own CSP (SPEC11 §3.2).
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain('img-src data: blob:');

  const adversarial = readFileSync(new URL('../../fixtures/adversarial.md', import.meta.url), 'utf8');
  await dropFile(page, 'adversarial.md', adversarial);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Adversarial');
  const placeholders = page.locator('.mm-blocked-remote');
  await expect(placeholders).toHaveCount(2);
  await expect(placeholders.first()).toContainText('remote image (evil.example.com');
  expect(external).toEqual([]); // rendering attempted nothing non-local

  // Remote link: the hand-off may open a (blocked) new tab, but the app page
  // itself never navigates.
  const before = page.url();
  await page.getByRole('link', { name: 'click me' }).click();
  await page.waitForTimeout(400);
  expect(page.url()).toBe(before);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Adversarial');
});
