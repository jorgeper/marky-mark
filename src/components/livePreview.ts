/**
 * PRD 006 §3/§8/§9 (issue #47): the live-preview CodeMirror extension —
 * DOM/view wiring over the pure decoration core in src/lib/livePreview.ts.
 *
 * Internal flag, not a setting: the extension activates only where a caller
 * includes `livePreviewExtension()` in its extension list. Nothing in the
 * shipped app references it yet — the settings toggle and Editor wiring land
 * in the final sub-issue (#50) — so the edit pane behaves exactly as today.
 */
import { ViewPlugin, Decoration, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { computeLivePreviewDecos, type InlineStyle } from '../lib/livePreview';

/** PRD 006 §3: one mark per inline style; colors/weights ride the theme. */
const MARKS: Record<InlineStyle, Decoration> = {
  strong: Decoration.mark({ class: 'mm-lp-strong' }),
  emphasis: Decoration.mark({ class: 'mm-lp-em' }),
  strikethrough: Decoration.mark({ class: 'mm-lp-strike' }),
  'inline-code': Decoration.mark({ class: 'mm-lp-code' }),
};

/** PRD 006 §3/§9: markers vanish visually; the text underneath stays. */
const HIDE = Decoration.replace({});

function buildDecorations(view: EditorView): DecorationSet {
  // PRD 006 §13: decorations are computed for the visible ranges only.
  const specs = computeLivePreviewDecos(view.state, view.visibleRanges);
  return Decoration.set(
    specs.map((s) => (s.deco === 'hide' ? HIDE : MARKS[s.style]).range(s.from, s.to)),
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
      // recompute for the newly visible ranges.
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

const livePreviewTheme = EditorView.baseTheme({
  '.mm-lp-strong': { fontWeight: 'bold' },
  '.mm-lp-em': { fontStyle: 'italic' },
  '.mm-lp-strike': { textDecoration: 'line-through' },
  '.mm-lp-code': { fontFamily: 'var(--mm-font-mono, monospace)' },
});

/**
 * PRD 006 §3/§8 (issue #47): the live-preview extension factory — the
 * internal opt-in flag. Callers that want live preview include this in
 * their extension list; the app as shipped never does.
 */
export function livePreviewExtension(): Extension {
  return [livePreviewPlugin, livePreviewTheme];
}
