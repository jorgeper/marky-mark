/**
 * Issue #157: the fenced-code card view — view wiring over the pure span
 * core in src/lib/codeBlockSpans.ts, following the livePreview plugin's
 * shape. Line decorations paint the preview's card chrome (styles.css,
 * the same --mm-code-bg token `.doc pre` uses) and Decoration.replace
 * hides the delimiter marks + info string; nothing here ever changes
 * text, history, or the dirty state. Editor.tsx includes the extension
 * in a compartment while the `codeBlockView` setting is on — off, the
 * compartment is empty and fences show exactly as before.
 *
 * Issue #163: each rendered card also carries the preview's copy control —
 * a widget on the card's first line, kept out of the document exactly like
 * the preview's graft (lib/codeCopy.ts): the button holds no text node and
 * dispatches no transaction, so text, caret, history and the dirty state
 * never move. The write goes through the injected clipboard seam.
 *
 * Issue #265: that control is no longer hover-only. The block holding the
 * main selection shows its button steadily until the caret leaves — which
 * means the widget now renders for a REVEALED card too (issue #163 skipped
 * it there), lit through its own `is-cursor` class so the hover walk below
 * and the persistent state cannot clear each other. Visibility only: the
 * button's position, styling and inertness are untouched.
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
import { computeCodeCards, type Span } from '../lib/codeBlockSpans';
import { createCopyButton } from '../lib/codeCopy';
import { tableModeField } from './tableMode';

export interface CodeBlockViewConfig {
  /**
   * Issue #163: the app's clipboard seam (App.copyToClipboard, threaded in
   * as the Editor's onCopyText prop) — resolves whether the write landed,
   * so a rejected write leaves the button at rest.
   */
  copy(text: string): Promise<boolean> | boolean;
}

/**
 * The card copy button's class and `data-testid` — deliberately NOT the
 * preview's `mm-copy-code`, so split-view tests that scope that id to the
 * preview root keep exactly one match.
 */
export const CARD_COPY_CLASS = 'mm-copy-code-editor';

/**
 * Issue #265: the persistent "the caret is in this block" class. Its own
 * class, deliberately NOT `is-hover`: the `setHoveredCard` walk toggles
 * `is-hover` off on every other button on each pass, so reusing it would let
 * a pointer over block B clear block A's persistent state (and vice versa).
 * Two independent lit states, either one enough — see styles.css.
 */
export const CARD_COPY_CURSOR_CLASS = 'is-cursor';

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

/**
 * Issue #163: the preview's hover copy control, as an inline widget on the
 * card's first line (a hidden delimiter row — absolute-positioned chrome in
 * a blank row, so the layout never moves). The body span is read from the
 * live state at click time; a doc change that shifts it rebuilds the widget
 * (both `eq` and `updateDOM` key on the span), so the span the click reads
 * is always current.
 *
 * Issue #265: the widget also carries the cursor-inside flag, so the block
 * holding the main selection lights its button steadily. The flag rides the
 * widget rather than a DOM walk because it is derived state — `revealed`
 * from `computeCodeCards` — and the plugin already rebuilds on every
 * selection move. On a revealed card the first line is the raw opening fence
 * rather than a blank row; the button is absolutely positioned, so it still
 * lands top-right and the fence text does not reflow.
 */
class CardCopyWidget extends WidgetType {
  constructor(
    readonly body: Span,
    readonly cursorInside: boolean,
    readonly copy: CodeBlockViewConfig['copy']
  ) {
    super();
  }

  eq(other: CardCopyWidget): boolean {
    // Same span ⇒ same DOM kept across selection-only rebuilds, so a running
    // "Copied" confirmation survives caret moves elsewhere in the document.
    // Issue #265: the caret crossing THIS block's boundary is a real change,
    // but updateDOM below repaints that node in place, so the confirmation
    // and the hover class survive it too.
    return (
      other.body.from === this.body.from &&
      other.body.to === this.body.to &&
      other.cursorInside === this.cursorInside
    );
  }

