import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
// PRD 015 Req 12 (#172): the one drag-geometry helper the desktop resize
// tests settle on; pure Playwright, nothing shim-bound.
import { stableBox } from './helpers';
// PRD 011 Req 9 (#121): the static-web sentence comes from the module that
// owns it, so a reword fails W14 rather than passing against a stale copy.
import { NO_LLM_PLATFORM_MESSAGE } from '../../src/lib/llmSettings';

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
  // PRD 011 Reqs 9+22 (#121): widened for the two tabs the web build's LLM
  // story lives on — same helper, two more destinations, no caller replaced.
  tab: 'appearance' | 'general' | 'hotkeys' | 'llm' | 'experimental' = 'appearance'
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
  await page.getByTestId('add-note-btn').click();
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
  expect(saved).toContain('marky-mark-comments');
  expect(saved).toContain('web comment');
  expect(saved.trimEnd().endsWith('-->')).toBe(true);

  // Re-open the downloaded file (drag-drop) → the comment comes back.
  await dropFile(page, 'picked-roundtrip.md', saved);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Web Sample');
  await expect(page.getByTestId('card-body')).toHaveText('web comment');
  await expect(page.locator('mark.hl').first()).toBeVisible();
  // The trailer never shows in the rendered doc.
  await expect(page.getByTestId('doc')).not.toContainText('marky-mark-comments');
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

test('W6: a review bundle boots straight into its document with the comment intact — and zero network', async ({
  page,
}) => {
  // Compose a REAL bundle from the actual built viewer, exactly as the
  // desktop exporter does (same pure function).
  const { buildReviewBundle } = await import('../../src/lib/reviewBundle');
  const template = readFileSync('dist-web/index.html', 'utf8');
  const trailer = [
    '',
    '<!-- marky-mark-comments',
    JSON.stringify(
      {
        version: 1,
        comments: [
          {
            id: 'w6c1',
            anchor: { exact: 'special phrase', prefix: 'A ', suffix: ' to anchor', start: 13, end: 27 },
            author: 'W6 Reviewer',
            createdAt: '2026-07-11T00:00:00.000Z',
            body: 'bundle note travels with the file',
            thread: [],
            resolved: false,
          },
        ],
      },
      null,
      2
    ),
    '-->',
    '',
  ].join('\n');
  const markdown = `# Bundle Doc\n\nA special phrase to anchor a comment on.\n${trailer}`;
  const bundle = buildReviewBundle(template, { name: 'bundle.md', markdown });

  const external: string[] = [];
  page.on('request', (req) => {
    const u = req.url();
    if (!u.startsWith('data:') && !u.startsWith('blob:') && !u.includes('review.html')) external.push(u);
  });
  await page.route('**/review.html', (route) => route.fulfill({ contentType: 'text/html', body: bundle }));

  await page.goto('/review.html');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Bundle Doc');
  // Issue #284: the comments pane ships closed — a bundle's stored comments
  // show once it is opened (the hotkey is one of the four toggle surfaces).
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByTestId('comment-card')).toContainText('bundle note travels with the file');
  await expect(page.locator('mark.hl')).toBeVisible();
  expect(external).toEqual([]);
});

test('W7: a bundle carrying an export theme boots with it applied — without touching saved settings', async ({
  page,
}) => {
  const { buildReviewBundle } = await import('../../src/lib/reviewBundle');
  const template = readFileSync('dist-web/index.html', 'utf8');
  const bundle = buildReviewBundle(template, {
    name: 'themed.md',
    markdown: '# Themed Doc\n\nDracula by request.\n',
    theme: 'dracula',
  });
  await page.route('**/themed.html', (route) => route.fulfill({ contentType: 'text/html', body: bundle }));

  await page.goto('/themed.html');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Themed Doc');
  // Dracula background (#282a36) applied for the session…
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(40, 42, 54)');
  // …but nothing persisted into the recipient's saved settings.
  const persisted = await page.evaluate(() => localStorage.getItem('marky-mark.web.config.v1'));
  expect(persisted ?? '').not.toContain('dracula');
});

