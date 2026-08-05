import { expect, test } from './fixtures';
import {
  freshApp,
  freshNativeMenuApp,
  fsRead,
  menuClick,
  openFolderRoot,
  seedFolders,
  stableBox,
} from './helpers';

// The folder tree: listing, chrome, reveal, context menu, create, rename,
// delete.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E93: folder tree — empty state, listing, sorting, dotfiles, expansion persistence, additive md opens, inert others', async ({
  page,
}) => {
  // Kitchen-sink runtime sat at the 30s default timeout, so machine load
  // timed it out — the suite's most frequent timeout.
  test.slow();
  await seedFolders(page);

  // Issue #22: outside workspace mode the folder view doesn't exist — the
  // hotkey is inert and no panel (or empty state) ever renders. PRD 003
  // Req 5: nor does the closed-state edge chevron.
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);

  // Open Folder… (hook-armed): workspace mode — the root lists, folders
  // first, dotfiles hidden.
  await openFolderRoot(page);
  await expect(page.getByTestId('folder-header')).toContainText('notes');
  const names = () =>
    page.$$eval('[data-testid="folder-item"]', (els) => els.map((e) => e.getAttribute('data-path')));
  // Non-markdown files are hidden by default — folders and markdown only.
  await expect.poll(names).toEqual(['/notes/sub', '/notes/a.md']);

  // The # filter toggle reveals them: dim and inert, # glyphs only on
  // markdown. Accent # = markdown-only; grey # = everything. All three
  // header icons carry tooltips.
  await expect(page.getByTestId('folder-filter')).toHaveAttribute('title', 'Show all files');
  await expect(page.getByTestId('folder-sync')).toHaveAttribute('title', 'Navigate to the open file');
  await expect(page.getByTestId('folder-collapse')).toHaveAttribute('title', 'Hide the folder panel');
  await expect(page.getByTestId('folder-filter')).toHaveClass(/filter-on/);
  await page.getByTestId('folder-filter').click();
  await expect(page.getByTestId('folder-filter')).toHaveAttribute('title', 'Show markdown files only');
  await expect(page.getByTestId('folder-filter')).not.toHaveClass(/filter-on/);
  await expect.poll(names).toEqual(['/notes/sub', '/notes/a.md', '/notes/pic.png', '/notes/zzz.txt']);
  await expect(page.locator('[data-path="/notes/a.md"] .folder-glyph svg')).toBeVisible();
  await expect(page.locator('[data-path="/notes/pic.png"] .folder-glyph svg')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/pic.png"]')).toHaveClass(/folder-item-dim/);
  await page.locator('[data-path="/notes/pic.png"]').click({ force: true });
  await expect(page.getByTestId('docname')).toContainText('welcome.md'); // unchanged

  // Expand sub → children appear; expansion persists to foldertree.json.
  await page.locator('[data-path="/notes/sub"]').click();
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).toContain('/notes/sub');

  // Restart: issue #81 — the launch lands on the splash with no panel.
  // Reopening the same folder revives the untitled session: root, expansion,
  // and the eye choice all return.
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await openFolderRoot(page);
  // The tree re-lists from the revived session — wait for the restored
  // listing itself, not just the first paint of a row in it.
  await expect.poll(names).toContain('/notes/sub/b.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();

  // Clicking a markdown row opens it (selected class follows).
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);

  // The selected tab floats clear of the panel's left edge — the pill must
  // not widen the scroll range, and the reveal must not scroll the gap away.
  const pill = () =>
    page.evaluate(() => {
      const list = document.querySelector('.folder-list')!;
      const sel = document.querySelector('.folder-item.selected')!;
      return {
        gap: sel.getBoundingClientRect().left - list.getBoundingClientRect().left,
        scrollLeft: list.scrollLeft,
      };
    });
  // The reveal scroll lands after the selection re-render, so poll both.
  await expect.poll(async () => (await pill()).scrollLeft).toBe(0);
  await expect.poll(async () => (await pill()).gap).toBeGreaterThanOrEqual(10);

  // The eye choice survived the restart above (the revived session); hiding
  // again drops the rows without collapsing sub or losing the selection.
  await expect.poll(names).toContain('/notes/pic.png');
  await page.getByTestId('folder-filter').click();
  await expect.poll(names).not.toContain('/notes/pic.png');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);

  // Tree opens are additive (SPEC36 §3.2 amended, issue #64): clicking a
  // not-open file over a dirty buffer never prompts — b parks with its ●
  // on the panel plane while a takes the front plane.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTY ');
  await page.keyboard.press('Control+e');
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeVisible();
});

