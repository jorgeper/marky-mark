/**
 * PRD 021 Req 3 (issue #237): the package's Preview component — the rendered-
 * markdown reading surface, authored from the `.split-preview` subtree that
 * used to live inline in the app's App.tsx. Markdown renders through the
 * package's unified pipeline (lib/markdown.ts) into an imperative `.doc`
 * container: innerHTML injection keeps the DOM exactly what the pipeline
 * produced (with its `data-mm-line` scroll anchors), so plain-text offsets
 * stay a stable coordinate space for host overlays layered via `onRendered`.
 *
 * The unified/remark pipeline is imported here and nowhere on the editing
 * surface (PRD 021 Req 6).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
} from 'react';
import { assignRef } from './assignRef';
import { renderMarkdown } from '../lib/markdown';
import { decorateCodeBlocks } from '../lib/codeCopy';
import { renderFenceDiagrams } from '../lib/fenceDiagrams';
import { fenceRendererFor } from '../lib/fenceRenderers';

/** PRD 021 Req 4: the Preview's full prop contract. */
export interface PreviewProps {
  /**
   * The markdown source to render — the CANONICAL text (SPEC38 §3.5: a real
   * table, never a display grid; hosts route through `canonicalText`).
   */
  markdown: string;
  /**
   * SPEC7 §5: re-renders while the source changes coalesce under this
   * debounce (default 200ms, well under the 300ms budget). The first render
   * after mount is immediate, so opening the pane never shows a blank beat.
   */
  renderDebounceMs?: number;
  /** Issue #122: colour fenced code; false adds `mm-code-plain` to the doc container. */
  codeSyntax?: boolean;
  /** PRD 013 Req 9: the host's active theme side — diagram renderers draw to match. */
  themeVariant?: 'light' | 'dark';
  /**
   * SPEC41 §2.1-style asset seam: resolve a source img `src` to a displayable
   * URL, or null when it cannot be shown here (the img loses its src and
   * stays inert). Absent ⇒ img srcs are left untouched. Every visited img
   * keeps the source's own spelling in `data-mm-original-src` (SPEC20 §4.2:
   * rewrites must write back what the document said, not the resolved URL).
   */
  resolveImageSrc?(src: string): string | null;
  /**
   * Clipboard seam for the per-block code copy buttons (issue #122;
   * lib/codeCopy.ts — the buttons are grafted after injection so they never
   * enter the pipeline's HTML nor the plain-text offset space). Absent ⇒ the
   * buttons render but every copy reports failure.
   */
  onCopyCode?(text: string): Promise<boolean> | boolean;
  /**
   * PRD 021 Req 8: the post-render DOM-decoration seam. Called synchronously
   * (layout effect, before paint) with the rendered `.doc` root after every
   * injection + decoration pass. Hosts wrap text ranges, graft buttons, or
   * paint overlays here — Marky Mark layers its comment `<mark class="hl">`
   * highlighting through exactly this hook. A change of callback identity
   * re-injects the HTML first, so host decorations keyed on host state (e.g.
   * the comment list) always start from a clean pipeline-produced tree.
   */
  onRendered?(root: HTMLElement): void;
  /** The scroll container (the `.split-preview` element), for host scroll logic. */
  scrollerRef?: Ref<HTMLDivElement>;
  /** The rendered-document container (the `.doc` element), for host DOM queries. */
  docRef?: Ref<HTMLDivElement>;
  /** Click routing on the rendered doc (e.g. activating a comment mark). */
  onDocClick?: MouseEventHandler<HTMLDivElement>;
  /** Capture-phase pointerdown on the scroller (SplitView blurs the editor here — SPEC23 §1). */
  onPointerDownCapture?: PointerEventHandler<HTMLDivElement>;
  /** Rendered inside `.docwrap`, before the doc (Marky Mark: the front-matter card). */
  header?: ReactNode;
  /** Rendered inside the scroller, after `.docwrap` (Marky Mark: the comments panel). */
  aside?: ReactNode;
  /**
   * Identity of the document `markdown` belongs to. When it changes the pane
   * resets INSTANTLY — stale HTML is dropped in the same commit and the next
   * render skips the debounce — so a host swapping documents (with its own
   * per-document state, e.g. comment overlays) never sees the old document's
   * DOM decorated under the new document's state (issue #43's rule).
   */
  docKey?: string | number | null;
  /**
   * Warm start (issue #165): HTML this same document already rendered to
   * elsewhere in the host, painted synchronously on mount so an opening
   * slide animates over content from its very first frame. The component
   * re-renders from `markdown` immediately after, so a stale warm start is
   * visible for at most one render round-trip — the contract split mode
   * always had.
   */
  initialHtml?: string;
  /** Test id on the scroll container. Defaults to `split-preview`. */
  testId?: string;
}

