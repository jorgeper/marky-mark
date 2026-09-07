/**
 * PRD 025 (issues #334–#337): the Fluid mode view extension — the overlay
 * layer, the in-flight registry every effect adds to, the Cursor movement
 * effect (Req 10), the Selection change effect (Req 11), the Deletion effect
 * (Req 12) and the Insertion effect (Req 13). Loaded only while the `fluid`
 * prop carries a mapping (its Compartment is empty otherwise, Req 3), so
 * with the mode off there is no listener, no timer and no overlay element.
 *
 * Req 9 (never-delay): nothing here intercepts a key, wraps `dispatch`, or
 * defers a change. A ghost is drawn from an update listener AFTER the
 * transaction is applied — `update.state` is already the final state — and
 * the only synchronous work added is the decision, a few `coordsAtPos`
 * reads (plus one content-rect read for a selection or a document change,
 * and one overlay-rect read for a Burst), the ghost elements appended to
 * the overlay or re-targeted, and the animation started.
 */

import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { Transaction, type Extension } from '@codemirror/state';
import { FLUID_DURATIONS_MS, type FluidEffectMap } from '../lib/fluid';
import { fluidCurveSamples, fluidCursorCurve, isFluidNavigationMove } from '../lib/fluidCursor';
import {
  FLUID_BURST_PARTICLES,
  fluidBurstParticles,
  fluidDeletionBox,
  fluidDeletionSpans,
  type FluidChangedSpan,
  type FluidDeletionBox,
  type FluidDeletionEffect,
} from '../lib/fluidDeletion';
import { fluidInsertionSpans, type FluidInsertedSpan, type FluidInsertionEffect } from '../lib/fluidInsertion';
import {
  fluidRectAt,
  fluidSelectionCurve,
  fluidSelectionDecision,
  fluidSelectionRects,
  fluidSelectionShape,
  type FluidPosCoords,
  type FluidRect,
  type FluidSelectionEffect,
  type FluidSelectionShape,
} from '../lib/fluidSelection';

/** Req 17: the class the editor root wears while a caret ghost is in flight. */
const CARET_IN_FLIGHT_CLASS = 'fluid-caret-in-flight';

/** PRD 025 Req 17 (issue #335): the class the editor root wears while a selection ghost is in flight. */
const SELECTION_IN_FLIGHT_CLASS = 'fluid-selection-in-flight';

/** Req 20: spacing of the sampled keyframes — close enough that linear interpolation between them reads as the curve. */
const KEYFRAME_STEP_MS = 8;

/** Req 16: read at scheduling time, never cached — an OS change takes effect on the next move. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Which effect an in-flight entry belongs to — the caret and selection effects replace their own kind; a deletion ghost or an insertion mask is left to finish. */
type FluidGhostKind = 'caret' | 'selection' | 'deletion' | 'insertion';

/** One effect in flight: its kind, its overlay elements, the root class it wears (none for a deletion ghost or an insertion mask), and how to stop it early. */
interface InFlight {
  kind: FluidGhostKind;
  els: HTMLElement[];
  cls: string | null;
  stop: () => void;
}

/**
 * PRD 025 Req 11 (issue #335): the selection ghost's tween state — a
 * requestAnimationFrame loop samples the curve at the elapsed fraction and
 * writes each slot's rectangle. Re-targeting replaces `start` with the
 * current sampled geometry and `target` with the new range, restarting the
 * clock, which is what lets a drag's target follow the pointer.
 */
interface SelectionGhost extends InFlight {
  start: FluidSelectionShape;
  target: FluidSelectionShape;
  current: FluidSelectionShape;
  startedAt: number;
  raf: number;
}

/** Req 12: the deletion mapping as an effect, or null for None. */
function deletionEffectOf(map: FluidEffectMap): FluidDeletionEffect | null {
  const e = map.deletion;
  return e === 'fade' || e === 'pop' || e === 'burst' ? e : null;
}

/** Req 13: the insertion mapping as an effect, or null for None. */
function insertionEffectOf(map: FluidEffectMap): FluidInsertionEffect | null {
  const e = map.insertion;
  return e === 'fade' || e === 'pop' ? e : null;
}

