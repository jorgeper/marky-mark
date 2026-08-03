import { expect, test } from './fixtures';
import {
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  openSettings,
  PHRASE,
  revealToolbar,
  selectPhrase,
  selectPhraseInPane,
  WELCOME,
} from './helpers';

// Edit mode: the hotkey, saving, vim motions, syntax highlighting, front
// matter, find & replace.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E4: hotkey toggles into edit mode showing markdown source; editing reflects in preview after toggling back', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.cm-content')).toContainText('# Welcome to Marky Mark');
  await expect(page.getByTestId('doc')).toHaveCount(0); // swap, never side-by-side

  // Click the first line (the H1) so the typed text lands in rendered output,
  // not in a non-rendering spot like a table delimiter or fence info string.
  await editor.locator('.cm-line').first().click();
  await page.keyboard.type('EDITMARK ');

  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('doc')).toContainText('EDITMARK');
});

test('E5: Cmd/Ctrl+S in edit mode persists the buffer to disk and clears the dirty indicator', async ({ page }) => {
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('SAVEMARK ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const onDisk = await fsRead(page, WELCOME);
  expect(onDisk).toContain('SAVEMARK');
});

test('E6: remapping the edit-toggle hotkey in settings takes effect immediately; the old combo stops working', async ({
  page,
}) => {
  await openSettings(page, 'hotkeys');
  await page.getByTestId('hotkey-toggleEdit').click();
  // SPEC34: the fixture combo moved off Mod+Shift+E — that is now the
  // folder sidebar's DEFAULT binding, so the conflict detector (rightly)
  // refuses it. The test's semantics are unchanged: remap, old dies, new works.
  await page.keyboard.press('Control+Shift+Y');
  await page.getByTestId('settings-close').click();

  await page.keyboard.press('Control+e'); // old combo — must do nothing
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('doc')).toBeVisible();

  await page.keyboard.press('Control+Shift+Y'); // new combo
  await expect(page.getByTestId('editor')).toBeVisible();

  // Persisted to settings.json in the config dir.
  const settings = await fsRead(page, '/config/settings.json');
  expect(settings).toContain('"toggleEdit": "Mod+Shift+Y"'); // the REBOUND key, precisely
});

test('E23: vim navigation — off by default, full motion set when enabled, never fires while typing', async ({
  page,
}) => {
  const scrollTop = () => page.locator('.workspace').evaluate((el) => el.scrollTop);

  // Disabled (default): j does nothing.
  await revealToolbar(page);
  await page.getByTestId('docname').click();
  await page.keyboard.press('j');
  await page.waitForTimeout(150);
  expect(await scrollTop()).toBe(0);

  await openSettings(page, 'general');
  await page.getByTestId('settings-vimnav').check();
  await page.getByTestId('settings-close').click();

  // j scrolls down, k back up.
  await page.keyboard.press('j');
  await expect.poll(scrollTop).toBeGreaterThan(0);
  const afterJ = await scrollTop();
  await page.keyboard.press('k');
  await expect.poll(scrollTop).toBeLessThan(afterJ);

  // Ctrl+d jumps about half a viewport; gg returns to top; G reaches bottom.
  await page.keyboard.press('Control+d');
  const viewport = await page.locator('.workspace').evaluate((el) => el.clientHeight);
  await expect.poll(scrollTop).toBeGreaterThanOrEqual(viewport / 2 - 80);
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(scrollTop).toBe(0);
  await page.keyboard.press('Shift+G');
  const max = await page.locator('.workspace').evaluate((el) => el.scrollHeight - el.clientHeight);
  await expect.poll(scrollTop).toBeGreaterThanOrEqual(max - 2);

  // Typing j into the composer inserts a "j" and does not scroll.
  await page.keyboard.press('g'); // reset: gg to top
  await page.keyboard.press('g');
  await expect.poll(scrollTop).toBe(0);
  await selectPhrase(page, PHRASE);
  await page.getByTestId('add-comment-btn').click();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  // Bring the composer on-screen first — otherwise Chromium scrolls the
  // focused textarea into view on the first keystroke (unrelated to vim nav).
  await page.getByTestId('composer-input').scrollIntoViewIfNeeded();
  // Let the composer autofocus/card-alignment scrolling settle, then measure.
  await expect
    .poll(async () => {
      const a = await scrollTop();
      await page.waitForTimeout(120);
      return (await scrollTop()) - a;
    })
    .toBe(0);
  const composerScroll = await scrollTop();
  await page.getByTestId('composer-input').pressSequentially('jjj');
  await expect(page.getByTestId('composer-input')).toHaveValue('jjj');
  expect(await scrollTop()).toBe(composerScroll);
});

