import { expect, test } from './fixtures';
import {
  addComment,
  clickClearOfToolbar,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  menuItem,
  menuSave,
  NAV_P1,
  NAV_P2,
  NAV_P3,
  openFolderRoot,
  openPath,
  openSettings,
  openWelcomeViaHelp,
  PHRASE,
  seedFolders,
  selectPhrase,
  selectPhraseInPane,
  selectSpan,
  stableBox,
  waitForSidecar,
  WELCOME,
  WELCOME_SIDECAR,
} from './helpers';

// Comments: authoring, threads, persistence, anchoring, embedded trailers,
// navigation, the split-pane host, and stores this build cannot interpret.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

// The document, and a trailer declaring a MAJOR this build must not touch.
// Written out by hand: these exact bytes are what a save has to re-emit.
const NEWER_DOC = '# Newer document\n\nThis paragraph reads perfectly well even though its comments do not.\n';
const NEWER_TRAILER = `
<!-- marky-mark-comments
{
  "version": "2.0.0",
  "comments": [
    {
      "id": "from-the-future",
      "author": "Someone Later",
      "createdAt": "2027-01-01T00:00:00.000Z",
      "body": "A thread this build has no idea how to render",
      "resolved": false,
      "thread": [],
      "anchor": { "exact": "paragraph", "prefix": "", "suffix": "", "start": 7, "end": 16 },
      "stickers": [{ "kind": "unknown-to-us" }]
    }
  ],
  "futureSection": { "shape": "unknown" }
}
-->
`;
const NEWER_PATH = '/docs/from-the-future.md';

test('E7: select text → Add comment → highlight in DOM and card in panel with the body text', async ({ page }) => {
  await selectPhrase(page, PHRASE);
  await expect(page.getByTestId('marker-popup')).toBeVisible();
  await page.getByTestId('add-note-btn').click();
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.getByTestId('composer-input').fill('First note');
  await page.getByTestId('composer-submit').click();

  const mark = page.locator('mark.hl');
  await expect(mark.first()).toBeVisible();
  await expect(mark.first()).toContainText('saved to a sidecar file');
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('First note');
});

test('E8: comments, highlights, and thread state persist across reload via the sidecar', async ({ page }) => {
  await addComment(page, PHRASE, 'Persistent note');
  await waitForSidecar(page, (s) => !!s && s.includes('Persistent note'));

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('Persistent note');
  await expect(page.locator('mark.hl').first()).toBeVisible();

  const sidecar = await fsRead(page, WELCOME_SIDECAR);
  expect(sidecar).toContain('"exact"');
  expect(sidecar).toContain('"prefix"');
  expect(sidecar).toContain('"suffix"');
});

test('E9: reply, edit reply, resolve (highlight gone, card in Resolved), reopen (highlight returns)', async ({
  page,
}) => {
  // SPEC7 §4 flipped the showResolved default to true; this test exercises
  // the collapsed-section behavior, so turn it off explicitly (assertions
  // below are unchanged from SPEC2).
  await openSettings(page, 'general');
  await page.getByTestId('show-resolved').uncheck();
  await page.getByTestId('settings-close').click();

  await addComment(page, PHRASE, 'Root comment');

  await page.getByTestId('reply-btn').click();
  await page.getByTestId('reply-input').fill('A reply');
  await page.getByTestId('submit-reply').click();
  await expect(page.getByTestId('thread-entry')).toHaveCount(2);
  await expect(page.getByTestId('reply-body')).toHaveText('A reply');

  await page.getByTestId('edit-reply').click();
  await page.getByTestId('edit-input').fill('An edited reply');
  await page.getByTestId('save-edit').click();
  await expect(page.getByTestId('reply-body')).toHaveText('An edited reply');

  await page.getByTestId('resolve-btn').click();
  await expect(page.locator('mark.hl')).toHaveCount(0);
  const resolvedSection = page.getByTestId('resolved-section');
  await expect(resolvedSection).toContainText('Resolved (1)');
  await resolvedSection.locator('summary').click();
  await expect(resolvedSection.getByTestId('comment-card')).toHaveCount(1);

  await resolvedSection.getByTestId('reopen-btn').click();
  await expect(page.locator('mark.hl').first()).toBeVisible();
});

test('E10: a comment spanning two blocks highlights in both; deleting it (confirmed) removes card and sidecar entry', async ({
  page,
}) => {
  // From inside the "Reading" paragraph into the blockquote further down.
  await selectSpan(page, 'GitHub-flavored markdown', 'A task list');
  await page.getByTestId('add-note-btn').click();
  await page.getByTestId('composer-input').fill('Spanning comment');
  await page.getByTestId('composer-submit').click();

  const markCount = await page.locator('mark.hl').count();
  expect(markCount).toBeGreaterThanOrEqual(2);
  await waitForSidecar(page, (s) => !!s && s.includes('Spanning comment'));

  await page.getByTestId('delete-btn').click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);
  // Last comment deleted → the sidecar file itself is removed.
  await waitForSidecar(page, (s) => s === null);
});

test('E11: edit-survival — inserting a paragraph near the top re-anchors the comment to the same text', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'Survivor');
  await waitForSidecar(page, (s) => !!s && s.includes('Survivor'));

  const md = (await fsRead(page, WELCOME))!;
  const edited = md.replace(
    '## Reading',
    'A freshly inserted paragraph that shifts every offset in this document by a good amount.\n\n## Reading'
  );
  expect(edited).not.toBe(md);
  await fsWrite(page, WELCOME, edited);

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  const highlighted = await page.locator('mark.hl').allTextContents();
  expect(highlighted.join('')).toBe(PHRASE);
  await expect(page.getByTestId('orphan-badge')).toHaveCount(0);
});

test('E12: orphan — deleting the anchored sentence yields an orphan badge, no highlight, no console errors', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'Orphan-to-be');
  await waitForSidecar(page, (s) => !!s && s.includes('Orphan-to-be'));

  const md = (await fsRead(page, WELCOME))!;
  const sentence =
    'Your note is saved to a sidecar file next to the document (`welcome.md.comments.json`), so the markdown itself stays untouched.';
  expect(md).toContain(sentence);
  await fsWrite(page, WELCOME, md.replace(sentence, ''));

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('orphan-badge')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toContainText('Orphan-to-be');
  await expect(page.locator('mark.hl')).toHaveCount(0);
  // consoleGuard fixture asserts zero console errors at teardown.
});

