import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export const WELCOME = '/docs/welcome.md';
export const WELCOME_SIDECAR = '/docs/welcome.md.comments.json';

/** Bring the auto-hiding toolbar on-screen (mouse into the top hot zone). */
export async function revealToolbar(page: Page): Promise<void> {
  await page.mouse.move(500, 8);
  await expect(page.getByTestId('menu-btn')).toBeVisible();
}

/** Open the welcome/help document through the menu (SPEC4 clean start). */
export async function openWelcomeViaHelp(page: Page): Promise<void> {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
}

/** Fresh app: wipe the shim fs, land on the empty state, open welcome via Help. */
export async function freshApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload(); // fresh boot — the vfs re-seeds its fixtures
  await expect(page.getByTestId('empty-hint')).toBeVisible(); // shim ready
  // Pin the pane-content floor for the suite: the shipped default (768px)
  // would hold both split panes under a horizontal scrollbar at this
  // suite's 1280px viewport and skew every geometry-based assertion.
  // (Written after the fresh boot: __mmfs.write flushes the whole in-memory
  // store, so writing before the reload would resurrect the cleared state.)
  await page.evaluate(() =>
    window.__mmfs!.write('/config/settings.json', JSON.stringify({ paneMinWidth: 240 }))
  );
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await openWelcomeViaHelp(page);
}

/** Open the Settings panel through the overflow menu, on the given tab. */
export async function openSettings(page: Page, tab: 'appearance' | 'general' | 'hotkeys' = 'appearance'): Promise<void> {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-panel').waitFor();
  await page.getByTestId(`settings-tab-${tab}`).click();
}

export function fsRead(page: Page, path: string): Promise<string | null> {
  return page.evaluate((p) => window.__mmfs!.read(p), path);
}

export function fsWrite(page: Page, path: string, content: string): Promise<void> {
  return page.evaluate(([p, c]) => window.__mmfs!.write(p, c), [path, content] as const);
}

/** Select `phrase` (must live inside a single text node) in the rendered doc. */
export async function selectPhrase(page: Page, phrase: string): Promise<void> {
  await page.evaluate((needle) => {
    const doc = document.querySelector('[data-testid="doc"]');
    if (!doc) throw new Error('doc not rendered');
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue?.indexOf(needle) ?? -1;
      if (idx !== -1) {
        // Scroll first so the floating Add-comment button lands in-viewport.
        node.parentElement?.scrollIntoView({ block: 'center' });
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    throw new Error(`phrase not found in doc: ${needle}`);
  }, phrase);
}

/** Select from `phraseA` through `phraseB` (start of A to end of B), spanning blocks. */
export async function selectSpan(page: Page, phraseA: string, phraseB: string): Promise<void> {
  await page.evaluate(([a, b]) => {
    const doc = document.querySelector('[data-testid="doc"]');
    if (!doc) throw new Error('doc not rendered');
    const find = (needle: string) => {
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const idx = node.nodeValue?.indexOf(needle) ?? -1;
        if (idx !== -1) return { node, idx };
      }
      throw new Error(`phrase not found in doc: ${needle}`);
    };
    const startHit = find(a);
    const endHit = find(b);
    startHit.node.parentElement?.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.setStart(startHit.node, startHit.idx);
    range.setEnd(endHit.node, endHit.idx + b.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, [phraseA, phraseB] as const);
}

/** Full comment flow: select, click the floating button, type, submit. */
export async function addComment(page: Page, phrase: string, body: string): Promise<void> {
  await selectPhrase(page, phrase);
  await page.getByTestId('add-comment-btn').click();
  await page.getByTestId('composer-input').fill(body);
  await page.getByTestId('composer-submit').click();
}

/** Wait until the autosaved sidecar (debounced 800 ms) satisfies `predicate`. */
export async function waitForSidecar(
  page: Page,
  predicate: (content: string | null) => boolean
): Promise<void> {
  await expect
    .poll(async () => predicate(await fsRead(page, WELCOME_SIDECAR)), { timeout: 5000 })
    .toBe(true);
}

/** SPEC23: select `phrase` inside an arbitrary container (e.g. the split preview). */
export async function selectPhraseInPane(page: Page, containerSelector: string, phrase: string): Promise<void> {
  await page.evaluate(
    ([selector, needle]) => {
      const pane = document.querySelector(selector);
      if (!pane) throw new Error(`pane not found: ${selector}`);
      const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const idx = node.nodeValue?.indexOf(needle) ?? -1;
        if (idx !== -1) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + needle.length);
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
      }
      throw new Error(`phrase not found in pane: ${needle}`);
    },
    [containerSelector, phrase] as const
  );
}

/** SPEC23: select from the start of `phraseA` to the end of `phraseB` inside a container. */
export async function selectSpanInPane(
  page: Page,
  containerSelector: string,
  phraseA: string,
  phraseB: string
): Promise<void> {
  await page.evaluate(
    ([selector, a, b]) => {
      const pane = document.querySelector(selector);
      if (!pane) throw new Error(`pane not found: ${selector}`);
      const find = (needle: string) => {
        const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const idx = node.nodeValue?.indexOf(needle) ?? -1;
          if (idx !== -1) return { node, idx };
        }
        throw new Error(`phrase not found in pane: ${needle}`);
      };
      const start = find(a);
      const end = find(b);
      const range = document.createRange();
      range.setStart(start.node, start.idx);
      range.setEnd(end.node, end.idx + b.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    },
    [containerSelector, phraseA, phraseB] as const
  );
}
