import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  bootEditorOn,
  editorCaret,
  enableActiveLine,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  goToDocStart,
  menuClick,
  openSettings,
  PHRASE,
  revealToolbar,
  saveSettings,
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
  await saveSettings(page);

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
  await saveSettings(page);

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
  // Issue #286: the popup is gone — the Insert Comment hotkey authors it.
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
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
  await saveSettings(page);
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await goToDocStart(page); // deterministic start (native nav still works)

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
  await saveSettings(page);
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
  // Issue #125: the mode is remembered across the relaunch too, so the
  // document comes up in the editor this test left in — no ⌘E needed.
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('Big Title'); // app booted
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
  await saveSettings(page);
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

// PRD 014 Req 10–11 (issue #154): the find bar's toggles and hit state — the
// Search view's SearchOptionsBar mounted in the bar, both engines compiled by
// searchCore.compileQuery, and a hit state that cannot be missed.

test('E344: find-bar toggles in preview — case, whole-word, regex and a combo change the matches live, the counter tracks stepping, and a close resets them', async ({
  page,
}) => {
  await fsWrite(page, '/docs/find-toggles.md', 'Cat sat\n\nconcatenate cat\n\ncut\n');
  await page.goto('/#open=/docs/find-toggles.md');
  await expect(page.getByTestId('doc')).toContainText('concatenate');

  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  // The Search view's control — same test ids, same pressed state, all off.
  for (const id of ['search-opt-case', 'search-opt-word', 'search-opt-regex']) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', 'false');
  }
  await page.getByTestId('find-input').fill('cat');
  await expect(page.getByTestId('find-count')).toHaveText('1 of 3'); // Cat, concatenate, cat
  expect(await page.locator('.doc mark.mm-find').count()).toBe(3);

  // Case-sensitive: ONE click — no re-typing — repaints; 'Cat' drops out.
  await page.getByTestId('search-opt-case').click();
  await expect(page.getByTestId('search-opt-case')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('find-input')).toHaveValue('cat');
  await expect(page.getByTestId('find-input')).toBeFocused(); // the caret stayed in the box
  await expect(page.getByTestId('find-count')).toHaveText('1 of 2');
  await page.getByTestId('search-opt-case').click();

  // Whole-word stops substring containment: 'concatenate' drops out.
  await page.getByTestId('search-opt-word').click();
  await expect(page.getByTestId('find-count')).toHaveText('1 of 2'); // Cat, cat
  // Two toggles combine as a conjunction: only the lone lowercase word is left.
  await page.getByTestId('search-opt-case').click();
  await expect(page.getByTestId('find-count')).toHaveText('1 of 1');
  await page.getByTestId('search-opt-case').click();
  await page.getByTestId('search-opt-word').click();

  // Regex: 'c.t' matches nothing literally, four ways compiled.
  await page.getByTestId('find-input').fill('c.t');
  await expect(page.getByTestId('find-count')).toHaveText('No matches');
  await page.getByTestId('search-opt-regex').click();
  await expect(page.getByTestId('find-count')).toHaveText('1 of 4'); // Cat, cat, cat, cut

  // The counter tracks every stepping surface, wrap included.
  await page.getByTestId('find-next').click();
  await expect(page.getByTestId('find-count')).toHaveText('2 of 4');
  await page.getByTestId('find-input').press('Enter');
  await expect(page.getByTestId('find-count')).toHaveText('3 of 4');
  await page.getByTestId('find-input').press('Shift+Enter');
  await expect(page.getByTestId('find-count')).toHaveText('2 of 4');
  await page.getByTestId('find-prev').click();
  await expect(page.getByTestId('find-count')).toHaveText('1 of 4');
  expect(await page.locator('.doc mark.mm-find').count()).toBe(4);
  await expect(page.locator('.doc mark.mm-find-active')).toHaveCount(1);

  // Closing the bar resets the toggles — options never leak across a close.
  await page.getByTestId('find-input').press('Escape');
  await expect(page.getByTestId('find-bar')).toHaveCount(0);
  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  for (const id of ['search-opt-case', 'search-opt-word', 'search-opt-regex']) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', 'false');
  }
});