test('E15: embedded mode — comments autosave into an invisible trailer, sidecar removed, reload restores', async ({
  page,
}) => {
  // Seed a sidecar first so the migration (sidecar → embedded) is exercised.
  await addComment(page, PHRASE, 'Embedded note');
  await waitForSidecar(page, (s) => !!s && s.includes('Embedded note'));

  // PRD 002 §B5/§E18: comment storage is workspace-scoped — open an untitled
  // workspace, then switch the storage in the panel's Workspace scope.
  await seedFolders(page);
  await openFolderRoot(page);
  await openSettings(page, 'general');
  await expect(page.getByTestId('comment-storage')).toBeDisabled(); // W key: locked in User scope
  await page.getByTestId('settings-scope-workspace').click();
  // Issue #21: Workspace scope shows the same left tab rail, minus Hotkeys.
  await expect(page.getByTestId('settings-tabs').locator('button')).toHaveCount(3);
  await expect(page.getByTestId('settings-tab-hotkeys')).toHaveCount(0);
  await expect(page.getByTestId('settings-tab-general')).toHaveClass(/(^|\s)on(\s|$)/);
  await page.getByTestId('comment-storage').selectOption('embedded');
  await page.getByTestId('settings-close').click();

  // Any comment change triggers the embedded autosave + sidecar cleanup.
  await page.getByTestId('reply-btn').click();
  await page.getByTestId('reply-input').fill('embedded reply');
  await page.getByTestId('submit-reply').click();

  await expect.poll(async () => (await fsRead(page, WELCOME))?.includes('marky-mark-comments')).toBe(true);
  await expect.poll(async () => fsRead(page, WELCOME_SIDECAR), { timeout: 5000 }).toBe(null);
  const onDisk = (await fsRead(page, WELCOME))!;
  expect(onDisk).toContain('Embedded note');
  expect(onDisk.trimEnd().endsWith('-->')).toBe(true);

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('card-body')).toHaveText('Embedded note');
  await expect(page.locator('mark.hl').first()).toBeVisible();

  // The trailer is invisible everywhere: preview text and edit buffer.
  await expect(page.getByTestId('doc')).not.toContainText('marky-mark-comments');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('marky-mark-comments');
});

test('E16: embedded autosave never flushes unsaved text edits; explicit save writes both', async ({ page }) => {
  // PRD 002 §B5/§E18: comment storage is workspace-scoped — open an untitled
  // workspace, then switch the storage in the panel's Workspace scope.
  await seedFolders(page);
  await openFolderRoot(page);
  await openSettings(page, 'general');
  await expect(page.getByTestId('comment-storage')).toBeDisabled(); // W key: locked in User scope
  await page.getByTestId('settings-scope-workspace').click();
  await page.getByTestId('comment-storage').selectOption('embedded');
  await page.getByTestId('settings-close').click();

  // Dirty the buffer without saving.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTYMARK ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Comment autosave rewrites the file from the LAST SAVED text.
  await addComment(page, PHRASE, 'while dirty');
  await expect.poll(async () => (await fsRead(page, WELCOME))?.includes('marky-mark-comments')).toBe(true);
  const afterAutosave = (await fsRead(page, WELCOME))!;
  expect(afterAutosave).not.toContain('DIRTYMARK');
  expect(afterAutosave).toContain('while dirty');
  await expect(page.getByTestId('dirty-dot')).toBeVisible(); // still dirty

  // Explicit save writes buffer + trailer together.
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const afterSave = (await fsRead(page, WELCOME))!;
  expect(afterSave).toContain('DIRTYMARK');
  expect(afterSave).toContain('marky-mark-comments');
  expect(afterSave).toContain('while dirty');
});

test('E32: activating a buried comment glides it level with its highlight; cards wear a faint shadow', async ({
  page,
}) => {
  // Three comments anchored inside one paragraph → a stack near one line.
  await addComment(page, 'saved to a sidecar file', 'first note');
  await addComment(page, 'markdown itself stays untouched', 'second note');
  await addComment(page, 'cards instead of being lost', 'third note');
  await expect(page.getByTestId('comment-card')).toHaveCount(3);

  // Cards have the faint balloon shadow.
  const shadow = await page.getByTestId('comment-card').first().evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe('none');

  // Activate the LAST card (bottom of the stack).
  const third = page.locator('[data-testid="comment-card"]', { hasText: 'third note' });
  await third.click();
  await expect(third).toHaveClass(/active/);

  // Word behavior: its top animates level with its highlight (±10 px).
  await expect
    .poll(async () => {
      const cardTop = (await third.boundingBox())!.y;
      const markTop = (await page
        .locator('mark.hl')
        .filter({ hasText: 'instead of being lost' })
        .first()
        .boundingBox())!.y;
      return Math.abs(cardTop - markTop);
    })
    .toBeLessThanOrEqual(10);

  // The earlier cards moved out of the way (fully above the active card) —
  // polled, since their 180ms glide finishes after the active card's does.
  const first = page.locator('[data-testid="comment-card"]', { hasText: 'first note' });
  await expect
    .poll(async () => {
      const f = (await first.boundingBox())!;
      const t = (await third.boundingBox())!;
      return f.y + f.height - t.y;
    })
    .toBeLessThanOrEqual(0);
});

test('E33: resolved comments can be shown ghosted in place, reopened from the ghost, and re-collapsed', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'ghost me');
  await page.getByTestId('resolve-btn').click();

  // Show-resolved defaults ON (SPEC7 §4): ghost card in the flow + ghost
  // highlight in the text, with the toggle now living in Settings.
  const ghost = page.locator('.card.resolved-ghost');
  await expect(ghost).toHaveCount(1);
  await expect(ghost).toContainText('ghost me');
  await expect
    .poll(() => ghost.evaluate((el) => parseFloat(getComputedStyle(el).opacity)))
    .toBeLessThan(1);
  await expect(page.locator('mark.hl.ghost').first()).toBeVisible();
  await expect(page.getByTestId('resolved-section')).toHaveCount(0);

  // Reopen from the ghost: normal card + normal highlight return.
  await ghost.getByTestId('reopen-btn').click();
  await expect(page.locator('.card.resolved-ghost')).toHaveCount(0);
  await expect(page.locator('mark.hl:not(.ghost)').first()).toBeVisible();
  await expect(page.getByTestId('card-body')).toHaveText('ghost me');

  // Resolve again and turn the toggle off (in Settings) → collapsed section.
  await page.getByTestId('resolve-btn').click();
  await openSettings(page, 'general');
  await page.getByTestId('show-resolved').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('resolved-section')).toContainText('Resolved (1)');
  await expect(page.locator('mark.hl')).toHaveCount(0);
});

test('E36: disabling comments hides every comment affordance non-destructively; re-enabling restores', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'still here');
  await waitForSidecar(page, (s) => !!s && s.includes('still here'));
  await expect(page.locator('mark.hl').first()).toBeVisible();
  await expect(page.getByTestId('comments-toggle')).toBeVisible();

  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').uncheck();
  await page.getByTestId('settings-close').click();

  // Highlights, panel, and the toolbar toggle are gone — the doc reads clean.
  await expect(page.locator('mark.hl')).toHaveCount(0);
  await expect(page.getByTestId('panel')).toHaveCount(0);
  await expect(page.getByTestId('comments-toggle')).toHaveCount(0);

  // Selecting text produces no floating button, and typing starts no composer.
  await selectPhrase(page, PHRASE);
  await page.waitForTimeout(200);
  await expect(page.getByTestId('marker-popup')).toHaveCount(0);
  await page.keyboard.press('x');
  await page.waitForTimeout(150);
  await expect(page.getByTestId('composer')).toHaveCount(0);

  // The stored comment was never touched.
  expect(await fsRead(page, WELCOME_SIDECAR)).toContain('still here');

  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').check();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.locator('mark.hl').first()).toBeVisible();
  await expect(page.getByTestId('comments-toggle')).toBeVisible();
});