/** The first `Transaction.userEvent` annotation across the update's transactions, or null when none carries one. */
function userEventOf(u: ViewUpdate): string | null {
  for (const tr of u.transactions) {
    const event = tr.annotation(Transaction.userEvent);
    if (event != null) return event;
  }
  return null;
}

/** Req 11: write one shape's rectangles into the ghost's slot elements, in overlay-layer pixels. */
function paintSelectionShape(els: HTMLElement[], shape: FluidSelectionShape): void {
  shape.forEach((r, i) => {
    const st = els[i].style;
    st.left = `${r.left}px`;
    st.top = `${r.top}px`;
    st.width = `${r.width}px`;
    st.height = `${r.height}px`;
  });
}

/**
 * Req 15 / Req 17: the overlay layer and the registry of effects in flight.
 * The layer is appended to `view.scrollDOM` (never `.cm-content`) and is
 * `pointer-events: none`, `aria-hidden` by its stylesheet rule and attribute.
 * Every cancel path — scroll, resize, document change, the plugin being
 * destroyed (mode off, mapping or theme side changed, view destroyed) —
 * runs through `cancelAll`, so the layer has zero children whenever nothing
 * is in flight.
 */
class FluidOverlay {
  readonly layer: HTMLElement;
  private inFlight = new Set<InFlight>();
  /** Req 11: at most one selection ghost at a time; null when none is in flight. */
  private selection: SelectionGhost | null = null;
  private readonly onScroll = () => this.cancelAll();

  constructor(
    private readonly view: EditorView,
    private readonly map: FluidEffectMap
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'fluid-overlay';
    this.layer.setAttribute('data-testid', 'fluid-overlay');
    this.layer.setAttribute('aria-hidden', 'true');
    view.scrollDOM.appendChild(this.layer);
    // Req 15: a scroll mid-flight cancels immediately (passive: never delays the scroll).
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
  }

  /** Runs mid-update (no layout reads here): the cancel rules only. */
  update(u: ViewUpdate): void {
    // Req 15: a document change or a resize cancels every in-flight overlay.
    if (u.docChanged || u.geometryChanged) this.cancelAll();
  }

  destroy(): void {
    this.cancelAll();
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.layer.remove();
  }

  cancelAll(): void {
    for (const f of [...this.inFlight]) {
      f.stop();
      this.discard(f);
    }
    this.view.dom.classList.remove(CARET_IN_FLIGHT_CLASS, SELECTION_IN_FLIGHT_CLASS);
  }

  /**
   * PRD 025 Reqs 15, 17 (issue #336): the caret and selection effects'
   * "replace the one in flight" cancel, narrowed to their own kinds — a
   * deletion ghost or an insertion mask (#337) is left to finish under a
   * navigation move or Shift+arrow; only the Req 15 triggers (`cancelAll`)
   * remove it early.
   */
  private cancelKinds(...kinds: FluidGhostKind[]): void {
    for (const f of [...this.inFlight]) {
      if (!kinds.includes(f.kind)) continue;
      f.stop();
      this.discard(f);
    }
  }

  /** An animation ran to its end: the entry leaves the registry (a no-op when a cancel already dropped it). */
  private finish(f: InFlight): void {
    if (!this.inFlight.has(f)) return;
    this.discard(f);
  }

  /**
   * The one teardown every cancel and finish path runs: the entry leaves the
   * registry and its elements leave the overlay (Req 15: gone the moment it
   * ends), and the root class it wore is dropped unless another entry still
   * wears it (Req 17: the real caret / selection is hidden only while its
   * ghost flies).
   */
  private discard(f: InFlight): void {
    this.inFlight.delete(f);
    if (f === this.selection) this.selection = null;
    for (const el of f.els) el.remove();
    if (!f.cls) return;
    const stillWorn = [...this.inFlight].some((other) => other.cls === f.cls);
    if (!stillWorn) this.view.dom.classList.remove(f.cls);
  }

