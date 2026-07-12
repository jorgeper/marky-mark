import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getPlatform, type Platform } from './platform';
import { renderMarkdown } from './lib/markdown';
import { type Anchor, type CommentData, createAnchor, reanchor, type ReanchorMatch } from './lib/anchoring';
import { getDocText, highlightRange, rangeToOffsets, rectForOffsets } from './lib/domtext';
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
import { dispatchCommand, registerCommands } from './lib/commands';
import { buildMenuSpec } from './lib/menuSpec';
import { stepComment } from './lib/commentNav';
import { lineAtOffset, offsetForLine, type SyncAnchor } from './lib/scrollSync';
import type { EditorSyncHandle } from './components/Editor';
import { extractReviewPayload } from './lib/reviewBundle';
import { buildStaticHtml, statsLine, type StaticComment } from './lib/exportDoc';
import { ExportDialog, type ExportRequest } from './components/ExportDialog';
import { UpdateDialog } from './components/UpdateDialog';
import { diffLineSets, type DiffLineSets } from './lib/diffLines';
import { parsePositions, positionFor, rememberPosition, serializePositions, type PositionStore } from './lib/readingPositions';
import { countWords } from './lib/wordCount';
import { expandImageName, extForMime, imageMarkdownRef } from './lib/imagePaste';
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
import type { Theme } from './lib/themes';
import { applyThemeCss, loadAllThemes } from './themeRuntime';
import { FIXTURES } from './bundled';
import { Toolbar } from './components/Toolbar';
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
  const [buffer, setBuffer] = useState('');
  const [savedText, setSavedText] = useState('');
  const [mode, setMode] = useState<Mode>('preview');
  const [html, setHtml] = useState('');
  const [comments, setComments] = useState<CommentData[]>([]);
  const [positions, setPositions] = useState<Positions>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(true);
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
  const [openPrompt, setOpenPrompt] = useState<string | null>(null); // pending path awaiting the unsaved-changes decision
  // Auto-hiding toolbar (SPEC4 §2): launch grace → hover/pin driven.
  const [graceOver, setGraceOver] = useState(false);
  const [toolbarHover, setToolbarHover] = useState(false);
  const [toolbarFocus, setToolbarFocus] = useState(false);
  const [menuPin, setMenuPin] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  const docRef = useRef<HTMLDivElement>(null);
  const splitDocRef = useRef<HTMLDivElement>(null);
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
  const positionsRef = useRef<PositionStore>({ version: 1, entries: [] });
  const skipSaveRef = useRef(true);
  const unwatchRef = useRef<(() => void) | null>(null);
  /** Source line carried across mode switches (line-anchored, not ratio). */
  const pendingScrollLineRef = useRef<number | null>(null);

  const dirty = buffer !== savedText;
  // SPEC12 §2.3: a platform that owns a native menu gets no in-app header.
  const nativeMenu = !!platform?.setAppMenu;

  // Refs mirroring state, for stable event handlers.
  const stateRef = useRef({
    settings,
    mode,
    dirty,
    docPath,
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

  /** SPEC20 §2: transient feedback chip; each message restarts the 4s clock. */
  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 4000);
  }, []);

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

  // Guards the SPEC15/SPEC16 preview restore against firing on stale html
  // (opening a doc from edit mode re-runs the effect before the new render).
  const renderPendingRef = useRef(false);

  // --- document loading ------------------------------------------------------
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

    skipSaveRef.current = true;
    editorHistoryRef.current = null; // a fresh document starts a fresh undo history
    setDocPath(path);
    setBuffer(content);
    setSavedText(content);
    setComments(stored);
    setPositions({});
    setActiveId(null);
    setPending(null);
    setMode('preview');
    setShowDiff(false); // SPEC16 §2: the diff toggle resets per document
    setDiff(null);

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
  }, [loadDocParts, recordPosition, currentTopLine]);

  /**
   * Unsaved-changes guard (SPEC4 §6): every user-initiated open routes here.
   * Dirty buffer → three-way prompt; clean buffer or same path → open directly.
   */
  const openDocGuarded = useCallback(
    (p: Platform, path: string) => {
      const s = stateRef.current;
      if (s.dirty && s.docPath !== path) {
        setOpenPrompt(path);
        return;
      }
      void openDoc(p, path);
    },
    [openDoc]
  );

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
    })();
    return () => {
      disposed = true;
    };
  }, [openDocGuarded]);

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

  // --- actions -----------------------------------------------------------------
  const saveDoc = useCallback(async () => {
    const s = stateRef.current;
    if (!s.platform || !s.docPath) return;
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
  }, [persistComments]);

  const toggleMode = useCallback(() => {
    const s = stateRef.current;
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
      if (s.settings.autosaveOnToggle && s.dirty) void saveDoc();
      setMode('preview');
    }
    setSelInfo(null);
    setPending(null);
  }, [saveDoc]);

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

  /** Save As… (SPEC3 §3): comments travel with the document to the new path. */
  const saveDocAs = useCallback(async () => {
    const s = stateRef.current;
    const p = s.platform;
    if (!p || !s.docPath || !p.saveFileDialog) return;
    const target = await p.saveFileDialog(p.basename(s.docPath));
    if (!target) return;
    const text = s.settings.commentStorage === 'embedded' ? attachEmbedded(s.buffer, s.comments) : s.buffer;
    await p.writeTextFile(target, text);
    if (s.settings.commentStorage === 'sidecar' && s.comments.length > 0) {
      await p.writeTextFile(sidecarPathFor(target), serializeSidecar(s.comments));
    }
    await p.commitFile?.(target);
    await openDoc(p, target); // switch to the new document (title, watcher, sidecar)
  }, [openDoc]);

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

  // --- command registry (SPEC12 §3.1): the single dispatch point for the DOM
  // toolbar (web), the native menu (desktop), and the hotkey listener.
  useEffect(() => {
    registerCommands({
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
          (stateRef.current.docPath && stateRef.current.html
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
  }, [openViaDialog, saveDoc, saveDocAs, toggleMode, openHelp, stepZoom, updateSettings, navigateComment]);

  // --- native menu install (SPEC12 §3.3): rebuilt whenever menu state changes ----
  useEffect(() => {
    if (!platform?.setAppMenu) return;
    void platform.setAppMenu(
      buildMenuSpec({
        isMac: platform.isMac,
        mode,
        showComments,
        commentsEnabled: settings.commentsEnabled,
        commentCount: comments.length,
        hotkeys: settings.hotkeys,
        showDiff,
        showWordCount: settings.showWordCount,
      })
    );
  }, [platform, mode, showComments, settings.commentsEnabled, comments.length, settings.hotkeys, showDiff, settings.showWordCount]);

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
    if (!docPath) {
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
  }, [docPath, mode, buffer, html, selInfo]);

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
      } else if (eventMatches(e, hk.save)) {
        e.preventDefault();
        dispatchCommand('save', 'hotkey');
      } else if (eventMatches(e, hk.openFile)) {
        e.preventDefault();
        dispatchCommand('open', 'hotkey');
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
    const title = docPath ? `${p.basename(docPath)}${dirty ? ' •' : ''} — Marky Mark` : 'Marky Mark';
    void p.setTitle(title);
    document.title = title;
  }, [platform, docPath, dirty]);

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
    if (!showComments || !settings.commentsEnabled) return;
    for (const c of comments) {
      if (c.resolved && !settings.showResolved) continue;
      const m = pos[c.id];
      if (m) {
        const marks = highlightRange(doc, m.start, m.end, c.id);
        // Ghosted resolved highlights (SPEC6 §3): faint tint, still clickable.
        if (c.resolved) marks.forEach((mk) => mk.classList.add('ghost'));
      }
    }
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
    <div className={`theme-root${!nativeMenu && !settings.autoHideToolbar ? ' toolbar-static' : ''}`} ref={rootRef}>
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
              docName={docPath ? platform.basename(docPath) : null}
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
            {!docPath && (
              <div className="empty-center">
                <div className="empty-hint" data-testid="empty-hint">
                  <p>Drag a markdown file here</p>
                  <p className="empty-sub">
                    — or press <kbd>{displayCombo(settings.hotkeys.openFile, platform.isMac)}</kbd> to open one
                  </p>
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
              />
            </Suspense>
          </div>
          <div
            className="split-divider"
            data-testid="split-divider"
            onPointerDown={dragDivider}
            onDoubleClick={() => updateSettings({ ...stateRef.current.settings, splitRatio: 0.5 })}
          />
          <div className="split-preview" data-testid="split-preview">
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
            />
          </Suspense>
        </div>
      )}

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
              “{docPath ? platform.basename(docPath) : 'This file'}” has unsaved changes. Save before opening “
              {platform.basename(openPrompt)}”?
            </p>
            <div className="actions">
              <button data-testid="open-cancel" onClick={() => setOpenPrompt(null)}>
                Cancel
              </button>
              <button
                data-testid="open-discard"
                onClick={() => {
                  const path = openPrompt;
                  setOpenPrompt(null);
                  void openDoc(platform, path);
                }}
              >
                Don’t save
              </button>
              <button
                className="primary"
                data-testid="open-save"
                onClick={async () => {
                  const path = openPrompt;
                  setOpenPrompt(null);
                  await saveDoc();
                  void openDoc(platform, path);
                }}
              >
                Save
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
              “{docPath ? platform.basename(docPath) : 'This file'}” has unsaved changes. Save before closing?
            </p>
            <div className="actions">
              <button data-testid="close-cancel" onClick={() => setClosePrompt(false)}>
                Cancel
              </button>
              <button
                data-testid="close-discard"
                onClick={() => {
                  setClosePrompt(false);
                  void platform.closeNow();
                }}
              >
                Don’t save
              </button>
              <button
                className="primary"
                data-testid="close-save"
                onClick={async () => {
                  await saveDoc();
                  setClosePrompt(false);
                  void platform.closeNow();
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
