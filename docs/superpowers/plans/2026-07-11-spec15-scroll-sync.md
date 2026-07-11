# SPEC15 Synchronized Split Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bidirectional block-anchored scroll sync between the split-edit panes.

**Architecture:** The renderer stamps top-level blocks with `data-mm-line` (source line from remark positions, admitted narrowly through sanitize). Pure `scrollSync.ts` maps pixel offset ↔ fractional source line over an anchor table. The Editor exposes a small imperative `syncRef` handle built on CodeMirror line-block geometry. An App-side controller listens to both panes' scroll events, marks programmatic follower writes with a suppression counter so they never re-lead, and clamps ends so both bottoms are mutually reachable.

**Tech Stack:** React 19, CodeMirror 6, unified/rehype, Vitest, Playwright. No new dependencies.

## Global Constraints (SPEC15 / goal condition)

- Version files stay `0.2.0-alpha.3`; CSP untouched; sanitize gains only `dataMmLine`; specs untouched.
- Only new tests U27–U28, E57–E58; no existing test modified; no skip/only/todo.
- Rendered text content unchanged (comment-anchor space, sidecar interop).
- Windows reserved-name scan stays clean.

---

### Task 1: pure `scrollSync` math (U27)

**Files:** Create `src/lib/scrollSync.ts`; Test `tests/unit/scroll-sync.test.ts`.

**Produces:**
- `interface SyncAnchor { line: number; top: number }`
- `lineAtOffset(anchors: SyncAnchor[], contentHeight: number, scrollTop: number): number`
- `offsetForLine(anchors: SyncAnchor[], contentHeight: number, line: number): number`

Semantics: the effective table is the input (sorted by top, deduped, non-monotonic entries dropped) with an implicit head `{line: 1, top: 0}` and implicit tail `{line: last.line + 1, top: contentHeight}`; interpolation is linear within each segment; inputs clamp to `[0, contentHeight]` / `[1, last.line + 1]`; empty input degenerates to the head/tail pair (pure proportional). Round-trip `offsetForLine(lineAtOffset(x))` returns x within 0.5px.

- [ ] Failing test:

```ts
import { describe, expect, test } from 'vitest';
import { lineAtOffset, offsetForLine, type SyncAnchor } from '../../src/lib/scrollSync';

const anchors: SyncAnchor[] = [
  { line: 1, top: 0 },
  { line: 10, top: 300 },
  { line: 20, top: 400 }, // dense: a tall code block above compressed lines
];

describe('SPEC15 scroll-sync math', () => {
  test('U27: interpolation, clamping, proportional fallback, round-trip stability', () => {
    // Exact anchor hits.
    expect(lineAtOffset(anchors, 1000, 0)).toBe(1);
    expect(lineAtOffset(anchors, 1000, 300)).toBe(10);
    // Interpolation inside a segment: halfway 0→300 is halfway line 1→10.
    expect(lineAtOffset(anchors, 1000, 150)).toBeCloseTo(5.5, 5);
    // Tail segment: 400→1000 spans line 20→21.
    expect(lineAtOffset(anchors, 1000, 700)).toBeCloseTo(20.5, 5);
    // Clamping.
    expect(lineAtOffset(anchors, 1000, -50)).toBe(1);
    expect(lineAtOffset(anchors, 1000, 99999)).toBe(21);
    expect(offsetForLine(anchors, 1000, -5)).toBe(0);
    expect(offsetForLine(anchors, 1000, 999)).toBe(1000);
    // Inverse.
    expect(offsetForLine(anchors, 1000, 5.5)).toBeCloseTo(150, 5);
    expect(offsetForLine(anchors, 1000, 20.5)).toBeCloseTo(700, 5);
    // Round-trip stability across the range.
    for (const y of [0, 37, 150, 299, 300, 350, 400, 731, 1000]) {
      expect(offsetForLine(anchors, 1000, lineAtOffset(anchors, 1000, y))).toBeCloseTo(y, 1);
    }
    // Empty table: pure proportional between implicit head and tail.
    expect(lineAtOffset([], 500, 250)).toBeCloseTo(1.5, 5);
    expect(offsetForLine([], 500, 1.5)).toBeCloseTo(250, 5);
    // Unsorted/duplicate/non-monotonic input is repaired, not crashed on.
    const messy: SyncAnchor[] = [
      { line: 10, top: 300 },
      { line: 10, top: 310 },
      { line: 5, top: 500 }, // non-monotonic: dropped
      { line: 2, top: 100 },
    ];
    expect(lineAtOffset(messy, 1000, 100)).toBe(2);
    expect(lineAtOffset(messy, 1000, 300)).toBe(10);
  });
});
```

