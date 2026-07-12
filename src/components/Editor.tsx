import { useEffect, useRef, type MutableRefObject } from 'react';
import { Decoration, EditorView, keymap, lineNumbers, highlightActiveLine, type DecorationSet } from '@codemirror/view';
import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state';
import { defaultKeymap, history, historyField, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import type { DiffLineSets } from '../lib/diffLines';

/**
 * SPEC15 §3.2: the imperative surface split scroll-sync needs — fractional
 * top line in/out plus a user-scroll subscription. Built on CodeMirror
 * line-block geometry so wrapped lines measure for real.
 */
export interface EditorSyncHandle {
  /** Fractional 1-based source line at the top of the viewport. */
  topLine(): number;
  /** Scroll so the given fractional line sits at the top of the viewport. */
  scrollToLine(line: number): void;
  scrollInfo(): { top: number; max: number };
  setScrollTop(top: number): void;
  /** Subscribe to scroll events; returns the unsubscribe function. */
  onScroll(cb: () => void): () => void;
}

interface Props {
  value: string;
  /** Show the line-number gutter (SPEC3 §2, reconfigurable live). */
  lineNumbers: boolean;
  onChange(next: string): void;
  /** SPEC15 §3.2: populated on mount when the owner wants scroll sync. */
  syncRef?: MutableRefObject<EditorSyncHandle | null>;
  /** SPEC16 §2: changes-since-save line sets; null/undefined ⇒ no decorations. */
  diff?: DiffLineSets | null;
  /**
   * Undo history survival (SPEC7 §6): the serialized editor state (doc +
   * history) is parked here on unmount and revived on the next mount, so
   * toggling preview↔edit never loses undo. The owner resets it to null when
   * a different document opens.
   */
  historyRef: MutableRefObject<unknown>;
}

/**
 * CodeMirror 6 markdown editor. This module is loaded lazily (React.lazy) so
 * it costs nothing until the first toggle into edit mode (SPEC §2). Colors
 * come from the active theme's CSS variables via styles.css.
 */
const changedLine = Decoration.line({ class: 'mm-diff-changed' });
const deletedAfterLine = Decoration.line({ class: 'mm-diff-deleted-after' });

/** SPEC16 §2: line decorations for the changes-since-save tint. */
function diffDecorations(view: EditorView, diff: DiffLineSets): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const lines = view.state.doc.lines;
  const marks = new Map<number, Decoration>();
  for (const n of diff.deletedAfter) {
    const at = Math.min(Math.max(n, 1), lines); // deletion before line 1 clamps onto it
    marks.set(at, deletedAfterLine);
  }
  for (const n of diff.changed) if (n >= 1 && n <= lines) marks.set(n, changedLine);
  for (const n of [...marks.keys()].sort((a, b) => a - b)) {
    const from = view.state.doc.line(n).from;
    builder.add(from, from, marks.get(n)!);
  }
  return builder.finish();
}

export default function Editor({ value, lineNumbers: showLineNumbers, onChange, historyRef, syncRef, diff }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const gutterComp = useRef(new Compartment());
  const diffComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions = [
      gutterComp.current.of(showLineNumbers ? lineNumbers() : []),
      diffComp.current.of([]),
      history(),
      highlightActiveLine(),
      markdown(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString());
      }),
    ];
    let state: EditorState;
    try {
      state = historyRef.current
        ? EditorState.fromJSON(historyRef.current, { extensions }, { history: historyField })
        : EditorState.create({ doc: value, extensions });
    } catch {
      state = EditorState.create({ doc: value, extensions }); // stale/corrupt snapshot
    }
    const view = new EditorView({ state, parent: host });
    // The buffer may have moved on while parked in preview (file watcher,
    // discard) — converge on it as one undoable change.
    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
    viewRef.current = view;
    view.focus();

    if (syncRef) {
      const dom = view.scrollDOM;
      syncRef.current = {
        topLine() {
          const y = Math.max(dom.scrollTop - view.documentPadding.top, 0);
          const block = view.lineBlockAtHeight(y);
          const n = view.state.doc.lineAt(block.from).number;
          const frac = block.height > 0 ? Math.min(Math.max((y - block.top) / block.height, 0), 1) : 0;
          return n + frac;
        },
        scrollToLine(line) {
          // CM's own scrollIntoView iterates its height measurements until the
          // position truly sits at the viewport top — manual scrollTop math
          // over estimated block heights lands many lines off in long docs.
          const doc = view.state.doc;
          const n = Math.min(Math.max(Math.round(line), 1), doc.lines);
          view.dispatch({ effects: EditorView.scrollIntoView(doc.line(n).from, { y: 'start' }) });
        },
        scrollInfo() {
          return { top: dom.scrollTop, max: dom.scrollHeight - dom.clientHeight };
        },
        setScrollTop(top) {
          dom.scrollTop = top;
        },
        onScroll(cb) {
          dom.addEventListener('scroll', cb);
          return () => dom.removeEventListener('scroll', cb);
        },
      };
    }

    return () => {
      if (syncRef) syncRef.current = null;
      historyRef.current = view.state.toJSON({ history: historyField });
      view.destroy();
      viewRef.current = null;
    };
    // The view owns the buffer after mount; external value changes sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: gutterComp.current.reconfigure(showLineNumbers ? lineNumbers() : []),
    });
  }, [showLineNumbers]);

  // SPEC16 §2: swap the diff decorations in/out as the sets change.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: diffComp.current.reconfigure(
        diff ? EditorView.decorations.of((v) => diffDecorations(v, diff)) : []
      ),
    });
  }, [diff]);

  return <div className="editor-wrap" data-testid="editor" ref={hostRef} />;
}