  /**
   * Req 10: runs from the update listener, after the transaction — the state
   * is final and layout may be read. Draws the caret ghost for a navigation
   * move under a Glide or Elastic mapping; returns without touching the DOM
   * for anything else.
   */
  cursorMoved(u: ViewUpdate): void {
    const effect = this.map.cursor;
    if (effect !== 'glide' && effect !== 'elastic') return;
    const main = u.state.selection.main;
    const fromHead = u.changes.mapPos(u.startState.selection.main.head);
    if (
      !isFluidNavigationMove({
        docChanged: u.docChanged,
        selectionSet: u.selectionSet,
        userEvent: userEventOf(u),
        fromHead,
        toHead: main.head,
        toEmpty: main.empty,
      })
    ) {
      return;
    }
    if (prefersReducedMotion()) return; // Req 16: inert — no element, no frame
    const view = this.view;
    const from = view.coordsAtPos(fromHead);
    const to = view.coordsAtPos(main.head);
    if (!from || !to) return; // not rendered / off-screen: nothing to tween between
    const el = document.createElement('div');
    if (typeof el.animate !== 'function') return; // no Web Animations: no static ghost either
    // Req 17: at most one caret ghost — a new move replaces the one in flight
    // (and a caret result has already cancelled any selection ghost); a
    // deletion ghost fading under an undo's caret landing is left alone.
    this.cancelKinds('caret', 'selection');
    // The overlay sits at inset 0 of the scroller and scrolls with the
    // content, so client coordinates translate by the layer's own rect
    // (layout is already clean after coordsAtPos; this forces nothing).
    const frame = this.layer.getBoundingClientRect();
    el.className = 'fluid-caret-ghost';
    el.setAttribute('data-testid', 'fluid-caret-ghost');
    el.style.left = `${from.left - frame.left}px`;
    el.style.top = `${from.top - frame.top}px`;
    el.style.height = `${to.bottom - to.top}px`; // sized to the destination line
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const { at, durationMs } = fluidCursorCurve(effect);
    // Req 20: keyframes sampled from the in-package curve, played linearly
    // by the Web Animations API — no library involved.
    const keyframes = fluidCurveSamples(at, Math.ceil(durationMs / KEYFRAME_STEP_MS)).map((f) => ({
      transform: `translate(${dx * f}px, ${dy * f}px)`,
    }));
    this.layer.appendChild(el);
    const anim = el.animate(keyframes, { duration: durationMs, easing: 'linear', fill: 'forwards' });
    const entry: InFlight = { kind: 'caret', els: [el], cls: CARET_IN_FLIGHT_CLASS, stop: () => anim.cancel() };
    this.inFlight.add(entry);
    view.dom.classList.add(CARET_IN_FLIGHT_CLASS); // Req 17: the real caret hides only while the ghost flies
    anim.onfinish = () => this.finish(entry);
  }

  /**
   * PRD 025 Req 11 (issue #335): runs from the update listener for a
   * transaction whose main selection is a caret. A caret result cancels a
   * selection ghost immediately (click, arrow, Escape); the cursor effect
   * then proceeds as Req 10 defines.
   */
  caretResult(u: ViewUpdate): void {
    if (this.selection) this.cancelKinds('selection');
    this.cursorMoved(u);
  }

