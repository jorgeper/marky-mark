import { expect, test } from './fixtures';
import {
  addComment,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  openSettings,
  openWelcomeViaHelp,
  PHRASE,
  revealToolbar,
  waitForSidecar,
  WELCOME,
} from './helpers';

// Opening, saving and remembering documents: Save As, the unsaved-changes
// guard, new buffers, Open Recent, reopen-on-launch, crash-safe drafts.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E18: Save As writes the buffer (and sidecar) to the chosen path and switches to it', async ({ page }) => {
  await addComment(page, PHRASE, 'travels along');
  await waitForSidecar(page, (s) => !!s && s.includes('travels along'));

  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/copy.md';
  });
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-save-as').click();

  await expect(page.getByTestId('docname')).toContainText('copy.md');
  await expect(page.getByTestId('docname')).toHaveAttribute('title', '/docs/copy.md');
  const copied = await fsRead(page, '/docs/copy.md');
  expect(copied).toContain('# Welcome to Marky Mark');
  // Sidecar mode: comments were written next to the NEW file and still show.
  const sidecar = await fsRead(page, '/docs/copy.md.comments.json');
  expect(sidecar).toContain('travels along');
  await expect(page.getByTestId('card-body')).toHaveText('travels along');
});

test('E27: opening another file with unsaved changes prompts Save / Don’t save / Cancel; clean opens never prompt', async ({
  page,
}) => {
  // Clean buffer → Open another file via the dialog: no prompt.
  page.once('dialog', (d) => void d.accept('/docs/field-guide.md'));
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-open').click();
  await expect(page.getByTestId('docname')).toContainText('field-guide.md');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);

  // Dirty the buffer.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('GUARDMARK ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Help (a different file) → prompt. Cancel keeps everything.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('docname')).toContainText('field-guide.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Help again → Don't save: welcome opens, the edit never reached disk.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click();
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  expect(await fsRead(page, '/docs/field-guide.md')).not.toContain('GUARDMARK');

  // Dirty welcome, then Open field-guide → Save: edit persisted, then opened.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('GUARDMARK2 ');
  await page.keyboard.press('Control+e');
  page.once('dialog', (d) => void d.accept('/docs/field-guide.md'));
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-open').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-save').click();
  await expect(page.getByTestId('docname')).toContainText('field-guide.md');
  expect(await fsRead(page, WELCOME)).toContain('GUARDMARK2');
});

test('E78: ⌘N opens an untitled buffer — no dialog, nothing on disk; first ⌘S runs Save As (cancel keeps the buffer)', async ({
  page,
}) => {
  // Pristine launch (like E1): the splash shows both hints with live combos.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const hint = page.getByTestId('empty-hint');
  await expect(hint).toBeVisible();
  // SPEC27 §4.1 amendment: the key-combo hint lines no longer exist — the
  // splash carries a single drop hint (the hotkeys themselves are E78's
  // subject below and unchanged).
  await expect(hint).toContainText('Drop a file to open');

  const before = await page.evaluate(() => window.__mmfs!.list());
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  // No dialog ran and nothing was written.
  expect(await page.evaluate(() => window.__mmfs!.list())).toEqual(before);

  // Type → dirty; a cancelled Save As keeps the dirty untitled buffer.
  await page.getByTestId('editor').locator('.cm-content').click();
  await page.keyboard.type('# Fresh Start');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = null;
  });
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Save with a chosen path writes the buffer and switches to the real file.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/fresh.md';
  });
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('docname')).toContainText('fresh.md');
  await expect(page.getByTestId('docname')).toHaveAttribute('title', '/docs/fresh.md');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, '/docs/fresh.md')).toContain('# Fresh Start');
});