test('E37: typing over a selection opens the composer seeded with the keystroke; off → button only', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await expect(page.getByTestId('marker-popup')).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toHaveValue('x');
  await expect(page.getByTestId('composer-input')).toBeFocused();
  // The caret sits after the seed: continuing to type appends.
  await page.keyboard.type('yz');
  await expect(page.getByTestId('composer-input')).toHaveValue('xyz');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('card-body')).toHaveText('xyz');

  // Setting off → typing over a selection does nothing; the button still works.
  await openSettings(page, 'general');
  await page.getByTestId('set-type-to-comment').uncheck();
  await page.getByTestId('settings-close').click();
  await selectPhrase(page, 'GitHub-flavored markdown');
  await expect(page.getByTestId('marker-popup')).toBeVisible();
  await page.keyboard.press('q');
  await page.waitForTimeout(150);
  await expect(page.getByTestId('composer')).toHaveCount(0);
});

test('E38: resolving defaults to a faint ghost in place; the toggle lives in Settings, not the panel', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'fade me');
  await page.getByTestId('resolve-btn').click();

  // The panel grew no header toggle — the switch moved to Settings (SPEC7 §4).
  await expect(page.getByTestId('panel').getByTestId('show-resolved')).toHaveCount(0);

  // Default ON: the ghost card renders in the flow at 0.40 opacity (±0.02).
  const ghost = page.locator('.card.resolved-ghost');
  await expect(ghost).toHaveCount(1);
  await page.mouse.move(30, 300); // hover brightens ghosts; measure unhovered
  await expect
    .poll(() => ghost.evaluate((el) => parseFloat(getComputedStyle(el).opacity)))
    .toBeGreaterThanOrEqual(0.38);
  await expect
    .poll(() => ghost.evaluate((el) => parseFloat(getComputedStyle(el).opacity)))
    .toBeLessThanOrEqual(0.42);
  await expect(page.locator('mark.hl.ghost').first()).toBeVisible();

  // Turning the setting off collapses resolved comments as before.
  await openSettings(page, 'general');
  await page.getByTestId('show-resolved').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('resolved-section')).toContainText('Resolved (1)');
  await expect(page.locator('mark.hl')).toHaveCount(0);
});

test('E54: fixed navigator pill — appears on selection, steps in order, wraps, never moves; click-away dismisses', async ({
  page,
}) => {
  await addComment(page, NAV_P1, 'first');
  await addComment(page, NAV_P2, 'second');
  await addComment(page, NAV_P3, 'third');

  // Start from a clean deactivated state, then select the first comment.
  await page.getByTestId('doc').locator('h1').click();
  await expect(page.getByTestId('comment-nav')).toBeHidden(); // fades out, stays mounted
  await page.locator('mark.hl').first().click();
  await expect(page.getByTestId('comment-nav')).toBeVisible();
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 3');

  // The don't-move-the-mouse guarantee: once shown, stepping never moves the
  // pill (measure after the first step so the entrance slide has settled —
  // the invariant is about stepping, not the appear animation).
  await page.getByTestId('comment-nav-next').click();
  await expect(page.getByTestId('comment-nav-count')).toHaveText('2 / 3');
  const box = await stableBox(page.getByTestId('comment-nav'));
  await page.getByTestId('comment-nav-next').click();
  await expect(page.getByTestId('comment-nav-count')).toHaveText('3 / 3');
  await expect.poll(() => page.getByTestId('comment-nav').boundingBox()).toEqual(box);
  await page.getByTestId('comment-nav-next').click(); // wrap forward
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 3');
  await expect.poll(() => page.getByTestId('comment-nav').boundingBox()).toEqual(box);
  await page.getByTestId('comment-nav-prev').click(); // wrap back
  await expect(page.getByTestId('comment-nav-count')).toHaveText('3 / 3');
  await expect.poll(() => page.getByTestId('comment-nav').boundingBox()).toEqual(box);
  // Stepping keeps an active highlight in the document and never killed the pill.
  await expect(page.locator('mark.hl.active').first()).toBeVisible();

  // Click-away (not on a mark) deactivates and the pill disappears.
  await page.getByTestId('doc').locator('h1').click();
  await expect(page.getByTestId('comment-nav')).toBeHidden(); // fades out, stays mounted
});

test('E55: nav hotkeys — defaults enter at first/last; rebinding Next takes effect immediately and persists', async ({
  page,
}) => {
  await addComment(page, NAV_P1, 'first');
  await addComment(page, NAV_P3, 'second');

  await page.getByTestId('doc').locator('h1').click(); // deactivate
  await expect(page.getByTestId('comment-nav')).toBeHidden(); // fades out, stays mounted
  await page.keyboard.press('Control+Alt+ArrowDown'); // nothing active → first
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 2');
  await page.getByTestId('doc').locator('h1').click();
  await page.keyboard.press('Control+Alt+ArrowUp'); // nothing active → last
  await expect(page.getByTestId('comment-nav-count')).toHaveText('2 / 2');

  await openSettings(page, 'hotkeys');
  await page.getByTestId('hotkey-nextComment').click();
  await page.keyboard.press('Control+Shift+J');
  await page.getByTestId('settings-close').click();

  await page.keyboard.press('Control+Alt+ArrowDown'); // old combo — must do nothing
  await expect(page.getByTestId('comment-nav-count')).toHaveText('2 / 2');
  await page.keyboard.press('Control+Shift+J'); // new combo — wraps 2 → 1
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 2');
  expect(await fsRead(page, '/config/settings.json')).toContain('Mod+Shift+J');
});

test('E56: the native menu carries Next/Previous Comment; clicking steps; the master switch removes them', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
  await addComment(page, NAV_P1, 'first');
  await addComment(page, NAV_P3, 'second');

  expect((await menuItem(page, 'nextComment'))!.label).toBe('Next Comment');
  expect((await menuItem(page, 'prevComment'))!.label).toBe('Previous Comment');
  const accel = await page.evaluate(
    () =>
      (window
        .__mmMenu!.spec!.submenus.flatMap((m) => m.items)
        .find((i) => i.type === 'command' && i.command === 'nextComment') as { accelerator?: string })?.accelerator
  );
  expect(accel).toBe('Mod+Alt+ArrowDown');

  // The last add left the second comment active — menu Next wraps to the first.
  await menuClick(page, 'nextComment');
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 2');

  // Master switch off (via the settings aux window) → both items leave the spec.
  const popup = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popup;
  await sp.getByTestId('settings-panel').waitFor();
  await sp.getByTestId('settings-tab-general').click();
  await sp.getByTestId('set-comments-enabled').click();
  await expect.poll(async () => (await menuItem(page, 'nextComment')) === undefined).toBe(true);
  await expect.poll(async () => (await menuItem(page, 'prevComment')) === undefined).toBe(true);
});

