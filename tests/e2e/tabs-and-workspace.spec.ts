import { expect, test } from './fixtures';
import {
  dirtyActiveDoc,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  openNotesRoot,
  openSettings,
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
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/(^|\s)on(\s|$)/);
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
  await expect(page.getByTestId('folder-open-only')).not.toHaveClass(/(^|\s)on(\s|$)/);
  await expect(page.locator('[data-path="/notes/sub"]')).toBeVisible();
  await expect(page.locator('[data-path="/notes/sub/deep/c.md"]')).toHaveClass(/selected/);
  await expect(page.getByTestId('folder-filter')).toBeEnabled();

  // Mode + set live in the workspace session (issue #81): a relaunch lands
  // on the splash; reopening the folder revives openOnly, the open set, and
  // the active file.
  await page.waitForTimeout(200);
  await page.getByTestId('folder-open-only').click();
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/(^|\s)on(\s|$)/);
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__mmMenu)).toBe(true);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-open-only')).toHaveClass(/(^|\s)on(\s|$)/);
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
  // Issue #125: the cycle lands b in the remembered edit mode — step back to
  // the preview this block reads the buffer from.
  await page.keyboard.press('Control+e');
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

test('E104: quit walks every dirty file in order (save/cancel paths); a relaunch lands on the splash (#81)', async ({
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

  // Clean up a, then relaunch: issue #81 — the boot never restores. Splash,
  // no workspace, nothing open, whatever was open at quit; the session
  // store still remembers the set for an explicit reopen (E169).
  await menuClick(page, 'save');
  await expect(page).toHaveTitle(/a\.md — /);
  await expect.poll(() => fsRead(page, '/config/session/untitled.json')).toContain('/notes/a.md');
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.locator('[data-testid="folder-item"]')).toHaveCount(0);
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

test('E169: issue #81 — a workspace remembers its open files: Close Workspace → reopen revives them (and across a restart), pruning vanished paths', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  // Open a then b (additive clicks); b is active.
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page).toHaveTitle(/b\.md/);

  // The open set lands in the untitled slot automatically — no setting
  // gates the write-through.
  await expect.poll(() => fsRead(page, '/config/session/untitled.json')).toContain('/notes/sub/b.md');

  // Close Workspace → splash. Reopening the same folder revives the session:
  // both files show as open, the active file is back on screen.
  await menuClick(page, 'closeWorkspace');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);
  await expect(page).toHaveTitle(/b\.md/);

  // The same revival works across an app restart.
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__mmMenu)).toBe(true);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);
  await expect(page).toHaveTitle(/b\.md/);

  // Existing-files-only pruning: b vanishes on disk; the reopen drops it and
  // falls back to the first survivor as active.
  await menuClick(page, 'closeWorkspace');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.evaluate(() => window.__mmfs!.remove('/notes/sub/b.md'));
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/selected/);
  await expect(page).toHaveTitle(/a\.md/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveCount(0);
});

test('E170: issue #81 — relaunch with a named workspace and files open lands on the splash; Open Workspace… brings the session back', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-header')).toContainText('notes');
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page).toHaveTitle(/b\.md/);

  // Name the workspace; its session store keeps the open set.
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/w/mine.marky-workspace';
  });
  await menuClick(page, 'saveWorkspaceAs');
  await expect.poll(() => fsRead(page, '/w/mine.marky-workspace')).toContain('"folders"');

  // Relaunch: splash — no workspace, no open files, regardless of what was
  // open at quit (Bug 2).
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.locator('[data-testid="folder-item"]')).toHaveCount(0);

  // Open Workspace… explicitly: tabs and the active file return (Bug 1).
  await expect.poll(() => page.evaluate(() => !!window.__mmMenu)).toBe(true);
  await page.evaluate(() => {
    window.__mmfs!.nextWorkspacePath = '/w/mine.marky-workspace';
  });
  await menuClick(page, 'openWorkspace');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/sub/b.md"]')).toHaveClass(/selected/);
  await expect(page).toHaveTitle(/b\.md/);
});