test('E79: unsaved-changes guard — around New, and Save-through when opening over a dirty untitled buffer', async ({
  page,
}) => {
  // Dirty the welcome doc.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTYMARK ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // ⌘N → three-way prompt; Cancel keeps the dirty doc, no buffer swap.
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await expect(page.getByTestId('open-prompt')).toContainText('starting a new file');
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // ⌘N again → Don’t save → fresh untitled buffer; the edit never hit disk.
  await page.keyboard.press('Control+n');
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, WELCOME)).not.toContain('DIRTYMARK');

  // Dirty untitled + open → prompt names Untitled; Save routes through Save
  // As (armed path), then the requested document opens.
  await page.getByTestId('editor').locator('.cm-content').click();
  await page.keyboard.type('# Keep me');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/kept.md';
  });
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click(); // opens welcome → guard fires
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await expect(page.getByTestId('open-prompt')).toContainText('“Untitled” has unsaved changes');
  await page.getByTestId('open-save').click();
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
  expect(await fsRead(page, '/docs/kept.md')).toContain('# Keep me');
});

test('E88: Open Recent — MRU order, persistence, guarded reopen, vanished-file cleanup, Clear Menu', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await fsWrite(page, '/docs/ra.md', '# Doc RA\n');
  await fsWrite(page, '/docs/rb.md', '# Doc RB\n');

  const recents = () =>
    page.evaluate(() => {
      const file = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'File')!;
      const sub = file.items.find((i) => i.type === 'submenu') as { items: Array<{ type: string; path?: string }> };
      return sub.items.filter((i) => i.type === 'recent').map((i) => i.path);
    });

  // Open both (ra then rb): MRU order, newest first.
  await page.goto('/?nativeMenu=1#open=/docs/ra.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Doc RA');
  await page.goto('/?nativeMenu=1#open=/docs/rb.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Doc RB');
  await expect.poll(recents).toEqual(['/docs/rb.md', '/docs/ra.md']);

  // Persisted: a reload (the #open hash reopens rb) keeps the stored list.
  expect(await fsRead(page, '/config/recent.json')).toContain('/docs/ra.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Doc RB');
  await expect.poll(recents).toEqual(['/docs/rb.md', '/docs/ra.md']);

  // Picking the older doc reopens it and bumps it to the front.
  await page.evaluate(() => window.__mmMenu!.clickRecent('/docs/ra.md'));
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Doc RA');
  await expect.poll(recents).toEqual(['/docs/ra.md', '/docs/rb.md']);

  // A vanished file: notice + the entry drops off (and stays off on disk).
  await page.evaluate(() => window.__mmfs!.remove('/docs/rb.md'));
  await page.evaluate(() => window.__mmMenu!.clickRecent('/docs/rb.md'));
  await expect(page.getByTestId('notice')).toContainText('rb.md');
  await expect.poll(recents).toEqual(['/docs/ra.md']);
  await expect.poll(() => fsRead(page, '/config/recent.json')).not.toContain('/docs/rb.md');

  // Clear Menu empties the list.
  await menuClick(page, 'clearRecent');
  await expect.poll(recents).toEqual([]);
  await expect.poll(() => fsRead(page, '/config/recent.json')).not.toContain('/docs/ra.md');
});

