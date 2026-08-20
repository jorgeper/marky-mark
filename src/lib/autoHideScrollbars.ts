/**
 * Issue #167: auto-hiding scrollbars. A surface's bar shows while it is
 * being scrolled (wheel, drag, keyboard, or programmatic — anything that
 * fires a scroll event) and fades once it has been idle for the one named
 * delay below. The visible state is written to the surface as
 * `data-scrollbars="active" | "idle"` — an absent attribute reads as idle —
 * and `src/styles.css` keys the thumb's paint off it, so a Playwright test
 * can assert the state per surface. The paint-only design (the gutter is
 * never removed) is what keeps hiding reflow-free.
 */

/** Issue #167: the one idle delay (~1.5s) — every surface fades on THIS. */
export const SCROLLBAR_IDLE_MS = 1500;

/**
 * Issue #167: the surfaces that fade — the document scrollers (full-preview
 * workspace, split preview, the editor's CodeMirror scroller) and the
 * sidebar/search lists, which share `.folder-list`. `.file-tab-rail` is
 * deliberately NOT here: it is barless by contract (PRD 013 Req 9) and
 * keeps its arrow affordances.
 */
export const SCROLLBAR_FADE_SELECTOR = '.workspace, .split-preview, .cm-scroller, .folder-list';

export type ScrollbarFadeState = 'active' | 'idle';

/** The seams the pure machine below drives — DOM-free, so unit-testable. */
export interface ScrollbarFadeHooks {
  set(state: ScrollbarFadeState): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

export interface ScrollbarFade {
  /** A scroll event happened: show the bar and restart the idle countdown. */
  scrolled(): void;
  /** An interaction (pointer over the bar, thumb drag) holds the bar shown. */
  hold(): void;
  /** The interaction ended: the idle countdown restarts from now. */
  release(): void;
  /** Stop the pending timer (teardown); leaves the state where it is. */
  dispose(): void;
}

/**
 * Issue #167: the per-surface idle/active machine. Holds are counted so a
 * drag that starts while the pointer already hovers the bar needs both ends
 * to finish before the countdown re-arms — the bar never disappears out
 * from under an interaction in progress.
 */
export function createScrollbarFade(h: ScrollbarFadeHooks): ScrollbarFade {
  let timer: unknown = null;
  let holds = 0;
  const stop = () => {
    if (timer !== null) {
      h.clearTimer(timer);
      timer = null;
    }
  };
  const arm = () => {
    stop();
    if (holds === 0)
      timer = h.setTimer(() => {
        timer = null;
        h.set('idle');
      }, SCROLLBAR_IDLE_MS);
  };
  return {
    scrolled() {
      h.set('active');
      arm();
    },
    hold() {
      holds++;
      stop();
      h.set('active');
    },
    release() {
      if (holds > 0) holds--;
      if (holds === 0) arm();
    },
    dispose: stop,
  };
}

/**
 * The element metrics the gutter test needs — plain numbers, so the math is
 * unit-testable without a layout engine. `clientWidth`/`clientHeight`
 * exclude the scrollbar gutters; the border-box rect includes them.
 */
export interface GutterMetrics {
  left: number;
  top: number;
  clientLeft: number;
  clientTop: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * Issue #167: is a viewport point inside a surface's scrollbar gutter — the
 * strip past the content box's right edge (vertical bar) or bottom edge
 * (horizontal bar)? Only meaningful for points already inside the element.
 */
export function inScrollbarGutter(m: GutterMetrics, x: number, y: number): boolean {
  return x >= m.left + m.clientLeft + m.clientWidth || y >= m.top + m.clientTop + m.clientHeight;
}

/**
 * Issue #167: ONE document-level installer covers every fading surface —
 * present and future (the editor mounts lazily, the split comes and goes) —
 * instead of per-component wiring. Scroll doesn't bubble, so the listeners
 * ride the capture phase. Pointer events over the gutter hold the bar and
 * restart the countdown on exit (best effort — the CSS `:hover`/`:active`
 * thumb rules in styles.css back this up even where the engine swallows
 * pointer events over a native-drawn bar). Returns the uninstaller; it
 * clears every timer and strips the attributes, so turning the setting off
 * leaves no timer running and today's always-visible bars.
 */
export function installScrollbarFade(doc: Document, selector: string = SCROLLBAR_FADE_SELECTOR): () => void {
  const machines = new Map<HTMLElement, ScrollbarFade>();
  const hovering = new Set<HTMLElement>();

  const machineFor = (el: HTMLElement): ScrollbarFade => {
    let m = machines.get(el);
    if (!m) {
      m = createScrollbarFade({
        set: (s) => el.setAttribute('data-scrollbars', s),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (t) => window.clearTimeout(t as number),
      });
      machines.set(el, m);
    }
    return m;
  };

  const metrics = (el: HTMLElement): GutterMetrics => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      clientLeft: el.clientLeft,
      clientTop: el.clientTop,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
    };
  };

  const releaseAll = () => {
    for (const el of hovering) machineFor(el).release();
    hovering.clear();
  };

  // The scroll target IS the surface (scroll doesn't bubble) — each surface
  // flips independently, so scrolling the editor never un-hides an idle
  // preview's bar.
  const onScroll = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.matches(selector)) machineFor(t).scrolled();
  };

  const onPointerMove = (e: PointerEvent) => {
    const t = e.target;
    const overGutter =
      t instanceof HTMLElement && t.matches(selector) && inScrollbarGutter(metrics(t), e.clientX, e.clientY);
    if (overGutter && e.buttons === 0) {
      if (!hovering.has(t)) {
        hovering.add(t);
        machineFor(t).hold();
      }
    } else if (!overGutter || e.buttons === 0) {
      // Left the gutter (or a swallowed pointerup ended a drag): the idle
      // countdown restarts now, not from the last scroll event.
      if (hovering.size) releaseAll();
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.matches(selector)) return;
    if (!inScrollbarGutter(metrics(t), e.clientX, e.clientY)) return;
    if (!hovering.has(t)) {
      hovering.add(t);
      machineFor(t).hold();
    }
  };

  const onPointerUp = () => {
    if (hovering.size) releaseAll();
  };

  doc.addEventListener('scroll', onScroll, true);
  doc.addEventListener('pointermove', onPointerMove, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('pointerup', onPointerUp, true);
  doc.addEventListener('pointercancel', onPointerUp, true);
  return () => {
    doc.removeEventListener('scroll', onScroll, true);
    doc.removeEventListener('pointermove', onPointerMove, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerUp, true);
    for (const [el, m] of machines) {
      m.dispose();
      el.removeAttribute('data-scrollbars');
    }
    machines.clear();
    hovering.clear();
  };
}
