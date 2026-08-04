/**
 * PRD 006 §3–§9 (issues #47/#48/#49): the live-preview CodeMirror
 * extension — DOM/view wiring over the pure decoration core in
 * src/lib/livePreview.ts.
 *
 * PRD 006 §1 (#50): the shipped app reaches this through the
 * "Live preview (experimental)" setting — Editor.tsx includes the extension
 * in a compartment while `livePreview` is on; off (the default) the
 * compartment is empty and the edit pane behaves exactly as before.
 */
import {
  ViewPlugin,
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import {
  computeLivePreviewDecos,
  taskToggleChange,
  type LineStyle,
  type MarkStyle,
} from '../lib/livePreview';
import { tableModeField } from './tableMode';

/** PRD 006 §3/§6: one mark per style; colors/weights ride the theme. */
const MARKS: Record<MarkStyle, Decoration> = {
  strong: Decoration.mark({ class: 'mm-lp-strong' }),
  emphasis: Decoration.mark({ class: 'mm-lp-em' }),
  strikethrough: Decoration.mark({ class: 'mm-lp-strike' }),
  'inline-code': Decoration.mark({ class: 'mm-lp-code' }),
  'list-number': Decoration.mark({ class: 'mm-lp-list-num' }),
};

/** PRD 006 §4/§6: whole-line styles — heading sizes and the quote bar. */
const LINES: Record<LineStyle, Decoration> = {
  'heading-1': Decoration.line({ class: 'mm-lp-h1' }),
  'heading-2': Decoration.line({ class: 'mm-lp-h2' }),
  'heading-3': Decoration.line({ class: 'mm-lp-h3' }),
  'heading-4': Decoration.line({ class: 'mm-lp-h4' }),
  'heading-5': Decoration.line({ class: 'mm-lp-h5' }),
  'heading-6': Decoration.line({ class: 'mm-lp-h6' }),
  blockquote: Decoration.line({ class: 'mm-lp-quote' }),
};

/** PRD 006 §3/§9: markers vanish visually; the text underneath stays. */
const HIDE = Decoration.replace({});

/** PRD 006 §6: a bullet-list marker drawn as a bullet glyph. */
class BulletWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'mm-lp-bullet';
    el.textContent = '•';
    return el;
  }
  override eq() {
    return true;
  }
}

/** PRD 006 §6: a horizontal rule drawn in place of the raw ---/*** text. */
class RuleWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'mm-lp-hr';
    return el;
  }
  override eq() {
    return true;
  }
}

/** PRD 006 §7: a task marker drawn as a real checkbox mirroring [ ]/[x]. */
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  toDOM() {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.className = 'mm-lp-task';
    el.checked = this.checked;
    return el;
  }
  override eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  // PRD 006 §7: clicks inside the widget must reach the view's mousedown
  // handler (which dispatches the toggle) instead of being swallowed.
  override ignoreEvent() {
    return false;
  }
}

const BULLET = Decoration.replace({ widget: new BulletWidget() });
const RULE = Decoration.replace({ widget: new RuleWidget() });
// PRD 006 §7: one cached deco per checked state — a source edit swaps the
// deco, so the rebuild draws a visibly different checkbox.
const CHECKBOX_CHECKED = Decoration.replace({ widget: new CheckboxWidget(true) });
const CHECKBOX_UNCHECKED = Decoration.replace({ widget: new CheckboxWidget(false) });

