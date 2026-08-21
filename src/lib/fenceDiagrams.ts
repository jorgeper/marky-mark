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
import {
  fenceLanguage,
  renderSafely,
  type FenceRenderer,
  type FenceRenderResult,
} from './fenceRenderers';

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
    jobs.push(
      renderOne(pre, codeBlockText(code.textContent ?? ''), renderer, options.theme, token, fenceWidthOf(code))
    );
  }
  return Promise.all(jobs).then(() => undefined);
}

/**
 * PRD 015 Req 4: the persisted width the pipeline stamped on the fence's
 * `<code>` (`data-mm-width`, lib/markdown.ts). The pipeline stamps only the
 * parsed positive integer, and re-reading it as one here keeps a hand-built
 * or mutated DOM from smuggling anything else into the inline style below.
 * Absent or intolerable (PRD 015 Req 3) ⇒ null: the diagram draws at natural
 * size, exactly as today.
 */
function fenceWidthOf(code: HTMLElement): number | null {
  const raw = code.dataset.mmWidth ?? '';
  if (!/^\d+$/.test(raw)) return null; // digits only, like the token itself
  const width = Number(raw);
  return width > 0 ? width : null;
}

async function renderOne(
  pre: HTMLElement,
  source: string,
  renderer: FenceRenderer,
  theme: 'light' | 'dark',
  token: string,
  width: number | null
): Promise<void> {
  // PRD 013 Req 10: `renderSafely` turns a contract-breaking rejection into
  // the typed failure, so it can't blank the block or stop the document.
  const result = await renderSafely(renderer, source, { theme });
  // PRD 013 Req 11: stale-result guard — the tree was re-injected (node no
  // longer connected) or a newer pass stamped this block. Paint nothing.
  if (!pre.isConnected || pre.dataset.mmDiagramRun !== token) return;

  if (result.ok) {
    // PRD 013 Req 3: the SVG (and its <text> labels) enters the shadow tree
    // only — see the module header for why this keeps getDocText byte-identical.
    paintDiagramResult(graftHost(pre, DIAGRAM_CLASS), result, width);
    markState(pre, 'done');
  } else {
    // PRD 013 Req 10: the code block stays exactly as rendered; the badge —
    // unobtrusive, text shadow-rooted — carries the renderer's message.
    paintDiagramResult(graftHost(pre, DIAGRAM_ERROR_CLASS), result);
    markState(pre, 'error');
  }
}

/**
 * PRD 013 Req 3/Req 4: fill a host element's shadow root with what a renderer
 * returned — the SVG as post-sanitize markup (scrubbing it is the renderer's
 * own contract), a failure message as a TEXT NODE, so a message can carry no
 * markup at all. Both consumers paint through here — this preview pass and
 * the edit-pane widget (`components/diagramView.ts`) — so the shadow shape
 * and that trust posture are stated in one place. The host keeps whatever
 * shadow root it already has, so a redraw swaps content in place.
 */
export function paintDiagramResult(host: HTMLElement, result: FenceRenderResult, width: number | null = null): void {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (result.ok) {
    shadow.innerHTML = `<style>:host { display: block; } svg { display: block; }</style>${result.svg}`;
    // A null width touches nothing: natural size, exactly as today.
    if (width !== null) sizeDrawnSvg(shadow, width);
  } else {
    shadow.innerHTML = '<style>:host { display: block; }</style>';
    shadow.append(host.ownerDocument.createTextNode(result.message));
  }
}

/**
 * PRD 015 Req 4: the persisted width, applied to the SVG the renderer already
 * produced — never by re-invoking it (no extra render pass). Inline on the
 * element so it outranks mermaid's own inline `max-width`, which would
 * otherwise veto a width past the natural layout (a larger persisted width is
 * still honoured at draw time — the natural-width clamp belongs to the drag
 * gesture, issue #171). `height: auto` leaves the height to the SVG's viewBox
 * aspect ratio, so the whole drawing scales and nothing crops, clips or
 * letterboxes; PRD 013 Req 9's `overflow-x: auto` on the host still scrolls
 * anything wider than the pane.
 */
function sizeDrawnSvg(shadow: ShadowRoot, width: number): void {
  const svg = shadow.querySelector('svg');
  if (!svg) return;
  svg.style.width = `${width}px`;
  svg.style.height = 'auto';
  svg.style.maxWidth = 'none';
}

/**
 * The block's graft — always the element immediately after its `<pre>`, so a
 * redraw reuses what is there and swaps its content in place. A graft of the
 * other kind (a diagram where a failure now stands, or the reverse) is
 * replaced. Returns the host element for `paintDiagramResult` to fill.
 */
function graftHost(pre: HTMLElement, className: string): HTMLElement {
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
  return host;
}

/** PRD 013 Req 11: record where the block stands, for CSS and for tests. */
function markState(pre: HTMLElement, state: DiagramState): void {
  pre.dataset.mmDiagram = state;
}