test('E129: split edit — highlights + panel in the live pane, comment from a split selection, nav works, cards clear the window edge', async ({
  page,
}) => {
  // Wide enough that the split preview fits its content floor (768px) plus
  // the 300px comments panel without sideways scrolling.
  await page.setViewportSize({ width: 2300, height: 900 });
  await addComment(page, PHRASE, 'First note');

  // Padding fix, full preview: the card keeps a clear gap to the window edge.
  const gapTo = async () => {
    const box = (await page.getByTestId('comment-card').first().boundingBox())!;
    return (await page.evaluate(() => window.innerWidth)) - (box.x + box.width);
  };
  await expect.poll(gapTo).toBeGreaterThanOrEqual(16);

  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();

  // The split preview renders the highlight, and the panel sits alongside.
  const pane = page.getByTestId('split-preview');
  const paneMarks = pane.locator('mark.hl[data-cid]');
  await expect(paneMarks.first()).toBeVisible();
  await expect(page.getByTestId('panel')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);

  // Entering edit replays the carried top line into the fresh CM view for up
  // to ~2s of frames (App.tsx's line-anchored scroll restore) — a click that
  // races it gets yanked back mid-document and its keystrokes land on the
  // wrong content. Probe until our own scroll-to-top sticks (the replay has
  // landed or given up), which also puts line 1 in view for the click.
  const edScroller = page.getByTestId('editor').locator('.cm-scroller');
  await expect
    .poll(async () => {
      await edScroller.evaluate((el) => el.scrollTo({ top: 0 }));
      await new Promise((r) => setTimeout(r, 100));
      return edScroller.evaluate((el) => el.scrollTop);
    })
    .toBe(0);

  // The live re-render on typing keeps the highlight.
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('LIVEMARK ');
  await expect(pane).toContainText('LIVEMARK', { timeout: 1000 });
  await expect(paneMarks.first()).toBeVisible();

  // A selection made IN the split pane grows a comment like preview mode.
  // Real flow first: a mousedown in the pane blurs the editor (a focused CM
  // would re-assert its own selection and kill the pane's).
  // y: 10 would land the pointer in the 20px `.toolbar-hotzone` and hold the
  // shell down over the top 42px for the rest of the test; 60 is the same
  // blur-the-editor click, clear of the band.
  await pane.click({ position: { x: 10, y: 60 } });
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
  await selectPhraseInPane(page, '[data-testid="split-preview"] .doc', 'renders GitHub-flavored markdown');
  await expect(page.getByTestId('marker-popup')).toBeVisible();
  await clickClearOfToolbar(page.getByTestId('add-note-btn'));
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.getByTestId('composer-input').fill('From the split pane');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(2);
  await expect(paneMarks).toHaveCount(2);
  await expect(paneMarks.first()).toContainText('renders GitHub-flavored');
  await waitForSidecar(page, (s) => !!s && s.includes('From the split pane'));

  // Clicking a highlight activates its card; the navigator steps in split mode.
  await paneMarks.first().click();
  await expect(page.getByTestId('comment-nav')).toBeVisible();
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 2');
  await page.getByTestId('comment-nav-next').click();
  await expect(page.getByTestId('comment-nav-count')).toHaveText('2 / 2');

  // Padding fix, split mode: same clear gap to the window's right border.
  await expect.poll(gapTo).toBeGreaterThanOrEqual(16);
});

test('E130: comment boxes keep a clear right-edge gap — every surface and state, both hosts, even an overflowing split pane (#20/#24)', async ({
  page,
}) => {
  // Measured geometry, not stylesheet trust (#20 was filed right after the
  // #19 CSS fix merged): the box's rendered right edge must clear the
  // window's right border by ≥16px (target 24px), never sit flush.
  const gapOf = async (testId: string) => {
    const box = (await page.getByTestId(testId).first().boundingBox())!;
    return (await page.evaluate(() => window.innerWidth)) - (box.x + box.width);
  };

  // Full preview: idle card.
  await addComment(page, PHRASE, 'gap probe');
  await expect.poll(() => gapOf('comment-card')).toBeGreaterThanOrEqual(16);

  // Active card.
  await page.getByTestId('comment-card').first().click();
  await expect(page.getByTestId('comment-card').first()).toHaveClass(/active/);
  await expect.poll(() => gapOf('comment-card')).toBeGreaterThanOrEqual(16);

  // Open composer.
  await selectPhrase(page, 'markdown itself stays untouched');
  await page.getByTestId('add-note-btn').click();
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect.poll(() => gapOf('composer')).toBeGreaterThanOrEqual(16);
  await page.keyboard.press('Escape');

  // Collapsed resolved section (show-resolved off), plus a live card beside it.
  await page.getByTestId('comment-card').first().click();
  await page.getByTestId('resolve-btn').click();
  await openSettings(page, 'general');
  await page.getByTestId('show-resolved').uncheck();
  await page.getByTestId('settings-close').click();
  await addComment(page, 'markdown itself stays untouched', 'second note');
  await expect(page.getByTestId('resolved-section')).toBeVisible();
  await expect.poll(() => gapOf('resolved-section')).toBeGreaterThanOrEqual(16);
  // Expanded resolved section too.
  await page.getByTestId('resolved-section').locator('summary').click();
  await expect.poll(() => gapOf('resolved-section')).toBeGreaterThanOrEqual(16);

  // Split-edit host at the suite's pinned pane floor (fits without overflow).
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect.poll(() => gapOf('comment-card')).toBeGreaterThanOrEqual(16);
  await expect.poll(() => gapOf('resolved-section')).toBeGreaterThanOrEqual(16);

  // The #20 repro: the shipped paneMinWidth (768px) makes the split pane's
  // content (doc floor + 300px panel) overflow sideways at this 1280px
  // window. #24's model: the panel stays in flow beside the doc — never
  // drawn over the text — and the pane grows a horizontal scrollbar;
  // scrolling fully right brings the cards into view with the gap intact.
  await waitForSidecar(page, (s) => !!s && s.includes('second note'));
  const raw = await fsRead(page, '/config/settings.json');
  const settings = raw ? JSON.parse(raw) : {};
  settings.paneMinWidth = 768;
  await fsWrite(page, '/config/settings.json', JSON.stringify(settings));
  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comment-card').first()).toBeVisible();
  await expect.poll(() => gapOf('comment-card')).toBeGreaterThanOrEqual(16); // preview still fits
  await page.keyboard.press('Control+e');
  const pane = page.getByTestId('split-preview');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('comment-card').first()).toBeVisible();

  /** Measured geometry (#24): the box must sit fully right of the doc's box. */
  const clearOfDoc = async (testId: string) => {
    // Both rects move while the split settles — poll the relation itself.
    await expect
      .poll(async () => {
        const doc = (await pane.locator('.doc').boundingBox())!;
        const box = (await page.getByTestId(testId).first().boundingBox())!;
        return box.x - (doc.x + doc.width);
      })
      .toBeGreaterThanOrEqual(0);
  };

  // Overflow, not overlay: the pane scrolls sideways…
  const scroll = await pane.evaluate((el) => ({
    left: el.scrollLeft,
    width: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(scroll.width).toBeGreaterThan(scroll.client);
  // …and at scroll-left 0 the doc text is unobscured — the panel and its
  // cards are beside the doc in flow, not on top of it.
  expect(scroll.left).toBe(0);
  await clearOfDoc('panel');
  await clearOfDoc('comment-card');
  // Scrolled fully right, the cards come into view, still clear of the doc,
  // with the #19/#20 right-edge gap intact.
  await pane.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await clearOfDoc('panel');
  await clearOfDoc('comment-card');
  await expect.poll(() => gapOf('comment-card')).toBeGreaterThanOrEqual(16);
  await expect.poll(() => gapOf('resolved-section')).toBeGreaterThanOrEqual(16);
});

test('E137: a newer-major trailer — the doc opens and edits normally, and its trailer survives saves byte-for-byte', async ({
  page,
}) => {
  await fsWrite(page, NEWER_PATH, `${NEWER_DOC}${NEWER_TRAILER}`);
  await openPath(page, NEWER_PATH);
  await expect(page.getByTestId('docname')).toContainText('from-the-future.md');

  // Req 13: it renders normally — only the comment data is withheld.
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Newer document');
  await expect(page.getByTestId('doc')).toContainText('reads perfectly well');
  await expect(page.locator('mark.hl')).toHaveCount(0); // no comments loaded
  await expect(page.getByTestId('doc')).not.toContainText('marky-mark-comments'); // never leaks in

  // …and it edits normally.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('EDITED ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Req 14: the save writes the modified content + the ORIGINAL trailer bytes.
  await menuSave(page);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const saved = (await fsRead(page, NEWER_PATH))!;
  expect(saved).toContain('EDITED ');
  expect(saved.slice(saved.length - NEWER_TRAILER.length)).toBe(NEWER_TRAILER); // byte-for-byte
  expect(saved.match(/marky-mark-comments/g)?.length).toBe(1); // never doubled
  expect(saved).not.toContain('"1.0.0"'); // never restamped to our version

  // Re-saving keeps it bit-identical (Req 14: "and re-saving repeatedly").
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('AGAIN ');
  await page.keyboard.press('Control+e');
  await menuSave(page);
  const resaved = (await fsRead(page, NEWER_PATH))!;
  expect(resaved).toContain('AGAIN ');
  expect(resaved.slice(resaved.length - NEWER_TRAILER.length)).toBe(NEWER_TRAILER);
  expect(resaved.match(/marky-mark-comments/g)?.length).toBe(1);
});

test('E138: a newer-major trailer — every authoring route is closed and the indication persists across mode switches', async ({
  page,
}) => {
  await fsWrite(page, NEWER_PATH, `${NEWER_DOC}${NEWER_TRAILER}`);
  await openPath(page, NEWER_PATH);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Newer document');

  // Req 16: a persistent indication — and NOT the 4-second toast.
  const indication = page.getByTestId('store-unreadable');
  await expect(indication).toBeVisible();
  await expect(indication).toContainText('newer version of Marky Mark');
  await expect(indication).toContainText('2.0.0'); // the version as declared
  await expect(page.getByTestId('notice')).toHaveCount(0);
  expect(await indication.evaluate((el) => el.className)).not.toContain('mm-notice');

  // Req 15: selecting text offers no Add comment button…
  await selectPhrase(page, 'paragraph');
  await expect(page.getByTestId('marker-popup')).toHaveCount(0);
  // …and type-to-comment opens no composer.
  await page.keyboard.type('x');
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.getByTestId('composer-input')).toHaveCount(0);
  await expect(page.getByTestId('panel')).toHaveCount(0);

  // Req 16: persists across a mode switch (edit ↔ preview). The 4.5s "still
  // there after the mm-notice timer" sleep was dropped (owner call,
  // 2026-08-03): a wrongly-timer-cleared indication would also vanish on the
  // mode-switch remount below, which asserts the same regression for free.
  await expect(indication).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(indication).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(indication).toBeVisible();

  // It belongs to the document: a clean one clears it, coming back restores it.
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('store-unreadable')).toHaveCount(0);
  await openPath(page, NEWER_PATH);
  await expect(page.getByTestId('docname')).toContainText('from-the-future.md');
  await expect(page.getByTestId('store-unreadable')).toBeVisible();
});

