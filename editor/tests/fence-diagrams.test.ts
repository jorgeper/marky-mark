// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import {
  DIAGRAM_CLASS,
  DIAGRAM_ERROR_CLASS,
  renderFenceDiagrams,
  type DiagramRenderCache,
} from '../src/lib/fenceDiagrams';
import type { FenceRenderer } from '../src/lib/fenceRenderers';
import { getDocText } from './helpers';

// The graft names no language (PRD 013 Req 1): tests register a made-up tag
// through the injected lookup only — the real registry is never mutated, so
// there is nothing to restore for the shared-worker suite (isolate: false).
const TAG = 'fakelang';
const lookup =
  (renderer: FenceRenderer) =>
  (tag: string): FenceRenderer | undefined =>
    tag === TAG ? renderer : undefined;

/** A renderer whose SVG carries <text> labels — the Req 3 hazard on purpose. */
const okRenderer: FenceRenderer = (source, options) =>
  Promise.resolve({ ok: true, svg: `<svg><text>${options.theme}</text><text>${source}</text></svg>` });

function makeRoot(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const FENCE = `<pre><code class="language-${TAG}">a -&gt; b\n</code></pre>`;
const PLAIN = '<pre><code class="language-js">const x = 1;\n</code></pre>';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PRD 013 Req 2: registered fences draw automatically, others are untouched', () => {
  test('U934: a registered fence gains a diagram host with the SVG in its shadow root; other fences gain nothing', async () => {
    const root = makeRoot(`${FENCE}<p>between</p>${PLAIN}<pre><code>no language</code></pre>`);
    await renderFenceDiagrams(root, { rendererFor: lookup(okRenderer), theme: 'light' });

    const hosts = root.querySelectorAll(`.${DIAGRAM_CLASS}`);
    expect(hosts).toHaveLength(1);
    const host = hosts[0] as HTMLElement;
    expect(host.dataset.testid).toBe(DIAGRAM_CLASS);
    // The SVG lives in the shadow tree, immediately after its own <pre>.
    expect(host.shadowRoot!.querySelector('svg')).not.toBeNull();
    expect(host.previousElementSibling?.querySelector('code')?.className).toBe(`language-${TAG}`);
    // The drawn fence is marked for CSS to hide; the code stays in the tree.
    const pre = host.previousElementSibling as HTMLElement;
    expect(pre.dataset.mmDiagram).toBe('done');
    expect(pre.textContent).toContain('a -> b');
    // The unregistered fences carry no mark and no graft.
    for (const other of Array.from(root.querySelectorAll('pre')).filter((p) => p !== pre)) {
      expect(other.dataset.mmDiagram).toBeUndefined();
      expect(other.nextElementSibling?.classList.contains(DIAGRAM_CLASS) ?? false).toBe(false);
    }
  });

  test('U935: re-running over an already-decorated tree draws nothing twice and calls no renderer again', async () => {
    let calls = 0;
    const counting: FenceRenderer = (source, options) => {
      calls += 1;
      return okRenderer(source, options);
    };
    const root = makeRoot(FENCE + FENCE);
    const opts = { rendererFor: lookup(counting), theme: 'light' as const };
    await renderFenceDiagrams(root, opts);
    await renderFenceDiagrams(root, opts);
    expect(calls).toBe(2); // once per block, not per pass
    expect(root.querySelectorAll(`.${DIAGRAM_CLASS}`)).toHaveLength(2);
  });
});

