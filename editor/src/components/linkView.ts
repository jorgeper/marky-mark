/**
 * SPEC43 §11 (issue #270): the rendered-links view — view wiring over the
 * pure span core in src/lib/linkSpans.ts, following the codeBlockView
 * plugin's shape. A collapsed link shows just its text, styled through the
 * `--mm-link` token (styles.css `.mm-link-view`) with the URL as a `title`
 * tooltip; Decoration.replace hides the syntax. Nothing here ever changes
 * text, history or the dirty state. Editor.tsx includes the extension in a
 * compartment while the `linkView` setting is on AND live preview is off —
 * the PRD 006 §5 live preview already collapses the same ranges, so exactly
 * one of the two paints a link and no range hides twice.
 *
 * The open-link entry points (the modifier-click factory and the modifier
 * cursor cue) live here too but are installed UNCONDITIONALLY — a ⌘/Ctrl
 * click must open a link in the raw view as well, so resolution goes through
 * the document offset under the pointer (posAtCoords → linkAt), never a DOM
 * attribute that only exists while the view is on.
 */
import {
  ViewPlugin,
  Decoration,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { EditorState, Extension } from '@codemirror/state';
import { computeLinkViews, linkAt } from '../lib/linkSpans';
import { tableModeField } from './tableMode';

/** The link-syntax characters vanish visually; the text underneath stays. */
const HIDE = Decoration.replace({});

function buildDecorations(view: EditorView): DecorationSet {
  // Grid exclusion, like codeBlockView: gridded spans keep their own geometry.
  const grid = view.state.field(tableModeField, false);
  const links = computeLinkViews(view.state, view.visibleRanges, grid?.spans ?? []);
  const ranges = [];
  for (const link of links) {
    if (link.revealed) continue; // shows raw, in place — nothing to paint
    for (const h of link.hide) ranges.push(HIDE.range(h.from, h.to));
    if (link.text.from < link.text.to) {
      ranges.push(
        Decoration.mark({ class: 'mm-link-view', attributes: { title: link.url } }).range(
          link.text.from,
          link.text.to
        )
      );
    }
  }
  // Sorted here (not by push order), so the hide spans need no ordering.
  return Decoration.set(ranges, true);
}

/** The rendered-links bundle Editor.tsx mounts while `linkView` is on. */
export function linkViewExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        // Selection moves drive the caret-reveal; viewport moves cover parse
        // progress on fresh content; a grid-set change without a doc edit
        // moves the excluded regions (same triggers as codeBlockView).
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

/**
 * SPEC43 §11 (issue #270): the modifier-click entry point — a ⌘ (macOS) /
 * Ctrl click over a link's text hands the RAW href to `open`; the host
 * applies the preview's managed-link rule (SPEC11 §4), so a non-http href is
 * handed over, never swallowed here. Resolution goes through the document
 * offset under the pointer, so it works identically in raw and rendered
 * views. A plain click returns false and CodeMirror just places the caret
 * (the livePreviewMousedown factory shape, so the callback and URL are
 * assertable in a unit test without a browser).
 */
export function linkViewMousedown(open: ((url: string) => void) | undefined) {
  return (
    event: {
      metaKey: boolean;
      ctrlKey: boolean;
      clientX: number;
      clientY: number;
      preventDefault(): void;
    },
    view: {
      posAtCoords(coords: { x: number; y: number }): number | null;
      state: EditorState;
    }
  ): boolean => {
    if (!event.metaKey && !event.ctrlKey) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const link = linkAt(view.state, pos);
    if (!link) return false;
    event.preventDefault();
    open?.(link.url);
    return true;
  };
}

/** The class the modifier cue toggles on the editor's DOM (styles.css). */
export const LINK_MODIFIER_CLASS = 'mm-link-modifier';

/**
 * SPEC43 §11 (issue #270): the pointer-cursor cue — while ⌘/Ctrl is held the
 * editor root carries LINK_MODIFIER_CLASS, and styles.css turns the cursor
 * to a pointer over link text (raw `.mm-md-link` and rendered
 * `.mm-link-view` alike). Released on keyup AND on window blur, so the class
 * can never stick after the modifier is let go or focus leaves.
 */
export function linkModifierCue(): Extension {
  return ViewPlugin.fromClass(
    class {
      /** The window the listeners live on — kept so destroy() can detach them. */
      readonly win: (Window & typeof globalThis) | null;

      constructor(readonly view: EditorView) {
        this.win = view.dom.ownerDocument.defaultView;
        this.win?.addEventListener('keydown', this.onKey);
        this.win?.addEventListener('keyup', this.onKey);
        this.win?.addEventListener('blur', this.onBlur);
      }

      onKey = (e: KeyboardEvent) => {
        this.view.dom.classList.toggle(LINK_MODIFIER_CLASS, e.metaKey || e.ctrlKey);
      };
      onBlur = () => {
        this.view.dom.classList.remove(LINK_MODIFIER_CLASS);
      };
      destroy() {
        this.win?.removeEventListener('keydown', this.onKey);
        this.win?.removeEventListener('keyup', this.onKey);
        this.win?.removeEventListener('blur', this.onBlur);
        this.view.dom.classList.remove(LINK_MODIFIER_CLASS);
      }
    }
  );
}

/**
 * The always-on open-link bundle (mousedown + modifier cue). `open` is read
 * per call so a host callback that changes identity never rebuilds this.
 */
export function linkOpenExtension(open: () => ((url: string) => void) | undefined): Extension {
  return [
    EditorView.domEventHandlers({
      mousedown: (event, view) => linkViewMousedown(open())(event, view),
    }),
    linkModifierCue(),
  ];
}