test('E139: per store — an unreadable trailer beside a readable sidecar shows the sidecar’s comments, read-only', async ({
  page,
}) => {
  // Build a genuine readable sidecar through the app, then bury a newer-major
  // trailer in the same document (Req 17: the two stores are judged apart).
  await fsWrite(page, NEWER_PATH, NEWER_DOC);
  await openPath(page, NEWER_PATH);
  await addComment(page, 'paragraph', 'Readable sidecar note');
  const sidecarPath = `${NEWER_PATH}.comments.json`;
  await expect.poll(() => fsRead(page, sidecarPath)).toContain('Readable sidecar note');
  const sidecarBefore = (await fsRead(page, sidecarPath))!;

  await openWelcomeViaHelp(page); // park it, so the reopen re-reads from disk
  await fsWrite(page, NEWER_PATH, `${NEWER_DOC}${NEWER_TRAILER}`);
  await openPath(page, NEWER_PATH);
  await expect(page.getByTestId('docname')).toContainText('from-the-future.md');

  // Req 17: the readable store still shows — card, body and mark.
  const card = page.getByTestId('comment-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('card-body')).toContainText('Readable sidecar note');
  await expect(page.locator('mark.hl')).toHaveCount(1);
  await expect(page.getByTestId('store-unreadable')).toBeVisible();

  // Reqs 15/17: …but authoring is frozen for the WHOLE document.
  for (const id of ['reply-btn', 'edit-btn', 'resolve-btn', 'reopen-btn', 'delete-btn', 'edit-reply', 'delete-reply']) {
    await expect(card.getByTestId(id)).toHaveCount(0);
  }
  await selectPhrase(page, 'reads perfectly');
  await expect(page.getByTestId('marker-popup')).toHaveCount(0);

  // Req 14: a save leaves the trailer byte-identical and never touches the
  // sidecar — no migration in either direction.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('MIXEDEDIT ');
  await page.keyboard.press('Control+e');
  await menuSave(page);
  const saved = (await fsRead(page, NEWER_PATH))!;
  expect(saved).toContain('MIXEDEDIT ');
  expect(saved.slice(saved.length - NEWER_TRAILER.length)).toBe(NEWER_TRAILER);
  await page.waitForTimeout(1200); // longer than the 800ms comment autosave debounce
  expect(await fsRead(page, sidecarPath)).toBe(sidecarBefore);
});

test('E140: a frozen document’s resolved cards are read-only too, inside the collapsed resolved section', async ({
  page,
}) => {
  // Resolve a comment while the document is still fully readable…
  await fsWrite(page, NEWER_PATH, NEWER_DOC);
  await openPath(page, NEWER_PATH);
  await addComment(page, 'paragraph', 'Note that gets resolved');
  await page.getByTestId('comment-card').getByTestId('resolve-btn').click();
  await expect.poll(() => fsRead(page, `${NEWER_PATH}.comments.json`)).toContain('"resolved": true');

  // …then bury a newer-major trailer under it and come back.
  await openWelcomeViaHelp(page);
  await fsWrite(page, NEWER_PATH, `${NEWER_DOC}${NEWER_TRAILER}`);
  await openPath(page, NEWER_PATH);
  await expect(page.getByTestId('store-unreadable')).toBeVisible();

  // The ghosted resolved card (showResolved on, the default) is read-only…
  const ghost = page.locator('.card.resolved-ghost');
  await expect(ghost).toContainText('Note that gets resolved');
  for (const id of ['reopen-btn', 'delete-btn', 'reply-btn', 'edit-btn', 'resolve-btn']) {
    await expect(ghost.getByTestId(id)).toHaveCount(0);
  }

  // …and so is the same card inside the collapsed resolved section.
  await openSettings(page, 'general');
  await page.getByTestId('show-resolved').uncheck();
  await page.getByTestId('settings-close').click();
  const section = page.getByTestId('resolved-section');
  await expect(section).toContainText('Resolved (1)');
  await section.locator('summary').click(); // expand it
  const card = section.getByTestId('comment-card');
  await expect(card.getByTestId('card-body')).toContainText('Note that gets resolved');
  for (const id of ['reopen-btn', 'delete-btn', 'reply-btn', 'edit-btn', 'resolve-btn']) {
    await expect(card.getByTestId(id)).toHaveCount(0);
  }
  await expect(page.getByTestId('store-unreadable')).toBeVisible(); // still there
});
// --- Issue #38: the "Add comment" gate, verdict tests + the plain-edit affordance ----

test('E151: comments hidden (Mod+Shift+C) with the master switch ON — selection offers no button until shown again', async ({
  page,
}) => {
  // The `showComments` conjunct alone (E36 covers commentsEnabled off).
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByTestId('comments-toggle')).not.toHaveClass(/active/);
  await selectPhrase(page, PHRASE);
  await page.waitForTimeout(200);
  await expect(page.getByTestId('marker-popup')).toHaveCount(0);
  // Type-to-comment stays closed too (same gate in the SPEC7 §3 effect).
  await page.keyboard.press('x');
  await page.waitForTimeout(150);
  await expect(page.getByTestId('composer')).toHaveCount(0);

  // Showing comments again is the only change — the button comes right back.
  await page.keyboard.press('Control+Shift+C');
  await selectPhrase(page, PHRASE);
  await expect(page.getByTestId('marker-popup')).toBeVisible();
});