  /**
   * PRD 025 Reqs 11, 14 (issue #335): runs from the update listener for a
   * transaction whose main selection is a range — after the transaction, so
   * the state is final and layout may be read. A range result cancels any
   * caret ghost in flight; then, under a Glide or Elastic mapping, the
   * decision either tweens the ghost toward the new range (re-targeting one
   * already in flight), snaps (cancelling any ghost), or leaves the overlay
   * alone. With Selection change → None nothing beyond this branch runs.
   */
  selectionChanged(u: ViewUpdate): void {
    // Req 17: a range result cancels a caret ghost in flight (the only other
    // effect a selection ghost never coexists with); a selection ghost stays
    // to be re-targeted below, and a deletion ghost is left to finish.
    this.cancelKinds('caret');
    const effect = this.map.selection;
    if (effect !== 'glide' && effect !== 'elastic') return;
    const to = u.state.selection.main;
    const prev = u.startState.selection.main;
    const from = { anchor: u.changes.mapPos(prev.anchor), head: u.changes.mapPos(prev.head) };
    const doc = u.state.doc;
    const linesOf = (a: number, b: number): number =>
      doc.lineAt(Math.max(a, b)).number - doc.lineAt(Math.min(a, b)).number + 1;
    const decision = fluidSelectionDecision({
      docChanged: u.docChanged,
      selectionSet: u.selectionSet,
      userEvent: userEventOf(u),
      from,
      to: { anchor: to.anchor, head: to.head },
      fromLines: linesOf(from.anchor, from.head),
      toLines: linesOf(to.anchor, to.head),
    });
    if (decision === 'none') return;
    if (decision === 'snap' || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      // Req 14: a large operation snaps; Req 16: reduced motion is inert — no
      // element, no frame. Either way any selection ghost in flight goes at once.
      this.cancelKinds('selection');
      return;
    }
    const view = this.view;
    // Req 11: the ghost is measured, never mutation-observed — both ends of
    // the new range, both ends of the previous one (unless a ghost in flight
    // already supplies the start shape), and one content-rect read.
    const frame = this.layer.getBoundingClientRect();
    const at = (pos: number): FluidPosCoords | null => {
      const c = view.coordsAtPos(pos);
      return c ? { left: c.left - frame.left, top: c.top - frame.top, bottom: c.bottom - frame.top } : null;
    };
    const content = view.contentDOM.getBoundingClientRect();
    const contentLeft = content.left - frame.left;
    const contentRight = content.right - frame.left;
    const toStart = at(to.from);
    const toEnd = at(to.to);
    if (!toStart || !toEnd) {
      this.cancelKinds('selection'); // not rendered / off-screen: snap
      return;
    }
    const target = fluidSelectionShape(fluidSelectionRects({ start: toStart, end: toEnd, contentLeft, contentRight }));
    const ghost = this.selection;
    if (ghost) {
      // Req 11: re-target — the ghost's current geometry (the curve sampled
      // at the elapsed fraction) becomes the new start; the clock restarts.
      ghost.start = ghost.current;
      ghost.target = target;
      ghost.startedAt = performance.now();
      return;
    }
    const fromStart = at(Math.min(from.anchor, from.head));
    const fromEnd = at(Math.max(from.anchor, from.head));
    if (!fromStart || !fromEnd) {
      this.cancelKinds('selection');
      return;
    }
    const start = fluidSelectionShape(
      fluidSelectionRects({ start: fromStart, end: fromEnd, contentLeft, contentRight })
    );
    this.startSelectionGhost(start, target, effect);
  }

  /**
   * Req 11: create the selection ghost — one slot element per rectangle of
   * the shape, painted at `start` — register it, and run the frame loop
   * that tweens it toward `target` (whatever `target` holds by the time a
   * frame samples it, which is how re-targeting takes effect). The caller
   * has already cancelled any caret ghost, so at most a deletion ghost
   * shares the overlay here.
   */
  private startSelectionGhost(
    start: FluidSelectionShape,
    target: FluidSelectionShape,
    effect: FluidSelectionEffect
  ): void {
    const { at: curve, durationMs } = fluidSelectionCurve(effect);
    const els = start.map(() => {
      const el = document.createElement('div');
      el.className = 'fluid-selection-ghost';
      el.setAttribute('data-testid', 'fluid-selection-ghost');
      return el;
    });
    const entry: SelectionGhost = {
      kind: 'selection',
      els,
      cls: SELECTION_IN_FLIGHT_CLASS,
      stop: () => cancelAnimationFrame(entry.raf),
      start,
      target,
      current: start,
      startedAt: performance.now(),
      raf: 0,
    };
    const step = (t: number): void => {
      if (this.selection !== entry) return;
      const fraction = Math.min(1, Math.max(0, (t - entry.startedAt) / durationMs));
      const f = curve(fraction);
      entry.current = [
        fluidRectAt(entry.start[0], entry.target[0], f),
        fluidRectAt(entry.start[1], entry.target[1], f),
        fluidRectAt(entry.start[2], entry.target[2], f),
      ];
      paintSelectionShape(els, entry.current);
      if (fraction >= 1) this.finish(entry);
      else entry.raf = requestAnimationFrame(step);
    };
    paintSelectionShape(els, start);
    for (const el of els) this.layer.appendChild(el);
    this.inFlight.add(entry);
    this.selection = entry;
    this.view.dom.classList.add(SELECTION_IN_FLIGHT_CLASS); // Req 17: the real selection hides only while the ghost flies
    entry.raf = requestAnimationFrame(step);
  }

