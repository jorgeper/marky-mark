// PRD 006 §1/§2/§5/§10/§11/§12 (#50): live preview wired into the shipped
// app — the experimental settings toggle, theme-token styling, the
// openExternal link hand-off, edit-adjacent feature compatibility, and the
// supersede of SPEC23's markdown-highlighting setting while preview is on.
import { expect, test } from './fixtures';
import {
  clickClearOfToolbar,
  editorTopGutterLine,
  freshApp,
  fsRead,
  fsWrite,
  openSettings,
  previewTopAnchorLines,
  selectPhraseInPane,
  splitApp,
  waitForSidecar,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

/** Settings → Editor tab → flip the live-preview checkbox (PRD 006 §1). */
async function setLivePreview(page: import('@playwright/test').Page, on: boolean): Promise<void> {
  await openSettings(page, 'general');
  await page.getByTestId('settings-tab-editor').click();
  const box = page.getByTestId('editor-live-preview');
  if (on) await box.check();
  else await box.uncheck();
  await page.getByTestId('settings-close').click();
}

const LP_DOC = '# Big Title\n\nsome **bold** here\n\n> a quote line\n\ntail\n';

test('E142: live preview toggle — off by default with zero effect; on renders in place without a remount; persists', async ({
  page,
}) => {
  await fsWrite(page, '/docs/lp.md', LP_DOC);
  await page.goto('/#open=/docs/lp.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Big Title');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();

  // Off by default: the row exists unchecked, no mm-lp-* classes, raw markers visible.
  await expect(editor.locator('[class*="mm-lp-"]')).toHaveCount(0);
  await expect(editor.locator('.cm-content')).toContainText('**bold**');
  await openSettings(page, 'general');
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('editor-live-preview')).not.toBeChecked();
  await page.getByTestId('settings-close').click();

  // Type AAA on the tail line (undo baseline), then toggle on live.
  await editor.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('AAA');
  await setLivePreview(page, true);

  // Rendered: bold styled with its ** markers gone (cursor sits on the tail
  // line, so the bold line is not revealed).
  await expect(editor.locator('.mm-lp-strong').first()).toContainText('bold');
  const boldLine = editor.locator('.cm-line', { hasText: 'bold' }).first();
  await expect(boldLine).not.toContainText('**');
  await expect(editor.locator('.cm-line.mm-lp-quote')).toHaveCount(1);

  // No remount: undo history survived the compartment reconfigure.
  await editor.locator('.cm-line', { hasText: 'AAA' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('BBB');
  await expect(editor.locator('.cm-content')).toContainText('tailAAABBB');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor.locator('.cm-content')).toContainText('tailAAA');
  await expect(editor.locator('.cm-content')).not.toContainText('BBB');

  // Persisted: survives a reload.
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"livePreview": true');
  await page.reload();
  await page.goto('/#open=/docs/lp.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Big Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.mm-lp-strong').first()).toContainText('bold');
});

test('E143: live preview link hand-off — cmd/ctrl-click on a rendered link opens externally, no navigation', async ({
  page,
}) => {
  await fsWrite(page, '/docs/lp-link.md', '# Links\n\nvisit [the site](https://example.com/docs) today\n\ntail\n');
  await page.goto('/#open=/docs/lp-link.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Links');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await setLivePreview(page, true);

  // Park the cursor away from the link line so it renders.
  await editor.locator('.cm-line').last().click();
  const link = editor.locator('.mm-lp-link').first();
  await expect(link).toContainText('the site');
  await expect(link).toHaveAttribute('data-mm-lp-url', 'https://example.com/docs');

  // PRD 006 §5: the modified click hands the URL to platform.openExternal
  // (the shim records it) and the app itself never navigates.
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mmExternalOpens?: string[] }).__mmExternalOpens ?? []))
    .toContain('https://example.com/docs');
  await expect(editor.locator('.cm-content')).toBeVisible();
});

test('E144: live preview styling rides the theme tokens — heading color follows the theme in light and dark', async ({
  page,
}) => {
  await fsWrite(page, '/docs/lp-theme.md', LP_DOC);
  await page.goto('/#open=/docs/lp-theme.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Big Title');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await setLivePreview(page, true);
  await editor.locator('.cm-line').last().click(); // reveal-park: heading renders

  const h1 = editor.locator('.cm-line.mm-lp-h1').first();
  await expect(h1).toBeVisible();
  const headingColor = () => h1.evaluate((el) => getComputedStyle(el).color);
  const lightColor = await headingColor();

  // PRD 006 §10: the rendered heading reads the theme's --mm-heading token —
  // overriding the token on the theme root moves the computed color with it.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.theme-root')!.style.setProperty('--mm-heading', 'rgb(1, 2, 3)');
  });
  await expect.poll(headingColor).toBe('rgb(1, 2, 3)');
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.theme-root')!.style.removeProperty('--mm-heading');
  });

  // And a real light→dark theme switch changes the rendered color.
  await openSettings(page); // appearance tab
  await page.getByTestId('settings-theme-dark').selectOption('one-dark');
  const useDark = page.getByTestId('use-dark-theme');
  if (!(await useDark.isChecked())) await useDark.check();
  await page.getByTestId('settings-close').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(40, 44, 52)');
  await expect.poll(headingColor).not.toBe(lightColor);
});

