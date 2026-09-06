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
import { useCallback, useRef, useState, useEffect, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { assignRef } from './assignRef';
import { Preview, type PreviewProps } from './Preview';
import type { EditorSyncHandle } from './Editor';
import {
  centreAlignedOffset,
  collectAnchors,
  lineAtOffset,
  offsetForLine,
  withinCueWindow,
  type RowRect,
  type SyncAnchor,
} from '../lib/scrollSync';

/**
 * Issue #310: the host's handle into the sync controller. Populated only
 * while synchronized scrolling is live (split mode with `syncScroll` on);
 * null otherwise, so with sync off every call is a no-op and nothing moves.
 */
export interface SplitFollowHandle {
  /**
   * The editor caret moved (or its preview cues were just repainted): realign
   * the PREVIEW to the caret's visual row on the next frame, editor leading —
   * the editor pane itself never scrolls for this. Calls within one frame
   * coalesce into a single write.
   */
  followCaret(): void;
}

/**
 * Issue #310: the client rect of the character at plain-text `offset` inside
 * `root` (the character before it when the offset is the very end), read
 * through a Range — no node is inserted, so the host's text nodes stay whole
 * for whatever marks it paints over them. Null when nothing is there.
 */
function charRectAt(root: HTMLElement, offset: number): DOMRect | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let last: Text | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const len = text.data.length;
    if (offset < acc + len) {
      const range = document.createRange();
      range.setStart(text, offset - acc);
      range.setEnd(text, offset - acc + 1);
      return range.getClientRects()[0] ?? null;
    }
    acc += len;
    if (len > 0) last = text;
  }
  if (!last || offset !== acc) return null;
  const range = document.createRange();
  range.setStart(last, last.data.length - 1);
  range.setEnd(last, last.data.length);
  return range.getClientRects()[0] ?? null;
}

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
  /**
   * Issue #310: populated with the follow handle while sync is live (see
   * SplitFollowHandle). The host calls `followCaret()` after it repaints the
   * SPEC44 cues for an editor-made caret move, so the preview follows the
   * caret without the editor ever scrolling.
   */
  followRef?: MutableRefObject<SplitFollowHandle | null>;
  /** Everything for the preview pane — see PreviewProps. */
  preview: PreviewProps;
}