test('E94: folder chrome — divider resize persists, chevrons / View checkbox / hotkey all flip the setting', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);

  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  // Drag the divider ~+80px; width and the persisted setting follow.
  const panelWidth = () =>
    page.getByTestId('folder-panel').evaluate((el) => el.getBoundingClientRect().width);
  const before = await panelWidth();
  const box = await stableBox(page.getByTestId('folder-divider')); // grab it at rest
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect.poll(panelWidth).toBeGreaterThan(before + 40);
  await expect.poll(async () => JSON.parse((await fsRead(page, '/config/settings.json'))!).folderWidth).toBeGreaterThan(
    before + 40
  );

  // PRD 003 Reqs 1/4: the header chevron closes; the View checkbox reflects
  // it; the pinned edge chevron appears with its tooltip and aria-label.
  const foldersItem = () =>
    page.evaluate(() => {
      const view = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!;
      return view.items.find((i) => i.type === 'command' && (i as { command?: string }).command === 'toggleFolders') as {
        checked?: boolean;
      };
    });
  expect((await foldersItem()).checked).toBe(true);
  await expect(page.getByTestId('folder-collapse')).toHaveAttribute('aria-label', 'Hide the folder panel');
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect.poll(async () => (await foldersItem()).checked).toBe(false);
  await expect(page.getByTestId('folder-expand')).toBeVisible();
  await expect(page.getByTestId('folder-expand')).toHaveAttribute('title', 'Show the folder panel');
  await expect(page.getByTestId('folder-expand')).toHaveAttribute('aria-label', 'Show the folder panel');

  // Issue #81: a restart lands on the splash — no panel AND no chevron
  // (there is no workspace to expand). Reopening the folder shows the
  // panel again (openFolder always reveals it).
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  // Back to the chevron-closed state for the sections below.
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();

  // The edge chevron reopens (Req 2); the checkbox follows; an open pane
  // pins no edge chevron.
  await page.getByTestId('folder-expand').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);
  await expect.poll(async () => (await foldersItem()).checked).toBe(true);

  // The hotkey flips the same setting the chevrons do.
  await page.waitForTimeout(200); // SPEC12 §1.3 cross-source dedup window
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  // A restart always lands on the splash (issue #81); reopening the folder
  // brings the panel back.
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
});

test('E95: reveal — auto on open, sync button, outside-root retarget, hidden panel stays hidden, untitled clears', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  // Opening a nested file walks the tree open and selects its row.
  await page.goto('/#open=/notes/sub/deep/c.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('C doc');
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);

  // Collapse everything; the sync button re-reveals.
  await page.locator('[data-path="/notes/sub"]').first().click(); // collapse sub
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveCount(0);
  await page.getByTestId('folder-sync').click();
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);

  // A file OUTSIDE the root retargets the root to its directory.
  await page.goto('/#open=/other/d.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('D doc');
  await expect(page.getByTestId('folder-header')).toContainText('other');
  await expect(page.locator('[data-path="/other/d.md"]')).toHaveClass(/selected/);
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).toContain('"/other"');

  // Hidden panel: a pane closed via the chevron stays closed until
  // explicitly reopened — opening files never forces it open, and only the
  // edge chevron remains at the seam (PRD 003 Req 4).
  await page.getByTestId('folder-collapse').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();
  await page.goto('/#open=/notes/a.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('A doc');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toBeVisible();

  // Untitled buffers clear the selection. (Human pacing: the automation just
  // clicked the chevron milliseconds ago — the SPEC12 §1.3 cross-source dedup
  // window would rightly treat an instant hotkey as the same physical action.)
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('docname')).toContainText('Untitled');
  await expect(page.locator('.folder-item.selected')).toHaveCount(0);
});

