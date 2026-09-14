// PRD 027 Req 12/13 (issue #366): the agent bridge's editor-side primitives —
// the ONE programmatic edit the bridge's four mutating tools land through,
// and the viewport measure its page scroll divides by. Both take the view
// (or the slice of it they read) as an argument so they are unit-tested
// in-package against a real CodeMirror history, and the imperative handles
// in `Editor.tsx` (`SmartEditHandle.replaceRange`,
// `EditorSyncHandle.viewportLines`) are one-line adapters over them.
import { isolateHistory } from '@codemirror/commands';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { gridSeamOf } from './tableMode';

/**
 * The slice of an `EditorView` a bridge edit touches: the state it reads and
 * the dispatch it lands through. An `EditorView` satisfies it as is.
 */
export interface BridgeEditTarget {
  readonly state: EditorState;
  dispatch(spec: TransactionSpec): void;
}

/**
 * PRD 027 Req 12 (issue #366): replace CANONICAL `[from, to)` with `text` as
 * ONE transaction annotated `isolateHistory.of('full')` — the `applySplice`
 * precedent — so a single undo reverts the whole tool call and nothing else
 * (it never merges with the user's typing on either side). The caret lands
 * at the end of the inserted text (typing semantics); the range is revealed;
 * the view is NEVER focused (the agent's edit must not steal the user's
 * focus — `insertRef` does, which is why the bridge does not reuse it).
 *
 * SPEC40 §2 (issue #357): `from`/`to` are the host's canonical offsets; both
 * ends cross the grid seam before the dispatch (the `selectSourceRange`
 * precedent), then clamp into the document — a stale offset can never throw.
 * Returns the raw range the edit replaced and the caret it left.
 */
export function bridgeReplaceRange(
  view: BridgeEditTarget,
  from: number,
  to: number,
  text: string
): { from: number; to: number; caret: number } {
  const len = view.state.doc.length;
  const seam = gridSeamOf(view.state);
  const a = seam.canonicalToDisplay(Math.min(from, to));
  const b = seam.canonicalToDisplay(Math.max(from, to));
  // Re-ordered after the crossing: the seam's snaps are not guaranteed monotone.
  const start = Math.max(0, Math.min(Math.min(a, b), len));
  const end = Math.max(start, Math.min(Math.max(a, b), len));
  const caret = start + text.length;
  view.dispatch({
    changes: { from: start, to: end, insert: text },
    selection: { anchor: caret, head: caret },
    scrollIntoView: true,
    // One tool call = one undo step: never merge with neighbouring history.
    annotations: isolateHistory.of('full'),
  });
  return { from: start, to: end, caret };
}

/**
 * PRD 027 Req 13 (issue #366): how many whole lines the viewport shows —
 * the bridge's page unit for `scroll` by pages. Measured off the scroller's
 * height and the view's default line height (the `halfPage` precedent);
 * never below 1, so an unmeasured or collapsed view still pages by
 * something rather than by nothing.
 */
export function viewportLineCount(view: Pick<EditorView, 'scrollDOM' | 'defaultLineHeight'>): number {
  const height = view.scrollDOM.clientHeight;
  const lineHeight = view.defaultLineHeight;
  if (!(height > 0) || !(lineHeight > 0)) return 1;
  return Math.max(1, Math.floor(height / lineHeight));
}