test('E345: find-bar toggles drive the editor — regex and whole-word change the CM decorations, the counter steps, and replace stays byte-literal with regex off', async ({
  page,
}) => {
  await fsWrite(page, '/docs/find-edit.md', '# T\n\nCat sat\nconcatenate cat\ncut\n');
  await page.goto('/#open=/docs/find-edit.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('T');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();

  await page.keyboard.press('Control+f');
  await page.getByTestId('find-input').fill('cat');
  await expect(page.getByTestId('find-count')).toContainText('of 3');
  await expect(page.locator('.cm-searchMatch')).toHaveCount(3);

  // Regex in EDIT mode: the same compiled pattern reaches CodeMirror.
  await page.getByTestId('find-input').fill('c.t');
  await expect(page.getByTestId('find-count')).toHaveText('No matches');
  await page.getByTestId('search-opt-regex').click();
  await expect(page.getByTestId('find-count')).toContainText('of 4');
  await expect(page.locator('.cm-searchMatch')).toHaveCount(4);
  await page.getByTestId('search-opt-regex').click();

  // Whole-word in EDIT mode: one flip, no re-typing, the substring drops.
  await page.getByTestId('find-input').fill('cat');
  await expect(page.getByTestId('find-count')).toContainText('of 3');
  await page.getByTestId('search-opt-word').click();
  await expect(page.getByTestId('find-count')).toContainText('of 2');
  await expect(page.locator('.cm-searchMatch')).toHaveCount(2);

  // The counter tracks stepping in edit mode too.
  const before = await page.getByTestId('find-count').textContent();
  await page.getByTestId('find-next').click();
  await expect(page.getByTestId('find-count')).not.toHaveText(before!);
  await expect(page.getByTestId('find-count')).toContainText('of 2');

  // SPEC30 §1.4 replace under the toggles is a working, deliberate choice:
  // whole-word replace-all touches only the word matches...
  await page.getByTestId('find-replace-input').fill('dog');
  await page.getByTestId('find-replace-all').click();
  await expect(page.getByTestId('notice')).toContainText('Replaced 2 matches');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('dog sat');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('concatenate'); // untouched
  // ...and with regex OFF the replacement is byte-literal even for `$&`.
  await page.getByTestId('find-input').fill('sat');
  await expect(page.getByTestId('find-count')).toContainText('of 1');
  await page.getByTestId('find-replace-input').fill('$&!');
  await page.getByTestId('find-replace-one').click();
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('$&!');
});

test('E346: an invalid regex shows compileQuery\'s message inline and matches NOTHING in both modes — no throw, no literal fallback — and recovers live', async ({
  page,
}) => {
  // '[cherry' exists LITERALLY in the document — the proof that an invalid
  // pattern is never quietly re-run as a literal.
  await fsWrite(page, '/docs/find-invalid.md', 'pick [cherry today\n');
  await page.goto('/#open=/docs/find-invalid.md');
  await expect(page.getByTestId('doc')).toContainText('pick');
  const pageErrors: Error[] = [];
  page.on('pageerror', (e) => pageErrors.push(e));

  await page.keyboard.press('Control+f');
  await page.getByTestId('search-opt-regex').click();
  await page.getByTestId('find-input').fill('[cherry');
  await expect(page.getByTestId('find-error')).toBeVisible();
  await expect(page.getByTestId('find-error')).toContainText('[cherry'); // compileQuery's own message
  await expect(page.getByTestId('find-count')).toHaveText('No matches');
  expect(await page.locator('.doc mark.mm-find').count()).toBe(0);
  await expect(page.getByTestId('find-prev')).toBeDisabled();
  await expect(page.getByTestId('find-next')).toBeDisabled();

  // Correcting the pattern clears the error and matches return live.
  await page.getByTestId('find-input').fill('\\[cherry');
  await expect(page.getByTestId('find-error')).toHaveCount(0);
  await expect(page.getByTestId('find-count')).toHaveText('1 of 1');
  expect(await page.locator('.doc mark.mm-find').count()).toBe(1);

  // Turning regex OFF clears the error too — the same text matches literally.
  await page.getByTestId('find-input').fill('[cherry');
  await expect(page.getByTestId('find-error')).toBeVisible();
  await page.getByTestId('search-opt-regex').click();
  await expect(page.getByTestId('find-error')).toHaveCount(0);
  await expect(page.getByTestId('find-count')).toHaveText('1 of 1');

  // Edit mode alike: the invalid pattern never reaches CodeMirror.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await page.getByTestId('search-opt-regex').click();
  await expect(page.getByTestId('find-error')).toBeVisible();
  await expect(page.getByTestId('find-count')).toHaveText('No matches');
  await expect(page.locator('.cm-searchMatch')).toHaveCount(0);
  await expect(page.getByTestId('find-next')).toBeDisabled();
  await page.getByTestId('find-input').fill('\\[cherry');
  await expect(page.getByTestId('find-error')).toHaveCount(0);
  await expect(page.getByTestId('find-count')).toContainText('of 1');
  await expect(page.locator('.cm-searchMatch')).toHaveCount(1);

  // Nothing escaped to the page — the invalid state never threw.
  expect(pageErrors).toEqual([]);
});

test('E347: a query that matches nothing turns the bar itself loud — an asserted state and an accented input — and it clears the moment the query matches', async ({
  page,
}) => {
  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  const inputStyle = () =>
    page.getByTestId('find-input').evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.borderTopColor} ${s.backgroundColor}`;
    });

  await page.getByTestId('find-input').fill('markdown');
  await expect(page.getByTestId('find-bar')).toHaveAttribute('data-state', 'ok');
  const matched = await inputStyle();

  await page.getByTestId('find-input').fill('zzqqxx-nothing');
  await expect(page.getByTestId('find-count')).toHaveText('No matches');
  await expect(page.getByTestId('find-bar')).toHaveAttribute('data-state', 'no-match');
  expect(await inputStyle()).not.toBe(matched); // the input itself turned, not just the text

  await page.getByTestId('find-input').fill('markdown');
  await expect(page.getByTestId('find-bar')).toHaveAttribute('data-state', 'ok');
  expect(await inputStyle()).toBe(matched);
});

test('E291: every match carries its own foreground and the current one is a distinct colour — light and dark themes, preview and edit mode', async ({
  page,
}) => {
  await fsWrite(page, '/docs/find-theme.md', 'cat cat cat\n');
  await page.goto('/#open=/docs/find-theme.md');
  await expect(page.getByTestId('doc')).toContainText('cat cat cat');

  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('crisp');
  await page.getByTestId('settings-theme-dark').selectOption('one-dark');
  const useDark = page.getByTestId('use-dark-theme');
  if (!(await useDark.isChecked())) await useDark.check();
  await saveSettings(page);

  const style = (loc: ReturnType<typeof page.locator>) =>
    loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, fg: s.color };
    });
  // The self-contained treatment: own foreground on every mark, the current
  // match's background distinct from the rest (styles.css fallbacks — no
  // bundled theme defines --mm-find*).
  const assertDistinct = async (activeSel: string, otherSel: string) => {
    const active = await style(page.locator(activeSel).first());
    const other = await style(page.locator(otherSel).first());
    expect(active.bg).toBe('rgb(240, 136, 62)'); // --mm-find-active fallback
    expect(other.bg).toBe('rgb(255, 223, 93)'); // --mm-find fallback
    expect(active.fg).toBe('rgb(31, 35, 40)'); // own foreground, not the theme's
    expect(other.fg).toBe('rgb(31, 35, 40)');
  };

  const themeBg = () => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(themeBg).toBe('rgb(255, 255, 255)'); // Crisp

  await page.keyboard.press('Control+f');
  await page.getByTestId('find-input').fill('cat');
  await expect(page.getByTestId('find-count')).toHaveText('1 of 3');
  await expect(page.locator('.doc mark.mm-find-active')).toHaveCount(1);
  await assertDistinct('.doc mark.mm-find.mm-find-active', '.doc mark.mm-find:not(.mm-find-active)');

  // Edit mode, light theme.
  await page.keyboard.press('Control+e');
  await expect(page.locator('.cm-searchMatch')).toHaveCount(3);
  await expect(page.locator('.cm-searchMatch-selected')).toHaveCount(1);
  await assertDistinct('.cm-searchMatch.cm-searchMatch-selected', '.cm-searchMatch:not(.cm-searchMatch-selected)');

  // Dark theme: same distinction, same self-contained legibility.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(themeBg).toBe('rgb(40, 44, 52)'); // One Dark
  await assertDistinct('.cm-searchMatch.cm-searchMatch-selected', '.cm-searchMatch:not(.cm-searchMatch-selected)');

  // Back to preview, still dark.
  await page.keyboard.press('Control+e');
  await expect(page.locator('.doc mark.mm-find-active')).toHaveCount(1);
  await assertDistinct('.doc mark.mm-find.mm-find-active', '.doc mark.mm-find:not(.mm-find-active)');
});

// Issue #123 (SPEC23 §3): CodeMirror paints its drawn selection in a layer
// *behind* .cm-content, so the opaque --mm-code-bg on .mm-md-code covered it —
// selecting inside a code block showed no selection at all. The tint now rides
// an .mm-code-sel span nested INSIDE the code span, so it paints above the code
// background and below the code text. Against the pre-fix build that span never
// exists and every tint assertion below fails.
test('E261: selection over code — the tint paints above --mm-code-bg in the editor and the split pane, opaque theme and translucent alike', async ({
  page,
}) => {
  const DOC = '# T\n\nprose with `inline code` inside\n\n```js\nconst answer = 42;\n```\n\ntail\n';

  /** Boot the app on DOC with a settings patch applied, in edit mode. */
  const boot = (patch: Record<string, unknown>) => bootEditorOn(page, '/docs/sel.md', DOC, patch);
  /** Put the whole of the line holding `text` in the selection. */
  const selectLine = async (pane: Locator, text: string) => {
    await pane.locator('.cm-line', { hasText: text }).first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
  };
  const bgOf = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);

  // --- full-width editor, crisp (--mm-code-bg fully opaque) ------------------
  await boot({ splitEdit: false, themeLight: 'crisp' });
  const editor = page.getByTestId('editor');
  const fenced = editor.locator('.cm-line', { hasText: 'const answer' }).locator('.mm-md-code');
  await expect(fenced.first()).toBeVisible();
  // The precondition of the bug, and the thing the fix must not disturb: the
  // code background is the theme's opaque one, and nothing is tinted yet.
  expect(await bgOf(fenced.first())).toBe('rgb(246, 248, 250)');
  await expect(editor.locator('.mm-code-sel')).toHaveCount(0);

  await selectLine(editor, 'const answer');
  const tint = editor.locator('.mm-md-code .mm-code-sel'); // nested => paints on top
  await expect(tint.first()).toBeVisible();
  // Issue #122: the fence is coloured by language now (codeSyntax is on by
  // default), so the innermost mark is cut at every token boundary. The
  // contract is unchanged — the whole selected code is tinted — it is just
  // spelled across several spans.
  expect((await tint.allTextContents()).join('')).toBe('const answer = 42;');
  expect(await bgOf(tint.first())).toBe('rgba(9, 105, 218, 0.18)'); // --mm-selection
  // Legible: the code foreground is untouched under the tint (it inherits from
  // whatever token span encloses it), and the code background behind it is
  // still the theme's.
  expect(await tint.first().evaluate((el) => getComputedStyle(el).color)).toBe(
    await tint.first().evaluate((el) => getComputedStyle(el.parentElement!).color),
  );
  expect(await bgOf(fenced.first())).toBe('rgb(246, 248, 250)');

  // A selection that starts in prose and runs through an inline code span is
  // tinted continuously — the same token, only the code part needs the mark.
  await selectLine(editor, 'prose with');
  const inline = editor
    .locator('.cm-line', { hasText: 'prose with' })
    .locator('.mm-md-code .mm-code-sel');
  await expect(inline.first()).toBeVisible();
  expect((await inline.first().textContent())!.trim()).toBe('inline code');
  expect(await bgOf(inline.first())).toBe('rgba(9, 105, 218, 0.18)');

  // Collapse the selection: the mark goes away and code looks as it did.
  await page.keyboard.press('End');
  await expect(editor.locator('.mm-code-sel')).toHaveCount(0);
  expect(await bgOf(fenced.first())).toBe('rgb(246, 248, 250)');

  // --- claude, whose --mm-code-bg is translucent -----------------------------
  await boot({ splitEdit: false, themeLight: 'claude' });
  await selectLine(page.getByTestId('editor'), 'const answer');
  expect(await bgOf(page.getByTestId('editor').locator('.mm-md-code .mm-code-sel').first())).toBe(
    'rgba(217, 119, 87, 0.35)',
  );

  // --- split view: the editor pane beside the preview ------------------------
  await boot({ splitEdit: true, themeLight: 'crisp' });
  await expect(page.getByTestId('split-divider')).toBeVisible();
  const splitEditor = page.locator('.split-editor');
  await selectLine(splitEditor, 'const answer');
  const splitTint = splitEditor.locator('.mm-md-code .mm-code-sel');
  await expect(splitTint.first()).toBeVisible();
  expect(await bgOf(splitTint.first())).toBe('rgba(9, 105, 218, 0.18)');
  // The preview pane paints its selection natively, over .doc code/pre — the
  // theme's tint reaches it through .theme-root ::selection (styles.css:51).
  expect(
    await page
      .locator('.split-preview .doc pre code')
      .first()
      .evaluate((el) => getComputedStyle(el, '::selection').backgroundColor),
  ).toBe('rgba(9, 105, 218, 0.18)');
});

// --- Issue #157: fenced code blocks as cards in the edit pane ----------------

test('E309: issue #157 — code blocks render as cards by default, caret reveal, the Smart Edit toggle and the Settings checkbox flip and persist, preview untouched', async ({
  page,
}) => {
  const DOC = 'intro\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\noutro\n';
  await fsWrite(page, '/docs/code157.md', DOC);
  await page.goto('/#open=/docs/code157.md');
  await expect(page.getByTestId('doc')).toContainText('intro');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // Rendered by default: card chrome on all four block lines (delimiters
  // included — they read as the card's padding rows), the fence marks and
  // info string hidden, the body still real highlighted editor text, and
  // the caret-park on line one keeps the block un-revealed.
  await editor.locator('.cm-line').filter({ hasText: 'intro' }).click();
  await expect(editor.locator('.cm-line.mm-fence-card')).toHaveCount(4);
  await expect(editor.locator('.cm-line.mm-fence-card-first')).toHaveCount(1);
  await expect(editor.locator('.cm-line.mm-fence-card-last')).toHaveCount(1);
  await expect(content).toContainText('const a = 1;');
  await expect(editor.locator('.mm-code-keyword').first()).toBeVisible(); // codeSyntax still colours
  expect(await text()).not.toContain('```');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // Caret reveal: click INTO the body — that block's delimiters show raw.
  await editor.locator('.cm-line').filter({ hasText: 'const a' }).click();
  await expect(content).toContainText('```js');
  // The body is ordinary editable text: typing lands in the document…
  await page.keyboard.press('End');
  await page.keyboard.type(' // note');
  await expect(content).toContainText('const a = 1; // note');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  // …and one undo restores the buffer (and the clean state).
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  // Caret out — the delimiters hide again.
  await editor.locator('.cm-line').filter({ hasText: 'outro' }).click();
  expect(await text()).not.toContain('```');

  // Code Block ▸ "Show Raw Code": every block drops to raw fences at once.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-code-block-view').click();
  await expect(page.getByTestId('smart-edit-toggle-code-blocks')).toHaveText(/Show Raw Code/);
  await page.getByTestId('smart-edit-toggle-code-blocks').click();
  await expect(editor.locator('.cm-line.mm-fence-card')).toHaveCount(0);
  await expect(content).toContainText('```js');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The Settings checkbox reflects the flip and drives it back on.
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await expect(page.getByTestId('settings-code-block-view')).not.toBeChecked();
  await page.getByTestId('settings-code-block-view').check();
  await saveSettings(page);
  await expect(editor.locator('.cm-line.mm-fence-card')).toHaveCount(4);

  // Off again, and the setting survives a reload.
  await openSettings(page);
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('settings-code-block-view').uncheck();
  await saveSettings(page);
  await expect(editor.locator('.cm-line.mm-fence-card')).toHaveCount(0);
  await page.reload();
  // Issue #125: the reload reopens in the remembered edit mode.
  await expect(content).toBeVisible();
  await expect(content).toContainText('```js');
  await expect(editor.locator('.cm-line.mm-fence-card')).toHaveCount(0);

  // The menu label flipped; it brings the cards back — and no text changed
  // anywhere in the journey.
  await page.getByTestId('smart-edit-gutter').click();
  await page.getByTestId('smart-edit-code-block-view').click();
  await expect(page.getByTestId('smart-edit-toggle-code-blocks')).toHaveText(/Show Rendered Code/);
  await page.getByTestId('smart-edit-toggle-code-blocks').click();
  await expect(editor.locator('.cm-line.mm-fence-card')).toHaveCount(4);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The preview pane is byte-identical either way: the split preview shows
  // the same rehype code card regardless of the editor setting.
  await expect(page.getByTestId('split-preview').locator('pre code')).toContainText('const a = 1;');
});

