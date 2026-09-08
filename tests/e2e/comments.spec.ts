import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import type { Box } from './helpers';
import {
  addComment,
  addHighlight,
  caretInto,
  clickClearOfToolbar,
  closeAppMenu,
  dragAcrossText,
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
  openCommentsPane,
  openFolderRoot,
  openGridDoc,
  openPath,
  openSettings,
  openViewMenu,
  openWelcomeViaHelp,
  PHRASE,
  previewSelectionAnnotation,
  saveSettings,
  seedFolders,
  selectPhrase,
  selectPhraseInPane,
  selectSpan,
  smartEditAnnotation,
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
  "version": "3.0.0",
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

// Rewritten for issue #286 (PRD 023 §12): the selection popup is retired —
// preview authoring is the Insert Comment hotkey over the selection.
test('E7: select text → Insert Comment hotkey → highlight in DOM and card in panel with the body text', async ({ page }) => {
  await selectPhrase(page, PHRASE);
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
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
  await saveSettings(page);

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
  // Issue #286: the popup's add-note is the Insert Comment hotkey now.
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
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
  await saveSettings(page);

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
  await saveSettings(page);

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
  await saveSettings(page);
  await expect(page.getByTestId('resolved-section')).toContainText('Resolved (1)');
  await expect(page.locator('mark.hl')).toHaveCount(0);
});

test('E36: disabling comments hides every comment affordance non-destructively; re-enabling restores', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'still here');
  await waitForSidecar(page, (s) => !!s && s.includes('still here'));
  await expect(page.locator('mark.hl').first()).toBeVisible();
  // Issue #256: the toolbar button is gone — the View ▸ Comments row and the
  // edge chevron are the affordances the master switch has to hide. Inserting
  // the comment auto-opened the pane (E437), so the chevron reads `collapse`.
  await expect(page.getByTestId('comments-collapse')).toBeVisible();
  let view = await openViewMenu(page);
  await expect(view.getByTestId('menu-view-toggleComments')).toBeVisible();
  await closeAppMenu(page);

  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').uncheck();
  await saveSettings(page);

  // Highlights, panel, the View row and the edge chevron are gone — the doc
  // reads clean (issue #256: the View row carries what the toolbar button did).
  await expect(page.locator('mark.hl')).toHaveCount(0);
  await expect(page.getByTestId('panel')).toHaveCount(0);
  // The chevron is gone outright, not merely flipped to its closed form.
  await expect(page.getByTestId('comments-collapse')).toHaveCount(0);
  await expect(page.getByTestId('comments-expand')).toHaveCount(0);
  view = await openViewMenu(page);
  await expect(view.getByTestId('menu-view-toggleComments')).toHaveCount(0);
  await closeAppMenu(page);

  // Issue #286: the annotation hotkeys are inert while the switch is off —
  // a selection plus Mod+Alt+M / Mod+Alt+H starts nothing at all.
  await selectPhrase(page, PHRASE);
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Alt+M');
  await page.keyboard.press('Control+Alt+H');
  await page.waitForTimeout(150);
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);

  // The stored comment was never touched.
  expect(await fsRead(page, WELCOME_SIDECAR)).toContain('still here');

  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').check();
  await saveSettings(page);
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.locator('mark.hl').first()).toBeVisible();
  await expect(page.getByTestId('comments-collapse')).toBeVisible();
  view = await openViewMenu(page);
  await expect(view.getByTestId('menu-view-toggleComments')).toBeVisible();
  await closeAppMenu(page);
});

// Rewritten for issue #286 (PRD 023 §6): type-to-comment is retired with the
// selection popup — typing over a selection is plain typing, never a
// composer, and the Settings row that governed it is gone.
test('E37: issue #286 — typing over a selection opens nothing; no popup and no type-to-comment setting exist', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await page.waitForTimeout(200);
  await expect(page.getByTestId('marker-popup')).toHaveCount(0);
  await expect(page.getByTestId('add-note-btn')).toHaveCount(0);
  await page.keyboard.press('x');
  await page.waitForTimeout(150);
  await expect(page.getByTestId('composer')).toHaveCount(0);

  // The retired setting's row is gone from Settings → General.
  await openSettings(page, 'general');
  await expect(page.getByTestId('set-comments-enabled')).toBeVisible();
  await expect(page.getByTestId('set-type-to-comment')).toHaveCount(0);
  await saveSettings(page);
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
  await saveSettings(page);
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
  // pill (measure after the first step so the pill's fade-in has settled —
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

/** Two viewport rects do not overlap (touching edges count as clear). */
function disjoint(a: Box, b: Box): boolean {
  return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
}

test('E568: issue #305 — the navigator pill, the word-count chip and the zoom control stack in the corner, none covering another, and the stack collapses when a piece leaves', async ({
  page,
}) => {
  // SPEC14 §3 + SPEC16 §5 + PRD 011 Req 21 (issue #305): three fixed pieces
  // share the bottom-right corner. They are one vertical stack — pill on
  // top, zoom control (desktop only) beneath it, chip at the bottom edge —
  // rather than three independent fixed boxes that paint over each other.
  await addComment(page, NAV_P1, 'first');
  await addComment(page, NAV_P3, 'second');

  // The chip is on (the shim ships showWordCount on; E62 relies on the same
  // default) and a selected comment shows the pill.
  const chip = page.getByTestId('word-chip');
  const nav = page.getByTestId('comment-nav');
  await expect(chip).toBeVisible();
  await page.getByTestId('doc').locator('h1').click();
  await expect(nav).toBeHidden();
  await page.locator('mark.hl').first().click();
  await expect(nav).toBeVisible();
  await expect(page.getByTestId('comment-nav-count')).toHaveText('1 / 2');

  let navBox = await stableBox(nav);
  let chipBox = await stableBox(chip);
  expect(disjoint(navBox, chipBox)).toBe(true);
  // Above the chip, not beside or over it.
  expect(navBox.y + navBox.height).toBeLessThanOrEqual(chipBox.y);

  // Desktop (platform.semanticZoom): the docked level control joins the stack.
  await openSettings(page, 'experimental');
  await page.getByTestId('experimental-semantic-zoom').check();
  await saveSettings(page);
  const zoom = page.getByTestId('semantic-zoom-control');
  await expect(zoom).toBeVisible();
  await page.locator('mark.hl').first().click();
  await expect(nav).toBeVisible();
  navBox = await stableBox(nav);
  chipBox = await stableBox(chip);
  const zoomBox = await stableBox(zoom);
  expect(disjoint(navBox, chipBox)).toBe(true);
  expect(disjoint(navBox, zoomBox)).toBe(true);
  expect(disjoint(zoomBox, chipBox)).toBe(true);
  expect(navBox.y + navBox.height).toBeLessThanOrEqual(zoomBox.y);
  expect(zoomBox.y + zoomBox.height).toBeLessThanOrEqual(chipBox.y);

  // No reserved rows: with the chip gone (Mod+Shift+W, SPEC16 §5) the control
  // drops to where the chip's bottom edge was (the two share the stack's
  // bottom inset; 1px of slack absorbs sub-pixel rounding between the two
  // measurements), and the pill follows it down.
  await page.keyboard.press('Control+Shift+W');
  await expect(chip).toHaveCount(0);
  const dropped = await stableBox(zoom);
  expect(dropped.y + dropped.height).toBeGreaterThanOrEqual(chipBox.y + chipBox.height - 1);
  const navDropped = await stableBox(nav);
  expect(navDropped.y).toBeGreaterThan(navBox.y);
  expect(disjoint(navDropped, dropped)).toBe(true);
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
  await saveSettings(page);

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
  await sp.getByTestId('settings-save').click(); // issue #246: pending until Save
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
  await saveSettings(page);
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
  // Issue #286: a split live-preview selection authors through the Insert
  // Comment hotkey (the popup is gone; the selection still wins).
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
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
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await expect.poll(() => gapOf('composer')).toBeGreaterThanOrEqual(16);
  await page.keyboard.press('Escape');

  // Collapsed resolved section (show-resolved off), plus a live card beside it.
  await page.getByTestId('comment-card').first().click();
  await page.getByTestId('resolve-btn').click();
  await openSettings(page, 'general');
  await page.getByTestId('show-resolved').uncheck();
  await saveSettings(page);
  await addComment(page, 'markdown itself stays untouched', 'second note');
  await expect(page.getByTestId('resolved-section')).toBeVisible();
  await expect.poll(() => gapOf('resolved-section')).toBeGreaterThanOrEqual(16);
  // Expanded resolved section too.
  await page.getByTestId('resolved-section').locator('summary').click();
  await expect.poll(() => gapOf('resolved-section')).toBeGreaterThanOrEqual(16);

  // Split-edit host at the suite's pinned pane floor (fits without overflow).
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect.poll(() => gapOf('comment-card')).toBeGreaterThanOrEqual(16);
  await expect.poll(() => gapOf('resolved-section')).toBeGreaterThanOrEqual(16);

  // Rewritten for issue #284 (PRD 023 §14–§16): the panel left the split
  // pane — it is a 300px body-row sibling at the window's right edge now.
  // The #20/#24 narrow-window model becomes: the PANE keeps its full width
  // and its right-edge card gap; the workspace (doc floor 768px squeezed by
  // the pane at this 1280px window) is what scrolls sideways, and the pane
  // is never drawn over the document — they are disjoint boxes.
  await waitForSidecar(page, (s) => !!s && s.includes('second note'));
  const raw = await fsRead(page, '/config/settings.json');
  const settings = raw ? JSON.parse(raw) : {};
  settings.paneMinWidth = 768;
  await fsWrite(page, '/config/settings.json', JSON.stringify(settings));
  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comment-card').first()).toBeVisible();
  await expect.poll(() => gapOf('comment-card')).toBeGreaterThanOrEqual(16); // preview keeps the gap
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expect(page.getByTestId('comment-card').first()).toBeVisible();

  // The pane holds its fixed 300px against the squeeze (no responsive
  // shrink — PRD non-goal) and the cards keep the #19/#20 gap.
  const paneBox = (await page.getByTestId('comments-pane').boundingBox())!;
  expect(Math.round(paneBox.width)).toBe(300);
  await expect.poll(() => gapOf('comment-card')).toBeGreaterThanOrEqual(16);
  await expect.poll(() => gapOf('resolved-section')).toBeGreaterThanOrEqual(16);

  // Overflow, not overlay: narrow windows scroll exactly as today — the
  // squeezed split-preview PANE grows the horizontal scrollbar (its content
  // floors at 768px inside the ~490px half) — and the workspace never
  // extends beneath the pane's box.
  const sp = page.getByTestId('split-preview');
  const scroll = await sp.evaluate((el) => ({ width: el.scrollWidth, client: el.clientWidth }));
  expect(scroll.width).toBeGreaterThan(scroll.client);
  const wsBox = (await page.locator('.workspace').boundingBox())!;
  expect(wsBox.x + wsBox.width).toBeLessThanOrEqual(paneBox.x + 1);
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
  expect(saved).not.toContain('"2.0.0"'); // never restamped to our version

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
  await expect(indication).toContainText('3.0.0'); // the version as declared
  await expect(page.getByTestId('notice')).toHaveCount(0);
  expect(await indication.evaluate((el) => el.className)).not.toContain('mm-notice');

  // Req 15 (issue #286): the annotation hotkeys are inert over a selection…
  await selectPhrase(page, 'paragraph');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Alt+M');
  await page.keyboard.press('Control+Alt+H');
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);
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
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Alt+M');
  await page.keyboard.press('Control+Alt+H');
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(1); // the readable store's one mark

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
  await saveSettings(page);
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

// Rewritten for issue #284 (PRD 023 §15/§17): Mod+Shift+C toggles the
// comments PANE now, and the pane's state no longer gates authoring — the
// selection affordances stay offered with the pane closed (inserting a
// comment auto-opens it, E437).
test('E151: Mod+Shift+C toggles the comments pane; the selection affordances are independent of it', async ({
  page,
}) => {
  // Closed by default (PRD 023 §15).
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(page.getByTestId('comments-expand')).toBeVisible();

  // The hotkey opens the pane; chevron and View row agree on state (issue
  // #256: the toolbar button that used to carry the `on` class is gone).
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('comments-collapse')).toBeVisible();
  const viewPaneOpen = await openViewMenu(page);
  await expect(viewPaneOpen.getByTestId('menu-view-toggleComments')).toHaveAttribute('aria-checked', 'true');
  await closeAppMenu(page);

  // …and closes it again; authoring stays offered with the pane closed
  // (issue #286: proven by opening a composer via the hotkey — it lands in
  // the auto-opened pane, E437 — then cancelling leaves no record behind).
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(page.getByTestId('comments-expand')).toBeVisible();
  const viewPaneClosed = await openViewMenu(page);
  await expect(viewPaneClosed.getByTestId('menu-view-toggleComments')).toHaveAttribute('aria-checked', 'false');
  await closeAppMenu(page);
  await selectPhrase(page, PHRASE);
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
});

// Rewritten for issue #286: there is no second button to suppress any more —
// instead a second Insert Comment while a composer is pending REPLACES it,
// taking the first still-empty record with it (PRD 022 Req 1's
// no-abandoned-entry rule). One composer, one record, always.
test('E152: a second Insert Comment replaces the open composer — never two composers or a stranded empty record', async ({ page }) => {
  await selectPhrase(page, PHRASE);
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await page.getByTestId('composer-input').fill('first draft');

  // Blur the composer (a focused text field keeps its own keys), select
  // elsewhere, insert again: the composer swaps to the new, empty one.
  await page.getByTestId('doc').locator('h1').click();
  await selectPhrase(page, 'GitHub-flavored markdown');
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer-input')).toHaveValue('', { timeout: 500 });
  }).toPass({ timeout: 5000 });
  await expect(page.getByTestId('composer')).toHaveCount(1);

  await page.getByTestId('composer-input').fill('the one that lands');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('the one that lands');
  // The abandoned first record never reached the store.
  await waitForSidecar(page, (s) => !!s && s.includes('the one that lands'));
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.comments).toHaveLength(1);
});

