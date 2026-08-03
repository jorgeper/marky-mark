import { expect, test } from './fixtures';
import {
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  openFolderRoot,
  openSettings,
  pasteImage,
  seedFolders,
  stableBox,
} from './helpers';

// Images: paste, insert, the images folder settings, resize chips and the
// rendered editor view.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

// A 1×1 red PNG for paste payloads (constructed at runtime — never a file).
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// A 200×100 PNG so resize has real geometry to drag against.
const WIDE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAABM5OhcAAABG0lEQVR4nO3SQQkAIADAQCMax4jGsoRDkIMLsMfGXBuuG88L+JKxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLxAH1LBknHE0F8AAAAABJRU5ErkJggg==';

test('E71: pasting an image in edit mode writes the file, inserts the reference, and renders in preview', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await pasteImage(page, TINY_PNG);

  // Inserted at the cursor: default pattern {doc} {n} against welcome.md.
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toContainText('![welcome 1](images/welcome%201.png)');

  // The bytes landed next to the doc, under the configured folder.
  const stored = await fsRead(page, '/docs/images/welcome 1.png');
  expect(stored).not.toBeNull();
  expect(stored!.startsWith('data:image/png;base64,')).toBe(true);

  // And the preview renders it (the shim serves the data: URI back).
  await page.keyboard.press('Control+e');
  const img = page.getByTestId('doc').locator('img[alt="welcome 1"]');
  await expect(img).toBeVisible();
  expect(await img.getAttribute('src')).toContain('data:image/png');
});

test('E72: a second paste numbers {n}=2; pasting into an untitled buffer shows the save-first notice', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await pasteImage(page, TINY_PNG);
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('images/welcome%201.png');
  await pasteImage(page, TINY_PNG);
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('images/welcome%202.png');
  expect(await fsRead(page, '/docs/images/welcome 2.png')).not.toBeNull();

  // Untitled buffer (fresh app, no document open): paste writes nothing.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await pasteImage(page, TINY_PNG);
  await expect(page.getByTestId('notice')).toContainText('Save the document first');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('![');
  const files = await page.evaluate(() => window.__mmfs!.list());
  expect(files.filter((f) => f.includes('/images/'))).toEqual([]);
});

test('E73: the Editor settings tab holds the image fields — defaults, live example, folder validation, persistence', async ({
  page,
}) => {
  // PRD 002 §B5/§E18: the image fields are W-scoped — open an untitled
  // workspace so the panel's Workspace scope can edit them.
  await seedFolders(page);
  await openFolderRoot(page);
  await openSettings(page, 'general');
  await page.getByTestId('settings-tab-editor').click();

  // Defaults per SPEC20 §1 — shown but locked in User scope (§E19).
  await expect(page.getByTestId('image-folder')).toHaveValue('images');
  await expect(page.getByTestId('image-folder')).toBeDisabled();
  await expect(page.getByTestId('image-pattern')).toHaveValue('{doc} {n}');
  await expect(page.getByTestId('image-pattern')).toBeDisabled();
  await expect(page.getByTestId('scope-note-imageFolder')).toHaveAttribute('title', /Workspace/);
  await expect(page.getByTestId('image-pattern-example')).toContainText('welcome 1.png');

  // Workspace scope: same fields, editable; the example tracks the pattern live.
  // Issue #21: the scope switch keeps the shared tab rail and the Editor tab.
  await page.getByTestId('settings-scope-workspace').click();
  await expect(page.getByTestId('settings-tabs').locator('button')).toHaveCount(3);
  await expect(page.getByTestId('settings-tab-editor')).toHaveClass(/active/);
  await page.getByTestId('image-pattern').fill('img-{n}');
  await expect(page.getByTestId('image-pattern-example')).toContainText('img-1.png');

  // Invalid folder: inline error, the last valid value stays in settings.
  await page.getByTestId('image-folder').fill('a/b');
  await expect(page.getByTestId('image-folder-error')).toBeVisible();
  // Valid folder commits and the error clears.
  await page.getByTestId('image-folder').fill('assets');
  await expect(page.getByTestId('image-folder-error')).toHaveCount(0);

  await page.getByTestId('settings-close').click();
  // §E18 layer-targeted writes: the untitled workspace's session slot gets
  // the values; the User layer (settings.json) never does.
  await expect.poll(() => fsRead(page, '/config/session/untitled.json')).toContain('"imageFolder": "assets"');
  expect(await fsRead(page, '/config/session/untitled.json')).toContain('"imageNamePattern": "img-{n}"');
  expect((await fsRead(page, '/config/settings.json')) ?? '').not.toContain('imageFolder');
});

