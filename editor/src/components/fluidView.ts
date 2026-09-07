/**
 * PRD 025 (issues #334, #335): the Fluid mode view extension — the overlay
 * layer, the in-flight registry every effect adds to, the Cursor movement
 * effect (Req 10) and the Selection change effect (Req 11). Loaded only
 * while the `fluid` prop carries a mapping (its Compartment is empty
 * otherwise, Req 3), so with the mode off there is no listener, no timer and
 * no overlay element.
 *
 * Req 9 (never-delay): nothing here intercepts a key, wraps `dispatch`, or
 * defers a change. A ghost is drawn from an update listener AFTER the
 * transaction is applied — `update.state` is already the final state — and
 * the only synchronous work added is the decision, a few `coordsAtPos`
 * reads (plus one content-rect read for a selection), the ghost elements
 * appended to the overlay or re-targeted, and the animation started.
 */

import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { Transaction, type Extension } from '@codemirror/state';
import type { FluidEffectMap } from '../lib/fluid';
import { fluidCurveSamples, fluidCursorCurve, isFluidNavigationMove } from '../lib/fluidCursor';
import {
  fluidRectAt,
  fluidSelectionCurve,
  fluidSelectionDecision,
  fluidSelectionRects,
  fluidSelectionShape,
  type FluidPosCoords,
  type FluidSelectionShape,
} from '../lib/fluidSelection';

/** Req 17: the class the editor root wears while a caret ghost is in flight. */
const IN_FLIGHT_CLASS = 'fluid-caret-in-flight';

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

/** One effect in flight: its overlay elements, the root class it wears, and how to stop it early. */
interface InFlight {
  els: HTMLElement[];
  cls: string;
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

/** The first `Transaction.userEvent` annotation across the update's transactions, or null when none carries one. */
function userEventOf(u: ViewUpdate): string | null {
  for (const tr of u.transactions) {
    const event = tr.annotation(Transaction.userEvent);
    if (event != null) return event;
  }
  return null;
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
    for (const f of this.inFlight) {
      f.stop();
      for (const el of f.els) el.remove();
    }
    this.inFlight.clear();
    this.selection = null;
    this.view.dom.classList.remove(IN_FLIGHT_CLASS, SELECTION_IN_FLIGHT_CLASS);
  }

  private finish(f: InFlight): void {
    if (!this.inFlight.delete(f)) return;
    if (f === this.selection) this.selection = null;
    for (const el of f.els) el.remove(); // Req 15: gone the moment it finishes
    // Req 17: the real caret / selection is hidden only while its ghost flies.
    let stillWorn = false;
    for (const other of this.inFlight) if (other.cls === f.cls) stillWorn = true;
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
    // (and a caret result has already cancelled any selection ghost).
    this.cancelAll();
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
    const entry: InFlight = { els: [el], cls: IN_FLIGHT_CLASS, stop: () => anim.cancel() };
    this.inFlight.add(entry);
    view.dom.classList.add(IN_FLIGHT_CLASS); // Req 17: the real caret hides only while the ghost flies
    anim.onfinish = () => this.finish(entry);
  }

  /**
   * PRD 025 Req 11 (issue #335): runs from the update listener for a
   * transaction whose main selection is a caret. A caret result cancels a
   * selection ghost immediately (click, arrow, Escape); the cursor effect
   * then proceeds as Req 10 defines.
   */
  caretResult(u: ViewUpdate): void {
    if (this.selection) this.cancelAll();
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
    if (this.inFlight.size > 0 && !this.selection) this.cancelAll();
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
      // element, no frame. Either way any ghost in flight goes at once.
      this.cancelAll();
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
      this.cancelAll(); // not rendered / off-screen: snap
      return;
    }
    const target = fluidSelectionShape(fluidSelectionRects({ start: toStart, end: toEnd, contentLeft, contentRight }));
    const now = performance.now();
    const { at: curve, durationMs } = fluidSelectionCurve(effect);
    const ghost = this.selection;
    if (ghost) {
      // Req 11: re-target — the ghost's current geometry (the curve sampled
      // at the elapsed fraction) becomes the new start; the clock restarts.
      ghost.start = ghost.current;
      ghost.target = target;
      ghost.startedAt = now;
      return;
    }
    const fromStart = at(Math.min(from.anchor, from.head));
    const fromEnd = at(Math.max(from.anchor, from.head));
    if (!fromStart || !fromEnd) {
      this.cancelAll();
      return;
    }
    const start = fluidSelectionShape(
      fluidSelectionRects({ start: fromStart, end: fromEnd, contentLeft, contentRight })
    );
    // Req 17: a range result replaced any caret ghost above, so the overlay
    // is empty here; the ghost is three fixed slots (Req 11) in the layer.
    const els: HTMLElement[] = [];
    for (let i = 0; i < 3; i++) {
      const el = document.createElement('div');
      el.className = 'fluid-selection-ghost';
      el.setAttribute('data-testid', 'fluid-selection-ghost');
      els.push(el);
    }
    const entry: SelectionGhost = {
      els,
      cls: SELECTION_IN_FLIGHT_CLASS,
      stop: () => cancelAnimationFrame(entry.raf),
      start,
      target,
      current: start,
      startedAt: now,
      raf: 0,
    };
    const paint = (shape: FluidSelectionShape): void => {
      for (let i = 0; i < 3; i++) {
        const r = shape[i];
        const st = els[i].style;
        st.left = `${r.left}px`;
        st.top = `${r.top}px`;
        st.width = `${r.width}px`;
        st.height = `${r.height}px`;
      }
    };
    const step = (t: number): void => {
      if (this.selection !== entry) return;
      const fraction = Math.min(1, Math.max(0, (t - entry.startedAt) / durationMs));
      entry.current = [
        fluidRectAt(entry.start[0], entry.target[0], curve(fraction)),
        fluidRectAt(entry.start[1], entry.target[1], curve(fraction)),
        fluidRectAt(entry.start[2], entry.target[2], curve(fraction)),
      ];
      paint(entry.current);
      if (fraction >= 1) this.finish(entry);
      else entry.raf = requestAnimationFrame(step);
    };
    paint(start);
    for (const el of els) this.layer.appendChild(el);
    this.inFlight.add(entry);
    this.selection = entry;
    view.dom.classList.add(SELECTION_IN_FLIGHT_CLASS); // Req 17: the real selection hides only while the ghost flies
    entry.raf = requestAnimationFrame(step);
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
      if (!u.selectionSet) return;
      const overlay = u.view.plugin(plugin);
      if (!overlay) return;
      // Req 10 / Req 11: a caret result is the cursor effect's; a range
      // result is the selection effect's — never both for one transaction.
      if (u.state.selection.main.empty) overlay.caretResult(u);
      else overlay.selectionChanged(u);
    }),
  ];
}