  /**
   * PRD 025 Reqs 9, 12, 13, 14, 16 (issues #336, #337): runs from the update
   * listener for a transaction that changed the document — after the
   * transaction, so `u.state.doc` already holds the inserted text and lacks
   * the removed text, and layout may be read. One `iterChanges` pass feeds
   * both pure decisions (each sees only its own descriptor) and one
   * content-rect read serves both effects. Under a Fade, Pop or Burst
   * deletion mapping the pure-removal spans (never a replacement, nothing
   * for a large operation) each get a ghost: a re-render of the removed text
   * at its last painted position, measured as `coordsAtPos(fromB)` — nothing
   * can be captured before the change without intercepting dispatch, which
   * Req 9 forbids. Then, under a Fade or Pop insertion mapping, every
   * inserting span (a replacement's new text included; nothing for an IME
   * composition step or a large operation) gets a page-coloured mask over
   * its painted rectangles. With both actions → None nothing beyond the
   * branch runs.
   */
  documentChanged(u: ViewUpdate): void {
    const deletion = deletionEffectOf(this.map);
    const insertion = insertionEffectOf(this.map);
    if (!deletion && !insertion) return;
    const wantDeletion = deletion !== null;
    const wantInsertion = insertion !== null;
    const startDoc = u.startState.doc;
    const doc = u.state.doc;
    const removed: FluidChangedSpan[] = [];
    const inserted: FluidInsertedSpan[] = [];
    u.changes.iterChanges((fromA, toA, fromB, toB) => {
      const removedLines = toA > fromA ? startDoc.lineAt(toA).number - startDoc.lineAt(fromA).number + 1 : 1;
      if (wantDeletion)
        removed.push({
          fromA,
          toA,
          fromB,
          insertedLength: toB - fromB,
          lines: removedLines,
        });
      if (wantInsertion) {
        inserted.push({
          fromB,
          toB,
          removedLength: toA - fromA,
          removedLines,
          insertedLines: toB > fromB ? doc.lineAt(toB).number - doc.lineAt(fromB).number + 1 : 1,
        });
      }
    });
    const userEvent = userEventOf(u);
    const ghosted = wantDeletion
      ? fluidDeletionSpans({
          docChanged: u.docChanged,
          userEvent,
          spans: removed,
        })
      : [];
    const masked = wantInsertion
      ? fluidInsertionSpans({
          docChanged: u.docChanged,
          userEvent,
          spans: inserted,
        })
      : [];
    if (ghosted.length === 0 && masked.length === 0) return;
    if (prefersReducedMotion()) return; // Req 16: inert — no element, no particle, no frame
    if (typeof document.createElement('div').animate !== 'function') return; // no Web Animations: no static ghost either
    const view = this.view;
    // The overlay sits at inset 0 of the scroller, so client coordinates
    // translate by the layer's own rect; one content-rect read gives the
    // edges a multi-line ghost wraps between and a multi-line mask spans.
    const frame = this.layer.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const contentLeft = content.left - frame.left;
    const contentRight = content.right - frame.left;
    const at = (pos: number): FluidPosCoords | null => {
      const c = view.coordsAtPos(pos);
      return c
        ? {
            left: c.left - frame.left,
            top: c.top - frame.top,
            bottom: c.bottom - frame.top,
          }
        : null;
    };
    if (deletion) {
      for (const span of ghosted) {
        const start = at(span.fromB);
        if (!start) continue; // not rendered / off-screen: this span draws nothing
        const box = fluidDeletionBox({ start, contentLeft, contentRight });
        this.startDeletionGhost(startDoc.sliceString(span.fromA, span.toA), box, deletion, frame);
      }
    }
    if (!insertion) return;
    for (const span of masked) {
      // Req 13: the inserted range's painted rectangles — two coordsAtPos
      // reads per span, the selection effect's three-slot geometry; a
      // rectangle with no area (a bare Enter's empty tail) needs no element.
      const start = at(span.fromB);
      const end = at(span.toB);
      if (!start || !end) continue; // not rendered / off-screen: this span draws nothing
      const rects = fluidSelectionRects({
        start,
        end,
        contentLeft,
        contentRight,
      }).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) continue;
      this.startInsertionEffect(
        doc.sliceString(span.fromB, span.toB),
        rects,
        fluidDeletionBox({ start, contentLeft, contentRight }),
        insertion
      );
    }
  }

  /**
   * PRD 025 Reqs 7, 13, 15, 17 (issue #337): one insertion effect — the
   * inserted text is already painted in the content and Req 15 forbids
   * restyling it, so it is COVERED: one page-coloured mask per painted
   * rectangle of the inserted range. Fade dissolves the masks (opacity
   * 1 → 0) so the real, Markdown-styled text appears to fade in and nothing
   * is re-rendered. Pop holds the masks at full opacity while a re-rendered
   * copy of the inserted text (set as text, never HTML; the deletion ghost's
   * content-wide box) scales in from 0.8 about the span's start on top of
   * them; the copy and its masks are removed together when the copy's
   * animation finishes, so the real text is never uncovered before the copy
   * settles at scale 1. No root class is worn: nothing real needs hiding,
   * and the mask's right edge is the range's end, where the real caret
   * stands, for no longer than the effect's own duration (Req 17).
   */
  private startInsertionEffect(
    text: string,
    rects: FluidRect[],
    box: FluidDeletionBox,
    effect: FluidInsertionEffect
  ): void {
    const els: HTMLElement[] = [];
    const anims: Animation[] = [];
    const masks = rects.map((r) => {
      const el = document.createElement('div');
      el.className = 'fluid-insertion-mask';
      el.setAttribute('data-testid', 'fluid-insertion-mask');
      const st = el.style;
      st.left = `${r.left}px`;
      st.top = `${r.top}px`;
      st.width = `${r.width}px`;
      st.height = `${r.height}px`;
      this.layer.appendChild(el);
      els.push(el);
      return el;
    });
    if (effect === 'fade') {
      // Req 7: Fade — every mask dissolves, revealing the real text beneath.
      for (const el of masks) {
        anims.push(
          el.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: FLUID_DURATIONS_MS.fade,
            easing: 'ease-out',
            fill: 'forwards',
          })
        );
      }
    } else {
      // Req 7: Pop — the masks hold; a re-rendered copy scales in from ~0.8
      // about the span's start, on its first line's centre, above them.
      const ghost = document.createElement('div');
      ghost.className = 'fluid-insertion-ghost';
      ghost.setAttribute('data-testid', 'fluid-insertion-ghost');
      ghost.textContent = text;
      const st = ghost.style;
      st.left = `${box.left}px`;
      st.top = `${box.top}px`;
      st.width = `${box.width}px`;
      st.textIndent = `${box.indent}px`;
      st.lineHeight = `${box.lineHeight}px`;
      st.transformOrigin = `${box.indent}px ${box.lineHeight / 2}px`;
      this.layer.appendChild(ghost);
      els.push(ghost);
      anims.push(
        ghost.animate(
          [
            { opacity: 0, transform: 'scale(0.8)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
          {
            duration: FLUID_DURATIONS_MS.pop,
            easing: 'ease-out',
            fill: 'forwards',
          }
        )
      );
    }
    const entry: InFlight = {
      kind: 'insertion',
      els,
      cls: null,
      stop: () => {
        for (const anim of anims) anim.cancel();
      },
    };
    this.inFlight.add(entry);
    // Req 15: the entry finishes with its longest animation, and `discard`
    // then removes every element together — mask and copy vanish as one.
    let pending = anims.length;
    for (const anim of anims) {
      anim.onfinish = () => {
        if (--pending === 0) this.finish(entry);
      };
    }
  }

  /**
   * PRD 025 Reqs 7, 8, 12, 15 (issue #336): one deletion ghost — the removed
   * text (set as text, never HTML) in a content-wide block indented to where
   * it started — and its animation: Fade dissolves it, Pop scales it out to
   * 0.8 about the removed span's start while dissolving, Burst dissolves it
   * as Fade does and scatters particles from its first painted line. Every
   * element is removed the moment its own animation finishes; the entry
   * finishes with the longest one (Burst: the particles). No root class is
   * worn: nothing real needs hiding.
   */
  private startDeletionGhost(text: string, box: FluidDeletionBox, effect: FluidDeletionEffect, frame: DOMRect): void {
    const el = document.createElement('div');
    el.className = 'fluid-deletion-ghost';
    el.setAttribute('data-testid', 'fluid-deletion-ghost');
    el.textContent = text;
    const st = el.style;
    st.left = `${box.left}px`;
    st.top = `${box.top}px`;
    st.width = `${box.width}px`;
    st.textIndent = `${box.indent}px`;
    st.lineHeight = `${box.lineHeight}px`;
    // Each overlay element is appended and animated as one pair, so the
    // finish handler below always removes the element its animation drove.
    const parts: Array<{ el: HTMLElement; anim: Animation }> = [];
    const animate = (target: HTMLElement, keyframes: Keyframe[], duration: number) => {
      this.layer.appendChild(target);
      parts.push({ el: target, anim: target.animate(keyframes, { duration, easing: 'ease-out', fill: 'forwards' }) });
    };
    if (effect === 'pop') {
      // Req 7: Pop — scale out to ~0.8 about the removed span's start, on its first line's centre.
      st.transformOrigin = `${box.indent}px ${box.lineHeight / 2}px`;
      animate(
        el,
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.8)' },
        ],
        FLUID_DURATIONS_MS.pop
      );
    } else {
      // Req 7: Fade (and Burst's text) — opacity 1 → 0.
      animate(el, [{ opacity: 1 }, { opacity: 0 }], FLUID_DURATIONS_MS.fade);
    }
    if (effect === 'burst') {
      // Req 7: Burst — particles scatter from the removed text's first
      // painted line: one layout read of the ghost's own text node (an
      // overlay element, never content), falling back to the removal point.
      let line: FluidRect = { left: box.left + box.indent, top: box.top, width: 0, height: box.lineHeight };
      if (el.firstChild && typeof document.createRange === 'function') {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild);
        const rect = range.getClientRects()[0];
        if (rect) line = { left: rect.left - frame.left, top: rect.top - frame.top, width: rect.width, height: rect.height };
      }
      for (const p of fluidBurstParticles(line, FLUID_BURST_PARTICLES)) {
        const dot = document.createElement('div');
        dot.className = 'fluid-burst-particle';
        dot.setAttribute('data-testid', 'fluid-burst-particle');
        dot.style.left = `${p.x}px`;
        dot.style.top = `${p.y}px`;
        animate(
          dot,
          [
            { opacity: 1, transform: 'translate(0, 0)' },
            { opacity: 0, transform: `translate(${p.dx}px, ${p.dy}px)` },
          ],
          FLUID_DURATIONS_MS.burst // Req 8: ≤ 400 ms
        );
      }
    }
    const entry: InFlight = {
      kind: 'deletion',
      els: parts.map((part) => part.el),
      cls: null,
      stop: () => {
        for (const part of parts) part.anim.cancel();
      },
    };
    this.inFlight.add(entry);
    let pending = parts.length;
    for (const part of parts) {
      part.anim.onfinish = () => {
        part.el.remove(); // Req 15: each element goes the moment it finishes
        if (--pending === 0) this.finish(entry);
      };
    }
  }
}