  /**
   * Issue #265: the cursor-inside flag is one class on an existing button —
   * repaint it in place. Returning true keeps the very same node, so a
   * running "Copied" state and the hover class survive the caret entering or
   * leaving the block.
   *
   * The span is the condition, not a formality: CodeMirror offers any unused
   * node of this widget type here (`from` is the widget that built it, not
   * necessarily this position's), and toDOM's readRaw closure reads ITS
   * widget's span. Adopting a node built for another span would make the
   * click copy that span — off by an edit, or another block entirely — so a
   * moved body refuses and is redrawn, as it was before this issue.
   */
  updateDOM(dom: HTMLElement, _view: EditorView, from: CardCopyWidget): boolean {
    if (from.body.from !== this.body.from || from.body.to !== this.body.to) return false;
    dom.classList.toggle(CARD_COPY_CURSOR_CLASS, this.cursorInside);
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    // Same button as the preview's, down to the confirmation timing — only the
    // text source differs: the live document under the body span, sliced at
    // click time, with codeBlockText the one trailing-newline rule for both.
    const btn = createCopyButton(
      view.dom.ownerDocument,
      CARD_COPY_CLASS,
      () => view.state.sliceDoc(this.body.from, this.body.to),
      this.copy
    );
    // Issue #265: lit from birth when the caret is already inside — a click
    // that lands in a rendered block rebuilds the widget in the same update.
    btn.classList.toggle(CARD_COPY_CURSOR_CLASS, this.cursorInside);
    // Inert chrome: the mousedown never reaches CodeMirror and never focuses
    // the button, so the caret does not move, the block does not reveal, and
    // nothing is dispatched.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    return btn;
  }

  // The button's events are its own — CodeMirror must not turn them into
  // caret placement (the WidgetType default, restated because the reveal
  // rules above depend on it).
  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(view: EditorView, cfg: CodeBlockViewConfig): DecorationSet {
  // Grid exclusion, like SPEC41 §2.4: gridded spans keep their own geometry.
  const grid = view.state.field(tableModeField, false);
  const cards = computeCodeCards(view.state, true, grid?.spans ?? []);
  const ranges = [];
  for (const card of cards) {
    const lastIndex = card.lines.length - 1;
    for (let i = 0; i <= lastIndex; i++) ranges.push(cardLineDeco(i, lastIndex).range(card.lines[i]));
    for (const h of card.hide) ranges.push(HIDE.range(h.from, h.to));
    // Issue #163, amended by issue #265: EVERY card gets the copy control,
    // revealed ones included — a caret inside the block IS the revealed state,
    // so skipping it there (as #163 did) would mean the cursor-inside block,
    // the one case that must show a button steadily, had no button at all.
    // `revealed` is the visibility rule verbatim: `computeCodeCards`' main
    // selection head within the FencedCode node, both boundaries inclusive,
    // so at most one block is lit persistently and a selection dragged from
    // prose into a block counts as inside.
    ranges.push(
      Decoration.widget({
        widget: new CardCopyWidget(card.body, card.revealed, cfg.copy),
        side: -1,
      }).range(card.from)
    );
  }
  return Decoration.set(ranges, true);
}

/**
 * Issue #163: hover reveal for the copy control. The button sits on the
 * card's FIRST line, but hovering anywhere on the card must light it, and
 * CSS alone cannot select an earlier sibling — so the hovered line walks up
 * its card-line siblings to the card's first line and the button toggles a
 * class. One pass over the buttons keeps exactly the hovered card's lit.
 */
function firstCardLine(target: EventTarget | null): Element | null {
  let line = target instanceof Element ? target.closest('.cm-line.mm-fence-card') : null;
  while (line && !line.classList.contains('mm-fence-card-first')) {
    const prev = line.previousElementSibling;
    line = prev && prev.classList.contains('mm-fence-card') ? prev : null;
  }
  return line;
}

function setHoveredCard(view: EditorView, target: EventTarget | null): void {
  const btn = firstCardLine(target)?.querySelector(`.${CARD_COPY_CLASS}`) ?? null;
  for (const b of view.contentDOM.querySelectorAll(`.${CARD_COPY_CLASS}`))
    b.classList.toggle('is-hover', b === btn);
}

/** The card-view bundle Editor.tsx mounts while `codeBlockView` is on. */
export function codeBlockViewExtension(cfg: CodeBlockViewConfig): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, cfg);
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
          this.decorations = buildDecorations(update.view, cfg);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );

  const hover = EditorView.domEventHandlers({
    mouseover(event, view) {
      setHoveredCard(view, event.target);
    },
    mouseleave(_event, view) {
      setHoveredCard(view, null);
    },
  });

  return [plugin, hover];
}