test('E317: issue #163 — the card copy control copies the body only, a selection crossing a card tints above it, and the delimiter row is clickable with its fence text selectable', async ({
  page,
}) => {
  const DOC = 'intro\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\noutro\n';
  await fsWrite(page, '/docs/code163.md', DOC);
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await page.goto('/#open=/docs/code163.md');
  await expect(page.getByTestId('doc')).toContainText('intro');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // Left inset: rendered card lines carry the preview's 16px breathing room
  // (.doc pre's horizontal padding) — the code no longer hugs the ring.
  await editor.locator('.cm-line').filter({ hasText: 'intro' }).click();
  const bodyLine = editor.locator('.cm-line').filter({ hasText: 'const a' });
  await expect(bodyLine).toHaveCSS('padding-left', '16px');

  // The stacking that kills the issue's artefact: the card chrome lives on a
  // ::before BELOW drawSelection's layer (which the view numbers by inline
  // style), and the line itself is transparent — so the drawn selection band
  // paints above the card background and below the text. The assertion is the
  // relative order, not the numbers CodeMirror happens to hand out.
  const stack = await bodyLine.evaluate((el) => ({
    line: getComputedStyle(el).backgroundColor,
    beforeZ: Number(getComputedStyle(el, '::before').zIndex),
    beforeBg: getComputedStyle(el, '::before').backgroundColor,
    layerZ: Number(
      getComputedStyle(el.closest('.cm-scroller')!.querySelector('.cm-selectionLayer')!).zIndex
    ),
  }));
  expect(stack.line).toBe('rgba(0, 0, 0, 0)');
  expect(stack.beforeBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(stack.beforeZ).toBeLessThan(stack.layerZ);

  // A selection running from the prose below up through the whole rendered
  // block (head ends on "intro", so the card stays rendered): the selection
  // layer's band covers every card row, hidden delimiter rows included.
  await editor.locator('.cm-line').filter({ hasText: 'outro' }).click();
  await page.keyboard.press('End');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowUp');
  expect(await text()).not.toContain('```'); // still rendered
  const first = await editor.locator('.cm-line.mm-fence-card-first').boundingBox();
  const last = await editor.locator('.cm-line.mm-fence-card-last').boundingBox();
  const bandCovers = (y: number) =>
    editor
      .locator('.cm-selectionBackground')
      .evaluateAll(
        (els, mid) =>
          els.some((el) => {
            const r = el.getBoundingClientRect();
            return r.top <= mid && r.bottom >= mid && r.width > 0;
          }),
        y
      );
  expect(await bandCovers(first!.y + first!.height / 2)).toBe(true);
  expect(await bandCovers(last!.y + last!.height / 2)).toBe(true);

  // The rendered card carries the preview's hover copy control: hidden at
  // rest, revealed on hover anywhere on the card, its own testid (the
  // preview's mm-copy-code stays scoped to the preview root).
  const btn = editor.getByTestId('mm-copy-code-editor');
  await expect(btn).toHaveCount(1);
  await expect(btn).toHaveAttribute('aria-label', 'Copy code');
  await expect(btn).toHaveCSS('opacity', '0');
  await bodyLine.hover();
  await expect(btn).toHaveCSS('opacity', '1');

  // Clicking copies the body EXACTLY as the reader sees it — no fences, no
  // info string, one implied trailing newline off — through the platform
  // copyText seam, and confirms briefly.
  await btn.click();
  await expect.poll(() => page.evaluate(() => window.__mmClipboard?.at(-1))).toBe(
    'const a = 1;\nconst b = 2;'
  );
  await expect(btn).toHaveAttribute('aria-label', 'Copied');
  await expect(btn).toHaveAttribute('aria-label', 'Copy code', { timeout: 4000 });

  // Inert chrome: the click revealed nothing, edited nothing, dirtied
  // nothing — the block is still rendered and the document text unchanged.
  expect(await text()).not.toContain('```');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, '/docs/code163.md')).toBe(DOC);

  // Clicking the hidden delimiter row reveals THAT block's raw fence and
  // parks the caret on the line the pointer hit.
  await editor.locator('.cm-line.mm-fence-card-first').click();
  await expect(content).toContainText('```js');
  await expect(editor.locator('.cm-line.mm-fence-card-first.cm-activeLine')).toHaveCount(1);

  // Once revealed, the fence characters select by mouse drag…
  const fence = await editor.locator('.cm-line.mm-fence-card-first').boundingBox();
  await page.mouse.move(fence!.x + 17, fence!.y + fence!.height / 2);
  await page.mouse.down();
  await page.mouse.move(fence!.x + 60, fence!.y + fence!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString() ?? '')).toMatch(
    /^`+j?s?$/
  );

  // …and by double-click, and type over like any other text (undo restores).
  await editor.locator('.cm-line.mm-fence-card-first').dblclick({ position: { x: 24, y: 8 } });
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe('```');
  await page.keyboard.type('x');
  await expect(content).toContainText('xjs');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(content).toContainText('```js');
});