test('E96: folder context menu — per-kind items, dismissal, left-click inertness, copy and reveal record', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  const menuIds = () =>
    page.$$eval('[data-testid="folder-menu"] [data-testid^="folder-menu-"]', (els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('folder-menu-', ''))
    );

  // Directory row: the full set, in SPEC35 §2.5 order.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  expect(await menuIds()).toEqual([
    'new-file',
    'new-folder',
    'rename',
    'delete',
    'reveal',
    'copy-path',
    'copy-relative-path',
  ]);
  // Esc dismisses.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // Markdown file row.
  await page.locator('[data-path="/notes/a.md"]').click({ button: 'right' });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  expect(await menuIds()).toEqual(['reveal', 'rename', 'delete', 'copy-path', 'copy-relative-path']);
  // Any outside pointer-down dismisses. (The title span: the header's center
  // is the SPEC36 open-only toggle now — an inert surface keeps the intent.)
  await page.locator('.folder-title').click();
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // A dim non-markdown row offers the same file menu.
  await page.getByTestId('folder-filter').click(); // show all files
  await expect(page.locator('[data-path="/notes/pic.png"]')).toBeVisible();
  await page.locator('[data-path="/notes/pic.png"]').click({ button: 'right' });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  expect(await menuIds()).toEqual(['reveal', 'rename', 'delete', 'copy-path', 'copy-relative-path']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // The list's empty area: the root menu (no rename/delete, no relative copy).
  await page.locator('.folder-list').click({ button: 'right', position: { x: 60, y: 400 } });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  expect(await menuIds()).toEqual(['new-file', 'new-folder', 'reveal', 'copy-path']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // Left click never opens the menu (row click behavior unchanged).
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);

  // Copy Path / Copy Relative Path land the exact strings on __mmClipboard.
  await page.locator('[data-path="/notes/sub"]').click(); // expand
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-copy-path').click();
  await expect.poll(() => page.evaluate(() => window.__mmClipboard)).toEqual(['/notes/sub/b.md']);
  await page.locator('[data-path="/notes/sub/b.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-copy-relative-path').click();
  await expect.poll(() => page.evaluate(() => window.__mmClipboard)).toEqual(['/notes/sub/b.md', 'sub/b.md']);

  // Reveal records on __mmReveals; invoking an item dismissed the menu.
  await page.locator('[data-path="/notes/a.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-reveal').click();
  await expect.poll(() => page.evaluate(() => window.__mmReveals)).toEqual(['/notes/a.md']);
  await expect(page.getByTestId('folder-menu')).toHaveCount(0);
});

