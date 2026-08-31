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

/**
 * Issue #125: the view mode is remembered now, so a document can open in edit
 * mode because an earlier interaction — on hosted, an earlier test, since the
 * mock users keep their settings.json — chose it. Tests whose subject is
 * something else are written against the reading preview: this lands them
 * there. The memory itself is E248's subject.
 */
export async function landInPreview(page: Page): Promise<void> {
  // Read the DOM as it stands rather than waiting on the locator: a document
  // the reader may not edit has no switch at all — and loses it again the
  // moment late-arriving grants say so — so a waiting read would hang on that
  // unmount. No switch (or one already in preview) ⇒ nothing to do.
  const mode = await page.evaluate(
    () => document.querySelector('[data-testid="mode-switch"]')?.getAttribute('data-mode') ?? null
  );
  if (mode !== 'edit') return;
  const modeSwitch = page.getByTestId('mode-switch');
  await modeSwitch.click();
  await expect(modeSwitch).toHaveAttribute('data-mode', 'preview');
  // commands.ts CROSS_SOURCE_DEDUP_MS: a toggleMode from another source within
  // 150ms of this click is dropped as a duplicate — let the window pass so the
  // caller's own ⌘E is not swallowed by this setup.
  await page.waitForTimeout(200);
}

/**
 * Open the welcome/help document through the menu (SPEC4 clean start),
 * landing in the reading preview (issue #125 — see landInPreview above).
 */
export async function openWelcomeViaHelp(page: Page): Promise<void> {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-help').click();
  // The switch appears as soon as the document is open, and names the mode it
  // came up in — wait on it rather than racing the open.
  await expect(page.getByTestId('mode-switch')).toBeVisible();
  await landInPreview(page);
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Marky Mark');
}

// The shim's localStorage key and its fixture seed (src/platform/browser.ts:14
// and :112 — the vfs seeds /docs/<name> from the bundled fixtures whenever the
// key is absent). Read once per worker process, not per test.
const LS_KEY = 'marky-mark.fs.v1';

// Settings pinned into every seeded profile (freshApp and freshNativeMenuApp).
// paneMinWidth: the shipped default (768px) would hold both split panes under
// a horizontal scrollbar at this suite's 1280px viewport and skew every
// geometry-based assertion. Issue #81 removed reopen-on-launch (and its old
// reopenLastDoc pin here): a relaunch always lands on the splash, so tests
// that need a document after a reload reopen it explicitly (#open hash or
// menu) — E91 owns the never-reopens contract.
export const SEED_SETTINGS = { paneMinWidth: 240 };

