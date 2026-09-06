/**
 * SPEC43 §2: Smart Edit pure logic — text operations, context detection, and
 * the menu model (the single source of menu truth). No DOM, no CodeMirror,
 * no platform imports. Every operation takes the whole document plus a
 * selection (0-based offsets, from <= to) and returns the new document plus
 * the new selection, or null for a no-op; callers apply the result as ONE
 * CodeMirror transaction so each action is a single undo step.
 */

import { displayCombo, type HotkeyMap } from './hotkeys.ts';
import { tableRegionAt } from './tableEdit.ts';

/** SPEC43 §1: every user-visible string lives here — a rename is one file. */
export const SMART_EDIT_NAME = 'Smart Edit';

/**
 * SPEC43 §3: the Marky Mark hash (the FolderPanel slanted-top-bar geometry)
 * at 18px — the smart-edit button's glyph. Exported (PRD 023 §13, issue
 * #287) so the preview selection button renders the SAME markup as the
 * editor's gutter button rather than a second copy.
 */
export const SMART_EDIT_HASH_SVG =
  '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">' +
  '<g stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round">' +
  '<line x1="5.6" y1="2.6" x2="5.6" y2="13.4" />' +
  '<line x1="10.4" y1="2.6" x2="10.4" y2="13.4" />' +
  '<line x1="2.6" y1="6.7" x2="13.4" y2="5" />' +
  '<line x1="2.6" y1="10.2" x2="13.4" y2="10.2" />' +
  '</g></svg>';

export interface EditResult {
  text: string;
  from: number;
  to: number;
}

export type InlineKind = 'bold' | 'italic' | 'strike' | 'code';
export type ListKind = 'bullet' | 'numbered' | 'task';
export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

const WORD = /[\p{L}\p{N}_]/u;

/** The complete lines touched by [from, to]: offsets of their first/last char. */
function lineSpan(text: string, from: number, to: number): { start: number; end: number } {
  let start = text.lastIndexOf('\n', from - 1) + 1;
  if (from === 0) start = 0;
  let end = text.indexOf('\n', Math.max(to, from));
  // A selection ending exactly at a line start does not touch that line —
  // unless it is collapsed there.
  if (to > from && to === text.lastIndexOf('\n', to - 1) + 1 && to > start) {
    end = to - 1;
  }
  if (end === -1) end = text.length;
  return { start, end };
}

/** Replace the touched lines with `newLines`, selecting the replaced block. */
function spliceLines(
  text: string,
  span: { start: number; end: number },
  newLines: string[]
): EditResult {
  const block = newLines.join('\n');
  return {
    text: text.slice(0, span.start) + block + text.slice(span.end),
    from: span.start,
    to: span.start + block.length,
  };
}

/** Length of the run of `ch` immediately left of `pos` / right of `pos`. */
function runLeft(text: string, pos: number, ch: string): number {
  let n = 0;
  while (pos - n - 1 >= 0 && text[pos - n - 1] === ch) n++;
  return n;
}
function runRight(text: string, pos: number, ch: string): number {
  let n = 0;
  while (pos + n < text.length && text[pos + n] === ch) n++;
  return n;
}

/**
 * §2.1: inline toggles. Collapsed selections expand to the word around the
 * cursor; a cursor in whitespace inserts the marker pair with the caret
 * between. Unwrap when the markers sit immediately outside the (expanded)
 * selection or at its own edges; `**` is checked before `*`, so toggling
 * italic on bold text yields `***…***` and never eats a bold marker.
 */