test('E76: Insert Image… (menu) copies the picked file into the images folder and references it at the cursor', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');

  // In preview the command only nudges toward edit mode.
  await menuClick(page, 'insertImage');
  await expect(page.getByTestId('notice')).toContainText('edit mode');

  // Seed a picture elsewhere in the virtual fs, then insert it in edit mode.
  await fsWrite(page, '/docs/downloads/logo.png', `data:image/png;base64,${TINY_PNG}`);
  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  page.once('dialog', (d) => void d.accept('/docs/downloads/logo.png'));
  await menuClick(page, 'insertImage');

  // Copied next to the doc under the configured folder, referenced at cursor.
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('![logo](images/logo.png)');
  expect(await fsRead(page, '/docs/images/logo.png')).toContain('data:image/png');

  // Picking a file already inside the folder references it without recopying.
  page.once('dialog', (d) => void d.accept('/docs/images/logo.png'));
  await menuClick(page, 'insertImage');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('![logo](images/logo.png)!');
  const files = await page.evaluate(() => window.__mmfs!.list());
  expect(files.filter((f) => f.startsWith('/docs/images/'))).toEqual(['/docs/images/logo.png']);
});

test('E77: image resize lives in the EDIT pane — a chip drag persists into the buffer, the split preview renders it with no handles', async ({
  page,
}) => {
  // SPEC41 §4 amendment: this test drove the removed preview resizer; it now
  // pins the replacement — the same resize journey through the edit pane.
  await fsWrite(page, '/docs/pic.png', `data:image/png;base64,${WIDE_PNG}`);
  await fsWrite(page, '/docs/pic.md', '# Pic\n\n![p](pic.png)\nA line right after the image.\n');
  await page.goto('/#open=/docs/pic.md');
  await expect(page.getByTestId('doc').locator('img[alt="p"]')).toBeVisible();

  // Split edit: the editor renders the WIDGET (real pixels, raw syntax hidden).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  const widgetImg = page.getByTestId('editor').locator('.mm-image-widget img');
  await expect(widgetImg).toBeVisible();
  await widgetImg.click();
  await expect(page.getByTestId('image-chip-layer')).toBeVisible();

  // Drag the corner chip 60px left → the SPEC20 rewrite lands in the buffer.
  const chip = await stableBox(page.getByTestId('image-resize-wh'));
  await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
  await page.mouse.down();
  await page.mouse.move(chip.x + chip.width / 2 - 60, chip.y + chip.height / 2, { steps: 5 });
  await page.mouse.up();

  // Arrow into the span: the raw rewrite reveals — the <img> form, a width,
  // no height (corner = natural aspect).
  await page.keyboard.press('ArrowRight');
  const content = page.getByTestId('editor').locator('.cm-content');
  await expect(content).toContainText('<img src="pic.png" alt="p" width="');
  const revealed = await content.evaluate((el) => (el as HTMLElement).innerText);
  expect(revealed).not.toContain('height=');

  // The blank-line rule kept the following sentence out of the HTML block:
  // the live preview shows the resized image AND the sentence…
  const previewImg = page.getByTestId('split-preview').locator('img[alt="p"]');
  await expect(previewImg).toBeVisible();
  await expect(page.getByTestId('split-preview')).toContainText('A line right after the image.');

  // …and never grows handles or an overlay (SPEC41 §4).
  await previewImg.click();
  await expect(page.getByTestId('img-resize-overlay')).toHaveCount(0);
  await expect(page.getByTestId('img-size-badge')).toHaveCount(0);
});