/**
 * Full editor document text read from CodeMirror state, not the `.cm-content`
 * DOM: CodeMirror renders the viewport lazily, so DOM text is a moving
 * prefix of the document until measurement settles (issue #69 — a baseline
 * `textContent()` snapshot raced it on a slow CI runner). The state read is
 * complete regardless of what is rendered, and needs no dev seam (W10
 * asserts `__mmEdit` is absent from the web build) — CodeMirror hangs its
 * doc tile off the content DOM (`dom.cmTile`), the same handle
 * `EditorView.findFromDOM` resolves the view through.
 */
async function editorDocText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const content = document.querySelector('.cm-content') as
      | (Element & { cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } } })
      | null;
    const view = content?.cmTile?.root?.view;
    if (!view) throw new Error('CodeMirror view not reachable from .cm-content');
    return view.state.doc.toString();
  });
}

test('W8: image paste on the web build shows the needs-desktop notice and leaves the buffer unchanged', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  const before = await editorDocText(page);
  expect(before).toContain('Welcome to Marky Mark'); // baseline is the real doc, not an empty read

  await page.evaluate(() => {
    const bytes = new Uint8Array([137, 80, 78, 71]); // enough to look like a file item
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    document
      .querySelector('.cm-content')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });

  await expect(page.getByTestId('notice')).toContainText('needs the desktop app');
  expect(await editorDocText(page)).toBe(before);
});

test('W9: the New File hotkey opens an untitled buffer; Save runs the handle-less Save As and downloads Untitled.md', async ({
  page,
}) => {
  // PRD 009 Req 9/16: single-file mode has no New File menu row — creating
  // files is a workspace-mode item, and the web build has no workspaces. The
  // command itself is unchanged (no hotkey was added or removed here), so
  // SPEC21 §5.6's binding still drives the untitled-buffer flow this pins.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await expect(page.getByTestId('menu-new')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('docname').click(); // close the menu
  await page.keyboard.press('Control+n');

  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-content').click();
  await page.keyboard.type('# Web Fresh');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Force the portable Save As fallback (headless-automatable), then Save.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const downloadPromise = page.waitForEvent('download');
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-save').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Untitled.md');
  await expect(page.getByTestId('docname')).toContainText('Untitled.md');
});

test('W10: markdown token classes on by default in edit mode; vim NAV badge and G work with the setting on', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.mm-md-h1:not(.mm-md-mark)').first()).toContainText('Welcome to Marky Mark');

  await openSettings(page, 'general');
  await page.getByTestId('settings-vimnav').check();
  await page.getByTestId('settings-close').click();
  await editor.locator('.cm-line').first().click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vim-badge')).toBeVisible();
  const before = await editor.locator('.cm-scroller').evaluate((el) => el.scrollTop);
  await page.keyboard.press('G');
  await expect.poll(() => editor.locator('.cm-scroller').evaluate((el) => el.scrollTop)).toBeGreaterThan(before);

  // The __mmEdit seam is dev-shim only — never present in the web build.
  expect(await page.evaluate(() => (window as { __mmEdit?: unknown }).__mmEdit)).toBeUndefined();
});

test('W11: the find bar works on the web build; reload still lands on the splash (reopen inert on web)', async ({
  page,
}) => {
  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await page.getByTestId('find-input').fill('Marky');
  await expect(page.getByTestId('find-count')).toContainText('of');
  const before = (await page.getByTestId('find-count').textContent())!;
  await page.getByTestId('find-input').press('Enter');
  await expect(page.getByTestId('find-count')).not.toHaveText(before);
  expect(await page.locator('.doc mark.mm-find').count()).toBeGreaterThan(0);
  await page.getByTestId('find-input').press('Escape');
  await expect(page.getByTestId('find-bar')).toHaveCount(0);

  // Web documents don't survive a reload — reopen stays silently inert.
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
});

