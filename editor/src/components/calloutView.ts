/**
 * Issue #318: the edit-pane callout view — view wiring over the pure span
 * core in src/lib/calloutSpans.ts, following the linkView plugin's shape.
 * Each line of a callout block carries a line decoration (styles.css paints
 * the kind's tint and accent edge through the same `--mm-callout-*` tokens
 * the preview resolves), and the `[!KIND]` marker is replaced by a label
 * widget reading the kind's title. Nothing here ever changes text, history
 * or the dirty state. Editor.tsx includes the extension in a compartment
 * while the `calloutView` setting is on AND live preview is off — the
 * PRD 006 live preview already owns the quote lines, and exactly one of the
 * two may paint a block.
 */
import {
  ViewPlugin,
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { computeCalloutViews } from '../lib/calloutSpans';
import { CALLOUT_LABELS, calloutClass } from '../lib/callouts';
import type { CalloutKind } from '../lib/smartEdit';
import { tableModeField } from './tableMode';

/** The label's class (styles.css); its `data-testid` is `callout-label`. */
export const CALLOUT_LABEL_CLASS = 'mm-callout-label';

/**
 * The kind's title in place of its marker: an inert inline span holding no
 * document text, so the caret, history and the dirty state never move.
 * Keyed on the kind alone — the same kind is the same DOM.
 */
class CalloutLabelWidget extends WidgetType {
  constructor(readonly kind: CalloutKind) {
    super();
  }

  eq(other: CalloutLabelWidget): boolean {
    return other.kind === this.kind;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement('span');
    span.className = CALLOUT_LABEL_CLASS;
    span.dataset.testid = 'callout-label';
    span.textContent = CALLOUT_LABELS[this.kind];
    return span;
  }
}

/** The per-line decorations, cached per kind and edge combination. */
const lineDecos = new Map<string, Decoration>();
function lineDeco(kind: CalloutKind, first: boolean, last: boolean): Decoration {
  const key = `${kind}:${first ? 'f' : ''}${last ? 'l' : ''}`;
  let deco = lineDecos.get(key);
  if (!deco) {
    const classes = ['mm-callout-line', calloutClass(kind)];
    if (first) classes.push('mm-callout-first');
    if (last) classes.push('mm-callout-last');
    deco = Decoration.line({ class: classes.join(' ') });
    lineDecos.set(key, deco);
  }
  return deco;
}

function buildDecorations(view: EditorView): DecorationSet {
  // Grid exclusion, like linkView: gridded spans keep their own geometry.
  const grid = view.state.field(tableModeField, false);
  const callouts = computeCalloutViews(view.state, view.visibleRanges, grid?.spans ?? []);
  const ranges = [];
  const doc = view.state.doc;
  for (const c of callouts) {
    for (let ln = c.firstLine; ln <= c.lastLine; ln++) {
      const line = doc.line(ln);
      ranges.push(lineDeco(c.kind, ln === c.firstLine, ln === c.lastLine).range(line.from));
    }
    if (!c.revealed) {
      ranges.push(
        Decoration.replace({ widget: new CalloutLabelWidget(c.kind) }).range(c.marker.from, c.marker.to)
      );
    }
  }
  // Sorted here (not by push order), so line and marker ranges need no ordering.
  return Decoration.set(ranges, true);
}

/** The rendered-callouts bundle Editor.tsx mounts while `calloutView` is on. */
export function calloutViewExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        // Selection moves drive the marker reveal; viewport moves cover parse
        // progress on fresh content; a grid-set change without a doc edit
        // moves the excluded regions (same triggers as linkView).
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.startState.field(tableModeField, false) !== update.state.field(tableModeField, false)
        ) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}