- [ ] Implementation:

```ts
/**
 * SPEC15 §3.1: pure pixel-offset ↔ fractional-source-line mapping over a
 * table of block anchors ({ line, top }). The effective table always starts
 * at { line: 1, top: 0 } and ends at { line: last.line + 1, top:
 * contentHeight }, so every offset maps and the mapping inverts cleanly.
 * No DOM — both panes feed it their own geometry.
 */
export interface SyncAnchor {
  line: number;
  top: number;
}

/** Sort, dedupe, and drop non-monotonic entries; add implicit head + tail. */
function effectiveTable(anchors: SyncAnchor[], contentHeight: number): SyncAnchor[] {
  const sorted = [...anchors]
    .filter((a) => Number.isFinite(a.line) && Number.isFinite(a.top))
    .sort((a, b) => a.top - b.top || a.line - b.line);
  const table: SyncAnchor[] = [{ line: 1, top: 0 }];
  for (const a of sorted) {
    const prev = table[table.length - 1];
    if (a.line > prev.line && a.top > prev.top) table.push(a);
  }
  const last = table[table.length - 1];
  const height = Math.max(contentHeight, last.top + 1);
  table.push({ line: last.line + 1, top: height });
  return table;
}

export function lineAtOffset(anchors: SyncAnchor[], contentHeight: number, scrollTop: number): number {
  const table = effectiveTable(anchors, contentHeight);
  const y = Math.min(Math.max(scrollTop, 0), table[table.length - 1].top);
  for (let i = 1; i < table.length; i++) {
    if (y <= table[i].top) {
      const a = table[i - 1];
      const b = table[i];
      return a.line + ((y - a.top) / (b.top - a.top)) * (b.line - a.line);
    }
  }
  return table[table.length - 1].line;
}

export function offsetForLine(anchors: SyncAnchor[], contentHeight: number, line: number): number {
  const table = effectiveTable(anchors, contentHeight);
  const l = Math.min(Math.max(line, 1), table[table.length - 1].line);
  for (let i = 1; i < table.length; i++) {
    if (l <= table[i].line) {
      const a = table[i - 1];
      const b = table[i];
      return a.top + ((l - a.line) / (b.line - a.line)) * (b.top - a.top);
    }
  }
  return table[table.length - 1].top;
}
```

- [ ] `npx vitest run tests/unit/scroll-sync.test.ts` fail → implement → pass; `npm run typecheck`; commit `feat: SPEC15 scrollSync mapping (U27)`.

### Task 2: `data-mm-line` anchor stamping (U28)

**Files:** Modify `src/lib/markdown.ts`; Test `tests/unit/source-lines.test.ts`.

- [ ] In `markdown.ts`, extend the sanitize schema's `attributes` with a wildcard entry admitting exactly the one data attribute:

```ts
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataMmLine'],
    input: ['type', 'checked', 'disabled'],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'mm-blocked-remote']],
  },
```

- [ ] Add the inline plugin (next to `blockRemoteImages`, run **before** sanitize) and register it in the processor chain immediately after `remarkRehype`:

```ts
interface Positioned {
  position?: { start?: { line?: number } };
}

/**
 * SPEC15 §2: stamp top-level block elements with their markdown source start
 * line (1-based) so the split view can block-anchor its scroll sync. Only
 * direct children of the root are stamped; nodes without position data are
 * left alone (sync interpolates across gaps). Attributes only — the rendered
 * text is untouched, so the comment-anchor coordinate space is unchanged.
 */
function stampSourceLines() {
  return (tree: HastNode) => {
    for (const child of tree.children ?? []) {
      const line = (child as Positioned).position?.start?.line;
      if (child.type === 'element' && typeof line === 'number') {
        child.properties = { ...child.properties, dataMmLine: line };
      }
    }
  };
}
```

(Check how `blockRemoteImages` is registered in the `unified()` chain and mirror it. The hast tree at that stage has `position` preserved by remark-rehype.)