test('E484: issue #269 — every preview language colours in the edit pane and in split, and unknown fences stay plain', async ({
  page,
}) => {
  // SPEC23 §3 (issue #269): issue #122 wired three CodeMirror grammars into
  // the edit pane, so a python / rust / sql fence stayed flat code text while
  // the preview coloured it. The edit pane now reuses the preview's own
  // highlighter (lowlight) over the fence body, so both panes cover the same
  // language set through the same eight --mm-syn-* tokens. Against the pre-fix
  // build every language below has zero mm-code-* spans in the editor.
  const LANGS: Array<[string, string]> = [
    ['python', 'def greet(name):'],
    ['bash', 'echo "building"'],
    ['json', '{ "alpha": 42 }'],
    ['yaml', 'server: marky'],
    ['rust', 'fn plus(a: i32) -> i32 { a + 7 }'],
    ['go', 'func Plus(a int) int { return a + 7 }'],
    ['java', 'class Demo { int plus() { return 7; } }'],
    ['sql', 'SELECT name FROM users WHERE id = 7;'],
    ['c', 'int cplus(int a) { return a + 7; }'],
    ['cpp', 'auto cppplus(int a) -> int { return a + 7; }'],
  ];
  const DOC = [
    '# Fences',
    '',
    ...LANGS.flatMap(([lang, body]) => ['```' + lang, body, '```', '']),
    // The three degrade-gracefully shapes: no info string, a bogus one, empty.
    '```',
    'untagged body line',
    '```',
    '',
    '```notalang',
    'bogus tagged body line',
    '```',
    '',
    '```',
    '```',
    '',
    'Tail prose.',
    '',
  ].join('\n');

  // Any thrown error or console noise from an unknown grammar fails the test.
  const noise: string[] = [];
  page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text()}`);
  });

  /** Boot on DOC with a settings patch, landing in edit mode. */
  const boot = (patch: Record<string, unknown>) => bootEditorOn(page, '/docs/langs.md', DOC, patch);
  /** Token spans on the fence line holding `body` (the selection tint aside). */
  const tokensOn = (pane: Locator, body: string) =>
    pane.locator('.cm-line', { hasText: body }).first().locator('[class*="mm-code-"]:not(.mm-code-sel)');

  await boot({ splitEdit: false, themeLight: 'crisp' });
  const editor = page.getByTestId('editor');

  for (const [lang, body] of LANGS) {
    const tokens = tokensOn(editor, body);
    await expect(tokens.first(), lang).toBeVisible();
    // Actually coloured, not merely classed: the token paints a different
    // colour from the flat code foreground its enclosing .mm-md-code sets.
    const [tokenColor, flatColor] = await tokens.first().evaluate((el) => [
      getComputedStyle(el).color,
      getComputedStyle(el.parentElement!).color,
    ]);
    expect(tokenColor, lang).not.toBe(flatColor);
  }

  // SPEC23 §3 (issue #122): the fence background still paints over the newly
  // coloured bodies, with the token spans nested inside it.
  const pyLine = editor.locator('.cm-line', { hasText: 'def greet' }).first();
  await expect(pyLine.locator('.mm-md-code').first()).toBeVisible();
  await expect(pyLine.locator('.mm-md-code [class*="mm-code-"]').first()).toBeVisible();
  expect(
    await pyLine.locator('.mm-md-code').first().evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgb(246, 248, 250)');

  // Unlabelled, bogus and empty fences: plain code text, nothing lost.
  for (const body of ['untagged body line', 'bogus tagged body line']) {
    await expect(editor.locator('.cm-line', { hasText: body }).first()).toBeVisible();
    await expect(tokensOn(editor, body)).toHaveCount(0);
  }
  expect(noise).toEqual([]);

  // The codeSyntax switch still clears every token span in the editor.
  await openSettings(page, 'general');
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('code-syntax').uncheck();
  await saveSettings(page);
  await expect(editor.locator('[class*="mm-code-"]:not(.mm-code-sel)')).toHaveCount(0);

  // --- the edit half of split view colours identically -----------------------
  await boot({ splitEdit: true, themeLight: 'crisp', codeSyntax: true });
  await expect(page.getByTestId('split-divider')).toBeVisible();
  const splitEditor = page.locator('.split-editor');
  for (const [lang, body] of [LANGS[0], LANGS[4], LANGS[7]]) {
    await expect(tokensOn(splitEditor, body).first(), `split ${lang}`).toBeVisible();
  }
  await expect(tokensOn(splitEditor, 'untagged body line')).toHaveCount(0);
  expect(noise).toEqual([]);
});

test('E485: issue #269 — typing inside a several-hundred-line python fence stays responsive and stays coloured', async ({
  page,
}) => {
  // SPEC23 §3 (issue #269): highlighting is computed over the editor's visible
  // ranges and memoized on the slice text, so a fence far longer than a
  // viewport costs a viewport's work per keystroke, not a document's.
  const lines: string[] = [];
  for (let i = 0; i < 600; i++) lines.push(`def fn_${i}(arg):  # row ${i}`, `    return arg + ${i}`);
  const DOC = ['# Big', '', '```python', ...lines, '```', '', 'Tail prose.', ''].join('\n');
  await fsWrite(page, '/docs/bigfence.md', DOC);
  await page.goto('/#open=/docs/bigfence.md');
  await expect(page.getByTestId('doc')).toBeVisible();
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.mm-code-keyword').first()).toBeVisible();

  const target = editor.locator('.cm-line', { hasText: 'def fn_2(' }).first();
  await target.click();
  await page.keyboard.press('End');
  const started = Date.now();
  await page.keyboard.type('  # typed');
  await expect(editor.locator('.cm-line', { hasText: '# typed' }).first()).toBeVisible();
  // Generous by an order of magnitude over a viewport-scoped re-highlight; a
  // whole-document one on every keystroke blows straight through it.
  expect(Date.now() - started).toBeLessThan(5000);
  await expect(editor.locator('.mm-code-comment').first()).toBeVisible();
});