export function toggleInline(
  text: string,
  from: number,
  to: number,
  kind: InlineKind
): EditResult | null {
  const ch = kind === 'bold' || kind === 'italic' ? '*' : kind === 'strike' ? '~' : '`';
  const mlen = kind === 'italic' || kind === 'code' ? 1 : 2;
  const marker = ch.repeat(mlen);

  if (from === to) {
    let s = from;
    let e = from;
    while (s > 0 && WORD.test(text[s - 1])) s--;
    while (e < text.length && WORD.test(text[e])) e++;
    if (s === e) {
      // Not in a word: insert the pair, caret between the markers.
      const t = text.slice(0, from) + marker + marker + text.slice(from);
      return { text: t, from: from + mlen, to: from + mlen };
    }
    from = s;
    to = e;
  }

  // The range's own edges may hold the markers — treat them as outside.
  while (to - from >= 2 && text[from] === ch && text[to - 1] === ch) {
    from++;
    to--;
  }

  const left = runLeft(text, from, ch);
  const right = runRight(text, to, ch);
  // How many marker chars to strip per side, or 0 to wrap instead. Italic
  // needs an odd star run (1 or 3 = italic present; 2 = bold only, so wrap).
  const strip =
    kind === 'italic'
      ? left >= 1 && right >= 1 && left % 2 === 1 && right % 2 === 1
        ? 1
        : 0
      : left >= mlen && right >= mlen
        ? mlen
        : 0;

  if (strip > 0) {
    const t =
      text.slice(0, from - strip) + text.slice(from, to) + text.slice(to + strip);
    return { text: t, from: from - strip, to: to - strip };
  }
  const t = text.slice(0, from) + marker + text.slice(from, to) + marker + text.slice(to);
  return { text: t, from: from + mlen, to: to + mlen };
}

/** §2.2: selection ⇒ `[selection](url)` with `url` selected; collapsed ⇒ `[text](url)` with `text` selected. */
export function wrapLink(text: string, from: number, to: number): EditResult {
  if (from === to) {
    const t = text.slice(0, from) + '[text](url)' + text.slice(from);
    return { text: t, from: from + 1, to: from + 5 };
  }
  const sel = text.slice(from, to);
  const t = text.slice(0, from) + '[' + sel + '](url)' + text.slice(to);
  const urlStart = from + 1 + sel.length + 2;
  return { text: t, from: urlStart, to: urlStart + 3 };
}

const ATX = /^ {0,3}(#{1,6}) +/;

/**
 * §2.3: every non-blank touched line gets its ATX prefix replaced by the
 * target level; a line already exactly at that level loses its prefix.
 */
export function setHeading(
  text: string,
  from: number,
  to: number,
  level: 1 | 2 | 3 | 4 | 5 | 6
): EditResult | null {
  const span = lineSpan(text, from, to);
  const lines = text.slice(span.start, span.end).split('\n');
  const prefix = '#'.repeat(level) + ' ';
  let changed = false;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    const m = line.match(ATX);
    changed = true;
    if (m && m[1].length === level) return line.slice(m[0].length);
    return prefix + (m ? line.slice(m[0].length) : line);
  });
  if (!changed) return null;
  return spliceLines(text, span, out);
}

// Any list prefix: bullet/ordered marker, optionally a task checkbox after it.
const LIST_PREFIX = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const KIND_TEST: Record<ListKind, RegExp> = {
  bullet: /^\s*[-*+]\s+(?!\[[ xX]\]\s)/,
  numbered: /^\s*\d+[.)]\s+/,
  task: /^\s*[-*+]\s+\[[ xX]\]\s+/,
};

/**
 * §2.4: if ALL non-blank touched lines already carry the kind's prefix it is
 * removed; otherwise applied, replacing any other list prefix in place
 * (indent whitespace preserved). Numbered lists renumber from 1.
 */