// Rewritten for issue #286 (PRD 023 §8): the SPEC25 comment carry and the
// edit-mode popup are gone — plain edit authors through the Smart Edit menu.
test('E153: plain edit mode reaches a comment — Smart Edit ▸ Insert Comment anchors the phrase without switching modes', async ({
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

  // Select the whole middle paragraph in the editor.
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'alpha bravo' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('alpha bravo charlie delta.');

  // Issue #286 (PRD 023 §8): Smart Edit ▸ Comment ▸ Insert Comment opens the
  // composer in the auto-opened pane — the mode NEVER switches: the editor
  // stays up, no carry, no preview hop.
  await smartEditAnnotation(page, 'comment', 'insert-comment');
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  await expect(page.getByTestId('editor')).toBeVisible(); // still plain edit
  await page.getByTestId('composer-input').fill('from plain edit mode');
  await page.getByTestId('composer-submit').click();

  // The comment exists and, back in preview, highlights exactly the phrase.
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('from plain edit mode');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Edit Affordance');
  await expect.poll(async () => (await page.locator('mark.hl').allTextContents()).join('')).toBe(
    'alpha bravo charlie delta.'
  );
  const sidecarPath = `${AFFORD_PATH}.comments.json`;
  await expect.poll(() => fsRead(page, sidecarPath)).toContain('from plain edit mode');
  expect(await fsRead(page, sidecarPath)).toContain('alpha bravo charlie delta.');
});

// Rewritten for issue #286 (PRD 023 §7): the edit-mode popup is gone — the
// same gates now decide whether the Smart Edit menu carries the Comment and
// Highlight entries AT ALL (absence, the popup's all-or-nothing gate).
test('E154: the menu entries obey every gate — frozen store, master switch off — and ignore the pane toggle (issue #284)', async ({
  page,
}) => {
  const openSmartMenu = async () => {
    await page.keyboard.press('Control+.');
    await expect(page.getByTestId('smart-edit-menu')).toBeVisible();
  };
  const closeSmartMenu = async () => {
    // The menu focuses itself a beat after mounting — an early Escape can
    // land in the editor instead, so press until the menu is really gone.
    for (let i = 0; i < 4 && (await page.getByTestId('smart-edit-menu').count()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
    }
    await expect(page.getByTestId('smart-edit-menu')).toHaveCount(0);
  };

  // PRD 004 Req 15: a frozen document removes both entries from the menu.
  await fsWrite(page, NEWER_PATH, `${NEWER_DOC}${NEWER_TRAILER}`);
  await openPath(page, NEWER_PATH);
  await expect(page.getByTestId('store-unreadable')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  if (await page.getByTestId('split-preview').count()) await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'reads perfectly' }).click();
  await openSmartMenu();
  await expect(page.getByTestId('smart-edit-diagram')).toBeVisible(); // the menu itself is fine
  await expect(page.getByTestId('smart-edit-comment')).toHaveCount(0);
  await expect(page.getByTestId('smart-edit-highlight')).toHaveCount(0);
  await closeSmartMenu();

  // A clean document in the same session DOES carry them (back to plain
  // edit — opening a document lands in preview; split-off persisted)…
  await openWelcomeViaHelp(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'saved to a sidecar' }).click();
  await openSmartMenu();
  await expect(page.getByTestId('smart-edit-comment')).toBeVisible();
  await expect(page.getByTestId('smart-edit-highlight')).toBeVisible();
  await closeSmartMenu();

  // Issue #284 (PRD 023 §15): toggling the PANE (Mod+Shift+C) never
  // withholds the entries — authoring feeds the pane and auto-opens it.
  await page.keyboard.press('Control+Shift+C');
  await openSmartMenu();
  await expect(page.getByTestId('smart-edit-comment')).toBeVisible();
  await closeSmartMenu();
  await page.keyboard.press('Control+Shift+C');
  await openSmartMenu();
  await expect(page.getByTestId('smart-edit-comment')).toBeVisible();
  await closeSmartMenu();

  // …until the master switch goes off (SPEC7 §2): both entries vanish.
  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').uncheck();
  await saveSettings(page);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'saved to a sidecar' }).click();
  await openSmartMenu();
  await expect(page.getByTestId('smart-edit-diagram')).toBeVisible();
  await expect(page.getByTestId('smart-edit-comment')).toHaveCount(0);
  await expect(page.getByTestId('smart-edit-highlight')).toHaveCount(0);
  await closeSmartMenu();
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
    kind: 'comment',
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
// Rewritten for issue #286 (PRD 023 §9): color choice lives in the Smart
// Edit menu's Highlight ▸ rows now — a color row over an editor selection
// creates the note-less colored highlight; no composer opens.
test('E419: PRD 023 §9 — a Highlight ▸ color row creates a note-less colored highlight; no composer opens', async ({
  page,
}) => {
  // Into split edit (the default), select the phrase in the EDITOR pane.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'saved to a sidecar' }).first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await smartEditAnnotation(page, 'highlight', 'hl-green');
  await expect(page.getByTestId('composer')).toHaveCount(0);

  // Back in preview: the highlight painted through the existing mark path.
  // (The selected line crosses inline-code markup, so the EDITOR pane
  // rightly skips painting it — PRD 022 Req 12; editor paint is E455/E424.)
  await page.keyboard.press('Control+e');
  const mark = page.locator('mark.hl').first();
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('data-color', 'green');

  // On disk: a kind:"highlight" record — color required, no body/thread/
  // resolved (PRD 023 §1, issue #283) — in a 2.0.0 store.
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "green"'));
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.version).toBe('2.0.0');
  expect(sidecar.comments).toHaveLength(1);
  expect(sidecar.comments[0].kind).toBe('highlight');
  expect(sidecar.comments[0].body).toBeUndefined();
  expect(sidecar.comments[0].thread).toBeUndefined();
});

// Rewritten for issue #286: "add note" is Insert Comment (hotkey/menu) now.
test('E416: PRD 023 §1 (issue #283) — Insert Comment authors a comment record: no marker color, the fixed comment tint, composer attached', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });

  // The comment record already exists — painted in the comment tint, never a
  // marker hue — with the composer open and standing in for its card.
  await expect(page.getByTestId('composer')).toBeVisible();
  const mark = page.locator('mark.hl').first();
  await expect(mark).toBeVisible();
  expect(await mark.getAttribute('data-color')).toBeNull();

  await page.getByTestId('composer-input').fill('a note on a highlight');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('a note on a highlight');

  // ONE object: the note landed on the same entry — a kind:"comment" record
  // with no color key at all.
  await waitForSidecar(page, (s) => !!s && s.includes('a note on a highlight'));
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.comments).toHaveLength(1);
  expect(sidecar.comments[0].kind).toBe('comment');
  expect(sidecar.comments[0].color).toBeUndefined();
  expect(sidecar.comments[0].body).toBe('a note on a highlight');
});

// Rewritten for issue #286 (PRD 022 Req 4 semantics unchanged): the menu's
// color rows update the last-used color, and Mod+Alt+H applies exactly it.
test('E417: PRD 022 Req 4 — a menu color row re-arms the last-used color, and Mod+Alt+H applies it in the preview', async ({ page }) => {
  // Author orange through the menu — this ARMS orange.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'saved to a sidecar' }).first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await smartEditAnnotation(page, 'highlight', 'hl-orange');
  await page.keyboard.press('Control+e');
  await expect(page.locator('mark.hl[data-color="orange"]').first()).toBeVisible();

  // A preview selection plus Mod+Alt+H: the armed (last-used) color lands.
  // (Mark COUNT is per painted fragment, not per record — the menu-authored
  // line crosses inline markup and splits; the store below counts records.)
  await addHighlight(page, 'GitHub-flavored markdown');
  await expect(page.locator('mark.hl[data-color="orange"]').first()).toBeVisible();
  await waitForSidecar(page, (s) => !!s && s.split('"color": "orange"').length === 3);
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.comments).toHaveLength(2);
  expect(sidecar.comments.every((c: { kind: string; color: string }) => c.kind === 'highlight' && c.color === 'orange')).toBe(true);
});

test('E418: issue #283 — a pre-2.0.0 sidecar opens with no annotations and no notice, and new annotations save as a 2.0.0 store', async ({
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

  // PRD 023 non-goal (no 1.x migration): the document opens normally with
  // NO annotations, no error dialog and no persistent notice — the legacy
  // store is simply empty to this build.
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Legacy');
  await expect(page.locator('mark.hl')).toHaveCount(0);
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.getByTestId('store-unreadable')).toHaveCount(0);

  // Authoring is NOT frozen: the highlight hotkey (issue #286) still works,
  // and a new highlight writes a 2.0.0 store over the legacy sidecar.
  await addHighlight(page, 'commented text');
  await expect(page.locator('mark.hl[data-color="yellow"]').first()).toBeVisible();
  await expect.poll(() => fsRead(page, `${DOC}.comments.json`)).toContain('"version": "2.0.0"');
  const rewritten = (await fsRead(page, `${DOC}.comments.json`))!;
  expect(rewritten).toContain('"kind": "highlight"');
  expect(rewritten).not.toContain('an old note'); // the 1.x annotations are gone, by design
});

// Rewritten for issue #284 (PRD 023 §16) and again for issue #286: recolor
// lives in the Smart Edit menu now (E456) — but the CARDS stay swatch-free:
// an activated highlight still grows no card and no swatch row, and its
// color persists unchanged on disk.
test('E420: an activated highlight grows no card and no swatches, and its color persists unchanged', async ({
  page,
}) => {
  await addHighlight(page, PHRASE);
  const mark = page.locator('mark.hl').first();
  await expect(mark).toHaveAttribute('data-color', 'yellow');
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "yellow"'));

  // Open the pane, then activate the highlight: no card enters the flow and
  // no swatch surface exists anywhere in the pane.
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await mark.click();
  await expect(page.locator('mark.hl.active').first()).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.getByTestId('card-swatches')).toHaveCount(0);

  // The entry persists exactly as created — still a note-less highlight.
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.comments).toHaveLength(1);
  expect(sidecar.comments[0].kind).toBe('highlight');
  expect(sidecar.comments[0].color).toBe('yellow');
  expect(sidecar.comments[0].body).toBeUndefined();
});

// Rewritten for issue #284 (PRD 023 §16): the PRD 022 Req 9 transient
// active-highlight card is gone — a highlight NEVER produces a card in the
// pane, active or not. Activation still marks the text (SPEC14 §3.1).
test('E421: a highlight has no card at all — activation tints the marks, the pane stays card-free, the pill stays hidden', async ({
  page,
}) => {
  await addHighlight(page, PHRASE); // issue #286: hotkey-authored, armed color
  const mark = page.locator('mark.hl').first();
  await expect(mark).toBeVisible();

  // Pane open, highlight active: still no card and no pill.
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await mark.click();
  await expect(page.locator('mark.hl.active').first()).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.getByTestId('comment-nav')).toBeHidden();

  // Click-away deactivates (SPEC14 §3.1); the pane is unchanged.
  await page.getByTestId('doc').locator('h1').click();
  await expect(page.locator('mark.hl.active')).toHaveCount(0);
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
});

// Rewritten for issue #284 (PRD 023 §16): with the highlight's transient
// card retired, the card-side "add note" route is gone with it — a
// highlight's note/remove surfaces return in the menu slice (PRD 023 Reqs
// 8–9). The popup's "add note" (a fresh comment record, E416) is the one
// note-authoring route this slice keeps.
test('E422: an active highlight offers no card-side add-note — the record stays a highlight on disk', async ({
  page,
}) => {
  await addHighlight(page, PHRASE); // issue #286: hotkey-authored, armed color
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "yellow"'));
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await page.locator('mark.hl').first().click();

  await expect(page.locator('mark.hl.active').first()).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.getByTestId('card-add-note')).toHaveCount(0);

  // Nothing was re-authored: still ONE note-less highlight record.
  const sidecar = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(sidecar.comments).toHaveLength(1);
  expect(sidecar.comments[0].kind).toBe('highlight');
  expect(sidecar.comments[0].body).toBeUndefined();
});

// Rewritten for issue #284 (PRD 023 §16): the note-less card this test drove
// no longer exists — reply/resolve/edit stay comment-card affordances, and a
// highlight's remove surface is deferred to the menu slice (PRD 023 Req 9).
test('E423: comment cards keep reply/resolve/delete; a highlight, cardless, exposes none of them', async ({
  page,
}) => {
  await addHighlight(page, PHRASE); // issue #286: hotkey-authored, armed color
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "yellow"'));
  await addComment(page, 'GitHub-flavored markdown', 'a real thread');

  // The pane holds exactly the comment's card — the highlight contributes
  // nothing, so every visible authoring control belongs to the comment.
  const card = page.getByTestId('comment-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('reply-btn')).toBeVisible();
  await expect(card.getByTestId('resolve-btn')).toBeVisible();
  await expect(card.getByTestId('delete-btn')).toHaveText('Delete');
  await expect(page.getByTestId('card-add-note')).toHaveCount(0);
  await expect(page.getByTestId('card-swatches')).toHaveCount(0);

  // Deleting the comment leaves the highlight's marks painted and its record
  // on disk — the two kinds' lifecycles stay independent.
  await card.getByTestId('delete-btn').click();
  await card.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.locator('mark.hl[data-color="yellow"]').first()).toBeVisible();
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "yellow"') && !s.includes('a real thread'));
});

test('E428: PRD 022 Req 10 — off the hosted platform an active highlight offers no copy-link control', async ({
  page,
}) => {
  // PRD 020 Req 15 gates every share placement hosted-only; the dev shim
  // (this suite's platform) activates the marks fine but grafts no control.
  // Issue #284 (PRD 023 §16): activation shows on the marks — a highlight
  // has no card to carry the state any more.
  await addHighlight(page, PHRASE); // issue #286: hotkey-authored
  await page.locator('mark.hl').first().click();
  await expect(page.locator('mark.hl.active').first()).toBeVisible();
  await expect(page.getByTestId('mm-hl-link')).toHaveCount(0);
});

