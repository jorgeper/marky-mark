import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  Decoration,
  drawSelection,
  EditorView,
  gutter,
  GutterMarker,
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
  isolateHistory,
} from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, searchPanelOpen, SearchQuery, setSearchQuery } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { markdown } from '@codemirror/lang-markdown';
import { VimEditResolver, type VimEditAction } from '../lib/vimnav';
import type { DiffLineSets } from '../lib/diffLines';
import { displayCombo, type HotkeyMap } from '../lib/hotkeys';
import {
  buildSmartMenu,
  detectContext,
  insertCallout,
  insertHr,
  setHeading,
  SMART_EDIT_NAME,
  toggleCodeBlock,
  toggleInline,
  toggleList,
  toggleQuote,
  wrapLink,
  type CalloutKind,
  type EditResult,
  type SmartMenuEntry,
} from '../lib/smartEdit';
import { SmartEditMenu } from './SmartEditMenu';
import {
  cellAt,
  cellContentSpan,
  deleteCol,
  deleteRow,
  deleteTableAt,
  insertCol,
  insertRow,
  insertTableAt,
  normalizeWithCursor,
  parseTable,
  tableRegionAt,
  type TableEdit,
} from '../lib/tableEdit';
import { setTableMode, tableModeExtension, tableModeField } from './tableMode';

/** SPEC36 §5.2: the ops the App's format commands drive (menu ids, same set). */
export type SmartFormatOp =
  | 'bold' | 'italic' | 'strike' | 'code' | 'link'
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'bullet' | 'numbered' | 'task'
  | 'quote' | 'code-block' | 'hr';

export interface SmartEditHandle {
  applyFormat(op: SmartFormatOp): void;
  openSmartMenu(): void;
}

/**
 * SPEC15 §3.2: the imperative surface split scroll-sync needs — fractional
 * top line in/out plus a user-scroll subscription. Built on CodeMirror
 * line-block geometry so wrapped lines measure for real.
 */
/**
 * SPEC30 §1.4: the FindBar's edit-mode engine — a thin imperative shell over
 * @codemirror/search (CM's own panel and keymap are never enabled; the app's
 * one bar drives both modes). Counts are recomputed per call: cheap at the
 * document sizes this app targets.
 */
export interface EditorSearchHandle {
  /** Install the query (live); advance=false refreshes without moving. */
  setQuery(query: string, replace: string, advance?: boolean): { count: number; current: number };
  next(): { count: number; current: number };
  prev(): { count: number; current: number };
  /** Replace the current match, advance. */
  replaceOne(): { count: number; current: number };
  /** Replace every match; returns how many. */
  replaceAllMatches(): number;
  clear(): void;
}

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
  /** SPEC30 §1.4: populated at mount with the find/replace engine. */
  searchRef?: MutableRefObject<EditorSearchHandle | null>;
  // --- SPEC36: Smart Edit ---------------------------------------------------
  /** Current bindings — menu rows and the gutter tooltip follow rebinds live. */
  hotkeys: HotkeyMap;
  isMac: boolean;
  /** The readClipboardText seam exists (§4.6) — absent ⇒ Paste is omitted. */
  canPaste: boolean;
  /** Cut/Copy route the selection through the platform copyText seam. */
  onCopyText?(text: string): void;
  /** Paste reads through the seam; resolves null when unavailable/failed. */
  onReadClipboard?(): Promise<string | null>;
  /** SPEC36 §5.2: populated at mount with applyFormat/openSmartMenu. */
  smartRef?: MutableRefObject<SmartEditHandle | null>;
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

/**
 * SPEC36 §3: the gutter button — the Marky Mark hash (the FolderPanel
 * slanted-top-bar geometry) at 18px, rendered on the selection head's line
 * only. A real <button> so it is clickable and titled.
 */
const HASH_SVG =
  '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">' +
  '<g stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round">' +
  '<line x1="5.6" y1="2.6" x2="5.6" y2="13.4" />' +
  '<line x1="10.4" y1="2.6" x2="10.4" y2="13.4" />' +
  '<line x1="2.6" y1="6.7" x2="13.4" y2="5" />' +
  '<line x1="2.6" y1="10.2" x2="13.4" y2="10.2" />' +
  '</g></svg>';

class SmartGutterMarker extends GutterMarker {
  constructor(private title: string) {
    super();
  }
  eq(other: SmartGutterMarker) {
    return other.title === this.title;
  }
  toDOM() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'smart-gutter-btn';
    btn.setAttribute('data-testid', 'smart-edit-gutter');
    btn.title = this.title;
    btn.innerHTML = HASH_SVG;
    return btn;
  }
}