export function toggleList(
  text: string,
  from: number,
  to: number,
  kind: ListKind
): EditResult | null {
  const span = lineSpan(text, from, to);
  const lines = text.slice(span.start, span.end).split('\n');
  const content = lines.filter((l) => l.trim());
  if (content.length === 0) return null;
  const allKind = content.every((l) => KIND_TEST[kind].test(l));
  let n = 0;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    const m = line.match(LIST_PREFIX);
    const indent = m ? m[1] : (line.match(/^\s*/) as RegExpMatchArray)[0];
    const rest = m ? line.slice(m[0].length) : line.slice(indent.length);
    if (allKind) return indent + rest;
    n++;
    const marker = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${n}. `;
    return indent + marker + rest;
  });
  return spliceLines(text, span, out);
}

/**
 * §2.5: if all touched lines start with `>`, one level is stripped;
 * otherwise every line (blanks included, as bare `>`) gains `> `.
 */
export function toggleQuote(text: string, from: number, to: number): EditResult | null {
  const span = lineSpan(text, from, to);
  const lines = text.slice(span.start, span.end).split('\n');
  const allQuoted = lines.every((l) => /^\s*>/.test(l));
  const out = lines.map((line) =>
    allQuoted ? line.replace(/^(\s*)> ?/, '$1') : line.trim() ? '> ' + line : '>'
  );
  return spliceLines(text, span, out);
}

/**
 * §2.6: GitHub alert syntax. A selection is quoted with `> [!KIND]` inserted
 * above; a collapsed cursor on a blank line inserts the template there (on a
 * non-blank line, after it), caret after the final `> `. Insert-only.
 */
export function insertCallout(
  text: string,
  from: number,
  to: number,
  kind: CalloutKind
): EditResult {
  const tag = `> [!${kind.toUpperCase()}]`;
  const span = lineSpan(text, from, to);
  if (from !== to) {
    const lines = text.slice(span.start, span.end).split('\n');
    const out = [tag, ...lines.map((line) => (line.trim() ? '> ' + line : '>'))];
    return spliceLines(text, span, out);
  }
  const line = text.slice(span.start, span.end);
  if (!line.trim()) {
    const block = `${tag}\n> `;
    const t = text.slice(0, span.start) + block + text.slice(span.end);
    const caret = span.start + block.length;
    return { text: t, from: caret, to: caret };
  }
  const block = `\n${tag}\n> `;
  const t = text.slice(0, span.end) + block + text.slice(span.end);
  const caret = span.end + block.length;
  return { text: t, from: caret, to: caret };
}

const FENCE = /^\s*```/;

/**
 * §2.7: wrap the selection's complete lines in ``` fences, caret right after
 * the opening fence (to type a language); if the boundary lines are already
 * a matched fence pair, remove both fences instead.
 */
export function toggleCodeBlock(text: string, from: number, to: number): EditResult {
  const span = lineSpan(text, from, to);
  const lines = text.slice(span.start, span.end).split('\n');

  // Unwrap: fences as the selection's own first/last lines…
  if (lines.length >= 2 && FENCE.test(lines[0]) && FENCE.test(lines[lines.length - 1])) {
    return spliceLines(text, span, lines.slice(1, -1));
  }
  // …or as the lines immediately outside it.
  if (span.start > 0 && span.end < text.length) {
    const prevStart = text.lastIndexOf('\n', span.start - 2) + 1;
    const prevLine = text.slice(prevStart, span.start - 1);
    const nextEndRaw = text.indexOf('\n', span.end + 1);
    const nextEnd = nextEndRaw === -1 ? text.length : nextEndRaw;
    const nextLine = text.slice(span.end + 1, nextEnd);
    if (FENCE.test(prevLine) && FENCE.test(nextLine)) {
      const t = text.slice(0, prevStart) + text.slice(span.start, span.end) + text.slice(nextEnd);
      return { text: t, from: prevStart, to: prevStart + (span.end - span.start) };
    }
  }

  const block = '```\n' + lines.join('\n') + '\n```';
  const t = text.slice(0, span.start) + block + text.slice(span.end);
  const caret = span.start + 3; // right after the opening ```
  return { text: t, from: caret, to: caret };
}

/**
 * §2.8: insert a `---` line after the cursor's line, adding blank lines
 * above/below only as needed; caret lands after the rule.
 */
export function insertHr(text: string, from: number, _to: number): EditResult {
  const span = lineSpan(text, from, from);
  const curLine = text.slice(span.start, span.end);
  const nextEndRaw = text.indexOf('\n', span.end + 1);
  const nextLine =
    span.end < text.length
      ? text.slice(span.end + 1, nextEndRaw === -1 ? text.length : nextEndRaw)
      : null;
  const parts: string[] = [];
  if (curLine.trim()) parts.push('');
  parts.push('---');
  if (nextLine !== null && nextLine.trim()) parts.push('');
  const block = '\n' + parts.join('\n');
  const t = text.slice(0, span.end) + block + text.slice(span.end);
  // Caret at the end of the inserted `---` line.
  const caret = span.end + 1 + (curLine.trim() ? 1 : 0) + 3;
  return { text: t, from: caret, to: caret };
}

/** §2.9: is the cursor inside a pipe table / on an image reference?
 * SPEC37 §1.1: the table scan lives in tableEdit.ts (tableRegionAt) now —
 * identical detection semantics, one source of truth. */
export function detectContext(text: string, head: number): { table: boolean; image: boolean } {
  const lines = text.split('\n');
  let headLine = 0;
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    if (head <= off + lines[i].length) {
      headLine = i;
      break;
    }
    off += lines[i].length + 1;
    headLine = i;
  }

  const table = tableRegionAt(text, head) !== null;

  let image = false;
  let lineStart = 0;
  for (let i = 0; i < headLine; i++) lineStart += lines[i].length + 1;
  const line = lines[headLine] ?? '';
  const col = head - lineStart;
  for (const re of [/!\[[^\]]*\]\([^)]*\)/g, /<img\b[^>]*>/gi]) {
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (col >= m.index && col <= m.index + m[0].length) {
        image = true;
        break;
      }
    }
    if (image) break;
  }
  return { table, image };
}