test('E121: the rendered view — widgets by default, caret-reveal, both switches flip and persist, remote srcs stay blocked with zero requests', async ({
  page,
}) => {
  // The SPEC11 guarantee extends to the edit pane: block-and-log anything
  // that tries to leave localhost for the whole test.
  const external: string[] = [];
  await page.context().route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    external.push(route.request().url());
    return route.abort();
  });

  await fsWrite(page, '/docs/img116.png', `data:image/png;base64,${WIDE_PNG}`);
  const DOC = 'top\n\n![p](img116.png)\n\n![r](https://evil.example.com/x.png)\n\nbottom';
  await fsWrite(page, '/docs/v116.md', DOC);
  await page.goto('/#open=/docs/v116.md');
  await expect(page.getByTestId('doc')).toContainText('top');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // The local image is simply a PICTURE — real pixels via the shim's data:
  // URI, the raw syntax hidden, the dirty dot off.
  const widgetImg = editor.locator('.mm-image-widget img');
  await expect(widgetImg).toBeVisible();
  expect(await widgetImg.getAttribute('src')).toContain('data:image/png');
  expect(await text()).not.toContain('![p](img116.png)');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The remote image NEVER loads — the SPEC11 placeholder renders instead.
  const blocked = editor.locator('.mm-blocked-remote');
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText('remote image (evil.example.com');
  await expect(blocked).toContainText('Marky Mark is local-only');
  await expect(editor.locator('img[src*="evil"]')).toHaveCount(0);

  // Caret-reveal: arrow INTO the remote span — its raw markdown appears.
  await editor.locator('.cm-line').filter({ hasText: 'bottom' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); // the remote line, caret at the span start
  await page.keyboard.press('ArrowRight'); // strictly inside — reveal
  await expect(content).toContainText('![r](https://evil.example.com/x.png)');
  // …and into the local span two lines up: vertical motion lands at the
  // hidden span's start (the widget stays); one ArrowRight steps inside and
  // the picture yields to its syntax.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await expect(content).toContainText('![p](img116.png)');
  await expect(editor.locator('.mm-image-widget img')).toHaveCount(0);
  // Arrow out — the picture returns; nothing was ever text-changed.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(editor.locator('.mm-image-widget img')).toBeVisible();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // Image ▸ "Show Raw Images": ALL images drop to syntax at once.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await expect(page.getByTestId('smart-edit-toggle-images')).toHaveText(/Show Raw Images/);
  await page.getByTestId('smart-edit-toggle-images').click();
  await expect(editor.locator('.mm-image-widget')).toHaveCount(0);
  await expect(content).toContainText('![p](img116.png)');
  await expect(content).toContainText('![r](https://evil.example.com/x.png)');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The Settings checkbox reflects the flip and drives it back on.
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('settings-inline-images')).not.toBeChecked();
  await page.getByTestId('settings-inline-images').check();
  await page.getByTestId('settings-close').click();
  await expect(editor.locator('.mm-image-widget img')).toBeVisible();

  // Off again, and the setting survives a reload.
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('settings-inline-images').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(editor.locator('.mm-image-widget')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('doc')).toContainText('top');
  await page.keyboard.press('Control+e');
  await expect(content).toBeVisible();
  await expect(content).toContainText('![p](img116.png)');
  await expect(editor.locator('.mm-image-widget')).toHaveCount(0);

  // The menu label flipped; it brings the pictures back.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await expect(page.getByTestId('smart-edit-toggle-images')).toHaveText(/Show Rendered Images/);
  await page.getByTestId('smart-edit-toggle-images').click();
  await expect(editor.locator('.mm-image-widget img')).toBeVisible();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The zero-network guarantee held for the whole journey.
  expect(external).toEqual([]);
});