test('E97: create — New File / New Folder land in the clicked directory, inline-rename handoff, numbered placeholders', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);
  await page.locator('[data-path="/notes/sub"]').click(); // expand
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toBeVisible();

  // New File under the nested directory: an empty Untitled.md is written and
  // the new row immediately enters in-place rename.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-new-file').click();
  const input = page.getByTestId('folder-rename-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('Untitled.md');
  await expect.poll(() => fsRead(page, '/notes/sub/Untitled.md')).toBe('');
  // Esc keeps the placeholder name — and the new file still opens.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('docname')).toContainText('Untitled.md');
  await expect(page.locator('[data-path="/notes/sub/Untitled.md"]')).toHaveClass(/selected/);

  // The second run numbers itself before the extension; typing replaces the
  // preselected stem, Enter commits, and the file opens.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-new-file').click();
  await expect(input).toHaveValue('Untitled 2.md');
  await page.keyboard.type('story');
  await expect(input).toHaveValue('story.md');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('docname')).toContainText('story.md');
  await expect(page.locator('[data-path="/notes/sub/story.md"]')).toHaveClass(/selected/);
  await expect.poll(() => fsRead(page, '/notes/sub/story.md')).toBe('');
  expect(await fsRead(page, '/notes/sub/Untitled 2.md')).toBeNull();

  // New Folder: created collapsed, renames in place, opens nothing.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-new-folder').click();
  await expect(input).toHaveValue('New Folder');
  await page.keyboard.type('drafts'); // directories preselect the whole name
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-path="/notes/sub/drafts"]')).toBeVisible();
  await expect(page.getByTestId('docname')).toContainText('story.md'); // unchanged

  // The empty-area menu creates against the root.
  await page.locator('.folder-list').click({ button: 'right', position: { x: 60, y: 400 } });
  await page.getByTestId('folder-menu-new-file').click();
  await expect(input).toHaveValue('Untitled.md');
  await page.keyboard.press('Enter'); // unchanged value ⇒ the cancel path — still opens
  await expect(page.getByTestId('docname')).toContainText('Untitled.md');
  await expect.poll(() => fsRead(page, '/notes/Untitled.md')).toBe('');
});

test('E98: rename in place — open dirty file remaps path/title/recents, dir rename remaps state, invalid names refuse', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);
  await page.locator('[data-path="/notes/sub"]').click(); // expand
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');

  // Dirty the buffer (autosave-on-toggle is off by default).
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTY ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  // The tab mirrors it (SPEC36 unified the dirty marker: `folder-dirty`).
  await expect(page.getByTestId('folder-dirty')).toBeVisible();

  // Rename the open, dirty file: the stem is preselected.
  await page.locator('[data-path="/notes/sub/b.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  const input = page.getByTestId('folder-rename-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('b.md');
  await page.keyboard.type('renamed');
  await expect(input).toHaveValue('renamed.md');
  await page.keyboard.press('Enter');

  // Path, window title, tree selection, and recents all remap; the buffer,
  // dirty flag, and on-disk content are untouched.
  await expect(page.getByTestId('docname')).toContainText('renamed.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect.poll(() => page.title()).toContain('renamed.md •');
  await expect(page.locator('[data-path="/notes/sub/renamed.md"]')).toHaveClass(/selected/);
  await expect.poll(() => fsRead(page, '/notes/sub/renamed.md')).toBe('# B doc\n');
  expect(await fsRead(page, '/notes/sub/b.md')).toBeNull();
  await expect.poll(() => fsRead(page, '/config/recent.json')).toContain('/notes/sub/renamed.md');
  expect(await fsRead(page, '/config/recent.json')).not.toContain('/notes/sub/b.md');

  // The next ⌘S writes the new path; the old path stays gone.
  await page.keyboard.press('Control+s');
  await expect.poll(() => fsRead(page, '/notes/sub/renamed.md')).toContain('DIRTY');
  expect(await fsRead(page, '/notes/sub/b.md')).toBeNull();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  await expect(page.getByTestId('folder-dirty')).toHaveCount(0);

  // Rename the directory ABOVE the open file: docPath/expanded/selection
  // remap and foldertree.json reflects it.
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  await expect(input).toHaveValue('sub');
  await page.keyboard.type('stuff'); // directories select the whole name
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-path="/notes/stuff/renamed.md"]')).toBeVisible(); // still expanded
  await expect(page.locator('[data-path="/notes/stuff/renamed.md"]')).toHaveClass(/selected/);
  await expect(page.getByTestId('docname')).toContainText('renamed.md');
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).toContain('/notes/stuff');
  await expect.poll(() => fsRead(page, '/config/recent.json')).toContain('/notes/stuff/renamed.md');

  // Collision (case-insensitive, against live siblings) refuses to commit.
  await page.locator('[data-path="/notes/a.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  await input.fill('STUFF');
  await expect(input).toHaveClass(/invalid/);
  await page.keyboard.press('Enter'); // cancels instead of committing
  await expect(input).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/a.md"]')).toBeVisible();
  await expect.poll(() => fsRead(page, '/notes/a.md')).toBe('# A doc\n');

  // Windows-reserved names refuse with the reason in the tooltip; Esc restores.
  await page.locator('[data-path="/notes/a.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  await input.fill('con.md');
  await expect(input).toHaveClass(/invalid/);
  await expect(input).toHaveAttribute('title', /reserved/i);
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/a.md"]')).toBeVisible();
});

