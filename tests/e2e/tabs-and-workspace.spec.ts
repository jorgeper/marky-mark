import { expect, test } from './fixtures';
import {
  dirtyActiveDoc,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  menuClick,
  openNotesRoot,
  seedFolders,
} from './helpers';

// Multiple open files as sidebar tabs, and the splash / file / workspace
// three-mode model.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E100: plain click opens IN ADDITION (issue #64) — clicks accumulate tabs, front/behind tab classes, no prompts, hover ✕', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  // freshApp left welcome.md open (outside the root, so no row shows it) —
  // close it so the tab counts below are exact.
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();

  // Plain click opens a — the one open file takes the front plane.
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/selected/);

  // Plain click on the NOT-open b opens it IN ADDITION: b takes the front
  // plane (selected), a stays in the set on the panel plane (open, not
  // selected) — nothing was replaced.
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/a.md"]')).not.toHaveClass(/selected/);

  // Dirty b, then plain-click the NOT-open c: NO prompt — b parks with its
  // ●, and three plain clicks have left three open tabs.
  await dirtyActiveDoc(page, 'TABDIRTY ');
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeVisible();

  // Plain click on the open row b just activates — still no prompt, and the
  // parked dirty buffer is intact (dirty dot + the typed text).
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.getByTestId('doc')).toContainText('TABDIRTY');

  // Mod+click on the ACTIVE row is a no-op (§3.1 unchanged).
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);

  // Every open row shows the ✕ on hover; the clean background a closes
  // through it and leaves the set — b stays active.
  await page.locator('[data-path="/notes/a.md"]').hover();
  await expect(page.locator('[data-path="/notes/a.md"] [data-testid="folder-tab-close"]')).toBeVisible();
  await page.locator('[data-path="/notes/a.md"] [data-testid="folder-tab-close"]').click();
  await expect(page.locator('[data-path="/notes/a.md"]')).not.toHaveClass(/\bopen\b/);
  await expect(page.getByTestId('docname')).toContainText('b.md');
});

test('E101: only-open-files mode — button/hotkey/View menu, flat tree-order list, # disabled, empty state, sync returns, persists', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  const openOnlyItem = () =>
    page.evaluate(() => {
      const view = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!;
      return view.items.find(
        (i) => i.type === 'command' && (i as { command?: string }).command === 'toggleOpenOnly'
      ) as { checked?: boolean };
    });

  // Nothing open: the header button still works (root set) — empty state,
  // # filter disabled, View checkbox on, accent class on.
  await page.getByTestId('folder-open-only').click();
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/filter-on/);
  await expect(page.getByTestId('folder-open-empty')).toBeVisible();
  await expect(page.getByTestId('folder-filter')).toBeDisabled();
  await expect.poll(async () => (await openOnlyItem()).checked).toBe(true);

  // The hotkey flips it back to the tree.
  await page.waitForTimeout(200); // SPEC12 §1.3 cross-source dedup window
  await page.keyboard.press('Control+Shift+O');
  await expect(page.getByTestId('folder-open-empty')).toHaveCount(0);
  await expect.poll(async () => (await openOnlyItem()).checked).toBe(false);

  // Open three files across depths, then enter the mode via the View menu.
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page).toHaveTitle(/c\.md/);
  await page.waitForTimeout(200);
  await menuClick(page, 'toggleOpenOnly');

  // Flat list in visible tree order — folders gone, no chevron rows, the
  // active file front, the others behind as pills.
  const names = () =>
    page.$$eval('[data-testid="folder-item"]', (els) => els.map((e) => e.getAttribute('data-path')));
  await expect.poll(names).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md']);
  await expect(page.locator('.folder-item-dir')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);

  // Sync returns to the tree with the active row revealed and selected.
  await page.getByTestId('folder-sync').click();
  await expect(page.getByTestId('folder-open-only')).not.toHaveClass(/filter-on/);
  await expect(page.locator('[data-path="/notes/sub"]')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);
  await expect(page.getByTestId('folder-filter')).toBeEnabled();

  // Mode + set survive a reload (openOnly rides foldertree.json).
  await page.waitForTimeout(200);
  await page.getByTestId('folder-open-only').click();
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/filter-on/);
  await page.reload();
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/filter-on/);
  await expect.poll(names).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md']);
  await expect(page).toHaveTitle(/c\.md/);
});

