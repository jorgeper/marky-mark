import { lazy, Suspense, useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getPlatform, type Platform } from './platform';
import { renderMarkdown } from './lib/markdown';
import { type Anchor, type CommentData, createAnchor, reanchor, type ReanchorMatch } from './lib/anchoring';
import { getDocText, highlightRange, offsetsToRange, rangeToOffsets, rectForOffsets } from './lib/domtext';
import { parseSidecar, serializeSidecar, sidecarPathFor } from './lib/sidecar';
import { attachEmbedded, mergeComments, splitEmbedded } from './lib/embedded';
import {
  DEFAULT_SETTINGS,
  MARGIN_WIDTHS,
  parseSettings,
  serializeSettings,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  ZOOM_LEVELS,
  type Settings,
} from './lib/settings';
import { displayCombo, eventMatches } from './lib/hotkeys';
import { dispatchCommand, registerCommands, registerRecentHandler, type CommandId } from './lib/commands';
import { buildMenuSpec } from './lib/menuSpec';
import { stepComment } from './lib/commentNav';
import { lineAtOffset, offsetForLine, type SyncAnchor } from './lib/scrollSync';
import type { EditorSearchHandle, EditorSyncHandle, SmartEditHandle, SmartFormatOp } from './components/Editor';
import { extractReviewPayload } from './lib/reviewBundle';
import { buildStaticHtml, statsLine, type StaticComment } from './lib/exportDoc';
import { ExportDialog, type ExportRequest } from './components/ExportDialog';
import { UpdateDialog } from './components/UpdateDialog';
import { diffLineSets, type DiffLineSets } from './lib/diffLines';
import { parsePositions, positionFor, rememberPosition, serializePositions, type PositionStore } from './lib/readingPositions';
import { clearRecent, parseRecent, recentMenuEntries, rememberRecent, removeRecent, serializeRecent, type RecentStore } from './lib/recentFiles';
import {
  ancestorsOf,
  isMarkdownFile,
  parseFolderState,
  serializeFolderState,
  visibleEntries,
  type DirEntry,
} from './lib/folderTree';
import { relativePath, remapPath, uniqueChildName } from './lib/folderOps';
import { FolderPanel } from './components/FolderPanel';
import { countWords } from './lib/wordCount';
import { expandImageName, extForMime, imageMarkdownRef, sanitizeImageName } from './lib/imagePaste';
import { applyImageRewrite } from './lib/imageResize';
import { HeadingPalette, type PaletteHeading } from './components/HeadingPalette';
import {
  buildAuxInit,
  EV_AUX_INIT,
  EV_AUX_READY,
  EV_AUX_REQUEST,
  EV_SETTINGS_CHANGED,
  EV_SETTINGS_EDIT,
  EV_THEMES_CHANGED,
  mergeSettingsEdit,
  type AuxRequest,
} from './lib/auxProtocol';
import { VimNavResolver } from './lib/vimnav';
import { findNormalized, mapSelectionToSource, visibleTextForRange } from './lib/selectionMap';
import { parseFrontMatter } from './lib/frontmatter';
import { isStaleDraft, parseDraft, serializeDraft, type Draft } from './lib/drafts';
import { FindBar } from './components/FindBar';
import { FrontMatterCard } from './components/FrontMatterCard';
import type { Theme } from './lib/themes';
import { applyThemeCss, loadAllThemes } from './themeRuntime';
import { FIXTURES } from './bundled';
import { AppBadge, Toolbar } from './components/Toolbar';
import { ImageResizer, type ImageRewriteRequest } from './components/ImageResizer';
import { CommentCard } from './components/CommentCard';
import { SettingsPanel } from './components/SettingsPanel';
import { AboutDialog } from './components/AboutDialog';

const Editor = lazy(() => import('./components/Editor'));

const CARD_GAP = 8;
/** Auto-hiding toolbar timings (SPEC4 §2). */
export const TOOLBAR_GRACE_MS = 2500;
export const TOOLBAR_HIDE_DELAY_MS = 400;

type Positions = Record<string, ReanchorMatch | null>;
type Mode = 'preview' | 'edit';

/** SPEC15 §3.3: anchor tops in the scroller's content coordinates. */
function collectAnchors(scroller: HTMLElement, docEl: HTMLElement): SyncAnchor[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  return Array.from(docEl.querySelectorAll<HTMLElement>('[data-mm-line]')).map((el) => ({
    line: Number(el.dataset.mmLine),
    top: el.getBoundingClientRect().top - base,
  }));
}

function anchorsEqual(a: Anchor, b: Anchor): boolean {
  return a.exact === b.exact && a.prefix === b.prefix && a.suffix === b.suffix && a.start === b.start && a.end === b.end;
}

