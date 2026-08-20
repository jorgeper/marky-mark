import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { Compartment, EditorState, Prec, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
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
import { HighlightStyle, LanguageDescription, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, searchPanelOpen, SearchQuery, setSearchQuery } from '@codemirror/search';
import { NodeProp } from '@lezer/common';
import { tags } from '@lezer/highlight';
import { markdown } from '@codemirror/lang-markdown';
// Issue #122: the three fenced-code languages the editor colours. All three
// already ship inside @codemirror/lang-markdown's own dependency tree; they
// are declared in package.json so the imports are honest, and no other
// language package is pulled in.
import { css as cssLanguage } from '@codemirror/lang-css';
import { html as htmlLanguage } from '@codemirror/lang-html';
import { javascript as jsLanguage } from '@codemirror/lang-javascript';
import { VimEditResolver, type VimEditAction } from '../lib/vimnav';
import type { CompiledPattern } from '../lib/searchCore';
import { mapOffsetByLineFlat, wordAt } from '../lib/activePosition';
import { intersectCodeSelection, type CodeRange } from '../lib/codeSelection';
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
import { codeBlockViewExtension } from './codeBlockView';
import { imageViewExtension, setImageView } from './imageView';
import { livePreviewExtension } from './livePreview';
import { allImageRefs, applyImageRewrite, deleteImageAt, type ImageRef } from '../lib/imageResize';

/** SPEC42 §1: the eight-chip ring — every border middle, every corner. */
type ImgChipId = 'l' | 't' | 'w' | 'h' | 'tl' | 'tr' | 'bl' | 'wh';
const IMG_CHIP_ORDER: readonly ImgChipId[] = ['tl', 't', 'tr', 'l', 'w', 'bl', 'h', 'wh'];
const IMG_CORNERS: ReadonlySet<ImgChipId> = new Set(['tl', 'tr', 'bl', 'wh']);
/** Outward-positive drag signs from the top-left anchor (0 = axis unused). */
const IMG_CHIP_X: Record<ImgChipId, number> = { l: -1, t: 0, w: 1, h: 0, tl: -1, tr: 1, bl: -1, wh: 1 };
const IMG_CHIP_Y: Record<ImgChipId, number> = { l: 0, t: -1, w: 0, h: 1, tl: 0, tr: 0, bl: 0, wh: 0 };
/** Ring positions (chip top-left offsets) for an image rect, host-relative. */
function chipRing(r: DOMRect, hostRect: DOMRect): Record<ImgChipId, { x: number; y: number }> {
  const HALF = 9; // chips are 18px — center them on the border points
  const x = (v: number) => v - hostRect.left - HALF;
  const y = (v: number) => v - hostRect.top - HALF;
  const midX = (r.left + r.right) / 2;
  const midY = (r.top + r.bottom) / 2;
  return {
    l: { x: x(r.left), y: y(midY) },
    t: { x: x(midX), y: y(r.top) },
    w: { x: x(r.right), y: y(midY) },
    h: { x: x(midX), y: y(r.bottom) },
    tl: { x: x(r.left), y: y(r.top) },
    tr: { x: x(r.right), y: y(r.top) },
    bl: { x: x(r.left), y: y(r.bottom) },
    wh: { x: x(r.right), y: y(r.bottom) },
  };
}

const IMG_CHIP_TITLES: Record<ImgChipId, string> = {
  l: 'Resize width',
  w: 'Resize width',
  t: 'Resize height',
  h: 'Resize height',
  tl: 'Resize, ratio locked — double-click for natural size',
  tr: 'Resize, ratio locked — double-click for natural size',
  bl: 'Resize, ratio locked — double-click for natural size',
  wh: 'Resize, ratio locked — double-click for natural size',
};
import {
  deleteTableAt,
  displayCellAt,
  displayCellBounds,
  displayPosOf,
  insertTableAt,
  layoutTable,
  parseDisplay,
  type ColAlign,
} from '../lib/tableEdit';
import {
  canonicalizeAll,
  canonicalizeDetected,
  collapseAllGrids,
  gridifyAll,
  setGridSet,
  tableModeExtension,
  tableModeField,
  type GridSpan,
} from './tableMode';

/** SPEC43 §5.2: the ops the App's format commands drive (menu ids, same set). */
export type SmartFormatOp =
  | 'bold' | 'italic' | 'strike' | 'code' | 'link'
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'bullet' | 'numbered' | 'task'
  | 'quote' | 'code-block' | 'hr';

export interface SmartEditHandle {
  applyFormat(op: SmartFormatOp): void;
  openSmartMenu(): void;
  /**
   * SPEC38 §3.5: the canonical view — identity when table mode is off; with
   * it on, the text with the display region collapsed to the compact table.
   * Every path where the buffer escapes the editor routes through this.
   */
  canonicalText(text: string): string;
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
  /**
   * Install the query (live); advance=false refreshes without moving.
   * PRD 014 Req 10 (issue #154): the query arrives as the compiled pattern
   * from `searchCore.compileQuery` — never a raw user string — so this
   * engine's matches are the same regex the preview and the Search view run.
   * `null` (or an empty source) clears.
   */
  setQuery(pattern: CompiledPattern | null, replace: string, advance?: boolean): { count: number; current: number };
  next(): { count: number; current: number };
  prev(): { count: number; current: number };
  /** Replace the current match, advance. */
  replaceOne(): { count: number; current: number };
  /** Replace every match; returns how many. */
  replaceAllMatches(): number;
  clear(): void;
}


// --- SPEC44 §2: the darker word-under-caret cue -------------------------------
const activeWordMark = Decoration.mark({ class: 'mm-active-word' });
export const setActiveWordSuppressed = StateEffect.define<boolean>();
function activeWordDeco(state: EditorState, sup: boolean): DecorationSet {
  const sel = state.selection.main;
  // A real selection (or find-bar focus) outranks the word cue (§2.2).
  if (sup || !sel.empty) return Decoration.none;
  const line = state.doc.lineAt(sel.head);
  const w = wordAt(line.text, sel.head - line.from);
  if (!w) return Decoration.none;
  return Decoration.set([activeWordMark.range(line.from + w.start, line.from + w.end)]);
}
const activeWordField = StateField.define<{ sup: boolean; deco: DecorationSet }>({
  // Derive from the state even at create time — a remount restored through
  // EditorState.fromJSON carries a selection but produces no transaction.
  create: (state) => ({ sup: false, deco: activeWordDeco(state, false) }),
  update(v, tr) {
    let sup = v.sup;
    let poked = false;
    for (const e of tr.effects) {
      if (e.is(setActiveWordSuppressed)) {
        sup = e.value;
        poked = true;
      }
    }
    if (!tr.selection && !tr.docChanged && !poked) return { sup, deco: v.deco.map(tr.changes) };
    return { sup, deco: activeWordDeco(tr.state, sup) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export interface EditorSyncHandle {
  /** Fractional 1-based source line at the top of the viewport. */
  topLine(): number;
  /** Scroll so the given fractional line sits at the top of the viewport. */
  scrollToLine(line: number): void;
  /**
   * PRD 012 Req 6: scroll to a 1-based source line AND place the caret on it —
   * the TOC's edit-mode jump. A sibling of `scrollToLine` rather than a flag on
   * it, so every existing scroll-only caller (mode-switch restore, split sync,
   * the heading palette) keeps moving the viewport and nothing else.
   */
  goToLine(line: number): void;
  scrollInfo(): { top: number; max: number };
  /** SPEC45: caret line's top in CONTENT coordinates (cue-anchored sync). */
  headTop(): number;
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
  /**
   * Issue #122: colour fenced code by language. Independent of `syntax` above
   * (that one is markdown highlighting) and live-reconfigured the same way.
   */
  codeSyntax: boolean;
  /** PRD 006 §1: live preview (experimental) — compartment-reconfigured live, no remount. */
  livePreview: boolean;
  /** PRD 006 §5: receives the URL of a cmd/ctrl-clicked rendered link (platform.openExternal). */
  onOpenExternal?(url: string): void;
  /** SPEC23 §2: the vimNav setting — off ⇒ Esc stays inert, zero new behavior. */
  vimNav: boolean;
  /** SPEC23 §2/§4: nav-mode transitions (badge is internal; this feeds the seam). */
  onVimModeChange?(nav: boolean): void;
  /** SPEC23 §4 + SPEC24 §1: cursor/selection reports — the seam, and the
   * reverse mirror (which acts only on focused, non-collapsed reports). */
  onEditState?(s: {
    /** SPEC44: head in CANONICAL text coordinates (grid whitespace mapped out). */
    canonHead: number;
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
  /**
   * PRD 007 Req 17: the pane accepts no edits — the document is open for
   * reading only, because the signed-in member holds no `doc.edit`. The
   * owner says WHY; this only stops the typing. Reconfigured live, so a
   * grant set that resolves after mount takes effect without remounting the
   * editor (and without losing undo history).
   */
  readOnly?: boolean;
  /** SPEC44 §2.2: true while the find/replace input owns the keyboard. */
  activeWordSuppressed?: boolean;
  // --- SPEC43: Smart Edit ---------------------------------------------------
  /** Current bindings — menu rows and the gutter tooltip follow rebinds live. */
  hotkeys: HotkeyMap;
  isMac: boolean;
  /** The readClipboardText seam exists (§4.6) — absent ⇒ Paste is omitted. */
  canPaste: boolean;
  /** Cut/Copy route the selection through the platform copyText seam. */
  onCopyText?(text: string): void;
  /** Paste reads through the seam; resolves null when unavailable/failed. */
  onReadClipboard?(): Promise<string | null>;
  /** SPEC43 §5.2: populated at mount with applyFormat/openSmartMenu. */
  smartRef?: MutableRefObject<SmartEditHandle | null>;
  /** SPEC40 §1: show ALL tables as grids (the global view setting). */
  tableGridView: boolean;
  /** SPEC40 §1.2: the Table ▸ toggle flips the setting (App persists it). */
  onToggleTableGrid?(): void;
  /** SPEC41 §1: render ALL images inline (the global view setting). */
  inlineImages: boolean;
  /** SPEC41 §2.1: local srcs resolve through the platform asset seam. */
  resolveImageSrc?: ((src: string) => string) | null;
  /** SPEC41 §1.2: the Image ▸ toggle flips the setting (App persists it). */
  onToggleInlineImages?(): void;
  /** SPEC41 §1.2: Insert Image… dispatches the SPEC20 picker flow. */
  onInsertImage?(): void;
  /** Issue #157: render ALL fenced code blocks as cards (the global view setting). */
  codeBlockView: boolean;
  /** Issue #157: the Code Block ▸ toggle flips the setting (App persists it). */
  onToggleCodeBlockView?(): void;
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

// --- SPEC23 §3 (issue #123): the selection tint over code constructs ---------
//
// `drawSelection()` (SPEC24 §5) paints into a layer *behind* `.cm-content`, so
// the opaque `--mm-code-bg` on `.mm-md-code` (and PRD 006's `.mm-lp-code`)
// covered it: selecting inside a fenced block or an inline code span showed no
// tint at all. Re-paint the selected slice of every code construct as a mark
// decoration — at `Prec.highest`, which is what nests it *inside* the
// highlighter's code span (CodeMirror opens the lowest-precedence mark first,
// so the highest-precedence one ends up deepest), putting its background above
// the code background and below the code text, which stays legible.
// `InlineCode` / `CodeText` are exactly the nodes @lezer/markdown gives
// `tags.monospace`, i.e. the ones styled `mm-md-code`.
const codeSelMark = Decoration.mark({ class: 'mm-code-sel' });

function codeSelectionDeco(view: EditorView): DecorationSet {
  const sel: CodeRange[] = [];
  for (const r of view.state.selection.ranges) if (!r.empty) sel.push({ from: r.from, to: r.to });
  if (!sel.length) return Decoration.none;
  // Visible ranges only: past them the tree is parsed lazily, and there is
  // nothing on screen to paint over anyway.
  const code: CodeRange[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (n) => {
        if (n.name === 'InlineCode' || n.name === 'CodeText') code.push({ from: n.from, to: n.to });
      },
    });
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of intersectCodeSelection(code, sel)) builder.add(r.from, r.to, codeSelMark);
  return builder.finish();
}

const codeSelectionExt: Extension = Prec.highest(EditorView.decorations.of(codeSelectionDeco));

/**
 * SPEC23 §3: the markdown highlighting, plus the tint that repaints the
 * selection over the code background it draws (issue #123) — the two ride one
 * compartment because no highlighting means no code background, and so nothing
 * to paint over. One definition for the mount and the live reconfigure, which
 * must never drift apart.
 */
/**
 * Issue #122: SPEC23 §3's `mm-md-code` over a fence whose language a nested
 * parser owns. @lezer/highlight deliberately drops the outer node's class over
 * a mounted range (`inheritedClass = ""`), so once `codeLanguages` is in play
 * `tags.monospace` stops painting the fence body — the code background,
 * radius and the issue #123 selection tint that nests inside it would all
 * vanish from exactly the fences the new colouring applies to. Re-assert the
 * class as a mark decoration, and ONLY over mounted bodies: an unlabelled
 * fence still gets it from the highlighter, and doubling the span would double
 * a translucent theme's --mm-code-bg.
 *
 * Default precedence, so it nests OUTSIDE the highlighter's own spans
 * (Prec.high) and outside the Prec.highest selection tint — the same
 * `.mm-md-code .mm-code-sel` nesting as before.
 */
const codeBodyMark = Decoration.mark({ class: 'mm-md-code' });

function mountedCodeDeco(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (n) => {
        if (n.name !== 'CodeText') return;
        // The mount sits on the enclosing FencedCode (its overlay covers
        // exactly this body); an unlabelled fence has none, and the
        // highlighter still paints it, so it must not be doubled.
        if (!n.node.parent?.tree?.prop(NodeProp.mounted)) return;
        builder.add(n.from, n.to, codeBodyMark);
      },
    });
  }
  return builder.finish();
}

const mountedCodeExt: Extension = EditorView.decorations.of(mountedCodeDeco);

const syntaxExt = (on: boolean): Extension =>
  on ? [syntaxHighlighting(mmHighlight), mountedCodeExt, codeSelectionExt] : [];

/**
 * Issue #122: fenced-code colouring in the editor, mapped onto the same eight
 * --mm-syn-* theme tokens the preview's `.doc .hljs-*` rules consume (keyword,
 * string, comment, number, title, attr, literal, meta), so all 27 bundled
 * themes drive both panes from one palette with no theme-file change. The tags
 * here come from the NESTED language parsers below, never from markdown's own
 * tags — `tags.monospace` stays `mm-md-code`, so the fence keeps its
 * background whether this style is installed or not.
 */
const mmCodeHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.tagName], class: 'mm-code-keyword' },
  { tag: [tags.string, tags.regexp, tags.escape], class: 'mm-code-string' },
  { tag: [tags.comment], class: 'mm-code-comment' },
  { tag: [tags.number], class: 'mm-code-number' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.variableName), tags.className],
    class: 'mm-code-title',
  },
  { tag: [tags.propertyName, tags.attributeName, tags.angleBracket], class: 'mm-code-attr' },
  { tag: [tags.bool, tags.null, tags.atom, tags.self, tags.typeName, tags.unit, tags.color], class: 'mm-code-literal' },
  { tag: [tags.meta, tags.annotation], class: 'mm-code-meta' },
]);