/**
 * PRD 025 Req 3 / Req 18: the extension the editor's `fluidComp` Compartment
 * holds while the mode is on. One plugin instance per mapping (and per
 * theme side — the editor reconfigures on `themeVariant` too, which is what
 * cancels a ghost on a theme change, Req 15).
 */
export function fluidExtension(map: FluidEffectMap): Extension {
  const plugin = ViewPlugin.define((view) => new FluidOverlay(view, map));
  return [
    plugin,
    // Req 9: an update listener runs after the view is back to idle, so the
    // ghost is drawn from the applied state and may read layout — a
    // ViewPlugin's own `update` runs mid-update and may not.
    EditorView.updateListener.of((u) => {
      if (!u.selectionSet && !u.docChanged) return;
      const overlay = u.view.plugin(plugin);
      if (!overlay) return;
      // Req 10 / Req 11: a caret result is the cursor effect's; a range
      // result is the selection effect's — never both for one transaction.
      if (u.selectionSet) {
        if (u.state.selection.main.empty) overlay.caretResult(u);
        else overlay.selectionChanged(u);
      }
      // Reqs 12, 13 (issues #336, #337): a document change is the deletion
      // and insertion effects', routed on `docChanged` so a host `applyEdit`
      // that sets no selection still animates; it runs after the
      // caret/selection branch so an undo shows both the caret ghost and the
      // deletion ghost or the insertion mask.
      if (u.docChanged) overlay.documentChanged(u);
    }),
  ];
}