describe('PRD 015 Req 4: the drawn SVG carries the persisted width; tolerant where it should be', () => {
  test('U779: a width-bearing fence draws its SVG at the stamped width, height left to the aspect ratio, mermaid\'s own max-width overridden', async () => {
    // The pipeline's stamp (data-mm-width, lib/markdown.ts) as the graft sees it.
    const sized = `<pre><code class="language-${TAG}" data-mm-width="500">a -&gt; b\n</code></pre>`;
    // A renderer whose SVG carries mermaid's usual own sizing — the persisted
    // width must outrank the inline max-width (larger-than-natural is honoured).
    const mermaidish: FenceRenderer = () =>
      Promise.resolve({ ok: true, svg: '<svg viewBox="0 0 100 50" style="max-width: 120px;"></svg>' });
    const root = makeRoot(sized);
    await renderFenceDiagrams(root, { rendererFor: lookup(mermaidish), theme: 'light' });
    const svg = (root.querySelector(`.${DIAGRAM_CLASS}`) as HTMLElement).shadowRoot!.querySelector('svg')!;
    expect(svg.style.width).toBe('500px');
    expect(svg.style.height).toBe('auto'); // height follows the viewBox aspect — nothing crops
    expect(svg.style.maxWidth).toBe('none');
  });

  test('U780: a widthless or intolerably-stamped fence draws exactly as before — no inline sizing, no extra renderer call, no error state', async () => {
    let calls = 0;
    const counting: FenceRenderer = (source, options) => {
      calls += 1;
      return okRenderer(source, options);
    };
    const bad = `<pre><code class="language-${TAG}" data-mm-width="12.5">a -&gt; b\n</code></pre>`;
    const zero = `<pre><code class="language-${TAG}" data-mm-width="0">a -&gt; b\n</code></pre>`;
    const root = makeRoot(FENCE + bad + zero);
    await renderFenceDiagrams(root, { rendererFor: lookup(counting), theme: 'light' });
    expect(calls).toBe(3); // once per block, same as today — the width read adds no render pass
    const hosts = Array.from(root.querySelectorAll(`.${DIAGRAM_CLASS}`)) as HTMLElement[];
    expect(hosts).toHaveLength(3); // drawn, not failed: an intolerable width is ignored, no badge
    for (const host of hosts) {
      const svg = host.shadowRoot!.querySelector('svg')!;
      expect(svg.getAttribute('style')).toBeNull(); // natural size: the paint touched no style
    }
    for (const pre of Array.from(root.querySelectorAll('pre')) as HTMLElement[]) {
      expect(pre.dataset.mmDiagram).toBe('done');
    }
  });
});

describe('PRD 013 Req 3: the graft is invisible to the anchor coordinate space', () => {
  test('U936: getDocText is byte-identical with diagrams drawn, failed, and left as code', async () => {
    const html = `<h1>Title</h1>${FENCE}<p>middle paragraph</p>${FENCE}${PLAIN}<p>tail</p>`;
    const asCode = makeRoot(html);
    const drawn = makeRoot(html);
    const before = getDocText(drawn);
    expect(before).toBe(getDocText(asCode));

    await renderFenceDiagrams(drawn, { rendererFor: lookup(okRenderer), theme: 'light' });
    expect(getDocText(drawn)).toBe(before);

    // Failure keeps the invariant too: the badge's message is shadow-rooted.
    const failed = makeRoot(html);
    const failing: FenceRenderer = () => Promise.resolve({ ok: false, message: 'syntax error near b' });
    await renderFenceDiagrams(failed, { rendererFor: lookup(failing), theme: 'light' });
    expect(getDocText(failed)).toBe(before);
  });
});