test('E102: Ctrl+Tab cycles in tree order with wrap, Ctrl+Shift+Tab reverses, edits survive, single file no-ops, edit-mode safe', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  // Plain clicks accumulate now (issue #64) — close freshApp's welcome doc
  // so the cycle below runs over exactly [c, b, a].
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // A single open file: cycling is a no-op.
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Open b and c — tree order is [c, b, a] (deepest directories first).
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('docname')).toContainText('c.md');

  // Forward from c → b.
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('b.md');

  // Dirty b in EDIT mode, cycle straight from the editor — no prompt, no
  // inserted tab character, lands on a.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('CYCLEDIRTY ');
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Wrap forward from the last entry back to c; reverse wraps back to a.
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('c.md');
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Reverse again to b: the mid-cycle edit is intact, dirty dot and all,
  // and no literal tab landed in the buffer.
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.getByTestId('doc')).toContainText('CYCLEDIRTY');
  expect(await page.evaluate(() => document.querySelector('[data-testid="doc"]')!.textContent)).not.toContain('\t');
});

test('E103: dirty lifecycle — free switching, ● markers, hover ✕, cancel/discard closes, neighbor activation, splash on last', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  // Plain clicks accumulate now (issue #64) — close freshApp's welcome doc
  // so the last-file close below really closes the last file.
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });

  // Dirty b (active), switch to a with no prompt, dirty a too.
  await dirtyActiveDoc(page, 'DIRTYB ');
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await dirtyActiveDoc(page, 'DIRTYA ');

  // Both rows carry the ● (active-dirty and parked-dirty alike).
  await expect(page.locator('[data-path="/notes/a.md"] [data-testid="folder-dirty"]')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeVisible();

  // Hover swaps ● for ✕ on that row.
  await page.locator('[data-path="/notes/sub/b.md"]').hover();
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-tab-close"]')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-dirty"]')).toBeHidden();

  // ✕ on the dirty background b: it activates first, then prompts; Cancel
  // keeps it open AND active.
  await page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-tab-close"]').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-cancel').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);

  // ✕ again, Don't Save: b closes, the tree-order neighbor a takes the
  // front with its own dirty buffer intact.
  await page.locator('[data-path="/notes/sub/b.md"]').hover();
  await page.locator('[data-path="/notes/sub/b.md"] [data-testid="folder-tab-close"]').click();
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).not.toHaveClass(/\bopen\b/);
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await expect(page.getByTestId('doc')).toContainText('DIRTYA');

  // A clean background file closes silently: open c, return to a, ✕ c.
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').hover();
  await page.locator('[data-path="/notes/sub/deep/c.md"] [data-testid="folder-tab-close"]').click();
  await expect(page.getByTestId('open-prompt')).toHaveCount(0);
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).not.toHaveClass(/\bopen\b/);
  await expect(page.getByTestId('docname')).toContainText('a.md');

  // Closing the LAST open file (dirty ⇒ prompt) lands on the workspace
  // empty hint — never the splash while a workspace is open (Issue #39) —
  // with the selection cleared.
  await page.locator('[data-path="/notes/a.md"]').hover();
  await page.locator('[data-path="/notes/a.md"] [data-testid="folder-tab-close"]').click();
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect(page.locator('.folder-item.selected')).toHaveCount(0);
});