/** The cursor-line-only gutter; clicks on the button open the menu. */
function smartGutter(title: string, onOpen: (view: EditorView, rect: DOMRect) => void) {
  const marker = new SmartGutterMarker(title);
  return gutter({
    class: 'mm-smart-gutter',
    lineMarker(view, line) {
      const head = view.state.doc.lineAt(view.state.selection.main.head);
      return line.from === head.from ? marker : null;
    },
    lineMarkerChange: (u) => u.selectionSet || u.docChanged,
    domEventHandlers: {
      mousedown(view, _line, event) {
        const btn = (event.target as HTMLElement).closest?.('.smart-gutter-btn');
        if (!btn) return false;
        event.preventDefault();
        onOpen(view, btn.getBoundingClientRect());
        return true;
      },
    },
  });
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
  searchRef,
  hotkeys,
  isMac,
  canPaste,
  onCopyText,
  onReadClipboard,
  smartRef,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const gutterComp = useRef(new Compartment());
  const diffComp = useRef(new Compartment());
  const syntaxComp = useRef(new Compartment());
  const smartComp = useRef(new Compartment());
  // SPEC36 §4: the Smart Edit menu — open state + anchor + the built model.
  const [smartMenu, setSmartMenu] = useState<{ x: number; y: number; entries: SmartMenuEntry[] } | null>(null);
  // SPEC37 §4: the margin chips for the cursor's cell (null = hidden).
  const [chips, setChips] = useState<{
    colLeft: { x: number; y: number };
    colRight: { x: number; y: number };
    colDel: { x: number; y: number };
    colDelDisabled: boolean;
    rowAbove: { x: number; y: number } | null;
    rowBelow: { x: number; y: number };
    rowDel: { x: number; y: number } | null;
  } | null>(null);
  const chipsRaf = useRef(0);
  const smartPropsRef = useRef({ hotkeys, isMac, canPaste, onCopyText, onReadClipboard });
  smartPropsRef.current = { hotkeys, isMac, canPaste, onCopyText, onReadClipboard };
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

  // --- SPEC36: Smart Edit ----------------------------------------------------
  const gutterTitle = () =>
    `${SMART_EDIT_NAME} (${displayCombo(smartPropsRef.current.hotkeys.smartMenu, smartPropsRef.current.isMac)})`;

  /** §6.2: context is computed fresh at open time — never stale offsets. */
  const openMenuAt = (x: number, y: number) => {
    const view = viewRef.current;
    if (!view) return;
    const sp = smartPropsRef.current;
    const sel = view.state.selection.main;
    const flags = detectContext(view.state.doc.toString(), sel.head);
    setSmartMenu({
      x,
      y,
      entries: buildSmartMenu({
        table: flags.table,
        image: flags.image,
        hasSelection: sel.from < sel.to,
        canPaste: sp.canPaste,
        hotkeys: sp.hotkeys,
        isMac: sp.isMac,
      }),
    });
  };

  /** §2: apply an EditResult as ONE transaction — a single undo step. */
  const applySplice = (view: EditorView, r: EditResult) => {
    const old = view.state.doc.toString();
    const minLen = Math.min(old.length, r.text.length);
    let p = 0;
    while (p < minLen && old[p] === r.text[p]) p++;
    let s = 0;
    while (s < minLen - p && old[old.length - 1 - s] === r.text[r.text.length - 1 - s]) s++;
    view.dispatch({
      changes: { from: p, to: old.length - s, insert: r.text.slice(p, r.text.length - s) },
      selection: { anchor: r.from, head: r.to },
      scrollIntoView: true,
      // One action = one undo step: never merge with neighboring history.
      annotations: isolateHistory.of('full'),
    });
  };

  const runFormat = (view: EditorView, id: string): void => {
    const text = view.state.doc.toString();
    const { from, to } = view.state.selection.main;
    let r: EditResult | null = null;
    if (id === 'bold' || id === 'italic' || id === 'strike' || id === 'code') {
      r = toggleInline(text, from, to, id);
    } else if (id === 'link') {
      r = wrapLink(text, from, to);
    } else if (/^h[1-6]$/.test(id)) {
      r = setHeading(text, from, to, Number(id[1]) as 1 | 2 | 3 | 4 | 5 | 6);
    } else if (id === 'bullet' || id === 'numbered' || id === 'task') {
      r = toggleList(text, from, to, id);
    } else if (id === 'quote') {
      r = toggleQuote(text, from, to);
    } else if (id === 'note' || id === 'tip' || id === 'important' || id === 'warning' || id === 'caution') {
      r = insertCallout(text, from, to, id as CalloutKind);
    } else if (id === 'code-block') {
      r = toggleCodeBlock(text, from, to);
    } else if (id === 'hr') {
      r = insertHr(text, from, to);
    } else if (id === 'insert-table') {
      // SPEC37 §2.2: the starter table, blank-line managed like insertHr.
      r = insertTableAt(text, from);
    } else if (id === 'delete-table') {
      // SPEC37 §2.2: splice the table region out (null when not in one).
      r = deleteTableAt(text, from);
    }
    if (r) applySplice(view, r);
  };

  // SPEC37 §2.3/§3.2: Edit Table… toggles aligned table mode. Entry is one
  // normalizeWithCursor splice (cursor kept in its logical cell).
  const toggleTableMode = (view: EditorView) => {
    const text = view.state.doc.toString();
    const head = view.state.selection.main.head;
    const region = tableRegionAt(text, head);
    const cur = view.state.field(tableModeField);
    if (cur && region && cur.from === region.start) {
      view.dispatch({ effects: setTableMode.of(null) });
      return;
    }
    if (!region) return;
    const n = normalizeWithCursor(text, region, head);
    view.dispatch({
      ...(n.text !== text
        ? { changes: { from: region.start, to: region.end, insert: n.text.slice(n.start, n.end) } }
        : {}),
      selection: { anchor: n.head },
      effects: setTableMode.of({ from: n.start, to: n.end }),
      annotations: isolateHistory.of('full'),
      scrollIntoView: true,
    });
  };

  // SPEC37 §4.2: a chip action — one op, one splice, one undo step; the
  // cursor lands in the inserted column/row's first cell (clamped after a
  // delete). The result is already aligned, so the live filter stays quiet.
  const runChipOp = (kind: 'col-left' | 'col-right' | 'col-del' | 'row-above' | 'row-below' | 'row-del') => {
    const view = viewRef.current;
    if (!view) return;
    const span = view.state.field(tableModeField);
    if (!span) return;
    const text = view.state.doc.toString();
    const region = { start: span.from, end: span.to };
    const c = cellAt(text, region, view.state.selection.main.head);
    if (!c) return;
    const model = parseTable(text, region);
    let r: TableEdit | null = null;
    let target: { row: number; col: number } | null = null;
    if (kind === 'col-left') {
      r = insertCol(text, model, c.col);
      target = { row: -1, col: c.col };
    } else if (kind === 'col-right') {
      r = insertCol(text, model, c.col + 1);
      target = { row: -1, col: c.col + 1 };
    } else if (kind === 'col-del') {
      r = deleteCol(text, model, c.col);
      target = { row: c.row, col: Math.min(c.col, model.header.length - 2) };
    } else if (kind === 'row-above') {
      r = insertRow(text, model, Math.max(c.row, 0));
      target = { row: Math.max(c.row, 0), col: 0 };
    } else if (kind === 'row-below') {
      r = insertRow(text, model, c.row + 1);
      target = { row: c.row + 1, col: 0 };
    } else {
      r = deleteRow(text, model, c.row);
      target = { row: Math.min(c.row, model.rows.length - 2), col: c.col };
    }
    if (!r) return;
    const landing = cellContentSpan(r.text, { start: r.start, end: r.end }, target.row, target.col);
    view.dispatch({
      changes: { from: region.start, to: region.end, insert: r.text.slice(r.start, r.end) },
      selection: { anchor: landing ? landing.start : r.start },
      effects: setTableMode.of({ from: r.start, to: r.end }),
      annotations: isolateHistory.of('full'),
      scrollIntoView: true,
    });
    view.focus();
  };

  const invokeMenuItem = (id: string) => {
    const view = viewRef.current;
    setSmartMenu(null);
    if (!view) return;
    const sp = smartPropsRef.current;
    const sel = view.state.selection.main;
    // SPEC37 §2.3: Edit Table… toggles aligned table mode.
    // Resize Image… remains the SPEC36 no-op stub.
    if (id === 'edit-table') {
      toggleTableMode(view);
      view.focus();
      return;
    }
    if (id === 'resize-image') {
      view.focus();
      return;
    }
    if (id === 'cut' || id === 'copy') {
      const selText = view.state.sliceDoc(sel.from, sel.to);
      if (selText) sp.onCopyText?.(selText);
      if (id === 'cut' && sel.from < sel.to) {
        view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' }, selection: { anchor: sel.from } });
      }
      view.focus();
      return;
    }
    if (id === 'paste') {
      void sp.onReadClipboard?.().then((t) => {
        const v = viewRef.current;
        if (t == null || !v) return;
        const s = v.state.selection.main;
        v.dispatch({ changes: { from: s.from, to: s.to, insert: t }, selection: { anchor: s.from + t.length } });
        v.focus();
      });
      view.focus();
      return;
    }
    runFormat(view, id);
    view.focus();
  };

  const openMenuAtGutter = (_view: EditorView, rect: DOMRect) => openMenuAt(rect.right + 6, rect.top - 4);

  // SPEC37 §4.1: chip geometry — from CM coordinates, only while the cursor
  // is inside the active table's span. Any missing coordinate (line scrolled
  // out of the viewport) hides the chips until the next recompute.
  const computeChips = () => {
    const view = viewRef.current;
    const host = hostRef.current;
    const span = view?.state.field(tableModeField, false);
    if (!view || !host || !span) {
      setChips(null);
      return;
    }
    const head = view.state.selection.main.head;
    if (head < span.from || head > span.to) {
      setChips(null);
      return;
    }
    const text = view.state.doc.toString();
    const region = { start: span.from, end: span.to };
    const c = cellAt(text, region, head);
    const hCell = c ? cellContentSpan(text, region, -1, c.col) : null;
    if (!c || !hCell) {
      setChips(null);
      return;
    }
    const model = parseTable(text, region);
    const top = view.coordsAtPos(span.from);
    const left = view.coordsAtPos(hCell.start);
    const right = view.coordsAtPos(hCell.end);
    const line = view.state.doc.lineAt(head);
    const lineCo = view.coordsAtPos(line.from);
    if (!top || !left || !right || !lineCo) {
      setChips(null);
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const X = (v: number) => v - hostRect.left;
    const Y = (v: number) => v - hostRect.top;
    const isHeader = c.row === -1; // the delimiter row maps here too (§4.1)
    const topY = Y(top.top) - 22;
    setChips({
      colLeft: { x: X(left.left) - 22, y: topY },
      colRight: { x: X(right.right) + 4, y: topY },
      colDel: { x: (X(left.left) + X(right.right)) / 2 - 9, y: topY },
      colDelDisabled: model.header.length <= 1,
      rowAbove: isHeader ? null : { x: X(lineCo.left) - 24, y: Y(lineCo.top) - 9 },
      rowBelow: { x: X(lineCo.left) - 24, y: Y(lineCo.bottom) - 9 },
      rowDel: isHeader
        ? null
        : { x: X(lineCo.left) - 46, y: (Y(lineCo.top) + Y(lineCo.bottom)) / 2 - 9 },
    });
  };
  const computeChipsRef = useRef(computeChips);
  computeChipsRef.current = computeChips;
  const scheduleChips = () => {
    cancelAnimationFrame(chipsRaf.current);
    chipsRaf.current = requestAnimationFrame(() => computeChipsRef.current());
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions = [
      gutterComp.current.of(showLineNumbers ? lineNumbers() : []),
      // SPEC36 §3.2: after the line numbers, so it sits between them and the
      // text (and stands alone when they're hidden).
      smartComp.current.of(smartGutter(gutterTitle(), openMenuAtGutter)),
      diffComp.current.of([]),
      // SPEC23 §3: highlighting rides a compartment — toggling the setting
      // reconfigures live, undo history intact.
      syntaxComp.current.of(syntax ? syntaxHighlighting(mmHighlight) : []),
      // SPEC37 §3: aligned table mode. MUST precede the vim layer below —
      // both carry Prec.highest keydown handlers, and the first Esc has to
      // leave table mode before the next one can enter nav (§3.5).
      tableModeExtension(),
      history(),
      highlightActiveLine(),
      // SPEC23 §1: CM-drawn selection so a mirrored range shows while the
      // editor is unfocused (styled via .cm-selectionBackground).
      drawSelection(),
      // SPEC30 §1.4: match decorations only. The highlighter requires an
      // open panel, so ours is an invisible stub (no [main-field] ⇒ it never
      // steals focus); the app's FindBar is the real UI. No search keymap.
      search({
        createPanel: () => {
          const dom = document.createElement('div');
          dom.style.display = 'none';
          return { dom };
        },
      }),
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
        // SPEC37 §4: chips track cursor, edits, geometry, and mode changes
        // (effect-only transactions included) — raf-batched.
        scheduleChips();
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

    // SPEC36 §5.2: the App's format commands land here; the ref is null
    // outside edit mode, so every command is a silent no-op there.
    if (smartRef) {
      smartRef.current = {
        applyFormat: (op) => runFormat(view, op),
        openSmartMenu: () => {
          const c = view.coordsAtPos(view.state.selection.main.head);
          openMenuAt(c ? c.left : 80, c ? c.bottom + 4 : 80);
        },
      };
    }

    // SPEC30 §1.4: the find/replace engine.
    if (searchRef) {
      const stats = () => {
        const q = getSearchQuery(view.state);
        if (!q.search) return { count: 0, current: 0 };
        let count = 0;
        let current = 0;
        const sel = view.state.selection.main;
        const cursor = q.getCursor(view.state.doc) as Iterator<{ from: number; to: number }>;
        for (let r = cursor.next(); !r.done; r = cursor.next()) {
          count++;
          if (r.value.from === sel.from && r.value.to === sel.to) current = count;
        }
        return { count, current };
      };
      searchRef.current = {
        setQuery(query, replace, advance = true) {
          if (query && !searchPanelOpen(view.state)) openSearchPanel(view); // arms the highlighter
          view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive: false, literal: true, replace })),
          });
          if (query && advance) findNext(view); // land on the first match from the cursor
          return stats();
        },
        next() {
          findNext(view);
          return stats();
        },
        prev() {
          findPrevious(view);
          return stats();
        },
        replaceOne() {
          replaceNext(view);
          return stats();
        },
        replaceAllMatches() {
          const before = stats().count;
          replaceAll(view);
          return before;
        },
        clear() {
          view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
          if (searchPanelOpen(view.state)) closeSearchPanel(view);
        },
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

    // SPEC37 §4.1: chips also follow scroll and window resizes.
    const onChipScroll = () => scheduleChips();
    view.scrollDOM.addEventListener('scroll', onChipScroll);
    window.addEventListener('resize', onChipScroll);

    return () => {
      view.scrollDOM.removeEventListener('scroll', onChipScroll);
      window.removeEventListener('resize', onChipScroll);
      cancelAnimationFrame(chipsRaf.current);
      if (syncRef) syncRef.current = null;
      if (insertRef) insertRef.current = null;
      if (selectRangeRef) selectRangeRef.current = null;
      if (searchRef) searchRef.current = null;
      if (smartRef) smartRef.current = null;
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

  // SPEC36 §3.3: rebinding smartMenu retitles the gutter button immediately.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: smartComp.current.reconfigure(smartGutter(gutterTitle(), openMenuAtGutter)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeys.smartMenu, isMac]);

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
    <div
      className="editor-wrap"
      data-testid="editor"
      ref={hostRef}
      // SPEC36 §4.4: right-click opens the Smart Edit menu at the pointer —
      // the native menu is suppressed in the edit pane ONLY.
      onContextMenu={(e) => {
        e.preventDefault();
        openMenuAt(e.clientX, e.clientY);
      }}
    >
      {navMode && (
        <div className="vim-badge" data-testid="vim-badge" aria-live="polite">
          NAV
        </div>
      )}
      {smartMenu && (
        <SmartEditMenu
          x={smartMenu.x}
          y={smartMenu.y}
          entries={smartMenu.entries}
          onInvoke={invokeMenuItem}
          onClose={() => {
            setSmartMenu(null);
            viewRef.current?.focus();
          }}
        />
      )}
      {/* SPEC37 §4: the margin chips — overlay UI, never document text. */}
      {chips && (
        <div className="table-chip-layer" data-testid="table-chip-layer">
          <button
            className="table-chip"
            data-testid="table-add-col-left"
            style={{ left: chips.colLeft.x, top: chips.colLeft.y }}
            title="Insert column left"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runChipOp('col-left')}
          >
            +
          </button>
          <button
            className="table-chip"
            data-testid="table-add-col-right"
            style={{ left: chips.colRight.x, top: chips.colRight.y }}
            title="Insert column right"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runChipOp('col-right')}
          >
            +
          </button>
          <button
            className="table-chip danger"
            data-testid="table-del-col"
            style={{ left: chips.colDel.x, top: chips.colDel.y }}
            title="Delete column"
            disabled={chips.colDelDisabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runChipOp('col-del')}
          >
            ✕
          </button>
          {chips.rowAbove && (
            <button
              className="table-chip"
              data-testid="table-add-row-above"
              style={{ left: chips.rowAbove.x, top: chips.rowAbove.y }}
              title="Insert row above"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runChipOp('row-above')}
            >
              +
            </button>
          )}
          <button
            className="table-chip"
            data-testid="table-add-row-below"
            style={{ left: chips.rowBelow.x, top: chips.rowBelow.y }}
            title="Insert row below"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runChipOp('row-below')}
          >
            +
          </button>
          {chips.rowDel && (
            <button
              className="table-chip danger"
              data-testid="table-del-row"
              style={{ left: chips.rowDel.x, top: chips.rowDel.y }}
              title="Delete row"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runChipOp('row-del')}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
