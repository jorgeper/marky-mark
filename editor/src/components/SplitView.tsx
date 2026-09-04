/**
 * PRD 021 Req 3 (issue #237): SplitView — the Editor and the Preview side by
 * side with the divider and synchronized scrolling Marky Mark's split edit
 * mode always had (SPEC15; PRD 001's visual seam preserved — the `.split-*`
 * class names are the styling contract, with the CSS itself still host-side
 * until PRD 021 Req 7 moves it in).
 *
 * Issue #165: the editor subtree stays mounted whether or not the preview is
 * shown — `split` toggles only the divider + preview, so flipping split mode
 * never unmounts CodeMirror (scroll, caret and undo survive the toggle; the
 * host collapses `.split-editor` to display:contents outside split mode).
 */
import { useCallback, useRef, useState, useEffect, type ReactNode, type RefObject } from 'react';
import { assignRef } from './assignRef';
import { Preview, type PreviewProps } from './Preview';
import type { EditorSyncHandle } from './Editor';
import { collectAnchors, lineAtOffset, offsetForLine, type SyncAnchor } from '../lib/scrollSync';

/**
 * SPEC7 §5.4: the divider's travel clamps. Mirrors the host-settings clamp in
 * Marky Mark's settings resolver — a persisted ratio outside this band would
 * pin a pane too small to use.
 */
const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;

/** PRD 021 Req 4: the SplitView's full prop contract. */
export interface SplitViewProps {
  /**
   * The editing surface — normally an `<Editor …>` element (lazy/Suspense
   * wrapping welcome). Passed as a node so the host owns every editor prop
   * and its loading fallback; SplitView drives scroll through
   * `editorSyncRef` only.
   */
  editor: ReactNode;
  /**
   * True renders divider + preview beside the editor; false renders just the
   * `.split-editor` wrapper (issue #165: one branch for both layouts).
   */
  split: boolean;
  /**
   * The same ref the host passes to the Editor's `syncRef` — sync-scroll
   * subscribes to editor scrolls and writes scroll targets through this
   * handle (SPEC15 §3.2).
   */
  editorSyncRef: RefObject<EditorSyncHandle | null>;
  /**
   * SPEC15: synchronized split scrolling on/off. Off ⇒ the panes free-scroll
   * (no subscriptions at all); flipping back on realigns them immediately,
   * editor leading (issue #167).
   */
  syncScroll?: boolean;
  /**
   * The host's persisted split ratio (0..1) — seeds a divider drag so a
   * click-without-move releases the unchanged value.
   */
  splitRatio?: number;
  /**
   * SPEC7 §5.4: a divider drag released at `ratio`, or a double-click reset
   * to 0.5. The live resize wrote the `--mm-split` CSS variable directly on
   * the parent (no re-render per mousemove); the host persists the final
   * ratio and keeps rendering `--mm-split` from it.
   */
  onSplitRatioChange?(ratio: number): void;
  /** Everything for the preview pane — see PreviewProps. */
  preview: PreviewProps;
}

