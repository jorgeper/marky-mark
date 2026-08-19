import { expect, test } from './fixtures';
import {
  addComment,
  editorTopGutterLine,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  menuClick,
  NAV_P1,
  NAV_P3,
  openFolderRoot,
  openWelcomeViaHelp,
  PHRASE,
  revealToolbar,
  selectPhrase,
  splitApp,
} from './helpers';

// Reading tools (position memory, heading palette, word count) plus Export
// HTML, Print and Check for Updates.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E60: reading position memory — reopening a document restores where you were, across reloads', async ({
  page,
}) => {
  await splitApp(page, false); // long doc, currently in full edit
  await page.keyboard.press('Control+e'); // back to preview
  await expect(page.getByTestId('doc').locator('h2').first()).toBeVisible();

  const ws = page.locator('.workspace');
  await ws.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.4));
  // The debounced capture lands in positions.json.
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/positions.json');
      if (!raw) return 0;
      const store = JSON.parse(raw) as { entries: Array<{ path: string; line: number }> };
      return store.entries.find((e) => e.path === '/docs/long.md')?.line ?? 0;
    })
    .toBeGreaterThan(10);
  const savedScroll = await ws.evaluate((el) => el.scrollTop);

  // Restart the app (localStorage persists): launch never reopens anything
  // since issue #81, so reopen the document explicitly — position memory is
  // keyed to the document, not to how it was opened.
  await page.goto('/#open=/docs/long.md');
  await expect(page.getByTestId('doc').locator('h2').first()).toBeAttached();
  await expect
    .poll(() => page.locator('.workspace').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(savedScroll * 0.8);
  expect(await page.locator('.workspace').evaluate((el) => el.scrollTop)).toBeLessThan(savedScroll * 1.2);
});

test('E61: heading palette — Mod+K opens, fuzzy-filters, Enter jumps preview and editor; Esc closes', async ({
  page,
}) => {
  await splitApp(page, false); // long doc, entered full edit
  await page.keyboard.press('Control+e'); // back to preview
  await expect(page.getByTestId('doc').locator('h2').first()).toBeVisible();

  // Capture the source line of a mid-document marker while the DOM has it.
  const marker25Line = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll<HTMLElement>('.doc [data-mm-line]')).find(
      (h) => h.textContent === 'Marker 25'
    )!;
    return Number(el.dataset.mmLine);
  });

  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('heading-palette')).toBeVisible();
  await page.getByTestId('heading-palette-input').fill('marker 15');
  await expect(page.getByTestId('heading-palette-item').first()).toContainText('Marker 15');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('heading-palette')).toHaveCount(0);
  // The heading sits at the viewport top (±120px).
  const delta = () =>
    page.evaluate(() => {
      const ws = document.querySelector('.workspace')!;
      const el = Array.from(document.querySelectorAll('.doc h2')).find((h) => h.textContent === 'Marker 15')!;
      return Math.abs(el.getBoundingClientRect().top - ws.getBoundingClientRect().top);
    });
  await expect.poll(delta).toBeLessThan(120); // the jump scrolls asynchronously

  // Esc closes without jumping.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('heading-palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('heading-palette')).toHaveCount(0);

  // Edit mode: the editor scrolls to the chosen heading's source line.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByTestId('heading-palette-input').fill('marker 25');
  await expect(page.getByTestId('heading-palette-item').first()).toContainText('Marker 25');
  await page.keyboard.press('Enter');
  // CI's 2-core runners need real time for CM's iterative scroll-measure
  // convergence (heavier since the SPEC23/30 editor extensions) — timeout
  // headroom only, the assertion is unchanged.
  await expect.poll(() => editorTopGutterLine(page), { timeout: 20000 }).toBeGreaterThan(marker25Line - 6);
  expect(await editorTopGutterLine(page)).toBeLessThan(marker25Line + 6);
});