test('E104: quit walks every dirty file in order (save/cancel paths), restore survives relaunch, the setting gates it', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  // Open a then b, dirty BOTH (a parks dirty behind b).
  await page.locator('[data-path="/notes/a.md"]').click();
  await menuClick(page, 'toggleMode');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('QUITA ');
  await menuClick(page, 'toggleMode');
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click({ modifiers: ['ControlOrMeta'] });
  await menuClick(page, 'toggleMode');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('QUITB ');
  await menuClick(page, 'toggleMode');
  await expect(page).toHaveTitle(/b\.md •/);

  // Quit: the walk starts at the tree-order first dirty file — b — which is
  // already active. Cancel aborts the WHOLE quit; both stay open and dirty.
  await menuClick(page, 'close');
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  await expect(page.getByTestId('close-prompt')).toContainText('b.md');
  await page.getByTestId('close-cancel').click();
  await expect(page.getByTestId('close-prompt')).toHaveCount(0);
  await expect(page).toHaveTitle(/b\.md •/);
  await expect(page.locator('[data-path="/notes/a.md"] [data-testid="folder-dirty"]')).toBeVisible();

  // Quit again: Save writes b to disk, then the walk activates a (visible
  // behind its own prompt); Cancel there still aborts with a intact.
  await menuClick(page, 'close');
  await expect(page.getByTestId('close-prompt')).toContainText('b.md');
  await page.getByTestId('close-save').click();
  await expect.poll(() => fsRead(page, '/notes/sub/b.md')).toContain('QUITB');
  await expect(page.getByTestId('close-prompt')).toContainText('a.md');
  await expect(page).toHaveTitle(/a\.md •/);
  await page.getByTestId('close-cancel').click();
  await expect(page.getByTestId('close-prompt')).toHaveCount(0);
  await expect(page).toHaveTitle(/a\.md •/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/\bopen\b/);

  // Clean up a, add c to the set, then delete c on disk: the restore drops
  // the vanished path and falls back to the first survivor as active.
  await menuClick(page, 'save');
  await expect(page).toHaveTitle(/a\.md — /);
  await page.locator('[data-path="/notes/sub/deep"]').click();
  await page.locator('[data-path="/notes/sub/deep/c.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page).toHaveTitle(/c\.md/);
  await page.evaluate(() => window.__mmfs!.remove('/notes/sub/deep/c.md'));
  await page.reload();
  await expect(page).toHaveTitle(/b\.md/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);

  // Setting off: boot ignores the set (single reopen-last-doc behavior) but
  // foldertree.json KEEPS it — flipping back on revives both tabs.
  await page.evaluate(() => {
    const s = JSON.parse(window.__mmfs!.read('/config/settings.json') ?? '{}');
    s.restoreOpenFiles = false;
    window.__mmfs!.write('/config/settings.json', JSON.stringify(s));
  });
  await page.reload();
  await expect(page).toHaveTitle(/b\.md/);
  await expect(page.locator('[data-path="/notes/a.md"]')).not.toHaveClass(/\bopen\b/);
  await expect.poll(() => fsRead(page, '/config/foldertree.json')).toContain('/notes/a.md');
  await page.evaluate(() => {
    const s = JSON.parse(window.__mmfs!.read('/config/settings.json') ?? '{}');
    s.restoreOpenFiles = true;
    window.__mmfs!.write('/config/settings.json', JSON.stringify(s));
  });
  await page.reload();
  await expect(page).toHaveTitle(/b\.md/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);
});

