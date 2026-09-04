/**
 * PRD 013 Req 5: the edit-pane diagram view — view wiring over the pure
 * span core in src/lib/diagramSpans.ts, following the SPEC41 image view's
 * StateField shape (a block widget must come from a field, not a plugin,
 * because it changes the vertical layout). Nothing here ever changes text,
 * history, or the dirty state: widgets replace fences visually and vanish
 * without a trace. Editor.tsx includes the extension in a compartment
 * while the `diagramView` setting is on — off, the compartment is empty.
 *
 * PRD 013 Req 1: no fence language is named here. Qualifying fences come
 * from the injected `rendererFor` lookup — the same seam the preview graft
 * uses — so a second registered language draws with no edit to this file.
 */
import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { computeDiagramSpans, sameDiagramDrawing, type DiagramSpan } from '../lib/diagramSpans';
import { renderSafely, type FenceRenderer, type FenceRenderResult } from '../lib/fenceRenderers';
import { DIAGRAM_CLASS, DIAGRAM_ERROR_CLASS, paintDiagramResult } from '../lib/fenceDiagrams';
import { tableModeField } from './tableMode';

export interface DiagramViewConfig {
  /** PRD 013 Req 1: the registry lookup (`fenceRendererFor`), injected. */
  rendererFor(tag: string): FenceRenderer | undefined;
  /** PRD 013 Req 9: the app's ACTIVE theme side — widgets draw to match. */
  theme: 'light' | 'dark';
}

// Give the background parser a bounded budget so fences below the initially
// parsed region still decorate on the first build (small docs finish whole).
const PARSE_BUDGET_MS = 20;

/**
 * PRD 013 Req 11: rendered results, keyed by tag/source/theme, kept per
 * extension instance. A caret-reveal cycle destroys and recreates the
 * widget's DOM; the cache makes the re-draw immediate instead of re-running
 * the renderer. Insertion-order eviction keeps a long editing session from
 * accumulating one entry per keystroke.
 */
type RenderCache = Map<string, Promise<FenceRenderResult>>;
const CACHE_MAX = 64;