// ---------------------------------------------------------------------------
// §2.10: the menu model.

export type SmartMenuEntry =
  | {
      id: string;
      label: string;
      hotkey?: string;
      enabled: boolean;
      submenu?: SmartMenuEntry[];
    }
  | 'sep';

/**
 * PRD 023 §7 (issue #286): the owner-fed annotation context — computed by the
 * app at menu-open time (the package never sees the comment store) and handed
 * in through SmartMenuCtx. Null/absent means the authoring gate is closed
 * (comments off, frozen store, no comment.write) and NEITHER entry appears at
 * all — the popup's all-or-nothing gate, expressed as absence.
 */
export interface SmartMenuAnnotations {
  /** A selection or word-under-caret mapped confidently to rendered text. */
  insertCommentEnabled: boolean;
  /** The caret sits inside an existing comment's painted range. */
  deleteCommentEnabled: boolean;
  /** The marker vocabulary in its fixed display order (owner-supplied). */
  colors: readonly string[];
  /** Insert (selection/word) or recolor (caret on a highlight) is possible. */
  colorsEnabled: boolean;
  /** The last-used marker color — its row carries the hotkey cue. */
  armedColor: string;
  /** No selection and the caret sits on an existing highlight. */
  removeHighlightEnabled: boolean;
}

/** SPEC43 §2.10: one menu row — enabled unless said otherwise, and the
 * optional keys omitted rather than set undefined. Shared by both builders. */
const item = (
  id: string,
  label: string,
  opts: { hotkey?: string; enabled?: boolean; submenu?: SmartMenuEntry[] } = {}
): SmartMenuEntry => ({
  id,
  label,
  enabled: opts.enabled !== false,
  ...(opts.hotkey ? { hotkey: opts.hotkey } : {}),
  ...(opts.submenu ? { submenu: opts.submenu } : {}),
});

/**
 * PRD 023 §13 (issue #287): the ONE definition of the Comment ▸ and
 * Highlight ▸ entries, shared by `buildSmartMenu` (the editor's full menu)
 * and the preview selection button's annotation-only menu — labels, ids,
 * order and enabled rules can never drift between the two surfaces. Ids stay
 * `comment` / `highlight` / `insert-comment` / `delete-comment` /
 * `hl-<color>` / `remove-highlight`, so the `smart-edit-<id>` testids match
 * everywhere.
 */