test('W12: §H25 platform boundary — no folder sidebar, no scope selector or Workspace tab, no workspace stores', async ({
  page,
}) => {
  // No folder sidebar or folder affordance anywhere in the DOM — including
  // the pane chevrons in either state (PRD 003 Req 5).
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-open-btn')).toHaveCount(0);
  await expect(page.getByTestId('folder-collapse')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);
  // The Folders hotkey (a desktop workspace surface) stays silently inert.
  await page.keyboard.press('Control+Shift+e');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);

  // Settings opens with no User | Workspace scope selector and no Workspace tab.
  await openSettings(page, 'general');
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await expect(page.getByTestId('settings-scope')).toHaveCount(0);
  await expect(page.getByTestId('settings-scope-user')).toHaveCount(0);
  await expect(page.getByTestId('settings-scope-workspace')).toHaveCount(0);
  await page.getByTestId('settings-close').click();

  // No workspace or session stores were written: nothing under
  // <configDir>/session/, no recent-workspaces.json, no .marky-workspace.
  const configKeys = await page.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('marky-mark.web.config.v1') ?? '{}'))
  );
  expect(configKeys.filter((k) => k.includes('/session/'))).toEqual([]);
  expect(configKeys.filter((k) => k.includes('recent-workspaces'))).toEqual([]);
  expect(configKeys.filter((k) => k.includes('.marky-workspace'))).toEqual([]);
});

// W13, not E204: this file's tests run against the BUILT web app, and the
// suite numbers those W<n> (CODING_STANDARDS § Testing).
test('W13: the single-file web start page offers the drag hint and Open File — and nothing it cannot honour', async ({
  page,
}) => {
  // PRD 007 Req 22: the web build has neither a folder seam nor workspaces,
  // so the capability-driven list is Open File alone — no Open Folder…, no
  // workspace rows, on the start page or in the app menu.
  // Back to the start page: a reload lands there (the welcome doc the
  // beforeEach opened is a Help action, not a boot state).
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('start-drop')).toBeVisible();
  await expect(page.getByTestId('start-openFile')).toBeVisible();
  await expect(page.getByTestId('start-actions').getByRole('button')).toHaveCount(1);
  for (const id of ['openFolder', 'newWorkspace', 'openWorkspace']) {
    await expect(page.getByTestId(`start-${id}`)).toHaveCount(0);
  }

  // PRD 009 Req 8/9: the same capability list drives the menu, so the whole
  // workspace group is absent here — and on the initial page there is no New
  // File and no Close File either, while Save / Save As… are merely greyed.
  await revealToolbar(page);
  // PRD 009 Req 7: the hamburger leads the toolbar here too — left of the
  // document name, with the popover anchored to the button.
  const btnBox = (await page.getByTestId('menu-btn').boundingBox())!;
  const nameBox = (await page.getByTestId('docname').boundingBox())!;
  expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(nameBox.x);

  await page.getByTestId('menu-btn').click();
  const menu = page.getByTestId('app-menu');
  const menuBox = (await menu.boundingBox())!;
  expect(Math.abs(menuBox.x - btnBox.x)).toBeLessThan(12);
  const rows = await menu.locator('button').evaluateAll((els) => els.map((el) => el.dataset.testid));
  expect(rows).toEqual(['menu-open', 'menu-save', 'menu-save-as', 'menu-view', 'menu-settings', 'menu-help', 'menu-about']);
  await expect(menu.getByTestId('menu-sep')).toHaveCount(3);
  await expect(menu.getByTestId('menu-save')).toBeDisabled();
  await expect(menu.getByTestId('menu-save-as')).toBeDisabled();
  await page.keyboard.press('Escape');
  // Close the menu with an outside mousedown — besides a row or the
  // hamburger, the only close the app menu implements (Toolbar's document-
  // level mousedown handler; the Escape above never reaches it). The docname
  // is no click target here: on the start page it is contractually empty
  // (SPEC5 §1 amended, issue #197 — nothing fills the title slot), so the
  // span has no height.
  await page.getByTestId('start-drop').click();
  await expect(menu).toHaveCount(0);

  // Open File on the start page opens a local file, fully client-side.
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('start-openFile').click();
  await (await chooser).setFiles({ name: 'picked.md', mimeType: 'text/markdown', buffer: Buffer.from(SAMPLE_MD) });
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Web Sample');
});