test('E99: delete — cancel no-op, dim file trashes, open dirty file to splash, expanded directory prunes', async ({
  page,
}) => {
  await seedFolders(page);
  await openFolderRoot(page);
  await page.getByTestId('folder-filter').click(); // show all files

  // Cancel is a no-op.
  await page.locator('[data-path="/notes/zzz.txt"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await expect(page.getByTestId('folder-delete-prompt')).toBeVisible();
  await expect(page.getByTestId('folder-delete-prompt')).toContainText('Move “zzz.txt” to the Trash?');
  await page.getByTestId('folder-delete-cancel').click();
  await expect(page.getByTestId('folder-delete-prompt')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/zzz.txt"]')).toBeVisible();
  expect(await page.evaluate(() => window.__mmTrash ?? [])).toEqual([]);

  // Esc is the same no-op.
  await page.locator('[data-path="/notes/zzz.txt"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-delete-prompt')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/zzz.txt"]')).toBeVisible();

  // Deleting a dim file removes its row and records on __mmTrash.
  await page.locator('[data-path="/notes/pic.png"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await page.getByTestId('folder-delete-confirm').click();
  await expect(page.locator('[data-path="/notes/pic.png"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__mmTrash)).toEqual(['/notes/pic.png']);

  // Deleting the open DIRTY file: the prompt says so; confirm lands on the
  // splash and prunes recents and the crash draft.
  await page.locator('[data-path="/notes/sub"]').click(); // expand
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTY ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect.poll(() => fsRead(page, '/config/draft.json'), { timeout: 20000 }).toContain('/notes/sub/b.md');
  await page.locator('[data-path="/notes/sub/b.md"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await expect(page.getByTestId('folder-delete-prompt')).toContainText('Move “b.md” to the Trash?');
  await expect(page.getByTestId('folder-delete-prompt')).toContainText('It has unsaved changes.');
  await page.getByTestId('folder-delete-confirm').click();
  // Issue #39: workspace still open — the folder-view hint, never the splash.
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect(page.locator('.folder-item.selected')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveCount(0);
  await expect.poll(() => fsRead(page, '/config/recent.json')).not.toContain('/notes/sub/b.md');
  await expect.poll(() => fsRead(page, '/config/draft.json')).toBeNull();
  expect(await page.evaluate(() => window.__mmTrash)).toEqual(['/notes/pic.png', '/notes/sub/b.md']);

  // Deleting an EXPANDED directory containing the open (clean) doc: all of
  // the above plus the expanded set prunes.
  await page.locator('[data-path="/notes/sub/deep"]').click(); // expand
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await page.locator('[data-path="/notes/sub"]').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await expect(page.getByTestId('folder-delete-prompt')).toContainText('Move “sub” and its contents to the Trash?');
  await expect(page.getByTestId('folder-delete-prompt')).not.toContainText('unsaved');
  await page.getByTestId('folder-delete-confirm').click();
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible(); // Issue #39
  await expect(page.locator('[data-path="/notes/sub"]')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveCount(0);
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).not.toContain('/notes/sub');
  await expect.poll(() => fsRead(page, '/config/recent.json')).not.toContain('c.md');
  expect(await page.evaluate(() => window.__mmTrash)).toEqual(['/notes/pic.png', '/notes/sub/b.md', '/notes/sub']);
});
