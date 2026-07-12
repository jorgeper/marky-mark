import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  type DecorationSet,
} from '@codemirror/view';
import { Compartment, EditorState, Prec, RangeSetBuilder } from '@codemirror/state';
import {
  cursorCharLeft,
  cursorCharRight,
  cursorDocEnd,
  cursorDocStart,
  cursorGroupBackward,
  cursorGroupForward,
  cursorLineDown,
  cursorLineEnd,
  cursorLineStart,
  cursorLineUp,
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
} from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown } from '@codemirror/lang-markdown';
import { VimEditResolver, type VimEditAction } from '../lib/vimnav';
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
  /**
   * SPEC20 §2: called with the image files of an intercepted paste; resolves
   * to the markdown to insert at the cursor, or null when nothing should be
   * inserted (unsaved doc, unsupported platform, write failure — the owner
   * has already shown its notice). The file write is not undoable; the
   * inserted text is.
   */
  onPasteImages?(files: File[]): Promise<string | null>;
  /** Imperative insert-at-cursor for menu-driven insertions (Insert Image…). */
  insertRef?: MutableRefObject<((text: string) => void) | null>;
  /** SPEC23 §3: markdown syntax highlighting (live-reconfigured, no remount). */
  syntax: boolean;
  /** SPEC23 §2: the vimNav setting — off ⇒ Esc stays inert, zero new behavior. */
  vimNav: boolean;
  /** SPEC23 §2/§4: nav-mode transitions (badge is internal; this feeds the seam). */
  onVimModeChange?(nav: boolean): void;
  /** SPEC23 §4 + SPEC24 §1: cursor/selection reports — the seam, and the
   * reverse mirror (which acts only on focused, non-collapsed reports). */
  onEditState?(s: {
    head: number;
    headLine: number;
    selFrom: number;
    selTo: number;
    selText: string;
    focused: boolean;
  }): void;
  /**
   * SPEC23 §1: imperative select-source-range for mirrored preview
   * selections — sets the CM selection and scrolls it into view WITHOUT
   * focusing the editor (the preview selection must survive).
   */
  selectRangeRef?: MutableRefObject<((from: number, to: number) => void) | null>;
  /**
   * SPEC25 §1: a selection carried across a mode switch — consumed once at
   * mount, applied AFTER the parked-history restore so it wins over the
   * parked selection, then cleared.
   */
  pendingSelectionRef?: MutableRefObject<{ from: number; to: number } | null>;
}

/**
 * SPEC23 §3: Lezer tags → mm-md-* classes; colors/weights live in styles.css
 * on theme CSS variables, so every theme drives the palette untouched.
 */
const mmHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'mm-md-h1' },
  { tag: tags.heading2, class: 'mm-md-h2' },
  { tag: tags.heading3, class: 'mm-md-h3' },
  { tag: tags.heading4, class: 'mm-md-h4' },
  { tag: tags.heading5, class: 'mm-md-h5' },
  { tag: tags.heading6, class: 'mm-md-h6' },
  { tag: tags.emphasis, class: 'mm-md-em' },
  { tag: tags.strong, class: 'mm-md-strong' },
  { tag: tags.monospace, class: 'mm-md-code' },
  { tag: tags.link, class: 'mm-md-link' },
  { tag: tags.url, class: 'mm-md-url' },
  { tag: tags.quote, class: 'mm-md-quote' },
  { tag: tags.strikethrough, class: 'mm-md-strike' },
  { tag: tags.contentSeparator, class: 'mm-md-hr' },
  // HeaderMark/QuoteMark/ListMark/LinkMark/EmphasisMark/CodeMark — the
  // markdown punctuation itself, rendered dimmed.
  { tag: tags.processingInstruction, class: 'mm-md-mark' },
]);

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

/** SPEC23 §2: Ctrl+d/u — half the viewport, cursor moves, view centers on it. */
function halfPage(view: EditorView, dir: 1 | -1): void {
  const count = Math.max(1, Math.round(view.scrollDOM.clientHeight / view.defaultLineHeight / 2));
  const doc = view.state.doc;
  const cur = doc.lineAt(view.state.selection.main.head).number;
  const pos = doc.line(Math.min(doc.lines, Math.max(1, cur + dir * count))).from;
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
}

const VIM_MOTIONS: Partial<Record<VimEditAction, (view: EditorView) => void>> = {
  left: (v) => void cursorCharLeft(v),
  right: (v) => void cursorCharRight(v),
  down: (v) => void cursorLineDown(v),
  up: (v) => void cursorLineUp(v),
  wordFwd: (v) => void cursorGroupForward(v),
  wordBack: (v) => void cursorGroupBackward(v),
  lineStart: (v) => void cursorLineStart(v),
  lineEnd: (v) => void cursorLineEnd(v),
  top: (v) => void cursorDocStart(v),
  bottom: (v) => void cursorDocEnd(v),
  halfDown: (v) => halfPage(v, 1),
  halfUp: (v) => halfPage(v, -1),
};