test('E449: PRD 023 §20 (issue #288) — off the hosted platform a comment card offers no copy-link control', async ({
  page,
}) => {
  // PRD 020 Req 15 gates every share placement hosted-only; the dev shim
  // (this suite's platform) renders the card with its thread controls but
  // no card-side copy-link — there is no canonical URL to copy.
  await addComment(page, PHRASE, 'No address to share');
  const card = page.getByTestId('comment-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('reply-btn')).toBeVisible();
  await expect(card.getByTestId('copy-link-comment')).toHaveCount(0);
});

test('E424: PRD 022 Req 12 — a highlight paints in the plain-edit editor as a background decoration in its color', async ({
  page,
}) => {
  await addHighlight(page, PHRASE); // issue #286: hotkey-authored, armed color
  await expect(page.locator('mark.hl[data-color="yellow"]').first()).toBeVisible();

  // PLAIN edit: split off (it defaults on), so no preview pane exists.
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  const hl = editor.locator('.mm-hl');
  await expect(hl.first()).toBeVisible();
  await expect(hl.first()).toHaveAttribute('data-color', 'yellow');
  // The decoration covers exactly the anchored quote (spans join if CM splits).
  await expect.poll(async () => (await hl.allTextContents()).join('')).toBe(PHRASE);
  // …and the marker CSS actually lands on it.
  expect(await hl.first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});

// Rewritten for issue #285 (PRD 023 §18): the split-edit editor click is
// two-way sync now — a comment range opens the closed pane and activates its
// card; a highlight range keeps its no-pane-effect contract. Rewritten again
// for issue #341: the gesture is the SPEC43 §11 link gesture — a ⌘/Ctrl
// click; a plain click only places the caret (E593).
test('E425: PRD 022 Req 12 — the split-edit editor paints too, and a modifier-click on a painted range activates the marks in the preview', async ({
  page,
}) => {
  await addHighlight(page, PHRASE); // issue #286: hotkey-authored, armed color
  await expect(page.locator('mark.hl[data-color="yellow"]').first()).toBeVisible();
  await addComment(page, NAV_P1, 'a split-edit card');
  // Authoring auto-opened the pane (E437) — close it so both clicks below
  // start from the persisted-closed state.
  await page.getByTestId('comments-collapse').click();
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);

  await page.keyboard.press('Control+e'); // splitEdit defaults on — split edit
  await expect(page.getByTestId('split-divider')).toBeVisible();

  const editor = page.getByTestId('editor');
  const hl = editor.locator('.mm-hl[data-color="yellow"]');
  await expect(hl.first()).toBeVisible();

  // The highlight range: a ⌘/Ctrl click shows activation on the preview
  // marks, and the pane stays closed — a highlight has no pane effect
  // (PRD 023 §18, amended by issue #341).
  await hl.first().click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('mark.hl.active').first()).toBeVisible();
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(page.getByTestId('comment-card')).toHaveCount(0);

  // The comment range (no data-color): the modifier-click opens the pane,
  // activates the card, and reveals it (PRD 023 §18, issues #285/#341).
  const commentHl = editor.locator('.mm-hl:not([data-color])');
  await expect(commentHl.first()).toBeVisible();
  await commentHl.first().click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveClass(/active/);
  await expect(page.getByTestId('comment-card')).toBeInViewport();
});

// Updated for issue #341 (the PRD 023 Req 21 "updated to the new UX, not
// deleted" precedent): the editor locates quotes in the source's VISIBLE
// text now, so the `absent` entry — rendered "bold prose" across a `**`
// marker — paints over the source span from its first through its last
// visible character; the `ambiguous` entry still never paints.
test('E426: PRD 022 Req 12 — an ambiguous quote does not paint in the editor, while a quote crossing inline syntax paints over its visible-text match (issue #341)', async ({
  page,
}) => {
  const DOC = '/docs/best-effort.md';
  // Issue #341: the app re-derives each anchor's context to CONTEXT_LENGTH
  // (32) rendered characters, and the visible-text mapping scores that
  // context across block boundaries — so for the twins to stay genuinely
  // ambiguous, the 32 characters on each side of "twin phrase" must agree
  // inside the line itself (the old byte-exact mapping tied one character
  // earlier, at the block break).
  const twinLine = 'a fully identical sentence with the twin phrase inside it and identical padding after.';
  await fsWrite(
    page,
    DOC,
    `# Best effort\n\nSome **bold** prose here.\n\n${twinLine}\n\n${twinLine}\n\nA unique control phrase paints.\n`
  );
  const entry = (id: string, color: string, exact: string, prefix: string, suffix: string) => ({
    kind: 'highlight',
    id,
    author: 'Reader',
    createdAt: '2026-01-01T00:00:00.000Z',
    color,
    anchor: { exact, prefix, suffix, start: 0, end: exact.length },
  });
  await fsWrite(
    page,
    `${DOC}.comments.json`,
    JSON.stringify(
      {
        version: '2.0.0',
        comments: [
          // Rendered "bold prose" crosses a ** marker in source: absent
          // byte-for-byte, present in the visible text (issue #341) — it
          // paints over `bold** prose`.
          entry('absent', 'green', 'bold prose', 'Some ', ' here.'),
          // "twin phrase" occurs twice in source with identical context: ambiguous.
          entry('ambiguous', 'pink', 'twin phrase', 'identical sentence with the ', ' inside it and identical padding'),
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

  // …the editor paints the two the source places confidently and never the
  // ambiguous one.
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  const hl = editor.locator('.mm-hl');
  // Distinct ids, not elements: the syntax highlighting splits a range that
  // crosses a `**` token into several spans.
  await expect
    .poll(async () => [...new Set(await hl.evaluateAll((els) => els.map((el) => el.getAttribute('data-cid'))))].sort())
    .toEqual(['absent', 'unique']);
  await expect(editor.locator('.mm-hl[data-cid="ambiguous"]')).toHaveCount(0);
  await expect(editor.locator('.mm-hl[data-cid="unique"]')).toHaveAttribute('data-color', 'yellow');
  const crossing = editor.locator('.mm-hl[data-cid="absent"]');
  await expect(crossing.first()).toHaveAttribute('data-color', 'green');
  // First through last visible character: the closing ** between them is
  // painted along, the opening ** before them is not.
  await expect.poll(async () => (await crossing.allTextContents()).join('')).toBe('bold** prose');
});

// Rewritten for issue #285 (PRD 023 §18): plain edit is no longer paint-only
// — clicks are wired here too. Rewritten for issue #341: the activation
// gesture is a ⌘/Ctrl click, which leaves the selection exactly where it
// was; a HIGHLIGHT still has no pane effect (the mark treatment is its whole
// surface); a plain click only places the caret, and the unpaint-over-
// mispaint rule is unchanged. The comment side of the plain-edit gesture is
// E444's.
test('E427: PRD 022 Req 12 — a plain-edit highlight modifier-click gives the active cue, opens nothing and moves no caret; a plain click places the caret and an edited quote unpaints', async ({
  page,
}) => {
  await addHighlight(page, PHRASE); // issue #286: hotkey-authored, armed color
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "yellow"'));

  // PLAIN edit: split off (it defaults on).
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  const editor = page.getByTestId('editor');
  const hl = editor.locator('.mm-hl');
  await expect(hl.first()).toBeVisible();

  // Park the caret on the visual line above the phrase (a plain click into
  // the range places it, ArrowUp moves it off the quote without scrolling)
  // and mark the spot with a keystroke; then modifier-click the range.
  await hl.first().click();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('Qz');
  await expect(editor.locator('.cm-content')).toContainText('Qz');
  await hl.first().click({ modifiers: ['ControlOrMeta'] });

  // A highlight has no pane effect (PRD 023 §18): no card, no pane opening.
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.getByTestId('panel')).toHaveCount(0);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  // …but the click DID reach the record: the decoration carries the active cue.
  await expect(editor.locator('.mm-hl.active').first()).toBeVisible();
  // The modified click claimed the event: the caret is still where the
  // marker left it (no move, no second cursor), so the next keystroke lands
  // right after it and the quote — still intact — stays painted.
  await page.keyboard.type('R');
  await expect(editor.locator('.cm-content')).toContainText('QzR');
  await expect.poll(async () => (await hl.allTextContents()).join('')).toBe(PHRASE);

  // A plain click is ordinary caret placement: typing edits at the clicked
  // point, which breaks the quote — the highlight skips (unpaints) rather
  // than guessing at a range.
  await hl.first().click();
  await page.keyboard.type('X');
  await expect(editor.locator('.cm-content')).toContainText('X');
  await expect(hl).toHaveCount(0);
});

// --- Issue #308: comment records paint in the editor; View ▸ Editor Highlights

/**
 * Issue #308: the editor-pane paint a COMMENT record must show — the fixed
 * comment tint (no data-color), a non-transparent background, and the joined
 * `.mm-hl` text equal to the anchored quote (spans join if CM splits).
 */
async function expectCommentTintOver(hl: Locator, quote: string): Promise<void> {
  await expect(hl.first()).toBeVisible();
  await expect(hl.first()).not.toHaveAttribute('data-color', /./);
  await expect.poll(async () => (await hl.allTextContents()).join('')).toBe(quote);
  expect(await hl.first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
}

test('E561: issue #308 — a comment record (no marker color) paints in plain edit and in split edit with the fixed comment tint over exactly its quote', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'an editor-painted note');
  await waitForSidecar(page, (s) => !!s && s.includes('an editor-painted note'));
  await expect(page.locator('mark.hl:not([data-color])').first()).toBeVisible();

  // PLAIN edit: split off (it defaults on), so no preview pane exists.
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  const hl = editor.locator('.mm-hl');
  await expectCommentTintOver(hl, PHRASE);

  // SPLIT edit: the same paint beside the preview's mark.
  await page.keyboard.press('Control+e'); // back to preview
  await expect(editor).toHaveCount(0);
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expectCommentTintOver(hl, PHRASE);
  await expect(page.locator('mark.hl').first()).toBeVisible();
});

test('E562: issue #308 — toggling Editor Highlights off removes every editor decoration live, leaves the preview marks and the pane, and on again repaints', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'a toggled note');
  await addHighlight(page, NAV_P1);
  await waitForSidecar(page, (s) => !!s && s.includes('"color": "yellow"'));
  await expect(page.locator('mark.hl')).toHaveCount(2);
  await expect(page.getByTestId('comments-pane')).toBeVisible(); // authoring opened it (E437)

  await page.keyboard.press('Control+e'); // splitEdit defaults on — split edit
  await expect(page.getByTestId('split-divider')).toBeVisible();
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.mm-hl:not([data-color])').first()).toBeVisible();
  await expect(editor.locator('.mm-hl[data-color="yellow"]').first()).toBeVisible();

  // Off: no `.mm-hl` remains in the editor — the preview's marks, the pane
  // and its card are untouched, and no mode switch or remount happened
  // (the same .cm-content is still on screen).
  await page.evaluate(() => window.__mmDispatch!('toggleEditorHighlights'));
  await expect(editor.locator('.mm-hl')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(2);
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(editor.locator('.cm-content')).toBeVisible();

  // On again: both records repaint in place.
  await page.evaluate(() => window.__mmDispatch!('toggleEditorHighlights'));
  await expect(editor.locator('.mm-hl:not([data-color])').first()).toBeVisible();
  await expect(editor.locator('.mm-hl[data-color="yellow"]').first()).toBeVisible();
  await expect(page.locator('mark.hl')).toHaveCount(2);
});

test('E563: issue #308 — the Editor Highlights off state is a persisted setting: it survives a reload', async ({ page }) => {
  await addComment(page, PHRASE, 'a persisted-off note');
  await waitForSidecar(page, (s) => !!s && s.includes('a persisted-off note'));
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.mm-hl').first()).toBeVisible();
  await page.evaluate(() => window.__mmDispatch!('toggleEditorHighlights'));
  await expect(editor.locator('.mm-hl')).toHaveCount(0);
  // The write lands in settings.json before the reload.
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"editorHighlights": false');

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.locator('mark.hl').first()).toBeVisible(); // the preview still paints
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  // Give the (debounced) mapping a beat: with the setting off nothing paints.
  await page.waitForTimeout(500);
  await expect(page.getByTestId('editor').locator('.mm-hl')).toHaveCount(0);

  // Back on after the reload: the range paints again.
  await page.evaluate(() => window.__mmDispatch!('toggleEditorHighlights'));
  await expect(page.getByTestId('editor').locator('.mm-hl').first()).toBeVisible();
});

// --- Issue #284 (PRD 023 Reqs 14–17): the dedicated comments pane ----------