export function SplitView({ editor, split, editorSyncRef, syncScroll = true, splitRatio, onSplitRatioChange, preview }: SplitViewProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);
  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el;
      assignRef(preview.scrollerRef, el);
    },
    [preview.scrollerRef]
  );
  const setDoc = useCallback(
    (el: HTMLDivElement | null) => {
      docRef.current = el;
      assignRef(preview.docRef, el);
    },
    [preview.docRef]
  );

  // The sync effect re-subscribes after every injection pass (fresh DOM,
  // fresh anchors) — the tick is its "html changed" dependency.
  const [renderTick, setRenderTick] = useState(0);
  const hostOnRendered = preview.onRendered;
  const onRendered = useCallback(
    (root: HTMLElement) => {
      hostOnRendered?.(root);
      setRenderTick((t) => t + 1);
    },
    [hostOnRendered]
  );

  // SPEC23 §1: a focused CodeMirror re-asserts its own DOM selection, which
  // would kill a preview drag-selection mid-gesture. Selecting in the preview
  // starts with a pointerdown — release the editor's focus first so the
  // native selection can live in that pane.
  const hostOnPointerDownCapture = preview.onPointerDownCapture;
  const onPreviewPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae?.closest('.editor-wrap')) ae.blur();
      hostOnPointerDownCapture?.(e);
    },
    [hostOnPointerDownCapture]
  );

  /**
   * Split divider drag (SPEC7 §5.4): pointer-captured; the live resize writes
   * the `--mm-split` CSS variable directly on the parent layout element (no
   * React re-render per mousemove) and the final ratio goes to the host on
   * release.
   */
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;
  const dragDivider = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const divider = e.currentTarget;
      const ws = divider.parentElement; // the host's split layout container
      if (!ws) return;
      e.preventDefault();
      divider.setPointerCapture(e.pointerId);
      const rect = ws.getBoundingClientRect();
      let ratio = splitRatioRef.current ?? 0.5;
      const onMove = (ev: PointerEvent) => {
        ratio = Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, (ev.clientX - rect.left) / rect.width));
        ws.style.setProperty('--mm-split', `${ratio * 100}%`);
      };
      const onUp = () => {
        divider.removeEventListener('pointermove', onMove);
        divider.removeEventListener('pointerup', onUp);
        onSplitRatioChange?.(ratio);
      };
      divider.addEventListener('pointermove', onMove);
      divider.addEventListener('pointerup', onUp);
    },
    [onSplitRatioChange]
  );

  // Issue #167: true while the split panes were last seen free-scrolling —
  // the SPEC15 effect below realigns them the moment syncScroll flips on.
  const syncScrollWasOffRef = useRef(false);

  // --- SPEC15: synchronized split scrolling ------------------------------------
  // Whichever pane the user scrolls leads; the other follows within a frame.
  // Programmatic follower writes open a `quiet` window so they never re-lead
  // (no feedback loop). Ends clamp mutually reachable (§1.3).
  useEffect(() => {
    if (!split) return;
    // Issue #167: syncScroll off ⇒ the panes free-scroll — no subscriptions
    // at all — and the ref remembers, so the flip back on realigns them
    // immediately instead of waiting for the next scroll event.
    if (!syncScroll) {
      syncScrollWasOffRef.current = true;
      return;
    }
    const docEl = docRef.current;
    const scroller = scrollerRef.current;
    if (!docEl || !scroller) return;

    let anchors: SyncAnchor[] = [];
    let contentHeight = 1;
    const rebuild = () => {
      anchors = collectAnchors(scroller, docEl);
      contentHeight = Math.max(scroller.scrollHeight, 1);
    };
    rebuild();
    const ro = new ResizeObserver(rebuild); // divider drags, resizes, late images
    ro.observe(docEl);

    // A follower may emit several scroll events per logical write (CM's
    // scrollIntoView measure loop), so suppression is a short quiet window
    // rather than an exact event count — leak-free either way.
    const quiet = { editor: 0, preview: 0 };
    const QUIET_MS = 120;
    const AT_END = 2; // px slack for end clamping

    // SPEC45: while the SPEC44 cue is near the leader's viewport, the panes
    // align on IT — the selected word keeps the same vertical position on
    // both sides (clamped; far from the cue the line interpolation returns).
    // The cue classes are painted by the host's editor-state glue; this only
    // reads them.
    const cueEl = () =>
      docEl.querySelector<HTMLElement>('mark.mm-active-word') ?? docEl.querySelector<HTMLElement>('.mm-active-block');
    const cueContentTop = (el: HTMLElement) =>
      el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

    const editorLeads = () => {
      const ed = editorSyncRef.current;
      if (!ed) return;
      const { top, max } = ed.scrollInfo();
      const previewMax = scroller.scrollHeight - scroller.clientHeight;
      let target: number;
      const mark = cueEl();
      const vpY = mark ? ed.headTop() - top : 0; // caret's viewport offset
      if (top <= AT_END) target = 0;
      else if (top >= max - AT_END) target = previewMax;
      else if (mark && vpY > -scroller.clientHeight && vpY < scroller.clientHeight * 2) {
        target = Math.max(0, Math.min(cueContentTop(mark) - vpY, previewMax));
      } else target = Math.min(offsetForLine(anchors, contentHeight, ed.topLine()), previewMax);
      if (Math.abs(scroller.scrollTop - target) < 1) return; // no-op → nothing to quiet
      quiet.preview = performance.now() + QUIET_MS;
      scroller.scrollTop = target;
    };

    const previewLeads = () => {
      const ed = editorSyncRef.current;
      if (!ed) return;
      const { max } = ed.scrollInfo();
      const previewMax = scroller.scrollHeight - scroller.clientHeight;
      const y = scroller.scrollTop;
      quiet.editor = performance.now() + QUIET_MS;
      const mark = cueEl();
      const markVpY = mark ? cueContentTop(mark) - y : 0;
      if (y <= AT_END) ed.setScrollTop(0);
      else if (y >= previewMax - AT_END) ed.setScrollTop(max);
      else if (mark && markVpY > -scroller.clientHeight && markVpY < scroller.clientHeight * 2) {
        ed.setScrollTop(Math.max(0, Math.min(ed.headTop() - markVpY, max)));
      } else ed.scrollToLine(lineAtOffset(anchors, contentHeight, y));
    };

    const onEditorScroll = () => {
      if (performance.now() < quiet.editor) return;
      requestAnimationFrame(editorLeads);
    };
    const onPreviewScroll = () => {
      if (performance.now() < quiet.preview) return;
      requestAnimationFrame(previewLeads);
    };

    // The editor loads lazily — retry the subscription until its handle
    // appears (bounded; the injection-keyed rerun also gets a fresh shot).
    let offEditor: (() => void) | null = null;
    let disposed = false;
    let retries = 120; // ~2s of frames
    const subscribe = () => {
      if (disposed) return;
      const ed = editorSyncRef.current;
      if (ed) {
        offEditor = ed.onScroll(onEditorScroll);
        // Issue #167: the toggle just flipped back on — the editor leads,
        // so both panes show the same content again this instant.
        if (syncScrollWasOffRef.current) {
          syncScrollWasOffRef.current = false;
          editorLeads();
        }
      } else if (retries-- > 0) requestAnimationFrame(subscribe);
    };
    subscribe();
    scroller.addEventListener('scroll', onPreviewScroll);
    return () => {
      disposed = true;
      ro.disconnect();
      offEditor?.();
      scroller.removeEventListener('scroll', onPreviewScroll);
    };
  }, [split, syncScroll, renderTick, editorSyncRef]);

  return (
    <>
      <div className="split-editor">{editor}</div>
      {split && (
        <>
          <div
            className="split-divider"
            data-testid="split-divider"
            onPointerDown={dragDivider}
            onDoubleClick={() => onSplitRatioChange?.(0.5)}
          />
          <Preview
            {...preview}
            scrollerRef={setScroller}
            docRef={setDoc}
            onRendered={onRendered}
            onPointerDownCapture={onPreviewPointerDownCapture}
          />
        </>
      )}
    </>
  );
}