test('E62: word-count chip — document counts, selection counts, live edit updates', async ({ page }) => {
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  const chip = page.getByTestId('word-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/^\d[\d,]* words · \d+ min$/);
  const full = await chip.textContent();
  const fullWords = Number(full!.split(' ')[0].replace(/,/g, ''));

  // Selecting a phrase shrinks the count to the selection.
  await selectPhrase(page, PHRASE);
  await expect
    .poll(async () => Number((await chip.textContent())!.split(' ')[0].replace(/,/g, '')))
    .toBeLessThan(fullWords);

  // Typing in edit mode grows the count.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('several brand new counted words ');
  await expect
    .poll(async () => Number((await chip.textContent())!.split(' ')[0].replace(/,/g, '')))
    .toBeGreaterThan(fullWords);
});

test('E64: the word-count chip toggles with Mod+Shift+W and the choice persists', async ({ page }) => {
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await expect(page.getByTestId('word-chip')).toBeVisible();

  await page.keyboard.press('Control+Shift+W');
  await expect(page.getByTestId('word-chip')).toHaveCount(0);
  // Persisted: the setting survives in settings.json…
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { showWordCount?: boolean }).showWordCount : undefined;
    })
    .toBe(false);
  // …and across a restart.
  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('word-chip')).toHaveCount(0);

  await page.keyboard.press('Control+Shift+W');
  await expect(page.getByTestId('word-chip')).toBeVisible();
});

test('E63: Export HTML writes a fully static reading page with comments as numbered notes', async ({ page }) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await addComment(page, NAV_P1, 'first review note');
  await addComment(page, NAV_P3, 'second review note');

  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/welcome.review.html';
  });
  // SPEC17: Export… opens the dialog; the defaults (HTML, both includes on)
  // produce the same bundle the old one-shot export did.
  await menuClick(page, 'exportDoc');
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByTestId('export-format-html')).toHaveCount(0); // HTML-only: no format choice
  await page.getByTestId('export-run').click();
  await expect
    .poll(async () => ((await fsRead(page, '/docs/welcome.review.html')) ? 'written' : 'missing'))
    .toBe('written');

  const page63 = (await fsRead(page, '/docs/welcome.review.html'))!;
  // SPEC18 §1: a fully static reading page — no scripts, no app, no payload.
  expect(page63).not.toContain('<script');
  expect(page63).not.toContain('mm-review-doc');
  expect(page63).toContain('<title>welcome.md</title>');
  expect(page63).toContain('Welcome to Marky Mark'); // the rendered document
  // Comments as numbered static notes.
  expect(page63).toContain('<h2>Comments</h2>');
  expect(page63).toContain('id="mm-comment-1"');
  expect(page63).toContain('href="#mm-comment-1"');
  expect(page63).toContain('first review note');
  expect(page63).toContain('second review note');
});

test('E65: the Export dialog — defaults, cancel paths, and the include options shape the bundle', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await addComment(page, NAV_P1, 'optional note');

  // Defaults: HTML, both includes on, remembered theme ('current' initially).
  await menuClick(page, 'exportDoc');
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByTestId('export-include-comments')).toBeChecked();
  await expect(page.getByTestId('export-include-wordcount')).toBeChecked();
  await expect(page.getByTestId('export-theme')).toHaveValue('current');

  // Esc cancels without exporting.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
  expect(await fsRead(page, '/docs/welcome.review.html')).toBeNull();

  // Comments off → no trailer; word count on → stats line at the end.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/welcome.review.html';
  });
  await menuClick(page, 'exportDoc');
  await page.getByTestId('export-include-comments').uncheck();
  await page.getByTestId('export-run').click();
  await expect.poll(async () => ((await fsRead(page, '/docs/welcome.review.html')) ? 'ok' : 'no')).toBe('ok');
  const artifact = (await fsRead(page, '/docs/welcome.review.html'))!;
  // Comments off ⇒ no highlights, no notes section; word count on ⇒ stats line.
  expect(artifact).not.toContain('<h2>Comments</h2>');
  expect(artifact).not.toContain('mark class="hl"');
  expect(artifact).not.toContain('optional note');
  expect(artifact).toMatch(/[\d,]+ words · \d+ min read/);
  expect(artifact).not.toContain('<script');
});

test('E66: the export theme is sticky — survives reopening the dialog and an app restart; lands in the artifact', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  await menuClick(page, 'exportDoc');
  await page.getByTestId('export-theme').selectOption('dracula');
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/sticky.review.html';
  });
  await page.getByTestId('export-run').click();
  await expect.poll(async () => ((await fsRead(page, '/docs/sticky.review.html')) ? 'ok' : 'no')).toBe('ok');
  // The chosen theme's CSS travels inside the static page.
  expect((await fsRead(page, '/docs/sticky.review.html'))!).toContain('@name: Dracula');

  // Sticky in the same session…
  await menuClick(page, 'exportDoc');
  await expect(page.getByTestId('export-theme')).toHaveValue('dracula');
  await page.getByTestId('export-cancel').click();
  expect(await fsRead(page, '/config/settings.json')).toContain('"exportTheme": "dracula"');

  // …and across a restart (wait for the menu to reinstall after boot).
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!window.__mmMenu)).toBe(true);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await menuClick(page, 'exportDoc');
  await expect(page.getByTestId('export-theme')).toHaveValue('dracula');
});