test('E435: the comments pane ships closed; the second chevron opens and closes it; the state survives a reload; print never shows it', async ({
  page,
}) => {
  // Closed by default (PRD 023 §15): no pane, and the chevron shows the
  // closed state at the right of the workspace's top-right cluster.
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(page.getByTestId('comments-expand')).toBeVisible();

  // The chevron opens the pane — fixed at 300px (PRD 023 §15), hugging the
  // page's right edge on the ground (PRD 025 Req 11, issue #331).
  await page.getByTestId('comments-expand').click();
  const pane = page.getByTestId('comments-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('comments-collapse')).toBeVisible();
  await expect.poll(async () => Math.round((await pane.boundingBox())!.width)).toBe(300);
  // …at the workspace's right edge: the pane's right edge is the window's
  // (polled — layout settles a frame after the mount; issue #328: no slide).
  const innerWidth = await page.evaluate(() => window.innerWidth);
  await expect
    .poll(async () => {
      const b = (await pane.boundingBox())!;
      return Math.round(b.x + b.width);
    })
    .toBe(innerWidth);

  // Print (PRD 023 §15): the pane is chrome — never on paper.
  await page.emulateMedia({ media: 'print' });
  await expect.poll(() => page.locator('.comments-wrap').evaluate((el) => getComputedStyle(el).display)).toBe('none');
  await page.emulateMedia({ media: 'screen' });

  // Open state persists across a reload (PRD 023 §15)…
  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comments-pane')).toBeVisible();

  // …and so does closed, via the open pane's chevron.
  await page.getByTestId('comments-collapse').click();
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await page.reload();
  await openWelcomeViaHelp(page);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(page.getByTestId('comments-expand')).toBeVisible();
});

test('E436: the pane is the single home for cards in all three modes — full preview, split, and plain edit', async ({
  page,
}) => {
  // Full preview: authoring lands the card in the pane (which auto-opened).
  await addComment(page, PHRASE, 'a card for every mode');
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  // …and the in-preview aside is gone for good (PRD 023 §16): the panel
  // lives in the pane, not in the preview's scroller.
  await expect(page.locator('.workspace .panel')).toHaveCount(0);
  await expect(page.getByTestId('comments-pane').getByTestId('panel')).toBeVisible();

  // Split edit: same pane, same card, reached by the same state.
  await page.keyboard.press('Control+e'); // splitEdit defaults on
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.locator('[data-testid="split-preview"] .panel')).toHaveCount(0);

  // Plain edit: the split closes, the pane stays — the card flow anchors
  // against the editor's painted decoration (PRD 022 Req 12's .mm-hl).
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  const hl = page.getByTestId('editor').locator('.mm-hl').first();
  await expect(hl).toBeVisible();
  // Balloon flow (SPEC6 §2): the card settles level with its anchor (±10px,
  // polled through the 180ms glide).
  await expect
    .poll(async () => {
      const card = (await page.getByTestId('comment-card').boundingBox())!;
      const mark = (await hl.boundingBox())!;
      return Math.abs(card.y - mark.y);
    })
    .toBeLessThanOrEqual(10);
});

test('E437: inserting a comment auto-opens the closed pane, with the composer reachable in it', async ({ page }) => {
  await expect(page.getByTestId('comments-pane')).toHaveCount(0); // closed by default
  await selectPhrase(page, PHRASE);
  // Issue #286: authoring is the Insert Comment hotkey now.
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  // The pane opened programmatically (no user toggle) and hosts the composer.
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('comments-pane').getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  await page.getByTestId('composer-input').fill('opened by authoring');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
});

test('E438: the commentsEnabled master switch removes pane and chevron together, and no route toggles the pane back on', async ({
  page,
}) => {
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByTestId('comments-pane')).toBeVisible();

  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').uncheck();
  await saveSettings(page);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(page.getByTestId('comments-collapse')).toHaveCount(0);
  await expect(page.getByTestId('comments-expand')).toHaveCount(0);

  // The command routes are inert while the switch is off (SPEC7 §2 / E36).
  await page.keyboard.press('Control+Shift+C');
  await page.waitForTimeout(150);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);

  // Re-enabling restores the pane exactly where it was — the persisted open
  // state was never destroyed.
  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').check();
  await saveSettings(page);
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('comments-collapse')).toBeVisible();
});

// --- Issue #285 (PRD 023 Reqs 5 + 18): overlap layers and two-way sync ------

// A document seeded with an identical-range pair (comment + highlight over
// the same quote) and an intersecting pair, in plain unique prose so the
// SOURCE places every anchor too (PRD 022 Req 12).
const OVERLAP_DOC = '/docs/overlap.md';
const OVERLAP_SIDECAR = `${OVERLAP_DOC}.comments.json`;
async function seedOverlapDoc(page: import('@playwright/test').Page): Promise<void> {
  await fsWrite(
    page,
    OVERLAP_DOC,
    '# Overlap\n\nalpha bravo charlie delta echo foxtrot.\n\nThe quick brown fox jumps over the lazy dog tonight.\n'
  );
  const base = { author: 'Reader', createdAt: '2026-01-01T00:00:00.000Z' };
  const anchor = (exact: string, prefix: string, suffix: string) => ({
    exact,
    prefix,
    suffix,
    start: 0,
    end: exact.length,
  });
  await fsWrite(
    page,
    OVERLAP_SIDECAR,
    JSON.stringify(
      {
        version: '2.0.0',
        comments: [
          { kind: 'comment', id: 'c-same', ...base, body: 'same note', resolved: false, thread: [], anchor: anchor('bravo charlie delta', 'alpha ', ' echo') },
          { kind: 'highlight', id: 'h-same', ...base, color: 'green', anchor: anchor('bravo charlie delta', 'alpha ', ' echo') },
          { kind: 'comment', id: 'c-cross', ...base, body: 'cross note', resolved: false, thread: [], anchor: anchor('quick brown fox', 'The ', ' jumps') },
          { kind: 'highlight', id: 'h-cross', ...base, color: 'pink', anchor: anchor('brown fox jumps', 'quick ', ' over') },
        ],
      },
      null,
      2
    )
  );
  await page.goto(`/#open=${OVERLAP_DOC}`);
}

test('E439: PRD 023 Req 5 — identical and intersecting comment+highlight pairs paint as two independent layers in the preview', async ({
  page,
}) => {
  await seedOverlapDoc(page);

  // Every record paints — no record's paint replaces another's.
  for (const cid of ['c-same', 'h-same', 'c-cross', 'h-cross']) {
    await expect(page.locator(`mark.hl[data-cid="${cid}"]`).first()).toBeVisible();
  }
  // The comment layer carries no marker color; the highlight layer does.
  expect(await page.locator('mark.hl[data-cid="c-same"]').first().getAttribute('data-color')).toBeNull();
  await expect(page.locator('mark.hl[data-cid="h-same"]').first()).toHaveAttribute('data-color', 'green');
  await expect(page.locator('mark.hl[data-cid="h-cross"]').first()).toHaveAttribute('data-color', 'pink');

  // Each layer covers its own full range, identical or merely intersecting.
  await expect.poll(async () => (await page.locator('mark.hl[data-cid="c-same"]').allTextContents()).join('')).toBe('bravo charlie delta');
  await expect.poll(async () => (await page.locator('mark.hl[data-cid="c-cross"]').allTextContents()).join('')).toBe('quick brown fox');
  await expect.poll(async () => (await page.locator('mark.hl[data-cid="h-cross"]').allTextContents()).join('')).toBe('brown fox jumps');

  // The overlapped runs are genuinely stacked marks (highlightRange nests the
  // later record inside the earlier one), and the stacked run's paint is the
  // stronger mark.hl mark.hl treatment — not transparent, not the idle tint.
  const nested = page.locator('mark.hl mark.hl');
  await expect(nested.first()).toBeVisible();
  expect(await nested.count()).toBeGreaterThanOrEqual(2); // one per pair
  // The comment tint and the marker hue are distinct paints in one document.
  const commentBg = await page.locator('mark.hl[data-cid="c-cross"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const markerBg = await page.locator('mark.hl[data-cid="h-cross"]').last().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(commentBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(markerBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(commentBg).not.toBe(markerBg);
});

test('E440: PRD 023 Req 5 — the same pairs paint as two decorations each in the editor, comment tint-less and highlight colored', async ({
  page,
}) => {
  await seedOverlapDoc(page);
  await expect(page.locator('mark.hl[data-cid="h-cross"]').first()).toBeVisible();

  // PLAIN edit: split off (it defaults on).
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);

  const editor = page.getByTestId('editor');
  // A pair the source can place paints as TWO decorations, never as one:
  // the comment's with no data-color, the highlight's with its color.
  for (const cid of ['c-same', 'h-same', 'c-cross', 'h-cross']) {
    await expect(editor.locator(`.mm-hl[data-cid="${cid}"]`).first()).toBeVisible();
  }
  expect(await editor.locator('.mm-hl[data-cid="c-same"]').first().getAttribute('data-color')).toBeNull();
  await expect(editor.locator('.mm-hl[data-cid="h-same"]').first()).toHaveAttribute('data-color', 'green');
  await expect(editor.locator('.mm-hl[data-cid="h-cross"]').first()).toHaveAttribute('data-color', 'pink');
  // Each decoration covers its record's own source range (spans join if CM
  // splits them across nested layers).
  await expect.poll(async () => (await editor.locator('.mm-hl[data-cid="c-same"]').allTextContents()).join('')).toContain('bravo charlie delta');
  await expect.poll(async () => (await editor.locator('.mm-hl[data-cid="h-cross"]').allTextContents()).join('')).toContain('brown fox jumps');
});

test('E441: PRD 023 Req 5 — activating, resolving or deleting one layer never mutates the other', async ({
  page,
}) => {
  await seedOverlapDoc(page);
  await expect(page.locator('mark.hl[data-cid="h-same"]').first()).toBeVisible();
  await openCommentsPane(page);

  // Activating the comment adds the active treatment to ITS marks only.
  await page.locator('[data-testid="comment-card"][data-cid="c-same"]').click();
  await expect(page.locator('mark.hl.active[data-cid="c-same"]').first()).toBeVisible();
  await expect(page.locator('mark.hl.active[data-cid="h-same"]')).toHaveCount(0);

  // Resolving the comment ghosts the comment's marks only (showResolved
  // defaults on, SPEC7 §4); the highlight keeps painting at full strength.
  await page.locator('[data-testid="comment-card"][data-cid="c-same"]').getByTestId('resolve-btn').click();
  await expect(page.locator('mark.hl.ghost[data-cid="c-same"]').first()).toBeVisible();
  await expect(page.locator('mark.hl.ghost[data-cid="h-same"]')).toHaveCount(0);
  await expect(page.locator('mark.hl[data-cid="h-same"]').first()).toBeVisible();

  // Deleting the intersecting comment leaves the highlight painted and its
  // record on disk, color and kind untouched.
  const crossCard = page.locator('[data-testid="comment-card"][data-cid="c-cross"]');
  await crossCard.getByTestId('delete-btn').click();
  await crossCard.getByTestId('confirm-delete').click();
  await expect(page.locator('mark.hl[data-cid="c-cross"]')).toHaveCount(0);
  await expect(page.locator('mark.hl[data-cid="h-cross"]').first()).toBeVisible();
  await expect
    .poll(async () => {
      const s = await fsRead(page, OVERLAP_SIDECAR);
      return !!s && s.includes('"color": "pink"') && !s.includes('cross note');
    })
    .toBe(true);

  // Deleting the highlight (store-side — this slice ships no highlight-remove
  // UI, PRD 023 Req 9 is the menu slice) leaves the comment record, its card,
  // its thread and its paint untouched.
  const store = JSON.parse((await fsRead(page, OVERLAP_SIDECAR))!);
  store.comments = store.comments.filter((c: { id: string }) => c.id !== 'h-same');
  await fsWrite(page, OVERLAP_SIDECAR, JSON.stringify(store, null, 2));
  await page.reload(); // the #open hash re-opens the document against the rewritten store
  await expect(page.locator('mark.hl[data-cid="h-same"]')).toHaveCount(0);
  await expect(page.locator('mark.hl.ghost[data-cid="c-same"]').first()).toBeVisible(); // still resolved, still painted
  // …and its card still carries the body (showResolved defaults on, so the
  // resolved comment rides the flow as a ghost card).
  await expect(page.locator('[data-testid="comment-card"][data-cid="c-same"]')).toContainText('same note');
});

test('E442: PRD 023 Req 18 — clicking the overlapped run in the preview resolves to the comment and opens the closed pane onto its card', async ({
  page,
}) => {
  await seedOverlapDoc(page);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0); // closed by default

  // The overlapped run hosts BOTH records' marks; the kind-aware rule picks
  // the comment (PRD 023 §5), and the click opens the pane, activates the
  // card and reveals it — surviving the pane's mount.
  await page.locator('mark.hl[data-cid="h-same"]').first().click();
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  const card = page.locator('[data-testid="comment-card"][data-cid="c-same"]');
  await expect(card).toHaveClass(/active/);
  await expect(card).toBeInViewport();
  await expect(page.locator('mark.hl.active[data-cid="c-same"]').first()).toBeVisible();
  // The persisted setting flipped, so the pane STAYS open (PRD 023 §18).
  await page.reload();
  await page.goto(`/#open=${OVERLAP_DOC}`);
  await expect(page.getByTestId('comments-pane')).toBeVisible();
});

test('E443: PRD 023 Req 18 — clicking a run the highlight covers alone activates the highlight and has no pane effect', async ({
  page,
}) => {
  await seedOverlapDoc(page);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);

  // h-cross's LAST fragment (" jumps") lies outside the comment's range: the
  // hit set is the highlight alone, and a highlight never touches the pane.
  await page.locator('mark.hl[data-cid="h-cross"]').last().click();
  await expect(page.locator('mark.hl.active[data-cid="h-cross"]').first()).toBeVisible();
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
});

// Rewritten for issue #341: the editor's activation gesture is a ⌘/Ctrl
// click (the SPEC43 §11 link gesture); the plain click is E593's.
test('E444: PRD 023 Req 18 — a modifier-click on a comment decoration in the PLAIN edit editor opens the closed pane and activates the card', async ({
  page,
}) => {
  await seedOverlapDoc(page);
  await expect(page.locator('mark.hl[data-cid="c-cross"]').first()).toBeVisible();
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0); // still closed

  const editor = page.getByTestId('editor');
  await expect(editor.locator('.mm-hl[data-cid="c-cross"]').first()).toBeVisible();
  // The modifier-click lands inside the intersecting pair's shared run — the
  // editor reports every covering range and the kind rule picks the comment.
  await editor.locator('.mm-hl[data-cid="c-cross"]').first().click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  const card = page.locator('[data-testid="comment-card"][data-cid="c-cross"]');
  await expect(card).toHaveClass(/active/);
  await expect(card).toBeInViewport();
  // The activation cue exists on the editor side too: the active card's
  // decoration is visibly distinguishable (PRD 023 §18, editor half).
  await expect(editor.locator('.mm-hl.active[data-cid="c-cross"]').first()).toBeVisible();
});