test('E145: split view keeps scroll sync with live preview on', async ({ page }) => {
  await splitApp(page);
  await setLivePreview(page, true);
  const editor = page.locator('.cm-scroller');

  // Live preview is really on in the split editor: rendered section headings.
  await expect(page.getByTestId('editor').locator('.cm-line.mm-lp-h2').first()).toBeVisible();

  // PRD 006 §11: editor scroll still drives the preview to the same lines.
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.4));
  await expect
    .poll(async () => {
      const line = await editorTopGutterLine(page);
      const { before, after } = await previewTopAnchorLines(page);
      return line >= before - 5 && line <= after + 5;
    })
    .toBe(true);
});

test('E146: mirrored selection still lands in the editor with live preview on', async ({ page }) => {
  await fsWrite(page, '/docs/lp-mirror.md', '# Mirror\n\nThe quick **brown fox** jumps far.\n\ntail\n');
  // Seed splitEdit + livePreview on top of the pinned settings, then reboot
  // so the app reads them from settings.json (the splitApp pattern).
  await page.evaluate(() => {
    const raw = window.__mmfs!.read('/config/settings.json');
    const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.__mmfs!.write('/config/settings.json', JSON.stringify({ ...settings, splitEdit: true, livePreview: true }));
  });
  await page.reload();
  await page.goto('/#open=/docs/lp-mirror.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Mirror');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expect(editor.locator('.mm-lp-strong').first()).toContainText('brown fox');

  // PRD 006 §11: a preview selection mirrors into the CM selection untouched
  // by what live preview hides (source offsets, not display offsets).
  await page.getByTestId('split-preview').click({ position: { x: 10, y: 10 } }); // blur CM
  await selectPhraseInPane(page, '[data-testid="split-preview"] .doc', 'jumps far');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toContain('jumps far');
  expect(await editor.locator('.cm-selectionBackground').count()).toBeGreaterThan(0);
});

test('E147: vim nav keeps working with live preview on', async ({ page }) => {
  await fsWrite(page, '/docs/lp-vim.md', LP_DOC);
  await page.goto('/#open=/docs/lp-vim.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Big Title');
  await openSettings(page, 'general');
  await page.getByTestId('settings-vimnav').check();
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('editor-live-preview').check();
  await page.getByTestId('settings-close').click();

  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expect(editor.locator('.mm-lp-strong').first()).toContainText('bold');

  // PRD 006 §11: Esc enters nav mode; j/k walk rendered lines by source line.
  await editor.locator('.cm-line').first().click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vim-badge')).toBeVisible();
  const headLine = () => page.evaluate(() => window.__mmEdit?.headLine);
  await expect.poll(headLine).toBe(1);
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect.poll(headLine).toBe(3);
  await page.keyboard.press('k');
  await expect.poll(headLine).toBe(2);
  await page.keyboard.press('i');
  await expect(page.getByTestId('vim-badge')).toHaveCount(0);
});

test('E148: comments still attach from the split pane with live preview on', async ({ page }) => {
  await page.setViewportSize({ width: 2300, height: 900 });
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('editor-live-preview').check();
  await page.getByTestId('settings-close').click();

  await page.keyboard.press('Control+e');
  const pane = page.getByTestId('split-preview');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await pane.click({ position: { x: 10, y: 60 } }); // blur CM, clear of the toolbar band

  // Center the phrase first so the floating button clears the toolbar.
  await page.evaluate(() => {
    const doc = document.querySelector('[data-testid="split-preview"] .doc')!;
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue?.includes('renders GitHub-flavored markdown')) {
        node.parentElement?.scrollIntoView({ block: 'center' });
        return;
      }
    }
  });

  // PRD 006 §11: selecting in the preview and commenting works as before.
  await selectPhraseInPane(page, '[data-testid="split-preview"] .doc', 'renders GitHub-flavored markdown');
  await expect(page.getByTestId('add-comment-btn')).toBeVisible();
  await clickClearOfToolbar(page.getByTestId('add-comment-btn'));
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.getByTestId('composer-input').fill('From the split pane, preview on');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(pane.locator('mark.hl[data-cid]')).toHaveCount(1);
  await waitForSidecar(page, (s) => !!s && s.includes('From the split pane, preview on'));
});