export default function App() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [docPath, setDocPath] = useState<string | null>(null);
  // SPEC22 §1: a blank unsaved buffer (File → New) — no path until first Save.
  const [untitled, setUntitled] = useState(false);
  const [buffer, setBuffer] = useState('');
  const [savedText, setSavedText] = useState('');
  const [mode, setMode] = useState<Mode>('preview');
  const [html, setHtml] = useState('');
  const [comments, setComments] = useState<CommentData[]>([]);
  const [positions, setPositions] = useState<Positions>({});
  // SPEC29: Open Recent (MRU, persisted to recent.json; menu rebuild rides it).
  const [recent, setRecent] = useState<RecentStore>({ version: 1, entries: [] });
  // SPEC34: the folder sidebar — root, expanded set, and per-dir listings.
  const [folderRoot, setFolderRoot] = useState<string | null>(null);
  const [folderExpanded, setFolderExpanded] = useState<Set<string>>(new Set());
  const [folderChildren, setFolderChildren] = useState<Record<string, DirEntry[]>>({});
  const [folderShowNonMd, setFolderShowNonMd] = useState(false);
  // SPEC35 §4–§5: the row renaming in place (openOnDone: a just-created file
  // opens when the rename commits or cancels), and a failed commit's error.
  const [folderRenaming, setFolderRenaming] = useState<{ path: string; openOnDone: boolean } | null>(null);
  const [folderRenameError, setFolderRenameError] = useState<string | null>(null);
  // SPEC35 §6: the delete confirmation — “Move ‘NAME’ to the Trash?”.
  const [folderDeletePrompt, setFolderDeletePrompt] = useState<{ path: string; isDir: boolean } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(true);
  // SPEC26 §3: per-document front-matter override — null means "follow the
  // setting". Beats the boot race where #open docs load before settings do.
  const [fmOverride, setFmOverride] = useState<boolean | null>(null);
  // SPEC30 §1: the find bar (one bar, two engines).
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findDebounced, setFindDebounced] = useState('');
  const [findReplace, setFindReplace] = useState('');
  const [findCount, setFindCount] = useState(0);
  const [findCurrent, setFindCurrent] = useState(0);
  const [findFocusTick, setFindFocusTick] = useState(0);
  // SPEC30 §3: the boot-time draft offer.
  const [restorePrompt, setRestorePrompt] = useState<Draft | null>(null);
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [selInfo, setSelInfo] = useState<{ start: number; end: number; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [closePrompt, setClosePrompt] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<DiffLineSets | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteHeadings, setPaletteHeadings] = useState<PaletteHeading[]>([]);
  const [chip, setChip] = useState('');
  // SPEC20 §2: transient bottom notice (paste feedback); auto-dismisses.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending intent awaiting the unsaved-changes decision: open a path, or
  // start a new untitled buffer (SPEC22 §1.2).
  const [openPrompt, setOpenPrompt] = useState<{ kind: 'open'; path: string } | { kind: 'new' } | null>(null);
  // Auto-hiding toolbar (SPEC4 §2): launch grace → hover/pin driven.
  const [graceOver, setGraceOver] = useState(false);
  const [toolbarHover, setToolbarHover] = useState(false);
  const [toolbarFocus, setToolbarFocus] = useState(false);
  const [menuPin, setMenuPin] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  const docRef = useRef<HTMLDivElement>(null);
  const splitDocRef = useRef<HTMLDivElement>(null);
  const splitPreviewRef = useRef<HTMLDivElement>(null);
  // Parked CodeMirror state (doc + undo history), so toggling preview↔edit
  // never loses undo (SPEC7 §6). Reset when another document opens.
  const editorHistoryRef = useRef<unknown>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const vimRef = useRef(new VimNavResolver());
  const docTextRef = useRef('');
  const navLabelRef = useRef('');
  const editorSyncRef = useRef<EditorSyncHandle | null>(null);
  const editorInsertRef = useRef<((text: string) => void) | null>(null);
  /** SPEC23 §1: imperative mirrored-selection entry into the mounted editor. */
  const editorSelectRef = useRef<((from: number, to: number) => void) | null>(null);
  /** SPEC30 §1.4: the mounted editor's find/replace engine. */
  const editorSearchRef = useRef<EditorSearchHandle | null>(null);
  /** SPEC36 §5.2: the mounted editor's Smart Edit handle — null in preview,
   * so every format command is a silent no-op there. */
  const smartEditRef = useRef<SmartEditHandle | null>(null);
  /** SPEC30 §1.3: preview match mark groups, index-aligned with the count. */
  const findMarksRef = useRef<HTMLElement[][]>([]);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftWrittenRef = useRef(false);
  /**
   * SPEC30 §2: set SYNCHRONOUSLY the moment any explicit open starts —
   * openDoc's own docPath lands only after async I/O, so the boot reopen
   * timer must not race an in-flight association/hash open.
   */
  const explicitOpenRef = useRef(false);
  // SPEC25: selection carry across mode switches.
  const lastEditorSelRef = useRef<{ from: number; to: number }>({ from: 0, to: 0 });
  const pendingEditorSelRef = useRef<{ from: number; to: number } | null>(null);
  const pendingPreviewSelRef = useRef<{ from: number; to: number } | null>(null);
  /** True once the preview injection pass ran to completion for the current DOM. */
  const injectionCompleteRef = useRef(false);
  const positionsRef = useRef<PositionStore>({ version: 1, entries: [] });
  const skipSaveRef = useRef(true);
  const unwatchRef = useRef<(() => void) | null>(null);
  /** Source line carried across mode switches (line-anchored, not ratio). */
  const pendingScrollLineRef = useRef<number | null>(null);

  const dirty = buffer !== savedText;
  // SPEC26: display-parsed front matter for the card (null ⇒ none).
  const frontMatter = useMemo(() => ((docPath || untitled) ? parseFrontMatter(buffer) : null), [buffer, docPath, untitled]);
  const showFrontmatter = fmOverride ?? settings.showFrontmatter;
  // SPEC12 §2.3: a platform that owns a native menu gets no in-app header.
  const nativeMenu = !!platform?.setAppMenu;

  // Refs mirroring state, for stable event handlers.
  const stateRef = useRef({
    settings,
    mode,
    dirty,
    docPath,
    untitled,
    buffer,
    savedText,
    comments,
    platform,
    themes,
    positions,
    activeId,
    showComments,
    html,
  });
  stateRef.current = {
    settings,
    mode,
    dirty,
    docPath,
    untitled,
    buffer,
    savedText,
    comments,
    platform,
    themes,
    positions,
    activeId,
    showComments,
    html,
  };

  // --- SPEC23 §4: dev-shim-only __mmEdit seam (same gating as __mmMenu) ---------
  const seamEditState = useCallback(
    (s: { head: number; headLine: number; selFrom: number; selTo: number; selText: string; focused: boolean }) => {
      if (stateRef.current.platform?.kind !== 'browser') return;
      window.__mmEdit = { nav: window.__mmEdit?.nav ?? false, ...s };
    },
    []
  );
  const seamVimMode = useCallback((nav: boolean) => {
    if (stateRef.current.platform?.kind !== 'browser') return;
    window.__mmEdit = {
      head: 0,
      headLine: 1,
      selFrom: 0,
      selTo: 0,
      selText: '',
      focused: false,
      ...(window.__mmEdit ?? {}),
      nav,
    };
  }, []);

  /**
   * SPEC25 §1 (and SPEC23 §1): map the live native selection inside a preview
   * pane to source offsets — exact via mapSelectionToSource, else the
   * covering source line range (blank tail lines trimmed). Null when there
   * is no usable selection in the pane.
   */
  const sourceRangeFromDomSelection = useCallback((pane: HTMLElement): { from: number; to: number } | null => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!pane.contains(range.startContainer) || !pane.contains(range.endContainer)) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const buffer = stateRef.current.buffer;
    const lines = buffer.split('\n');
    const stamped = Array.from(pane.querySelectorAll<HTMLElement>('[data-mm-line]'));
    const blockOf = (node: Node): HTMLElement | null => {
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
      const hit = el?.closest<HTMLElement>('[data-mm-line]');
      if (hit) return hit;
      let best: HTMLElement | null = null;
      for (const s of stamped) {
        if (s.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) best = s;
        else break;
      }
      return best;
    };
    const startEl = blockOf(range.startContainer);
    const endEl = blockOf(range.endContainer);
    const fromLine = startEl ? Number(startEl.dataset.mmLine) : 1;
    let toLine = lines.length;
    if (endEl) {
      const endLine = Number(endEl.dataset.mmLine);
      const next = stamped.find((el) => Number(el.dataset.mmLine) > endLine && el !== endEl);
      toLine = next ? Number(next.dataset.mmLine) - 1 : lines.length;
      if (toLine < endLine) toLine = endLine;
    }
    if (toLine < fromLine) toLine = fromLine;
    const hit = mapSelectionToSource(buffer, fromLine, toLine, text);
    if (hit) return hit;
    // Fallback: the covering source line range — never a wrong guess.
    const starts: number[] = [0];
    for (let n = 0; n < lines.length - 1; n++) starts.push(starts[n] + lines[n].length + 1);
    const lo = Math.min(fromLine, lines.length);
    let hi = Math.min(toLine, lines.length);
    while (hi > lo && lines[hi - 1].trim() === '') hi--;
    return { from: starts[lo - 1], to: starts[hi - 1] + lines[hi - 1].length };
  }, []);

  // --- SPEC30 §1.3: the preview find engine (doc-text marks) -------------------
  const clearFindMarks = useCallback(() => {
    const pane = docRef.current;
    findMarksRef.current = [];
    if (!pane) return;
    pane.querySelectorAll('mark.mm-find').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
    });
  }, []);

  /** Toggle the active class onto group i and center it. */
  const activateFindMatch = useCallback((i: number) => {
    findMarksRef.current.forEach((g, k) => g.forEach((m) => m.classList.toggle('mm-find-active', k === i)));
    findMarksRef.current[i]?.[0]?.scrollIntoView({ block: 'center' });
  }, []);

  /** Wrap every case-insensitive literal match; returns the match count. */
  const applyFindMarks = useCallback(
    (query: string): number => {
      const pane = docRef.current;
      clearFindMarks();
      if (!pane || !query) return 0;
      const text = docTextRef.current;
      const hay = text.toLowerCase();
      const needle = query.toLowerCase();
      const groups: HTMLElement[][] = [];
      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
        const marks = highlightRange(pane, at, at + needle.length, '__find__');
        for (const m of marks) {
          m.className = 'mm-find';
          delete m.dataset.cid; // never the comment machinery's business
        }
        if (marks.length > 0) groups.push(marks);
      }
      findMarksRef.current = groups;
      return groups.length;
    },
    [clearFindMarks]
  );

  /** SPEC30 §1: open (or refocus) the bar, prefilled from the selection. */
  const openFind = useCallback(() => {
    const st = stateRef.current;
    if (!st.docPath && !st.untitled) return; // no document, nothing to find
    let prefill = '';
    if (st.mode === 'preview') {
      prefill = document.getSelection()?.toString() ?? '';
    } else {
      const { from, to } = lastEditorSelRef.current;
      prefill = st.buffer.slice(from, to);
    }
    if (prefill.trim() && prefill.length <= 200) setFindQuery(prefill);
    setFindOpen(true);
    setFindFocusTick((t) => t + 1);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    clearFindMarks();
    editorSearchRef.current?.clear();
    setFindCount(0);
    setFindCurrent(0);
  }, [clearFindMarks]);

  const stepFind = useCallback(
    (dir: 1 | -1) => {
      const st = stateRef.current;
      if (st.mode === 'preview') {
        const n = findMarksRef.current.length;
        if (n === 0) return;
        setFindCurrent((cur) => {
          const next = ((Math.max(cur, 1) - 1 + dir + n) % n) + 1;
          activateFindMatch(next - 1);
          return next;
        });
      } else {
        const res = dir === 1 ? editorSearchRef.current?.next() : editorSearchRef.current?.prev();
        if (res) {
          setFindCount(res.count);
          setFindCurrent(res.current);
        }
      }
    },
    [activateFindMatch]
  );

  // --- SPEC24 §1: editor → preview synthetic highlight -------------------------
  const mirrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Unwrap every mirror mark; text-node normalization keeps anchors stable. */
  const clearMirrorMarks = useCallback(() => {
    const pane = splitDocRef.current;
    if (!pane) return;
    pane.querySelectorAll('mark.mm-mirror-sel').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
    });
  }, []);

  /**
   * Editor selection reports drive the seam and the reverse mirror. The
   * preview side is marks, never the native selection (a focused CM
   * re-asserts that); unfocused reports only clear — the forward mirror's
   * own dispatch can never bounce back (SPEC24 §1.4).
   */
  const handleEditState = useCallback(
    (s: { head: number; headLine: number; selFrom: number; selTo: number; selText: string; focused: boolean }) => {
      seamEditState(s);
      lastEditorSelRef.current = { from: s.selFrom, to: s.selTo }; // SPEC25 §2.1
      const st = stateRef.current;
      if (st.mode !== 'edit' || !st.settings.splitEdit) return;
      if (mirrorTimerRef.current) clearTimeout(mirrorTimerRef.current);
      mirrorTimerRef.current = setTimeout(() => {
        const pane = splitDocRef.current;
        if (!pane) return;
        clearMirrorMarks();
        if (!s.focused || s.selFrom === s.selTo) return;
        const buffer = stateRef.current.buffer;
        const needle = visibleTextForRange(buffer, s.selFrom, s.selTo);
        if (!needle.replace(/\s+/g, ' ').trim()) return;
        // Region: the stamped blocks covering the selection's source lines.
        const fromLine = buffer.slice(0, s.selFrom).split('\n').length;
        const toLine = buffer.slice(0, s.selTo).split('\n').length;
        const stamped = Array.from(pane.querySelectorAll<HTMLElement>('[data-mm-line]'));
        if (stamped.length === 0) return;
        let startEl = stamped[0];
        for (const el of stamped) {
          if (Number(el.dataset.mmLine) <= fromLine) startEl = el;
          else break;
        }
        const after = stamped.find((el) => Number(el.dataset.mmLine) > toLine);
        const region = document.createRange();
        region.setStartBefore(startEl);
        if (after) region.setEndBefore(after);
        else if (pane.lastChild) region.setEndAfter(pane.lastChild);
        else return;
        const { start: rs, end: re } = rangeToOffsets(pane, region);
        const docText = getDocText(pane);
        const hit = findNormalized(docText.slice(rs, re), needle);
        // Unique hit → the exact rendered text; else the whole covered region.
        const [hs, he] = hit ? [rs + hit.start, rs + hit.end] : [rs, re];
        for (const m of highlightRange(pane, hs, he, '__mirror__')) {
          m.className = 'mm-mirror-sel';
          delete m.dataset.cid;
        }
      }, 150);
    },
    [seamEditState, clearMirrorMarks]
  );

  /** SPEC20 §2: transient feedback chip; each message restarts the 4s clock. */
  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  /** SPEC30 §1.4: replace current / all — edit mode only, normal undo path. */
  const replaceFind = useCallback(
    (all: boolean) => {
      const h = editorSearchRef.current;
      if (!h || stateRef.current.mode !== 'edit') return;
      h.setQuery(findDebounced, findReplace, false); // refresh replace text in place
      if (all) {
        const n = h.replaceAllMatches();
        showNotice(`Replaced ${n} ${n === 1 ? 'match' : 'matches'}`);
        setFindCount(0);
        setFindCurrent(0);
      } else {
        const res = h.replaceOne();
        setFindCount(res.count);
        setFindCurrent(res.current);
      }
    },
    [findDebounced, findReplace, showNotice]
  );


  /**
   * SPEC20 §2: land pasted clipboard images as files next to the document
   * and hand the editor the markdown to insert. Null ⇒ nothing to insert
   * (the notice already told the user why).
   */
  const pasteImages = useCallback(
    async (files: File[]): Promise<string | null> => {
      const s = stateRef.current;
      const p = s.platform;
      if (!p) return null;
      if (!p.writeBinaryFile) {
        showNotice('Image paste needs the desktop app');
        return null;
      }
      if (!s.docPath) {
        showNotice('Save the document first to paste images');
        return null;
      }
      const folder = s.settings.imageFolder;
      const folderPath = p.join(p.dirname(s.docPath), folder);
      const taken = new Set((await p.readDirNames(folderPath)).map((n) => n.toLowerCase()));
      const docName = p.basename(s.docPath).replace(/\.[^.]+$/, '');
      const refs: string[] = [];
      try {
        for (const f of files) {
          const name = expandImageName(s.settings.imageNamePattern, extForMime(f.type), {
            docName,
            now: new Date(),
            exists: (fn) => taken.has(fn.toLowerCase()),
          });
          await p.writeBinaryFile(p.join(folderPath, name), new Uint8Array(await f.arrayBuffer()));
          taken.add(name.toLowerCase());
          refs.push(imageMarkdownRef(folder, name));
        }
      } catch (err) {
        showNotice(`Couldn’t save the pasted image: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
      return refs.join('\n');
    },
    [showNotice]
  );

  /**
   * SPEC20 §4.2: persist a resize (or a double-click width removal) by
   * splicing the image's source span in the buffer. Flows through the same
   * path as typing — dirty dot, ⌘S, autosave-on-toggle, re-render. Returns
   * the image's new span so the resizer can keep it selected; null = no-op
   * (removing a width from plain markdown syntax).
   */
  const rewriteImage = useCallback((req: ImageRewriteRequest): { start: number; end: number } | null => {
    const s = stateRef.current;
    const res = applyImageRewrite(s.buffer, req.start, req.end, req.parts, req.width);
    if (!res) return null;
    setBuffer(res.text);
    return { start: req.start, end: res.newEnd };
  }, []);

  /**
   * SPEC20 follow-up: Insert Image… — pick an image file, copy it into the
   * images folder next to the doc (unless it already lives there), reference
   * it at the cursor. Edit mode only; the notices explain everything else.
   */
  const insertImage = useCallback(async () => {
    const s = stateRef.current;
    const p = s.platform;
    if (!p) return;
    if (!p.openImageDialog || !p.copyFile) {
      showNotice('Insert Image needs the desktop app');
      return;
    }
    if (s.mode !== 'edit') {
      showNotice(`Insert Image works in edit mode — ${displayCombo(s.settings.hotkeys.toggleEdit, p.isMac)} first`);
      return;
    }
    if (!s.docPath) {
      showNotice('Save the document first to insert images');
      return;
    }
    const picked = await p.openImageDialog();
    if (!picked) return;
    const folder = s.settings.imageFolder;
    const folderPath = p.join(p.dirname(s.docPath), folder);
    try {
      let fileName: string;
      if (p.dirname(picked) === folderPath) {
        fileName = p.basename(picked); // already in the folder — just reference it
      } else {
        const base = p.basename(picked);
        const dot = base.lastIndexOf('.');
        const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : 'png';
        const stem = sanitizeImageName(dot > 0 ? base.slice(0, dot) : base);
        const taken = new Set((await p.readDirNames(folderPath)).map((n) => n.toLowerCase()));
        fileName = expandImageName(stem, ext, {
          docName: '',
          now: new Date(),
          exists: (fn) => taken.has(fn.toLowerCase()),
        });
        await p.copyFile(picked, p.join(folderPath, fileName));
      }
      editorInsertRef.current?.(imageMarkdownRef(folder, fileName));
    } catch (err) {
      showNotice(`Couldn’t insert the image: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [showNotice]);

  /** Read a doc file and its comments from both stores (trailer wins by id). */
  const loadDocParts = useCallback(async (p: Platform, path: string) => {
    const raw = await p.readTextFile(path);
    const split = splitEmbedded(raw);
    let sidecarComments: CommentData[] = [];
    try {
      const sidecar = sidecarPathFor(path);
      if (await p.exists(sidecar)) sidecarComments = parseSidecar(await p.readTextFile(sidecar));
    } catch {
      sidecarComments = []; // corrupt sidecar: ignore rather than crash
    }
    return { content: split.content, comments: mergeComments(split.comments, sidecarComments) };
  }, []);

  /** Source line at the top of the current view, whatever the mode. */
  const currentTopLine = useCallback((): number | null => {
    const s = stateRef.current;
    if (!s.docPath) return null;
    if (s.mode === 'edit') return editorSyncRef.current?.topLine() ?? null;
    const ws = workspaceRef.current;
    const doc = docRef.current;
    if (!ws || !doc || ws.scrollHeight === 0) return null;
    return lineAtOffset(collectAnchors(ws, doc), ws.scrollHeight, ws.scrollTop);
  }, []);

  /** SPEC16 §3: remember where we are in the given doc, write-through. */
  const recordPosition = useCallback((path: string | null, line: number | null) => {
    if (!path || line === null) return;
    positionsRef.current = rememberPosition(positionsRef.current, path, line, new Date().toISOString());
    const p = stateRef.current.platform;
    if (!p) return;
    void (async () => {
      try {
        await p.writeTextFile(p.join(await p.configDir(), 'positions.json'), serializePositions(positionsRef.current));
      } catch {
        /* best effort */
      }
    })();
  }, []);

  /** SPEC29 §2: set + best-effort persist the recent list in one move. */
  const commitRecent = useCallback((next: RecentStore, platformNow?: Platform) => {
    recentRef.current = next;
    setRecent(next);
    // Boot-time opens drain before stateRef sees the platform (it lands on
    // the next render) — callers that HAVE the platform pass it explicitly.
    const p = platformNow ?? stateRef.current.platform;
    if (!p) return;
    void (async () => {
      try {
        await p.writeTextFile(p.join(await p.configDir(), 'recent.json'), serializeRecent(next));
      } catch {
        /* best effort */
      }
    })();
  }, []);
  const recentRef = useRef<RecentStore>({ version: 1, entries: [] });
  /** SPEC34 §2.3: write-through mirror of root+expanded+eye for foldertree.json. */
  const folderStateRef = useRef<{ root: string | null; expanded: Set<string>; showNonMd: boolean }>({
    root: null,
    expanded: new Set(),
    showNonMd: false,
  });

  const persistFolderState = useCallback((platformNow?: Platform) => {
    const p = platformNow ?? stateRef.current.platform;
    if (!p) return;
    const st = folderStateRef.current;
    void (async () => {
      try {
        await p.writeTextFile(
          p.join(await p.configDir(), 'foldertree.json'),
          serializeFolderState({ version: 1, root: st.root, expanded: [...st.expanded], showNonMd: st.showNonMd })
        );
      } catch {
        /* best effort */
      }
    })();
  }, []);

  /** List one directory (visible, sorted) into the children cache. */
  const listFolderDir = useCallback(async (p: Platform, dir: string) => {
    if (!p.readDirEntries) return;
    try {
      const entries = visibleEntries(await p.readDirEntries(dir));
      setFolderChildren((prev) => ({ ...prev, [dir]: entries }));
    } catch {
      setFolderChildren((prev) => ({ ...prev, [dir]: [] }));
    }
  }, []);

  /** SPEC34 §3.2: expanding always re-lists (the tree stays honest). */
  const toggleFolderDir = useCallback(
    (dir: string) => {
      const p = stateRef.current.platform;
      if (!p) return;
      setFolderExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(dir)) next.delete(dir);
        else {
          next.add(dir);
          void listFolderDir(p, dir);
        }
        folderStateRef.current = { ...folderStateRef.current, expanded: next };
        persistFolderState(p);
        return next;
      });
    },
    [listFolderDir, persistFolderState]
  );

  /** The eye toggle: flip non-markdown visibility, persist with the tree state. */
  const toggleFolderNonMd = useCallback(() => {
    const next = !folderStateRef.current.showNonMd;
    folderStateRef.current = { ...folderStateRef.current, showNonMd: next };
    setFolderShowNonMd(next);
    persistFolderState();
  }, [persistFolderState]);

  /**
   * SPEC34 §5: expand the ancestor chain of `path` and select its row.
   * Outside-root (or rootless) opens retarget the persisted root first.
   * Only ever called with the panel visible.
   */
  const revealInFolders = useCallback(
    async (p: Platform, path: string) => {
      if (!p.readDirEntries) return;
      let root = folderStateRef.current.root;
      let chain = root ? ancestorsOf(root, path, p.dirname) : [];
      if (chain.length === 0) {
        root = p.dirname(path);
        chain = [root];
        setFolderRoot(root);
        setFolderChildren({});
      }
      const expanded = new Set(folderStateRef.current.root === root ? folderStateRef.current.expanded : []);
      for (const dir of chain) expanded.add(dir);
      setFolderExpanded(expanded);
      folderStateRef.current = { ...folderStateRef.current, root, expanded };
      persistFolderState(p);
      for (const dir of chain) await listFolderDir(p, dir);
    },
    [listFolderDir, persistFolderState]
  );

  /** SPEC35 §5: begin (or end, with null) an in-place rename session. */
  const folderRenamingRef = useRef<{ path: string; openOnDone: boolean } | null>(null);
  const startFolderRename = useCallback((session: { path: string; openOnDone: boolean } | null) => {
    folderRenamingRef.current = session;
    setFolderRenaming(session);
    setFolderRenameError(null);
  }, []);

  /**
   * SPEC35 §4: New File / New Folder as a child of `dir` (the clicked
   * directory, or the root for the empty-area menu). The unique-named entry
   * is created on disk, the target directory expands and re-lists, and the
   * new row drops straight into in-place rename; a new file opens (through
   * the guard) when that rename commits or cancels.
   */
  const folderCreate = useCallback(
    async (p: Platform, dir: string, kind: 'file' | 'dir') => {
      if (!p.readDirEntries) return;
      try {
        const listing = await p.readDirEntries(dir);
        const name = uniqueChildName(
          listing.map((e) => e.name),
          kind === 'file' ? 'Untitled.md' : 'New Folder'
        );
        const path = p.join(dir, name);
        if (kind === 'file') await p.writeTextFile(path, '');
        else await p.mkdirp(path);
        const nextExpanded = new Set(folderStateRef.current.expanded);
        nextExpanded.add(dir); // the target opens; a new folder itself stays collapsed
        folderStateRef.current = { ...folderStateRef.current, expanded: nextExpanded };
        setFolderExpanded(nextExpanded);
        persistFolderState(p);
        await listFolderDir(p, dir);
        startFolderRename({ path, openOnDone: kind === 'file' });
      } catch {
        /* creation failed — no row to rename */
      }
    },
    [persistFolderState, listFolderDir, startFolderRename]
  );

  /** SPEC35 §3: a folder-menu item was invoked — run the operation. */
  const folderMenuAction = useCallback(
    (id: string, target: { kind: 'dir' | 'file' | 'root'; path: string }) => {
      const p = stateRef.current.platform;
      if (!p) return;
      const root = folderStateRef.current.root;
      if (id === 'reveal') void p.revealPath?.(target.path);
      else if (id === 'copy-path') void p.copyText?.(target.path);
      else if (id === 'copy-relative-path' && root) void p.copyText?.(relativePath(root, target.path));
      else if (id === 'rename') startFolderRename({ path: target.path, openOnDone: false });
      else if (id === 'new-file') void folderCreate(p, target.path, 'file');
      else if (id === 'new-folder') void folderCreate(p, target.path, 'dir');
      else if (id === 'delete') setFolderDeletePrompt({ path: target.path, isDir: target.kind === 'dir' });
    },
    [startFolderRename, folderCreate]
  );

  // Guards the SPEC15/SPEC16 preview restore against firing on stale html
  // (opening a doc from edit mode re-runs the effect before the new render).
  const renderPendingRef = useRef(false);

  // --- document loading ------------------------------------------------------
  /** Watch `path` for external changes (replacing any previous watcher). */
  const installWatcher = useCallback(
    async (p: Platform, path: string) => {
      unwatchRef.current?.();
      unwatchRef.current = null;
      try {
        unwatchRef.current = await p.watchFile(path, async () => {
          const s = stateRef.current;
          if (s.dirty || s.mode === 'edit') return; // never clobber local edits
          try {
            const fresh = await loadDocParts(p, path);
            skipSaveRef.current = true;
            setBuffer(fresh.content);
            setSavedText(fresh.content);
            setComments(fresh.comments);
          } catch {
            /* file briefly unavailable mid-write; next event will catch up */
          }
        });
      } catch {
        /* watching is best-effort */
      }
    },
    [loadDocParts]
  );

  const openDoc = useCallback(async (p: Platform, path: string) => {
    let content: string;
    let stored: CommentData[];
    try {
      ({ content, comments: stored } = await loadDocParts(p, path));
    } catch {
      return; // unreadable path (e.g. deleted file in a stale open event)
    }
    // SPEC16 §3: park the outgoing doc's position, queue the incoming one's.
    recordPosition(stateRef.current.docPath, currentTopLine());
    pendingScrollLineRef.current = positionFor(positionsRef.current, path);
    renderPendingRef.current = true; // consume the restore only against fresh html

    commitRecent(rememberRecent(recentRef.current, path, new Date().toISOString()), p); // SPEC29 §2.1
    setFindOpen(false); // SPEC30 §1.5: find never crosses documents
    setFindQuery('');
    setFindDebounced('');
    // SPEC34 §5.1: reveal in the sidebar — only when the panel is visible.
    if (stateRef.current.settings.showFolders && p.readDirEntries) void revealInFolders(p, path);

    skipSaveRef.current = true;
    editorHistoryRef.current = null; // a fresh document starts a fresh undo history
    pendingEditorSelRef.current = null; // SPEC25: selection never crosses documents
    pendingPreviewSelRef.current = null;
    lastEditorSelRef.current = { from: 0, to: 0 };
    setFmOverride(null); // SPEC26 §3.3: a new document follows the setting
    setDocPath(path);
    setUntitled(false); // SPEC22 §3.3: a real document replaces any untitled buffer
    setBuffer(content);
    setSavedText(content);
    setComments(stored);
    setPositions({});
    setActiveId(null);
    setPending(null);
    setMode('preview');
    setShowDiff(false); // SPEC16 §2: the diff toggle resets per document
    setDiff(null);

    await installWatcher(p, path);
  }, [loadDocParts, recordPosition, currentTopLine, commitRecent, revealInFolders, installWatcher]);

  /**
   * Unsaved-changes guard (SPEC4 §6): every user-initiated open routes here.
   * Dirty buffer → three-way prompt; clean buffer or same path → open directly.
   */
  const openDocGuarded = useCallback(
    (p: Platform, path: string) => {
      explicitOpenRef.current = true; // SPEC30 §2: explicit opens beat reopen
      const s = stateRef.current;
      if (s.dirty && s.docPath !== path) {
        setOpenPrompt({ kind: 'open', path });
        return;
      }
      void openDoc(p, path);
    },
    [openDoc]
  );

  /**
   * SPEC35 §5.3: after a rename lands on disk, remap every piece of state
   * that referenced the old path (the entry itself or any descendant): the
   * open docPath (title follows its effect; buffer, dirty flag, undo history,
   * and comments untouched — the next save writes the new path), the watcher,
   * the expanded set, the listing cache, and each recents entry (same MRU
   * position). Persists foldertree.json and recent.json.
   */
  const remapAfterRename = useCallback(
    (p: Platform, oldPath: string, newPath: string) => {
      const remap = (s: string) => remapPath(s, oldPath, newPath);
      const s = stateRef.current;
      const newDoc = s.docPath ? remap(s.docPath) : null;
      if (newDoc) {
        setDocPath(newDoc);
        void installWatcher(p, newDoc);
      }
      const nextExpanded = new Set([...folderStateRef.current.expanded].map((d) => remap(d) ?? d));
      folderStateRef.current = { ...folderStateRef.current, expanded: nextExpanded };
      setFolderExpanded(nextExpanded);
      setFolderChildren((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [remap(k) ?? k, v])));
      persistFolderState(p);
      const entries = recentRef.current.entries.map((en) => ({ ...en, path: remap(en.path) ?? en.path }));
      commitRecent({ ...recentRef.current, entries }, p);
    },
    [installWatcher, persistFolderState, commitRecent]
  );

  /** SPEC35 §5.3: commit an in-place rename — fs first, then the remap. */
  const folderRenameCommit = useCallback(
    async (oldPath: string, newName: string) => {
      const p = stateRef.current.platform;
      if (!p?.renameEntry) return;
      const session = folderRenamingRef.current;
      const parent = p.dirname(oldPath);
      const newPath = p.join(parent, newName);
      try {
        await p.renameEntry(oldPath, newPath);
      } catch (e) {
        setFolderRenameError(e instanceof Error ? e.message : String(e)); // input stays open (§5.4)
        return;
      }
      startFolderRename(null);
      await listFolderDir(p, parent);
      remapAfterRename(p, oldPath, newPath);
      // SPEC35 §4.2: a just-created markdown file opens through the guard.
      if (session?.openOnDone && isMarkdownFile(p.basename(newPath))) openDocGuarded(p, newPath);
    },
    [startFolderRename, listFolderDir, remapAfterRename, openDocGuarded]
  );

  const folderRenameCancel = useCallback(() => {
    const p = stateRef.current.platform;
    const session = folderRenamingRef.current;
    startFolderRename(null);
    // SPEC35 §4.2: cancelling the christening still opens the new file as-is.
    if (p && session?.openOnDone && isMarkdownFile(p.basename(session.path))) openDocGuarded(p, session.path);
  }, [startFolderRename, openDocGuarded]);

  /**
   * Persist comments per the active storage mode (SPEC2 FR-C.5). Embedded
   * writes rewrite the file as LAST-SAVED text + trailer — never flushing
   * unsaved text edits — and clean up a stale sidecar (migration). Sidecar
   * mode behaves exactly like v1.
   */
  const persistComments = useCallback(async (current: CommentData[]) => {
    const s = stateRef.current;
    if (!s.platform || !s.docPath) return;
    const p = s.platform;
    const sidecar = sidecarPathFor(s.docPath);
    try {
      if (s.settings.commentStorage === 'embedded') {
        await p.writeTextFile(s.docPath, attachEmbedded(s.savedText, current));
        if (await p.exists(sidecar)) await p.remove(sidecar);
      } else if (current.length > 0) {
        await p.writeTextFile(sidecar, serializeSidecar(current));
      } else if (await p.exists(sidecar)) {
        await p.remove(sidecar); // no comments → no sidecar litter
      }
    } catch {
      /* disk hiccup; the next change retries */
    }
  }, []);

  // --- bootstrap ---------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    (async () => {
      const p = await getPlatform();
      if (disposed) return;

      const cfg = await p.configDir();
      const settingsPath = p.join(cfg, 'settings.json');
      let loaded = DEFAULT_SETTINGS;
      try {
        if (await p.exists(settingsPath)) loaded = parseSettings(await p.readTextFile(settingsPath));
      } catch {
        /* fall back to defaults */
      }
      if (p.kind === 'web') {
        loaded = { ...loaded, commentStorage: 'embedded' }; // no sidecars on web
        // SPEC17 §2.2: a review bundle may carry its export theme — apply it
        // for the session only (setSettings below never persists by itself).
        const payload = extractReviewPayload(document);
        if (payload?.theme) loaded = { ...loaded, themeLight: payload.theme, themeDark: payload.theme };
      }
      const themeList = await loadAllThemes(p);

      // SPEC16 §3: reading positions (corruption-tolerant).
      try {
        const posPath = p.join(cfg, 'positions.json');
        if (await p.exists(posPath)) positionsRef.current = parsePositions(await p.readTextFile(posPath));
      } catch {
        /* start empty */
      }

      // SPEC29 §2.2: Open Recent, same tolerance.
      try {
        const recPath = p.join(cfg, 'recent.json');
        if (await p.exists(recPath)) {
          const loaded = parseRecent(await p.readTextFile(recPath));
          recentRef.current = loaded;
          setRecent(loaded);
        }
      } catch {
        /* start empty */
      }

      // SPEC34 §2.3: folder sidebar state, same tolerance.
      try {
        const ftPath = p.join(cfg, 'foldertree.json');
        if (p.readDirEntries && (await p.exists(ftPath))) {
          const ft = parseFolderState(await p.readTextFile(ftPath));
          const expanded = new Set(ft.expanded);
          folderStateRef.current = { root: ft.root, expanded, showNonMd: ft.showNonMd };
          setFolderRoot(ft.root);
          setFolderExpanded(expanded);
          setFolderShowNonMd(ft.showNonMd);
          if (loaded.showFolders && ft.root) {
            for (const dir of [ft.root, ...ft.expanded]) void listFolderDir(p, dir);
          }
        }
      } catch {
        /* start empty */
      }

      setPlatform(p);
      setSettings(loaded);
      setThemes(themeList);

      // Clean start (SPEC4 §5): no auto-opened welcome — only explicit opens.
      await p.onOpenFile((path) => openDocGuarded(p, path));
      await p.onFileDrop((path) => openDocGuarded(p, path));

      await p.registerCloseGuard(
        () => stateRef.current.dirty,
        () => setClosePrompt(true)
      );

      // SPEC30 §2 + §3: reopen-on-launch, then the draft offer. Explicit
      // opens (association/CLI/#open/review) land through the drains above —
      // give them a beat, then only fill a still-empty window.
      setTimeout(() => {
        void (async () => {
          if (disposed) return;
          const st = stateRef.current;
          if (loaded.reopenLastDoc && !explicitOpenRef.current && st.docPath === null && !st.untitled) {
            const top = recentRef.current.entries[0];
            if (top && (await p.exists(top.path))) await openDoc(p, top.path);
          }
          try {
            const dPath = p.join(cfg, 'draft.json');
            if (!(await p.exists(dPath))) return;
            const draft = parseDraft(await p.readTextFile(dPath));
            if (!draft) {
              await p.remove(dPath);
              return;
            }
            const disk =
              draft.docPath && (await p.exists(draft.docPath)) ? await p.readTextFile(draft.docPath) : null;
            if (isStaleDraft(draft, disk)) {
              await p.remove(dPath);
              return;
            }
            setRestorePrompt(draft);
          } catch {
            /* best effort */
          }
        })();
      }, 250);
    })();
    return () => {
      disposed = true;
    };
  }, [openDocGuarded, openDoc, listFolderDir]);

  // --- auto-hiding toolbar -----------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => setGraceOver(true), TOOLBAR_GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  const toolbarEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setToolbarHover(true);
  }, []);

  const toolbarLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setToolbarHover(false), TOOLBAR_HIDE_DELAY_MS);
  }, []);

  // Window-level arbiter: enter/leave alone can wedge "hovered" when the
  // element under the pointer (e.g. a closing menu item) is unmounted —
  // Chromium then never delivers mouseleave to the shell. Any real movement
  // re-derives the truth.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!stateRef.current.settings.autoHideToolbar) return;
      const shell = document.querySelector('.toolbar-shell');
      if (e.clientY <= 20 || (shell?.contains(e.target as Node) ?? false)) toolbarEnter();
      else toolbarLeave();
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [toolbarEnter, toolbarLeave]);

  // Same story for the focus pin: blur never reaches the shell when the
  // focused menu item unmounts, so derive it from document-level events.
  useEffect(() => {
    const deriveFocus = (e: Event) => {
      const shell = document.querySelector('.toolbar-shell');
      setToolbarFocus(!!shell && shell.contains(e.target as Node));
    };
    document.addEventListener('focusin', deriveFocus);
    document.addEventListener('mousedown', deriveFocus);
    return () => {
      document.removeEventListener('focusin', deriveFocus);
      document.removeEventListener('mousedown', deriveFocus);
    };
  }, []);

  // Auto-hide is opt-in (SPEC5 §1.2): off → the bar is simply always there.
  const toolbarShown =
    !settings.autoHideToolbar ||
    !graceOver ||
    toolbarHover ||
    toolbarFocus ||
    menuPin ||
    settingsOpen ||
    aboutOpen ||
    closePrompt ||
    openPrompt !== null;

  // --- OS light/dark tracking (live, SPEC3 §2) -----------------------------------
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // --- theme application: light/dark pair ------------------------------------------
  useEffect(() => {
    if (themes.length === 0) return;
    const wanted = prefersDark && settings.useDarkTheme ? settings.themeDark : settings.themeLight;
    const theme = themes.find((t) => t.id === wanted) ?? themes.find((t) => t.id === 'crisp') ?? themes[0];
    applyThemeCss(theme.css);
  }, [themes, settings.themeLight, settings.themeDark, settings.useDarkTheme, prefersDark]);

  // --- appearance overrides: font size, margins, zoom (SPEC3 §2) ---------------------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (settings.fontSize === 'auto') el.style.removeProperty('--mm-font-size');
    else el.style.setProperty('--mm-font-size', `${settings.fontSize}px`);
    if (settings.margins === 'default') el.style.removeProperty('--mm-content-width');
    else el.style.setProperty('--mm-content-width', MARGIN_WIDTHS[settings.margins]);
    // Text-only zoom (SPEC4 §4): a font multiplier consumed by the document
    // and editor styles — never CSS `zoom`, which would scale the whole UI.
    if (settings.zoom === 100) el.style.removeProperty('--mm-zoom');
    else el.style.setProperty('--mm-zoom', String(settings.zoom / 100));
    // `platform` in the deps: the pre-boot render has no rootRef, so this
    // must re-run once the real root mounts — otherwise defaults that equal
    // the initial state (e.g. fontSize 12) are never applied.
  }, [platform, settings.fontSize, settings.margins, settings.zoom]);

  // --- settings persistence ---------------------------------------------------
  const updateSettings = useCallback(
    (next: Settings) => {
      setSettings(next);
      const p = stateRef.current.platform;
      if (!p) return;
      void (async () => {
        const path = p.join(await p.configDir(), 'settings.json');
        await p.writeTextFile(path, serializeSettings(next));
      })();
    },
    []
  );

  /** SPEC34 §4.2: pick a directory → root; the panel opens; no file opens. */
  const openFolderCmd = useCallback(async () => {
    const p = stateRef.current.platform;
    if (!p?.openFolderDialog || !p.readDirEntries) return;
    const picked = await p.openFolderDialog();
    if (!picked) return;
    const expanded = new Set([picked]);
    setFolderRoot(picked);
    setFolderExpanded(expanded);
    setFolderChildren({});
    folderStateRef.current = { ...folderStateRef.current, root: picked, expanded };
    persistFolderState(p);
    await listFolderDir(p, picked);
    if (!stateRef.current.settings.showFolders) {
      updateSettings({ ...stateRef.current.settings, showFolders: true });
    }
  }, [listFolderDir, persistFolderState, updateSettings]);

  // --- actions -----------------------------------------------------------------
  /**
   * Save As… (SPEC3 §3): comments travel with the document to the new path.
   * Also the first save of an untitled buffer (SPEC22 §2.1), suggesting
   * Untitled.md. Returns false when unsupported or the dialog was cancelled —
   * callers with a pending action (open/new/close) must abort on false.
   */
  const saveDocAs = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current;
    const p = s.platform;
    if (!p || !p.saveFileDialog || (!s.docPath && !s.untitled)) return false;
    const target = await p.saveFileDialog(s.docPath ? p.basename(s.docPath) : 'Untitled.md');
    if (!target) return false;
    const text = s.settings.commentStorage === 'embedded' ? attachEmbedded(s.buffer, s.comments) : s.buffer;
    await p.writeTextFile(target, text);
    if (s.settings.commentStorage === 'sidecar' && s.comments.length > 0) {
      await p.writeTextFile(sidecarPathFor(target), serializeSidecar(s.comments));
    }
    await p.commitFile?.(target);
    await openDoc(p, target); // switch to the new document (title, watcher, sidecar)
    return true;
  }, [openDoc]);

  /** Returns false when there was nothing to save into (or Save As was cancelled). */
  const saveDoc = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current;
    if (!s.platform) return false;
    // SPEC22 §2.2: ⌘S on an untitled buffer is Save As….
    if (!s.docPath) return s.untitled ? saveDocAs() : false;
    const text =
      s.settings.commentStorage === 'embedded' ? attachEmbedded(s.buffer, s.comments) : s.buffer;
    await s.platform.writeTextFile(s.docPath, text);
    await s.platform.commitFile?.(s.docPath); // web download fallback for handle-less files
    setSavedText(s.buffer);
    if (s.settings.commentStorage === 'sidecar') {
      // Completes an embedded→sidecar migration: the plain write above
      // stripped the trailer; make sure the sidecar holds the comments.
      await persistComments(s.comments);
    }
    return true;
  }, [persistComments, saveDocAs]);

  const toggleMode = useCallback(() => {
    const s = stateRef.current;
    // SPEC25: carry the current selection across the mode switch.
    if (s.mode === 'preview') {
      pendingEditorSelRef.current = docRef.current ? sourceRangeFromDomSelection(docRef.current) : null;
    } else {
      const { from, to } = lastEditorSelRef.current;
      pendingPreviewSelRef.current = from !== to ? { from, to } : null;
    }
    // Carry the source line at the top of the current view so the other mode
    // opens on the same block (works for full and split edit alike).
    if (s.mode === 'preview') {
      const ws = workspaceRef.current;
      const doc = docRef.current;
      pendingScrollLineRef.current =
        ws && doc && ws.scrollHeight > 0
          ? lineAtOffset(collectAnchors(ws, doc), ws.scrollHeight, ws.scrollTop)
          : null;
      recordPosition(s.docPath, pendingScrollLineRef.current); // SPEC16 §3.2
      setMode('edit');
    } else {
      pendingScrollLineRef.current = editorSyncRef.current?.topLine() ?? null;
      recordPosition(s.docPath, pendingScrollLineRef.current); // SPEC16 §3.2
      // SPEC22 §2.4: never autosave an untitled buffer — that would throw a
      // surprise Save As dialog mid-toggle; it just stays dirty.
      if (s.settings.autosaveOnToggle && s.dirty && s.docPath) void saveDoc();
      setMode('preview');
    }
    setSelInfo(null);
    setPending(null);
  }, [saveDoc, sourceRangeFromDomSelection]);

  /**
   * Split divider drag (SPEC7 §5.4): pointer-captured; the live resize writes
   * a CSS variable directly (no React re-render per mousemove) and the final
   * ratio persists on release.
   */
  const dragDivider = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ws = workspaceRef.current;
      if (!ws) return;
      e.preventDefault();
      const divider = e.currentTarget;
      divider.setPointerCapture(e.pointerId);
      const rect = ws.getBoundingClientRect();
      let ratio = stateRef.current.settings.splitRatio;
      const onMove = (ev: PointerEvent) => {
        ratio = Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, (ev.clientX - rect.left) / rect.width));
        ws.style.setProperty('--mm-split', `${ratio * 100}%`);
      };
      const onUp = () => {
        divider.removeEventListener('pointermove', onMove);
        divider.removeEventListener('pointerup', onUp);
        updateSettings({ ...stateRef.current.settings, splitRatio: ratio });
      };
      divider.addEventListener('pointermove', onMove);
      divider.addEventListener('pointerup', onUp);
    },
    [updateSettings]
  );

  const openViaDialog = useCallback(async () => {
    const p = stateRef.current.platform;
    if (!p) return;
    const path = await p.openFileDialog();
    if (path) openDocGuarded(p, path);
  }, [openDocGuarded]);

  /**
   * File → New v2 (SPEC22 §1.1): swap in a blank unsaved buffer in edit mode.
   * Nothing touches the disk and no dialog opens — the first Save asks where.
   */
  const startUntitled = useCallback(() => {
    const s = stateRef.current;
    recordPosition(s.docPath, currentTopLine()); // park the outgoing doc (SPEC16 §3.2)
    pendingScrollLineRef.current = null;
    skipSaveRef.current = true;
    editorHistoryRef.current = null;
    pendingEditorSelRef.current = null;
    pendingPreviewSelRef.current = null;
    lastEditorSelRef.current = { from: 0, to: 0 };
    setFmOverride(null); // SPEC26 §3.3
    setFindOpen(false); // SPEC30 §1.5
    setFindQuery('');
    setFindDebounced('');
    setDocPath(null);
    setUntitled(true);
    setBuffer('');
    setSavedText('');
    setHtml('');
    setComments([]);
    setPositions({});
    setActiveId(null);
    setPending(null);
    setMode('edit');
    setShowDiff(false);
    setDiff(null);
    unwatchRef.current?.();
    unwatchRef.current = null;
  }, [recordPosition, currentTopLine]);

  /** SPEC30 §3.2: remove the shadow draft (best effort). */
  const deleteDraft = useCallback(async () => {
    const p = stateRef.current.platform;
    draftWrittenRef.current = false;
    if (!p) return;
    try {
      const d = p.join(await p.configDir(), 'draft.json');
      if (await p.exists(d)) await p.remove(d);
    } catch {
      /* best effort */
    }
  }, []);

  /**
   * SPEC35 §6.3: the open document was deleted — back to the SPEC4 clean
   * start (no dialog beyond the already-given confirmation). Mirrors
   * startUntitled, but lands on the splash and discards the crash draft.
   * The doc's reading-position entry is left to the existing pruning rules.
   */
  const closeToSplash = useCallback(() => {
    skipSaveRef.current = true;
    editorHistoryRef.current = null;
    pendingEditorSelRef.current = null;
    pendingPreviewSelRef.current = null;
    lastEditorSelRef.current = { from: 0, to: 0 };
    setFmOverride(null);
    setFindOpen(false);
    setFindQuery('');
    setFindDebounced('');
    setDocPath(null);
    setUntitled(false);
    setBuffer('');
    setSavedText('');
    setHtml('');
    setComments([]);
    setPositions({});
    setActiveId(null);
    setPending(null);
    setMode('preview');
    setShowDiff(false);
    setDiff(null);
    unwatchRef.current?.();
    unwatchRef.current = null;
    void deleteDraft();
  }, [deleteDraft]);

  /** SPEC35 §6.2: confirmed — trash, re-list, prune, persist, maybe splash. */
  const folderDeleteRun = useCallback(
    async (target: { path: string; isDir: boolean }) => {
      const p = stateRef.current.platform;
      if (!p?.trashEntry) return;
      try {
        await p.trashEntry(target.path);
      } catch {
        return; /* fs error — the tree stays untouched */
      }
      const within = (s: string) => remapPath(s, target.path, target.path) !== null;
      await listFolderDir(p, p.dirname(target.path));
      const nextExpanded = new Set([...folderStateRef.current.expanded].filter((d) => !within(d)));
      folderStateRef.current = { ...folderStateRef.current, expanded: nextExpanded };
      setFolderExpanded(nextExpanded);
      setFolderChildren((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !within(k))));
      persistFolderState(p);
      commitRecent(
        { ...recentRef.current, entries: recentRef.current.entries.filter((en) => !within(en.path)) },
        p
      );
      const s = stateRef.current;
      if (s.docPath && within(s.docPath)) closeToSplash();
    },
    [listFolderDir, persistFolderState, commitRecent, closeToSplash]
  );

  /** SPEC30 §3.3: apply a restored draft — the doc (or untitled) + dirty buffer. */
  const restoreDraft = useCallback(
    async (d: Draft) => {
      const p = stateRef.current.platform;
      if (!p) return;
      if (d.docPath && (await p.exists(d.docPath))) await openDoc(p, d.docPath);
      else startUntitled();
      setBuffer(d.content); // differs from savedText ⇒ dirty, exactly the crashed state
      await deleteDraft();
    },
    [openDoc, startUntitled, deleteDraft]
  );

  /** The newFile command: same unsaved-changes guard as opening (SPEC22 §1.2). */
  const newFile = useCallback(() => {
    if (stateRef.current.dirty) {
      setOpenPrompt({ kind: 'new' });
      return;
    }
    startUntitled();
  }, [startUntitled]);

  /** Help (SPEC4 §5): open the welcome doc like any file — guard included. */
  const openHelp = useCallback(async () => {
    const p = stateRef.current.platform;
    if (!p) return;
    const welcome = await p.welcomeDocPath();
    if (!(await p.exists(welcome)) && FIXTURES['welcome.md']) {
      await p.writeTextFile(welcome, FIXTURES['welcome.md']);
    }
    if (await p.exists(welcome)) openDocGuarded(p, welcome);
  }, [openDocGuarded]);

  const reloadThemes = useCallback(async () => {
    const p = stateRef.current.platform;
    if (!p) return;
    setThemes(await loadAllThemes(p));
  }, []);

  /** Zoom In/Out (SPEC12 §1.4): step the same ZOOM_LEVELS the dropdown uses. */
  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const s = stateRef.current.settings;
      const levels = ZOOM_LEVELS as readonly number[];
      const idx = levels.indexOf(s.zoom);
      const next = levels[Math.min(levels.length - 1, Math.max(0, (idx === -1 ? levels.indexOf(100) : idx) + dir))];
      if (next !== s.zoom) updateSettings({ ...s, zoom: next });
    },
    [updateSettings]
  );

  /** SPEC14 §1: step activation through the open comments in position order. */
  const navigateComment = useCallback((dir: 1 | -1) => {
    const s = stateRef.current;
    // Only where the comments panel renders: preview or split-edit (§1.4).
    if (!s.settings.commentsEnabled || !s.showComments) return;
    if (s.mode === 'edit' && !s.settings.splitEdit) return;
    const ordered = s.comments
      .filter((c) => !c.resolved)
      .sort((a, b) => (s.positions[a.id]?.start ?? a.anchor.start) - (s.positions[b.id]?.start ?? b.anchor.start))
      .map((c) => c.id);
    const id = stepComment(ordered, s.activeId, dir);
    if (!id) return;
    setActiveId(id);
    // Same activation feel as clicking the card (SPEC14 §1.3): center + flash
    // the highlight (split-edit marks live in the split preview) and keep the
    // margin card in view.
    const doc = docRef.current ?? splitDocRef.current;
    const marks = doc ? Array.from(doc.querySelectorAll<HTMLElement>(`mark.hl[data-cid="${CSS.escape(id)}"]`)) : [];
    if (marks.length > 0) {
      marks[0].scrollIntoView({ block: 'center' });
      for (const m of marks) {
        m.classList.add('flash');
        setTimeout(() => m.classList.remove('flash'), 900);
      }
    }
    panelRef.current?.querySelector(`[data-flowcard="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, []);

  /** SPEC18: build the static page and hand it to the chosen format. */
  const runExport = useCallback((req: ExportRequest) => {
    setExportOpen(false);
    void (async () => {
      const s = stateRef.current;
      const p = s.platform;
      if (!p || !s.docPath) return;
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches && s.settings.useDarkTheme;
      const themeId = req.theme === 'current' ? (dark ? s.settings.themeDark : s.settings.themeLight) : req.theme;
      const theme = s.themes.find((t) => t.id === themeId) ?? s.themes.find((t) => t.id === 'crisp') ?? s.themes[0];

      // One artifact shape for both formats (SPEC18 §2.2): the rendered doc,
      // highlights + numbered note refs when comments are included, and a
      // static Comments section at the end.
      const rendered = await renderMarkdown(s.buffer);
      const holder = document.createElement('div');
      holder.innerHTML = rendered;
      let staticComments: StaticComment[] | undefined;
      if (req.includeComments) {
        const text = getDocText(holder);
        const open = s.comments
          .filter((c) => !c.resolved)
          .map((c) => ({ c, m: reanchor(c.anchor, text) }))
          .sort((a, b) => (a.m?.start ?? a.c.anchor.start) - (b.m?.start ?? b.c.anchor.start));
        staticComments = open.map(({ c, m }, i) => {
          const n = i + 1;
          if (m) {
            const marks = highlightRange(holder, m.start, m.end, c.id);
            const last = marks[marks.length - 1];
            if (last) {
              const sup = document.createElement('sup');
              sup.className = 'mm-ref';
              const a = document.createElement('a');
              a.href = `#mm-comment-${n}`;
              a.textContent = String(n);
              sup.appendChild(a);
              last.after(sup);
            }
          }
          return {
            n,
            excerpt: c.anchor.exact,
            author: c.author,
            body: c.body,
            replies: c.thread.map((r) => ({ author: r.author, body: r.body })),
          };
        });
      }
      const name = p.basename(s.docPath);
      const html = buildStaticHtml({
        title: name,
        bodyHtml: holder.innerHTML,
        themeCss: theme?.css ?? '',
        stats: req.includeWordCount ? statsLine(s.buffer) : undefined,
        comments: staticComments,
      });

      if (!p.saveFileDialog) return;
      const target = await p.saveFileDialog(`${name.replace(/\.(md|markdown)$/i, '')}.html`, 'html');
      if (!target) return;
      await p.writeTextFile(target, html);
      await p.commitFile?.(target);
    })();
  }, []);

  // SPEC36 §4.5–4.6: the menu's clipboard row endpoints. Copy prefers the
  // SPEC35 seam (the shim records it for e2e); a missing seam falls back to
  // the browser clipboard. Read resolves null on any failure — Paste then
  // simply inserts nothing.
  const copyToClipboard = useCallback((text: string) => {
    const p = stateRef.current.platform;
    if (p?.copyText) void p.copyText(text);
    else void navigator.clipboard?.writeText(text).catch(() => undefined);
  }, []);
  const readFromClipboard = useCallback(async (): Promise<string | null> => {
    try {
      return (await stateRef.current.platform?.readClipboardText?.()) ?? null;
    } catch {
      return null;
    }
  }, []);

  // SPEC36 §5.2: one guard for every format command — never steal a combo
  // from a focused text field (find bar, composer, settings recorders), and
  // a silent no-op without a mounted editor (preview mode).
  const fmtCommand = useCallback((op: SmartFormatOp | 'open') => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    const h = smartEditRef.current;
    if (!h) return;
    if (op === 'open') h.openSmartMenu();
    else h.applyFormat(op);
  }, []);

  // --- command registry (SPEC12 §3.1): the single dispatch point for the DOM
  // toolbar (web), the native menu (desktop), and the hotkey listener.
  useEffect(() => {
    registerCommands({
      newFile,
      open: () => void openViaDialog(),
      save: () => void saveDoc(),
      saveAs: () => void saveDocAs(),
      // SPEC17 §1: Export… opens the dialog (silent no-op without a document).
      exportDoc: () => {
        if (stateRef.current.docPath) setExportOpen(true);
      },
      // File → Print…: native print of this window; print CSS trims chrome.
      printDoc: () => {
        if (stateRef.current.docPath) void stateRef.current.platform?.printCurrent?.();
      },
      // SPEC19 §2: strictly manual update check (no-op where unsupported).
      checkUpdates: () => {
        if (stateRef.current.platform?.updates) setUpdateOpen(true);
      },
      toggleDiff: () => setShowDiff((v) => !v),
      insertImage: () => void insertImage(),
      toggleFrontmatter: () => setFmOverride((cur) => !(cur ?? stateRef.current.settings.showFrontmatter)),
      find: openFind,
      // SPEC34 §4: silent no-ops on platforms without the seam (web).
      toggleFolders: () => {
        const st = stateRef.current;
        if (!st.platform?.readDirEntries) return;
        updateSettings({ ...st.settings, showFolders: !st.settings.showFolders });
      },
      openFolder: () => void openFolderCmd(),
      // SPEC29 §3.4: Clear Menu — no-op when already empty.
      clearRecent: () => commitRecent(clearRecent()),
      toggleWordCount: () => {
        const s = stateRef.current.settings;
        updateSettings({ ...s, showWordCount: !s.showWordCount });
      },
      headingPalette: () => {
        // Live preview DOM when there is one; in full edit, parse the latest
        // rendered html (the render loop keeps it fresh on a debounce).
        const live: ParentNode | null = docRef.current ?? splitDocRef.current;
        const root: ParentNode | null =
          live ??
          ((stateRef.current.docPath || stateRef.current.untitled) && stateRef.current.html
            ? new DOMParser().parseFromString(stateRef.current.html, 'text/html')
            : null);
        const headings: PaletteHeading[] = root
          ? Array.from(
              root.querySelectorAll<HTMLElement>(
                'h1[data-mm-line],h2[data-mm-line],h3[data-mm-line],h4[data-mm-line],h5[data-mm-line],h6[data-mm-line]'
              )
            ).map((el) => ({
              line: Number(el.dataset.mmLine),
              depth: Number(el.tagName[1]),
              text: el.textContent ?? '',
            }))
          : [];
        setPaletteHeadings(headings);
        setPaletteOpen((v) => !v);
      },
      toggleMode,
      // SPEC25 §3: first-class split toggle — flips the persisted setting live.
      toggleSplit: () => {
        const st = stateRef.current.settings;
        updateSettings({ ...st, splitEdit: !st.splitEdit });
      },
      toggleComments: () => {
        // Master switch off (SPEC7 §2): the comments UI is gone, commands included.
        if (stateRef.current.settings.commentsEnabled) setShowComments((v) => !v);
      },
      nextComment: () => navigateComment(1),
      prevComment: () => navigateComment(-1),
      // SPEC13 §4.2: a platform with aux windows never shows the overlays.
      settings: () => {
        const p = stateRef.current.platform;
        if (p?.openAuxWindow) void p.openAuxWindow('settings');
        else setSettingsOpen(true);
      },
      help: () => void openHelp(),
      about: () => {
        const p = stateRef.current.platform;
        if (p?.openAuxWindow) void p.openAuxWindow('about');
        else setAboutOpen(true);
      },
      zoomIn: () => stepZoom(1),
      zoomOut: () => stepZoom(-1),
      zoomReset: () => updateSettings({ ...stateRef.current.settings, zoom: 100 }),
      // SPEC36 §5.2: format commands forward to the mounted editor (the ref
      // is null outside edit mode ⇒ silent no-ops). A focused text input
      // (find bar, composer, settings) keeps its own Mod-combos.
      smartMenu: () => fmtCommand('open'),
      fmtBold: () => fmtCommand('bold'),
      fmtItalic: () => fmtCommand('italic'),
      fmtStrike: () => fmtCommand('strike'),
      fmtCode: () => fmtCommand('code'),
      fmtLink: () => fmtCommand('link'),
      fmtHeading1: () => fmtCommand('h1'),
      fmtHeading2: () => fmtCommand('h2'),
      fmtHeading3: () => fmtCommand('h3'),
      fmtHeading4: () => fmtCommand('h4'),
      fmtHeading5: () => fmtCommand('h5'),
      fmtHeading6: () => fmtCommand('h6'),
      fmtBullet: () => fmtCommand('bullet'),
      fmtNumbered: () => fmtCommand('numbered'),
      fmtTask: () => fmtCommand('task'),
      fmtQuote: () => fmtCommand('quote'),
      fmtCodeBlock: () => fmtCommand('code-block'),
      fmtHr: () => fmtCommand('hr'),
      // SPEC12 §1.5 + SPEC13 §1.3: ⌘W with an aux window focused closes that
      // window (the native accelerator always lands here, in main's JS);
      // otherwise Quit/Exit/Close run the unsaved-changes guard, unchanged.
      close: () => {
        void (async () => {
          const p = stateRef.current.platform;
          if (p?.closeFocusedAuxWindow && (await p.closeFocusedAuxWindow())) return;
          if (stateRef.current.dirty) setClosePrompt(true);
          else void p?.closeNow();
        })();
      },
    });
  }, [newFile, openViaDialog, saveDoc, saveDocAs, toggleMode, openHelp, stepZoom, updateSettings, navigateComment, insertImage, commitRecent, openFind, openFolderCmd, fmtCommand]);

  // SPEC29 §3.4: an Open Recent pick — guarded open if it still exists,
  // otherwise a notice and the entry drops off the list.
  useEffect(() => {
    registerRecentHandler((path) => {
      void (async () => {
        const p = stateRef.current.platform;
        if (!p) return;
        if (await p.exists(path)) {
          openDocGuarded(p, path);
        } else {
          showNotice(`“${p.basename(path)}” is no longer there`);
          commitRecent(removeRecent(recentRef.current, path));
        }
      })();
    });
  }, [openDocGuarded, showNotice, commitRecent]);

  // --- native menu install (SPEC12 §3.3): rebuilt whenever menu state changes ----
  useEffect(() => {
    if (!platform?.setAppMenu) return;
    void platform.setAppMenu(
      buildMenuSpec({
        isMac: platform.isMac,
        mode,
        splitEdit: settings.splitEdit,
        showComments,
        commentsEnabled: settings.commentsEnabled,
        commentCount: comments.length,
        hotkeys: settings.hotkeys,
        showDiff,
        showWordCount: settings.showWordCount,
        showFrontmatter,
        showFolders: settings.showFolders,
        recentFiles: recentMenuEntries(recent, platform.basename, platform.dirname),
      })
    );
  }, [platform, mode, showComments, settings.commentsEnabled, comments.length, settings.hotkeys, showDiff, settings.showWordCount, settings.splitEdit, fmOverride, settings.showFrontmatter, recent, settings.showFolders]);

  // --- aux windows (SPEC13 §3): main owns state; views handshake and edit over the bus ----
  useEffect(() => {
    if (!platform?.busListen || !platform.busEmit) return;
    let disposed = false;
    const offs: Array<() => void> = [];
    void (async () => {
      const ready = await platform.busListen!(EV_AUX_READY, () => {
        const s = stateRef.current;
        void platform.busEmit!(
          EV_AUX_INIT,
          buildAuxInit({ settings: s.settings, themes: s.themes, isMac: platform.isMac, version: __APP_VERSION__ })
        );
      });
      const edit = await platform.busListen!(EV_SETTINGS_EDIT, (payload) => {
        // §3.5: merge through the latest canonical state — a stale popup
        // snapshot must never clobber splitRatio (or future panel-unedited keys).
        updateSettings(mergeSettingsEdit(stateRef.current.settings, payload as Settings));
      });
      const req = await platform.busListen!(EV_AUX_REQUEST, (payload) => {
        const r = payload as AuxRequest;
        if (r.req === 'reloadThemes') void reloadThemes();
        else if (r.req === 'revealThemesDir') void platform.revealThemesDir?.();
        else if (r.req === 'openExternal') void platform.openExternal(r.url);
      });
      if (disposed) [ready, edit, req].forEach((off) => off());
      else offs.push(ready, edit, req);
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, [platform, updateSettings, reloadThemes]);

  // §3.5 canonical echo: every settings/themes change broadcasts, whatever its source.
  useEffect(() => {
    if (platform?.busEmit) void platform.busEmit(EV_SETTINGS_CHANGED, settings);
  }, [platform, settings]);
  useEffect(() => {
    if (platform?.busEmit) void platform.busEmit(EV_THEMES_CHANGED, themes);
  }, [platform, themes]);

  // --- SPEC16 §2: changes-since-save sets, recomputed on a debounce ------------
  useEffect(() => {
    if (!showDiff || mode !== 'edit') {
      setDiff(null);
      return;
    }
    const t = setTimeout(() => setDiff(diffLineSets(savedText, buffer)), 200);
    return () => clearTimeout(t);
  }, [showDiff, mode, buffer, savedText]);

  // --- SPEC16 §5: word-count chip (selection-aware in preview) ------------------
  useEffect(() => {
    if (!docPath && !untitled) {
      setChip('');
      return;
    }
    const t = setTimeout(() => {
      const sel =
        mode === 'preview' && selInfo && selInfo.end > selInfo.start
          ? docTextRef.current.slice(selInfo.start, selInfo.end)
          : '';
      const text = sel || (mode === 'preview' ? docTextRef.current : buffer);
      const { words, minutes } = countWords(text);
      setChip(`${words.toLocaleString('en-US')} words · ${minutes} min`);
    }, 200);
    return () => clearTimeout(t);
  }, [docPath, untitled, mode, buffer, html, selInfo]);

  // SPEC30 §3.2: the dirty-buffer shadow copy — ~2s idle debounce; a clean
  // transition deletes it; never touch it while the restore offer is open.
  useEffect(() => {
    if (!platform || restorePrompt) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (!dirty) {
      if (draftWrittenRef.current) void deleteDraft();
      return;
    }
    draftTimerRef.current = setTimeout(() => {
      const s = stateRef.current;
      const pf = s.platform;
      if (!s.dirty || !pf) return;
      const draft: Draft = { version: 1, docPath: s.docPath, content: s.buffer, at: new Date().toISOString() };
      void (async () => {
        try {
          await pf.writeTextFile(pf.join(await pf.configDir(), 'draft.json'), serializeDraft(draft));
          draftWrittenRef.current = true;
        } catch {
          /* best effort */
        }
      })();
    }, 2000);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [buffer, dirty, platform, restorePrompt, deleteDraft]);

  // --- SPEC16 §3: capture the reading position on preview scrolls (debounced) ---
  useEffect(() => {
    if (mode !== 'preview' || !docPath) return;
    const ws = workspaceRef.current;
    if (!ws) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => recordPosition(stateRef.current.docPath, currentTopLine()), 500);
    };
    ws.addEventListener('scroll', onScroll);
    return () => {
      if (t) clearTimeout(t);
      ws.removeEventListener('scroll', onScroll);
    };
  }, [mode, docPath, recordPosition, currentTopLine]);

  // --- global hotkeys (capture phase so Cmd+S never reaches the webview) --------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-hotkey-recorder]')) return;
      const hk = stateRef.current.settings.hotkeys;
      if (eventMatches(e, hk.toggleEdit)) {
        e.preventDefault();
        dispatchCommand('toggleMode', 'hotkey');
      } else if (eventMatches(e, hk.toggleSplit)) {
        e.preventDefault();
        dispatchCommand('toggleSplit', 'hotkey');
      } else if (eventMatches(e, hk.save)) {
        e.preventDefault();
        dispatchCommand('save', 'hotkey');
      } else if (eventMatches(e, hk.newFile)) {
        e.preventDefault();
        dispatchCommand('newFile', 'hotkey');
      } else if (eventMatches(e, hk.openFile)) {
        e.preventDefault();
        dispatchCommand('open', 'hotkey');
      } else if (eventMatches(e, hk.find)) {
        e.preventDefault();
        dispatchCommand('find', 'hotkey');
      } else if (eventMatches(e, hk.toggleFolders)) {
        e.preventDefault();
        dispatchCommand('toggleFolders', 'hotkey');
      } else if (eventMatches(e, hk.toggleComments)) {
        e.preventDefault();
        dispatchCommand('toggleComments', 'hotkey');
      } else if (eventMatches(e, hk.nextComment)) {
        e.preventDefault();
        dispatchCommand('nextComment', 'hotkey');
      } else if (eventMatches(e, hk.prevComment)) {
        e.preventDefault();
        dispatchCommand('prevComment', 'hotkey');
      } else if (eventMatches(e, hk.headingPalette)) {
        e.preventDefault();
        dispatchCommand('headingPalette', 'hotkey');
      } else if (eventMatches(e, hk.toggleWordCount)) {
        e.preventDefault();
        dispatchCommand('toggleWordCount', 'hotkey');
      } else {
        // SPEC36 §5.2: the Smart Edit bindings, one command each.
        const fmt: Array<[string, CommandId]> = [
          [hk.smartMenu, 'smartMenu'],
          [hk.bold, 'fmtBold'],
          [hk.italic, 'fmtItalic'],
          [hk.strikethrough, 'fmtStrike'],
          [hk.inlineCode, 'fmtCode'],
          [hk.link, 'fmtLink'],
          [hk.heading1, 'fmtHeading1'],
          [hk.heading2, 'fmtHeading2'],
          [hk.heading3, 'fmtHeading3'],
          [hk.heading4, 'fmtHeading4'],
          [hk.heading5, 'fmtHeading5'],
          [hk.heading6, 'fmtHeading6'],
          [hk.bulletList, 'fmtBullet'],
          [hk.numberedList, 'fmtNumbered'],
          [hk.taskList, 'fmtTask'],
          [hk.blockquote, 'fmtQuote'],
          [hk.codeBlock, 'fmtCodeBlock'],
          [hk.horizontalRule, 'fmtHr'],
        ];
        for (const [combo, id] of fmt) {
          if (eventMatches(e, combo)) {
            e.preventDefault();
            dispatchCommand(id, 'hotkey');
            break;
          }
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // --- vim-style navigation (SPEC3 §5): preview only, never while typing ------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s.settings.vimNav || s.mode !== 'preview') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable], .modal') || document.querySelector('.overlay')) {
        vimRef.current.reset();
        return;
      }
      // A live selection belongs to type-to-comment (SPEC7 §3), never to nav.
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) {
        vimRef.current.reset();
        return;
      }
      const action = vimRef.current.resolve(e, performance.now());
      if (!action) return;
      const ws = workspaceRef.current;
      if (!ws) return;
      e.preventDefault();
      const half = ws.clientHeight / 2;
      switch (action) {
        case 'down':
          ws.scrollBy({ top: 60 });
          break;
        case 'up':
          ws.scrollBy({ top: -60 });
          break;
        case 'halfDown':
          ws.scrollBy({ top: half });
          break;
        case 'halfUp':
          ws.scrollBy({ top: -half });
          break;
        case 'top':
          ws.scrollTop = 0;
          break;
        case 'bottom':
          ws.scrollTop = ws.scrollHeight;
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- window title: the only filename/dirty display on desktop (SPEC12 §2.2) ---
  useEffect(() => {
    const p = platform;
    if (!p) return;
    const name = docPath ? p.basename(docPath) : untitled ? 'Untitled' : null;
    const title = name ? `${name}${dirty ? ' •' : ''} — Marky Mark` : 'Marky Mark';
    void p.setTitle(title);
    document.title = title;
  }, [platform, docPath, untitled, dirty]);

  // --- markdown rendering (preview mode; debounced live in split edit, SPEC7 §5) ----
  useEffect(() => {
    if (mode !== 'preview' && !settings.splitEdit) return;
    let cancelled = false;
    const render = () =>
      void renderMarkdown(buffer).then((rendered) => {
        if (cancelled) return;
        renderPendingRef.current = false; // fresh html — restores may consume
        setHtml(rendered);
      });
    if (mode === 'edit') {
      const t = setTimeout(render, 200); // keystrokes coalesce; well under the 300ms budget
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [buffer, mode, settings.splitEdit]);

  // --- restore scroll position when swapping modes (line-anchored) ----------------
  // Into edit (full or split): the editor mounts lazily — retry until its
  // handle exists, then put the carried source line at the viewport top.
  useEffect(() => {
    if (mode !== 'edit') return;
    if (pendingScrollLineRef.current === null) return;
    let disposed = false;
    let tries = 120; // ~2s of frames
    const attempt = () => {
      if (disposed) return;
      const ed = editorSyncRef.current;
      const line = pendingScrollLineRef.current;
      if (!ed || line === null) {
        if (line !== null && tries-- > 0) requestAnimationFrame(attempt);
        return;
      }
      // A scroll effect dispatched into a freshly-created CM view can be
      // swallowed by its initial layout — write, then verify next frame and
      // retry until the top line actually matches (bounded).
      ed.scrollToLine(line);
      requestAnimationFrame(() => {
        if (disposed) return;
        const landed = editorSyncRef.current?.topLine() ?? line;
        if (Math.abs(landed - line) < 2 || tries-- <= 0) pendingScrollLineRef.current = null;
        else attempt();
      });
    };
    attempt();
    return () => {
      disposed = true;
    };
  }, [mode]);

  // --- inject rendered doc, re-anchor, highlight ----------------------------------
  useLayoutEffect(() => {
    if (mode !== 'preview') return;
    const doc = docRef.current;
    if (!doc) return;
    injectionCompleteRef.current = false;
    doc.innerHTML = html;
    if (!html) {
      docTextRef.current = '';
      return;
    }

    // Resolve local image paths through the platform (Tauri asset protocol).
    const p = stateRef.current.platform;
    const path = stateRef.current.docPath;
    if (p && path) {
      const dir = p.dirname(path);
      doc.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src');
        if (!src) return;
        // SPEC20 §4.2: keep the source's own spelling — the resize rewrite
        // must write back what the document said, not the resolved URL.
        img.dataset.mmOriginalSrc = src;
        const resolved = p.resolveAssetSrc(src, dir);
        if (resolved) img.src = resolved;
        else img.removeAttribute('src'); // unresolvable here (e.g. web): stay inert
      });
    }
    // External links: show the destination on hover — the hand-off to the OS
    // browser (SPEC11 §4) should never be a surprise.
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) a.setAttribute('title', href);
    });

    const text = getDocText(doc);
    docTextRef.current = text;

    const pos: Positions = {};
    let changed = false;
    const updated = comments.map((c) => {
      const m = reanchor(c.anchor, text);
      pos[c.id] = m;
      if (m) {
        const fresh = createAnchor(text, m.start, m.end);
        if (!anchorsEqual(fresh, c.anchor)) {
          changed = true;
          return { ...c, anchor: fresh };
        }
      }
      return c;
    });
    setPositions(pos);
    if (changed) {
      // Persist refreshed anchors; the effect reruns and highlights then.
      setComments(updated);
      return;
    }
    if (showComments && settings.commentsEnabled) {
      for (const c of comments) {
        if (c.resolved && !settings.showResolved) continue;
        const m = pos[c.id];
        if (m) {
          const marks = highlightRange(doc, m.start, m.end, c.id);
          // Ghosted resolved highlights (SPEC6 §3): faint tint, still clickable.
          if (c.resolved) marks.forEach((mk) => mk.classList.add('ghost'));
        }
      }
    }
    injectionCompleteRef.current = true; // SPEC25 §2: this DOM is final for now
  }, [html, comments, showComments, mode, settings.showResolved, settings.commentsEnabled]);

  // Into preview: once the doc is injected, map the carried line back to a
  // pixel offset (block-anchored, so code blocks don't skew it).
  useLayoutEffect(() => {
    if (mode !== 'preview') return;
    if (renderPendingRef.current) return; // stale html — wait for the fresh render
    const line = pendingScrollLineRef.current;
    if (line === null) return;
    const ws = workspaceRef.current;
    const doc = docRef.current;
    if (!ws || !doc || doc.childElementCount === 0) return;
    ws.scrollTop = offsetForLine(collectAnchors(ws, doc), Math.max(ws.scrollHeight, 1), line);
    pendingScrollLineRef.current = null;
  }, [mode, html]);

  // SPEC25 §2: once the preview DOM is final (injection completed — an
  // anchor-refresh pass rebuilds it and must not eat the carry), restore the
  // parked editor selection as a NATIVE selection of the rendered text.
  useLayoutEffect(() => {
    if (mode !== 'preview') return;
    if (renderPendingRef.current || !injectionCompleteRef.current) return;
    const pending = pendingPreviewSelRef.current;
    if (!pending) return;
    const doc = docRef.current;
    if (!doc || doc.childElementCount === 0) return;
    pendingPreviewSelRef.current = null;
    const buffer = stateRef.current.buffer;
    const needle = visibleTextForRange(buffer, pending.from, pending.to);
    if (!needle.replace(/\s+/g, ' ').trim()) return;
    const fromLine = buffer.slice(0, pending.from).split('\n').length;
    const toLine = buffer.slice(0, pending.to).split('\n').length;
    const stamped = Array.from(doc.querySelectorAll<HTMLElement>('[data-mm-line]'));
    if (stamped.length === 0) return;
    let startEl = stamped[0];
    for (const el of stamped) {
      if (Number(el.dataset.mmLine) <= fromLine) startEl = el;
      else break;
    }
    const after = stamped.find((el) => Number(el.dataset.mmLine) > toLine);
    const region = document.createRange();
    region.setStartBefore(startEl);
    if (after) region.setEndBefore(after);
    else if (doc.lastChild) region.setEndAfter(doc.lastChild);
    else return;
    const { start: rs, end: re } = rangeToOffsets(doc, region);
    const hit = findNormalized(getDocText(doc).slice(rs, re), needle);
    const range = offsetsToRange(doc, hit ? rs + hit.start : rs, hit ? rs + hit.end : re);
    if (!range) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [mode, html, comments, showComments, settings.showResolved, settings.commentsEnabled]);

  // SPEC30 §1.2: live find, debounced ≤200ms.
  useEffect(() => {
    const t = setTimeout(() => setFindDebounced(findQuery), 150);
    return () => clearTimeout(t);
  }, [findQuery]);

  // SPEC30 §1.3: preview engine — re-applies after every injection pass
  // (same deps + completion gate as the other post-render consumers).
  useLayoutEffect(() => {
    if (mode !== 'preview') return;
    if (!injectionCompleteRef.current) return;
    if (!findOpen || !findDebounced) {
      clearFindMarks();
      if (findOpen) {
        setFindCount(0);
        setFindCurrent(0);
      }
      return;
    }
    const n = applyFindMarks(findDebounced);
    setFindCount(n);
    setFindCurrent(n > 0 ? 1 : 0);
    if (n > 0) activateFindMatch(0);
  }, [mode, findOpen, findDebounced, html, comments, showComments, settings.showResolved, settings.commentsEnabled, applyFindMarks, activateFindMatch, clearFindMarks]);

  // SPEC30 §1.4: edit engine — the bar drives CM once the editor is mounted.
  useEffect(() => {
    if (mode !== 'edit' || !findOpen) return;
    let disposed = false;
    let tries = 120;
    const attempt = () => {
      if (disposed) return;
      const h = editorSearchRef.current;
      if (!h) {
        if (tries-- > 0) requestAnimationFrame(attempt);
        return;
      }
      const res = h.setQuery(findDebounced, findReplace);
      setFindCount(res.count);
      setFindCurrent(res.current);
    };
    attempt();
    return () => {
      disposed = true;
    };
    // findReplace intentionally read fresh at call time via the closure; the
    // replace text re-installs without advancing in the handler below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, findOpen, findDebounced]);

  // --- split-edit live preview pane (SPEC7 §5): plain reading pane, no comments ----
  useLayoutEffect(() => {
    if (mode !== 'edit' || !settings.splitEdit) return;
    const el = splitDocRef.current;
    if (!el) return;
    el.innerHTML = html;
    const p = stateRef.current.platform;
    const path = stateRef.current.docPath;
    if (p && path) {
      const dir = p.dirname(path);
      el.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src');
        if (!src) return;
        img.dataset.mmOriginalSrc = src; // SPEC20 §4.2: resize writes this back
        const resolved = p.resolveAssetSrc(src, dir);
        if (resolved) img.src = resolved;
        else img.removeAttribute('src');
      });
    }
  }, [html, mode, settings.splitEdit]);

  // --- SPEC15: synchronized split scrolling ------------------------------------
  // Whichever pane the user scrolls leads; the other follows within a frame.
  // Programmatic follower writes are counted in `suppress` so they never
  // re-lead (no feedback loop). Ends clamp mutually reachable (§1.3).
  useEffect(() => {
    if (mode !== 'edit' || !settings.splitEdit) return;
    const docEl = splitDocRef.current;
    const scroller = docEl?.parentElement; // .split-preview
    if (!docEl || !scroller) return;

    let anchors: SyncAnchor[] = [];
    let contentHeight = 1;
    const rebuild = () => {
      anchors = collectAnchors(scroller, docEl);
      contentHeight = Math.max(scroller.scrollHeight, 1);
    };
    rebuild();
    const ro = new ResizeObserver(rebuild); // divider drags, resizes, late images
    ro.observe(docEl);

    // A follower may emit several scroll events per logical write (CM's
    // scrollIntoView measure loop), so suppression is a short quiet window
    // rather than an exact event count — leak-free either way.
    const quiet = { editor: 0, preview: 0 };
    const QUIET_MS = 120;
    const AT_END = 2; // px slack for end clamping

    const editorLeads = () => {
      const ed = editorSyncRef.current;
      if (!ed) return;
      const { top, max } = ed.scrollInfo();
      const previewMax = scroller.scrollHeight - scroller.clientHeight;
      let target: number;
      if (top <= AT_END) target = 0;
      else if (top >= max - AT_END) target = previewMax;
      else target = Math.min(offsetForLine(anchors, contentHeight, ed.topLine()), previewMax);
      if (Math.abs(scroller.scrollTop - target) < 1) return; // no-op → nothing to quiet
      quiet.preview = performance.now() + QUIET_MS;
      scroller.scrollTop = target;
    };

    const previewLeads = () => {
      const ed = editorSyncRef.current;
      if (!ed) return;
      const { max } = ed.scrollInfo();
      const previewMax = scroller.scrollHeight - scroller.clientHeight;
      const y = scroller.scrollTop;
      quiet.editor = performance.now() + QUIET_MS;
      if (y <= AT_END) ed.setScrollTop(0);
      else if (y >= previewMax - AT_END) ed.setScrollTop(max);
      else ed.scrollToLine(lineAtOffset(anchors, contentHeight, y));
    };

    const onEditorScroll = () => {
      if (performance.now() < quiet.editor) return;
      requestAnimationFrame(editorLeads);
    };
    const onPreviewScroll = () => {
      if (performance.now() < quiet.preview) return;
      requestAnimationFrame(previewLeads);
    };

    // The editor loads lazily — retry the subscription until its handle
    // appears (bounded; the html-keyed rerun also gets a fresh shot).
    let offEditor: (() => void) | null = null;
    let disposed = false;
    let retries = 120; // ~2s of frames
    const subscribe = () => {
      if (disposed) return;
      const ed = editorSyncRef.current;
      if (ed) offEditor = ed.onScroll(onEditorScroll);
      else if (retries-- > 0) requestAnimationFrame(subscribe);
    };
    subscribe();
    scroller.addEventListener('scroll', onPreviewScroll);
    return () => {
      disposed = true;
      ro.disconnect();
      offEditor?.();
      scroller.removeEventListener('scroll', onPreviewScroll);
    };
  }, [mode, settings.splitEdit, html]);

  // --- active highlight styling -----------------------------------------------------
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    doc.querySelectorAll<HTMLElement>('mark.hl').forEach((m) => {
      m.classList.toggle('active', m.dataset.cid === activeId);
    });
  }, [activeId, positions, showComments]);

  // --- margin card layout (SPEC6 §2): absolutely-positioned, animated tops.
  // Idle: cards sit level with their highlights, pushing later ones down.
  // Active: the active card anchors level with its highlight (Word behavior);
  // earlier cards stack upward above it, later ones downward.
  useLayoutEffect(() => {
    const doc = docRef.current;
    const panel = panelRef.current;
    if (!doc || !panel) return;
    const panelTop = panel.getBoundingClientRect().top;
    const els = Array.from(panel.querySelectorAll<HTMLElement>('[data-flowcard]'));
    const entries = els.map((el) => {
      const key = el.dataset.flowcard!;
      let desired: number | null = null;
      if (key === '__composer' && pending) {
        const rect = rectForOffsets(doc, pending.start, pending.end);
        if (rect) desired = rect.top - panelTop;
      } else if (key !== '__resolved') {
        const mark = doc.querySelector<HTMLElement>(`mark.hl[data-cid="${CSS.escape(key)}"]`);
        if (mark) desired = mark.getBoundingClientRect().top - panelTop;
      }
      return { el, key, desired, h: el.offsetHeight };
    });

    const tops = new Array<number>(entries.length);
    const layoutDown = (from: number, startCursor: number) => {
      let cursor = startCursor;
      for (let i = from; i < entries.length; i++) {
        const t = Math.max(entries[i].desired ?? cursor, cursor);
        tops[i] = t;
        cursor = t + entries[i].h + CARD_GAP;
      }
      return cursor;
    };

    const activeIdx = activeId ? entries.findIndex((e) => e.key === activeId) : -1;
    let bottom: number;
    if (activeIdx >= 0 && entries[activeIdx].desired !== null) {
      const at = Math.max(entries[activeIdx].desired!, 0);
      tops[activeIdx] = at;
      let limit = at - CARD_GAP;
      for (let i = activeIdx - 1; i >= 0; i--) {
        const t = Math.min(entries[i].desired ?? limit - entries[i].h, limit - entries[i].h);
        tops[i] = t;
        limit = t - CARD_GAP;
      }
      bottom = layoutDown(activeIdx + 1, at + entries[activeIdx].h + CARD_GAP);
    } else {
      bottom = layoutDown(0, 0);
    }

    entries.forEach((e, i) => {
      e.el.style.top = `${tops[i]}px`;
    });
    panel.style.minHeight = `${Math.max(bottom, 0)}px`;
  });

  // --- debounced comment autosave (sidecar or embedded per settings) -------------------
  useEffect(() => {
    if (!platform || !docPath) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    const t = setTimeout(() => void persistComments(comments), 800);
    return () => clearTimeout(t);
  }, [comments, platform, docPath, persistComments]);

  // --- SPEC23 §1: mirror split-preview selections into the editor -----------------
  // Non-collapsed selections anchored inside the split preview map to exact
  // source offsets (selectionMap); unlocatable/ambiguous text falls back to
  // the covering line range. The editor is never focused — the preview
  // selection must survive.
  useEffect(() => {
    if (mode !== 'edit' || !settings.splitEdit) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      const pane = splitDocRef.current;
      if (!pane) return;
      const mapped = sourceRangeFromDomSelection(pane);
      if (mapped) editorSelectRef.current?.(mapped.from, mapped.to);
    };
    const onSel = () => {
      if (t) clearTimeout(t);
      t = setTimeout(apply, 150);
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      if (t) clearTimeout(t);
      document.removeEventListener('selectionchange', onSel);
    };
  }, [mode, settings.splitEdit, sourceRangeFromDomSelection]);

  // --- selection → floating "Add comment" button ---------------------------------------
  useEffect(() => {
    if (mode !== 'preview') return;
    const onSelection = () => {
      const sel = document.getSelection();
      const doc = docRef.current;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !doc) {
        setSelInfo((prev) => (prev === null ? prev : null));
        return;
      }
      const range = sel.getRangeAt(0);
      if (!doc.contains(range.commonAncestorContainer)) {
        setSelInfo((prev) => (prev === null ? prev : null));
        return;
      }
      const { start, end } = rangeToOffsets(doc, range);
      if (end <= start || docTextRef.current.slice(start, end).trim() === '') {
        setSelInfo((prev) => (prev === null ? prev : null));
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelInfo({ start, end, x: rect.left + rect.width / 2, y: rect.top });
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [mode]);

  // --- comment operations -----------------------------------------------------------
  const startComposer = (seed = '') => {
    if (!selInfo) return;
    setPending({ start: selInfo.start, end: selInfo.end });
    setDraft(seed);
    setActiveId(null);
    window.getSelection()?.removeAllRanges();
    setSelInfo(null);
  };

  // --- type-to-comment (SPEC7 §3): a printable key over a selection opens the composer
  useEffect(() => {
    if (mode !== 'preview' || !selInfo || pending || !showComments) return;
    if (!settings.commentsEnabled || !settings.typeToComment) return;
    const { start, end } = selInfo;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return; // printable only
      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.('input, textarea, select, [contenteditable], .modal') ||
        document.querySelector('.overlay')
      ) {
        return;
      }
      e.preventDefault();
      setPending({ start, end });
      setDraft(e.key);
      setActiveId(null);
      window.getSelection()?.removeAllRanges();
      setSelInfo(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selInfo, pending, mode, showComments, settings.commentsEnabled, settings.typeToComment]);

  const submitComment = () => {
    const body = draft.trim();
    if (!body || !pending) return;
    const comment: CommentData = {
      id: crypto.randomUUID(),
      author: settings.author,
      createdAt: new Date().toISOString(),
      body,
      resolved: false,
      thread: [],
      anchor: createAnchor(docTextRef.current, pending.start, pending.end),
    };
    setComments((prev) => [...prev, comment]);
    setPending(null);
    setDraft('');
    setActiveId(comment.id);
  };

  const updateComment = (next: CommentData) => {
    setComments((prev) => prev.map((c) => (c.id === next.id ? next : c)));
    // Resolving retires the card from focus — otherwise its ghost keeps the
    // brighter `.active` styling and never reads as resolved (SPEC7 §4).
    if (next.resolved) setActiveId((a) => (a === next.id ? null : a));
  };

  const deleteComment = (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
    setActiveId((a) => (a === id ? null : a));
  };

  const handleMarkClick = (id: string) => {
    setActiveId(id);
    panelRef.current?.querySelector(`[data-flowcard="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const handleCardActivate = (id: string) => {
    setActiveId(id);
    const doc = docRef.current;
    if (!doc) return;
    const marks = Array.from(doc.querySelectorAll<HTMLElement>(`mark.hl[data-cid="${CSS.escape(id)}"]`));
    if (marks.length === 0) return;
    marks[0].scrollIntoView({ block: 'center' });
    for (const m of marks) {
      m.classList.add('flash');
      setTimeout(() => m.classList.remove('flash'), 900);
    }
  };

  // --- panel ordering ------------------------------------------------------------------
  const byPosition = (a: CommentData, b: CommentData) =>
    (positions[a.id]?.start ?? a.anchor.start) - (positions[b.id]?.start ?? b.anchor.start);
  const open = comments.filter((c) => !c.resolved).sort(byPosition);
  const resolved = comments.filter((c) => c.resolved);

  type Item = { kind: 'comment'; c: CommentData; ghost?: boolean } | { kind: 'composer' };
  // With "Show resolved" on, resolved comments join the flow as ghosts (SPEC6 §3).
  const items: Item[] = settings.showResolved
    ? [...comments].sort(byPosition).map((c) => ({ kind: 'comment' as const, c, ghost: c.resolved }))
    : open.map((c) => ({ kind: 'comment' as const, c }));
  if (pending) {
    let at = items.findIndex(
      (it) => it.kind === 'comment' && (positions[it.c.id]?.start ?? it.c.anchor.start) > pending.start
    );
    if (at === -1) at = items.length;
    items.splice(at, 0, { kind: 'composer' });
  }

  const panelVisible =
    mode === 'preview' && showComments && settings.commentsEnabled && (comments.length > 0 || pending !== null);

  // Navigator pill label, frozen across the fade-out (SPEC14 §3.5).
  const navIdx = activeId ? open.findIndex((c) => c.id === activeId) : -1;
  if (navIdx >= 0) navLabelRef.current = `${navIdx + 1} / ${open.length}`;

  if (!platform) return <div className="theme-root" />;

  return (
    <div className={`theme-root${!nativeMenu ? ' has-toolbar' : ''}${!nativeMenu && !settings.autoHideToolbar ? ' toolbar-static' : ''}`} ref={rootRef}>
      {/* SPEC12 §2.1: with a native menu the header does not render at all. */}
      {!nativeMenu && (
        <>
          <div
            className="toolbar-hotzone"
            data-testid="toolbar-hotzone"
            onMouseEnter={toolbarEnter}
            onMouseMove={toolbarEnter}
            onMouseLeave={toolbarLeave}
          />
          <div
            className={`toolbar-shell${toolbarShown ? ' shown' : ''}`}
            data-testid="toolbar-shell"
            data-visible={toolbarShown ? 'true' : 'false'}
            onMouseEnter={toolbarEnter}
            onMouseLeave={toolbarLeave}
          >
            <Toolbar
              docName={docPath ? platform.basename(docPath) : untitled ? 'Untitled' : null}
              docPath={docPath}
              dirty={dirty}
              mode={mode}
              showComments={showComments}
              commentsEnabled={settings.commentsEnabled}
              commentCount={comments.length}
              hotkeys={settings.hotkeys}
              isMac={platform.isMac}
              onToggleMode={() => dispatchCommand('toggleMode')}
              onToggleComments={() => dispatchCommand('toggleComments')}
              onNewFile={() => dispatchCommand('newFile')}
              onOpenFile={() => dispatchCommand('open')}
              onSave={() => dispatchCommand('save')}
              onSaveAs={() => dispatchCommand('saveAs')}
              onHelp={() => dispatchCommand('help')}
              onAbout={() => dispatchCommand('about')}
              onOpenSettings={() => dispatchCommand('settings')}
              onMenuOpenChange={setMenuPin}
            />
          </div>
        </>
      )}

      {findOpen && (docPath || untitled) && (
        <FindBar
          mode={mode}
          query={findQuery}
          replace={findReplace}
          count={findCount}
          current={findCurrent}
          focusTick={findFocusTick}
          onQuery={setFindQuery}
          onReplace={setFindReplace}
          onNext={() => stepFind(1)}
          onPrev={() => stepFind(-1)}
          onReplaceOne={() => replaceFind(false)}
          onReplaceAll={() => replaceFind(true)}
          onClose={closeFind}
        />
      )}

      <div className="body-row">
        {platform.readDirEntries && platform.openFolderDialog && settings.showFolders && (
          <FolderPanel
            root={folderRoot}
            children={folderChildren}
            expanded={folderExpanded}
            selectedPath={docPath}
            selectedDirty={dirty}
            showNonMd={folderShowNonMd}
            width={settings.folderWidth}
            join={platform.join}
            basename={platform.basename}
            onToggleDir={toggleFolderDir}
            onToggleNonMd={toggleFolderNonMd}
            onOpenFile={(path) => openDocGuarded(platform, path)}
            onOpenFolder={() => dispatchCommand('openFolder')}
            onSync={() => {
              if (stateRef.current.docPath) void revealInFolders(platform, stateRef.current.docPath);
            }}
            onClose={() => dispatchCommand('toggleFolders')}
            onWidth={(w) => updateSettings({ ...stateRef.current.settings, folderWidth: w })}
            isMac={platform.isMac}
            caps={{
              canReveal: !!platform.revealPath,
              canTrash: !!platform.trashEntry,
              canRename: !!platform.renameEntry,
              canCopy: !!platform.copyText,
            }}
            onMenuAction={folderMenuAction}
            renamingPath={folderRenaming?.path ?? null}
            renameError={folderRenameError}
            onRenameCommit={(oldPath, newName) => void folderRenameCommit(oldPath, newName)}
            onRenameCancel={folderRenameCancel}
          />
        )}

      {mode === 'preview' ? (
        <div className="workspace" ref={workspaceRef}>
          <ImageResizer
            active={mode === 'preview'}
            docRef={docRef}
            workspaceRef={workspaceRef}
            html={html}
            onRewrite={rewriteImage}
          />
          <div className="docwrap">
            {frontMatter && showFrontmatter && (
              <FrontMatterCard entries={frontMatter.entries} onClose={() => setFmOverride(false)} />
            )}
            {!docPath && !untitled && (
              <div className="empty-center">
                {/* SPEC27 §3 (revised): the splash — the app icon, larger,
                    then the About info and one drop hint. No title text, no
                    decoration. Pure app UI, no images. */}
                <div className="splash" data-testid="empty-hint">
                  <div className="splash-mark" data-testid="splash-mark">
                    <AppBadge size={132} testId="splash-badge" />
                  </div>
                  <p className="splash-version">v{__APP_VERSION__}</p>
                  <p className="splash-alpha">Alpha — pre-release software, expect rough edges.</p>
                  <p className="splash-meta">Developer: Jorge Pereira · MIT License</p>
                  <p className="splash-meta">
                    <a
                      href="https://github.com/jorgeper/marky-mark"
                      onClick={(e) => {
                        e.preventDefault(); // managed hand-off (SPEC11 §4.2)
                        void platform.openExternal('https://github.com/jorgeper/marky-mark');
                      }}
                    >
                      github.com/jorgeper/marky-mark
                    </a>
                  </p>
                  <p className="splash-drop">Drop a file to open</p>
                </div>
              </div>
            )}
            <div
              className="doc"
              data-testid="doc"
              ref={docRef}
              onClick={(e) => {
                // Managed links (SPEC11 §4): the webview never navigates.
                const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
                if (a) {
                  e.preventDefault();
                  const href = a.getAttribute('href') ?? '';
                  if (href.startsWith('#')) {
                    const id = decodeURIComponent(href.slice(1));
                    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
                  } else if (/^https?:\/\//i.test(href)) {
                    void platform.openExternal(href); // explicit hand-off to the OS browser
                  }
                  return; // any other protocol is inert
                }
                const mark = (e.target as HTMLElement).closest?.('mark.hl') as HTMLElement | null;
                if (mark?.dataset.cid && showComments) handleMarkClick(mark.dataset.cid);
                else if (!mark) setActiveId(null); // click-away deactivates (SPEC14 §3.1)
              }}
            />
          </div>
          {panelVisible && (
            <aside className="panel" data-testid="panel" ref={panelRef}>
              {items.map((it) =>
                it.kind === 'composer' ? (
                  <div className="card composer" data-flowcard="__composer" data-testid="composer" key="__composer">
                    <textarea
                      data-testid="composer-input"
                      placeholder="Add a comment…"
                      autoFocus
                      value={draft}
                      // Type-to-comment seeds the draft; the caret belongs after it.
                      onFocus={(e) => {
                        const n = e.currentTarget.value.length;
                        e.currentTarget.setSelectionRange(n, n);
                      }}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          submitComment();
                        } else if (e.key === 'Escape') {
                          setPending(null);
                          setDraft('');
                        }
                      }}
                    />
                    <div className="row">
                      <button data-testid="composer-submit" onClick={submitComment}>
                        Comment
                      </button>
                      <button
                        onClick={() => {
                          setPending(null);
                          setDraft('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <CommentCard
                    key={it.c.id}
                    comment={it.c}
                    author={settings.author}
                    orphaned={positions[it.c.id] === null}
                    active={activeId === it.c.id}
                    ghost={it.ghost}
                    onActivate={handleCardActivate}
                    onUpdate={updateComment}
                    onDelete={deleteComment}
                  />
                )
              )}
              {!settings.showResolved && resolved.length > 0 && (
                <details className="resolved-section" data-testid="resolved-section" data-flowcard="__resolved">
                  <summary>Resolved ({resolved.length})</summary>
                  {resolved.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      author={settings.author}
                      orphaned={positions[c.id] === null}
                      active={activeId === c.id}
                      onActivate={(id) => setActiveId(id)}
                      onUpdate={updateComment}
                      onDelete={deleteComment}
                    />
                  ))}
                </details>
              )}
            </aside>
          )}
        </div>
      ) : settings.splitEdit ? (
        <div
          className="workspace split"
          ref={workspaceRef}
          style={{ '--mm-split': `${settings.splitRatio * 100}%` } as React.CSSProperties}
        >
          <div className="split-editor">
            <Suspense fallback={<div className="editor-wrap" data-testid="editor-loading" />}>
              <Editor
                value={buffer}
                lineNumbers={settings.lineNumbers}
                onChange={setBuffer}
                historyRef={editorHistoryRef}
                syncRef={editorSyncRef}
                diff={diff}
                onPasteImages={pasteImages}
                insertRef={editorInsertRef}
                syntax={settings.editorSyntax}
                vimNav={settings.vimNav}
                onVimModeChange={seamVimMode}
                onEditState={handleEditState}
                selectRangeRef={editorSelectRef}
                pendingSelectionRef={pendingEditorSelRef}
                searchRef={editorSearchRef}
                hotkeys={settings.hotkeys}
                isMac={platform?.isMac ?? true}
                canPaste={!!platform?.readClipboardText}
                onCopyText={copyToClipboard}
                onReadClipboard={readFromClipboard}
                smartRef={smartEditRef}
              />
            </Suspense>
          </div>
          <div
            className="split-divider"
            data-testid="split-divider"
            onPointerDown={dragDivider}
            onDoubleClick={() => updateSettings({ ...stateRef.current.settings, splitRatio: 0.5 })}
          />
          <div
            className="split-preview"
            data-testid="split-preview"
            ref={splitPreviewRef}
            // SPEC23 §1: a focused CodeMirror re-asserts its own DOM selection,
            // which would kill a preview drag-selection mid-gesture. Selecting
            // in the preview starts with a pointerdown — release the editor's
            // focus first so the native selection can live in this pane.
            onPointerDownCapture={() => {
              const ae = document.activeElement as HTMLElement | null;
              if (ae?.closest('.editor-wrap')) ae.blur();
            }}
          >
            <ImageResizer
              active={settings.splitEdit}
              docRef={splitDocRef}
              workspaceRef={splitPreviewRef}
              html={html}
              onRewrite={rewriteImage}
            />
            {frontMatter && showFrontmatter && (
              <FrontMatterCard entries={frontMatter.entries} onClose={() => setFmOverride(false)} />
            )}
            <div className="doc" ref={splitDocRef} />
          </div>
        </div>
      ) : (
        <div className="workspace" ref={workspaceRef} style={{ overflow: 'hidden' }}>
          <Suspense fallback={<div className="editor-wrap" data-testid="editor-loading" />}>
            <Editor
              value={buffer}
              lineNumbers={settings.lineNumbers}
              onChange={setBuffer}
              historyRef={editorHistoryRef}
              syncRef={editorSyncRef}
              diff={diff}
              onPasteImages={pasteImages}
              insertRef={editorInsertRef}
              syntax={settings.editorSyntax}
              vimNav={settings.vimNav}
              onVimModeChange={seamVimMode}
              onEditState={handleEditState}
              selectRangeRef={editorSelectRef}
              pendingSelectionRef={pendingEditorSelRef}
              searchRef={editorSearchRef}
              hotkeys={settings.hotkeys}
              isMac={platform?.isMac ?? true}
              canPaste={!!platform?.readClipboardText}
              onCopyText={copyToClipboard}
              onReadClipboard={readFromClipboard}
              smartRef={smartEditRef}
            />
          </Suspense>
        </div>
      )}

      </div>

      {selInfo && showComments && settings.commentsEnabled && !pending && mode === 'preview' && (
        <button
          className="add-comment-btn"
          data-testid="add-comment-btn"
          style={{ left: selInfo.x, top: Math.max(8, selInfo.y - 42) }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => startComposer()}
        >
          💬 Add comment
        </button>
      )}

      {/* SPEC16 §5: quiet word-count chip, bottom-left (toggleable). */}
      {chip && settings.showWordCount && (
        <div className="word-chip" data-testid="word-chip">
          {chip}
        </div>
      )}

      {/* SPEC20 §2: transient paste feedback, bottom-center. */}
      {notice && (
        <div className="mm-notice" data-testid="notice">
          {notice}
        </div>
      )}

      {/* SPEC16 §4: the ⌘K heading palette. */}
      {paletteOpen && (
        <HeadingPalette
          headings={paletteHeadings}
          onClose={() => setPaletteOpen(false)}
          onJump={(h) => {
            const s = stateRef.current;
            if (s.mode === 'edit') {
              editorSyncRef.current?.scrollToLine(h.line);
              return;
            }
            const ws = workspaceRef.current;
            const doc = docRef.current;
            const el = doc?.querySelector<HTMLElement>(`[data-mm-line="${h.line}"]`);
            if (!ws || !el) return;
            // Content-coordinate top of the heading → viewport top.
            ws.scrollTop = el.getBoundingClientRect().top - (ws.getBoundingClientRect().top - ws.scrollTop);
          }}
        />
      )}

      {/* SPEC14 §3: fixed navigator pill, centered over the comment margin —
          park the mouse and click through. Stays mounted while the panel shows
          so it can fade out; the label freezes so the fade never shows "0/N". */}
      {panelVisible && (
        <div
          className={`comment-nav${activeId && open.some((c) => c.id === activeId) ? ' visible' : ''}`}
          data-testid="comment-nav"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button data-testid="comment-nav-prev" title="Previous comment" onClick={() => dispatchCommand('prevComment')}>
            ↑
          </button>
          <span data-testid="comment-nav-count">{navLabelRef.current}</span>
          <button data-testid="comment-nav-next" title="Next comment" onClick={() => dispatchCommand('nextComment')}>
            ↓
          </button>
        </div>
      )}

      {!platform.openAuxWindow && settingsOpen && (
        <SettingsPanel
          settings={settings}
          themes={themes}
          isMac={platform.isMac}
          storageLocked={platform.kind === 'web'}
          autoHideAvailable={!nativeMenu}
          onChange={updateSettings}
          onReloadThemes={() => void reloadThemes()}
          onImportTheme={
            platform.importTheme
              ? async () => {
                  if (await platform.importTheme!()) void reloadThemes();
                }
              : undefined
          }
          onRevealThemesDir={platform.revealThemesDir ? () => void platform.revealThemesDir!() : undefined}
          onClose={() => setSettingsOpen(false)}
          docName={docPath ? platform.basename(docPath).replace(/\.[^.]+$/, '') : undefined}
        />
      )}

      {!platform.openAuxWindow && aboutOpen && (
        <AboutDialog onClose={() => setAboutOpen(false)} onOpenUrl={(u) => void platform.openExternal(u)} />
      )}

      {/* SPEC19 §2: the Check for Updates dialog. */}
      {updateOpen && platform.updates && (
        <UpdateDialog currentVersion={__APP_VERSION__} updates={platform.updates} onClose={() => setUpdateOpen(false)} />
      )}

      {/* SPEC17 §1: the Export dialog. */}
      {exportOpen && (
        <ExportDialog
          themes={themes}
          initialTheme={settings.exportTheme}
          onThemeChange={(id) => updateSettings({ ...stateRef.current.settings, exportTheme: id })}
          onExport={runExport}
          onClose={() => setExportOpen(false)}
        />
      )}

      {openPrompt && (
        <div className="overlay">
          <div className="modal" data-testid="open-prompt">
            <h2>Unsaved changes</h2>
            <p style={{ fontSize: 13.5 }}>
              “{docPath ? platform.basename(docPath) : untitled ? 'Untitled' : 'This file'}” has unsaved changes. Save
              before {openPrompt.kind === 'open' ? `opening “${platform.basename(openPrompt.path)}”` : 'starting a new file'}?
            </p>
            <div className="actions">
              <button data-testid="open-cancel" onClick={() => setOpenPrompt(null)}>
                Cancel
              </button>
              <button
                data-testid="open-discard"
                onClick={() => {
                  const intent = openPrompt;
                  setOpenPrompt(null);
                  if (intent.kind === 'open') void openDoc(platform, intent.path);
                  else startUntitled();
                }}
              >
                Don’t save
              </button>
              <button
                className="primary"
                data-testid="open-save"
                onClick={async () => {
                  const intent = openPrompt;
                  setOpenPrompt(null);
                  // SPEC22 §2.3: a cancelled Save As aborts the pending action.
                  if (!(await saveDoc())) return;
                  if (intent.kind === 'open') void openDoc(platform, intent.path);
                  else startUntitled();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {folderDeletePrompt && (
        <div className="overlay">
          <div
            className="modal"
            data-testid="folder-delete-prompt"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFolderDeletePrompt(null); // §6.1: Esc ⇒ no-op
            }}
          >
            <h2>Move to Trash</h2>
            <p style={{ fontSize: 13.5 }}>
              Move “{platform.basename(folderDeletePrompt.path)}”
              {folderDeletePrompt.isDir ? ' and its contents' : ''} to the Trash?
              {dirty && docPath && remapPath(docPath, folderDeletePrompt.path, folderDeletePrompt.path) !== null
                ? ' It has unsaved changes.'
                : ''}
            </p>
            <div className="actions">
              <button data-testid="folder-delete-cancel" onClick={() => setFolderDeletePrompt(null)}>
                Cancel
              </button>
              <button
                className="primary"
                data-testid="folder-delete-confirm"
                autoFocus // §6.1: Confirm is the default (Enter)
                onClick={() => {
                  const target = folderDeletePrompt;
                  setFolderDeletePrompt(null);
                  void folderDeleteRun(target);
                }}
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {restorePrompt && (
        <div className="overlay">
          <div className="modal" data-testid="restore-prompt">
            <h2>Restore unsaved changes?</h2>
            <p style={{ fontSize: 13.5 }}>
              “{restorePrompt.docPath ? platform.basename(restorePrompt.docPath) : 'Untitled'}” has unsaved changes
              from a previous session.
            </p>
            <div className="actions">
              <button
                data-testid="restore-no"
                onClick={() => {
                  setRestorePrompt(null);
                  void deleteDraft();
                }}
              >
                Discard
              </button>
              <button
                className="primary"
                data-testid="restore-yes"
                onClick={() => {
                  const d = restorePrompt;
                  setRestorePrompt(null);
                  if (d) void restoreDraft(d);
                }}
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {closePrompt && (
        <div className="overlay">
          <div className="modal" data-testid="close-prompt">
            <h2>Unsaved changes</h2>
            <p style={{ fontSize: 13.5 }}>
              “{docPath ? platform.basename(docPath) : untitled ? 'Untitled' : 'This file'}” has unsaved changes. Save
              before closing?
            </p>
            <div className="actions">
              <button data-testid="close-cancel" onClick={() => setClosePrompt(false)}>
                Cancel
              </button>
              <button
                data-testid="close-discard"
                onClick={() => {
                  setClosePrompt(false);
                  // SPEC30 §3.2: an explicit discard removes the shadow draft
                  // before the window dies (the clean-transition path can't run).
                  void deleteDraft().then(() => platform.closeNow());
                }}
              >
                Don’t save
              </button>
              <button
                className="primary"
                data-testid="close-save"
                onClick={async () => {
                  // SPEC22 §2.3: a cancelled Save As (untitled buffer) aborts the close.
                  const ok = await saveDoc();
                  setClosePrompt(false);
                  if (ok) void platform.closeNow();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