test('E593: issue #341 — a PLAIN click on a comment decoration in plain edit is inert: no activation, no pane, no card — the caret simply lands where clicked', async ({
  page,
}) => {
  await seedOverlapDoc(page);
  await expect(page.locator('mark.hl[data-cid="c-cross"]').first()).toBeVisible();
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);

  const editor = page.getByTestId('editor');
  const hl = editor.locator('.mm-hl[data-cid="c-cross"]');
  await expect(hl.first()).toBeVisible();
  await hl.first().click();
  // Nothing activates: no pane, no card, no active cue on any decoration.
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(editor.locator('.mm-hl.active')).toHaveCount(0);
  // The caret landed where the click fell — inside the clicked run — so a
  // typed character appears within "quick brown fox".
  await page.keyboard.type('X');
  const line = editor.locator('.cm-line').filter({ hasText: /X/ }); // regex: a string match is case-insensitive ('fox')
  await expect(line).toHaveCount(1);
  const text = await line.textContent();
  const x = text!.indexOf('X');
  expect(x).toBeGreaterThanOrEqual(text!.indexOf('quick'));
  expect(x).toBeLessThanOrEqual(text!.indexOf('fox') + 'fox'.length);
  // And still no activation after the edit.
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(editor.locator('.mm-hl.active')).toHaveCount(0);
});

// --- Issue #341: the editor paints what the preview paints -----------------

const SYNTAX_DOC = '/docs/inline-syntax.md';
const SYNTAX_SOURCE = [
  '# Heading words here',
  '',
  'Some **bold** prose and *em* text with `code()` inside, then [link text](https://example.com/x) after, and 5\\*3 escaped.',
  '',
  'A soft',
  'line break here.',
  '',
  '- list item words',
  '',
  '> quoted words here',
  '',
].join('\n');

/**
 * Issue #341: a document whose quotes all cross inline syntax, with one
 * record per construct. `exact` is the RENDERED text (what the preview's
 * anchoring stores); the editor must paint each over the source span from
 * the quote's first through its last visible character.
 */
async function seedSyntaxDoc(page: import('@playwright/test').Page): Promise<void> {
  await fsWrite(page, SYNTAX_DOC, SYNTAX_SOURCE);
  const base = { author: 'Reader', createdAt: '2026-01-01T00:00:00.000Z' };
  const anchor = (exact: string, prefix: string, suffix: string) => ({ exact, prefix, suffix, start: 0, end: exact.length });
  const hl = (id: string, color: string, exact: string, prefix: string, suffix: string) => ({
    kind: 'highlight',
    id,
    ...base,
    color,
    anchor: anchor(exact, prefix, suffix),
  });
  await fsWrite(
    page,
    `${SYNTAX_DOC}.comments.json`,
    JSON.stringify(
      {
        version: '2.0.0',
        comments: [
          { kind: 'comment', id: 'c-bold', ...base, body: 'bold note', resolved: false, thread: [], anchor: anchor('bold prose', 'Some ', ' and ') },
          hl('h-em', 'green', 'em text with code()', 'and ', ' inside'),
          hl('h-link', 'pink', 'link text after', 'then ', ', and'),
          hl('h-esc', 'orange', '5*3 escaped', 'and ', '.'),
          hl('h-soft', 'yellow', 'soft\nline break', 'A ', ' here'),
          hl('h-head', 'green', 'Heading words', '', ' here'),
          hl('h-list', 'pink', 'list item words', '', ''),
          hl('h-quote', 'orange', 'quoted words', '', ' here'),
        ],
      },
      null,
      2
    )
  );
  await page.goto(`/#open=${SYNTAX_DOC}`);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Heading words here');
}

/** The source text each record must paint over in the editor (CM lines join without their break). */
const SYNTAX_PAINT: Record<string, string> = {
  'c-bold': 'bold** prose',
  'h-em': 'em* text with `code()',
  'h-esc': '5\\*3 escaped',
  'h-soft': 'softline break',
  'h-head': 'Heading words',
  'h-list': 'list item words',
  'h-quote': 'quoted words',
};

async function expectSyntaxPaint(editor: Locator, paint: Record<string, string>): Promise<void> {
  for (const [cid, text] of Object.entries(paint)) {
    const hl = editor.locator(`.mm-hl[data-cid="${cid}"]`);
    await expect(hl.first()).toBeVisible();
    await expect.poll(async () => (await hl.allTextContents()).join(''), { message: cid }).toBe(text);
  }
}

test('E590: issue #341 — quotes crossing strong/em, inline code, link text, escapes, a soft line break and block prefixes paint in split edit and plain edit over their visible-text span, and a card click activates the editor decoration', async ({
  page,
}) => {
  await seedSyntaxDoc(page);
  // With the rendered-links view on (its default) the link's `](url)` is
  // hidden from the DOM, so the painted text reads as the rendered text.
  const paint = { ...SYNTAX_PAINT, 'h-link': 'link text after' };

  // Split edit (the default).
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  const editor = page.getByTestId('editor');
  await expectSyntaxPaint(editor, paint);
  await expect(editor.locator('.mm-hl[data-cid="c-bold"]').first()).not.toHaveAttribute('data-color', /./);
  await expect(editor.locator('.mm-hl[data-cid="h-esc"]').first()).toHaveAttribute('data-color', 'orange');

  // Plain edit.
  await page.keyboard.press('Control+e');
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  await expectSyntaxPaint(editor, paint);

  // Pane → editor: activating the formatted-text comment's card lands the
  // active cue and the reveal flash on its decoration (PRD 023 §18).
  await openCommentsPane(page);
  await page.waitForTimeout(300); // the mapping's 200ms debounce (E445)
  await page.locator('[data-testid="comment-card"][data-cid="c-bold"]').click();
  await expect(editor.locator('.mm-hl.active[data-cid="c-bold"]').first()).toBeVisible();
  await expect(editor.locator('.mm-hl.flash[data-cid="c-bold"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="comment-card"][data-cid="c-bold"]')).toHaveClass(/active/);
});

test('E591: issue #341 — with the rendered-links view off, a quote through link text paints the raw `](url)` tail along in plain edit', async ({
  page,
}) => {
  await seedSyntaxDoc(page);
  await openSettings(page, 'editor');
  await page.getByTestId('settings-link-view').uncheck();
  await saveSettings(page);
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.mm-link-view')).toHaveCount(0);
  await expectSyntaxPaint(editor, { ...SYNTAX_PAINT, 'h-link': 'link text](https://example.com/x) after' });
});

test('E592: issue #341 — a modifier-click on text that is both a link and a painted comment opens the link and activates nothing; off the link it activates; the pointer cue shows while the modifier is held', async ({
  page,
}) => {
  const LINK_DOC = '/docs/link-comment.md';
  await fsWrite(page, LINK_DOC, '# Links\n\nvisit [the site](https://example.com/docs) today\n\ntail\n');
  await fsWrite(
    page,
    `${LINK_DOC}.comments.json`,
    JSON.stringify({
      version: '2.0.0',
      comments: [
        {
          kind: 'comment',
          id: 'c-link',
          author: 'Reader',
          createdAt: '2026-01-01T00:00:00.000Z',
          body: 'a note over a link',
          resolved: false,
          thread: [],
          anchor: { exact: 'the site today', prefix: 'visit ', suffix: '', start: 0, end: 14 },
        },
      ],
    })
  );
  await page.goto(`/#open=${LINK_DOC}`);
  await expect(page.locator('mark.hl[data-cid="c-link"]').first()).toBeVisible();
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);

  const editor = page.getByTestId('editor');
  const hl = editor.locator('.mm-hl[data-cid="c-link"]');
  await expect(hl.first()).toBeVisible();
  // The rendered-links view (default on) hides `](url)`, so the painted
  // text reads "the site today": the first piece is the link text, the last
  // is " today" — plain prose.
  await expect.poll(async () => (await hl.allTextContents()).join('')).toBe('the site today');

  // The cursor cue: a pointer over the painted range only while ⌘/Ctrl is
  // held (the mm-link-modifier root class, SPEC43 §11).
  const cursor = () => hl.first().evaluate((el) => getComputedStyle(el).cursor);
  expect(await cursor()).not.toBe('pointer');
  await page.keyboard.down('Control');
  await expect.poll(cursor).toBe('pointer');
  await page.keyboard.up('Control');
  await expect.poll(cursor).not.toBe('pointer');

  // On the link text: the link opens (the shim records it) and no record
  // activates — the pane stays closed, no active cue.
  await hl.first().click({ modifiers: ['ControlOrMeta'] });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mmExternalOpens?: string[] }).__mmExternalOpens ?? []))
    .toContain('https://example.com/docs');
  await expect(page.getByTestId('comments-pane')).toHaveCount(0);
  await expect(editor.locator('.mm-hl.active')).toHaveCount(0);

  // Off the link, on the same painted range: the comment activates.
  await hl.last().click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.locator('[data-testid="comment-card"][data-cid="c-link"]')).toHaveClass(/active/);
  await expect(editor.locator('.mm-hl.active[data-cid="c-link"]').first()).toBeVisible();
});

test('E445: PRD 023 Req 18 — activating a card in plain edit scrolls the EDITOR to the anchor with the centre-and-flash feel', async ({
  page,
}) => {
  // A long document parks the anchor far off-screen in the editor.
  const LONG_DOC = '/docs/long-anchor.md';
  const filler = Array.from({ length: 90 }, (_, i) => `Filler paragraph number ${i} keeps the anchor far away.`).join('\n\n');
  await fsWrite(page, LONG_DOC, `# Long\n\n${filler}\n\nThe final anchor phrase sits here.\n`);
  await fsWrite(
    page,
    `${LONG_DOC}.comments.json`,
    JSON.stringify({
      version: '2.0.0',
      comments: [
        {
          kind: 'comment',
          id: 'far',
          author: 'Reader',
          createdAt: '2026-01-01T00:00:00.000Z',
          body: 'a distant note',
          resolved: false,
          thread: [],
          anchor: { exact: 'final anchor phrase', prefix: 'The ', suffix: ' sits', start: 0, end: 19 },
        },
      ],
    })
  );
  await page.goto(`/#open=${LONG_DOC}`);
  await expect(page.locator('mark.hl[data-cid="far"]').first()).toBeVisible();

  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  await openCommentsPane(page);

  // The editor sits at the top; the anchor's decoration is out of view (CM
  // may not even render it yet). Activating the card scrolls the EDITOR —
  // plain edit has no preview to aim at — and flashes the decoration
  // (SPEC14 §1.3 through the revealHighlight seam). The editor's anchor
  // mapping lands on a 200ms debounce after entering edit mode (the PRD 023
  // §18 effect); the pane's entry slide used to cover it, and since issue
  // #328 the pane is instant, so wait it out before activating the card.
  await page.waitForTimeout(300);
  await page.locator('[data-testid="comment-card"][data-cid="far"]').click();
  const hl = page.getByTestId('editor').locator('.mm-hl[data-cid="far"]');
  await expect(hl.first()).toBeVisible();
  await expect(hl.first()).toBeInViewport();
  await expect(page.getByTestId('editor').locator('.mm-hl.flash').first()).toBeVisible();
  await expect(page.locator('[data-testid="comment-card"][data-cid="far"]')).toHaveClass(/active/);
});

// --- Issue #286 (PRD 023 §§7–12, §19): the Smart Edit annotation entries ----
//
// The selection popup's replacement: Comment ▸ and Highlight ▸ under the
// Marky Mark smart-edit menu, plus the Mod+Alt+M / Mod+Alt+H hotkeys. All in
// PLAIN edit (split off) against a small dedicated document, except where a
// test says otherwise.

const MENU_DOC = '/docs/menu-annotations.md';
const MENU_SIDECAR = `${MENU_DOC}.comments.json`;

/** Open the fixture in plain edit mode (split off, the E153 pattern). */
async function menuDoc(page: import('@playwright/test').Page): Promise<void> {
  await fsWrite(
    page,
    MENU_DOC,
    '# Menu Annotations\n\nalpha bravo charlie delta once.\n\nunique sentinel words linger here.\n\nclosing thoughts end quietly.\n'
  );
  await page.goto(`/#open=${MENU_DOC}`);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Menu Annotations');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  if (await page.getByTestId('split-preview').count()) await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
}

test('E453: PRD 023 §8 — Insert Comment from the menu in plain edit: pane opens, composer focused, mode unchanged, record persisted', async ({
  page,
}) => {
  await menuDoc(page);
  await expect(page.getByTestId('comments-pane')).toHaveCount(0); // ships closed
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'alpha bravo' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await smartEditAnnotation(page, 'comment', 'insert-comment');

  // The pane auto-opened with the composer focused; the editor never left.
  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('doc')).toHaveCount(0); // no mode switch

  await page.getByTestId('composer-input').fill('menu-authored comment');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('menu-authored comment');
  // The record persisted with the phrase as its anchor (rendered-text space).
  await expect.poll(() => fsRead(page, MENU_SIDECAR)).toContain('menu-authored comment');
  expect(await fsRead(page, MENU_SIDECAR)).toContain('alpha bravo charlie delta once.');
  // …and its marks paint on the editor surface too.
  await expect(page.getByTestId('editor').locator('.mm-hl').first()).toBeVisible();
});