// --- PRD 011 Reqs 9+22+35 (#121): the static build's whole LLM story ---------
// Req 35 enumerates "the settings area's availability states on each flavor";
// desktop is E226–E228, hosted is E246, and this is the static web one. Req 22
// names the only semantic-zoom behaviour this build has — excerpts — and it is
// pinned here on the BUILT single-file page rather than inferred from the shim.
// Neither test can contact a provider even in principle: the bundle carries no
// provider host and its CSP forbids every outbound connection (U556–U558), and
// the shared fixture fails any request that leaves loopback (Req 35).

const ZOOM_DOC = `# Field Notes

Opening prose for the whole document. It runs a little long on purpose.

## Editing

Editing prose lives here. A second sentence follows it.

### Smart edit

Smart edit prose sits one level deeper.

## Viewing

Viewing prose lives here.
`;

test('W14: PRD 011 Reqs 8+9 — the LLM providers area says the platform has no path, and offers not one control', async ({
  page,
}) => {
  await openSettings(page, 'llm');

  // The `no-path` sentence, from the module that owns it: it names the two
  // flavors that do have a path rather than leaving the reader stuck.
  await expect(page.getByTestId('llm-availability')).toHaveText(NO_LLM_PLATFORM_MESSAGE);

  // Req 9: never a control that cannot work. Not one of them is drawn — no key
  // to type, no key to remove, no provider or model to pick, no connection to
  // test, and no cache to report or clear, because there is no store behind it.
  for (const id of [
    'llm-provider',
    'llm-model',
    'llm-model-preset',
    'llm-base-url',
    'llm-api-key',
    'llm-remove-key',
    'llm-test',
    'llm-test-result',
    'llm-hosted-provider',
    'summary-cache-size',
    'summary-cache-clear',
  ]) {
    await expect(page.getByTestId(id), `${id} is drawn on a platform that cannot use it`).toHaveCount(0);
  }
  await page.getByTestId('settings-close').click();
});

test('W15: PRD 011 Req 22 — all five levels work on excerpts, and the view says they are excerpts', async ({
  page,
}) => {
  await openSettings(page, 'experimental');
  await page.getByTestId('experimental-semantic-zoom').check();
  await page.getByTestId('settings-close').click();
  await dropFile(page, 'zoom.md', ZOOM_DOC);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');

  // L5: the untouched document, and `+` is inert at the top of the range.
  await expect(page.getByTestId('semantic-zoom-level')).toContainText('Full document');
  await expect(page.getByTestId('semantic-zoom-in')).toBeDisabled();
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);

  // L4: every heading, one block each — and each block is a deterministic
  // excerpt of that section's own opening prose, never a summary claim.
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-view')).toBeVisible();
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(4);
  await expect(page.getByTestId('semantic-zoom-body').first()).toContainText('Opening prose');
  await expect(page.getByTestId('semantic-zoom-summary-note')).toHaveCount(0);
  await expect(page.getByTestId('semantic-zoom-excerpt-note')).toContainText('excerpts');

  // Req 22 + Req 9: the notice tells the truth about THIS platform. There is
  // nowhere to configure a provider, so it says so instead of offering a route
  // that would land on a page with no controls (the desktop route is E234).
  await expect(page.getByTestId('semantic-zoom-no-llm')).toHaveText(NO_LLM_PLATFORM_MESSAGE);
  await expect(page.getByTestId('semantic-zoom-configure')).toHaveCount(0);

  // L3: headings to depth 2, the deeper one folded into its kept ancestor.
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(3);
  await expect(page.getByTestId('semantic-zoom-folded').first()).toContainText('Smart edit');

  // L2: top-level headings only. L1: the document in one block, and `−` is
  // inert at the bottom rather than wrapping.
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(1);
  await page.getByTestId('semantic-zoom-out').click();
  await expect(page.getByTestId('semantic-zoom-level')).toContainText('Whole document');
  await expect(page.getByTestId('semantic-zoom-entry')).toHaveCount(1);
  await expect(page.getByTestId('semantic-zoom-out')).toBeDisabled();
  await expect(page.getByTestId('semantic-zoom-excerpt-note')).toHaveCount(1);

  // Back to full: the document is exactly what was dropped, unchanged.
  await page.getByTestId('semantic-zoom-full').click();
  await expect(page.getByTestId('semantic-zoom-view')).toHaveCount(0);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Field Notes');
});