test('E152: an open composer suppresses a second Add-comment button until it closes', async ({ page }) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('add-note-btn'));
  await expect(page.getByTestId('composer')).toBeVisible();

  // A new selection while the composer is pending offers no second button.
  await selectPhrase(page, 'GitHub-flavored markdown');
  await page.waitForTimeout(200);
  await expect(page.getByTestId('marker-popup')).toHaveCount(0);

  // Cancel closes the composer — the same selection offers the button again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await selectPhrase(page, 'GitHub-flavored markdown');
  await expect(page.getByTestId('marker-popup')).toBeVisible();
});

test('E153: plain edit mode reaches a comment — the affordance rides the SPEC25 carry and anchors the selected phrase', async ({
  page,
}) => {
  const AFFORD_PATH = '/docs/edit-affordance.md';
  await fsWrite(page, AFFORD_PATH, '# Edit Affordance\n\nalpha bravo charlie delta.\n\nclosing line entirely.\n');
  await page.goto(`/#open=${AFFORD_PATH}`);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Edit Affordance');

  // Into PLAIN edit mode (split off — the split preview has its own button).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  if (await page.getByTestId('split-preview').count()) await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);

  // No selection → no affordance.
  await expect(page.getByTestId('marker-popup-edit')).toHaveCount(0);

  // Select the whole middle paragraph in the editor.
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'alpha bravo' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('alpha bravo charlie delta.');
  const afford = page.getByTestId('marker-popup-edit');
  await expect(afford).toBeVisible();

  // Acting on it ("add note") switches surface (SPEC25 carry) and opens the
  // composer on the SAME selection, now in preview's rendered-DOM offsets.
  await clickClearOfToolbar(afford.getByTestId('add-note-btn'));
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Edit Affordance'); // preview is up
  await page.getByTestId('composer-input').fill('from plain edit mode');
  await page.getByTestId('composer-submit').click();

  // The comment exists, highlights exactly the selected phrase, and persists.
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('from plain edit mode');
  await expect.poll(async () => (await page.locator('mark.hl').allTextContents()).join('')).toBe(
    'alpha bravo charlie delta.'
  );
  const sidecarPath = `${AFFORD_PATH}.comments.json`;
  await expect.poll(() => fsRead(page, sidecarPath)).toContain('from plain edit mode');
  expect(await fsRead(page, sidecarPath)).toContain('alpha bravo charlie delta.');
});

test('E154: the edit-mode affordance obeys every gate — frozen store, hidden comments, master switch off', async ({
  page,
}) => {
  // PRD 004 Req 15: a frozen document closes this authoring route too.
  await fsWrite(page, NEWER_PATH, `${NEWER_DOC}${NEWER_TRAILER}`);
  await openPath(page, NEWER_PATH);
  await expect(page.getByTestId('store-unreadable')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  if (await page.getByTestId('split-preview').count()) await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'reads perfectly' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect.poll(() => page.evaluate(() => (window.__mmEdit?.selText ?? '').length)).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  await expect(page.getByTestId('marker-popup-edit')).toHaveCount(0);
  await expect(page.getByTestId('marker-popup')).toHaveCount(0);

  // A clean document in the same session DOES offer it (back to plain edit —
  // opening a document lands in preview; the split-off setting persisted)…
  await openWelcomeViaHelp(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'saved to a sidecar' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  const afford = page.getByTestId('marker-popup-edit');
  await expect(afford).toBeVisible();

  // …until comments are hidden (Mod+Shift+C)…
  await page.keyboard.press('Control+Shift+C');
  await expect(afford).toHaveCount(0);
  await page.keyboard.press('Control+Shift+C');
  await expect(afford).toBeVisible();

  // …or the master switch goes off (SPEC7 §2).
  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').uncheck();
  await page.getByTestId('settings-close').click();
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'saved to a sidecar' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.waitForTimeout(200);
  await expect(page.getByTestId('marker-popup-edit')).toHaveCount(0);
});

test('E158: a parked doc reopens fresh when an external tool edited its sidecar (issue #64) — and a mid-debounce comment edit flushes on the switch instead of going stale', async ({
  page,
}) => {
  // Author a comment through the app and let the debounced sidecar settle.
  await fsWrite(page, NEWER_PATH, NEWER_DOC);
  await openPath(page, NEWER_PATH);
  await addComment(page, 'paragraph', 'Home-grown note');
  const sidecarPath = `${NEWER_PATH}.comments.json`;
  await expect.poll(() => fsRead(page, sidecarPath)).toContain('Home-grown note');

  // Park it, then play the sibling md-with-comments app: append a comment
  // to the sidecar while the doc sits clean in the park map.
  await openWelcomeViaHelp(page);
  const external = JSON.parse((await fsRead(page, sidecarPath))!);
  external.comments.push({
    id: 'external-1',
    author: 'md-with-comments',
    createdAt: '2026-08-04T00:00:00.000Z',
    body: 'Added while you were away',
    resolved: false,
    thread: [],
    anchor: { exact: 'reads perfectly', prefix: 'This paragraph ', suffix: ' well', start: 33, end: 48 },
  });
  await fsWrite(page, sidecarPath, `${JSON.stringify(external, null, 2)}\n`);

  // Issue #64: the plain reopen is a parked activation now, but the clean
  // bundle must still notice the disk moved on — both comments show.
  await openPath(page, NEWER_PATH);
  const cards = page.getByTestId('comment-card');
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId('card-body').filter({ hasText: 'Added while you were away' })).toHaveCount(1);
  await expect(page.getByTestId('card-body').filter({ hasText: 'Home-grown note' })).toHaveCount(1);

  // Now author another comment and switch away INSIDE the 800 ms autosave
  // debounce: parkActive flushes the pending write, so the edit reaches the
  // sidecar at the switch (it used to sit unpersisted until the next edit)…
  await addComment(page, 'even though', 'Mid-debounce note');
  await openWelcomeViaHelp(page);
  await expect.poll(() => fsRead(page, sidecarPath)).toContain('Mid-debounce note');

  // …and the reopen agrees with disk: all three comments, nothing clobbered.
  await openPath(page, NEWER_PATH);
  await expect(cards).toHaveCount(3);
  await expect.poll(() => fsRead(page, sidecarPath)).toContain('Added while you were away');
});

// Renumbered from E415 (issue #185 collision rule): #240's hello-editor
// suite took E415 first on this branch, so the newer test moved up.
test('E419: PRD 022 Req 1 — a swatch click creates a note-less colored highlight and closes the popup; no composer opens', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await expect(page.getByTestId('marker-popup')).toBeVisible();
  await clickClearOfToolbar(page.getByTestId('marker-swatch-green'));

  // The popup closed and nothing else opened.
  await expect(page.getByTestId('marker-popup')).toHaveCount(0);
  await expect(page.getByTestId('composer')).toHaveCount(0);

  // The highlight painted in the chosen color through the existing mark path.
  const mark = page.locator('mark.hl').first();
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('data-color', 'green');

  // On disk: a note-less entry (empty body, no thread) carrying the color —
  // format 1.1.0's shape from #230.
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "green"'));
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.version).toBe('1.1.0');
  expect(sidecar.comments).toHaveLength(1);
  expect(sidecar.comments[0].body).toBe('');
  expect(sidecar.comments[0].thread).toEqual([]);
});