test('E454: PRD 023 §8 — Delete Comment by caret context removes the record, its card and its marks in both surfaces', async ({
  page,
}) => {
  await menuDoc(page);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'alpha bravo' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await smartEditAnnotation(page, 'comment', 'insert-comment');
  await page.getByTestId('composer-input').fill('doomed');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect.poll(() => fsRead(page, MENU_SIDECAR)).toContain('doomed');

  // Land the caret inside the painted range (a click on the decoration), no
  // selection — Delete Comment resolves the record under the caret.
  await page.getByTestId('editor').locator('.mm-hl').first().click();
  await smartEditAnnotation(page, 'comment', 'delete-comment');
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.getByTestId('editor').locator('.mm-hl')).toHaveCount(0);
  // Both surfaces: the preview paints nothing either, and the store is empty.
  await page.keyboard.press('Control+e');
  await expect(page.locator('mark.hl')).toHaveCount(0);
  // Deleting the last record removes the sidecar file itself.
  await expect
    .poll(async () => {
      const raw = await fsRead(page, MENU_SIDECAR);
      return raw === null || !raw.includes('doomed');
    })
    .toBe(true);
});

test('E455: PRD 023 §9 — a color row over a selection inserts a highlight in that color, even overlapping an existing one', async ({
  page,
}) => {
  await menuDoc(page);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'unique sentinel' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await smartEditAnnotation(page, 'highlight', 'hl-green');
  await expect(page.getByTestId('editor').locator('.mm-hl[data-color="green"]').first()).toBeVisible();

  // A selection OVERLAPPING the highlight still inserts a new record —
  // selection wins over caret context (never a recolor of the old one).
  await dragAcrossText(page, '.cm-content', 'sentinel', 'words');
  await smartEditAnnotation(page, 'highlight', 'hl-pink');
  await expect(page.getByTestId('editor').locator('.mm-hl').first()).toBeVisible();
  await expect.poll(async () => {
    const raw = await fsRead(page, MENU_SIDECAR);
    if (!raw) return [];
    return JSON.parse(raw).comments.map((c: { color: string }) => c.color).sort();
  }).toEqual(['green', 'pink']);
});

test('E456: PRD 023 §9 — with no selection, a color row recolors the caret highlight in place: same id, new color, last-used updated', async ({
  page,
}) => {
  await menuDoc(page);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'unique sentinel' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await smartEditAnnotation(page, 'highlight', 'hl-green');
  await expect(page.getByTestId('editor').locator('.mm-hl[data-color="green"]').first()).toBeVisible();
  await expect.poll(() => fsRead(page, MENU_SIDECAR)).toContain('"color": "green"');
  const before = JSON.parse((await fsRead(page, MENU_SIDECAR))!);
  const id = before.comments[0].id;

  // Caret inside the painted range, NO selection → the color rows recolor.
  await page.getByTestId('editor').locator('.mm-hl').first().click();
  await smartEditAnnotation(page, 'highlight', 'hl-orange');
  await expect(page.getByTestId('editor').locator('.mm-hl[data-color="orange"]').first()).toBeVisible();
  await expect.poll(() => fsRead(page, MENU_SIDECAR)).toContain('"color": "orange"');
  const after = JSON.parse((await fsRead(page, MENU_SIDECAR))!);
  expect(after.comments).toHaveLength(1); // same record, no second entry
  expect(after.comments[0].id).toBe(id);
  expect(after.comments[0].color).toBe('orange');

  // Recolor updated the last-used color: Mod+Alt+H in the preview lands orange.
  await page.keyboard.press('Control+e');
  await addHighlight(page, 'closing thoughts');
  await expect(page.locator('mark.hl[data-color="orange"]')).toHaveCount(2);
});

test('E457: PRD 023 §9 — Remove Highlight deletes the caret highlight; it is disabled in every other context', async ({
  page,
}) => {
  await menuDoc(page);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'unique sentinel' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await smartEditAnnotation(page, 'highlight', 'hl-yellow');
  await expect(page.getByTestId('editor').locator('.mm-hl').first()).toBeVisible();

  // With a selection, Remove Highlight is disabled (selection wins).
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+.');
  await expect(page.getByTestId('smart-edit-menu')).toBeVisible();
  await page.getByTestId('smart-edit-highlight').click();
  await expect(page.getByTestId('smart-edit-remove-highlight')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('smart-edit-menu')).toHaveCount(0);

  // Caret on the highlight, no selection → Remove Highlight deletes it.
  await page.getByTestId('editor').locator('.mm-hl').first().click();
  await smartEditAnnotation(page, 'highlight', 'remove-highlight');
  await expect(page.getByTestId('editor').locator('.mm-hl')).toHaveCount(0);
  await expect
    .poll(async () => JSON.parse((await fsRead(page, MENU_SIDECAR)) ?? '{"comments":[]}').comments.length)
    .toBe(0);
});

test('E458: PRD 023 §10 — with no selection, the word under the caret is the anchor for a color row', async ({
  page,
}) => {
  await menuDoc(page);
  // Caret inside "sentinel" (no selection): the word is the anchor.
  await caretInto(page, 'unique sentinel words', 9);
  await smartEditAnnotation(page, 'highlight', 'hl-green');
  const hl = page.getByTestId('editor').locator('.mm-hl[data-color="green"]');
  await expect.poll(async () => (await hl.allTextContents()).join('')).toBe('sentinel');
  // The sidecar write is debounced (~800ms) — poll rather than read once.
  await expect.poll(() => fsRead(page, MENU_SIDECAR)).toContain('"exact": "sentinel"');
});

test('E459: PRD 023 §10 — on an empty line the color rows and Insert Comment are disabled: present, greyed, invoking nothing', async ({
  page,
}) => {
  await menuDoc(page);
  // First prove the same session ENABLES them on a word (so the disabled
  // state below is the context rule, not a stale cache).
  await caretInto(page, 'unique sentinel words', 9);
  await expect(async () => {
    for (let i = 0; i < 3 && (await page.getByTestId('smart-edit-menu').count()); i++) {
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Control+.');
    await expect(page.getByTestId('smart-edit-menu')).toBeVisible({ timeout: 1000 });
    await page.getByTestId('smart-edit-comment').click();
    await expect(page.getByTestId('smart-edit-insert-comment')).toBeEnabled({ timeout: 500 });
  }).toPass({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('smart-edit-menu')).toHaveCount(0);

  // Now the empty line between paragraphs: rows present, greyed.
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'alpha bravo' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown'); // the blank separator line
  await page.keyboard.press('Control+.');
  await expect(page.getByTestId('smart-edit-menu')).toBeVisible();
  await page.getByTestId('smart-edit-comment').click();
  await expect(page.getByTestId('smart-edit-insert-comment')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByTestId('smart-edit-highlight').click();
  await expect(page.getByTestId('smart-edit-hl-yellow')).toBeDisabled();
  await expect(page.getByTestId('smart-edit-hl-pink')).toBeDisabled();
  await expect(page.getByTestId('smart-edit-remove-highlight')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.getByTestId('editor').locator('.mm-hl')).toHaveCount(0);
});

test('E460: PRD 023 §12 — both hotkeys work in the editor: word fallback for Mod+Alt+H, selection for Mod+Alt+M', async ({
  page,
}) => {
  await menuDoc(page);
  // Mod+Alt+H with no selection highlights the word under the caret in the
  // last-used color (yellow on a fresh profile).
  await caretInto(page, 'unique sentinel words', 9);
  const hl = page.getByTestId('editor').locator('.mm-hl[data-color="yellow"]');
  await expect(async () => {
    await page.keyboard.press('Control+Alt+H');
    await expect(hl.first()).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 8000 });
  await expect.poll(async () => (await hl.allTextContents()).join('')).toBe('sentinel');

  // Mod+Alt+M over a selection opens the composer without leaving edit mode.
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'closing thoughts' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 8000 });
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('doc')).toHaveCount(0); // never a mode switch
  await page.getByTestId('composer-input').fill('hotkey in the editor');
  await page.getByTestId('composer-submit').click();
  await expect.poll(() => fsRead(page, MENU_SIDECAR)).toContain('hotkey in the editor');
  expect(await fsRead(page, MENU_SIDECAR)).toContain('closing thoughts end quietly.');
});

test('E461: PRD 023 §12 — in the preview the hotkeys require a selection: silent no-ops without one, armed-color insert with one', async ({
  page,
}) => {
  // The welcome doc in full preview (the suite's beforeEach state).
  await page.keyboard.press('Control+Alt+M');
  await page.keyboard.press('Control+Alt+H');
  await page.waitForTimeout(200);
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);

  // With a selection both act: H inserts the armed color, M opens a composer.
  await addHighlight(page, NAV_P2);
  await expect(page.locator('mark.hl[data-color="yellow"]').first()).toBeVisible();
  await addComment(page, PHRASE, 'preview hotkey comment');
  await expect(page.getByTestId('card-body')).toHaveText('preview hotkey comment');
});

test('E462: PRD 023 §6 — no selection popup exists on any surface: preview, split live preview, plain edit', async ({
  page,
}) => {
  const assertNoPopup = async () => {
    await page.waitForTimeout(250);
    await expect(page.getByTestId('marker-popup')).toHaveCount(0);
    await expect(page.getByTestId('marker-popup-edit')).toHaveCount(0);
    await expect(page.getByTestId('add-note-btn')).toHaveCount(0);
    expect(await page.locator('[class*="marker-popup"]').count()).toBe(0);
  };
  // Full preview.
  await selectPhrase(page, PHRASE);
  await assertNoPopup();
  // Split live preview.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await selectPhraseInPane(page, '[data-testid="split-preview"] .doc', 'renders GitHub-flavored markdown');
  await assertNoPopup();
  // Plain edit, an editor selection.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'saved to a sidecar' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await assertNoPopup();
});

// --- Issue #287 (PRD 023 §13): the preview selection button ------------------
// A selection in either preview surface grows the blue hash button left of
// it; its menu carries ONLY the shared Comment ▸ / Highlight ▸ rows.

test('E465: PRD 023 §13 — a full-preview selection grows the hash button left of it; collapse removes it; comments-off means absent', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  const btn = page.getByTestId('smart-edit-selection');
  await expect(btn).toBeVisible();

  // Left of the selection and vertically on it — and clear of the toolbar.
  const rect = await page.evaluate(() => {
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom };
  });
  const box = await stableBox(btn);
  expect(box.x + box.width).toBeLessThanOrEqual(rect.left);
  expect(box.y + box.height).toBeGreaterThan(rect.top);
  expect(box.y).toBeLessThan(rect.bottom);
  expect(box.y).toBeGreaterThanOrEqual(42); // the issue #18 toolbar band

  // Collapsing the selection removes the button the moment it happens.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(btn).toHaveCount(0);

  // The all-or-nothing gate: with the master switch off the button is
  // ABSENT on a fresh selection, not disabled.
  await openSettings(page, 'general');
  await page.getByTestId('set-comments-enabled').uncheck();
  await saveSettings(page);
  await selectPhrase(page, PHRASE);
  await page.waitForTimeout(200);
  await expect(btn).toHaveCount(0);
});

test('E565: PRD 023 §13 (issue #306) — the preview button sits in the .doc left padding column, level with the selection\'s FIRST line, never over the words', async ({
  page,
}) => {
  // Issue #306: the button used to hang one gap left of the selection RECT,
  // so a selection starting mid-line drew the glyph across the preceding
  // words. It now lives in the .doc's 32px padding column — the edit-mode
  // gutter glyph's spot — with its right edge at or left of the content-left
  // edge whatever column the selection starts in.
  const btn = page.getByTestId('smart-edit-selection');
  const docEdges = () =>
    page.evaluate(() => {
      const doc = document.querySelector('[data-testid="doc"]') as HTMLElement;
      const r = doc.getBoundingClientRect();
      return { docLeft: r.left, contentLeft: r.left + parseFloat(getComputedStyle(doc).paddingLeft) };
    });
  // The selection's FIRST line box: the first non-empty client rect.
  const firstLineRect = () =>
    page.evaluate(() => {
      const rects = Array.from(window.getSelection()!.getRangeAt(0).getClientRects());
      const r = rects.find((c) => c.width > 0 && c.height > 0)!;
      return { left: r.left, top: r.top, bottom: r.bottom };
    });

  // A phrase that starts well into its line: before the fix the glyph's box
  // would have ended right of the content edge, over "A lightweight, ".
  await selectPhrase(page, 'fast markdown viewer');
  await expect(btn).toBeVisible();
  const { docLeft, contentLeft } = await docEdges();
  const first = await firstLineRect();
  expect(first.left).toBeGreaterThan(contentLeft + 40); // materially mid-line
  const box = await stableBox(btn);
  expect(box.x + box.width).toBeLessThanOrEqual(contentLeft); // never over the words
  expect(box.x).toBeGreaterThanOrEqual(docLeft); // inside the padding column
  expect(box.y).toBeLessThan(first.bottom);
  expect(box.y + box.height).toBeGreaterThan(first.top);

  // A selection spanning two paragraphs rides the FIRST paragraph's first
  // line, not the centre of the whole selection rect (which would land it on
  // the heading between them) and not the second paragraph.
  const second = await page.evaluate(() => {
    const doc = document.querySelector('[data-testid="doc"]')!;
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    let from: { node: Node; idx: number } | null = null;
    let to: { node: Node; idx: number } | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue ?? '';
      if (!from && text.includes('fast markdown viewer')) from = { node, idx: text.indexOf('fast markdown viewer') };
      else if (from && text.includes('renders GitHub-flavored')) {
        to = { node, idx: text.indexOf('renders GitHub-flavored') + 'renders GitHub-flavored'.length };
        break;
      }
    }
    if (!from || !to) throw new Error('two-paragraph anchors not found');
    from.node.parentElement?.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.setStart(from.node, from.idx);
    range.setEnd(to.node, to.idx);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const rects = Array.from(range.getClientRects()).filter((c) => c.width > 0 && c.height > 0);
    const last = rects[rects.length - 1];
    const whole = range.getBoundingClientRect();
    return {
      first: { top: rects[0].top, bottom: rects[0].bottom },
      last: { top: last.top, bottom: last.bottom },
      wholeMid: whole.top + whole.height / 2,
    };
  });
  await expect(btn).toBeVisible();
  const edges2 = await docEdges();
  const box2 = await stableBox(btn);
  expect(second.last.top).toBeGreaterThan(second.first.bottom); // really two lines apart
  expect(box2.x + box2.width).toBeLessThanOrEqual(edges2.contentLeft);
  expect(box2.x).toBeGreaterThanOrEqual(edges2.docLeft);
  expect(box2.y).toBeLessThan(second.first.bottom);
  expect(box2.y + box2.height).toBeGreaterThan(second.first.top);
  expect(box2.y + box2.height).toBeLessThanOrEqual(second.last.top); // not the second paragraph's line
  expect(box2.y + box2.height).toBeLessThan(second.wholeMid); // not the whole rect's centre
});

