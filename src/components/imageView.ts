/**
 * SPEC41 §2/§6: the inline image view — every image reference renders as the
 * actual image in the edit pane, as PURE DECORATION. Unlike the SPEC40 grid,
 * nothing here ever changes text, history, or the dirty state: the widgets
 * replace spans visually and vanish without a trace.
 *
 *   - Caret-reveal (§2.2): a span strictly containing the selection head
 *     (start < head <= end) shows its raw markdown; the start boundary keeps
 *     the widget so a click that parks the caret there doesn't dismiss it.
 *   - Grid exclusion (§2.4): refs overlapping a SPEC40 grid span stay raw —
 *     a widget inside the aligned grid would wreck its geometry.
 *   - SPEC11 (§2.1): remote srcs (http/https/protocol-relative) NEVER load;
 *     the widget renders the blocked-origin placeholder text instead.
 */

import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { allImageRefs, type ImageRef } from '../lib/imageResize';
import { isRemoteSrc, remoteHost } from '../lib/markdown';
import { tableModeField } from './tableMode';

export interface ImageViewConfig {
  /** Initial view state (the inlineImages setting at mount). */
  enabled: boolean;
  /** Local-src resolver (the platform asset seam); null ⇒ leave src as-is. */
  resolve: ((src: string) => string) | null;
  /** A widget was clicked: caret parked at ref.start, chips should show. */
  onSelect(ref: ImageRef): void;
}

/** Flip the whole view on/off (the global setting changed). */
export const setImageView = StateEffect.define<boolean>();

class ImageWidget extends WidgetType {
  constructor(
    readonly ref: ImageRef,
    readonly url: string | null // null ⇒ blocked remote (placeholder)
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      other.ref.start === this.ref.start &&
      other.ref.src === this.ref.src &&
      other.ref.width === this.ref.width &&
      other.ref.height === this.ref.height &&
      other.url === this.url
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'mm-image-widget';
    wrap.dataset.refStart = String(this.ref.start);
    // An empty resolution (the web platform's "can never resolve") renders a
    // neutral note — an <img src=""> would request the page itself.
    if (this.url === '') {
      const span = document.createElement('span');
      span.className = 'mm-blocked-remote';
      span.textContent = `🖼 image unavailable${this.ref.alt ? ` (“${this.ref.alt}”)` : ''}`;
      wrap.appendChild(span);
      return wrap;
    }
    if (this.url === null) {
      const span = document.createElement('span');
      span.className = 'mm-blocked-remote';
      span.textContent = `🚫 remote image (${remoteHost(this.ref.src)}${
        this.ref.alt ? `: “${this.ref.alt}”` : ''
      }) — Marky Mark is local-only`;
      wrap.appendChild(span);
      return wrap;
    }
    const img = document.createElement('img');
    img.src = this.url;
    img.alt = this.ref.alt;
    img.dataset.refStart = String(this.ref.start);
    if (this.ref.width !== undefined) img.style.width = `${this.ref.width}px`;
    if (this.ref.height !== undefined) img.style.height = `${this.ref.height}px`;
    img.draggable = false;
    wrap.appendChild(img);
    return wrap;
  }

  // The click must reach our mousedown handler (select + park the caret).
  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecos(state: EditorState, enabled: boolean, cfg: ImageViewConfig): DecorationSet {
  if (!enabled) return Decoration.none;
  const refs = allImageRefs(state.doc.toString());
  if (!refs.length) return Decoration.none;
  const head = state.selection.main.head;
  const grid = state.field(tableModeField, false) ?? null;
  // §2.2 caret-reveal: a span strictly containing the head (end-inclusive)
  // shows raw — and the reveal extends across a contiguous run of exactly
  // abutting spans (back-to-back references are one editing site; a
  // widget/raw mosaic there would be unreadable).
  const revealed = new Set<ImageRef>();
  for (const r of refs) if (r.start < head && head <= r.end) revealed.add(r);
  let grew = revealed.size > 0;
  while (grew) {
    grew = false;
    for (const r of refs) {
      if (revealed.has(r)) continue;
      for (const s of revealed) {
        if (r.end === s.start || r.start === s.end) {
          revealed.add(r);
          grew = true;
          break;
        }
      }
    }
  }
  const ranges = [];
  for (const r of refs) {
    if (revealed.has(r)) continue;
    // §2.4: images inside a grid span stay raw text.
    if (grid?.spans.some((s) => r.start < s.to && r.end > s.from)) continue;
    const url = isRemoteSrc(r.src) ? null : (cfg.resolve ? cfg.resolve(r.src) : r.src);
    ranges.push(Decoration.replace({ widget: new ImageWidget(r, url) }).range(r.start, r.end));
  }
  return Decoration.set(ranges);
}

/** The image-view bundle: decoration field + widget click handling. */
export function imageViewExtension(cfg: ImageViewConfig) {
  const field = StateField.define<{ enabled: boolean; decos: DecorationSet }>({
    create(state) {
      return { enabled: cfg.enabled, decos: buildDecos(state, cfg.enabled, cfg) };
    },
    update(v, tr) {
      let enabled = v.enabled;
      for (const e of tr.effects) if (e.is(setImageView)) enabled = e.value;
      // Grid-set changes arrive as effects, so effects.length covers §2.4.
      if (!tr.docChanged && !tr.selection && !tr.effects.length) return v;
      return { enabled, decos: buildDecos(tr.state, enabled, cfg) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  });

  const click = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement | null;
      const host = target?.closest?.('.mm-image-widget') as HTMLElement | null;
      if (!host || !view.contentDOM.contains(host)) return false;
      const start = Number(host.dataset.refStart);
      const ref = allImageRefs(view.state.doc.toString()).find((r) => r.start === start);
      if (!ref) return false;
      // §2.2: park the caret at the span START (boundary — widget stays).
      view.dispatch({ selection: { anchor: ref.start } });
      cfg.onSelect(ref);
      event.preventDefault();
      return true;
    },
  });

  return [field, click];
}
