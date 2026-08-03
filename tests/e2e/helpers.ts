import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
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

// The shim's localStorage key and its fixture seed (src/platform/browser.ts:14
// and :112 — the vfs seeds /docs/<name> from the bundled fixtures whenever the
// key is absent). Read once per worker process, not per test.
const LS_KEY = 'marky-mark.fs.v1';
const SEED_STORE = (() => {
  const dir = path.resolve(import.meta.dirname, '../../fixtures');
  // Pin the pane-content floor for the suite: the shipped default (768px)
  // would hold both split panes under a horizontal scrollbar at this
  // suite's 1280px viewport and skew every geometry-based assertion.
  const store: Record<string, string> = {
    '/config/settings.json': JSON.stringify({ paneMinWidth: 240 }),
  };
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    store[`/docs/${name}`] = readFileSync(path.join(dir, name), 'utf8');
  }
  return JSON.stringify(store);
})();

/** Fresh app: wipe the shim fs, land on the empty state, open welcome via Help. */
export async function freshApp(page: Page): Promise<void> {
  // One navigation, not three: the store (fixtures + the pinned settings) is
  // written by an init script that runs before the app's first script, so
  // there is nothing to reload into place afterwards. The sessionStorage
  // sentinel makes it a once-per-page-context seed — later reloads inside a
  // test are real restarts against whatever state that test left behind.
  await page.addInitScript(
    ([key, seed]) => {
      if (sessionStorage.getItem('mm-e2e-seeded')) return;
      localStorage.clear();
      localStorage.setItem(key, seed);
      sessionStorage.setItem('mm-e2e-seeded', '1');
    },
    [LS_KEY, SEED_STORE] as const
  );
  await page.goto('/');
  // Longer than the default 5s: this is now the FIRST paint of the page
  // context, so it carries the dev server's cold module transform that the
  // old three-navigation boot hid inside goto()'s navigation timeout.
  await expect(page.getByTestId('empty-hint')).toBeVisible({ timeout: 20_000 }); // shim ready
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

/**
 * Click `target` only once the toolbar shell provably cannot intercept it.
 *
 * `.toolbar-shell` (src/styles.css:66 — `z-index: 80`, `transition: transform
 * 180ms`) owns the top 42px of the window, and the floating `add-comment-btn`
 * is `position: fixed` at z-index 60: a target that lands in that band is
 * clicked by `.docname` instead (issue #18, E129). Waiting on the two rects
 * catches both a transitioning shell and a genuinely mispositioned control —
 * loudly, at 4s, rather than as a 30s intercepted-click timeout.
 */
export async function clickClearOfToolbar(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const clearOfShell = () =>
    target.evaluate((el) => {
      const shell = document.querySelector('.toolbar-shell');
      if (!shell) return true; // native-menu build: no overlay to dodge
      const b = el.getBoundingClientRect();
      const s = shell.getBoundingClientRect();
      return b.bottom <= s.top || b.top >= s.bottom || b.right <= s.left || b.left >= s.right;
    });
  await expect.poll(clearOfShell, { timeout: 4000 }).toBe(true);
  await target.click();
}

/** The non-null shape of `Locator.boundingBox()`. */
type Box = { x: number; y: number; width: number; height: number };

/**
 * A `boundingBox()` that has stopped moving: the same rect on two consecutive
 * polls. Geometry read straight after a pane slide (`paneSlide.ts`, 180ms) or
 * a ResizeObserver-driven relayout is otherwise a one-shot sample mid-flight,
 * and a drag started from it grabs the wrong pixel (issue #18).
 */
export async function stableBox(target: Locator): Promise<Box> {
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox();
        const current = box && JSON.stringify(box); // null while detached/hidden
        const settled = current !== null && current === previous;
        previous = current;
        return settled;
      },
      { intervals: [50, 50, 50, 100, 100, 250, 250, 500], timeout: 5000 }
    )
    .toBe(true);
  return (await target.boundingBox())!;
}

/** Full comment flow: select, click the floating button, type, submit. */
export async function addComment(page: Page, phrase: string, body: string): Promise<void> {
  await selectPhrase(page, phrase);
  await clickClearOfToolbar(page.getByTestId('add-comment-btn'));
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