test('E466: PRD 023 §13 — the split preview grows the button and inserts without leaving split; the split editor half never does', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  // A real pointer drag, as a user selects: the mousedown takes focus off
  // the editor first, so the SPEC23 §1 selection mirror stays DOM-neutral
  // (a programmatic selection under a still-focused editor is a state no
  // real interaction produces).
  await dragAcrossText(page, '[data-testid="split-preview"] .doc', 'renders GitHub-flavored', 'markdown');
  await expect(page.getByTestId('smart-edit-selection')).toBeVisible();

  // Insert Comment from the button: composer opens, split stays split.
  await previewSelectionAnnotation(page, 'comment', 'insert-comment');
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  await expect(page.getByTestId('split-preview')).toBeVisible(); // no mode switch
  await page.getByTestId('composer-input').fill('from the split preview button');
  await page.getByTestId('composer-submit').click();
  await expect.poll(() => fsRead(page, WELCOME_SIDECAR)).toContain('from the split preview button');

  // A selection in the split EDITOR half grows no button — that half has
  // the SPEC43 §3 gutter button instead.
  await page.getByTestId('editor').locator('.cm-line').filter({ hasText: 'saved to a sidecar' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.waitForTimeout(200);
  await expect(page.getByTestId('smart-edit-selection')).toHaveCount(0);
});

test('E467: PRD 023 §13 — the button menu holds ONLY the Comment/Highlight rows, and Esc dismisses without authoring', async ({
  page,
}) => {
  await selectPhrase(page, PHRASE);
  await clickClearOfToolbar(page.getByTestId('smart-edit-selection'));
  const menu = page.getByTestId('smart-edit-menu');
  await expect(menu).toBeVisible();

  // Exactly the two annotation rows — no text-editing entry, no separator.
  await expect(page.getByTestId('smart-edit-comment')).toBeVisible();
  await expect(page.getByTestId('smart-edit-highlight')).toBeVisible();
  for (const absent of ['table', 'image', 'code-block-view', 'diagram', 'link-view', 'bold', 'italic', 'link', 'heading', 'lists', 'cut', 'copy', 'paste']) {
    await expect(page.getByTestId(`smart-edit-${absent}`)).toHaveCount(0);
  }
  expect(await menu.locator('.menu-item').count()).toBe(2);
  expect(await menu.locator('.menu-sep').count()).toBe(0);

  // The flyout lists the four colors in fixed order plus Remove Highlight.
  await page.getByTestId('smart-edit-highlight').click();
  const flyout = page.getByTestId('smart-edit-flyout-highlight');
  await expect(flyout).toBeVisible();
  expect(await flyout.locator('.menu-item').allTextContents()).toEqual([
    expect.stringContaining('Yellow'),
    'Green',
    'Orange',
    'Pink',
    'Remove Highlight',
  ]);

  // Esc closes the flyout, then the menu — no record, no composer, and the
  // selection (with its button) survives.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);
  await expect(page.getByTestId('smart-edit-selection')).toBeVisible();
});

test('E468: PRD 023 §§8,13 — Insert Comment from the button: pane auto-opens, composer focused, mode unchanged, record persisted', async ({
  page,
}) => {
  await expect(page.getByTestId('comments-pane')).toHaveCount(0); // ships closed
  await selectPhrase(page, PHRASE);
  await previewSelectionAnnotation(page, 'comment', 'insert-comment');

  await expect(page.getByTestId('comments-pane')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  await expect(page.getByTestId('doc')).toBeVisible(); // still full preview
  await expect(page.getByTestId('editor')).toHaveCount(0); // never a mode switch

  await page.getByTestId('composer-input').fill('button-authored note');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('card-body')).toHaveText('button-authored note');
  await expect(page.locator('mark.hl').first()).toBeVisible();
  await expect.poll(() => fsRead(page, WELCOME_SIDECAR)).toContain('button-authored note');
  expect(await fsRead(page, WELCOME_SIDECAR)).toContain('"kind": "comment"');
});

test('E469: PRD 023 §§8,13 — a selection overlapping a comment arms Delete Comment, which removes record, card and marks', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'doomed note');
  await expect(page.getByTestId('comment-card')).toHaveCount(1);

  await selectPhrase(page, 'saved to a sidecar');
  await previewSelectionAnnotation(page, 'comment', 'delete-comment');
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);
  await waitForSidecar(page, (s) => s === null || !s.includes('doomed note'));
});

test('E470: PRD 023 §§9,13 — a color row over a plain selection inserts a highlight in THAT color, not the armed one', async ({
  page,
}) => {
  await selectPhrase(page, NAV_P2);
  await previewSelectionAnnotation(page, 'highlight', 'hl-green');
  const mark = page.locator('mark.hl[data-color="green"]');
  await expect(mark.first()).toBeVisible();
  await expect.poll(() => fsRead(page, WELCOME_SIDECAR)).toContain('"kind": "highlight"');
  expect(await fsRead(page, WELCOME_SIDECAR)).toContain('"color": "green"');
  // The selection settled: cleared, button gone, no composer for highlights.
  await expect(page.getByTestId('smart-edit-selection')).toHaveCount(0);
  await expect(page.getByTestId('composer')).toHaveCount(0);
});

test('E471: PRD 023 §§9,13 — a color row over an existing highlight recolors it in place: same id, one record, new color', async ({
  page,
}) => {
  await addHighlight(page, NAV_P2); // armed yellow on a fresh profile
  await expect(page.locator('mark.hl[data-color="yellow"]').first()).toBeVisible();
  await waitForSidecar(page, (s) => s !== null && s.includes('"color": "yellow"'));
  const before = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(before.comments).toHaveLength(1);

  await selectPhrase(page, NAV_P2);
  await previewSelectionAnnotation(page, 'highlight', 'hl-pink');
  await expect(page.locator('mark.hl[data-color="pink"]').first()).toBeVisible();
  await expect(page.locator('mark.hl[data-color="yellow"]')).toHaveCount(0);
  await waitForSidecar(page, (s) => s !== null && s.includes('"color": "pink"'));
  const after = JSON.parse((await fsRead(page, WELCOME_SIDECAR))!);
  expect(after.comments).toHaveLength(1); // recolored, never a second record
  expect(after.comments[0].id).toBe(before.comments[0].id);
});

test('E472: PRD 023 §§9,13 — Remove Highlight over an overlapping highlight deletes the record and its marks', async ({
  page,
}) => {
  await addHighlight(page, NAV_P2);
  await expect(page.locator('mark.hl').first()).toBeVisible();

  await selectPhrase(page, 'GitHub-flavored');
  await previewSelectionAnnotation(page, 'highlight', 'remove-highlight');
  await expect(page.locator('mark.hl')).toHaveCount(0);
  await waitForSidecar(page, (s) => s === null || !s.includes('"kind": "highlight"'));
});

test('E473: PRD 023 §13 — outside pointerdown, scroll and selection collapse each dismiss the menu without authoring', async ({
  page,
}) => {
  const menu = page.getByTestId('smart-edit-menu');
  const open = async () => {
    await selectPhrase(page, PHRASE);
    await clickClearOfToolbar(page.getByTestId('smart-edit-selection'));
    await expect(menu).toBeVisible();
  };

  // An outside pointerdown closes it (and collapses the selection with it).
  await open();
  await page.mouse.click(40, 300);
  await expect(menu).toHaveCount(0);

  // A scroll of the preview scroller the selection lives in closes it.
  // Upward: selectPhrase centred the phrase, which can leave the scroller
  // at its bottom limit where a further down-scroll would be a no-op.
  await open();
  await page.evaluate(() => {
    document.querySelector('.workspace')!.scrollTop -= 80;
  });
  await expect(menu).toHaveCount(0);

  // The selection going away closes it — no pointer, no key.
  await open();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(menu).toHaveCount(0);

  // None of the dismissals authored anything.
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);
  expect(await fsRead(page, WELCOME_SIDECAR)).toBeNull();
});

// --- Issue #344: every context paints, code backgrounds, table grids -------

const CONTEXT_DOC = '/docs/every-context.md';
/**
 * Issue #344 Req 1: one document carrying every context a highlight or
 * comment can sit in — prose, bold, italic, strikethrough, inline code, a
 * labelled and an unlabelled fence, a blockquote, bullet / numbered / task
 * items, a heading, link text, a table cell, a callout body. Each context
 * gets one highlight ("<ctx> alpha") and one comment ("<ctx> beta"), so every
 * record is a distinct data-cid whose exact text is unique in the document.
 */
const CONTEXT_SOURCE = [
  '# Heading alpha and heading beta',
  '',
  'Plain prose alpha and prose beta here.',
  '',
  'Some **bold alpha and bold beta** text.',
  '',
  'Some *italic alpha and italic beta* text.',
  '',
  'Some ~~struck alpha and struck beta~~ text.',
  '',
  'Call `code alpha and code beta` now.',
  '',
  '```ts',
  'const fenceAlpha = 1;',
  'const fenceBeta = 2;',
  'const fenceGhost = 3;',
  '```',
  '',
  '```',
  'plain fence alpha',
  'plain fence beta',
  '```',
  '',
  '> quote alpha and quote beta',
  '',
  '- bullet alpha and bullet beta',
  '',
  '1. number alpha and number beta',
  '',
  '- [ ] task alpha and task beta',
  '',
  'See [link alpha and link beta](https://example.com/z) after.',
  '',
  '| Name | Detail |',
  '| --- | --- |',
  '| cell alpha and cell beta | other cell text |',
  '',
  '> [!NOTE]',
  '> callout alpha and callout beta',
  '',
].join('\n');

/** cid → the rendered `exact` each record anchors to (also its visible source text). */
const CONTEXT_RECORDS: Array<[hl: string, hlExact: string, comment: string, commentExact: string]> = [
  ['h-head', 'Heading alpha', 'c-head', 'heading beta'],
  ['h-prose', 'prose alpha', 'c-prose', 'prose beta'],
  ['h-bold', 'bold alpha', 'c-bold', 'bold beta'],
  ['h-italic', 'italic alpha', 'c-italic', 'italic beta'],
  ['h-strike', 'struck alpha', 'c-strike', 'struck beta'],
  ['h-code', 'code alpha', 'c-code', 'code beta'],
  ['h-fence-l', 'fenceAlpha = 1', 'c-fence-l', 'fenceBeta = 2'],
  ['h-fence-u', 'plain fence alpha', 'c-fence-u', 'plain fence beta'],
  ['h-quote', 'quote alpha', 'c-quote', 'quote beta'],
  ['h-bullet', 'bullet alpha', 'c-bullet', 'bullet beta'],
  ['h-number', 'number alpha', 'c-number', 'number beta'],
  ['h-task', 'task alpha', 'c-task', 'task beta'],
  ['h-link', 'link alpha', 'c-link', 'link beta'],
  ['h-cell', 'cell alpha', 'c-cell', 'cell beta'],
  ['h-callout', 'callout alpha', 'c-callout', 'callout beta'],
];
const CONTEXT_COLORS = ['yellow', 'green', 'orange', 'pink'];

/** The editor text every record must paint over — its exact text, in every mode. */
const CONTEXT_PAINT: Record<string, string> = Object.fromEntries(
  CONTEXT_RECORDS.flatMap(([h, hx, c, cx]) => [
    [h, hx],
    [c, cx],
  ])
);

/**
 * Caret placements inside each highlight's range: the line to click and how
 * many ArrowRights from line start land INSIDE the range whether the line's
 * syntax is revealed (caret on the line) or hidden (live preview / views).
 */
const CONTEXT_CARETS: Array<[cid: string, line: string, rights: number]> = [
  ['h-head', 'Heading alpha', 5],
  ['h-prose', 'prose alpha', 8],
  ['h-bold', 'bold alpha', 9],
  ['h-italic', 'italic alpha', 9],
  ['h-strike', 'struck alpha', 9],
  ['h-code', 'code alpha', 8],
  ['h-fence-l', 'fenceAlpha', 9],
  ['h-fence-u', 'plain fence alpha', 5],
  ['h-quote', 'quote alpha', 4],
  ['h-bullet', 'bullet alpha', 5],
  ['h-number', 'number alpha', 6],
  ['h-task', 'task alpha', 8],
  ['h-link', 'link alpha', 8],
  ['h-cell', 'cell alpha', 4],
  ['h-callout', 'callout alpha', 6],
];

async function seedContextDoc(page: import('@playwright/test').Page): Promise<void> {
  await fsWrite(page, CONTEXT_DOC, CONTEXT_SOURCE);
  const base = { author: 'Reader', createdAt: '2026-01-01T00:00:00.000Z' };
  const anchor = (exact: string) => ({ exact, prefix: '', suffix: '', start: 0, end: exact.length });
  const comments = CONTEXT_RECORDS.flatMap(([h, hx, c, cx], i) => [
    { kind: 'highlight', id: h, ...base, color: CONTEXT_COLORS[i % 4], anchor: anchor(hx) },
    { kind: 'comment', id: c, ...base, body: `${c} note`, resolved: false, thread: [], anchor: anchor(cx) },
  ]);
  // Req 6: a RESOLVED comment inside the labelled fence body — the ghost treatment.
  comments.push({
    kind: 'comment',
    id: 'c-ghost',
    ...base,
    body: 'resolved fence note',
    resolved: true,
    thread: [],
    anchor: anchor('fenceGhost = 3'),
  });
  await fsWrite(page, `${CONTEXT_DOC}.comments.json`, JSON.stringify({ version: '2.0.0', comments }, null, 2));
  await page.goto(`/#open=${CONTEXT_DOC}`);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Heading alpha and heading beta');
}

