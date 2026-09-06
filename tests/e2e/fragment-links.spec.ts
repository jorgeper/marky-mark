import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { freshApp, fsWrite, openSettings, saveSettings } from './helpers';

// SPEC11 §4 (issue #268): in-document `#fragment` links in the RENDERED
// document. SPEC11 §4.1 always promised the local scroll; the click handler
// looked the fragment up with `document.getElementById`, the pipeline stamps
// no heading `id`, so it was a silent no-op — and the split preview half had
// no link handling at all. Both surfaces now share one handler that resolves
// the fragment through the PRD 020 Req 18 heading anchors (the same slugs the
// copy-link affordance and the TOC use) and lands it on the SPEC16 §4 scroll
// path, with the Req 19 miss notice for a fragment no heading answers.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

/** Filler that makes each section taller than the viewport, so jumps scroll. */
const filler = (tag: string, n = 12) =>
  Array.from({ length: n }, (_, i) => `${tag} paragraph ${i + 1}.`).join('\n\n');

/**
 * The shape the issue asks for, in one document: fragments pointing BELOW the
 * link and (from the tail) ABOVE it, a heading far down a long document, a
 * duplicate `## Setup` pair reached by `#setup` / `#setup-1`, a
 * container-nested heading (issue #226, the `data-mm-hline` case), a level-six
 * heading, a fragment that matches nothing, plus the other two SPEC11 §4 link
 * kinds so the split half's restored interception is exercised too.
 */
const FRAG_DOC = [
  '# Fragment Guide',
  '',
  'Jump [down to setup](#setup), [to the second setup](#setup-1), [to the quoted tail](#quoted-tail), [to level six](#level-six), [deep to the end](#deep-end), [to nowhere](#renamed-away).',
  '',
  'Also [site](https://example.com/page) and [a sibling](./other.md).',
  '',
  filler('intro'),
  '',
  '## Setup',
  '',
  filler('setup'),
  '',
  '## Setup',
  '',
  filler('again'),
  '',
  '> ### Quoted Tail',
  '',
  filler('quoted'),
  '',
  '###### Level Six',
  '',
  filler('six', 40),
  '',
  '## Deep End',
  '',
  'Head [back to the top](#fragment-guide) from here, or [to nowhere from here](#renamed-away).',
  '',
  filler('tail'),
  '',
].join('\n');

/** External-open hand-offs the desktop shim recorded (browser.ts seam). */
const externalOpens = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmExternalOpens?: string[] }).__mmExternalOpens ?? []);

/**
 * Real scroll geometry, the E335/E337 pattern: how far the nth heading of a
 * level sits below the pane's viewport top. 1e6 when it is not rendered.
 */
const deltaOf = (page: Page, scrollerSel: string, tag: string, nth = 0) =>
  page.evaluate(
    ({ scrollerSel, tag, nth }) => {
      const scroller = document.querySelector(scrollerSel)!;
      const el = scroller.querySelectorAll<HTMLElement>(`.doc ${tag}`)[nth];
      return el ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top : 1e6;
    },
    { scrollerSel, tag, nth }
  );

const scrollTopOf = (page: Page, scrollerSel: string) =>
  page.locator(scrollerSel).evaluate((el) => el.scrollTop);

const toTop = (page: Page, scrollerSel: string) =>
  page.locator(scrollerSel).evaluate((el) => {
    el.scrollTop = 0;
  });

/** A survivor of any reload: the assertions below prove the page never navigated. */
const markPage = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __mmNoReload?: number }).__mmNoReload = 1;
  });
const stillSamePage = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmNoReload?: number }).__mmNoReload ?? 0);

async function openFragDoc(page: Page) {
  await fsWrite(page, '/docs/frag268.md', FRAG_DOC);
  await page.goto('/#open=/docs/frag268.md');
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Fragment Guide');
  await markPage(page);
}