describe('PRD 013 Req 10: a failing fence keeps its code, says why, and stops nothing else', () => {
  test('U937: the failed block keeps its visible code plus a badge carrying the message; a valid fence in the same tree still draws', async () => {
    const bad = `<pre><code class="language-${TAG}">broken\n</code></pre>`;
    const root = makeRoot(`${bad}<p>between</p>${FENCE}`);
    const renderer: FenceRenderer = (source, options) =>
      source === 'broken' ? Promise.resolve({ ok: false, message: 'no such shape' }) : okRenderer(source, options);
    await renderFenceDiagrams(root, { rendererFor: lookup(renderer), theme: 'light' });

    const failedPre = root.querySelector('pre') as HTMLElement;
    expect(failedPre.dataset.mmDiagram).toBe('error'); // NOT 'done' — CSS keeps it visible
    const badge = failedPre.nextElementSibling as HTMLElement;
    expect(badge.classList.contains(DIAGRAM_ERROR_CLASS)).toBe(true);
    expect(badge.dataset.testid).toBe(DIAGRAM_ERROR_CLASS);
    expect(badge.shadowRoot!.textContent).toContain('no such shape');
    // The valid fence later in the document still drew.
    expect(root.querySelectorAll(`.${DIAGRAM_CLASS}`)).toHaveLength(1);
  });

  test('U938: a renderer that breaks the seam contract and rejects still yields the failure shape, not a crash', async () => {
    const root = makeRoot(FENCE);
    const rejecting: FenceRenderer = () => Promise.reject(new Error('contract broken'));
    await renderFenceDiagrams(root, { rendererFor: lookup(rejecting), theme: 'light' });
    const pre = root.querySelector('pre') as HTMLElement;
    expect(pre.dataset.mmDiagram).toBe('error');
    expect((pre.nextElementSibling as HTMLElement).shadowRoot!.textContent).toContain('contract broken');
  });

  test('U745: a redraw that fails replaces the diagram with the badge, and a later success replaces it back', async () => {
    let fails = false;
    const flaky: FenceRenderer = (source, options) =>
      fails ? Promise.resolve({ ok: false, message: 'gone bad' }) : okRenderer(source, options);
    const root = makeRoot(FENCE);
    // Only a theme change redraws a settled block (Req 9), so each pass flips it.
    await renderFenceDiagrams(root, { rendererFor: lookup(flaky), theme: 'light' });
    const pre = root.querySelector('pre') as HTMLElement;
    expect(pre.dataset.mmDiagram).toBe('done');

    fails = true;
    await renderFenceDiagrams(root, { rendererFor: lookup(flaky), theme: 'dark' });
    expect(pre.dataset.mmDiagram).toBe('error'); // CSS shows the code again
    expect(root.querySelectorAll(`.${DIAGRAM_CLASS}`)).toHaveLength(0);
    expect(root.querySelectorAll(`.${DIAGRAM_ERROR_CLASS}`)).toHaveLength(1);

    fails = false;
    await renderFenceDiagrams(root, { rendererFor: lookup(flaky), theme: 'light' });
    expect(pre.dataset.mmDiagram).toBe('done');
    expect(root.querySelectorAll(`.${DIAGRAM_CLASS}`)).toHaveLength(1);
    expect(root.querySelectorAll(`.${DIAGRAM_ERROR_CLASS}`)).toHaveLength(0);
  });
});

describe('PRD 013 Req 11: loading keeps the code; a stale result never paints', () => {
  test('U939: while the renderer is pending the block shows its code unhidden; the diagram appears on resolution', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: FenceRenderer = async (source, options) => {
      await gate;
      return okRenderer(source, options);
    };
    const root = makeRoot(FENCE);
    const done = renderFenceDiagrams(root, { rendererFor: lookup(slow), theme: 'light' });
    const pre = root.querySelector('pre') as HTMLElement;
    expect(pre.dataset.mmDiagram).toBe('pending'); // code visible: CSS hides only 'done'
    expect(root.querySelector(`.${DIAGRAM_CLASS}`)).toBeNull();
    release();
    await done;
    expect(pre.dataset.mmDiagram).toBe('done');
    expect(root.querySelector(`.${DIAGRAM_CLASS}`)).not.toBeNull();
  });

  test('U742: a render resolving after its tree was re-injected paints nothing into the new tree and does not throw', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: FenceRenderer = async (source, options) => {
      await gate;
      return okRenderer(source, options);
    };
    const root = makeRoot(FENCE);
    const done = renderFenceDiagrams(root, { rendererFor: lookup(slow), theme: 'light' });
    root.innerHTML = FENCE; // the keystroke/document-switch re-injection
    release();
    await done;
    expect(root.querySelector(`.${DIAGRAM_CLASS}`)).toBeNull();
    expect((root.querySelector('pre') as HTMLElement).dataset.mmDiagram).toBeUndefined();
  });
});