test('E171: an OS-opened .marky-workspace path opens the workspace, not a text document (issue #82)', async ({
  page,
}) => {
  await seedFolders(page);
  await fsWrite(page, '/w/team.marky-workspace', JSON.stringify({ version: 1, folders: ['/notes'], settings: {} }));
  // Issue #82: the shim's #open= deep link drives the same onOpenFile seam
  // that OS file associations (double-click in Finder) deliver paths to.
  await page.goto('/#open=/w/team.marky-workspace');
  // The workspace opens: its member folder becomes the sidebar root…
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('folder-header')).toContainText('notes');
  await expect(page.locator('[data-path="/notes/a.md"]')).toBeVisible();
  // …and no text tab opened for the workspace file itself — the document on
  // screen is still freshApp's welcome.md, not the workspace JSON.
  await expect(page).toHaveTitle(/welcome\.md/);
  await expect(page.getByTestId('docname')).not.toContainText('team.marky-workspace');
});

// Issue #84: the reassignability half of the cycle — Settings records the
// combo actually pressed, a rebind takes effect with no restart, and one row
// restores on its own.
test('E177: issue #84 — rebinding nextFile in Settings cycles on the new combo, Ctrl+Tab stops, the per-row restore brings it back alone', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  // freshApp left welcome.md open — close it so the cycle runs over [b, a].
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('workspace-empty-hint')).toBeVisible();
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('b.md');

  // The shipped defaults are on display, live from the map.
  await openSettings(page, 'hotkeys');
  const next = page.getByTestId('hotkey-nextFile');
  const prev = page.getByTestId('hotkey-prevFile');
  await expect(next).toHaveValue(/(⌃Tab|Ctrl\+Tab)/);
  await expect(prev).toHaveValue(/(⌃⇧Tab|Ctrl\+Shift\+Tab)/);
  // A row sitting at its default has nothing to restore.
  await expect(page.getByTestId('reset-hotkey-nextFile')).toBeDisabled();

  // A combo already bound elsewhere is refused, map untouched.
  await next.click();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('hotkey-hint')).toContainText('already bound');
  await expect(next).toHaveValue(/(⌃Tab|Ctrl\+Tab)/);

  // Rebind both rows; the recorders show what was pressed.
  await next.click();
  await page.keyboard.press('Control+F7');
  await expect(next).toHaveValue(/F7/);
  await prev.click();
  await page.keyboard.press('Control+F8');
  await expect(prev).toHaveValue(/F8/);
  await page.getByTestId('settings-close').click();

  // The new combos cycle immediately — no restart — and the old ones do not.
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('b.md');
  await page.keyboard.press('Control+F7');
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await page.keyboard.press('Control+F8');
  await expect(page.getByTestId('docname')).toContainText('b.md');

  // The rebinding persisted through the User-scope settings layer.
  await expect
    .poll(async () => JSON.parse(await fsRead(page, '/config/settings.json')).hotkeys.nextFile)
    .toBe('Mod+F7');

  // Restore just the nextFile row: Ctrl+Tab cycles again and prevFile keeps
  // its custom combo — the rest of the map is untouched.
  await openSettings(page, 'hotkeys');
  await page.getByTestId('reset-hotkey-nextFile').click();
  await expect(next).toHaveValue(/(⌃Tab|Ctrl\+Tab)/);
  await expect(prev).toHaveValue(/F8/);
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await page.keyboard.press('Control+F7');
  await expect(page.getByTestId('docname')).toContainText('a.md');
});

// Issue #84: the cycle is discoverable from View, carrying its live keys.
test('E178: issue #84 — View → Next/Previous Open File dispatch the cycle, follow a rebinding, and gray out under two open files', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  const viewItem = (command: string) =>
    page.evaluate((c) => {
      const view = window.__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!;
      return view.items.find(
        (i) => i.type === 'command' && (i as { command?: string }).command === c
      ) as { label: string; accelerator?: string; disabled?: boolean };
    }, command);

  // One open file: present, labelled, but grayed — cycling would be a no-op.
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page).toHaveTitle(/a\.md/);
  await expect.poll(async () => (await viewItem('nextFile')).label).toBe('Next Open File');
  await expect.poll(async () => (await viewItem('prevFile')).label).toBe('Previous Open File');
  await expect.poll(async () => (await viewItem('nextFile')).disabled).toBe(true);
  await expect.poll(async () => (await viewItem('nextFile')).accelerator).toBe('Ctrl+Tab');
  await expect.poll(async () => (await viewItem('prevFile')).accelerator).toBe('Ctrl+Shift+Tab');

  // A second open file enables them, and they cycle the open set.
  await page.locator('[data-path="/notes/sub"]').click();
  await page.locator('[data-path="/notes/sub/b.md"]').click();
  await expect(page).toHaveTitle(/b\.md/);
  await expect.poll(async () => (await viewItem('nextFile')).disabled).toBeUndefined();
  await menuClick(page, 'nextFile');
  await expect(page).toHaveTitle(/a\.md/);
  await menuClick(page, 'prevFile');
  await expect(page).toHaveTitle(/b\.md/);

  // The accelerators follow a rebinding — recorded in the settings window
  // (SPEC13 §1.5: desktop Settings is a popup, not the in-app modal).
  const popupPromise = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popupPromise;
  await sp.getByTestId('settings-panel').waitFor();
  await sp.getByTestId('settings-tab-hotkeys').click();
  await sp.getByTestId('hotkey-nextFile').click();
  await sp.keyboard.press('Control+F7');
  await expect.poll(async () => (await viewItem('nextFile')).accelerator).toBe('Mod+F7');

  // …and the per-row restore puts Ctrl+Tab back on the menu item alone.
  await sp.getByTestId('reset-hotkey-nextFile').click();
  await expect.poll(async () => (await viewItem('nextFile')).accelerator).toBe('Ctrl+Tab');
});