export function buildAnnotationMenu(
  a: SmartMenuAnnotations,
  hotkeys: HotkeyMap,
  isMac: boolean
): SmartMenuEntry[] {
  const hk = (combo: string) => displayCombo(combo, isMac);
  return [
    item('comment', 'Comment', {
      submenu: [
        item('insert-comment', 'Insert Comment', {
          hotkey: hk(hotkeys.insertComment),
          enabled: a.insertCommentEnabled,
        }),
        item('delete-comment', 'Delete Comment', { enabled: a.deleteCommentEnabled }),
      ],
    }),
    item('highlight', 'Highlight', {
      submenu: [
        // PRD 023 §9: the four colors in fixed vocabulary order — never
        // reordered by last-used; the armed color's cue is the Mod+Alt+H
        // hotkey it would apply (PRD 022 Req 4).
        ...a.colors.map((c) =>
          item(`hl-${c}`, c.charAt(0).toUpperCase() + c.slice(1), {
            enabled: a.colorsEnabled,
            ...(c === a.armedColor ? { hotkey: hk(hotkeys.applyHighlight) } : {}),
          })
        ),
        item('remove-highlight', 'Remove Highlight', { enabled: a.removeHighlightEnabled }),
      ],
    }),
  ];
}

export interface SmartMenuCtx {
  table: boolean;
  image: boolean;
  hasSelection: boolean;
  canPaste: boolean;
  hotkeys: HotkeyMap;
  isMac: boolean;
  /** PRD 023 §7 (issue #286): annotation entries; null/absent ⇒ gate closed. */
  annotations?: SmartMenuAnnotations | null;
  /** SPEC40 §1.2: the global grid view is on — the toggle item flips it. */
  gridView: boolean;
  /** SPEC41 §1.2: the global inline-image view is on. */
  imageView: boolean;
  /** Issue #157: the global fenced-code card view is on. */
  codeView: boolean;
  /** PRD 013 Req 6: the global edit-pane diagram view is on. */
  diagramView: boolean;
  /** SPEC43 §11 (issue #270): the global rendered-links view is on. */
  linkView: boolean;
  /** Issue #318: the global edit-pane callout view is on — the toggle row flips it. */
  calloutView: boolean;
  /**
   * SPEC43 §11 (issue #270): the caret/selection head sits inside a link
   * that has a URL — resolved by the owner through `linkAt` (linkSpans.ts),
   * pure logic like `table`/`image`; an image reference never sets it.
   */
  link: boolean;
}