test('E416: PRD 022 Reqs 1–2 — "add note" creates a highlight in the armed color and opens the composer attached to it', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('add-note-btn'));

  // The highlight already exists — armed default yellow — with the composer
  // open and standing in for its card.
  await expect(page.getByTestId('composer')).toBeVisible();
  const mark = page.locator('mark.hl').first();
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('data-color', 'yellow');

  await page.getByTestId('composer-input').fill('a note on a highlight');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('a note on a highlight');

  // ONE object: the note landed on the same colored entry.
  await waitForSidecar(page, (s) => !!s && s.includes('a note on a highlight'));
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.comments).toHaveLength(1);
  expect(sidecar.comments[0].color).toBe('yellow');
  expect(sidecar.comments[0].body).toBe('a note on a highlight');
});

test('E417: PRD 022 Req 4 — the last-used swatch pre-arms the popup and seeds type-to-comment', async ({ page }) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('marker-swatch-blue'));
  await expect(page.locator('mark.hl[data-color="blue"]').first()).toBeVisible();

  // A new selection: blue now leads the popup, pre-armed.
  await selectPhrase(page, 'GitHub-flavored markdown');
  const popup = page.getByTestId('marker-popup');
  await expect(popup).toBeVisible();
  await expect(popup.locator('.marker-swatch').first()).toHaveAttribute('data-testid', 'marker-swatch-blue');
  await expect(popup.getByTestId('marker-swatch-blue')).toHaveAttribute('aria-pressed', 'true');

  // …and seeds type-to-comment: the printable key still opens the composer,
  // whose submit yields a highlight-with-note in the armed color.
  await page.keyboard.press('x');
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.getByTestId('composer-submit').click();
  await waitForSidecar(page, (s) => !!s && s.includes('"x"'));
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.comments.filter((c: { color?: string }) => c.color === 'blue')).toHaveLength(2);
});

test('E418: PRD 022 Req 3 — a legacy colorless sidecar renders in the default tint; re-saving adds no colors and keeps 1.0.0', async ({
  page,
}) => {
  const DOC = '/docs/legacy-tint.md';
  await fsWrite(page, DOC, '# Legacy\n\nplain old commented text here.\n');
  await fsWrite(
    page,
    `${DOC}.comments.json`,
    JSON.stringify(
      {
        version: '1.0.0',
        comments: [
          {
            id: 'legacy-1',
            author: 'Old Reader',
            createdAt: '2024-01-01T00:00:00.000Z',
            body: 'an old note',
            resolved: false,
            thread: [],
            anchor: { exact: 'commented text', prefix: 'plain old ', suffix: ' here.', start: 16, end: 30 },
          },
        ],
      },
      null,
      2
    )
  );
  await page.goto(`/#open=${DOC}`);

  // The colorless entry paints as a noted highlight in the legacy tint.
  const mark = page.locator('mark.hl').first();
  await expect(mark).toBeVisible();
  expect(await mark.getAttribute('data-color')).toBeNull();
  await expect(mark).toHaveCSS('background-color', 'rgba(255, 214, 102, 0.42)');
  await expect(page.getByTestId('card-body')).toHaveText('an old note');

  // Re-save (resolve triggers the autosave rewrite): entries the user didn't
  // recolor gain no `color`, and the colorless store still stamps 1.0.0.
  await page.getByTestId('resolve-btn').click();
  await expect.poll(() => fsRead(page, `${DOC}.comments.json`)).toContain('"resolved": true');
  const rewritten = (await fsRead(page, `${DOC}.comments.json`))!;
  expect(rewritten).not.toContain('"color"');
  expect(rewritten).toContain('"version": "1.0.0"');
});

test('E420: PRD 022 Req 8 — recoloring from the active card repaints the marks, persists, and re-arms the popup', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('marker-swatch-green'));
  const mark = page.locator('mark.hl').first();
  await expect(mark).toHaveAttribute('data-color', 'green');

  // Clicking the highlight activates its card, which offers the four swatches
  // with the entry's current color ringed.
  await mark.click();
  const card = page.getByTestId('comment-card');
  await expect(card).toHaveClass(/active/);
  await expect(card.getByTestId('card-swatch-green')).toHaveAttribute('aria-pressed', 'true');
  await card.getByTestId('card-swatch-pink').click();

  // The marks repaint immediately and the entry persists recolored, still
  // note-less.
  await expect(page.locator('mark.hl').first()).toHaveAttribute('data-color', 'pink');
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "pink"'));
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.comments).toHaveLength(1);
  expect(sidecar.comments[0].color).toBe('pink');
  expect(sidecar.comments[0].body).toBe('');

  // Req 4: recoloring re-arms the last-used color for the next selection.
  await selectPhrase(page, 'GitHub-flavored markdown');
  const popup = page.getByTestId('marker-popup');
  await expect(popup.locator('.marker-swatch').first()).toHaveAttribute('data-testid', 'marker-swatch-pink');
});