test('E91: reopen on launch — off by default (splash), the setting opts in, loses to explicit opens, skips missing files', async ({
  page,
}) => {
  await fsWrite(page, '/docs/r1.md', '# R One\n');
  await fsWrite(page, '/docs/r2.md', '# R Two\n');
  await page.goto('/#open=/docs/r1.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('R One');

  // SPEC30 §2 (issue #53 amendment): strip the suite's seed pin so this
  // launch runs the SHIPPED default — a hash-less relaunch lands on the
  // splash, with the recent entry intact (nothing is forgotten).
  await fsWrite(page, '/config/settings.json', JSON.stringify({ paneMinWidth: 240 }));
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  expect(await fsRead(page, '/config/recent.json')).toContain('/docs/r1.md');

  // Checking the setting opts back in: a hash-less relaunch reopens r1.
  await openSettings(page, 'general');
  await page.getByTestId('settings-reopen').check();
  await page.getByTestId('settings-close').click();
  await page.goto('/');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('R One');

  // An explicit #open at boot beats reopen.
  await page.goto('/#open=/docs/r2.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('R Two');

  // Unchecking returns to the splash.
  await openSettings(page, 'general');
  await page.getByTestId('settings-reopen').uncheck();
  await page.getByTestId('settings-close').click();
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  // Back on, but the top recent has vanished ⇒ splash, entry retained.
  await openSettings(page, 'general');
  await page.getByTestId('settings-reopen').check();
  await page.getByTestId('settings-close').click();
  await page.evaluate(() => window.__mmfs!.remove('/docs/r2.md'));
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  expect(await fsRead(page, '/config/recent.json')).toContain('/docs/r2.md');
});

test('E92: crash-safe drafts — shadow write, restore, discard, staleness after save, untitled buffers', async ({
  page,
}) => {
  // Dirty the welcome doc; the shadow copy lands after the idle debounce.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DRAFTMARK ');
  await expect.poll(() => fsRead(page, '/config/draft.json'), { timeout: 20000 }).toContain('DRAFTMARK');

  // "Crash" (reload): the boot reopens welcome, then offers the draft.
  await page.reload();
  await expect(page.getByTestId('restore-prompt')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('restore-prompt')).toContainText('welcome.md');
  await page.getByTestId('restore-yes').click();
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('DRAFTMARK');
  await expect.poll(() => fsRead(page, '/config/draft.json')).toBeNull();

  // Saving makes future boots quiet (clean transition also deletes).
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome');
  await expect(page.getByTestId('restore-prompt')).toHaveCount(0);

  // Discard path.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DRAFT2 ');
  await expect.poll(() => fsRead(page, '/config/draft.json'), { timeout: 20000 }).toContain('DRAFT2');
  await page.reload();
  await expect(page.getByTestId('restore-prompt')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('restore-no').click();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(page.getByTestId('doc')).not.toContainText('DRAFT2');
  await expect.poll(() => fsRead(page, '/config/draft.json')).toBeNull();

  // Untitled buffers draft too (docPath null → a fresh untitled restore).
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-content').click();
  await page.keyboard.type('ScratchDraft');
  await expect.poll(() => fsRead(page, '/config/draft.json'), { timeout: 20000 }).toContain('ScratchDraft');
  await page.reload();
  await expect(page.getByTestId('restore-prompt')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('restore-prompt')).toContainText('Untitled');
  await page.getByTestId('restore-yes').click();
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('ScratchDraft');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
});

test('E141: closing to the splash leaves no stale document behind — preview, edit, and split edit (issue #43)', async ({
  page,
}) => {
  // Issue #43: the splash and stale doc content are mutually exclusive.
  // Assert immediately and again after a settle window: a render orphaned by
  // the close (the edit-mode debounce is 200ms, plus the async markdown
  // pipeline) would land inside it and repopulate the container.
  const expectCleanSplash = async () => {
    await expect(page.getByTestId('empty-hint')).toBeVisible();
    await expect(page.getByTestId('doc')).toBeEmpty();
    await page.waitForTimeout(400); // intentional: catches the late async render
    await expect(page.getByTestId('empty-hint')).toBeVisible();
    await expect(page.getByTestId('doc')).toBeEmpty();
  };

  // Close from preview — the reported path: visible text, close, splash.
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expectCleanSplash();

  // Reopen: content renders and the splash yields (no over-correction).
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);

  // Close out of full edit with fresh keystrokes: a debounced render is in
  // flight and the editor's unmount reports its canonical text — neither may
  // resurrect the closed buffer. Discard the dirty prompt down to the splash.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('STALE-EDIT ');
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-discard').click();
  await expectCleanSplash();

  // Same out of split edit — the split pane injection must not linger either.
  await openWelcomeViaHelp(page);
  await page.keyboard.press('Control+e');
  await page.evaluate(() => window.__mmDispatch!('toggleSplit'));
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('STALE-SPLIT ');
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-discard').click();
  await expectCleanSplash();

  // A final clean reopen: the closes left no lasting damage behind.
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
});