- [ ] U28 in `tests/unit/source-lines.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown';

const FIXTURE = `# Title

A paragraph.

\`\`\`js
code();
\`\`\`

- one
- two

| a | b |
| - | - |
| 1 | 2 |
`;

describe('SPEC15 source-line anchors', () => {
  test('U28: top-level blocks carry data-mm-line with correct source lines; text content is untouched', async () => {
    const html = await renderMarkdown(FIXTURE);
    expect(html).toContain('<h1 data-mm-line="1"');
    expect(html).toContain('<p data-mm-line="3"');
    expect(html).toMatch(/<pre data-mm-line="5"/);
    expect(html).toMatch(/<ul data-mm-line="9"/);
    expect(html).toMatch(/<table data-mm-line="12"/);
    // The attribute never leaks into rendered text (comment coordinate space).
    const text = html.replace(/<[^>]*>/g, '');
    expect(text).not.toContain('data-mm-line');
    expect(text).toContain('A paragraph.');
    expect(text).toContain('code();');
  });
});
```

(If GFM/remark assigns slightly different start lines for list/table, adjust the *fixture* spacing, not the assertion style — the numbers must be exact for the final fixture.)

- [ ] `npx vitest run tests/unit` all green (render-isolation untouched); typecheck; commit `feat: SPEC15 data-mm-line block anchors through sanitize (U28)`.

### Task 3: Editor `syncRef` handle

**Files:** Modify `src/components/Editor.tsx`.

**Produces:** exported `interface EditorSyncHandle { topLine(): number; scrollToLine(line: number): void; scrollInfo(): { top: number; max: number }; setScrollTop(top: number): void; onScroll(cb: () => void): () => void }` and a new optional prop `syncRef?: MutableRefObject<EditorSyncHandle | null>`.

- [ ] Implementation sketch (inside the mount effect, after `viewRef.current = view`):

```ts
    if (syncRef) {
      const dom = view.scrollDOM;
      syncRef.current = {
        topLine() {
          const pad = view.documentPadding.top;
          const y = Math.max(dom.scrollTop - pad, 0);
          const block = view.lineBlockAtHeight(y);
          const n = view.state.doc.lineAt(block.from).number;
          const frac = block.height > 0 ? Math.min(Math.max((y - block.top) / block.height, 0), 1) : 0;
          return n + frac;
        },
        scrollToLine(line) {
          const doc = view.state.doc;
          const n = Math.min(Math.max(Math.floor(line), 1), doc.lines);
          const block = view.lineBlockAt(doc.line(n).from);
          dom.scrollTop = block.top + (line - n) * block.height + view.documentPadding.top;
        },
        scrollInfo() {
          return { top: dom.scrollTop, max: dom.scrollHeight - dom.clientHeight };
        },
        setScrollTop(top) {
          dom.scrollTop = top;
        },
        onScroll(cb) {
          dom.addEventListener('scroll', cb);
          return () => dom.removeEventListener('scroll', cb);
        },
      };
    }