// Issue #83: a document long enough to have a scroll position worth
// remembering, in the /notes root so it shows in the folder pane.
const LONG_DOC =
  Array.from({ length: 40 }, (_, i) => `## Marker ${i + 1}\n\n` + `Paragraph for section ${i + 1}. `.repeat(8)).join(
    '\n\n'
  ) + '\n';

test('E175: issue #83 — scroll position survives a background-tab switch and return, and a close-tab → reopen from the folder pane', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);
  await fsWrite(page, '/notes/long.md', LONG_DOC);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-header')).toContainText('notes');

  // Open a.md, then long.md: the active row is `selected`, the background
  // one `open` — both visibly marked in the pane (SPEC36 §3).
  await page.locator('[data-path="/notes/a.md"]').click();
  await page.locator('[data-path="/notes/long.md"]').click();
  await expect(page).toHaveTitle(/long\.md/);
  await expect(page.getByTestId('doc').locator('h2').first()).toContainText('Marker 1');
  await expect(page.locator('[data-path="/notes/long.md"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-path="/notes/a.md"]')).toHaveClass(/\bopen\b/);

  const ws = page.locator('.workspace');
  await ws.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.4));
  const savedScroll = await ws.evaluate((el) => el.scrollTop);
  expect(savedScroll).toBeGreaterThan(0);

  // (a) Switch to the background tab and back: the switch itself records the
  // outgoing position (SPEC16 §3.2) — no debounce wait — and the return
  // restores it.
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page).toHaveTitle(/a\.md/);
  await expect(page.locator('[data-path="/notes/long.md"]')).toHaveClass(/\bopen\b/);
  await page.locator('[data-path="/notes/long.md"]').click();
  await expect(page).toHaveTitle(/long\.md/);
  await expect.poll(() => ws.evaluate((el) => el.scrollTop)).toBeGreaterThan(savedScroll * 0.8);
  expect(await ws.evaluate((el) => el.scrollTop)).toBeLessThan(savedScroll * 1.2);

  // (b) Close the tab — its open marking clears (SPEC36 §3.5), the neighbor
  // activates — then reopen from the pane: back at the remembered position.
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page).toHaveTitle(/a\.md/);
  await expect(page.locator('[data-path="/notes/long.md"]')).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('[data-path="/notes/long.md"]')).not.toHaveClass(/selected/);
  await page.locator('[data-path="/notes/long.md"]').click();
  await expect(page).toHaveTitle(/long\.md/);
  await expect.poll(() => ws.evaluate((el) => el.scrollTop)).toBeGreaterThan(savedScroll * 0.8);
  expect(await ws.evaluate((el) => el.scrollTop)).toBeLessThan(savedScroll * 1.2);
});