export function SplitView({ editor, split, editorSyncRef, syncScroll = true, splitRatio, onSplitRatioChange, followRef, preview }: SplitViewProps) {
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

  // Which pane led last. The editor is the leader whenever the panes are not
  // yet synchronized (split just mounted, or sync flipped back on — issue
  // #167's realign), so the effect below aligns on the caret the moment it
  // subscribes; a re-render realigns the same way unless the PREVIEW led last
  // (issue #310: the reader's scroll position is not yanked by a comment
  // edit's re-injection).
  const lastLeaderRef = useRef<'editor' | 'preview'>('editor');

  // --- SPEC15: synchronized split scrolling ------------------------------------
  // Whichever pane the user scrolls leads; the other follows within a frame.
  // Programmatic follower writes open a `quiet` window so they never re-lead
  // (no feedback loop). Ends clamp mutually reachable (§1.3).
  // Issue #310: caret moves lead too — the host reports them through
  // `followRef` — and the alignment reference is the caret's VISUAL row
  // against the preview cue's rendered row, centres compared.
  useEffect(() => {
    if (!split) {
      lastLeaderRef.current = 'editor';
      return;
    }
    // Issue #167: syncScroll off ⇒ the panes free-scroll — no subscriptions
    // at all — and the leader resets, so the flip back on realigns them
    // immediately instead of waiting for the next scroll event.
    if (!syncScroll) {
      lastLeaderRef.current = 'editor';
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
    // rather than an exact event count — leak-free either way. Issue #310:
    // the window swallows only the write's ECHO — an event landing at the
    // position just written — so a user scroll of the other pane inside the
    // window (right after a caret follow or the split-mount realign) still
    // leads (E58). A write whose landing position is not known in advance
    // (CM's scrollIntoView) keeps the pure time window.
    const quiet = { editor: 0, preview: 0 };
    const expected: { editor: number | null; preview: number | null } = { editor: null, preview: null };
    const QUIET_MS = 120;
    const AT_END = 2; // px slack for end clamping
    const isEcho = (pane: 'editor' | 'preview', scrollTop: number) =>
      performance.now() < quiet[pane] && (expected[pane] === null || Math.abs(scrollTop - expected[pane]) < 2);

    // SPEC45: while the SPEC44 cue is near the leader's viewport, the panes
    // align on IT — the selected word keeps the same vertical position on
    // both sides (clamped; far from the cue the line interpolation returns).
    // The cue classes are painted by the host's editor-state glue; this only
    // reads them. Issue #310: the preview reference is the cue's first
    // rendered row — the word mark; else the head's rendered row, found from
    // the `data-mm-head` text offset the host stamps on the tinted container
    // (a selection, or a whitespace/punctuation caret); else the tinted
    // block's top row, sized like the editor row so a long paragraph's
    // middle never becomes the target.
    const cueRow = (editorRow: RowRect): RowRect | null => {
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
      const word = docEl.querySelector<HTMLElement>('mark.mm-active-word');
      if (word) {
        const r = word.getClientRects()[0] ?? word.getBoundingClientRect();
        return { top: r.top - base, bottom: r.bottom - base };
      }
      const block = docEl.querySelector<HTMLElement>('.mm-active-block');
      if (!block) return null;
      const head = block.dataset.mmHead;
      const headRect = head === undefined ? null : charRectAt(block, Number(head));
      if (headRect) return { top: headRect.top - base, bottom: headRect.bottom - base };
      const top = block.getBoundingClientRect().top - base;
      return { top, bottom: top + (editorRow.bottom - editorRow.top) };
    };

    const editorLeads = () => {
      const ed = editorSyncRef.current;
      if (!ed) return;
      lastLeaderRef.current = 'editor';
      const { top, max } = ed.scrollInfo();
      const previewMax = scroller.scrollHeight - scroller.clientHeight;
      const row = ed.headRow();
      const cue = cueRow(row);
      const rowVpCentre = (row.top + row.bottom) / 2 - top; // caret row's viewport offset
      let target: number;
      if (top <= AT_END) target = 0;
      else if (top >= max - AT_END) target = previewMax;
      else if (cue && withinCueWindow(rowVpCentre, scroller.clientHeight)) {
        target = centreAlignedOffset(row, top, cue, previewMax);
      } else target = Math.min(offsetForLine(anchors, contentHeight, ed.topLine()), previewMax);
      if (Math.abs(scroller.scrollTop - target) < 1) return; // no-op → nothing to quiet
      quiet.preview = performance.now() + QUIET_MS;
      expected.preview = target;
      scroller.scrollTop = target;
    };

    const previewLeads = () => {
      const ed = editorSyncRef.current;
      if (!ed) return;
      lastLeaderRef.current = 'preview';
      const { max } = ed.scrollInfo();
      const previewMax = scroller.scrollHeight - scroller.clientHeight;
      const y = scroller.scrollTop;
      const row = ed.headRow();
      const cue = cueRow(row);
      const cueVpCentre = cue ? (cue.top + cue.bottom) / 2 - y : 0;
      let target: number | null; // null ⇒ CM's scrollIntoView lands it
      if (y <= AT_END) target = 0;
      else if (y >= previewMax - AT_END) target = max;
      else if (cue && withinCueWindow(cueVpCentre, scroller.clientHeight)) target = centreAlignedOffset(cue, y, row, max);
      else target = null;
      quiet.editor = performance.now() + QUIET_MS;
      expected.editor = target;
      if (target === null) ed.scrollToLine(lineAtOffset(anchors, contentHeight, y));
      else ed.setScrollTop(target);
    };

    // The leader is recorded at the scroll EVENT (synchronously, before any
    // frame callback runs), so a settle-time realign already queued for the
    // next frame can see that the user just led from the other pane.
    const onEditorScroll = () => {
      const ed = editorSyncRef.current;
      if (!ed || isEcho('editor', ed.scrollInfo().top)) return;
      lastLeaderRef.current = 'editor';
      requestAnimationFrame(editorLeads);
    };
    const onPreviewScroll = () => {
      if (isEcho('preview', scroller.scrollTop)) return;
      lastLeaderRef.current = 'preview';
      requestAnimationFrame(previewLeads);
    };

    // Issue #310: caret-driven and settle-driven alignment — rAF-coalesced,
    // one preview write per burst; the editor is never moved. The write goes
    // through editorLeads, so its quiet window keeps the preview's own scroll
    // event from re-leading. A caret follow always runs; a settle realign
    // (split mount, sync back on, a re-render) yields when the preview led
    // in the meantime — the reader's position wins over a housekeeping pass.
    let alignRaf = 0;
    let settleOnly = false;
    const scheduleAlign = (settle: boolean) => {
      settleOnly = alignRaf ? settleOnly && settle : settle;
      if (alignRaf) return;
      alignRaf = requestAnimationFrame(() => {
        alignRaf = 0;
        if (settleOnly && lastLeaderRef.current === 'preview') return;
        editorLeads();
      });
    };
    if (followRef) followRef.current = { followCaret: () => scheduleAlign(false) };

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
        // Issue #167 / #310: split just mounted, the toggle flipped back on,
        // or a re-render replaced the preview's DOM and cues — the editor
        // leads, so both panes open level on the caret (cue-anchored when its
        // block is in view). A preview that led last keeps its position.
        scheduleAlign(true);
      } else if (retries-- > 0) requestAnimationFrame(subscribe);
    };
    subscribe();
    scroller.addEventListener('scroll', onPreviewScroll);
    return () => {
      disposed = true;
      ro.disconnect();
      offEditor?.();
      cancelAnimationFrame(alignRaf);
      if (followRef) followRef.current = null;
      scroller.removeEventListener('scroll', onPreviewScroll);
    };
  }, [split, syncScroll, renderTick, editorSyncRef, followRef]);

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