describe('PRD 015 Req 7: with a render cache, a re-injection re-runs no renderer and never flashes pending', () => {
  test('U789: one renderer invocation across two passes over re-injected DOM of the same source; the second pass paints synchronously, never entering pending', async () => {
    let calls = 0;
    const counting: FenceRenderer = (source, options) => {
      calls += 1;
      return okRenderer(source, options);
    };
    const cache: DiagramRenderCache = new Map();
    const opts = { rendererFor: lookup(counting), theme: 'light' as const, cache };
    const first = makeRoot(FENCE);
    await renderFenceDiagrams(first, opts);
    expect(calls).toBe(1);

    // The buffer-write shape: a FRESH tree with the same fence source.
    const second = makeRoot(FENCE);
    const pass = renderFenceDiagrams(second, opts);
    // Before any await: the settled cache repainted synchronously — the block
    // went straight to 'done' (no pending, no flash of raw fence source) and
    // the drawing is already in place.
    const pre = second.querySelector('pre') as HTMLElement;
    expect(pre.dataset.mmDiagram).toBe('done');
    expect(second.querySelector(`.${DIAGRAM_CLASS}`)).not.toBeNull();
    await pass;
    expect(calls).toBe(1); // the renderer never ran again
  });

  test('U790: a width-only change is a cache hit — the fresh stamp resizes the synchronously repainted SVG, no renderer call', async () => {
    let calls = 0;
    const counting: FenceRenderer = (source, options) => {
      calls += 1;
      return okRenderer(source, options);
    };
    const cache: DiagramRenderCache = new Map();
    const opts = { rendererFor: lookup(counting), theme: 'light' as const, cache };
    await renderFenceDiagrams(makeRoot(FENCE), opts);

    // The release rewrote `width=N`: same body, a new data-mm-width stamp.
    const resized = makeRoot(
      `<pre><code class="language-${TAG}" data-mm-width="240">a -&gt; b\n</code></pre>`
    );
    void renderFenceDiagrams(resized, opts);
    const svg = (resized.querySelector(`.${DIAGRAM_CLASS}`) as HTMLElement).shadowRoot!.querySelector('svg')!;
    expect(svg.style.width).toBe('240px'); // painted synchronously, at the new width
    expect(calls).toBe(1);
  });

  test('U791: a fence-body change (and a theme change) each invoke the renderer afresh; identical in-flight fences share one job', async () => {
    let calls = 0;
    const counting: FenceRenderer = (source, options) => {
      calls += 1;
      return okRenderer(source, options);
    };
    const cache: DiagramRenderCache = new Map();
    const opts = { rendererFor: lookup(counting), theme: 'light' as const, cache };
    // Two identical fences in one pass: one shared render job.
    await renderFenceDiagrams(makeRoot(FENCE + FENCE), opts);
    expect(calls).toBe(1);

    const edited = `<pre><code class="language-${TAG}">a -&gt; b -&gt; c\n</code></pre>`;
    await renderFenceDiagrams(makeRoot(edited), opts);
    expect(calls).toBe(2); // mermaid re-runs exactly when the body changes

    await renderFenceDiagrams(makeRoot(FENCE), { ...opts, theme: 'dark' });
    expect(calls).toBe(3); // a theme change draws the new side, as today
  });
});

describe('PRD 013 Req 9: the diagram follows the active theme side', () => {
  test('U743: the renderer receives the injected side; a theme change redraws in place with the new side', async () => {
    const seen: string[] = [];
    const recording: FenceRenderer = (source, options) => {
      seen.push(options.theme);
      return okRenderer(source, options);
    };
    const root = makeRoot(FENCE);
    await renderFenceDiagrams(root, { rendererFor: lookup(recording), theme: 'dark' });
    const host = root.querySelector(`.${DIAGRAM_CLASS}`) as HTMLElement;
    expect(seen).toEqual(['dark']);
    expect(host.shadowRoot!.textContent).toContain('dark');

    await renderFenceDiagrams(root, { rendererFor: lookup(recording), theme: 'light' });
    expect(seen).toEqual(['dark', 'light']);
    // Redrawn in place: still exactly one host, now carrying the light SVG.
    const hosts = root.querySelectorAll(`.${DIAGRAM_CLASS}`);
    expect(hosts).toHaveLength(1);
    expect((hosts[0] as HTMLElement).shadowRoot!.textContent).toContain('light');
    expect((hosts[0] as HTMLElement).shadowRoot!.textContent).not.toContain('dark');
  });

  test('U744: an old theme\'s slow render loses to the newer pass — the newer side wins on screen', async () => {
    let releaseDark!: () => void;
    const darkGate = new Promise<void>((r) => (releaseDark = r));
    const renderer: FenceRenderer = async (source, options) => {
      if (options.theme === 'dark') await darkGate;
      return okRenderer(source, options);
    };
    const root = makeRoot(FENCE);
    const darkPass = renderFenceDiagrams(root, { rendererFor: lookup(renderer), theme: 'dark' });
    const lightPass = renderFenceDiagrams(root, { rendererFor: lookup(renderer), theme: 'light' });
    await lightPass;
    releaseDark();
    await darkPass;
    const host = root.querySelector(`.${DIAGRAM_CLASS}`) as HTMLElement;
    expect(host.shadowRoot!.textContent).toContain('light');
    expect(host.shadowRoot!.textContent).not.toContain('dark');
  });
});
