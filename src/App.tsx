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
  type Settings,
} from './lib/settings';
import { displayCombo, eventMatches } from './lib/hotkeys';
import { VimNavResolver } from './lib/vimnav';
import type { Theme } from './lib/themes';
import { applyThemeCss, loadAllThemes } from './themeRuntime';
import { FIXTURES } from './bundled';
import { Toolbar } from './components/Toolbar';
import { CommentCard } from './components/CommentCard';
import { SettingsPanel } from './components/SettingsPanel';

const Editor = lazy(() => import('./components/Editor'));

const CARD_GAP = 8;
/** Auto-hiding toolbar timings (SPEC4 §2). */
export const TOOLBAR_GRACE_MS = 2500;
export const TOOLBAR_HIDE_DELAY_MS = 400;

type Positions = Record<string, ReanchorMatch | null>;
type Mode = 'preview' | 'edit';

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
  const [closePrompt, setClosePrompt] = useState(false);
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
  const skipSaveRef = useRef(true);
  const unwatchRef = useRef<(() => void) | null>(null);
  const scrollRatioRef = useRef(0);

  const dirty = buffer !== savedText;

  // Refs mirroring state, for stable event handlers.
  const stateRef = useRef({ settings, mode, dirty, docPath, buffer, savedText, comments, platform });
  stateRef.current = { settings, mode, dirty, docPath, buffer, savedText, comments, platform };

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

  // --- document loading ------------------------------------------------------
  const openDoc = useCallback(async (p: Platform, path: string) => {
    let content: string;
    let stored: CommentData[];
    try {
      ({ content, comments: stored } = await loadDocParts(p, path));
    } catch {
      return; // unreadable path (e.g. deleted file in a stale open event)
    }
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
  }, [loadDocParts]);

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
      if (p.kind === 'web') loaded = { ...loaded, commentStorage: 'embedded' }; // no sidecars on web
      const themeList = await loadAllThemes(p);

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
  }, [settings.fontSize, settings.margins, settings.zoom]);

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
    const ws = workspaceRef.current;
    if (ws && ws.scrollHeight > 0) scrollRatioRef.current = ws.scrollTop / ws.scrollHeight;
    if (s.mode === 'preview') {
      setMode('edit');
    } else {
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

  // --- global hotkeys (capture phase so Cmd+S never reaches the webview) --------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-hotkey-recorder]')) return;
      const hk = stateRef.current.settings.hotkeys;
      if (eventMatches(e, hk.toggleEdit)) {
        e.preventDefault();
        toggleMode();
      } else if (eventMatches(e, hk.save)) {
        e.preventDefault();
        void saveDoc();
      } else if (eventMatches(e, hk.openFile)) {
        e.preventDefault();
        void openViaDialog();
      } else if (eventMatches(e, hk.toggleComments)) {
        e.preventDefault();
        // Master switch off (SPEC7 §2): the comments UI is gone, hotkey included.
        if (stateRef.current.settings.commentsEnabled) setShowComments((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggleMode, saveDoc, openViaDialog]);

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

  // --- window title -------------------------------------------------------------
  useEffect(() => {
    const p = platform;
    if (!p) return;
    const name = docPath ? p.basename(docPath) : 'Marky Mark';
    void p.setTitle(`${name}${dirty ? ' •' : ''} — Marky Mark`);
    document.title = `${name}${dirty ? ' •' : ''} — Marky Mark`;
  }, [platform, docPath, dirty]);

  // --- markdown rendering (preview mode; debounced live in split edit, SPEC7 §5) ----
  useEffect(() => {
    if (mode !== 'preview' && !settings.splitEdit) return;
    let cancelled = false;
    const render = () =>
      void renderMarkdown(buffer).then((rendered) => {
        if (!cancelled) setHtml(rendered);
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

  // --- restore scroll position when swapping modes --------------------------------
  useLayoutEffect(() => {
    const ws = workspaceRef.current;
    if (ws) ws.scrollTop = scrollRatioRef.current * ws.scrollHeight;
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
        if (src) img.src = p.resolveAssetSrc(src, dir);
      });
    }

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
        if (src) img.src = p.resolveAssetSrc(src, dir);
      });
    }
  }, [html, mode, settings.splitEdit]);

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

  if (!platform) return <div className="theme-root" />;

  return (
    <div className={`theme-root${settings.autoHideToolbar ? '' : ' toolbar-static'}`} ref={rootRef}>
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
        onToggleMode={toggleMode}
        onToggleComments={() => setShowComments((v) => !v)}
        onOpenFile={() => void openViaDialog()}
        onSave={() => void saveDoc()}
        onSaveAs={() => void saveDocAs()}
        onHelp={() => void openHelp()}
        onOpenSettings={() => setSettingsOpen(true)}
        onMenuOpenChange={setMenuPin}
      />
      </div>

      {mode === 'preview' ? (
        <div className="workspace" ref={workspaceRef}>
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
                const mark = (e.target as HTMLElement).closest?.('mark.hl') as HTMLElement | null;
                if (mark?.dataset.cid && showComments) handleMarkClick(mark.dataset.cid);
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

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          themes={themes}
          isMac={platform.isMac}
          storageLocked={platform.kind === 'web'}
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