function cachedRender(
  cache: RenderCache,
  renderer: FenceRenderer,
  source: string,
  theme: 'light' | 'dark',
  tag: string
): Promise<FenceRenderResult> {
  // A separator no fence source is going to contain, so two different
  // (theme, tag, source) triples can never share a key. Written as an escape:
  // a literal NUL byte here would make git treat this module as binary.
  const key = `${theme}\u0000${tag}\u0000${source}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = renderSafely(renderer, source, { theme });
  cache.set(key, job);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return job;
}

class DiagramWidget extends WidgetType {
  constructor(
    readonly span: DiagramSpan,
    readonly theme: 'light' | 'dark',
    readonly renderer: FenceRenderer,
    readonly cache: RenderCache,
    readonly measure: () => void
  ) {
    super();
  }

  // Same drawing ⇒ same DOM: CodeMirror keeps the element (and the SVG
  // already swapped into it) across rebuilds — a caret move elsewhere never
  // re-renders a diagram. A source, tag, theme or width change makes a fresh
  // widget (PRD 015 Req 4: a width change must redraw the block — and the
  // render cache, keyed on theme/tag/source only, makes that redraw a cache
  // hit: mermaid never re-runs for a width-only change).
  eq(other: DiagramWidget): boolean {
    return sameDiagramDrawing(other.span, this.span) && other.theme === this.theme;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'mm-editor-diagram';
    // PRD 013 Req 11: while the renderer (and, first time, its lazily
    // loaded library) works, the fence source holds the block's space — the
    // block never collapses.
    const pre = document.createElement('pre');
    pre.className = 'mm-editor-diagram-source';
    pre.textContent = this.span.source;
    wrap.appendChild(pre);
    void this.render(wrap);
    return wrap;
  }

  private async render(wrap: HTMLElement): Promise<void> {
    const result = await cachedRender(
      this.cache,
      this.renderer,
      this.span.source,
      this.theme,
      this.span.tag
    );
    // PRD 013 Req 11: stale-result guard — the fence changed, the setting
    // went off, or the theme moved on: this DOM was detached, paint nothing.
    if (!wrap.isConnected) return;
    // The drawing (or the failure note) is the preview's own graft shape,
    // painted by the preview's own helper — one home for the shadow root and
    // the post-sanitize injection posture.
    const className = result.ok ? DIAGRAM_CLASS : DIAGRAM_ERROR_CLASS;
    const host = wrap.ownerDocument.createElement('div');
    host.className = className;
    host.dataset.testid = className;
    // PRD 015 Req 4: the edit-pane widget draws the same persisted width as
    // the preview — applied by the shared painter to the cached SVG.
    paintDiagramResult(host, result, this.span.width);
    // A drawing takes the block over; PRD 013 Req 10: a failure note joins
    // the source, which stays visible above it.
    if (result.ok) wrap.replaceChildren(host);
    else wrap.appendChild(host);
    this.measure(); // the block's height changed — remeasure the layout
  }

  // The click must reach our mousedown handler (reveal the source).
  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecos(
  state: EditorState,
  cfg: DiagramViewConfig,
  cache: RenderCache,
  measure: () => void
): DecorationSet {
  // Grid exclusion, like SPEC41 §2.4: gridded spans keep their own geometry.
  const grid = state.field(tableModeField, false);
  ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS);
  const spans = computeDiagramSpans(state, true, (tag) => !!cfg.rendererFor(tag), grid?.spans ?? []);
  const ranges = [];
  for (const s of spans) {
    // PRD 013 Req 5: caret inside — the fence shows its raw source for
    // editing; the other diagram fences in the document stay drawn.
    if (s.revealed) continue;
    // Registered by construction (the predicate above qualified the span) —
    // re-read here for the typed handle.
    const renderer = cfg.rendererFor(s.tag);
    if (!renderer) continue;
    ranges.push(
      Decoration.replace({
        widget: new DiagramWidget(s, cfg.theme, renderer, cache, measure),
        block: true,
      }).range(s.from, s.to)
    );
  }
  return Decoration.set(ranges, true);
}

/** The diagram-view bundle Editor.tsx mounts while `diagramView` is on. */
export function diagramViewExtension(cfg: DiagramViewConfig): Extension {
  const cache: RenderCache = new Map();
  // The async swap changes a block widget's height after CodeMirror last
  // measured it; the view (captured at first build) gets a remeasure nudge.
  let measureView: EditorView | null = null;
  const measure = () => measureView?.requestMeasure();

  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecos(state, cfg, cache, measure);
    },
    update(decos, tr) {
      // Selection moves drive the caret-reveal; grid-set changes arrive as
      // effects (the SPEC41 field's triggers, restated).
      if (!tr.docChanged && !tr.selection && !tr.effects.length) return decos;
      return buildDecos(tr.state, cfg, cache, measure);
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v),
  });

  const dom = EditorView.domEventHandlers({
    // PRD 013 Req 5: clicking a diagram yields the fence source back at the
    // caret — parking the head at the block start counts as inside (the
    // codeBlockSpans boundary rule), so the click itself reveals. A pure
    // selection dispatch: no text, no history, no dirty dot, ever.
    mousedown(event, view) {
      const target = event.target as HTMLElement | null;
      const host = target?.closest?.('.mm-editor-diagram') as HTMLElement | null;
      if (!host || !view.contentDOM.contains(host)) return false;
      const pos = view.posAtDOM(host);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
      event.preventDefault();
      return true;
    },
  });

  // Capture the view for remeasures: a plugin holds it from mount to
  // teardown, so a swap landing at any point can nudge the layout.
  const capture = ViewPlugin.define((view) => {
    measureView = view;
    return {
      destroy() {
        if (measureView === view) measureView = null;
      },
    };
  });

  return [field, dom, capture];
}