test('E176: issue #83 — scroll position survives Close Workspace → reopen, and a relaunch + explicit reopen, for the session-restored active file', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await seedFolders(page);
  await fsWrite(page, '/notes/long.md', LONG_DOC);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page.getByTestId('folder-header')).toContainText('notes');
  await page.locator('[data-path="/notes/long.md"]').click();
  await expect(page.getByTestId('doc').locator('h2').first()).toContainText('Marker 1');

  const ws = page.locator('.workspace');
  await ws.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.4));
  const savedScroll = await ws.evaluate((el) => el.scrollTop);
  expect(savedScroll).toBeGreaterThan(0);

  // Close Workspace with no debounce wait: the close itself must record the
  // active doc's position (SPEC16 §3.2 at closeToSplash, issue #83).
  await menuClick(page, 'closeWorkspace');
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  // Reopening the same folder revives the untitled session (issue #81):
  // long.md is active again AND back at the remembered scroll position.
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page).toHaveTitle(/long\.md/);
  await expect(page.locator('[data-path="/notes/long.md"]')).toHaveClass(/selected/);
  await expect.poll(() => ws.evaluate((el) => el.scrollTop)).toBeGreaterThan(savedScroll * 0.8);
  expect(await ws.evaluate((el) => el.scrollTop)).toBeLessThan(savedScroll * 1.2);

  // Relaunch: the splash (launch never auto-opens anything), then an
  // explicit reopen restores the session file to the same position —
  // positions.json carried it across the restart (SPEC16 §3).
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__mmMenu)).toBe(true);
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await menuClick(page, 'openFolder');
  await expect(page).toHaveTitle(/long\.md/);
  await expect.poll(() => page.locator('.workspace').evaluate((el) => el.scrollTop)).toBeGreaterThan(savedScroll * 0.8);
  expect(await page.locator('.workspace').evaluate((el) => el.scrollTop)).toBeLessThan(savedScroll * 1.2);
});

