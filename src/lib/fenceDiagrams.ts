/**
 * PRD 013 Req 2: the preview's fence-diagram pass — draws every fenced code
 * block whose language has a registered fence renderer (`fenceRenderers.ts`)
 * as its diagram, automatically, with no per-block affordance. Like the copy
 * buttons (`lib/codeCopy.ts`), the diagram is deliberately NOT part of the
 * markdown pipeline (`lib/markdown.ts`): that pipeline's rendered text is the
 * coordinate space comment anchors are offsets into, and its HTML is what
 * Export and print reuse — so the diagram is grafted onto the live preview
 * DOM after injection, and the pipeline's sanitize schema never widens.
 *
 * PRD 013 Req 3: the graft contributes ZERO text nodes to the anchor
 * coordinate space. The fence's own `<pre><code>` stays in the tree (hidden
 * by CSS on success — `getDocText`'s TreeWalker ignores CSS, so its text
 * survives in place and in order), and the SVG lives inside a shadow root on
 * the host element beside it. A shadow root was chosen over an `<img>` data
 * URL because `document.createTreeWalker(root, SHOW_TEXT)` never descends
 * into shadow trees — the SVG's `<text>` label nodes are therefore invisible
 * to `getDocText`/`offsetsToRange` — while the SVG still renders crisply at
 * any zoom, inherits the theme's fonts (inheritable properties cross the
 * shadow boundary), and can be swapped in place on a theme change without
 * re-encoding. The shadow root is `open` so tests can read what was drawn.
 * The failure badge's message text sits in a shadow root for the same reason.
 *
 * PRD 013 Req 4: what a renderer returns is injected as post-sanitize markup,
 * the same trust posture as the image widgets — so scrubbing an SVG down to
 * something safe to inject is the renderer's own contract (`mermaidRenderer`
 * does it), never this pass's. A failure message is injected as a text node,
 * so a renderer's message can carry no markup at all.
 *
 * PRD 013 Req 1: this module names no fence language. Candidates are found
 * through the seam's `fenceLanguage`, and renderers come from the injected
 * `rendererFor` lookup — registering a second language needs no edit here.
 */

import { codeBlockText } from './codeCopy';
import { fenceLanguage, type FenceRenderer, type FenceRenderResult } from './fenceRenderers';

/** The diagram host — carries the SVG in its shadow root; also its testid. */
export const DIAGRAM_CLASS = 'mm-diagram';
/** The failure badge — carries the renderer's message in its shadow root; also its testid. */
export const DIAGRAM_ERROR_CLASS = 'mm-diagram-error';

/**
 * PRD 013 Req 11: the fence's `<pre>` records where its diagram stands —
 * `pending` (code visible while the renderer works, so the block never
 * collapses), `done` (CSS hides the code, the host shows the SVG), `error`
 * (code stays visible beside the badge). styles.css keys off `done`.
 */
export type DiagramState = 'pending' | 'done' | 'error';

/** What the drawing pass needs beyond the DOM it is handed — all injected. */
export interface FenceDiagramOptions {
  /** PRD 013 Req 1: the registry lookup (`fenceRendererFor`), injected. */
  rendererFor: (tag: string) => FenceRenderer | undefined;
  /** PRD 013 Req 9: the app's ACTIVE theme side (the resolved theme's variant). */
  theme: 'light' | 'dark';
}

// PRD 013 Req 11: monotonically increasing pass token. Each pass stamps the
// `<pre>`s it renders; a result landing later paints only if its stamp is
// still current AND the node is still connected — a keystroke's re-injection
// or a newer pass (theme change) silently wins over a slow render.
let pass = 0;

/**
 * PRD 013 Req 2: draw every registered-language fence under `root`.
 * Idempotent: a block already drawn (or in flight) for `options.theme` is
 * skipped, so re-running over a decorated tree adds nothing twice; the same
 * mark makes a theme change (Req 9) redraw in place — the old diagram stays
 * visible until its replacement resolves, so nothing collapses. Resolves when
 * every block this pass touched has settled (the completion report).
 */