test('E514: a #fragment click in the full preview lands its heading at the pane top — below the click, deep down a long document, the right one of a duplicate pair, container-nested and h6 — and above it from the tail, without navigating', async ({
  page,
}) => {
  await openFragDoc(page);
  const doc = page.getByTestId('doc');
  const appUrl = page.url();
  expect(await scrollTopOf(page, '.workspace')).toBe(0);

  // SPEC11 §4.1: the heading BELOW the click point lands at the viewport top,
  // the same landing E335's TOC jump produces. `#setup` is the FIRST of the
  // duplicate pair (PRD 020 Req 18's GitHub-style dedupe), so the second
  // occurrence stays far away.
  await doc.getByRole('link', { name: 'down to setup' }).click();
  await expect.poll(() => deltaOf(page, '.workspace', 'h2', 0)).toBeLessThan(120);
  expect(await scrollTopOf(page, '.workspace')).toBeGreaterThan(0);
  expect(await deltaOf(page, '.workspace', 'h2', 1)).toBeGreaterThan(200);

  // …and `#setup-1` reaches the OTHER occurrence: the second lands, the first
  // is now above the viewport top.
  await toTop(page, '.workspace');
  await doc.getByRole('link', { name: 'to the second setup' }).click();
  await expect.poll(() => deltaOf(page, '.workspace', 'h2', 1)).toBeLessThan(120);
  expect(await deltaOf(page, '.workspace', 'h2', 0)).toBeLessThan(-200);

  // Issue #226: a heading nested in a blockquote is stamped `data-mm-hline`,
  // not `data-mm-line` — the SPEC16 §4 path matches either, so it lands too.
  await toTop(page, '.workspace');
  await doc.getByRole('link', { name: 'to the quoted tail' }).click();
  await expect.poll(() => deltaOf(page, '.workspace', 'h3', 0)).toBeLessThan(120);

  // Every level is addressable, h6 included.
  await toTop(page, '.workspace');
  await doc.getByRole('link', { name: 'to level six' }).click();
  await expect.poll(() => deltaOf(page, '.workspace', 'h6', 0)).toBeLessThan(120);
  const sixTop = await scrollTopOf(page, '.workspace');

  // A heading FAR down the document (the shape issue #260 exposed) — landed,
  // and further down than the h6 above it.
  await toTop(page, '.workspace');
  await doc.getByRole('link', { name: 'deep to the end' }).click();
  await expect.poll(() => deltaOf(page, '.workspace', 'h2', 2)).toBeLessThan(120);
  expect(await scrollTopOf(page, '.workspace')).toBeGreaterThan(sixTop);

  // From down there, a fragment pointing ABOVE the click point: the h1 lands
  // at the top, so the pane scrolled back up rather than nowhere.
  await doc.getByRole('link', { name: 'back to the top' }).click();
  await expect.poll(() => deltaOf(page, '.workspace', 'h1', 0)).toBeLessThan(120);
  expect(await scrollTopOf(page, '.workspace')).toBeLessThan(120);

  // No navigation and no reload anywhere in that sequence: same path, same
  // page instance, no hand-off to the OS browser, nothing dirtied.
  expect(new URL(page.url()).pathname).toBe(new URL(appUrl).pathname);
  expect(await stillSamePage(page)).toBe(1);
  expect(await externalOpens(page)).toEqual([]);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E515: a #fragment matching no heading takes the PRD 020 Req 19 miss notice — the preview stays exactly where it is, dismissible, and nothing navigates', async ({
  page,
}) => {
  await openFragDoc(page);
  const doc = page.getByTestId('doc');
  const appUrl = page.url();

  // Land deep first, so "the pane stays where it is" is a real claim rather
  // than a pane that was already at the top — and use the miss link that sits
  // down there, so the click needs no scrolling of its own.
  await doc.getByRole('link', { name: 'deep to the end' }).click();
  await expect.poll(() => deltaOf(page, '.workspace', 'h2', 2)).toBeLessThan(120);
  const missLink = doc.getByRole('link', { name: 'to nowhere from here' });
  await expect(missLink).toBeInViewport();
  const parked = await scrollTopOf(page, '.workspace');
  expect(parked).toBeGreaterThan(0);
  await missLink.click();
  const notice = page.getByTestId('heading-miss-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("That section wasn't found — it may have been renamed");
  // Not a scroll to the top, not a navigation: the pane is where the click
  // found it.
  await page.waitForTimeout(150);
  expect(await scrollTopOf(page, '.workspace')).toBe(parked);
  expect(new URL(page.url()).pathname).toBe(new URL(appUrl).pathname);
  expect(await stillSamePage(page)).toBe(1);

  // PRD 020 Req 19: dismissible, like the deep link's miss.
  await page.getByTestId('heading-miss-dismiss').click();
  await expect(notice).toHaveCount(0);
});

test('E516: the split view preview half honours the same managed-link rule — a #fragment lands in THAT half, an http(s) link hands off to the platform opener, a relative file stays inert, and the webview never navigates', async ({
  page,
}) => {
  await openFragDoc(page);
  await openSettings(page, 'general');
  await page.getByTestId('set-split-edit').check();
  await saveSettings(page);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  const split = page.getByTestId('split-preview');
  await expect(split.locator('h1')).toContainText('Fragment Guide');
  const appUrl = page.url();
  expect(await scrollTopOf(page, '.split-preview')).toBe(0);

  // SPEC11 §4.1 in the half that had no link handling at all: the fragment
  // lands in the split preview's own scroller (`splitDocRef`), not only in the
  // full-preview pane the old scroll path queried.
  await split.getByRole('link', { name: 'deep to the end' }).click();
  await expect.poll(() => deltaOf(page, '.split-preview', 'h2', 2)).toBeLessThan(120);
  expect(await scrollTopOf(page, '.split-preview')).toBeGreaterThan(0);

  await toTop(page, '.split-preview');
  await split.getByRole('link', { name: 'down to setup' }).click();
  await expect.poll(() => deltaOf(page, '.split-preview', 'h2', 0)).toBeLessThan(120);

  // A miss here is the same graceful notice, in the same pane.
  await toTop(page, '.split-preview');
  await split.getByRole('link', { name: 'to nowhere', exact: true }).click();
  await expect(page.getByTestId('heading-miss-notice')).toBeVisible();
  await page.getByTestId('heading-miss-dismiss').click();

  // SPEC11 §4.2 restored in this half too: http(s) goes through the seam…
  await toTop(page, '.split-preview');
  await split.getByRole('link', { name: 'site' }).click();
  await expect.poll(() => externalOpens(page)).toEqual(['https://example.com/page']);

  // …and any other href is inert — no hand-off, no navigation (the parity
  // contract: neither pane opens relative files).
  await split.getByRole('link', { name: 'a sibling' }).click();
  await page.waitForTimeout(150);
  expect(await externalOpens(page)).toEqual(['https://example.com/page']);
  expect(new URL(page.url()).pathname).toBe(new URL(appUrl).pathname);
  expect(await stillSamePage(page)).toBe(1);
  await expect(page.getByTestId('split-divider')).toBeVisible(); // the split survived
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});