test('E41: undo/redo hotkeys work for edits, and history survives a preview↔edit toggle', async ({ page }) => {
  await page.keyboard.press('Control+e');
  const content = page.getByTestId('editor').locator('.cm-content');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('UNDOMARK');
  await expect(content).toContainText('UNDOMARK');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).not.toContainText('UNDOMARK');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(content).toContainText('UNDOMARK');

  // Toggle to preview and back: the pre-toggle edit is still undoable.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toContainText('UNDOMARK');
  await page.keyboard.press('Control+e');
  await expect(content).toContainText('UNDOMARK');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).not.toContainText('UNDOMARK');
});

test('E81: editor vim nav — Esc inert with the setting off; full modal keyset on; buffer stays byte-identical', async ({
  page,
}) => {
  const DOC = Array.from({ length: 40 }, (_, i) => `line number ${i + 1}`).join('\n\n');
  await fsWrite(page, '/docs/vim.md', `${DOC}\n`);
  await page.goto('/#open=/docs/vim.md');
  await expect(page.getByTestId('doc')).toContainText('line number 1');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();

  // Setting off (default): Esc does nothing — no badge, typing still edits.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vim-badge')).toHaveCount(0);
  await page.keyboard.type('OFFCHECK ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+s'); // clean slate for the byte-identical check
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // Enable vim, back to the editor.
  await openSettings(page, 'general');
  await page.getByTestId('settings-vimnav').check();
  await page.getByTestId('settings-close').click();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.press('Control+Home'); // deterministic start (native nav still works)

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vim-badge')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.nav)).toBe(true);

  // Motions move the cursor.
  const headLine = () => page.evaluate(() => window.__mmEdit?.headLine);
  const head = () => page.evaluate(() => window.__mmEdit?.head);
  await expect.poll(headLine).toBe(1);
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect.poll(headLine).toBe(3);
  await page.keyboard.press('k');
  await expect.poll(headLine).toBe(2);
  await page.keyboard.press('j'); // line 3: "line number 2"
  const atLineStart = (await head())!;
  await page.keyboard.press('w');
  expect((await head())!).toBeGreaterThan(atLineStart);
  await page.keyboard.press('$');
  const atEnd = (await head())!;
  await page.keyboard.press('0');
  expect((await head())!).toBeLessThan(atEnd);
  await page.keyboard.press('G');
  await expect.poll(headLine).toBeGreaterThan(70); // 40 lines + blanks
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(headLine).toBe(1);
  await page.keyboard.press('Control+d');
  const afterHalf = (await headLine())!;
  expect(afterHalf).toBeGreaterThan(1);
  await page.keyboard.press('Control+u');
  await expect.poll(headLine).toBeLessThan(afterHalf);

  // Editing keys are inert: the buffer stays byte-identical (never dirty).
  for (const k of ['x', 'q', 'Backspace', 'Delete', 'Enter', 'Tab', '#']) {
    await page.keyboard.press(k);
  }
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(page.getByTestId('vim-badge')).toBeVisible();

  // i exits to typing; typing edits again.
  await page.keyboard.press('i');
  await expect(page.getByTestId('vim-badge')).toHaveCount(0);
  await page.keyboard.type('ONCHECK');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Esc → nav, then a mode roundtrip re-enters typing mode.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vim-badge')).toBeVisible();
  await page.keyboard.press('Control+e'); // to preview (accelerators pass through nav mode)
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await page.keyboard.press('Control+e'); // back to edit
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('vim-badge')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.nav)).toBe(false);
});