test('E527: issue #265 — the code card holding the caret keeps its copy button lit with no pointer, hover elsewhere still works, and the persistent click copies without dirtying', async ({
  page,
}) => {
  // Issue #265: the edit-pane control used to be hover-only, and issue #163
  // skipped it entirely on a revealed card — so the block you had clicked
  // into, the one case that must show a button steadily, had none at all.
  // Against the pre-fix build the first assertion below finds zero buttons on
  // the revealed card.
  const DOC = 'intro\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nmiddle\n\n```py\nx = 1\n```\n\noutro\n';
  await fsWrite(page, '/docs/code265.md', DOC);
  await enableActiveLine(page); // issue #358: the caret-line tint is opt-in
  await page.goto('/#open=/docs/code265.md');
  await expect(page.getByTestId('doc')).toContainText('intro');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const content = editor.locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // One button per card, first-line anchored — the two blocks addressed by
  // their own card rather than by a global index.
  const cardFirst = editor.locator('.cm-line.mm-fence-card-first');
  await expect(cardFirst).toHaveCount(2);
  const btnA = cardFirst.nth(0).getByTestId('mm-copy-code-editor');
  const btnB = cardFirst.nth(1).getByTestId('mm-copy-code-editor');
  // The reveal is a 0.12s opacity transition, so both states are asserted
  // with retrying matchers rather than a one-shot read mid-fade.
  const expectLit = async (b: Locator) => {
    await expect(b).toHaveCSS('opacity', '1');
    await expect(b).toHaveCSS('pointer-events', 'auto');
  };
  const expectDark = async (b: Locator) => {
    await expect(b).toHaveCSS('opacity', '0');
    await expect(b).toHaveCSS('pointer-events', 'none');
  };

  // At rest, with the caret in the prose and the pointer on it: both hidden,
  // exactly as before this issue.
  await editor.locator('.cm-line').filter({ hasText: 'intro' }).click();
  await expectDark(btnA);
  await expectDark(btnB);

  // Walk the caret INTO block A by keyboard — the pointer never leaves the
  // "intro" line, so nothing here is hover. Two presses land it on the
  // opening fence row, which counts as inside and reveals the raw fence.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(content).toContainText('```js');
  await expect(editor.locator('.cm-line.mm-fence-card.cm-activeLine')).toHaveCount(1);
  // The revealed card carries the control, lit and clickable, pointer away.
  await expectLit(btnA);
  await expectDark(btnB);

  // The widget takes no layout: on the revealed row the raw fence text still
  // starts exactly where the card's body text does (the card's own 16px
  // inset), so nothing reflowed or shifted when the button appeared.
  const firstTextX = (line: Locator) =>
    line.evaluate((el) => {
      const node = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(node!);
      return Math.round(range.getBoundingClientRect().left);
    });
  expect(await firstTextX(cardFirst.nth(0))).toBe(
    await firstTextX(editor.locator('.cm-line').filter({ hasText: 'const a' }))
  );

  // Issue #263's cursor-line icon shares this very line and stays clear of it:
  // the two boxes do not intersect, the smart-edit button sitting left of the
  // card while the copy button sits inside its top-right corner.
  const smart = await page.getByTestId('smart-edit-gutter').boundingBox();
  const copy = await btnA.boundingBox();
  expect(smart!.x + smart!.width).toBeLessThanOrEqual(copy!.x);

  // Hover over block B: the persistent state and the hover state coexist —
  // .is-cursor is its own class, so setHoveredCard's clearing pass over every
  // other button cannot take A's light away.
  await editor.locator('.cm-line').filter({ hasText: 'x = 1' }).hover();
  await expectLit(btnA);
  await expectLit(btnB);

  // Pointer back to the prose: B goes dark again, A stays lit on the caret
  // alone. This is the issue in one assertion.
  await editor.locator('.cm-line').filter({ hasText: 'middle' }).hover();
  await expectLit(btnA);
  await expectDark(btnB);

  // The persistent button copies what the hover button does — block A's
  // interior only, no fences and no info string — and confirms.
  await btnA.click();
  await expect
    .poll(() => page.evaluate(() => window.__mmClipboard?.at(-1)))
    .toBe('const a = 1;\nconst b = 2;');
  await expect(btnA).toHaveAttribute('aria-label', 'Copied');
  // Inert chrome: the caret never moved (block A is still revealed), nothing
  // was dispatched, nothing dirtied, and the file on disk is unchanged.
  await expect(content).toContainText('```js');
  await expect(editor.locator('.cm-line.mm-fence-card.cm-activeLine')).toHaveCount(1);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, '/docs/code265.md')).toBe(DOC);
  await expect(btnA).toHaveAttribute('aria-label', 'Copy code', { timeout: 4000 });

  // Caret out of the block — that card returns to hover-only, at rest again,
  // and the block re-renders with no raw fences anywhere.
  await editor.locator('.cm-line').filter({ hasText: 'outro' }).click();
  expect(await text()).not.toContain('```');
  await expectDark(btnA);
  await expectDark(btnB);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

  // The widget carries the caret flag now, so it is rebuilt far more often —
  // and a button node reads the body span of the widget that BUILT it. An
  // edit above the block must therefore redraw it, not repaint it, or the
  // click would copy a stale span. Type in the prose, then copy A by hover.
  await editor.locator('.cm-line').filter({ hasText: 'intro' }).click();
  await page.keyboard.type('XY');
  const writes = () => page.evaluate(() => window.__mmClipboard?.length ?? 0);
  const before = await writes();
  await cardFirst.nth(0).hover();
  await btnA.click();
  await expect.poll(writes).toBe(before + 1);
  expect(await page.evaluate(() => window.__mmClipboard?.at(-1))).toBe('const a = 1;\nconst b = 2;');
});