test('E421: PRD 022 Req 9 — a note-less highlight has no standing card; its card appears while active and leaves on deactivation', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('marker-swatch-yellow'));
  const mark = page.locator('mark.hl').first();
  await expect(mark).toBeVisible();

  // No standing card in the margin flow for the note-less entry.
  await expect(page.getByTestId('comment-card')).toHaveCount(0);

  // Clicking the highlight brings its card in, active…
  await mark.click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('comment-card')).toHaveClass(/active/);
  // …but the navigator pill stays hidden: nav steps over noted entries only.
  await expect(page.getByTestId('comment-nav')).toBeHidden();

  // Click-away deactivates (SPEC14 §3.1) and the card leaves the panel.
  await page.getByTestId('doc').locator('h1').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
});

test('E422: PRD 022 Req 8 — adding a note from the active card turns a note-less highlight into a standing noted card', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('marker-swatch-blue'));
  await page.locator('mark.hl').first().click();

  const card = page.getByTestId('comment-card');
  await card.getByTestId('card-add-note').click();
  await card.getByTestId('edit-input').fill('now it has a note');
  await card.getByTestId('save-edit').click();
  await expect(card.getByTestId('card-body')).toHaveText('now it has a note');

  // Noted from here on: the card stands in the panel after deactivation, and
  // the note landed on the same colored entry.
  await page.getByTestId('doc').locator('h1').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('comment-card')).not.toHaveClass(/active/);
  await waitForSidecar(page, (s) => !!s && s.includes('now it has a note'));
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.comments).toHaveLength(1);
  expect(sidecar.comments[0].color).toBe('blue');
});

test('E423: PRD 022 Reqs 6+8 — a note-less card offers no reply/resolve, and Remove deletes the entry and unpaints its marks', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('marker-swatch-green'));
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "green"'));
  await page.locator('mark.hl').first().click();

  // Reply and resolve are withheld until a note exists; recolor, add-note and
  // remove are what the card offers.
  const card = page.getByTestId('comment-card');
  await expect(card.getByTestId('card-swatches')).toBeVisible();
  await expect(card.getByTestId('card-add-note')).toBeVisible();
  await expect(card.getByTestId('reply-btn')).toHaveCount(0);
  await expect(card.getByTestId('resolve-btn')).toHaveCount(0);
  await expect(card.getByTestId('edit-btn')).toHaveCount(0);

  // Remove deletes without the thread confirmation — there is no thread.
  await expect(card.getByTestId('delete-btn')).toHaveText('Remove');
  await card.getByTestId('delete-btn').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);
  await waitForSidecar(page, (s) => !s || !s.includes('"color": "green"'));
});

test('E428: PRD 022 Req 10 — off the hosted platform an active highlight offers no copy-link control', async ({
  page,
}) => {
  // PRD 020 Req 15 gates every share placement hosted-only; the dev shim
  // (this suite's platform) activates the card fine but grafts no control.
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('marker-swatch-yellow'));
  await page.locator('mark.hl').first().click();
  await expect(page.getByTestId('comment-card')).toHaveClass(/active/);
  await expect(page.getByTestId('mm-hl-link')).toHaveCount(0);
});

test('E424: PRD 022 Req 12 — a highlight paints in the plain-edit editor as a background decoration in its color', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('marker-swatch-green'));
  await expect(page.locator('mark.hl[data-color="green"]').first()).toBeVisible();

  // PLAIN edit: split off (it defaults on), so no preview pane exists.
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  const hl = editor.locator('.mm-hl');
  await expect(hl.first()).toBeVisible();
  await expect(hl.first()).toHaveAttribute('data-color', 'green');
  // The decoration covers exactly the anchored quote (spans join if CM splits).
  await expect.poll(async () => (await hl.allTextContents()).join('')).toBe(PHRASE);
  // …and the marker CSS actually lands on it.
  expect(await hl.first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});

test('E425: PRD 022 Req 12 — the split-edit editor paints too, and clicking a painted range activates the card in the preview panel', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('marker-swatch-blue'));
  await expect(page.locator('mark.hl[data-color="blue"]').first()).toBeVisible();

  await page.keyboard.press('Control+e'); // splitEdit defaults on — split edit
  await expect(page.getByTestId('split-divider')).toBeVisible();

  const hl = page.getByTestId('editor').locator('.mm-hl');
  await expect(hl.first()).toBeVisible();
  await expect(hl.first()).toHaveAttribute('data-color', 'blue');

  // The note-less entry has no standing card until the editor click brings
  // its transient active card into the panel — same outcome as clicking the
  // preview mark (issue #232).
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await hl.first().click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('comment-card')).toHaveClass(/active/);
});

test('E426: PRD 022 Req 12 — anchors the source cannot place confidently (absent or ambiguous quotes) do not paint in the editor', async ({
  page,
}) => {
  const DOC = '/docs/best-effort.md';
  const twinLine = 'identical sentence with the twin phrase inside it and identical padding after.';
  await fsWrite(
    page,
    DOC,
    `# Best effort\n\nSome **bold** prose here.\n\n${twinLine}\n\n${twinLine}\n\nA unique control phrase paints.\n`
  );
  const entry = (id: string, color: string, exact: string, prefix: string, suffix: string) => ({
    id,
    author: 'Reader',
    createdAt: '2026-01-01T00:00:00.000Z',
    body: `${id} note`,
    resolved: false,
    color,
    thread: [],
    anchor: { exact, prefix, suffix, start: 0, end: exact.length },
  });
  await fsWrite(
    page,
    `${DOC}.comments.json`,
    JSON.stringify(
      {
        version: '1.1.0',
        comments: [
          // Rendered "bold prose" crosses a ** marker in source: absent there.
          entry('absent', 'green', 'bold prose', 'Some ', ' here.'),
          // "twin phrase" occurs twice in source with identical context: ambiguous.
          entry('ambiguous', 'pink', 'twin phrase', 'sentence with the ', ' inside it and '),
          entry('unique', 'yellow', 'unique control phrase', 'A ', ' paints.'),
        ],
      },
      null,
      2
    )
  );
  await page.goto(`/#open=${DOC}`);

  // The preview paints all three (rendered-text anchoring resolves them all)…
  for (const cid of ['absent', 'ambiguous', 'unique']) {
    await expect(page.locator(`mark.hl[data-cid="${cid}"]`).first()).toBeVisible();
  }

  // …the editor paints only the one the source places confidently.
  await page.keyboard.press('Control+e');
  const hl = page.getByTestId('editor').locator('.mm-hl');
  await expect(hl).toHaveCount(1);
  await expect(hl).toHaveAttribute('data-cid', 'unique');
  await expect(hl).toHaveAttribute('data-color', 'yellow');
});

test('E427: PRD 022 Req 12 — plain edit is paint-only: a click just places the caret, and an edited quote unpaints instead of mispainting', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('marker-swatch-green'));
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "green"'));

  // PLAIN edit: split off (it defaults on) — the paint-only surface.
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  const hl = page.getByTestId('editor').locator('.mm-hl');
  await expect(hl.first()).toBeVisible();
  await hl.first().click();

  // No comment-related effect: no card, no panel — display only.
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.getByTestId('panel')).toHaveCount(0);

  // Normal cursor placement stands: typing edits at the clicked point, which
  // breaks the exact quote — the highlight skips (unpaints) rather than
  // guessing at a range.
  await page.keyboard.type('X');
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('X');
  await expect(hl).toHaveCount(0);
});