test('E82: markdown highlighting — themed token classes on by default, live toggle keeps undo, persists', async ({
  page,
}) => {
  await fsWrite(page, '/docs/hl.md', '# Big Title\n\nsome **bold** and `code` here\n');
  await page.goto('/#open=/docs/hl.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Big Title');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();

  // On by default: token classes present.
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.mm-md-h1:not(.mm-md-mark)').first()).toContainText('Big Title');
  await expect(editor.locator('.mm-md-strong:not(.mm-md-mark)').first()).toContainText('bold');
  await expect(editor.locator('.mm-md-code:not(.mm-md-mark)').first()).toContainText('code');
  expect(await editor.locator('.mm-md-mark').count()).toBeGreaterThan(0); // dimmed # / ** / `

  // Type A (undo baseline), toggle the setting off live.
  await editor.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('AAA');
  await openSettings(page, 'general');
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('editor-syntax').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(editor.locator('[class*="mm-md-"]')).toHaveCount(0);

  // Undo history survived the live reconfigure: type BBB, undo removes it only.
  await editor.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('BBB');
  await expect(editor.locator('.cm-content')).toContainText('AAABBB');
  await page.keyboard.press('ControlOrMeta+z'); // CM's own history keymap wants the real Mod
  await expect(editor.locator('.cm-content')).toContainText('AAA');
  await expect(editor.locator('.cm-content')).not.toContainText('BBB');

  // The setting persisted.
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"editorSyntax": false');
  await page.reload();
  await page.goto('/#open=/docs/hl.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Big Title'); // app booted
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('editor').locator('[class*="mm-md-"]')).toHaveCount(0);
});