/** Issue #344 Req 2: with the caret inside each range, the mark still covers exactly its text. */
async function expectCaretPaint(page: import('@playwright/test').Page, editor: Locator): Promise<void> {
  for (const [cid, line, rights] of CONTEXT_CARETS) {
    await caretInto(page, line, rights);
    const hl = editor.locator(`.mm-hl[data-cid="${cid}"]`);
    await expect.poll(async () => (await hl.allTextContents()).join(''), { message: `${cid} with caret inside` }).toBe(
      CONTEXT_PAINT[cid]
    );
  }
}

test('E608: issue #344 — every context (prose, bold, italic, strike, inline code, both fences, quote, bullet/numbered/task, heading, link, grid cell, callout) paints its highlight and its comment over exactly the anchored text in split edit and plain edit, with the caret inside each range; active/flash land on code, fence and cell records and a resolved fence comment ghosts', async ({
  page,
}) => {
  await seedContextDoc(page);
  const editor = page.getByTestId('editor');

  // Split edit (the default), grid on (the default), live preview off.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(editor.locator('.cm-line.mm-table-mode-line').first()).toBeVisible();
  await expectSyntaxPaint(editor, CONTEXT_PAINT);
  await expect(editor.locator('.mm-hl[data-cid="h-code"]').first()).toHaveAttribute('data-color', 'green');
  await expect(editor.locator('.mm-hl[data-cid="c-code"]').first()).not.toHaveAttribute('data-color', /./);
  await expect(editor.locator('.mm-hl.ghost[data-cid="c-ghost"]').first()).toBeVisible();
  await expect.poll(async () => (await editor.locator('.mm-hl[data-cid="c-ghost"]').allTextContents()).join('')).toBe(
    'fenceGhost = 3'
  );
  await expectCaretPaint(page, editor);

  // Plain edit.
  await page.keyboard.press('Control+e');
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  await expectSyntaxPaint(editor, CONTEXT_PAINT);
  await expectCaretPaint(page, editor);

  // Req 6 (PRD 023 §18): activating a card lands the active cue and the
  // reveal flash on the decoration — inside inline code, a fence body and a
  // grid cell alike (the E590 tail, in the contexts this issue opened up).
  await openCommentsPane(page);
  await page.waitForTimeout(300); // the mapping's 200ms debounce (E445)
  for (const cid of ['c-code', 'c-fence-l', 'c-cell']) {
    await page.locator(`[data-testid="comment-card"][data-cid="${cid}"]`).click();
    await expect(editor.locator(`.mm-hl.active[data-cid="${cid}"]`).first()).toBeVisible();
    await expect(editor.locator(`.mm-hl.flash[data-cid="${cid}"]`).first()).toBeVisible();
    await expect(page.locator(`[data-testid="comment-card"][data-cid="${cid}"]`)).toHaveClass(/active/);
  }
});

test('E609: issue #344 — with live preview on (PRD 006 hidden syntax) every record paints over exactly its visible text, and keeps doing so with the caret inside each range while the syntax is revealed', async ({
  page,
}) => {
  await seedContextDoc(page);
  await openSettings(page, 'editor');
  await page.getByTestId('editor-live-preview').check();
  await saveSettings(page);
  const editor = page.getByTestId('editor');

  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(editor.locator('.mm-lp-code').first()).toBeVisible();
  await expectSyntaxPaint(editor, CONTEXT_PAINT);
  await expectCaretPaint(page, editor);

  // Plain edit, still live.
  await page.keyboard.press('Control+e');
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').uncheck();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toHaveCount(0);
  await expectSyntaxPaint(editor, CONTEXT_PAINT);
  await expectCaretPaint(page, editor);
});

test('E610: issue #344 (SPEC23 §3) — over inline code and both fence bodies the highlight nests INSIDE the code span and its tint resolves above --mm-code-bg, in Crisp and in One Dark, and inside the live-preview code span too', async ({
  page,
}) => {
  await seedContextDoc(page);
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('crisp');
  await page.getByTestId('settings-theme-dark').selectOption('one-dark');
  const useDark = page.getByTestId('use-dark-theme');
  if (!(await useDark.isChecked())) await useDark.check();
  await saveSettings(page);
  const themeBg = () => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(themeBg).toBe('rgb(255, 255, 255)'); // Crisp

  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.mm-hl[data-cid="h-code"]').first()).toBeVisible();

  // The DOM nesting assertion: the mark is a descendant of the code span
  // (so its background paints above the code background and below the
  // text), and its resolved background is the tint, not transparent and
  // not the code background itself.
  const probe = (cid: string, codeSel: string) =>
    editor.locator(`.mm-hl[data-cid="${cid}"]`).first().evaluate((el, sel) => {
      const code = el.closest(sel) as HTMLElement | null;
      return {
        nested: code !== null,
        bg: getComputedStyle(el).backgroundColor,
        codeBg: code ? getComputedStyle(code).backgroundColor : null,
      };
    }, codeSel);
  const expectTinted = async (cid: string, codeSel: string) => {
    const r = await probe(cid, codeSel);
    expect(r.nested, `${cid} nested in ${codeSel}`).toBe(true);
    expect(r.bg, `${cid} tint`).not.toBe('rgba(0, 0, 0, 0)');
    expect(r.bg, `${cid} tint`).not.toBe('transparent');
    expect(r.bg, `${cid} tint differs from the code background`).not.toBe(r.codeBg);
  };
  const CODE_CASES: Array<[string, string]> = [
    ['h-code', '.mm-md-code'], // inline code: the SPEC23 §3 highlighter's span
    ['h-fence-l', '.mm-md-code'], // labelled (mounted) fence: codeBodyMark
    ['h-fence-u', '.mm-md-code'], // unlabelled fence: the highlighter's span
    ['c-fence-l', '.mm-md-code'], // a comment record, the fixed comment tint
  ];
  for (const [cid, sel] of CODE_CASES) await expectTinted(cid, sel);

  // Dark theme: same nesting, same visible tint.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(themeBg).toBe('rgb(40, 44, 52)'); // One Dark
  for (const [cid, sel] of CODE_CASES) await expectTinted(cid, sel);

  // PRD 006 live preview: inline code becomes .mm-lp-code — nested the same way.
  await page.keyboard.press('Control+e');
  await openSettings(page, 'editor');
  await page.getByTestId('editor-live-preview').check();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(editor.locator('.mm-lp-code').first()).toBeVisible();
  await expectTinted('h-code', '.mm-lp-code');
  await expectTinted('c-code', '.mm-lp-code');
});

const GRID_DOC = '/docs/grid-annotations.md';
const GRID_SIDECAR = `${GRID_DOC}.comments.json`;
const GRID_SOURCE = 'top\n\n| Name | Detail |\n| --- | --- |\n| quick brown fox | lazy dog |\n\nbottom\n';

/** After a reload the restart restores the document (in edit mode); judge the round trip in preview. */
async function restoredInPreview(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByTestId('docname')).toContainText('grid-annotations.md', { timeout: 15000 });
  await expect(page.getByTestId('doc').or(page.getByTestId('editor')).first()).toBeVisible();
  if (await page.getByTestId('editor').count()) await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toBeVisible();
}

type SidecarRecord = { kind: string; color?: string; anchor: { exact: string } };
const gridRecords = async (page: import('@playwright/test').Page): Promise<SidecarRecord[]> => {
  const raw = await fsRead(page, GRID_SIDECAR);
  return raw ? (JSON.parse(raw).comments as SidecarRecord[]) : [];
};

test('E611: issue #344 (SPEC40 §2, PRD 023 §19) — grid view ON: a cell selection turned into a highlight (menu row) or a comment (hotkey) anchors to the canonical cell text, a selection pushed past the cell edge stays clipped to one cell (SPEC39 §2.1), and after save + reload both records paint over the cell in the editor and in the preview', async ({
  page,
}) => {
  await openGridDoc(page, GRID_DOC, GRID_SOURCE, 'top');
  const editor = page.getByTestId('editor');
  const selText = () => page.evaluate(() => window.__mmEdit?.selText);

  // Select the whole first cell by extending the head through it (a
  // Shift+End would put the head in the LAST cell, and SPEC39 §2.1 clamps
  // a ranged selection to its head's cell).
  const extend = async (n: number) => {
    for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowRight');
  };
  await caretInto(page, 'quick brown', 2);
  await extend('quick brown fox'.length);
  await expect.poll(selText).toBe('quick brown fox');
  await smartEditAnnotation(page, 'highlight', 'hl-yellow');
  await expect.poll(async () => (await gridRecords(page)).map((r) => r.anchor.exact), { timeout: 5000 }).toEqual([
    'quick brown fox',
  ]);
  // …and it paints in the grid at once.
  await expect.poll(async () => (await editor.locator('.mm-hl[data-color="yellow"]').allTextContents()).join('')).toBe(
    'quick brown fox'
  );

  // A comment via the hotkey over the second cell.
  await caretInto(page, 'lazy dog', 20);
  await extend('lazy dog'.length);
  await expect.poll(selText).toBe('lazy dog');
  await expect(async () => {
    await page.keyboard.press('Control+Alt+M');
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await page.getByTestId('composer-input').fill('a note on a cell');
  await page.getByTestId('composer-submit').click();
  await expect.poll(async () => (await gridRecords(page)).map((r) => r.anchor.exact), { timeout: 5000 }).toEqual([
    'quick brown fox',
    'lazy dog',
  ]);

  // SPEC39 §2.1: a selection dragged past the cell edge is clipped to the
  // cell, so Highlight makes exactly one record whose exact stays inside it.
  await caretInto(page, 'quick brown', 8);
  await extend('brown fox'.length + 4); // four presses past the cell's content end
  await expect.poll(selText).toBe('brown fox');
  await smartEditAnnotation(page, 'highlight', 'hl-green');
  await expect.poll(async () => (await gridRecords(page)).length, { timeout: 5000 }).toBe(3);
  const records = await gridRecords(page);
  expect(records.filter((r) => r.color === 'green').map((r) => r.anchor.exact)).toEqual(['brown fox']);
  for (const r of records) expect(r.anchor.exact).not.toMatch(/[|↩]|\s{2}/);

  // Save, reload: the preview paints both cells' records over the cell text…
  await menuSave(page);
  await page.reload();
  await restoredInPreview(page);
  const doc = page.getByTestId('doc');
  await expect(doc).toContainText('quick brown fox');
  await expect(doc.locator('td mark.hl[data-color="yellow"]').first()).toHaveText('quick brown fox');
  await expect(doc.locator('td mark.hl:not([data-color])').first()).toHaveText('lazy dog');
  // …and so does the editor, over the grid.
  await page.keyboard.press('Control+e');
  await expect(editor.locator('.cm-line.mm-table-mode-line').first()).toBeVisible();
  await expect.poll(async () => (await editor.locator('.mm-hl[data-color="yellow"]').allTextContents()).join('')).toBe(
    'quick brown fox'
  );
  await expect.poll(async () => (await editor.locator('.mm-hl[data-color="green"]').allTextContents()).join('')).toBe(
    'brown fox'
  );
  await expect.poll(async () => (await editor.locator('.mm-hl:not([data-color])').allTextContents()).join('')).toBe(
    'lazy dog'
  );
});

test('E612: issue #344 — grid view OFF: stored table records paint over the raw pipe-table text, and a cell selection → Highlight → save + reload round-trips over the raw table in the editor and in the preview', async ({
  page,
}) => {
  await fsWrite(page, GRID_DOC, GRID_SOURCE);
  const base = { author: 'Reader', createdAt: '2026-01-01T00:00:00.000Z' };
  await fsWrite(
    page,
    GRID_SIDECAR,
    JSON.stringify({
      version: '2.0.0',
      comments: [
        { kind: 'highlight', id: 'h-cell', ...base, color: 'yellow', anchor: { exact: 'quick brown', prefix: '', suffix: ' fox', start: 0, end: 11 } },
        { kind: 'comment', id: 'c-cell', ...base, body: 'dog note', resolved: false, thread: [], anchor: { exact: 'lazy dog', prefix: '', suffix: '', start: 0, end: 8 } },
      ],
    })
  );
  await page.goto(`/#open=${GRID_DOC}`);
  await expect(page.getByTestId('doc')).toContainText('quick brown fox');
  await openSettings(page, 'editor');
  await expect(page.getByTestId('settings-table-grid')).toBeChecked();
  await page.getByTestId('settings-table-grid').uncheck();
  await saveSettings(page);

  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(0);
  await expectSyntaxPaint(editor, { 'h-cell': 'quick brown', 'c-cell': 'lazy dog' });

  // Select "fox" in the raw line and highlight it.
  await caretInto(page, 'quick brown fox', 14);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__mmEdit?.selText)).toBe('fox');
  await smartEditAnnotation(page, 'highlight', 'hl-green');
  await expect.poll(async () => (await gridRecords(page)).filter((r) => r.color === 'green').map((r) => r.anchor.exact), {
    timeout: 5000,
  }).toEqual(['fox']);

  await menuSave(page);
  await page.reload();
  await restoredInPreview(page);
  const doc = page.getByTestId('doc');
  await expect(doc).toContainText('quick brown fox');
  await expect(doc.locator('td mark.hl[data-color="green"]').first()).toHaveText('fox');
  await page.keyboard.press('Control+e');
  await expect(editor.locator('.cm-line.mm-table-mode-line')).toHaveCount(0);
  await expectSyntaxPaint(editor, { 'h-cell': 'quick brown', 'c-cell': 'lazy dog' });
  await expect.poll(async () => (await editor.locator('.mm-hl[data-color="green"]').allTextContents()).join('')).toBe('fox');
});
