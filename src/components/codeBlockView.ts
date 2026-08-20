/**
 * Issue #157: the fenced-code card view — view wiring over the pure span
 * core in src/lib/codeBlockSpans.ts, following the livePreview plugin's
 * shape. Line decorations paint the preview's card chrome (styles.css,
 * the same --mm-code-bg token `.doc pre` uses) and Decoration.replace
 * hides the delimiter marks + info string; nothing here ever changes
 * text, history, or the dirty state. Editor.tsx includes the extension
 * in a compartment while the `codeBlockView` setting is on — off, the
 * compartment is empty and fences show exactly as before.
 */
import {
  ViewPlugin,
  Decoration,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { computeCodeCards } from '../lib/codeBlockSpans';
import { tableModeField } from './tableMode';

/** The delimiter marks + info string vanish visually; the text stays. */
const HIDE = Decoration.replace({});

// The card ring is painted per line, so which edges a line draws depends on
// where in the block it sits (styles.css rounds the corners to match).
const CARD_MIDDLE = Decoration.line({ class: 'mm-fence-card' });
const CARD_FIRST = Decoration.line({ class: 'mm-fence-card mm-fence-card-first' });
const CARD_LAST = Decoration.line({ class: 'mm-fence-card mm-fence-card-last' });
const CARD_ONLY = Decoration.line({ class: 'mm-fence-card mm-fence-card-first mm-fence-card-last' });

function cardLineDeco(index: number, lastIndex: number): Decoration {
  if (lastIndex === 0) return CARD_ONLY; // a one-line block draws all four edges
  if (index === 0) return CARD_FIRST;
  if (index === lastIndex) return CARD_LAST;
  return CARD_MIDDLE;
}

function buildDecorations(view: EditorView): DecorationSet {
  // Grid exclusion, like SPEC41 §2.4: gridded spans keep their own geometry.
  const grid = view.state.field(tableModeField, false);
  const cards = computeCodeCards(view.state, true, grid?.spans ?? []);
  const ranges = [];
  for (const card of cards) {
    const lastIndex = card.lines.length - 1;
    for (let i = 0; i <= lastIndex; i++) ranges.push(cardLineDeco(i, lastIndex).range(card.lines[i]));
    for (const h of card.hide) ranges.push(HIDE.range(h.from, h.to));
  }
  return Decoration.set(ranges, true);
}

const codeBlockViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // Selection moves drive the caret-reveal; viewport moves cover parse
      // progress on fresh content; a grid-set change without a doc edit
      // moves the excluded regions (same triggers as the livePreview plugin).
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

/** The card-view bundle Editor.tsx mounts while `codeBlockView` is on. */
export function codeBlockViewExtension(): Extension {
  return [codeBlockViewPlugin];
}