export function renderFenceDiagrams(root: HTMLElement, options: FenceDiagramOptions): Promise<void> {
  const jobs: Array<Promise<void>> = [];
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    const code = pre.querySelector('code');
    if (!code) continue; // not a fenced block
    const tag = fenceLanguage(code.getAttribute('class'));
    if (tag == null) continue;
    const renderer = options.rendererFor(tag);
    if (!renderer) continue; // unregistered language: today's code block, untouched
    if (pre.dataset.mmDiagram && pre.dataset.mmDiagramTheme === options.theme) continue;
    const token = String(++pass);
    pre.dataset.mmDiagramTheme = options.theme;
    pre.dataset.mmDiagramRun = token;
    // PRD 013 Req 11: first sight of this block — show its code while the
    // renderer (and, first time, its lazily loaded library) works. A block
    // being redrawn keeps its previous state (`done`/`error`) until the new
    // result lands, so the reader never sees a flash of raw code.
    if (!pre.dataset.mmDiagram) markState(pre, 'pending');
    jobs.push(renderOne(pre, codeBlockText(code.textContent ?? ''), renderer, options.theme, token));
  }
  return Promise.all(jobs).then(() => undefined);
}

async function renderOne(
  pre: HTMLElement,
  source: string,
  renderer: FenceRenderer,
  theme: 'light' | 'dark',
  token: string
): Promise<void> {
  let result: FenceRenderResult;
  try {
    result = await renderer(source, { theme });
  } catch (error) {
    // PRD 013 Req 10: the seam says renderers resolve failures rather than
    // throw, but one that breaks its contract still must not blank the block
    // or stop the rest of the document.
    result = { ok: false, message: errorMessage(error) };
  }
  // PRD 013 Req 11: stale-result guard — the tree was re-injected (node no
  // longer connected) or a newer pass stamped this block. Paint nothing.
  if (!pre.isConnected || pre.dataset.mmDiagramRun !== token) return;

  if (result.ok) {
    // PRD 013 Req 3: the SVG (and its <text> labels) enters the shadow tree
    // only — see the module header for why this keeps getDocText byte-identical.
    const shadow = graftShadow(pre, DIAGRAM_CLASS);
    shadow.innerHTML = `<style>:host { display: block; } svg { display: block; }</style>${result.svg}`;
    markState(pre, 'done');
  } else {
    // PRD 013 Req 10: the code block stays exactly as rendered; the badge —
    // unobtrusive, text shadow-rooted — carries the renderer's message.
    const shadow = graftShadow(pre, DIAGRAM_ERROR_CLASS);
    shadow.innerHTML = '<style>:host { display: block; }</style>';
    shadow.append(pre.ownerDocument.createTextNode(result.message));
    markState(pre, 'error');
  }
}

/**
 * The block's graft — always the element immediately after its `<pre>`, so a
 * redraw reuses what is there and swaps its content in place. A graft of the
 * other kind (a diagram where a failure now stands, or the reverse) is
 * replaced. Returns the host's shadow root for the caller to fill.
 */
function graftShadow(pre: HTMLElement, className: string): ShadowRoot {
  const next = pre.nextElementSibling;
  const previous =
    next instanceof HTMLElement &&
    (next.classList.contains(DIAGRAM_CLASS) || next.classList.contains(DIAGRAM_ERROR_CLASS))
      ? next
      : null;
  let host = previous;
  if (previous && !previous.classList.contains(className)) {
    previous.remove();
    host = null;
  }
  if (!host) {
    host = pre.ownerDocument.createElement('div');
    pre.after(host);
  }
  host.className = className;
  host.dataset.testid = className;
  return host.shadowRoot ?? host.attachShadow({ mode: 'open' });
}

/** PRD 013 Req 11: record where the block stands, for CSS and for tests. */
function markState(pre: HTMLElement, state: DiagramState): void {
  pre.dataset.mmDiagram = state;
}

/** A renderer that broke the seam contract and rejected, as a short message. */
function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Diagram could not be rendered.';
}