const SEED_STORE = (() => {
  const dir = path.resolve(import.meta.dirname, '../../fixtures');
  const store: Record<string, string> = {
    '/config/settings.json': JSON.stringify(SEED_SETTINGS),
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
export async function openSettings(
  page: Page,
  // PRD 011 Req 4: widened for the LLM providers tab — same helper, one more
  // destination, so no caller is duplicated or replaced.
  // PRD 011 Req 1: widened again for the Experimental tab — same helper, one
  // more destination.
  // Issue #183 §1: widened again for the hosted People tab.
  tab: 'appearance' | 'general' | 'hotkeys' | 'editor' | 'people' | 'llm' | 'experimental' = 'appearance'
): Promise<void> {
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

/**
 * Issue #138: a REAL pointer drag (mouse down/move/up, not a programmatic
 * Range) from the start of `phraseA` to the end of `phraseB` inside a pane.
 * Each phrase must sit inside a single text node — an unhighlighted fence
 * (no language tag; markdown.ts uses detect:false) keeps its whole body in
 * one node, so any code substring qualifies.
 */
export async function dragAcrossText(
  page: Page,
  containerSelector: string,
  phraseA: string,
  phraseB: string
): Promise<void> {
  const pointFor = (phrase: string, edge: 'start' | 'end') =>
    page.evaluate(
      ([selector, needle, which]) => {
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
            const r = range.getBoundingClientRect();
            const y = r.top + r.height / 2;
            return which === 'start' ? { x: r.left + 1, y } : { x: r.right - 1, y };
          }
        }
        throw new Error(`phrase not found in pane: ${needle}`);
      },
      [containerSelector, phrase, edge] as const
    );
  const from = await pointFor(phraseA, 'start');
  const to = await pointFor(phraseB, 'end');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

// ---------------------------------------------------------------------------
// Moved out of the former tests/e2e/app.spec.ts when it was split by feature
// area (issue #31): one definition here, imported by the files that need it.
// ---------------------------------------------------------------------------

// A phrase from fixtures/welcome.md that lives inside one paragraph.
export const PHRASE = 'saved to a sidecar file next to the document';
// Longer than TOOLBAR_GRACE_MS (2500) + TOOLBAR_HIDE_DELAY_MS (400).
export const TOOLBAR_WAIT = 3200;
// Three phrases from fixtures/welcome.md, in document order.
export const NAV_P1 = 'lightweight, fast markdown viewer';
export const NAV_P2 = 'renders GitHub-flavored markdown';
export const NAV_P3 = 'seven built-in themes';

/** Re-launch the shim in desktop-menu mode: no header, spec on window.__mmMenu. */
export async function freshNativeMenuApp(page: Page): Promise<void> {
  await page.goto('/?nativeMenu=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload(); // fresh boot — fixtures re-seed
  await expect(page.getByTestId('empty-hint')).toBeVisible(); // shim ready
  // Same settings pins as freshApp above.
  await page.evaluate(
    (json) => window.__mmfs!.write('/config/settings.json', json),
    JSON.stringify(SEED_SETTINGS)
  );
  await page.reload();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
}

export const menuClick = (page: Page, command: string) =>
  page.evaluate((c) => window.__mmMenu!.click(c), command);

export const menuItem = (page: Page, command: string) =>
  page.evaluate(
    (c) =>
      window
        .__mmMenu!.spec!.submenus.flatMap((m) => m.items)
        .find((i) => i.type === 'command' && i.command === c) as
        | { label: string; checked?: boolean }
        | undefined,
    command
  );

/** Long fixture + doc open + edit mode (split by default, full when false). */
export async function splitApp(page: Page, split = true): Promise<void> {
  await freshApp(page);
  await page.evaluate(() => {
    const sections: string[] = [];
    for (let i = 1; i <= 40; i++) {
      sections.push(`## Marker ${i}\n`);
      if (i === 20) sections.push('```\n' + 'code line\n'.repeat(60) + '```\n');
      else sections.push(`Paragraph for section ${i}. `.repeat(8) + '\n');
    }
    window.__mmfs!.write('/docs/long.md', sections.join('\n'));
  });
  await page.evaluate((s) => {
    const raw = window.__mmfs!.read('/config/settings.json');
    const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.__mmfs!.write('/config/settings.json', JSON.stringify({ ...settings, splitEdit: s }));
  }, split);
  await page.reload(); // boot again so the app reads splitEdit from settings.json
  await page.goto('/#open=/docs/long.md'); // hashchange → the shim's onOpenFile
  await expect(page.getByTestId('doc').locator('h2').first()).toContainText('Marker 1');
  await page.keyboard.press('Control+e');
  if (split) await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
}

/** First fully/partially visible gutter line number in the editor pane. */
export const editorTopGutterLine = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')!;
    const top = scroller.getBoundingClientRect().top;
    const gutters = Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement'));
    const first = gutters.find((g) => g.getBoundingClientRect().bottom > top + 1 && /\d/.test(g.textContent ?? ''));
    return first ? Number(first.textContent) : -1;
  });

/** Source lines of the anchors bracketing the given scroller's top edge. */
export const previewTopAnchorLines = (page: Page, scrollerSel = '.split-preview') =>
  page.evaluate((sel) => {
    const scroller = document.querySelector(sel)!;
    const doc = scroller.querySelector('.doc')!;
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const y = scroller.scrollTop;
    const anchors = Array.from(doc.querySelectorAll<HTMLElement>('[data-mm-line]')).map((el) => ({
      line: Number(el.dataset.mmLine),
      top: el.getBoundingClientRect().top - base,
    }));
    let before = 1;
    let after = Number.MAX_SAFE_INTEGER;
    for (const a of anchors) {
      if (a.top <= y + 1) before = a.line;
      else {
        after = a.line;
        break;
      }
    }
    return { before, after };
  }, scrollerSel);

/** Dispatch a synthetic image paste into the CodeMirror editor. */
export async function pasteImage(page: Page, b64: string) {
  await page.evaluate((data) => {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    document
      .querySelector('.cm-content')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, b64);
}

export const seedFolders = async (page: Page) => {
  await fsWrite(page, '/notes/a.md', '# A doc\n');
  await fsWrite(page, '/notes/pic.png', 'binary-ish');
  await fsWrite(page, '/notes/zzz.txt', 'plain');
  await fsWrite(page, '/notes/.hidden/secret.md', '# no\n');
  await fsWrite(page, '/notes/sub/b.md', '# B doc\n');
  await fsWrite(page, '/notes/sub/deep/c.md', '# C doc\n');
  await fsWrite(page, '/other/d.md', '# D doc\n');
};

/**
 * Issue #22: the FolderPanel only renders in workspace mode now, so tests
 * enter it through the armed Open Folder… hook via the shim's command seam
 * (there is no hotkey or DOM button for openFolder in menu-less runs).
 */
export const openFolderRoot = async (page: Page, path = '/notes') => {
  await page.evaluate((p) => {
    window.__mmfs!.nextFolderPath = p;
    window.__mmDispatch!('openFolder');
  }, path);
  await expect(page.getByTestId('folder-panel')).toBeVisible();
};

/** Set the folder root to /notes through the armed Open Folder… hook. */
export const openNotesRoot = async (page: Page) => {
  await openFolderRoot(page);
  await expect(page.getByTestId('folder-header')).toContainText('notes');
};

/** Type `text` at the top of the buffer in edit mode, then back to preview. */
export const dirtyActiveDoc = async (page: Page, text: string) => {
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type(text);
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
};

/** Open `path` (fsWrite'd) in edit mode and wait for the default grid. */
export async function openGridDoc(
  page: Page,
  path: string,
  doc: string,
  probe: string
): Promise<void> {
  await fsWrite(page, path, doc);
  await page.goto(`/#open=${path}`);
  await expect(page.getByTestId('doc')).toContainText(probe);
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.cm-content')).toBeVisible();
  await expect(editor.locator('.cm-line.mm-table-mode-line').first()).toBeVisible();
}

/** Put the caret `rights` characters into the line containing `lineText`. */
export async function caretInto(page: Page, lineText: string, rights: number): Promise<void> {
  const editor = page.getByTestId('editor');
  await editor.locator('.cm-line').filter({ hasText: lineText }).first().click();
  await page.keyboard.press('Home');
  for (let i = 0; i < rights; i++) await page.keyboard.press('ArrowRight');
}

/**
 * Move the editor cursor to DOCUMENT start (not line start — plain Home only
 * goes to line start). CodeMirror's keymap dispatches on the browser's
 * platform, which matches the runner's: the mac keymap binds Cmd-ArrowUp to
 * cursorDocStart, the PC keymap binds Ctrl-Home (issue #67 — a bare
 * Control+Home is a no-op on macOS runners).
 */
export async function goToDocStart(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
}

/**
 * Screen rect of the nth occurrence of `word` inside `paneSel` — a Range over
 * the glyphs themselves, so it works for rendered markdown and for CodeMirror
 * lines alike. Throws when the word is not on screen.
 */
export async function wordRect(
  page: Page,
  paneSel: string,
  word: string,
  nth = 0
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(
    ([sel, w, n]) => {
      const pane = document.querySelector(sel as string)!;
      const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue ?? '';
        for (let at = text.indexOf(w as string); at !== -1; at = text.indexOf(w as string, at + 1)) {
          if (seen++ === n) {
            const r = document.createRange();
            r.setStart(node, at);
            r.setEnd(node, at + (w as string).length);
            const b = r.getBoundingClientRect();
            return { x: b.left, y: b.top, width: b.width, height: b.height };
          }
        }
      }
      throw new Error(`word not found: ${w}`);
    },
    [paneSel, word, nth] as const
  );
}

/** Center of the nth visible occurrence of `word` inside `paneSel`; click it. */
export const clickWord = async (page: Page, paneSel: string, word: string, nth = 0) => {
  const r = await wordRect(page, paneSel, word, nth);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
};

/**
 * Issue #178: click the LEFT EDGE of character `offset` inside the nth
 * visible occurrence of `word` in `paneSel` — the caret lands exactly at
 * that character boundary, making exact-position assertions deterministic
 * (a word-center click depends on glyph widths).
 */
export const clickCharBoundary = async (page: Page, paneSel: string, word: string, offset: number, nth = 0) => {
  const p = await page.evaluate(
    ([sel, w, n, off]) => {
      const pane = document.querySelector(sel as string)!;
      const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue ?? '';
        for (let at = text.indexOf(w as string); at !== -1; at = text.indexOf(w as string, at + 1)) {
          if (seen++ === (n as number)) {
            const r = document.createRange();
            r.setStart(node, at + (off as number));
            r.setEnd(node, at + (off as number) + 1);
            const b = r.getBoundingClientRect();
            return { x: b.left, y: b.top + b.height / 2 };
          }
        }
      }
      throw new Error(`word not found: ${w}`);
    },
    [paneSel, word, nth, offset] as const
  );
  await page.mouse.click(p.x, p.y);
};

/** Open `path` through the menu's Open dialog (the shim accepts the string). */
export async function openPath(page: Page, path: string): Promise<void> {
  page.once('dialog', (d) => void d.accept(path));
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-open').click();
}

/** Save the active document through the toolbar menu. */
export async function menuSave(page: Page): Promise<void> {
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-save').click();
}