test('E122: resize chips — the eight-chip ring on every border and corner, edge/corner drags persist, double-click clears, 40px clamp, one ⌘Z each, preview clean', async ({
  page,
}) => {
  await fsWrite(page, '/docs/img117.png', `data:image/png;base64,${WIDE_PNG}`);
  const DOC = '# Pic\n\n![p](img117.png)\n\nafter\n';
  await fsWrite(page, '/docs/v117.md', DOC);
  await page.goto('/#open=/docs/v117.md');
  await expect(page.getByTestId('doc')).toContainText('Pic');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();

  // The buffer, read back through ⌘S (the widget hides the raw span).
  const saved = async () => {
    await page.keyboard.press('Control+s');
    return (await fsRead(page, '/docs/v117.md'))!;
  };
  const widgetImg = () => editor.locator('.mm-image-widget img');
  const dragChip = async (id: string, dx: number, dy: number) => {
    const box = await stableBox(page.getByTestId(id)); // re-placed after each drag
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
    await page.mouse.up();
  };

  // Click → exactly EIGHT chips (SPEC42 §1), each centered ON its border
  // middle or corner.
  await widgetImg().click();
  const layer = page.getByTestId('image-chip-layer');
  await expect(layer).toBeVisible();
  await expect(layer.locator('.table-chip')).toHaveCount(8);
  const ib = (await widgetImg().boundingBox())!;
  const at = async (id: string, cx: number, cy: number) => {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(Math.abs(b.x + b.width / 2 - cx), `${id} x`).toBeLessThanOrEqual(3);
    expect(Math.abs(b.y + b.height / 2 - cy), `${id} y`).toBeLessThanOrEqual(3);
  };
  const L = ib.x;
  const R = ib.x + ib.width;
  const T = ib.y;
  const B = ib.y + ib.height;
  const MX = ib.x + ib.width / 2;
  const MY = ib.y + ib.height / 2;
  await at('image-resize-l', L, MY);
  await at('image-resize-t', MX, T);
  await at('image-resize-w', R, MY);
  await at('image-resize-h', MX, B);
  await at('image-resize-tl', L, T);
  await at('image-resize-tr', R, T);
  await at('image-resize-bl', L, B);
  await at('image-resize-wh', R, B);
  // The circles carry empty faces.
  expect(await page.getByTestId('image-resize-wh').innerText()).toBe('');
  expect(await page.getByTestId('image-resize-tl').innerText()).toBe('');

  // 1) Corner drag +50: width persists, NO height — natural aspect kept.
  await dragChip('image-resize-wh', 50, 25);
  await expect.poll(saved).toContain('<img src="img117.png" alt="p" width="250">');
  expect(await saved()).not.toContain('height=');
  const grown = (await widgetImg().boundingBox())!;
  expect(Math.abs(grown.width / grown.height - 2)).toBeLessThanOrEqual(0.05); // 200×100 ratio

  // 2) Right drag +30: width dragged AND height frozen — the box holds.
  await widgetImg().click();
  await dragChip('image-resize-w', 30, 0);
  await expect.poll(saved).toContain('width="280"');
  expect(await saved()).toContain('height="125"');

  // 3) Double-click the corner: both cleared, natural size back.
  await widgetImg().click();
  await page.getByTestId('image-resize-wh').dblclick();
  await expect.poll(saved).toContain('<img src="img117.png" alt="p">');
  expect(await saved()).not.toContain('width=');

  // 4) LEFT border drag −60 (outward): width dragged + height frozen.
  await widgetImg().click();
  await dragChip('image-resize-l', -60, 0);
  await expect.poll(saved).toContain('width="260"');
  expect(await saved()).toContain('height="100"');

  // 5) TOP-LEFT corner drag up-left: ratio locked, width only, no height.
  await widgetImg().click();
  await dragChip('image-resize-tl', -40, -20);
  await expect.poll(saved).toContain('width="300"');
  expect(await saved()).not.toContain('height=');

  // 6) Double-click a corner OTHER than bottom-right: both cleared too.
  await widgetImg().click();
  await page.getByTestId('image-resize-tr').dblclick();
  await expect.poll(saved).toContain('<img src="img117.png" alt="p">');
  expect(await saved()).not.toContain('width=');

  // 7) A hard left drag on the right chip clamps at 40px.
  await widgetImg().click();
  await dragChip('image-resize-w', -500, 0);
  await expect.poll(saved).toContain('width="40"');

  // Each release was ONE undo step: seven ⌘Z return the original bytes.
  for (let i = 0; i < 7; i++) await page.keyboard.press('ControlOrMeta+z');
  expect(await saved()).toBe(DOC);
  await expect(widgetImg()).toBeVisible();

  // The split preview renders the image with NO overlay or handles, ever.
  const previewImg = page.getByTestId('split-preview').locator('img[alt="p"]');
  await expect(previewImg).toBeVisible();
  await previewImg.click();
  await expect(page.getByTestId('img-resize-overlay')).toHaveCount(0);
  await expect(page.getByTestId('image-chip-layer')).toHaveCount(0);
});