```

Cleanup: `syncRef.current = null` in the effect teardown before `view.destroy()`. Add `syncRef` to the destructured props and the `Props` interface (JSDoc: SPEC15 §3.2). CodeMirror geometry (`lineBlockAtHeight`/`lineBlockAt`) measures wrapped lines for real.

- [ ] `npm run typecheck`; commit `feat: SPEC15 editor scroll-sync handle`.

### Task 4: App controller wiring

**Files:** Modify `src/App.tsx`.

- [ ] Add refs and imports:

```ts
import { lineAtOffset, offsetForLine, type SyncAnchor } from './lib/scrollSync';
import type { EditorSyncHandle } from './components/Editor';
// …
const editorSyncRef = useRef<EditorSyncHandle | null>(null);
```

Pass `syncRef={editorSyncRef}` to the split-mode `<Editor …>` (ONLY the split one — full-screen edit keeps its behavior).

- [ ] Controller effect (active only while split is mounted; deps `[mode, settings.splitEdit, html]`):

```ts
  // --- SPEC15: synchronized split scrolling --------------------------------------
  useEffect(() => {
    if (mode !== 'edit' || !settings.splitEdit) return;
    const docEl = splitDocRef.current;
    const scroller = docEl?.parentElement; // .split-preview
    if (!docEl || !scroller) return;

    let anchors: SyncAnchor[] = [];
    let contentHeight = 1;
    const rebuild = () => {
      const docTop = docEl.getBoundingClientRect().top;
      anchors = Array.from(docEl.querySelectorAll<HTMLElement>('[data-mm-line]')).map((el) => ({
        line: Number(el.dataset.mmLine),
        top: el.getBoundingClientRect().top - docTop,
      }));
      contentHeight = Math.max(scroller.scrollHeight, 1);
    };
    rebuild();
    const ro = new ResizeObserver(rebuild); // divider drags, window resizes, late images
    ro.observe(docEl);

    // Programmatic follower writes must never re-lead (SPEC15 §1.1).
    const suppress = { editor: 0, preview: 0 };
    const AT_END = 2; // px slack for §1.3 end clamping

    const editorLeads = () => {
      const ed = editorSyncRef.current;
      if (!ed) return;
      const { top, max } = ed.scrollInfo();
      const previewMax = scroller.scrollHeight - scroller.clientHeight;
      let target: number;
      if (top <= AT_END) target = 0;
      else if (top >= max - AT_END) target = previewMax;
      else target = Math.min(offsetForLine(anchors, contentHeight, ed.topLine()), previewMax);
      if (Math.abs(scroller.scrollTop - target) < 1) return;
      suppress.preview++;
      scroller.scrollTop = target;
    };

    const previewLeads = () => {
      const ed = editorSyncRef.current;
      if (!ed) return;
      const { max } = ed.scrollInfo();
      const previewMax = scroller.scrollHeight - scroller.clientHeight;
      const y = scroller.scrollTop;
      if (y <= AT_END) {
        suppress.editor++;
        ed.setScrollTop(0);
        return;
      }
      if (y >= previewMax - AT_END) {
        suppress.editor++;
        ed.setScrollTop(max);
        return;
      }
      const before = ed.scrollInfo().top;
      suppress.editor++;
      ed.scrollToLine(lineAtOffset(anchors, contentHeight, y));
      if (Math.abs(ed.scrollInfo().top - before) < 1) suppress.editor--; // no-op write → no event
    };

    const onEditorScroll = () => {
      if (suppress.editor > 0) {
        suppress.editor--;
        return;
      }
      requestAnimationFrame(editorLeads);
    };
    const onPreviewScroll = () => {
      if (suppress.preview > 0) {
        suppress.preview--;
        return;
      }
      requestAnimationFrame(previewLeads);
    };

    const offEditor = editorSyncRef.current?.onScroll(onEditorScroll);
    scroller.addEventListener('scroll', onPreviewScroll);
    return () => {
      ro.disconnect();
      offEditor?.();
      scroller.removeEventListener('scroll', onPreviewScroll);
    };
  }, [mode, settings.splitEdit, html]);
```

Note the editor mounts lazily — `editorSyncRef.current` can be null on the first effect run; the handlers re-read it per event, and the `html` dep re-runs the effect after the first render. If `onScroll` subscription misses the lazy mount, poll once via a `requestAnimationFrame` retry loop capped at ~1s (implementer's judgment; E57 will catch it).

Similarly guard `editorLeads` when no-op (target within 1px) so suppression counters can't accumulate — already shown above.

- [ ] Manual sanity via `npm run dev` (browser shim): open a long doc, `⌘E` with split enabled, scroll both panes. Then `npm run typecheck && npm run test:unit && npm run test:e2e` (all existing green); commit `feat: SPEC15 split scroll-sync controller`.

### Task 5: e2e E57–E58

**Files:** Modify `tests/e2e/app.spec.ts` (append after E56).

Setup helper (local to the new tests): write a long fixture through `__mmfs`, enable split-edit in settings, open via the `#open=` hash, enter edit mode:

```ts
async function splitApp(page: import('@playwright/test').Page): Promise<void> {
  await freshApp(page);
  await page.evaluate(() => {
    const sections: string[] = [];
    for (let i = 1; i <= 40; i++) {
      sections.push(`## Marker ${i}\n`);
      if (i === 20) sections.push('```\n' + 'code line\n'.repeat(60) + '```\n');
      else sections.push(`Paragraph for section ${i}. `.repeat(8) + '\n');
    }
    window.__mmfs!.write('/docs/long.md', sections.join('\n'));
    const raw = window.__mmfs!.read('/config/settings.json');
    const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.__mmfs!.write('/config/settings.json', JSON.stringify({ ...settings, splitEdit: true }));
  });
  await page.reload();
  await page.goto('/#open=/docs/long.md');
  await expect(page.getByTestId('doc').locator('h2').first()).toContainText('Marker 1');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('split-divider')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
}
```

In-page probes:

```ts
const editorTopGutterLine = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')!;
    const top = scroller.getBoundingClientRect().top;
    const gutters = Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement'));
    const first = gutters.find((g) => g.getBoundingClientRect().bottom > top + 1 && /\d/.test(g.textContent ?? ''));
    return first ? Number(first.textContent) : -1;
  });

const previewTopAnchorLines = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('.split-preview')!;
    const doc = scroller.querySelector('.doc')!;
    const docTop = doc.getBoundingClientRect().top;
    const y = scroller.scrollTop;
    const anchors = Array.from(doc.querySelectorAll<HTMLElement>('[data-mm-line]')).map((el) => ({
      line: Number(el.dataset.mmLine),
      top: el.getBoundingClientRect().top - docTop,
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
  });
```

- [ ] **E57 — editor leads:**

```ts
test('E57: split scroll sync — the preview follows the editor, ends clamp, blocks stay aligned', async ({ page }) => {
  await splitApp(page);
  const editor = page.locator('.cm-scroller');
  const preview = page.locator('.split-preview');

  // End clamp: editor to bottom → preview bottoms out.
  await editor.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect
    .poll(() => preview.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(3);

  // Back to top → preview zeroes.
  await editor.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => preview.evaluate((el) => el.scrollTop)).toBeLessThan(3);

  // Mid-document: the editor's top visible line falls between the preview's
  // top bracketing anchors (±one block, SPEC15 §1.2).
  await editor.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.4));
  await expect
    .poll(async () => {
      const line = await editorTopGutterLine(page);
      const { before, after } = await previewTopAnchorLines(page);
      return line >= before - 5 && line <= after + 5;
    })
    .toBe(true);
});
```

- [ ] **E58 — preview leads + stability:**

```ts
test('E58: split scroll sync — the editor follows the preview; no feedback oscillation', async ({ page }) => {
  await splitApp(page);
  const preview = page.locator('.split-preview');

  // Scroll the preview so Marker 30 sits at the pane top.
  await preview.evaluate((el) => {
    const doc = el.querySelector('.doc')!;
    const target = Array.from(doc.querySelectorAll('h2')).find((h) => h.textContent === 'Marker 30')!;
    el.scrollTop = target.getBoundingClientRect().top - doc.getBoundingClientRect().top;
  });
  const markerLine = await preview.evaluate((el) => {
    const target = Array.from(el.querySelectorAll<HTMLElement>('[data-mm-line]')).find(
      (n) => n.textContent === 'Marker 30'
    )!;
    return Number(target.dataset.mmLine);
  });
  await expect
    .poll(async () => Math.abs((await editorTopGutterLine(page)) - markerLine))
    .toBeLessThan(6);

  // Settle check: both panes hold still across two frames — no loop.
  await page.waitForTimeout(150);
  const snap = () =>
    page.evaluate(() => ({
      e: document.querySelector('.cm-scroller')!.scrollTop,
      p: document.querySelector('.split-preview')!.scrollTop,
    }));
  const a = await snap();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const b = await snap();
  expect(b).toEqual(a);
});
```

- [ ] Run `npx playwright test -g "E57|E58"`, then the full suites; commit `test: SPEC15 split scroll-sync e2e (E57-E58)`.

### Task 6: README + full gate

- [ ] README edit-mode bullet gains synchronized scrolling, e.g.: `…side-by-side split (⌘E / Ctrl+E, remappable) with synchronized scrolling, and undo history that survives mode switches.`
- [ ] `npm run validate` → `VALIDATION: ALL PASSED` (U1–U28, E1–E41 + E45–E58, W1–W5); `npm run tauri build` exit 0 (path+size); reserved-name scan clean; `git diff src-tauri/tauri.conf.json` empty; sanitize diff = `dataMmLine` only; specs diff empty; skip/only/todo grep empty; versions untouched.
- [ ] Commit `docs: SPEC15 README synchronized-scrolling line` + plan doc; report with evidence.