test('E67: File → Print… invokes the platform native print of the current window', async ({ page }) => {
  await freshNativeMenuApp(page);
  // No document → silent no-op.
  await menuClick(page, 'printDoc');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as { __mmPrints?: string[] }).__mmPrints?.length ?? 0)).toBe(0);

  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await menuClick(page, 'printDoc');
  await expect.poll(() => page.evaluate(() => (window as { __mmPrints?: string[] }).__mmPrints?.length ?? 0)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __mmPrints: string[] }).__mmPrints[0])).toBe(
    'print-current'
  );
});

// --- File → Print… (issue #124): paper gets the document, not the app -------

/** Fire Print… through the command seam and return what would have printed. */
async function printAndRead(page: import('@playwright/test').Page): Promise<string> {
  await page.evaluate(() => {
    (window as unknown as { __mmPrintHtml?: string | null }).__mmPrintHtml = null;
    window.__mmDispatch!('printDoc');
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mmPrintHtml?: string | null }).__mmPrintHtml))
    .not.toBeNull();
  return page.evaluate(() => (window as unknown as { __mmPrintHtml: string }).__mmPrintHtml);
}

test('E249: Print… puts the RENDERED document on paper — the same page from preview and from edit mode', async ({
  page,
}) => {
  // Preview first: the rendered document, no app chrome anywhere near it.
  const fromPreview = await printAndRead(page);
  expect(fromPreview).toContain('Welcome to Marky Mark');
  expect(fromPreview).toContain('<h1');
  for (const chrome of ['toolbar-shell', 'folder-panel', 'comment-nav', 'word-chip', 'cm-editor', 'fm-card']) {
    expect(fromPreview).not.toContain(chrome);
  }

  // Edit mode prints the same page — not the raw editor it shows on screen.
  await page.keyboard.press('Control+e');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('doc')).toHaveCount(0);
  const fromEdit = await printAndRead(page);
  expect(fromEdit).toContain('Welcome to Marky Mark');
  expect(fromEdit).not.toContain('cm-content');
  expect(fromEdit).not.toMatch(/# Welcome to Marky Mark/);
  expect(fromEdit).toBe(fromPreview);
});

test('E250: Print… from split mode prints the WHOLE document, not the visible screenful', async ({ page }) => {
  await splitApp(page); // long fixture (40 sections), split edit
  const printed = await printAndRead(page);
  // On screen the workspace is a scroll box showing the first sections only;
  // on paper every one of them is there, ready to flow across pages.
  expect(printed).toContain('Marker 1');
  expect(printed).toContain('Marker 40');
  expect(printed).not.toContain('cm-content');
  await expect(page.locator('.cm-content')).toBeVisible(); // screen untouched
});

test('E251: a browser-initiated print with no print root still yields the document, not the app and not a blank page', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'a note');
  await openFolderRoot(page, '/docs');
  await revealToolbar(page);
  await page.emulateMedia({ media: 'print' });
  try {
    // Nothing was mounted — this is the fail-safe path (web ⌘P, or the
    // webview printing on its own).
    await expect(page.locator('#mm-print-root')).toHaveCount(0);
    await expect(page.getByTestId('doc')).toBeVisible();
    await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
    for (const sel of ['.toolbar-shell', '.folder-panel', '.panel', '.editor-wrap', '.comment-nav', '.word-chip']) {
      await expect(page.locator(sel)).toBeHidden();
    }
  } finally {
    await page.emulateMedia({ media: null });
  }
});

test('E252: the screen DOM is exactly as it was once printing is done', async ({ page }) => {
  const before = await page.evaluate(() => document.body.innerHTML.length);
  const printed = await printAndRead(page);
  expect(printed).toContain('Welcome to Marky Mark');

  // The transient root is gone, its body class with it, and the screen's own
  // document is still the one and only [data-testid="doc"].
  await expect.poll(() => page.locator('#mm-print-root').count()).toBe(0);
  expect(await page.evaluate(() => document.body.classList.contains('mm-printing'))).toBe(false);
  await expect(page.getByTestId('doc')).toHaveCount(1);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  expect(await page.evaluate(() => document.body.innerHTML.length)).toBe(before);
});