export default function Editor({
  value,
  lineNumbers: showLineNumbers,
  onChange,
  historyRef,
  syncRef,
  diff,
  onPasteImages,
  insertRef,
  syntax,
  vimNav,
  onVimModeChange,
  onEditState,
  selectRangeRef,
  pendingSelectionRef,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const gutterComp = useRef(new Compartment());
  const diffComp = useRef(new Compartment());
  const syntaxComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPasteImagesRef = useRef(onPasteImages);
  onPasteImagesRef.current = onPasteImages;
  // SPEC23 §2: modal vim state — per mount, starts in typing mode.
  const [navMode, setNavMode] = useState(false);
  const vimResolver = useRef(new VimEditResolver());
  const vimNavRef = useRef(vimNav);
  vimNavRef.current = vimNav;
  const onVimModeChangeRef = useRef(onVimModeChange);
  onVimModeChangeRef.current = onVimModeChange;
  const onEditStateRef = useRef(onEditState);
  onEditStateRef.current = onEditState;

  const setNav = (nav: boolean) => {
    setNavMode(nav);
    onVimModeChangeRef.current?.(nav);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions = [
      gutterComp.current.of(showLineNumbers ? lineNumbers() : []),
      diffComp.current.of([]),
      // SPEC23 §3: highlighting rides a compartment — toggling the setting
      // reconfigures live, undo history intact.
      syntaxComp.current.of(syntax ? syntaxHighlighting(mmHighlight) : []),
      history(),
      highlightActiveLine(),
      // SPEC23 §1: CM-drawn selection so a mirrored range shows while the
      // editor is unfocused (styled via .cm-selectionBackground).
      drawSelection(),
      markdown(),
      EditorView.lineWrapping,
      // SPEC23 §2: the vim modal layer runs ahead of every keymap. Gated on
      // the setting; typing mode passes everything through untouched.
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (e, view) => {
            if (!vimNavRef.current) return false;
            if (e.isComposing || e.keyCode === 229) return false; // IME untouched
            const action = vimResolver.current.resolve(
              { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey },
              performance.now()
            );
            if (action === 'passthrough') return false;
            e.preventDefault();
            if (action === 'enterNav') setNav(true);
            else if (action === 'exitNav') setNav(false);
            else if (action !== 'inert') VIM_MOTIONS[action]?.(view);
            return true;
          },
        })
      ),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        if ((u.selectionSet || u.docChanged) && onEditStateRef.current) {
          const main = u.state.selection.main;
          onEditStateRef.current({
            head: main.head,
            headLine: u.state.doc.lineAt(main.head).number,
            selFrom: main.from,
            selTo: main.to,
            selText: u.state.sliceDoc(main.from, main.to),
            focused: u.view.hasFocus,
          });
        }
      }),
      // SPEC20 §2: a paste carrying image files is intercepted whole (mixed
      // clipboards: the image wins); text-only pastes take the default path.
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const handler = onPasteImagesRef.current;
          if (!handler) return false;
          const files = Array.from(event.clipboardData?.items ?? [])
            .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
            .map((it) => it.getAsFile())
            .filter((f): f is File => f !== null);
          if (files.length === 0) return false;
          event.preventDefault();
          void handler(files).then((text) => {
            if (!text) return;
            const { from, to } = view.state.selection.main;
            view.dispatch({
              changes: { from, to, insert: text },
              selection: { anchor: from + text.length },
            });
          });
          return true;
        },
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

    // SPEC25 §1: apply a carried selection (beats the parked-history one).
    if (pendingSelectionRef?.current) {
      const { from, to } = pendingSelectionRef.current;
      pendingSelectionRef.current = null;
      const len = view.state.doc.length;
      const a = Math.max(0, Math.min(from, len));
      const b = Math.max(a, Math.min(to, len));
      view.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) });
    }

    if (insertRef) {
      insertRef.current = (text) => {
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
        view.focus();
      };
    }

    // SPEC23 §1: mirrored selection entry point — no focus() here, ever.
    if (selectRangeRef) {
      selectRangeRef.current = (from, to) => {
        const len = view.state.doc.length;
        const a = Math.max(0, Math.min(from, len));
        const b = Math.max(a, Math.min(to, len));
        view.dispatch({
          selection: { anchor: a, head: b },
          effects: EditorView.scrollIntoView(a, { y: 'center' }),
        });
      };
    }

    // SPEC23 §4: seed the seam with the mount-time cursor.
    if (onEditStateRef.current) {
      const main = view.state.selection.main;
      onEditStateRef.current({
        head: main.head,
        headLine: view.state.doc.lineAt(main.head).number,
        selFrom: main.from,
        selTo: main.to,
        selText: view.state.sliceDoc(main.from, main.to),
        focused: view.hasFocus,
      });
    }

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
      if (insertRef) insertRef.current = null;
      if (selectRangeRef) selectRangeRef.current = null;
      onVimModeChangeRef.current?.(false); // a remount always re-enters typing mode
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

  // SPEC23 §3: live highlight toggle — same compartment pattern as the gutter.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: syntaxComp.current.reconfigure(syntax ? syntaxHighlighting(mmHighlight) : []),
    });
  }, [syntax]);

  // SPEC23 §2: turning the setting off mid-session drops out of nav mode.
  useEffect(() => {
    if (!vimNav) {
      vimResolver.current.reset();
      setNavMode(false);
      onVimModeChangeRef.current?.(false);
    }
  }, [vimNav]);

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

  return (
    <div className="editor-wrap" data-testid="editor" ref={hostRef}>
      {navMode && (
        <div className="vim-badge" data-testid="vim-badge" aria-live="polite">
          NAV
        </div>
      )}
    </div>
  );
}