test('E131: three-mode model — per-mode menu gating, Close File → splash, Close Workspace guards, changed-workspace prompt', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);

  /** The disabled flag the shim recorded for a command item (undefined = enabled). */
  const disabledOf = (command: string) =>
    page.evaluate((c) => {
      const it = window
        .__mmMenu!.spec!.submenus.flatMap((m) => m.items)
        .find((i) => i.type === 'command' && (i as { command?: string }).command === c) as
        | { disabled?: boolean }
        | undefined;
      if (!it) throw new Error(`no item: ${c}`);
      return it.disabled === true;
    }, command);
  const gatingIs = async (wsDisabled: boolean, closeFileDisabled: boolean) => {
    for (const c of ['addFolderToWorkspace', 'saveWorkspaceAs', 'closeWorkspace', 'toggleFolders', 'toggleOpenOnly']) {
      await expect.poll(() => disabledOf(c), { message: c }).toBe(wsDisabled);
    }
    await expect.poll(() => disabledOf('closeFile')).toBe(closeFileDisabled);
    for (const c of ['open', 'openFolder', 'openWorkspace']) {
      await expect.poll(() => disabledOf(c), { message: c }).toBe(false);
    }
  };
  /** Build a CHANGED untitled workspace: /notes root plus /other (2+ folders). */
  const openChangedWorkspace = async () => {
    await page.evaluate(() => {
      window.__mmfs!.nextFolderPath = '/notes';
    });
    await menuClick(page, 'openFolder');
    await expect(page.getByTestId('folder-header')).toContainText('notes');
    await expect.poll(() => disabledOf('addFolderToWorkspace')).toBe(false); // menu reinstalled for workspace mode
    await page.evaluate(() => {
      window.__mmfs!.nextFolderPath = '/other';
    });
    await menuClick(page, 'addFolderToWorkspace');
    await expect(page.locator('[data-path="/other"]')).toBeVisible();
  };

  // SPLASH: workspace-only and folder-view items grayed, Close File too.
  await gatingIs(true, true);

  // FILE mode: Help opens welcome — Close File enables, workspace items stay gray.
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await gatingIs(true, false);

  // Close File routes through the dirty guard: Cancel keeps the file open…
  await menuClick(page, 'toggleMode');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTY ');
  await menuClick(page, 'toggleMode'); // back to preview (house pattern: no pending editor flush)
  await expect(page.getByTestId('doc').locator('h1')).toContainText('DIRTY');
  await menuClick(page, 'closeFile');
  await expect(page.getByTestId('open-prompt')).toBeVisible();
  await page.getByTestId('open-cancel').click();
  await expect(page).toHaveTitle(/welcome\.md/);
  // …Don't Save closes the buffer down to the splash.
  await menuClick(page, 'closeFile');
  await page.getByTestId('open-discard').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await gatingIs(true, true);

  // WORKSPACE mode: Open Folder… — panel appears, workspace items enable.
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-header')).toContainText('notes');
  await gatingIs(false, true);

  // Close Workspace runs the open document's dirty guard first; Cancel aborts.
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page).toHaveTitle(/a\.md/);
  await menuClick(page, 'toggleMode');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('WSDIRTY ');
  await menuClick(page, 'toggleMode'); // back to preview (house pattern: no pending editor flush)
  await expect(page.getByTestId('doc').locator('h1')).toContainText('WSDIRTY');
  await menuClick(page, 'closeWorkspace');
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  await page.getByTestId('close-cancel').click();
  await expect(page).toHaveTitle(/a\.md/);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  // Don't Save: the document closes WITH the workspace — splash, no panel.
  await menuClick(page, 'closeWorkspace');
  await page.getByTestId('close-discard').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await gatingIs(true, true);

  // A CHANGED untitled workspace (2+ folders) prompts on Close Workspace.
  await openChangedWorkspace();
  await menuClick(page, 'closeWorkspace');
  await expect(page.getByTestId('ws-close-prompt')).toBeVisible();
  await page.getByTestId('ws-close-cancel').click(); // Cancel aborts — workspace stays
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await menuClick(page, 'closeWorkspace');
  await page.getByTestId('ws-close-discard').click(); // Don't Save proceeds
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);

  // Save in the prompt runs Save Workspace As…, then the close proceeds.
  await openChangedWorkspace();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/w/mine.marky-workspace';
  });
  await menuClick(page, 'closeWorkspace');
  await page.getByTestId('ws-close-save').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect.poll(() => fsRead(page, '/w/mine.marky-workspace')).toContain('"folders"');

  // Open Folder… over a changed workspace = close-then-open: prompt first,
  // then the pick becomes a fresh single-folder untitled workspace.
  await openChangedWorkspace();
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/other';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('ws-close-prompt')).toBeVisible();
  await page.getByTestId('ws-close-discard').click();
  await expect(page.getByTestId('folder-header')).toContainText('other');
  await expect(page.locator('[data-path="/notes"]')).toHaveCount(0);
});

test('E157: workspace open with no document — the folder-view hint replaces the splash; the splash returns once the workspace closes (#39)', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  // Plain clicks accumulate now (issue #64) — close freshApp's welcome doc
  // so closing a.md below empties the open set.
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();

  // Close File on the open (clean) doc: the workspace stays, so the empty
  // preview is the pick-a-file hint — never the splash (Issue #39).
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  const wsHint = page.getByTestId('workspace-empty-hint');
  await expect(wsHint).toBeVisible();
  await expect(wsHint).toContainText('Select a file in the folder view to open it');
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect(page.getByTestId('folder-panel')).toBeVisible();

  // Close Workspace: nothing open at all — the true splash returns.
  await page.evaluate(() => window.__mmDispatch!('closeWorkspace'));
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('splash-mark')).toBeVisible();
  await expect(wsHint).toHaveCount(0);
});