test('E123: the Image ▸ menu — labels and flags by context, Insert dispatches the picker, Delete splices with one-step undo, grid images stay raw', async ({
  page,
}) => {
  await fsWrite(page, '/docs/img118.png', `data:image/png;base64,${WIDE_PNG}`);
  const DOC = [
    'top',
    '',
    '![a](img118.png)',
    '',
    '| h1 | h2 |',
    '| --- | --- |',
    '| ![c](img118.png) | 2 |',
    '',
    'plain outro',
  ].join('\n');
  await fsWrite(page, '/docs/v118.md', DOC);
  await page.goto('/#open=/docs/v118.md');
  await expect(page.getByTestId('doc')).toContainText('top');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // Grid exclusion: the table renders as a grid, its cell image stays RAW
  // text — only the standalone reference grew a widget.
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(3);
  await expect.poll(text).toContain('![c](img118.png)');
  await expect(editor.locator('.mm-image-widget')).toHaveCount(1);

  // Plain-text context: toggle/insert enabled, delete/resize disabled.
  await editor.locator('.cm-line').filter({ hasText: 'plain outro' }).click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await expect(page.getByTestId('smart-edit-toggle-images')).toHaveText(/Show Raw Images/);
  await expect(page.getByTestId('smart-edit-toggle-images')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-insert-image')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-delete-image')).toBeDisabled();
  await expect(page.getByTestId('smart-edit-resize-image')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // On the image (widget click parks the caret on the span): all four live.
  await editor.locator('.mm-image-widget img').click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await expect(page.getByTestId('smart-edit-delete-image')).toBeEnabled();
  await expect(page.getByTestId('smart-edit-resize-image')).toBeEnabled();

  // Resize Image is the pointer-free entry to the chips; Esc dismisses.
  await page.getByTestId('smart-edit-resize-image').click();
  await expect(page.getByTestId('image-chip-layer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('image-chip-layer')).toHaveCount(0);

  // Delete Image: the reference AND its blank line leave in one step…
  await editor.locator('.mm-image-widget img').click();
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await page.getByTestId('smart-edit-delete-image').click();
  await expect(editor.locator('.mm-image-widget')).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  expect(await text()).toContain('![c](img118.png)'); // the grid cell held on
  // …and ONE undo restores it.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor.locator('.mm-image-widget')).toHaveCount(1);

  // Insert Image… dispatches the SPEC20 picker flow (shim-observable).
  await fsWrite(page, '/docs/downloads/pic2.png', `data:image/png;base64,${WIDE_PNG}`);
  await editor.locator('.cm-line').filter({ hasText: 'plain outro' }).click();
  await page.keyboard.press('End');
  page.once('dialog', (d) => void d.accept('/docs/downloads/pic2.png'));
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-image').click();
  await page.getByTestId('smart-edit-insert-image').click();
  // The caret rests at the end of the inserted span — caret-reveal shows the
  // fresh syntax raw; stepping away turns it into the picture.
  await expect(content).toContainText('![pic2](images/pic2.png)');
  await editor.locator('.cm-line').filter({ hasText: /^top$/ }).click();
  await expect(editor.locator('.mm-image-widget')).toHaveCount(2);
  expect(await fsRead(page, '/docs/images/pic2.png')).toContain('data:image/png');
});
