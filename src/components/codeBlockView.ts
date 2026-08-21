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
import { codeBlockText, COPIED_CLASS, CONFIRM_MS } from '../lib/codeCopy';
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
 * (`eq` is positional), so the span the click reads is always current.
 */
class CardCopyWidget extends WidgetType {
  constructor(
    readonly body: Span,
    readonly copy: CodeBlockViewConfig['copy']
  ) {
    super();
  }

  eq(other: CardCopyWidget): boolean {
    // Same span ⇒ same DOM kept across selection-only rebuilds, so a running
    // "Copied" confirmation survives caret moves elsewhere in the document.
    return other.body.from === this.body.from && other.body.to === this.body.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CARD_COPY_CLASS;
    btn.dataset.testid = CARD_COPY_CLASS;
    btn.setAttribute('aria-label', 'Copy code');
    // Inert chrome: the mousedown never reaches CodeMirror and never focuses
    // the button, so the caret does not move, the block does not reveal, and
    // nothing is dispatched — the label is CSS ::after, so no text node either.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // The one trailing-newline rule is codeBlockText — the body span ends
      // with the newline the closing delimiter implies (codeBlockSpans).
      const text = codeBlockText(view.state.sliceDoc(this.body.from, this.body.to));
      void (async () => {
        const ok = (await this.copy(text)) === true;
        if (!ok) return; // a failed write says nothing rather than lying
        btn.classList.add(COPIED_CLASS);
        btn.setAttribute('aria-label', 'Copied');
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          btn.classList.remove(COPIED_CLASS);
          btn.setAttribute('aria-label', 'Copy code');
        }, CONFIRM_MS);
      })();
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
    // Issue #163: rendered cards get the copy control; a revealed block is
    // raw text under the caret and carries none.
    if (!card.revealed)
      ranges.push(Decoration.widget({ widget: new CardCopyWidget(card.body, cfg.copy), side: -1 }).range(card.from));
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