test('E86: front matter becomes a dismissable card — never rendered markdown; View menu and setting govern it', async ({
  page,
}) => {
  const FM_DOC =
    '---\ndate: 2026-07-05\nkind: article\ntags:\n  - agentic-engineering\n  - llm\n---\n\n# FM Title\n\nBody paragraph here.\n';
  await fsWrite(page, '/docs/fm.md', FM_DOC);
  await page.goto('/#open=/docs/fm.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('FM Title');

  // The old failure mode is gone: no top hr, no "date:" paragraph mush.
  expect(await page.getByTestId('doc').locator('hr').count()).toBe(0);
  await expect(page.getByTestId('doc')).not.toContainText('date:');

  // The card lists keys, values, and the joined list.
  const card = page.getByTestId('fm-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('date');
  await expect(card).toContainText('2026-07-05');
  await expect(card).toContainText('agentic-engineering, llm');

  // ✕ hides it for the session — split preview included.
  await page.getByTestId('fm-close').click();
  await expect(page.getByTestId('fm-card')).toHaveCount(0);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(page.getByTestId('fm-card')).toHaveCount(0);
  await page.keyboard.press('Control+e');

  // Setting off ⇒ the next open starts hidden (doc renders as ever).
  await openSettings(page, 'general');
  await page.getByTestId('settings-frontmatter').uncheck();
  await page.getByTestId('settings-close').click();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"showFrontmatter": false');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('FM Title');
  await expect(page.getByTestId('fm-card')).toHaveCount(0);

  // Fresh boot with defaults + native menu: the View checkbox drives the card.
  await freshNativeMenuApp(page);
  await fsWrite(page, '/docs/fm.md', FM_DOC);
  await page.goto('/?nativeMenu=1#open=/docs/fm.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('FM Title');
  await expect(page.getByTestId('fm-card')).toBeVisible();
  const fmItem = () =>
    page.evaluate(() => {
      const view = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!;
      return view.items.find(
        (i) => i.type === 'command' && (i as { command?: string }).command === 'toggleFrontmatter'
      ) as { checked?: boolean };
    });
  expect((await fmItem()).checked).toBe(true);
  await menuClick(page, 'toggleFrontmatter');
  await expect(page.getByTestId('fm-card')).toHaveCount(0);
  await expect.poll(async () => (await fmItem()).checked).toBe(false);
  await menuClick(page, 'toggleFrontmatter');
  await expect(page.getByTestId('fm-card')).toBeVisible();

  // A document without front matter never shows a card.
  await fsWrite(page, '/docs/plain.md', '# Plain Doc\n\ntext\n');
  await page.goto('/?nativeMenu=1#open=/docs/plain.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Plain Doc');
  await expect(page.getByTestId('fm-card')).toHaveCount(0);
});

test('E89: find in preview — live count, themed marks, wrap-around navigation, lossless close, prefill', async ({
  page,
}) => {
  const before = await page.getByTestId('doc').evaluate((el) => el.textContent);

  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await page.getByTestId('find-input').fill('markdown');
  await expect(page.getByTestId('find-count')).toContainText('of');
  const total = Number((await page.getByTestId('find-count').textContent())!.split('of')[1]!.trim());
  expect(total).toBeGreaterThan(1);
  expect(await page.locator('.doc mark.mm-find').count()).toBeGreaterThanOrEqual(total);
  await expect(page.locator('.doc mark.mm-find-active').first()).toBeVisible();
  // Never the comment machinery's marks.
  expect(await page.locator('.doc mark.mm-find[data-cid]').count()).toBe(0);
  expect(await page.locator('.doc mark.hl.mm-find').count()).toBe(0);

  // Enter advances, Shift+Enter wraps back around to the last match.
  await expect(page.getByTestId('find-count')).toHaveText(`1 of ${total}`);
  await page.getByTestId('find-input').press('Enter');
  await expect(page.getByTestId('find-count')).toHaveText(`2 of ${total}`);
  await page.getByTestId('find-input').press('Shift+Enter');
  await page.getByTestId('find-input').press('Shift+Enter');
  await expect(page.getByTestId('find-count')).toHaveText(`${total} of ${total}`);

  // No matches state.
  await page.getByTestId('find-input').fill('zzqqxx-nothing');
  await expect(page.getByTestId('find-count')).toHaveText('No matches');

  // Esc closes and the document text is byte-identical, zero marks left.
  await page.getByTestId('find-input').press('Escape');
  await expect(page.getByTestId('find-bar')).toHaveCount(0);
  expect(await page.locator('.doc mark.mm-find').count()).toBe(0);
  expect(await page.getByTestId('doc').evaluate((el) => el.textContent)).toBe(before);

  // Selection prefill.
  await selectPhraseInPane(page, '[data-testid="doc"]', 'sidecar file');
  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-input')).toHaveValue('sidecar file');
  await page.getByTestId('find-input').press('Escape');

  // The Edit → Find… menu item drives the same bar (native-menu shim).
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await menuClick(page, 'find');
  await expect(page.getByTestId('find-bar')).toBeVisible();
});

test('E90: find & replace in the editor — CM decorations, replace one/all on the undo path, query survives toggles', async ({
  page,
}) => {
  await fsWrite(page, '/docs/fr.md', '# T\n\nalpha beta alpha\n\ngamma alpha\n');
  await page.goto('/#open=/docs/fr.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('T');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toBeVisible(); // split default

  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await expect(page.getByTestId('find-replace-input')).toBeVisible(); // edit mode has the replace row
  await page.getByTestId('find-input').fill('alpha');
  await expect(page.getByTestId('find-count')).toContainText('of 3');
  expect(await page.locator('.cm-searchMatch').count()).toBe(3);
  // The bar drives the EDITOR in split mode — the split preview stays unmarked.
  expect(await page.locator('[data-testid="split-preview"] .doc mark.mm-find').count()).toBe(0);

  await page.getByTestId('find-next').click();
  await expect(page.getByTestId('find-count')).toContainText('2 of 3');

  // Replace one (advances), then all (reports via the notice).
  await page.getByTestId('find-replace-input').fill('OMEGA');
  await page.getByTestId('find-replace-one').click();
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('OMEGA');
  await expect(page.getByTestId('find-count')).toContainText('of 2');
  await page.getByTestId('find-replace-all').click();
  await expect(page.getByTestId('notice')).toContainText('Replaced 2 matches');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('alpha');

  // replace-all was ONE undo step (focus back in the editor first — ⌘Z
  // targets the focused field, as it should).
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('alpha');

  // The query survives a mode toggle and re-applies in preview.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await expect(page.getByTestId('find-input')).toHaveValue('alpha');
  await expect(page.getByTestId('find-count')).toContainText('of');
  expect(await page.locator('.doc mark.mm-find').count()).toBeGreaterThan(0);
});