test('E199: the shim start page offers all five entry actions, and Open Folder… / Open Workspace… on it really open one', async ({
  page,
}) => {
  // PRD 007 Req 22: desktop/shim can honour every row, so the splash shows
  // the drop hint plus four buttons — the same list the File menu carries.
  await seedFolders(page);
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('start-drop')).toBeVisible();
  for (const id of ['openFile', 'openFolder', 'newWorkspace', 'openWorkspace']) {
    await expect(page.getByTestId(`start-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('start-actions').getByRole('button')).toHaveCount(4);

  // Open Folder… from the start page opens the folder as the sidebar root.
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('start-openFolder').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.locator('[data-path="/notes/a.md"]')).toBeVisible();

  // …and Open Workspace… from the start page opens a .marky-workspace file.
  await fsWrite(page, '/w/e199.marky-workspace', JSON.stringify({ version: 1, folders: ['/notes'], settings: {} }));
  await page.evaluate(() => window.__mmDispatch!('closeWorkspace'));
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextWorkspacePath = '/w/e199.marky-workspace';
  });
  await page.getByTestId('start-openWorkspace').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.locator('[data-path="/notes/a.md"]')).toBeVisible();
});

test('E200: local New Workspace… writes the .marky-workspace file and lands in the named, root-less workspace', async ({
  page,
}) => {
  // PRD 007 Req 22: the local "new workspace" flow that did not exist before.
  await seedFolders(page);
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/w/fresh.marky-workspace';
  });
  await page.getByTestId('start-newWorkspace').click();

  // The file exists on disk as valid PRD 002 workspace JSON…
  await expect.poll(() => fsRead(page, '/w/fresh.marky-workspace')).toContain('"folders"');
  expect(JSON.parse((await fsRead(page, '/w/fresh.marky-workspace'))!)).toMatchObject({ folders: [] });
  // …and the app is in workspace mode, bound to it, with no roots yet plus
  // the way to add one (the splash is gone — this is a workspace now).
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('folder-add-btn')).toBeVisible();
  await page.evaluate(() => {
    window.__mmfs!.nextFolderPath = '/notes';
  });
  await page.getByTestId('folder-add-btn').click();
  await expect(page.locator('[data-path="/notes/a.md"]')).toBeVisible();
  // The folder joined THIS workspace — the named file grew, nothing replaced it.
  await expect.poll(() => fsRead(page, '/w/fresh.marky-workspace')).toContain('/notes');
});

// PRD 009 Req 3/4/5 (#90): the exclusive two-mode model on the non-desktop
// flavors. The e2e shim is one of them (Req 1 names hosted, static web and the
// browser shim), so the crossing actions are driven here through the command
// seam every menu item dispatches into.

test('E210: a local file opened with a workspace open closes the workspace first and lands in single-file mode; Cancel aborts the switch', async ({
  page,
}) => {
  await seedFolders(page);
  await openNotesRoot(page);
  // freshApp left welcome.md open (outside the root) — drop it so the
  // workspace's dirty walk below is exactly the file this test dirtied.
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await page.locator('[data-path="/notes/a.md"]').click();
  await dirtyActiveDoc(page, 'CROSSING ');

  // PRD 009 Req 4: Open File… runs the workspace's dirty prompts FIRST…
  page.once('dialog', (d) => void d.accept('/docs/welcome.md'));
  await page.evaluate(() => window.__mmDispatch!('open'));
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  // …and Cancel aborts the WHOLE switch: the workspace is still open, the
  // dirty buffer is untouched, and nothing new was opened.
  await page.getByTestId('close-cancel').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Don't save: the workspace closes and the picked file opens in single-file
  // mode — the initial page is never the resting state of the switch.
  page.once('dialog', (d) => void d.accept('/docs/welcome.md'));
  await page.evaluate(() => window.__mmDispatch!('open'));
  await page.getByTestId('close-discard').click();
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
  // PRD 009 Req 2: no folder sidebar (nor its collapsed reveal seam) in
  // single-file mode, whatever the flavor can browse.
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('folder-expand')).toHaveCount(0);

  // PRD 009 Req 2: "single file" means "no workspace", not "one document" —
  // a second file joins the open set and Ctrl+Tab still cycles both.
  page.once('dialog', (d) => void d.accept('/notes/a.md'));
  await page.evaluate(() => window.__mmDispatch!('open'));
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('docname')).toContainText('welcome.md');

  // PRD 009 Req 3: closing the files one by one ends on the initial page.
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await page.evaluate(() => window.__mmDispatch!('closeFile'));
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('start-drop')).toBeVisible();
});

test('E211: Open Workspace… in single-file mode closes the open file first, then enters workspace mode; Cancel aborts the switch', async ({
  page,
}) => {
  await seedFolders(page);
  await fsWrite(page, '/w/e211.marky-workspace', JSON.stringify({ version: 1, folders: ['/notes'], settings: {} }));
  // freshApp leaves welcome.md open: single-file mode, with unsaved work.
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
  await dirtyActiveDoc(page, 'STAYS ');

  // PRD 009 Req 4: the crossing runs the open file's dirty prompt first…
  await page.evaluate(() => {
    window.__mmfs!.nextWorkspacePath = '/w/e211.marky-workspace';
    window.__mmDispatch!('openWorkspace');
  });
  await expect(page.getByTestId('close-prompt')).toBeVisible();
  // …and Cancel leaves single-file mode exactly as it was.
  await page.getByTestId('close-cancel').click();
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Don't save: the file closes and workspace mode opens directly.
  await page.evaluate(() => {
    window.__mmfs!.nextWorkspacePath = '/w/e211.marky-workspace';
    window.__mmDispatch!('openWorkspace');
  });
  await page.getByTestId('close-discard').click();
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect(page.locator('[data-path="/notes/a.md"]')).toBeVisible();
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
});

test('E406: the copy-link share controls are hosted-only — the dev-shim workspace with a saved file open renders neither placement', async ({
  page,
}) => {
  // PRD 020 Req 15 (issue #222): the shim (`kind: 'browser'`) stands in for
  // every non-hosted flavor here — the placements gate on the hosted
  // platform alone, so a workspace + open saved file, the exact state that
  // shows both controls on hosted, produces zero share DOM.
  await seedFolders(page);
  await openNotesRoot(page);
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.getByTestId('copy-link-workspace')).toHaveCount(0);
  await expect(page.getByTestId('copy-link-file')).toHaveCount(0);
});

test('E413: the heading copy-link placements are hosted-only — dev-shim preview headings grow no button and a heading-line cursor grows no gutter', async ({
  page,
}) => {
  // PRD 020 Req 15 (issue #223): same gate as E406's share controls, for the
  // Req 18 heading placements — the shim stands in for every non-hosted
  // flavor, in the exact states (rendered heading; cursor resting on a
  // heading line) that show the controls on hosted.
  await seedFolders(page);
  await openNotesRoot(page);
  await page.locator('[data-path="/notes/a.md"]').click();
  await expect(page.getByTestId('docname')).toContainText('a.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('A doc');
  await expect(page.getByTestId('mm-heading-link')).toHaveCount(0);
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await expect(page.getByTestId('heading-copy-link-gutter')).toHaveCount(0);
  await expect(page.locator('.cm-heading-link-gutter')).toHaveCount(0);
});