test('E253: with the print root mounted, paper shows only it — light, whatever dark theme the screen wears', async ({
  page,
}) => {
  // Dark theme on screen (the seeded default pair: crisp light / one-dark).
  const screenBg = () =>
    page.locator('#root .theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(screenBg).toBe('rgb(40, 44, 52)');
  const printed = await printAndRead(page);

  // Re-mount exactly what the print invocation had on the page: the shim
  // never opens print UI, so this is the only way to hold that state still.
  await page.evaluate((html) => {
    const root = document.createElement('div');
    root.id = 'mm-print-root';
    root.innerHTML = html;
    document.body.appendChild(root);
    document.body.classList.add('mm-printing');
  }, printed);
  try {
    // On screen: invisible, and the app keeps its own dark theme — the print
    // copy's styles are scoped to the root, so nothing flashes or shifts.
    await expect(page.locator('#mm-print-root')).toBeHidden();
    await expect(page.getByTestId('doc')).toBeVisible();
    expect(await screenBg()).toBe('rgb(40, 44, 52)');

    // On paper: only the print root, on a light page.
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#mm-print-root .doc')).toBeVisible();
    await expect(page.locator('#mm-print-root .doc h1')).toContainText('Welcome to Marky Mark');
    await expect(page.locator('#root')).toBeHidden();
    const paper = await page.evaluate(() => {
      const el = document.querySelector('#mm-print-root .theme-root')!;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, fg: cs.color };
    });
    expect(paper.bg).toBe('rgb(255, 255, 255)');
    expect(paper.fg).toBe('rgb(31, 35, 40)');
  } finally {
    await page.emulateMedia({ media: null, colorScheme: null });
    await page.evaluate(() => {
      document.getElementById('mm-print-root')?.remove();
      document.body.classList.remove('mm-printing');
    });
  }
});

test('E68: word count off is honored — no count anywhere in the exported page', async ({ page }) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  // HTML.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/nocount.html';
  });
  await menuClick(page, 'exportDoc');
  await page.getByTestId('export-include-wordcount').uncheck();
  await page.getByTestId('export-run').click();
  await expect.poll(async () => ((await fsRead(page, '/docs/nocount.html')) ? 'ok' : 'no')).toBe('ok');
  const artifact = (await fsRead(page, '/docs/nocount.html'))!;
  expect(artifact).not.toContain('min read');
  expect(artifact).not.toMatch(/\d+ words/);

});

test('E69: the update dialog walks available → progress → restart, and reports up-to-date honestly', async ({
  page,
}) => {
  await freshNativeMenuApp(page);

  // An update is available: version + notes shown, install runs to 100%,
  // restart is recorded on the mock.
  await page.evaluate(() => {
    window.__mmUpdate = {
      next: { version: '9.9.9', notes: 'Big fixes and bigger features.' },
      progress: [],
      installed: false,
      restarted: false,
    };
  });
  await menuClick(page, 'checkUpdates');
  await expect(page.getByTestId('update-dialog')).toBeVisible();
  await expect(page.getByTestId('update-available')).toContainText('9.9.9');
  await expect(page.getByTestId('update-available')).toContainText('Big fixes');
  await page.getByTestId('update-install').click();
  await expect(page.getByTestId('update-restart')).toBeVisible();
  expect(await page.evaluate(() => window.__mmUpdate!.installed)).toBe(true);
  expect(await page.evaluate(() => window.__mmUpdate!.progress.at(-1))).toBe(100);
  await page.getByTestId('update-restart').click();
  await expect.poll(() => page.evaluate(() => window.__mmUpdate!.restarted)).toBe(true);
  await page.keyboard.press('Escape');

  // Up to date: the dialog says so, with the current version.
  await page.evaluate(() => {
    window.__mmUpdate!.next = null;
  });
  await menuClick(page, 'checkUpdates');
  await expect(page.getByTestId('update-none')).toContainText('up to date');
  await expect(page.getByTestId('update-none')).toContainText('v0.');
});

test('E70: update-check failures are honest and recoverable — never a crash', async ({ page }) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  await page.evaluate(() => {
    window.__mmUpdate = { next: { error: 'offline: could not reach github.com' }, progress: [], installed: false, restarted: false };
  });
  await menuClick(page, 'checkUpdates');
  await expect(page.getByTestId('update-error')).toContainText('offline');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('update-dialog')).toHaveCount(0);

  // Fully alive afterwards…
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  await menuClick(page, 'toggleMode');

  // …and a second check can succeed (state resets).
  await page.evaluate(() => {
    window.__mmUpdate!.next = { version: '9.9.9', notes: '' };
  });
  await menuClick(page, 'checkUpdates');
  await expect(page.getByTestId('update-available')).toContainText('9.9.9');
});
