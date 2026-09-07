/**
 * PRD 025 (issue #334): the Fluid mode view extension — the overlay layer,
 * the in-flight registry every effect adds to, and the Cursor movement
 * effect (Req 10). Loaded only while the `fluid` prop carries a mapping
 * (its Compartment is empty otherwise, Req 3), so with the mode off there is
 * no listener, no timer and no overlay element.
 *
 * Req 9 (never-delay): nothing here intercepts a key, wraps `dispatch`, or
 * defers a change. The ghost is drawn from an update listener AFTER the
 * transaction is applied — `update.state` is already the final state — and
 * the only synchronous work added is the navigation decision, two
 * `coordsAtPos` reads, one element appended to the overlay and its
 * animation started.
 */

import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { Transaction, type Extension } from '@codemirror/state';
import type { FluidEffectMap } from '../lib/fluid';
import { fluidCurveSamples, fluidCursorCurve, isFluidNavigationMove } from '../lib/fluidCursor';

/** Req 17: the class the editor root wears while a caret ghost is in flight. */
const IN_FLIGHT_CLASS = 'fluid-caret-in-flight';

/** Req 16: read at scheduling time, never cached — an OS change takes effect on the next move. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

interface InFlight {
  el: HTMLElement;
  anim: Animation;
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
      f.anim.cancel();
      f.el.remove();
    }
    this.inFlight.clear();
    this.view.dom.classList.remove(IN_FLIGHT_CLASS);
  }

  private finish(f: InFlight): void {
    if (!this.inFlight.delete(f)) return;
    f.el.remove(); // Req 15: gone the moment it finishes
    if (this.inFlight.size === 0) this.view.dom.classList.remove(IN_FLIGHT_CLASS);
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
        userEvent: u.transactions.map((tr) => tr.annotation(Transaction.userEvent)).find((e) => e != null) ?? null,
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
    // Req 17: at most one caret ghost — a new move replaces the one in flight.
    this.cancelAll();
    // The overlay sits at inset 0 of the scroller and scrolls with the
    // content, so client coordinates translate by the layer's own rect
    // (layout is already clean after coordsAtPos; this forces nothing).
    const frame = this.layer.getBoundingClientRect();
    const el = document.createElement('div');
    if (typeof el.animate !== 'function') return; // no Web Animations: no static ghost either
    el.className = 'fluid-caret-ghost';
    el.setAttribute('data-testid', 'fluid-caret-ghost');
    el.style.left = `${from.left - frame.left}px`;
    el.style.top = `${from.top - frame.top}px`;
    el.style.height = `${to.bottom - to.top}px`; // sized to the destination line
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const { at, durationMs } = fluidCursorCurve(effect);
    // Req 20: keyframes sampled from the in-package curve, ~8 ms apart,
    // played linearly by the Web Animations API — no library involved.
    const keyframes = fluidCurveSamples(at, Math.ceil(durationMs / 8)).map((f) => ({
      transform: `translate(${dx * f}px, ${dy * f}px)`,
    }));
    this.layer.appendChild(el);
    const anim = el.animate(keyframes, { duration: durationMs, easing: 'linear', fill: 'forwards' });
    const entry: InFlight = { el, anim };
    this.inFlight.add(entry);
    view.dom.classList.add(IN_FLIGHT_CLASS); // Req 17: the real caret hides only while the ghost flies
    anim.onfinish = () => this.finish(entry);
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
      if (u.selectionSet) u.view.plugin(plugin)?.cursorMoved(u);
    }),
  ];
}