// Issue #355 (SPEC44 §2.1): the caret-line tint is painted on .cm-activeLine,
// BELOW the (usually opaque) --mm-code-bg of every .mm-md-code span on it — so
// with the caret inside inline code, a raw table cell, a grid cell or a fence
// body, the code sat as an untinted box in the band. The tint now also rides
// as an image layer over the code background of the caret line's code spans.
// Against the pre-fix build every span computes background-image: none and
// each gradient assertion below fails.
test('E626: issue #355 — caret-line tint paints over code: inline, raw table row, fence body, live preview, table grid, and the token drives it', async ({
  page,
}) => {
  const DOC = [
    '# T',
    '',
    'prose with `inline code` inside',
    '',
    'another `other code` line',
    '',
    '| Key | Value |',
    '| --- | --- |',
    '| `MM_LLM_API_KEY` | – |',
    '',
    '```js',
    'const answer = 42;',
    'const other = 1;',
    '```',
    '',
    'tail',
    '',
  ].join('\n');
  const CODE_BG = 'rgb(246, 248, 250)'; // crisp's opaque --mm-code-bg

  /** Boot the app on DOC with a settings patch applied, in edit mode (E261). */
  // Issue #358: the tint under test is opt-in — every boot turns it on.
  const boot = (patch: Record<string, unknown>) => bootEditorOn(page, '/docs/caret-code.md', DOC, { activeLine: true, ...patch });
  const css = (loc: Locator, prop: string) =>
    loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  const beforeCss = (loc: Locator, prop: string) =>
    loc.evaluate((el, p) => getComputedStyle(el, '::before').getPropertyValue(p), prop);
  /** The caret line's own tint, as the browser computes it. */
  const lineTint = (editor: Locator) => css(editor.locator('.cm-line.cm-activeLine').first(), 'background-color');
  /** Assert the code span carries the tint layered over the code background. */
  const expectLayered = async (editor: Locator, span: Locator) => {
    await expect(span).toBeVisible();
    const image = await css(span, 'background-image');
    expect(image).toContain('linear-gradient');
    expect(image).toContain(await lineTint(editor));
    expect(await css(span, 'background-color')).toBe(CODE_BG);
  };
  const expectPlain = async (span: Locator) => {
    await expect(span).toBeVisible();
    expect(await css(span, 'background-image')).toBe('none');
    expect(await css(span, 'background-color')).toBe(CODE_BG);
  };

  // --- raw highlighting: prose inline code and a raw table row ---------------
  await boot({ splitEdit: false, themeLight: 'crisp', livePreview: false, tableGridView: false });
  const editor = page.getByTestId('editor');
  const proseLine = editor.locator('.cm-line', { hasText: 'prose with' }).first();
  const proseCode = proseLine.locator('.mm-md-code').first();
  const rowLine = editor.locator('.cm-line', { hasText: 'MM_LLM_API_KEY' }).first();
  const rowCode = rowLine.locator('.mm-md-code').first();

  // Caret elsewhere: neither span is tinted — the precondition of the bug.
  await editor.locator('.cm-line', { hasText: 'tail' }).first().click();
  await expectPlain(proseCode);
  await expectPlain(rowCode);
  const proseColor = await css(proseCode, 'color');

  await proseLine.click();
  await expect(proseLine).toHaveClass(/cm-activeLine/);
  await expectLayered(editor, editor.locator('.cm-line.cm-activeLine .mm-md-code').first());
  expect(await css(proseCode, 'color')).toBe(proseColor); // the text is untouched
  await expectPlain(rowCode); // the non-caret row keeps its code background
  await expect(editor.locator('.mm-code-sel')).toHaveCount(0); // no ranged selection involved

  await rowLine.click();
  await expect(rowLine).toHaveClass(/cm-activeLine/);
  await expectLayered(editor, rowCode);
  await expectPlain(proseCode);

  // --- fence body inside the issue #157 card ----------------------------------
  const bodyLine = editor.locator('.cm-line.mm-fence-card', { hasText: 'const answer' }).first();
  const siblingLine = editor.locator('.cm-line.mm-fence-card', { hasText: 'const other' }).first();
  await bodyLine.click();
  await expect(bodyLine).toHaveClass(/cm-activeLine/);
  await expectLayered(
    editor,
    editor.locator('.cm-line.mm-fence-card.cm-activeLine .mm-md-code').first(),
  );
  await expectPlain(siblingLine.locator('.mm-md-code').first());
  // The card's chrome behind the line is untouched.
  expect(await beforeCss(bodyLine, 'background-color')).toBe(CODE_BG);
  expect(await beforeCss(bodyLine, 'z-index')).toBe('-3');
  expect(await beforeCss(bodyLine, 'box-shadow')).not.toBe('none');

  // --- token-bound: an override recolours the layer in step with the line -----
  await proseLine.click();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.theme-root')!.style.setProperty('--mm-active-line', 'rgb(1, 2, 3)');
  });
  expect(await lineTint(editor)).toBe('rgb(1, 2, 3)');
  expect(await css(proseCode, 'background-image')).toContain('rgb(1, 2, 3)');
  expect(await css(proseCode, 'background-color')).toBe(CODE_BG);

  // --- live preview on: the caret line is revealed raw (PRD 006 §8) -----------
  await boot({ splitEdit: false, themeLight: 'crisp', livePreview: true, tableGridView: false });
  const lpEditor = page.getByTestId('editor');
  const lpProse = lpEditor.locator('.cm-line', { hasText: 'prose with' }).first();
  await lpProse.click();
  await expect(lpProse).toHaveClass(/cm-activeLine/);
  await expect(lpProse).toContainText('`inline code`'); // revealed: backticks visible
  await expectLayered(lpEditor, lpEditor.locator('.cm-line.cm-activeLine .mm-md-code').first());
  // A rendered non-caret line's code keeps its plain code background.
  const lpOther = lpEditor.locator('.cm-line', { hasText: 'other code' }).first().locator('.mm-lp-code').first();
  await expectPlain(lpOther);
  await expect(lpEditor.locator('.cm-line.cm-activeLine .mm-lp-code')).toHaveCount(0);

  // --- table grid on (the default): a gridded row's code cell -----------------
  await boot({ splitEdit: false, themeLight: 'crisp', livePreview: false, tableGridView: true });
  const gridEditor = page.getByTestId('editor');
  const gridLine = gridEditor.locator('.cm-line.mm-table-mode-line', { hasText: 'MM_LLM_API_KEY' }).first();
  await expect(gridLine).toBeVisible();
  await gridLine.locator('.mm-md-code').first().click();
  await expect(gridLine).toHaveClass(/cm-activeLine/);
  await expectLayered(
    gridEditor,
    gridEditor.locator('.cm-line.mm-table-mode-line.cm-activeLine .mm-md-code').first(),
  );
  // The grid wash behind the line is untouched.
  expect(await beforeCss(gridLine, 'background-color')).toBe(CODE_BG);
  expect(await beforeCss(gridLine, 'z-index')).toBe('-3');
});