export function buildSmartMenu(ctx: SmartMenuCtx): SmartMenuEntry[] {
  const hk = (combo: string) => displayCombo(combo, ctx.isMac);
  const h = ctx.hotkeys;

  const out: SmartMenuEntry[] = [];
  // SPEC37 §2.1: the Table submenu is always present, first; its children
  // carry enabled flags by context. Resize Image… stays the SPEC43 stub.
  out.push(
    item('table', 'Table', {
      submenu: [
        // SPEC40 §1.2: one global switch for every table, always available.
        item('toggle-grid', ctx.gridView ? 'Show Raw Tables' : 'Show Table Grid'),
        item('insert-table', 'Insert Table', { enabled: !ctx.table }),
        item('delete-table', 'Delete Table', { enabled: ctx.table }),
      ],
    })
  );
  // SPEC41 §1.2: the Image submenu replaces the SPEC43 top-level stub.
  out.push(
    item('image', 'Image', {
      submenu: [
        item('toggle-images', ctx.imageView ? 'Show Raw Images' : 'Show Rendered Images'),
        item('insert-image', 'Insert Image…'),
        item('delete-image', 'Delete Image', { enabled: ctx.image }),
        item('resize-image', 'Resize Image', { enabled: ctx.image }),
      ],
    })
  );
  // Issue #157: the Code Block submenu — the fenced-code card view's global
  // toggle, mirroring Table/Image above. Its ids stay clear of the existing
  // top-level 'code' (Inline Code) and 'code-block' (insert) items.
  out.push(
    item('code-block-view', 'Code Block', {
      submenu: [item('toggle-code-blocks', ctx.codeView ? 'Show Raw Code' : 'Show Rendered Code')],
    })
  );
  // PRD 013 Req 6: the Diagram submenu — the edit-pane diagram view's global
  // toggle, mirroring Table/Image/Code Block above. Its ids collide with
  // nothing existing ('diagram' and 'toggle-diagrams' are both new).
  out.push(
    item('diagram', 'Diagram', {
      submenu: [
        item('toggle-diagrams', ctx.diagramView ? 'Show Raw Diagrams' : 'Show Rendered Diagrams'),
      ],
    })
  );
  // SPEC43 §11 (issue #270): the Link submenu, after Diagram — the id is
  // `link-view` (the `code-block-view` precedent: `link` is taken by the
  // Create Link row below, which keeps its id so runFormat's wrapLink branch,
  // the SmartFormatOp union, fmtLink and the hk.link binding are untouched;
  // only the row's location in the menu tree changes). Open Link is listed
  // always and enabled only with the caret inside a URL-carrying link.
  out.push(
    item('link-view', 'Link', {
      submenu: [
        item('toggle-links', ctx.linkView ? 'Show Raw Links' : 'Show Rendered Links'),
        item('link', 'Create Link', { hotkey: hk(h.link) }),
        item('open-link', 'Open Link', { hotkey: hk(h.openLink), enabled: ctx.link }),
      ],
    })
  );
  // PRD 023 §§7–11 (issue #286): Comment then Highlight, below Diagram and
  // above the Bold separator — the Table submenu's always-listed Insert/
  // Delete idiom, each row enabled by its own condition. The rows come from
  // the shared builder (PRD 023 §13, issue #287), so the editor menu and the
  // preview selection button's annotation-only menu can never drift.
  if (ctx.annotations) {
    out.push(...buildAnnotationMenu(ctx.annotations, ctx.hotkeys, ctx.isMac));
  }
  out.push('sep');

  out.push(
    item('bold', 'Bold', { hotkey: hk(h.bold) }),
    item('italic', 'Italic', { hotkey: hk(h.italic) }),
    item('strike', 'Strikethrough', { hotkey: hk(h.strikethrough) }),
    item('code', 'Inline Code', { hotkey: hk(h.inlineCode) }),
    // SPEC43 §11 (issue #270): no top-level `link` row — Create Link lives
    // under the Link submenu above.
    'sep',
    item('heading', 'Heading', {
      submenu: [
        item('h1', 'Heading 1', { hotkey: hk(h.heading1) }),
        item('h2', 'Heading 2', { hotkey: hk(h.heading2) }),
        item('h3', 'Heading 3', { hotkey: hk(h.heading3) }),
        item('h4', 'Heading 4', { hotkey: hk(h.heading4) }),
        item('h5', 'Heading 5', { hotkey: hk(h.heading5) }),
        item('h6', 'Heading 6', { hotkey: hk(h.heading6) }),
      ],
    }),
    item('lists', 'Lists', {
      submenu: [
        item('bullet', 'Bullet List', { hotkey: hk(h.bulletList) }),
        item('numbered', 'Numbered List', { hotkey: hk(h.numberedList) }),
        item('task', 'Task List', { hotkey: hk(h.taskList) }),
      ],
    }),
    item('callout', 'Callout', {
      submenu: [
        // Issue #318: the edit-pane callout view's global toggle, first in
        // the submenu — the toggle-grid / toggle-links idiom. The five insert
        // rows below keep their ids, labels, order and no-hotkey status.
        item('toggle-callouts', ctx.calloutView ? 'Show Raw Callouts' : 'Show Rendered Callouts'),
        item('note', 'Note'),
        item('tip', 'Tip'),
        item('important', 'Important'),
        item('warning', 'Warning'),
        item('caution', 'Caution'),
      ],
    }),
    item('quote', 'Blockquote', { hotkey: hk(h.blockquote) }),
    item('code-block', 'Code Block', { hotkey: hk(h.codeBlock) }),
    item('hr', 'Horizontal Rule', { hotkey: hk(h.horizontalRule) }),
    'sep',
    item('cut', 'Cut', { hotkey: hk('Mod+X'), enabled: ctx.hasSelection }),
    item('copy', 'Copy', { hotkey: hk('Mod+C'), enabled: ctx.hasSelection })
  );
  if (ctx.canPaste) out.push(item('paste', 'Paste', { hotkey: hk('Mod+V') }));
  return out;
}