function buildDecorations(view: EditorView): DecorationSet {
  // PRD 006 §11 (#55): tracked table-grid spans are excluded regions — their
  // lines keep raw character counts so the SPEC40 grid's pipes stay aligned.
  const grid = view.state.field(tableModeField, false);
  // PRD 006 §13: decorations are computed for the visible ranges only.
  const specs = computeLivePreviewDecos(view.state, view.visibleRanges, grid?.spans ?? []);
  return Decoration.set(
    specs.map((s) => {
      switch (s.deco) {
        case 'hide':
          return HIDE.range(s.from, s.to);
        case 'style':
          return MARKS[s.style].range(s.from, s.to);
        // PRD 006 §5: the link text carries its URL for the click hand-off.
        case 'link':
          return Decoration.mark({
            class: 'mm-lp-link',
            attributes: { 'data-mm-lp-url': s.url },
          }).range(s.from, s.to);
        case 'bullet':
          return BULLET.range(s.from, s.to);
        case 'checkbox':
          return (s.checked ? CHECKBOX_CHECKED : CHECKBOX_UNCHECKED).range(s.from, s.to);
        case 'rule':
          return RULE.range(s.from, s.to);
        case 'line':
          return LINES[s.style].range(s.from);
      }
    }),
    true
  );
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // PRD 006 §8: selection changes move the reveal; §13: viewport moves
      // recompute for the newly visible ranges; §11 (#55): a grid-set change
      // without a doc edit (a span dropped by the watcher, a width-only
      // refit) moves the excluded regions.
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

/**
 * PRD 006 §5/§7: the mousedown handler behind the only two widget
 * interactions. A modified (cmd/ctrl) click on a link span with an http(s)
 * URL hands the URL to `open`, mirroring the preview pane's managed-link
 * rule (SPEC11 §4); a plain click on a rendered task checkbox dispatches
 * the marker toggle as one transaction, so one undo restores it. Anything
 * else returns false and CodeMirror just places the cursor. Exported as a
 * factory so unit tests can assert the callback/URL and the dispatched
 * change without a browser.
 */
export function livePreviewMousedown(open: ((url: string) => void) | undefined) {
  return (
    event: {
      metaKey: boolean;
      ctrlKey: boolean;
      target: EventTarget | null;
      preventDefault(): void;
    },
    view?: {
      posAtDOM(node: Node): number;
      state: { doc: Text };
      dispatch(spec: {
        changes: { from: number; to: number; insert: string };
        userEvent: string;
      }): void;
    }
  ): boolean => {
    const target = event.target as {
      closest?: (selector: string) => { getAttribute(name: string): string | null } | null;
    } | null;
    if (!event.metaKey && !event.ctrlKey) {
      // PRD 006 §7: the widget's position in the view is the marker's
      // document offset, so the pure toggle validates it really is a
      // marker before any change dispatches.
      const box = target?.closest?.('.mm-lp-task');
      if (!box || !view) return false;
      const change = taskToggleChange(view.state.doc, view.posAtDOM(box as unknown as Node));
      if (!change) return false;
      event.preventDefault();
      view.dispatch({ changes: change, userEvent: 'input' });
      return true;
    }
    const url = target?.closest?.('.mm-lp-link')?.getAttribute('data-mm-lp-url') ?? '';
    if (!/^https?:\/\//i.test(url)) return false;
    event.preventDefault();
    open?.(url);
    return true;
  };
}

// PRD 006 §10: every painted color resolves from the theme's --mm-* tokens
// (same tokens/fallbacks the preview pane and the SPEC23 mm-md-* classes
// use in styles.css), so rendered constructs match the preview pane's look
// in light and dark themes alike.
const livePreviewTheme = EditorView.baseTheme({
  '.mm-lp-strong': { fontWeight: 'bold' },
  '.mm-lp-em': { fontStyle: 'italic' },
  '.mm-lp-strike': { textDecoration: 'line-through' },
  '.mm-lp-code': {
    fontFamily: 'var(--mm-font-mono, monospace)',
    color: 'var(--mm-code-fg, var(--mm-fg, #1f2328))',
    backgroundColor: 'var(--mm-code-bg, rgba(175, 184, 193, 0.2))',
    borderRadius: '3px',
  },
  // PRD 006 §4: per-level heading size/weight, on the theme's heading color.
  '.mm-lp-h1': { fontSize: '1.6em', fontWeight: 'bold', color: 'var(--mm-heading, var(--mm-fg, #1f2328))' },
  '.mm-lp-h2': { fontSize: '1.4em', fontWeight: 'bold', color: 'var(--mm-heading, var(--mm-fg, #1f2328))' },
  '.mm-lp-h3': { fontSize: '1.25em', fontWeight: 'bold', color: 'var(--mm-heading, var(--mm-fg, #1f2328))' },
  '.mm-lp-h4': { fontSize: '1.1em', fontWeight: 'bold', color: 'var(--mm-heading, var(--mm-fg, #1f2328))' },
  '.mm-lp-h5': { fontSize: '1em', fontWeight: 'bold', color: 'var(--mm-heading, var(--mm-fg, #1f2328))' },
  '.mm-lp-h6': { fontSize: '0.9em', fontWeight: 'bold', color: 'var(--mm-heading, var(--mm-fg, #1f2328))' },
  // PRD 006 §5/§10: link styling rides the theme's link/accent tokens.
  '.mm-lp-link': {
    color: 'var(--mm-link, var(--mm-accent, #0969da))',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  // PRD 006 §6: quote bar, list markers, and the drawn rule.
  '.mm-lp-quote': {
    borderLeft: '3px solid var(--mm-blockquote-border, #d1d9e0)',
    paddingLeft: '8px',
    color: 'var(--mm-blockquote-fg, var(--mm-fg-muted, #57606a))',
  },
  '.mm-lp-list-num': { color: 'var(--mm-accent, #0969da)' },
  '.mm-lp-bullet': { color: 'var(--mm-accent, #0969da)' },
  // PRD 006 §7: the task checkbox rides the theme accent like other marks.
  '.mm-lp-task': {
    cursor: 'pointer',
    accentColor: 'var(--mm-accent, #0969da)',
    verticalAlign: 'middle',
    margin: '0',
  },
  '.mm-lp-hr': {
    display: 'inline-block',
    width: '100%',
    verticalAlign: 'middle',
    borderTop: '1px solid var(--mm-hr, var(--mm-border, #d0d7de))',
  },
});

/** PRD 006 §5: host hand-offs the extension needs from the component layer. */
export interface LivePreviewOptions {
  /**
   * Receives the URL of a cmd/ctrl-clicked link. Editor.tsx wires this to
   * `platform.openExternal` (PRD 006 §5), the same hand-off the preview
   * pane uses; src/lib/ stays platform-free. Omitted → rendered links are
   * inert.
   */
  openExternal?: (url: string) => void;
}

/**
 * PRD 006 §3–§8 (issues #47/#48/#49): the live-preview extension factory.
 * The shipped app includes it from Editor.tsx while the
 * "Live preview (experimental)" setting is on (PRD 006 §1, #50).
 */
export function livePreviewExtension(options: LivePreviewOptions = {}): Extension {
  return [
    livePreviewPlugin,
    EditorView.domEventHandlers({ mousedown: livePreviewMousedown(options.openExternal) }),
    livePreviewTheme,
  ];
}