export function Preview({
  markdown,
  renderDebounceMs = 200,
  codeSyntax = true,
  themeVariant = 'light',
  resolveImageSrc,
  onCopyCode,
  onRendered,
  scrollerRef,
  docRef,
  onDocClick,
  onPointerDownCapture,
  header,
  aside,
  docKey = null,
  initialHtml,
  testId = 'split-preview',
}: PreviewProps) {
  const [html, setHtml] = useState(initialHtml ?? '');
  // A doc swap drops stale content in this same render pass (setState during
  // render re-renders before commit) and marks the next render immediate.
  const keyRef = useRef(docKey);
  const immediateRef = useRef(true); // the mount render is immediate too
  if (keyRef.current !== docKey) {
    keyRef.current = docKey;
    immediateRef.current = true;
    if (html !== '') setHtml('');
  }
  const docElRef = useRef<HTMLDivElement | null>(null);
  const setDocEl = useCallback(
    (el: HTMLDivElement | null) => {
      docElRef.current = el;
      assignRef(docRef, el);
    },
    [docRef]
  );
  const setScrollerEl = useCallback((el: HTMLDivElement | null) => assignRef(scrollerRef, el), [scrollerRef]);

  // Theme is read at injection time, not a dependency: a theme flip repaints
  // on the next injection, exactly as the app's inline pane behaved.
  const themeRef = useRef(themeVariant);
  themeRef.current = themeVariant;

  // --- markdown rendering (SPEC7 §5: debounced live; immediate on mount/swap) ----
  const epochRef = useRef(0);
  useEffect(() => {
    // A bumped epoch drops any still-in-flight render for older source, so a
    // doc swap can never paint the previous document late (issue #43's rule).
    const epoch = ++epochRef.current;
    const render = () =>
      void renderMarkdown(markdown).then((rendered) => {
        if (epoch !== epochRef.current) return;
        setHtml(rendered);
      });
    if (immediateRef.current) {
      immediateRef.current = false;
      render();
      return;
    }
    const t = setTimeout(render, renderDebounceMs);
    return () => clearTimeout(t);
  }, [markdown, renderDebounceMs, docKey]);

  // --- inject rendered doc, decorate, hand to the host ----------------------
  // The same pass the app ran inline (SPEC7 §5, issue #19): inject, resolve
  // image srcs through the seam, title external links, graft copy buttons,
  // draw fence diagrams, then let the host decorate.
  useLayoutEffect(() => {
    const doc = docElRef.current;
    if (!doc) return;
    doc.innerHTML = html;
    if (resolveImageSrc) {
      doc.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src');
        if (!src) return;
        img.dataset.mmOriginalSrc = src; // SPEC20 §4.2: resize writes this back
        const resolved = resolveImageSrc(src);
        if (resolved) img.src = resolved;
        else img.removeAttribute('src');
      });
    }
    // External links: show the destination on hover — the hand-off to the
    // host's browser should never be a surprise (SPEC11 §4).
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) a.setAttribute('title', href);
    });
    decorateCodeBlocks(doc, onCopyCode ?? (() => false)); // Issue #122
    // PRD 013 Req 2: registered fence languages draw as diagrams — a
    // post-injection graft whose SVG never enters the pipeline's HTML or the
    // plain-text offset space. This pass re-runs per injection, rebuilding
    // the DOM under any render still in flight, so the stale-result guard in
    // lib/fenceDiagrams.ts keeps a late diagram out of the tree that
    // replaced it.
    void renderFenceDiagrams(doc, { rendererFor: fenceRendererFor, theme: themeRef.current });
    onRendered?.(doc); // PRD 021 Req 8: the host's decoration pass
  }, [html, resolveImageSrc, onCopyCode, onRendered]);

  return (
    <div className="split-preview" data-testid={testId} ref={setScrollerEl} onPointerDownCapture={onPointerDownCapture}>
      <div className="docwrap">
        {header}
        <div className={codeSyntax ? 'doc' : 'doc mm-code-plain'} ref={setDocEl} onClick={onDocClick} />
      </div>
      {aside}
    </div>
  );
}