/**
 * Issue #122: the languages the editor colours inside a fence — JavaScript
 * (with its TypeScript and JSX dialects) and CSS and HTML, i.e. exactly the
 * three CodeMirror language packages already in the tree. A fence in any other
 * language, an unlabelled fence, or a fence with a bogus info string is simply
 * not matched here: @lezer/markdown leaves the body as plain code text, with
 * no error and nothing lost.
 */
const CODE_LANGUAGES = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'jsx', 'ts', 'tsx', 'typescript', 'node'],
    load: async () => jsLanguage({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({ name: 'css', load: async () => cssLanguage() }),
  LanguageDescription.of({ name: 'html', alias: ['htm', 'xhtml'], load: async () => htmlLanguage() }),
];

/**
 * Issue #122: the code-colour compartment's content. Only the highlight style
 * rides it — the nested parsers stay installed either way, so toggling is a
 * pure restyle (no re-parse, no history touched). Independent of `syntaxExt`
 * above: markdown highlighting off with code colour on, or the reverse, are
 * both coherent states, and PRD 006's live preview supersedes neither.
 */
const codeSyntaxExt = (on: boolean): Extension => (on ? syntaxHighlighting(mmCodeHighlight) : []);

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
 * SPEC43 §3: the smart-edit button — the Marky Mark hash (the FolderPanel
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

class SmartEditWidget extends WidgetType {
  constructor(
    private title: string,
    private onOpen: (view: EditorView, rect: DOMRect) => void
  ) {
    super();
  }
  eq(other: SmartEditWidget) {
    return other.title === this.title;
  }
  toDOM(view: EditorView) {
    // A zero-size inline anchor at the line's start; the button hangs left
    // into .cm-content's 32px side padding, so the line's text never moves.
    const anchor = document.createElement('span');
    anchor.className = 'smart-edit-anchor';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'smart-edit-btn';
    btn.setAttribute('data-testid', 'smart-edit-gutter');
    btn.title = this.title;
    btn.innerHTML = HASH_SVG;
    btn.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.onOpen(view, btn.getBoundingClientRect());
    });
    anchor.appendChild(btn);
    return anchor;
  }
}