test('E149: find still matches and highlights with live preview on — hidden markers do not shift matches', async ({
  page,
}) => {
  await fsWrite(page, '/docs/lp-find.md', '# Find\n\nalpha one\n\n**alpha** two\n\nplain alpha three\n\ntail\n');
  await page.goto('/#open=/docs/lp-find.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Find');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await setLivePreview(page, true);
  await editor.locator('.cm-line').last().click();

  // PRD 006 §11: three matches, one of them inside a rendered bold span.
  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await page.getByTestId('find-input').fill('alpha');
  await expect(page.getByTestId('find-count')).toContainText('of 3');
  await expect.poll(() => editor.locator('.cm-searchMatch').count()).toBe(3);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('find-bar')).toHaveCount(0);
});

test('E150: live preview supersedes SPEC23 highlighting — revealed lines keep mm-md-* styling whatever editorSyntax says', async ({
  page,
}) => {
  await fsWrite(page, '/docs/lp-super.md', LP_DOC);
  await page.goto('/#open=/docs/lp-super.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Big Title');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await setLivePreview(page, true);

  // Cursor on the heading line reveals it raw — with SPEC23 highlight classes.
  await editor.locator('.cm-line').first().click();
  await page.keyboard.press('Control+Home');
  await expect(editor.locator('.mm-md-h1:not(.mm-md-mark)').first()).toContainText('Big Title');

  // PRD 006 §12: flipping editorSyntax off changes nothing while preview is
  // on — the revealed line keeps its mm-md-* styling, rendering stays.
  await openSettings(page, 'general');
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('editor-syntax').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(editor.locator('.mm-md-h1:not(.mm-md-mark)').first()).toContainText('Big Title');
  await expect(editor.locator('.mm-lp-strong').first()).toContainText('bold');

  // Turning live preview off restores SPEC23's own rule: syntax is off, so
  // the highlight classes disappear — the supersede really was preview's.
  await setLivePreview(page, false);
  await expect(editor.locator('[class*="mm-lp-"]')).toHaveCount(0);
  await expect(editor.locator('[class*="mm-md-"]')).toHaveCount(0);
  await expect(editor.locator('.cm-content')).toContainText('**bold**');
});

test('E157: table grid + live preview (#55) — grid lines keep raw cell markdown so every pipe column aligns', async ({
  page,
}) => {
  // The issue #55 repro shape: cells carrying **bold** terms and `code`.
  const TABLE = [
    '| Term | Meaning |',
    '| --- | --- |',
    '| **Host** | Your machine. The real repo lives here. |',
    '| **Sandbox** | The boundary a `docker()` container gives. |',
  ].join('\n');
  await fsWrite(page, '/docs/lp-grid.md', `# Grid\n\nsome **bold** here\n\n${TABLE}\n\ntail\n`);
  await page.goto('/#open=/docs/lp-grid.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Grid');
  // Full-screen edit (the tables-suite pattern) + live preview on; the
  // tableGridView default is already on.
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('editor-live-preview').check();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();

  // Park the caret on the tail line, OUTSIDE the table: the exclusion must
  // hold selection-independently (PRD 006 §11 #55), not via §8's reveal.
  await editor.locator('.cm-line', { hasText: 'tail' }).last().click();

  // The grid rendered, and its lines show raw cell markdown — the ** and
  // backtick markers stay visible inside the grid…
  const gridLines = editor.locator('.cm-line.mm-table-mode-line');
  await expect(gridLines.first()).toBeVisible();
  await expect(editor.locator('.cm-line', { hasText: '**Host**' }).first()).toBeVisible();
  await expect(editor.locator('.cm-line', { hasText: '`docker()`' }).first()).toBeVisible();

  // …while live preview still renders the same constructs outside the grid.
  const boldLine = editor.locator('.cm-line', { hasText: 'some' }).first();
  await expect(editor.locator('.mm-lp-strong').first()).toContainText('bold');
  await expect(boldLine).not.toContainText('**');

  // Every grid line has the same visible length: all | columns align.
  const lengths = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-line.mm-table-mode-line')).map(
      (el) => (el.textContent ?? '').length
    )
  );
  expect(lengths.length).toBeGreaterThanOrEqual(4);
  expect(new Set(lengths).size).toBe(1);
});