// SPEC44 §2.1 (issue #358): the caret-line tint is opt-in. A fresh profile
// mounts no highlightActiveLine (no .cm-activeLine, and the gutter twin was
// never mounted); Settings ▸ Editor's checkbox turns it on and off live, and
// on is exactly the issue #345/#355 tint through --mm-active-line. Against
// the pre-change build the first count-0 assertion fails (the class was
// present by default).
test('E645: issue #358 — a fresh profile shows no caret-line tint in the editor or the gutter; "Highlight the current line" turns it on and off live, painted by --mm-active-line', async ({
  page,
}) => {
  await fsWrite(page, '/docs/active358.md', '# Tint\n\nfirst line here\n\nsecond line here\n');
  await page.goto('/#open=/docs/active358.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Tint');
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  const target = editor.locator('.cm-line', { hasText: 'second line here' });
  await target.click();
  await expect.poll(() => editorCaret(page).then((c) => c?.text)).toBe('second line here');
  const tinted = editor.locator('.cm-line.cm-activeLine');
  const stored = async () =>
    (JSON.parse((await fsRead(page, '/config/settings.json'))!) as Record<string, unknown>).activeLine;

  // Default off: the caret is parked on a line and nothing carries the class.
  await expect(tinted).toHaveCount(0);
  await expect(editor.locator('.cm-activeLineGutter')).toHaveCount(0);
  expect(await stored()).not.toBe(true);

  // Settings ▸ Editor: unchecked by default; check + save ⇒ the class lands
  // on the caret's line without a reload, and the gutter stays untouched.
  await openSettings(page, 'editor');
  const box = page.getByTestId('editor-active-line');
  await expect(box).not.toBeChecked();
  await box.check();
  await saveSettings(page);
  await expect(tinted).toHaveCount(1);
  await expect(tinted).toHaveText('second line here');
  await expect(editor.locator('.cm-activeLineGutter')).toHaveCount(0);
  expect(await stored()).toBe(true);
  // The token paints it: the line's colour is --mm-active-line as the theme
  // resolves it (a probe carrying the same var), not CodeMirror's own pick.
  const [lineBg, tokenBg] = await page.evaluate(() => {
    const line = document.querySelector('.cm-content .cm-activeLine')!;
    const probe = document.createElement('div');
    probe.style.background = 'var(--mm-active-line)';
    document.querySelector('.theme-root')!.appendChild(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(line).backgroundColor, token];
  });
  expect(lineBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(lineBg).toBe(tokenBg);

  // Uncheck + save ⇒ gone again, still without a reload; the key is stored false.
  await openSettings(page, 'editor');
  await expect(box).toBeChecked();
  await box.uncheck();
  await saveSettings(page);
  await expect(tinted).toHaveCount(0);
  expect(await stored()).toBe(false);
});

test('E646: issue #358 — the caret-line setting persists across reload in both states, and an older settings.json without the key comes up off', async ({
  page,
}) => {
  const DOC = '# Persist\n\nfirst line here\n\nsecond line here\n';
  const boot = (patch: Record<string, unknown>) => bootEditorOn(page, '/docs/persist358.md', DOC, patch);
  const editor = page.getByTestId('editor');
  const tinted = editor.locator('.cm-line.cm-activeLine');
  const park = async () => {
    await editor.locator('.cm-line', { hasText: 'second line here' }).click();
    await expect.poll(() => editorCaret(page).then((c) => c?.text)).toBe('second line here');
  };
  const stored = async () =>
    (JSON.parse((await fsRead(page, '/config/settings.json'))!) as Record<string, unknown>).activeLine;

  // Stored true survives a reload.
  await boot({ activeLine: true });
  await park();
  await expect(tinted).toHaveText('second line here');
  await boot({});
  await park();
  await expect(tinted).toHaveText('second line here');
  expect(await stored()).toBe(true);

  // Turned off through the dialog: off now, and still off after a reload.
  await openSettings(page, 'editor');
  await page.getByTestId('editor-active-line').uncheck();
  await saveSettings(page);
  await expect(tinted).toHaveCount(0);
  expect(await stored()).toBe(false);
  await boot({});
  await park();
  await expect(tinted).toHaveCount(0);

  // The migration: a settings.json from before the key existed parses as off.
  await page.evaluate(() => {
    const settings = JSON.parse(window.__mmfs!.read('/config/settings.json')!) as Record<string, unknown>;
    delete settings.activeLine;
    window.__mmfs!.write('/config/settings.json', JSON.stringify(settings));
  });
  await boot({});
  await park();
  await expect(tinted).toHaveCount(0);
  await expect(editor.locator('.cm-activeLineGutter')).toHaveCount(0);
});