/**
 * PRD 007 Req 17: the read-only pane, both halves — `readOnly` refuses
 * document changes, `editable` also takes the pane out of the tab order and
 * hides the caret, so it reads as what it is rather than an editor that
 * swallows keystrokes. One definition for the mount and the live
 * reconfigure, which must never drift apart.
 */
const readOnlyExt = (on: boolean): Extension =>
  on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];

/** The cursor-line-only button, decorated into the content area (not a gutter). */
function smartEditButton(title: string, onOpen: (view: EditorView, rect: DOMRect) => void) {
  const widget = new SmartEditWidget(title, onOpen);
  return EditorView.decorations.of((view) => {
    const head = view.state.doc.lineAt(view.state.selection.main.head);
    return Decoration.set(Decoration.widget({ widget, side: -1 }).range(head.from));
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
  codeSyntax,
  livePreview,
  onOpenExternal,
  vimNav,
  onVimModeChange,
  onEditState,
  selectRangeRef,
  pendingSelectionRef,
  searchRef,
  activeWordSuppressed,
  hotkeys,
  isMac,
  canPaste,
  onCopyText,
  onReadClipboard,
  smartRef,
  tableGridView,
  onToggleTableGrid,
  inlineImages,
  resolveImageSrc,
  onToggleInlineImages,
  onInsertImage,
  codeBlockView,
  onToggleCodeBlockView,
  readOnly = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Issue #10: re-runs the gutter-inset measurement installed by the mount
  // effect. Flipping line numbers changes the gutter's width without resizing
  // anything the observer there watches, so that effect calls this itself.
  const measureGutterInsetRef = useRef<() => void>(() => {});

  // SPEC44 §2.2: the find bar outranks the word cue while it holds focus.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setActiveWordSuppressed.of(!!activeWordSuppressed) });
  }, [activeWordSuppressed]);
  const gutterComp = useRef(new Compartment());
  const diffComp = useRef(new Compartment());
  const syntaxComp = useRef(new Compartment());
  const codeSynComp = useRef(new Compartment()); // Issue #122
  // PRD 006 §1: live preview rides its own compartment, same live-toggle pattern.
  const lpComp = useRef(new Compartment());
  // Issue #157: the fenced-code card view, same live-toggle pattern.
  const codeCardComp = useRef(new Compartment());
  const smartComp = useRef(new Compartment());
  // PRD 007 Req 17: read-only rides a compartment like every other live prop.
  const readOnlyComp = useRef(new Compartment());
  // SPEC43 §4: the Smart Edit menu — open state + anchor + the built model.
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
  // SPEC41 §2.2: the selected image widget (chips visible) — overlay state
  // only; the document never records a selection.
  const [selectedImage, setSelectedImage] = useState<ImageRef | null>(null);
  const selectedImageRef = useRef<ImageRef | null>(null);
  selectedImageRef.current = selectedImage;
  const [imgChips, setImgChips] = useState<Record<ImgChipId, { x: number; y: number }> | null>(null);
  const inlineImagesRef = useRef(inlineImages);
  inlineImagesRef.current = inlineImages;
  const resolveImageSrcRef = useRef(resolveImageSrc);
  resolveImageSrcRef.current = resolveImageSrc;
  const smartPropsRef = useRef({ hotkeys, isMac, canPaste, onCopyText, onReadClipboard, tableGridView, onToggleTableGrid, inlineImages, onToggleInlineImages, onInsertImage, codeBlockView, onToggleCodeBlockView });
  smartPropsRef.current = { hotkeys, isMac, canPaste, onCopyText, onReadClipboard, tableGridView, onToggleTableGrid, inlineImages, onToggleInlineImages, onInsertImage, codeBlockView, onToggleCodeBlockView };
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const onPasteImagesRef = useRef(onPasteImages);
  onPasteImagesRef.current = onPasteImages;
  // PRD 006 §5: the link hand-off reads through a ref so the extension stays
  // stable while the callback prop changes identity across renders.
  const onOpenExternalRef = useRef(onOpenExternal);
  onOpenExternalRef.current = onOpenExternal;
  const livePreviewExt = () => livePreviewExtension({ openExternal: (url) => onOpenExternalRef.current?.(url) });
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

  // --- SPEC43: Smart Edit ----------------------------------------------------
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
        // SPEC40 §1.2 / SPEC41 §1.2: the global view states at menu-open.
        gridView: sp.tableGridView,
        imageView: sp.inlineImages,
        // Issue #157: the fenced-code card view state, same pattern.
        codeView: sp.codeBlockView,
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


  // SPEC38 §3.6: a chip action — mutate the parsed display model, re-layout,
  // one splice, one undo step; the cursor lands in the inserted column/row's
  // first cell (clamped after a delete).
  const runChipOp = (kind: 'col-left' | 'col-right' | 'col-del' | 'row-above' | 'row-below' | 'row-del') => {
    const view = viewRef.current;
    if (!view) return;
    const set = view.state.field(tableModeField);
    const head0 = view.state.selection.main.head;
    const span = set?.spans.find((s) => head0 >= s.from && head0 <= s.to);
    if (!set || !span) return;
    const text = view.state.doc.toString();
    const region = { start: span.from, end: span.to };
    const parsed = parseDisplay(text, region);
    if (!parsed) return;
    const loc = displayCellAt(text, region, parsed, view.state.selection.main.head);
    if (!loc) return;
    const header = [...parsed.model.header];
    const align: ColAlign[] = [...parsed.model.align];
    const rows = parsed.model.rows.map((r) => [...r]);
    let target: { row: number; col: number };
    if (kind === 'col-left' || kind === 'col-right') {
      const at = kind === 'col-left' ? loc.col : loc.col + 1;
      header.splice(at, 0, '');
      align.splice(at, 0, null);
      for (const r of rows) r.splice(at, 0, '');
      target = { row: -1, col: at };
    } else if (kind === 'col-del') {
      if (header.length <= 1) return;
      header.splice(loc.col, 1);
      align.splice(loc.col, 1);
      for (const r of rows) r.splice(loc.col, 1);
      target = { row: loc.row, col: Math.min(loc.col, header.length - 1) };
    } else if (kind === 'row-above' || kind === 'row-below') {
      const at = kind === 'row-above' ? Math.max(loc.row, 0) : loc.row + 1;
      rows.splice(at, 0, header.map(() => ''));
      target = { row: at, col: 0 };
    } else {
      if (loc.row < 0) return;
      rows.splice(loc.row, 1);
      target = { row: Math.min(loc.row, rows.length - 1), col: loc.col };
    }
    const l = layoutTable({ header, align, rows }, set.width);
    // The effect (updated span list) also tells the filter/watcher this is
    // our own structured edit — the confinement cancel-rule must not fire.
    const grow = l.text.length - (span.to - span.from);
    const newSpans: GridSpan[] = set.spans.map((s) =>
      s === span
        ? { ...s, from: s.from, to: s.from + l.text.length }
        : s.from >= span.to
          ? { ...s, from: s.from + grow, to: s.to + grow }
          : { ...s }
    );
    view.dispatch({
      changes: { from: span.from, to: span.to, insert: l.text },
      selection: { anchor: span.from + displayPosOf(l.map, { ...target, contentOffset: 0 }) },
      effects: setGridSet.of({ spans: newSpans, width: set.width }),
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
    // SPEC40 §1.2 / SPEC41 §1.2: the global view toggles (the App flips the
    // settings and persists them).
    if (id === 'toggle-grid') {
      sp.onToggleTableGrid?.();
      view.focus();
      return;
    }
    if (id === 'toggle-images') {
      sp.onToggleInlineImages?.();
      view.focus();
      return;
    }
    // Issue #157: the fenced-code card view's global toggle, same pattern.
    if (id === 'toggle-code-blocks') {
      sp.onToggleCodeBlockView?.();
      view.focus();
      return;
    }
    if (id === 'insert-image') {
      sp.onInsertImage?.();
      return;
    }
    // SPEC41 §1.3: splice the caret's image reference out — one undo step,
    // a lone-on-its-line reference takes the line and one blank with it.
    if (id === 'delete-image') {
      const text = view.state.doc.toString();
      const r = deleteImageAt(text, sel.head);
      if (r) {
        view.dispatch({
          changes: { from: r.from, to: r.from + (text.length - r.text.length), insert: '' },
          selection: { anchor: r.from },
          annotations: isolateHistory.of('full'),
        });
      }
      view.focus();
      return;
    }
    // SPEC41 §1.3: pointer-free entry to the chips — select the caret's image.
    if (id === 'resize-image') {
      const ref = allImageRefs(view.state.doc.toString()).find((r) => sel.head >= r.start && sel.head <= r.end);
      if (ref) {
        view.dispatch({ selection: { anchor: ref.start } });
        setSelectedImage(ref);
      }
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
    const set = view?.state.field(tableModeField, false);
    if (!view || !host || !set) {
      setChips(null);
      return;
    }
    const head = view.state.selection.main.head;
    const span = set.spans.find((s) => head >= s.from && head <= s.to);
    if (!span) {
      setChips(null);
      return;
    }
    const text = view.state.doc.toString();
    const region = { start: span.from, end: span.to };
    const parsed = parseDisplay(text, region);
    const b = parsed ? displayCellBounds(text, region, parsed, head) : null;
    if (!parsed || !b) {
      setChips(null);
      return;
    }
    // Chip centers sit ON the borders they act on: the column ⊕s on the
    // column's pipes at the table's top border, the column ✕ at the column's
    // middle; the row ⊕s on the left border at the row BLOCK's top/bottom
    // edges (wrapped rows span several lines), the row ✕ past the row's LAST
    // pipe at its vertical middle — the left middle now belongs to the
    // smart-edit button (SPEC43, #23), which the ✕ used to sit on.
    const cw = view.defaultCharacterWidth || 8;
    const top = view.coordsAtPos(span.from);
    const lp = view.coordsAtPos(Math.max(span.from, b.cellStart - 1)); // left pipe
    const rp = view.coordsAtPos(Math.min(span.to, b.cellEnd)); // right pipe
    // The caret row's display-line block (header block for separators/row −1).
    const firstDocLine = view.state.doc.lineAt(span.from).number;
    const blockIdxs: number[] = [];
    parsed.lineInfo.forEach((li, i) => {
      if (li.kind === 'cells' && li.row === b.row) blockIdxs.push(i);
    });
    if (!top || !lp || !rp || blockIdxs.length === 0) {
      setChips(null);
      return;
    }
    const firstLine = view.state.doc.line(firstDocLine + blockIdxs[0]);
    const lastLine = view.state.doc.line(firstDocLine + blockIdxs[blockIdxs.length - 1]);
    const rowTopCo = view.coordsAtPos(firstLine.from);
    const rowBottomCo = view.coordsAtPos(lastLine.from);
    const rowEndCo = view.coordsAtPos(firstLine.to);
    if (!rowTopCo || !rowBottomCo || !rowEndCo) {
      setChips(null);
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const X = (v: number) => v - hostRect.left;
    const Y = (v: number) => v - hostRect.top;
    const HALF = 9; // chips are 18px — center them on the border points
    const isHeader = b.row === -1; // header and separator lines map here
    const leftPipeX = X(lp.left) + cw / 2;
    const rightPipeX = X(rp.left) + cw / 2;
    const topBorderY = Y(top.top);
    const tableLeftX = X(rowTopCo.left) + cw / 2; // the row's first pipe
    const rowTopY = Y(rowTopCo.top);
    const rowBottomY = Y(rowBottomCo.bottom);
    setChips({
      colLeft: { x: leftPipeX - HALF, y: topBorderY - HALF },
      colRight: { x: rightPipeX - HALF, y: topBorderY - HALF },
      colDel: { x: (leftPipeX + rightPipeX) / 2 - HALF, y: topBorderY - HALF },
      colDelDisabled: parsed.model.header.length <= 1,
      rowAbove: isHeader ? null : { x: tableLeftX - HALF, y: rowTopY - HALF },
      rowBelow: { x: tableLeftX - HALF, y: rowBottomY - HALF },
      rowDel: isHeader
        ? null
        : { x: X(rowEndCo.left) - cw / 2 + 22 - HALF, y: (rowTopY + rowBottomY) / 2 - HALF },
    });
  };
  // SPEC41 §3.1: chip geometry from the selected widget's rendered rect —
  // circles centered ON the right border, bottom border, bottom-right corner.
  const computeImageChips = () => {
    const host = hostRef.current;
    const sel = selectedImageRef.current;
    if (!host || !sel || !inlineImagesRef.current) {
      setImgChips(null);
      return;
    }
    const img = host.querySelector(`img[data-ref-start="${sel.start}"]`) as HTMLImageElement | null;
    if (!img) {
      setImgChips(null);
      return;
    }
    // Not yet decoded — the rect firms up on load; recompute then.
    if (!img.complete) img.addEventListener('load', () => scheduleChips(), { once: true });
    setImgChips(chipRing(img.getBoundingClientRect(), host.getBoundingClientRect()));
  };

  /** During a drag the ring is moved imperatively, in the SAME frame as the
      image resize — the React state path (rAF + render) lags a frame or two
      behind pointermove, which made the dots visibly trail the edge. */
  const syncChipRing = (img: HTMLImageElement) => {
    const host = hostRef.current;
    if (!host) return;
    const layer = host.querySelector('[data-testid="image-chip-layer"]') as HTMLElement | null;
    if (!layer) return;
    const ring = chipRing(img.getBoundingClientRect(), host.getBoundingClientRect());
    for (const m of IMG_CHIP_ORDER) {
      const el = layer.querySelector(`[data-testid="image-resize-${m}"]`) as HTMLElement | null;
      if (el) {
        el.style.left = `${ring[m].x}px`;
        el.style.top = `${ring[m].y}px`;
      }
    }
  };

  /** SPEC41 §3.2: persist a release via the SPEC20 rewrite — ONE undo step. */
  const persistImageSize = (width: number | null, height: number | null) => {
    const view = viewRef.current;
    const sel = selectedImageRef.current;
    if (!view || !sel) return;
    const text = view.state.doc.toString();
    const ref = allImageRefs(text).find((r) => r.start === sel.start);
    if (!ref) return;
    const parts = { src: ref.src, alt: ref.alt, ...(ref.title ? { title: ref.title } : {}) };
    const res = applyImageRewrite(text, ref.start, ref.end, parts, width, height);
    if (!res) return;
    const insert = res.text.slice(ref.start, res.text.length - (text.length - ref.end));
    view.dispatch({
      changes: { from: ref.start, to: ref.end, insert },
      selection: { anchor: ref.start },
      annotations: isolateHistory.of('full'),
    });
    const next = allImageRefs(view.state.doc.toString()).find((r) => r.start === ref.start);
    setSelectedImage(next ?? null);
  };

  const startImageDrag = (mode: ImgChipId) => (e: React.PointerEvent) => {
    const host = hostRef.current;
    const sel = selectedImageRef.current;
    if (!host || !sel) return;
    const img = host.querySelector(`img[data-ref-start="${sel.start}"]`) as HTMLImageElement | null;
    if (!img) return;
    e.preventDefault();
    const r0 = img.getBoundingClientRect();
    const ratio = r0.height > 0 ? r0.width / r0.height : 1;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    // SPEC42 §2: outward-positive from the top-left anchor — right/bottom
    // grow with +d, left/top grow with −d; corners ride their x sign.
    const xSign = IMG_CHIP_X[mode];
    const ySign = IMG_CHIP_Y[mode];
    const corner = IMG_CORNERS.has(mode);
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 2) moved = true;
      if (!moved) return;
      let w = r0.width;
      let h = r0.height;
      if (corner) {
        // Ratio locked on the dominant outward axis, both clamped ≥ 40.
        w = Math.max(40, r0.width + xSign * (ev.clientX - startX));
        h = w / ratio;
        if (h < 40) {
          h = 40;
          w = Math.max(40, h * ratio);
        }
      } else if (xSign !== 0) {
        w = Math.max(40, r0.width + xSign * (ev.clientX - startX));
      } else {
        h = Math.max(40, r0.height + ySign * (ev.clientY - startY));
      }
      img.style.width = `${Math.round(w)}px`;
      img.style.height = `${Math.round(h)}px`;
      syncChipRing(img); // same frame as the resize — no trailing dots
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // A press without a real drag persists nothing (double-click included).
      if (!moved) return;
      const r1 = img.getBoundingClientRect();
      const w = Math.max(40, Math.round(r1.width));
      const h = Math.max(40, Math.round(r1.height));
      // SPEC42 §2: border chips freeze the box (dragged dimension + the
      // other at its current value); corners write width only — height
      // REMOVED, aspect natural.
      if (corner) persistImageSize(w, null);
      else persistImageSize(w, h);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const computeChipsRef = useRef(() => {});
  computeChipsRef.current = () => {
    computeChips();
    computeImageChips();
  };
  const scheduleChips = () => {
    cancelAnimationFrame(chipsRaf.current);
    chipsRaf.current = requestAnimationFrame(() => computeChipsRef.current());
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions = [
      gutterComp.current.of(showLineNumbers ? lineNumbers() : []),
      // SPEC43 §3.2: the smart-edit button, in the content area's left
      // padding — same geometry with or without line numbers.
      smartComp.current.of(smartEditButton(gutterTitle(), openMenuAtGutter)),
      // PRD 007 Req 17: read-only rides a compartment like every other live
      // prop — see readOnlyExt above for what it turns off.
      readOnlyComp.current.of(readOnlyExt(readOnly)),
      diffComp.current.of([]),
      // SPEC23 §3: highlighting rides a compartment — toggling the setting
      // reconfigures live, undo history intact. PRD 006 §12: while live
      // preview is on it supersedes the setting — revealed raw lines keep
      // the mm-md-* highlight styling whatever `editorSyntax` says.
      syntaxComp.current.of(syntaxExt(syntax || livePreview)),
      // Issue #122: fenced-code colouring, on its own compartment so it
      // toggles live and independently of the markdown highlighting above.
      codeSynComp.current.of(codeSyntaxExt(codeSyntax)),
      // PRD 006 §1: the experimental live-preview extension, present only
      // while the setting is on — off ⇒ an empty compartment, zero behavior.
      lpComp.current.of(livePreview ? livePreviewExt() : []),
      // SPEC37 §3: aligned table mode. MUST precede the vim layer below —
      // both carry Prec.highest keydown handlers, and the first Esc has to
      // leave table mode before the next one can enter nav (§3.5).
      tableModeExtension(),
      // SPEC41 §2: the inline image view — pure decoration; after table mode
      // so the grid-span exclusion can read its field.
      imageViewExtension({
        enabled: inlineImagesRef.current,
        resolve: (src) => (resolveImageSrcRef.current ? resolveImageSrcRef.current(src) : src),
        onSelect: (ref) => setSelectedImage(ref),
      }),
      // Issue #157: the fenced-code card view — pure decoration, present only
      // while the setting is on; after table mode so it can read the grid
      // spans it must exclude.
      codeCardComp.current.of(codeBlockView ? codeBlockViewExtension() : []),
      history(),
      highlightActiveLine(),
      // SPEC44 §2: word-under-caret decoration (cleared while selecting).
      activeWordField,
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
      markdown({ codeLanguages: CODE_LANGUAGES }), // Issue #122: nested fence parsers
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
        // Issue #10: the gutter's own width follows the line count, so the
        // centring slack can change with no pane resize to observe.
        if (u.geometryChanged) measureGutterInsetRef.current();
        // SPEC41 §2.2: caret-move or edits clear the widget selection (the
        // resize release reselects after its own dispatch).
        {
          const si = selectedImageRef.current;
          if (si && (u.docChanged || (u.selectionSet && u.state.selection.main.head !== si.start))) {
            setSelectedImage(null);
          }
        }
        if ((u.selectionSet || u.docChanged) && onEditStateRef.current) {
          const main = u.state.selection.main;
          const canonHeadOf = (st: EditorState, h: number) => {
            const gridSet = st.field(tableModeField, false);
            if (!gridSet || gridSet.spans.length === 0) return h;
            const raw = st.doc.toString();
            return mapOffsetByLineFlat(raw, canonicalizeAll(raw, gridSet), h);
          };
          onEditStateRef.current({
            canonHead: canonHeadOf(u.state, main.head),
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
    if (
      view.state.doc.toString() !== value &&
      // SPEC40: a parked grid restored before the buffer caught up is the
      // SAME document in display dress — converging would record a full-doc
      // change and poison undo. Real divergence still converges as before.
      canonicalizeDetected(view.state.doc.toString()) !== canonicalizeDetected(value)
    ) {
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

    // SPEC43 §5.2: the App's format commands land here; the ref is null
    // outside edit mode, so every command is a silent no-op there.
    if (smartRef) {
      smartRef.current = {
        applyFormat: (op) => runFormat(view, op),
        openSmartMenu: () => {
          const c = view.coordsAtPos(view.state.selection.main.head);
          openMenuAt(c ? c.left : 80, c ? c.bottom + 4 : 80);
        },
        // SPEC38/40 §3.5: the canonical view for everything leaving the
        // editor — every tracked grid collapsed (originals when untouched).
        canonicalText: (t) => {
          const set = view.state.field(tableModeField, false);
          return set && set.spans.length ? canonicalizeAll(t, set) : t;
        },
      };
    }

    // SPEC30 §1.4: the find/replace engine.
    if (searchRef) {
      const stats = () => {
        const q = getSearchQuery(view.state);
        // `valid` guards the cursor: CM compiles with the `u` flag, so a
        // pattern it rejects must never reach getCursor (it would throw).
        if (!q.search || !q.valid) return { count: 0, current: 0 };
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
        setQuery(pattern, replace, advance = true) {
          const search = pattern?.source ?? '';
          if (search && !searchPanelOpen(view.state)) openSearchPanel(view); // arms the highlighter
          // PRD 014 Req 10 (issue #154): always regexp mode over the compiled
          // source — case, whole-word and escaping were decided in searchCore,
          // no regex is assembled here. literal keeps the replace text's
          // backslashes unquoted, as the string engine did.
          const q = new SearchQuery({
            search,
            regexp: true,
            caseSensitive: pattern?.caseSensitive ?? false,
            literal: true,
            replace,
          });
          view.dispatch({ effects: setSearchQuery.of(q) });
          if (search && q.valid && advance) findNext(view); // land on the first match from the cursor
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
      const gridSet = view.state.field(tableModeField, false);
      const canonHead =
        !gridSet || gridSet.spans.length === 0
          ? main.head
          : mapOffsetByLineFlat(view.state.doc.toString(), canonicalizeAll(view.state.doc.toString(), gridSet), main.head);
      onEditStateRef.current({
        canonHead,
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
        goToLine(line) {
          // PRD 012 Req 6: same clamp and same scroll effect as scrollToLine,
          // plus the selection — one dispatch so the caret and the viewport
          // never disagree. Focus follows so typing continues where the click
          // landed.
          const doc = view.state.doc;
          const n = Math.min(Math.max(Math.round(line), 1), doc.lines);
          const pos = doc.line(n).from;
          view.dispatch({
            selection: { anchor: pos, head: pos },
            effects: EditorView.scrollIntoView(pos, { y: 'start' }),
          });
          view.focus();
        },
        headTop() {
          return view.lineBlockAt(view.state.selection.main.head).top;
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

    // Issue #10: the gutter's side rules belong on a gutter that is genuinely
    // INSET — centring slack either side of the gutter+content pair. Whether
    // there is slack is geometry (pane width, folder panel, margins, split),
    // not a mode, so measure it rather than infer it from a mode class: a
    // gutter sitting flush against the folder seam would otherwise draw a left
    // rule right on top of .folder-panel::after's hairline, in the same token.
    let gutterRaf = 0;
    const measureGutterInset = () => {
      const on = host.classList.contains('gutter-inset');
      const gutters = view.scrollDOM.querySelector<HTMLElement>('.cm-gutters');
      if (!gutters) {
        if (on) host.classList.remove('gutter-inset'); // line numbers off
        return;
      }
      const inset = gutters.getBoundingClientRect().left - view.scrollDOM.getBoundingClientRect().left;
      // The rules widen the gutter by 2px and so eat 1px of the very inset
      // read here. Latching on at 2px but off only at 0 leaves that 1px inside
      // the band, so a pane parked on the boundary settles instead of
      // flickering between ruled and unruled every frame.
      if (on ? inset <= 0 : inset >= 2) host.classList.toggle('gutter-inset', !on);
    };
    const scheduleGutterInset = () => {
      cancelAnimationFrame(gutterRaf);
      gutterRaf = requestAnimationFrame(measureGutterInset);
    };
    measureGutterInsetRef.current = scheduleGutterInset;
    // Fires once on observe (the initial measure), then on every pane resize:
    // window, divider drags, the folder panel opening or closing.
    const paneResize = new ResizeObserver(scheduleGutterInset);
    paneResize.observe(host);
    // The content element too: --mm-content-width lives on the ROOT (the
    // margins preset, App.tsx), so flipping it resizes the text column without
    // resizing the pane and without any CM transaction — the wrap's observer
    // never fires and CM's own DOMObserver watches scrollDOM, whose box is
    // unchanged. Watching .cm-content catches that third mover of the slack.
    // It also fires on content-height changes while typing, which costs the
    // two rects below once per frame — edits already re-measure through
    // geometryChanged anyway.
    paneResize.observe(view.contentDOM);

    return () => {
      // SPEC40 §2.3: the buffer the App keeps must be canonical — collapse
      // the grids in the REPORTED text only. The parked state keeps the grid
      // form: a remount re-adopts it (the gridify adoption path) without a
      // converge dispatch, so the parked selection survives split toggles.
      {
        const set = view.state.field(tableModeField, false);
        if (set?.spans.length) {
          onChangeRef.current(canonicalizeAll(view.state.doc.toString(), set));
        }
      }
      view.scrollDOM.removeEventListener('scroll', onChipScroll);
      window.removeEventListener('resize', onChipScroll);
      paneResize.disconnect();
      cancelAnimationFrame(gutterRaf);
      measureGutterInsetRef.current = () => {};
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
      // SPEC40: while grids are displayed the App's buffer holds the
      // CANONICAL text — same document, different clothes. Converge only on
      // real divergence, or a full-doc replace would eat the selection.
      const set = view.state.field(tableModeField, false);
      if (set?.spans.length && canonicalizeAll(current, set) === value) return;
      if (canonicalizeDetected(current) === canonicalizeDetected(value)) return;
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyComp.current.reconfigure(readOnlyExt(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: gutterComp.current.reconfigure(showLineNumbers ? lineNumbers() : []),
    });
    measureGutterInsetRef.current(); // the gutter's width changed, the pane's did not
  }, [showLineNumbers]);

  // SPEC23 §3: live highlight toggle — same compartment pattern as the gutter.
  // PRD 006 §1/§12: the live-preview toggle reconfigures the same way (no
  // remount, history intact), and while it's on the highlight stays for
  // revealed lines regardless of the SPEC23 setting.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        syntaxComp.current.reconfigure(syntaxExt(syntax || livePreview)),
        // Issue #122: the same compartment pattern — restyle only, so an open
        // document keeps its undo history across the toggle.
        codeSynComp.current.reconfigure(codeSyntaxExt(codeSyntax)),
        lpComp.current.reconfigure(livePreview ? livePreviewExt() : []),
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syntax, codeSyntax, livePreview]);

  // SPEC40 §1.3/§2.2: the global view — gridify on (initial mount included),
  // collapse off; both history-transparent inside the helpers.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (tableGridView) gridifyAll(view, valueRef.current);
    else collapseAllGrids(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableGridView]);

  // Issue #157: the card-view toggle is a compartment reconfigure — restyle
  // only, so no text, no history, no dirty dot, ever.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: codeCardComp.current.reconfigure(codeBlockView ? codeBlockViewExtension() : []),
    });
  }, [codeBlockView]);

  // SPEC41 §2.3: flipping the image view is an effect-only dispatch — no
  // text, no history, no dirty dot, ever.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setImageView.of(inlineImages) });
    if (!inlineImages) setSelectedImage(null);
  }, [inlineImages]);

  // SPEC41 §2.2: Esc clears the widget selection ahead of everything else.
  useEffect(() => {
    if (!selectedImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSelectedImage(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectedImage]);

  // Selection changes re-aim the chips (the rAF reads the widget's rect).
  useEffect(() => {
    scheduleChips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImage]);

  // SPEC43 §3.3: rebinding smartMenu retitles the gutter button immediately.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: smartComp.current.reconfigure(smartEditButton(gutterTitle(), openMenuAtGutter)),
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
      // SPEC43 §4.4: right-click opens the Smart Edit menu at the pointer —
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
      {/* SPEC42 §1: the image resize ring — empty-faced circles ON every
          border middle and every corner of the selected widget. */}
      {selectedImage && imgChips && (
        <div className="table-chip-layer" data-testid="image-chip-layer">
          {IMG_CHIP_ORDER.map((m) => (
            <button
              key={m}
              className="table-chip image-chip"
              data-testid={`image-resize-${m}`}
              style={{ left: imgChips[m].x, top: imgChips[m].y }}
              title={IMG_CHIP_TITLES[m]}
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={startImageDrag(m)}
              onDoubleClick={IMG_CORNERS.has(m) ? () => persistImageSize(null, null) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
