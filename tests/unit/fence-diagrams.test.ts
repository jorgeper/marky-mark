// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import { DIAGRAM_CLASS, DIAGRAM_ERROR_CLASS, renderFenceDiagrams } from '../../src/lib/fenceDiagrams';
import type { FenceRenderer } from '../../src/lib/fenceRenderers';
import { getDocText } from '../../src/lib/domtext';

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
  test('U736: a registered fence gains a diagram host with the SVG in its shadow root; other fences gain nothing', async () => {
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

  test('U737: re-running over an already-decorated tree draws nothing twice and calls no renderer again', async () => {
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

describe('PRD 013 Req 3: the graft is invisible to the anchor coordinate space', () => {
  test('U738: getDocText is byte-identical with diagrams drawn, failed, and left as code', async () => {
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
  test('U739: the failed block keeps its visible code plus a badge carrying the message; a valid fence in the same tree still draws', async () => {
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

  test('U740: a renderer that breaks the seam contract and rejects still yields the failure shape, not a crash', async () => {
    const root = makeRoot(FENCE);
    const rejecting: FenceRenderer = () => Promise.reject(new Error('contract broken'));
    await renderFenceDiagrams(root, { rendererFor: lookup(rejecting), theme: 'light' });
    const pre = root.querySelector('pre') as HTMLElement;
    expect(pre.dataset.mmDiagram).toBe('error');
    expect((pre.nextElementSibling as HTMLElement).shadowRoot!.textContent).toContain('contract broken');
  });
});

describe('PRD 013 Req 11: loading keeps the code; a stale result never paints', () => {
  test('U741: while the renderer is pending the block shows its code unhidden; the diagram appears on resolution', async () => {
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