test('W16: PRD 013 Req 14 (issue #149) — the file tab strip is desktop-only: no strip with a document open, no View ▸ File Tabs item', async ({
  page,
}) => {
  // The beforeEach left the welcome document open — exactly the state where
  // the desktop strip must render (PRD 013 Req 1). Here: nothing, not even
  // an empty bar.
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await expect(page.getByTestId('file-tab-strip')).toHaveCount(0);
  await expect(page.getByTestId('file-tab')).toHaveCount(0);

  // The View ▸ flyout renders its usual rows but no File Tabs checkbox —
  // menuSpec omits the item wherever the tab-strip seam is absent, rather
  // than shipping a dead toggle.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-view').click();
  const flyout = page.getByTestId('app-menu-view');
  await expect(flyout).toBeVisible();
  await expect(flyout.getByTestId('menu-view-toggleMode')).toBeVisible();
  await expect(flyout.getByTestId('menu-view-toggleFileTabs')).toHaveCount(0);
});

test('W17: PRD 013 Req 8 (issue #161) — a mermaid fence draws on the built single-file page with zero network requests', async ({
  page,
}) => {
  // Same watcher shape as W4: after the initial load (done in beforeEach),
  // nothing may be fetched — mermaid is inlined, and under this page's CSP
  // (`connect-src 'none'`) a lazy chunk left un-inlined could never load, so
  // a fetch attempt here is exactly the failure this test exists to catch.
  const extraRequests: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('data:') && !req.url().startsWith('blob:')) extraRequests.push(req.url());
  });

  await dropFile(page, 'diagram.md', '# Diagram Doc\n\n```mermaid\ngraph TD\n  A[Start] --> B[Finish]\n```\n');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Diagram Doc');

  // The same success shape E309 asserts on desktop (PRD 013 Req 2): the
  // fence drew automatically and its code block is hidden but still present.
  const diagram = page.getByTestId('doc').getByTestId('mm-diagram');
  await expect(diagram).toBeVisible({ timeout: 20_000 });
  await expect(diagram.locator('svg')).toBeVisible();
  const drawnPre = page.getByTestId('doc').locator('pre[data-mm-diagram="done"]');
  await expect(drawnPre).toBeHidden();

  expect(extraRequests).toEqual([]);
});

test('W18: PRD 015 Req 12 (issue #172) — the corner-drag resize persists width=N into the document on the built single-file page', async ({
  page,
}) => {
  // Parity guard, not a re-run of the desktop matrix (E317–E323): the same
  // overlay testids drive the same gesture, and the width lands in the
  // buffer — there is no filesystem here, so the dirty dot and the edit
  // pane are the evidence of persistence.
  await dropFile(page, 'resize.md', '# Resize Doc\n\n```mermaid\ngraph TD\n  A[Start] --> B[Finish]\n```\n');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Resize Doc');
  const diagram = page.getByTestId('doc').getByTestId('mm-diagram');
  await expect(diagram).toBeVisible({ timeout: 20_000 });
  const svg = diagram.locator('svg');
  await expect(svg).toBeVisible();
  const vbW = Number((await svg.getAttribute('viewBox'))!.split(/\s+/)[2]);

  await diagram.click();
  await expect(page.getByTestId('diagram-resize-overlay')).toBeVisible();
  await expect(page.getByTestId('diagram-size-badge')).toBeVisible();
  const start = await stableBox(svg);
  const handle = await stableBox(page.getByTestId('diagram-resize-handle-se'));
  const hx = handle.x + handle.width / 2;
  const hy = handle.y + handle.height / 2;
  const target = Math.max(50, Math.round(vbW * 0.6));
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + (target - start.width), hy, { steps: 4 });
  await page.mouse.up();

  // The release wrote through the buffer path: dirty dot up, and the fence
  // line carries width=N inside the [40, natural viewBox width] clamp.
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  const buffer = await editorDocText(page);
  const match = /```mermaid width=(\d+)\n/.exec(buffer);
  expect(match).not.toBeNull();
  const n = Number(match![1]);
  expect(n).toBeGreaterThanOrEqual(40);
  expect(n).toBeLessThanOrEqual(Math.ceil(vbW));
  expect(Math.abs(n - target)).toBeLessThanOrEqual(2);
});
