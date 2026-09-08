import { expect, test } from './fixtures';
import {
  addComment,
  expectReadyToType,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  openGridDoc,
  openWelcomeViaHelp,
  PHRASE,
  revealToolbar,
  waitForSidecar,
  WELCOME,
} from './helpers';
import { serializeDraft } from '../../src/lib/drafts';

// Opening, saving and remembering documents: Save As, the unsaved-changes
// guard, new buffers, Open Recent, the never-reopen launch (#81), crash-safe
// drafts.

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

test('E27: File → Open never prompts (issue #64) — a dirty buffer parks additively and its edit survives reactivation', async ({
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

  // Help (a different, already-open file): still NO prompt — the dirty
  // field-guide parks in the open set (SPEC36 §3.2 amended, issue #64) and
  // the edit never reaches disk.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  expect(await fsRead(page, '/docs/field-guide.md')).not.toContain('GUARDMARK');

  // Re-open field-guide via the dialog: the parked dirty buffer returns
  // intact — dirty dot, typed text — and disk is still untouched.
  page.once('dialog', (d) => void d.accept('/docs/field-guide.md'));
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-open').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('field-guide.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.getByTestId('doc')).toContainText('GUARDMARK');
  expect(await fsRead(page, '/docs/field-guide.md')).not.toContain('GUARDMARK');

  // ⌘S persists the parked-then-reactivated edit.
  await page.keyboard.press('Control+s');
  await expect.poll(() => fsRead(page, '/docs/field-guide.md')).toContain('GUARDMARK');
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

test('E517: issue #262 — ⌘N lands the caret in the text: over a document sitting in preview, and from the splash', async ({
  page,
}) => {
  // The mode half (SPEC22 §1.1) has always worked; the focus half is new. A
  // ⌘N over a document in PREVIEW mounts a fresh Editor, so this case proves
  // the mount focus and the seam agree — nobody blurs the other.
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('mode-switch')).toHaveAttribute('data-mode', 'edit');
  await expectReadyToType(page, 'typed straight in');
  expect(await fsRead(page, WELCOME)).not.toContain('typed straight in'); // the doc was left alone

  // The splash: no document at all, so ⌘N is the first thing that ever
  // mounts an editor here (E78's pristine launch).
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expectReadyToType(page, 'from the splash');
});

test('E518: issue #262 — ⌘N focuses an ALREADY-MOUNTED editor, and the dirty-buffer prompt still ends ready to type', async ({
  page,
}) => {
  // The always-reproducible case: in edit mode the Editor carries no `key`,
  // so ⌘N swaps `value` under a live view and its mount focus never re-runs.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  // Park the keyboard anywhere else — stands for the folder tree, the find
  // bar, a toolbar button — so the assertion below cannot pass on leftover
  // focus the editor happened to still hold.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toBeFocused();

  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expectReadyToType(page, 'live view');

  // SPEC22 §1.2: that probe dirtied the buffer, so the next ⌘N routes through
  // the three-way prompt. Cancel changes nothing — and steals no focus.
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('live view');
  await expect(page.getByTestId('mode-switch')).toHaveAttribute('data-mode', 'edit');

  // Don't Save resolves the guard into beginNewFile — the new empty buffer
  // arrives focused too, with the prompt's own focus already released.
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expectReadyToType(page, 'after the prompt');
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

test('E91: launch never reopens a document (issue #81) — hash-less relaunches land on the splash, explicit opens still work, recents intact', async ({
  page,
}) => {
  await fsWrite(page, '/docs/r1.md', '# R One\n');
  await fsWrite(page, '/docs/r2.md', '# R Two\n');
  await page.goto('/#open=/docs/r1.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('R One');

  // Issue #81: a hash-less relaunch ALWAYS lands on the splash — there is no
  // reopen setting to opt in — with the recent entry intact (nothing is
  // forgotten).
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  expect(await fsRead(page, '/config/recent.json')).toContain('/docs/r1.md');

  // An explicit #open at boot still opens (reload keeps the hash: an
  // explicit open again, not a restore).
  await page.goto('/#open=/docs/r2.md');
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('R Two');

  // And back to hash-less: splash again, both recents retained.
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

  // "Crash" (reload): the boot lands on the splash (issue #81) and offers
  // the draft; Restore reopens the drafted document itself.
  await page.reload();
  await expect(page.getByTestId('restore-prompt')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('restore-prompt')).toContainText('welcome.md');
  await page.getByTestId('restore-yes').click();
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  // Issue #125: the restored document reopens in the remembered edit mode.
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('DRAFTMARK');
  await expect.poll(() => fsRead(page, '/config/draft.json')).toBeNull();

  // Saving makes future boots quiet (clean transition also deletes) — and a
  // relaunch lands on the splash (issue #81: launch never reopens).
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('restore-prompt')).toHaveCount(0);

  // Discard path.
  await openWelcomeViaHelp(page);
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

test('E538: the restore dialog explains itself — where the copy came from, and a drafted file that no longer exists is said to be gone and lands in Untitled (issue #319)', async ({
  page,
}) => {
  // SPEC30 §3.3, the ordinary case: the drafted file still exists. The
  // dialog names it AND says in plain words where the copy came from —
  // edits never saved when the previous session ended. The word "kept" is
  // deliberately not asserted; the sentence is, so a reword that drops the
  // explanation fails here.
  await fsWrite(
    page,
    '/config/draft.json',
    serializeDraft({ version: 1, docPath: WELCOME, content: '# Welcome to Marky Mark\n\nORPHAN EDIT\n', at: new Date().toISOString() })
  );
  await page.reload();
  const prompt = page.getByTestId('restore-prompt');
  await expect(prompt).toBeVisible({ timeout: 15000 });
  await expect(prompt).toContainText('welcome.md');
  await expect(prompt).toContainText('never saved when it ended');
  await expect(prompt).not.toContainText('no longer exists');
  await page.getByTestId('restore-no').click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => fsRead(page, '/config/draft.json')).toBeNull();

  // The reported case: the drafted path is gone (deleted, renamed, or a path
  // from another machine's disk). Before #319 the dialog named the file as if
  // it were still there; now it says the file is gone and what Restore does.
  await fsWrite(
    page,
    '/config/draft.json',
    serializeDraft({ version: 1, docPath: '/docs/vanished.md', content: '# Vanished\n\nRESCUED EDIT\n', at: new Date().toISOString() })
  );
  expect(await fsRead(page, '/docs/vanished.md')).toBeNull();
  await page.reload();
  await expect(prompt).toBeVisible({ timeout: 15000 });
  await expect(prompt).toContainText('vanished.md');
  await expect(prompt).toContainText('no longer exists');
  await expect(prompt).toContainText('new Untitled document');
  // Restore keeps the edits: a fresh Untitled buffer, dirty, holding the draft.
  await page.getByTestId('restore-yes').click();
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('RESCUED EDIT');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/draft.json')).toBeNull();
});

test('E539: opening a document without editing it never produces a draft — CRLF, embedded-comment trailer, and a table in grid mode (issue #319)', async ({
  page,
}) => {
  // SPEC30 §3.2 writes the shadow copy ~2 s after the buffer turns dirty, so
  // each document is opened, flipped into edit (the buffer round-trips
  // through CodeMirror, the grid renders), and left alone past the debounce.
  // A document that opened dirty would show the dot and land draft.json.
  const untouched = async () => {
    await page.waitForTimeout(2500); // intentional: outwait the 2 s shadow-write debounce
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
    expect(await fsRead(page, '/config/draft.json')).toBeNull();
    // Back to preview, so the next #open renders into the preview container.
    await page.keyboard.press('Control+e');
    await expect(page.getByTestId('editor')).toHaveCount(0);
  };

  // A CRLF file (issue #42: line endings normalize once, at load).
  await fsWrite(page, '/docs/crlf.md', '# CRLF doc\r\n\r\nLine one\r\nLine two\r\n');
  await page.goto('/#open=/docs/crlf.md');
  await expect(page.getByTestId('doc')).toContainText('Line two');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('Line two');
  await untouched();

  // A file carrying an embedded-comment trailer (SPEC2 §5): the buffer holds
  // the body, the trailer is not content.
  const body = '# Commented doc\n\nA paragraph someone commented on.\n';
  const trailer =
    '\n<!-- marky-mark-comments\n' +
    JSON.stringify({
      version: '2.0.0',
      comments: [
        {
          kind: 'comment',
          id: 'e539-c1',
          author: 'Reviewer',
          createdAt: '2026-09-01T00:00:00.000Z',
          body: 'nit',
          resolved: false,
          thread: [],
          anchor: { exact: 'paragraph', prefix: 'A ', suffix: ' someone', start: 19, end: 28 },
        },
      ],
    }) +
    '\n-->\n';
  await fsWrite(page, '/docs/commented.md', body + trailer);
  await page.goto('/#open=/docs/commented.md');
  await expect(page.getByTestId('doc')).toContainText('someone commented on');
  await expect(page.getByTestId('doc')).not.toContainText('marky-mark-comments');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('someone commented on');
  await untouched();

  // A table opened in grid mode (SPEC38 §3.5): the display grid never counts
  // as an edit, and the draft would hold the canonical text anyway.
  await openGridDoc(page, '/docs/grid.md', 'top\n\n| aaa | b |\n| --- | --- |\n| 1 | 2 |\n\ntail', 'top');
  await untouched();

  // A "crash" after all three: a hash-less relaunch (the #open hash would be
  // an explicit open again, per E91) lands on the splash with no offer.
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.waitForTimeout(750); // intentional: the offer fires ~250 ms after boot
  await expect(page.getByTestId('restore-prompt')).toHaveCount(0);
  expect(await fsRead(page, '/config/draft.json')).toBeNull();
});

test('E326: closing to the splash leaves no stale document behind — preview, edit, and split edit (issue #43)', async ({
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
  await expect(page.getByTestId('editor')).toBeVisible();
  // splitEdit ships ON, so Ctrl+E already lands in split edit (the pane
  // mounts in the same commit as the editor, issue #165) and an
  // unconditional toggle would CLOSE it — the old unconditional dispatch
  // only passed by reading the divider before that unmount committed
  // (surfaced by issue #345's timing shift). Open the split only when it is
  // not up yet, so the close below really leaves split edit.
  if ((await page.getByTestId('split-divider').count()) === 0) {
    await page.evaluate(() => window.__mmDispatch!('toggleSplit'));
  }
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
