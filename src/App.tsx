import { lazy, Suspense, useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getPlatform, type Platform } from './platform';
import { renderMarkdown } from './lib/markdown';
import { type Anchor, type CommentData, createAnchor, reanchor, type ReanchorMatch } from './lib/anchoring';
import { getDocText, highlightRange, offsetsToRange, rangeToOffsets, rectForOffsets } from './lib/domtext';
import { readSidecar, serializeSidecar, sidecarPathFor } from './lib/sidecar';
import { attachEmbedded, mergeComments, splitEmbedded } from './lib/embedded';
import {
  DEFAULT_SETTINGS,
  diffSettings,
  MARGIN_WIDTHS,
  resolveSettings,
  serializeSettingsLayer,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  ZOOM_LEVELS,
  type Settings,
  type SettingsLayers,
  type SettingsScopeTab,
} from './lib/settings';
import { displayCombo, eventMatches } from './lib/hotkeys';
import { dispatchCommand, registerCommands, registerRecentHandler, type CommandId } from './lib/commands';
import { buildMenuSpec } from './lib/menuSpec';
import { deriveAppMode } from './lib/appMode';
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
import { ancestorsOf, isMarkdownFile, serializeFolderState, visibleEntries, type DirEntry } from './lib/folderTree';
import {
  addWorkspaceFolder,
  closeWorkspace,
  emptyWorkspaceSession,
  isWorkspaceFilePath,
  openFolderWorkspace,
  parseWorkspaceFile,
  parseWorkspaceSession,
  sanitizeWorkspaceSettings,
  saveWorkspaceAs,
  serializeWorkspaceFile,
  serializeWorkspaceSession,
  SESSION_DIR_NAME,
  sessionKeyForWorkspaceFile,
  UNTITLED_SLOT_FILE,
  untitledWorkspaceChanged,
  WORKSPACE_FILE_EXT,
  workspaceFolderPaths,
  workspaceFromFile,
  type Workspace,
  type WorkspaceSession,
} from './lib/workspace';
import { addOpen, closeOpen, cycleOpen, pruneOpen, remapOpen } from './lib/openFiles';
import { isDirtyText, normalizeEol } from './lib/dirty';
import { moveTarget, relativePath, remapPath, uniqueChildName } from './lib/folderOps';
import { ALL_FILE_GRANTS, type FileGrants } from './lib/fileGrants';
import { uploadRejection } from './lib/fileTransfer';
import { isSaveConflict, planSaveConflict, type SaveConflictChoice } from './lib/saveConflict';
import { FolderExpandButton, FolderPanel, PreviewToggleButton } from './components/FolderPanel';
import {
  SLIDE_SETTLE_MS,
  slideClasses,
  slideMounted,
  slideOnFrame,
  slideOnSettle,
  slideOnToggle,
  type SlidePhase,
} from './lib/paneSlide';
import { countWords } from './lib/wordCount';
import { expandImageName, extForMime, imageMarkdownRef, sanitizeImageName } from './lib/imagePaste';
import { HeadingPalette, type PaletteHeading } from './components/HeadingPalette';
import {
  buildAuxInit,
  EV_AUX_INIT,
  EV_AUX_READY,
  EV_AUX_REQUEST,
  EV_SETTINGS_CHANGED,
  EV_SETTINGS_EDIT,
  EV_THEMES_CHANGED,
  sanitizeSettingsEdit,
  type AuxRequest,
  type SettingsBroadcast,
} from './lib/auxProtocol';
import { VimNavResolver } from './lib/vimnav';
import { countNormalized, findNormalized, findNormalizedNth, mapSelectionToSource, renderedOffsetForSource, sourceOffsetForRendered, sourceRangeForVisibleMatch, visibleTextForRange } from './lib/selectionMap';
import { blockLineFor, wordAt } from './lib/activePosition';
import { parseFrontMatter } from './lib/frontmatter';
import { commentAffordanceSurface } from './lib/commentAffordance';
import { isStaleDraft, parseDraft, serializeDraft, type Draft } from './lib/drafts';
import { FindBar } from './components/FindBar';
import { FrontMatterCard } from './components/FrontMatterCard';
import type { Theme } from './lib/themes';
import { applyThemeCss, loadAllThemes } from './themeRuntime';
import { FIXTURES } from './bundled';
import { AppBadge, Toolbar } from './components/Toolbar';
import { CommentCard } from './components/CommentCard';
import { SettingsPanel } from './components/SettingsPanel';
import { WorkspaceAccessSettings } from './components/WorkspaceAccessSettings';
import { WorkspaceDangerZone } from './components/WorkspaceDangerZone';
import { WorkspaceSwitcher, NewWorkspaceDialog, OpenWorkspaceDialog } from './components/WorkspaceSwitcher';
import { StartPage } from './components/StartPage';
import { startActions, startCapabilities, type StartActionId } from './lib/startActions';
import { AboutDialog } from './components/AboutDialog';

const Editor = lazy(() => import('./components/Editor'));

/**
 * PRD 007 Req 17: what this user may do — with one document, or with the
 * storage scope as a whole when no path is named. The one place App asks the
 * question: a platform without the seam has no permission model, so it keeps
 * everything its other seams already offer.
 */
const grantsFor = (p: Platform, path?: string): Promise<FileGrants> =>
  p.fileGrants ? p.fileGrants(path) : Promise.resolve(ALL_FILE_GRANTS);

const CARD_GAP = 8;
/** Auto-hiding toolbar timings (SPEC4 §2). */
export const TOOLBAR_GRACE_MS = 2500;
export const TOOLBAR_HIDE_DELAY_MS = 400;

type Positions = Record<string, ReanchorMatch | null>;
type Mode = 'preview' | 'edit';

/** SPEC36 §7: the quit walk's stand-in for a dirty untitled buffer. */
const UNTITLED_SENTINEL = '\u0000untitled';

/**
 * Issue #42: the identity editor pushes are routed by — the doc path, the
 * untitled sentinel, or null when nothing is open. editorSessionDocRef and
 * editorChanged must agree on it exactly, so it is computed in one place.
 */
function docIdentity(docPath: string | null, untitled: boolean): string | null {
  return docPath ?? (untitled ? UNTITLED_SENTINEL : null);
}

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

/** SPEC29 §2 + PRD 002 §D15: best-effort write of a recent store's file. */
async function writeRecentStore(p: Platform, fileName: string, store: RecentStore): Promise<void> {
  try {
    await p.writeTextFile(p.join(await p.configDir(), fileName), serializeRecent(store));
  } catch {
    /* best effort */
  }
}

/**
 * PRD 003 Reqs 9–12: drive a side pane's slide phases from its setting.
 * Layout effect so the pre-open/closing frames land before paint (no flash),
 * double rAF so the browser paints the off-screen frame before the slide to
 * open starts (a transition needs a painted from-state). Reduced motion is
 * sampled at toggle time: the phases collapse to an instant switch (Req 11).
 */
function usePaneSlide(open: boolean, arm: React.MutableRefObject<boolean>): SlidePhase {
  const [phase, setPhase] = useState<SlidePhase>(open ? 'open' : 'closed');
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    // Derived during render (the React adjust-state-on-prop-change form), so
    // an armed open MOUNTS already in its off-screen pre-open state. Via an
    // effect instead, any style recalc between the mount commit and the
    // effect's commit makes the browser transition 0 → off-screen and then
    // retarget — the entry slide visibly never runs.
    // Only an explicitly armed flip slides; programmatic flips (reveal
    // forcing the pane open, workspace resolution swaps) switch instantly.
    const armed = arm.current;
    arm.current = false;
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setPrevOpen(open);
    setPhase(slideOnToggle(phase, open, !armed || reduced));
  }
  useLayoutEffect(() => {
    if (phase === 'open' || phase === 'closed') return;
    let raf1 = 0;
    let raf2 = 0;
    if (phase === 'pre-open') {
      // Two rAFs: the browser must paint the off-screen frame before the
      // slide-to-open values land, or the transition has nothing to run from.
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setPhase(slideOnFrame));
      });
    }
    const t = setTimeout(() => setPhase(slideOnSettle), SLIDE_SETTLE_MS);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t);
    };
  }, [phase]);
  return phase;
}

/**
 * A store that was there but could not be interpreted. `declaredVersion` is
 * the version exactly as declared — absent when there was none to read at all
 * (JSON that does not parse), which the indication's wording turns on.
 */
interface UnreadableStore {
  declaredVersion?: unknown;
}

/**
 * PRD 004 Reqs 13–17: what this build could not interpret in the OPEN
 * document's two comment stores. Per document, never per session — it is
 * parked with the tab and cleared when a document closes.
 */
interface DocStores {
  /** Non-null when a trailer was present but unreadable (version or JSON). */
  trailer: UnreadableStore | null;
  /** Non-null when a sidecar was present but unreadable. */
  sidecar: UnreadableStore | null;
  /** The unreadable trailer's exact bytes, re-emitted verbatim on save (Req 14). */
  trailerBytes: string | null;
}

/** A document with nothing unreadable — the state every clean doc gets. */
const CLEAN_STORES: DocStores = { trailer: null, sidecar: null, trailerBytes: null };

/** True when either store of the document could not be interpreted. */
function hasUnreadableStore(stores: DocStores): boolean {
  return stores.trailer !== null || stores.sidecar !== null;
}

/**
 * PRD 004 Req 16: what the persistent indication says. The newer-version
 * wording names the version whenever a store declared one; a store that
 * declared none gets the plainer sentence.
 */
function unreadableStoreMessage(stores: DocStores): string {
  const declared = stores.trailer?.declaredVersion ?? stores.sidecar?.declaredVersion;
  return typeof declared === 'string' && declared
    ? `This document’s comments were written by a newer version of Marky Mark (comment format ${declared}) and cannot be shown. They are left untouched.`
    : 'This document’s comments could not be read by this version of Marky Mark and cannot be shown. They are left untouched.';
}

export default function App() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // PRD 002 §E18: the raw per-layer objects behind `settings` (the resolved
  // result). settings.json is the USER layer only; the Workspace layer lives
  // on the current Workspace value. Global/Team load once, read-only (§E20).
  const settingsLayersRef = useRef<{ global?: unknown; team?: unknown; user: Record<string, unknown> }>({ user: {} });
  // Session-only resolution overrides (web forces embedded storage; a review
  // bundle carries its theme) — never persisted, dropped when the user edits
  // the same key.
  const sessionOverridesRef = useRef<Partial<Settings>>({});
  // What the settings UI renders indicators from (mirrors the refs, in state
  // so panels re-render when a layer changes without the effective changing).
  const [layerView, setLayerView] = useState<{ layers: SettingsLayers; workspaceOpen: boolean }>({
    layers: {},
    workspaceOpen: false,
  });
  const [themes, setThemes] = useState<Theme[]>([]);
  const [docPath, setDocPath] = useState<string | null>(null);
  // SPEC22 §1: a blank unsaved buffer (File → New) — no path until first Save.
  const [untitled, setUntitled] = useState(false);
  const [buffer, setBuffer] = useState('');
  const [savedText, setSavedText] = useState('');
  const [mode, setMode] = useState<Mode>('preview');
  const [html, setHtml] = useState('');
  const [comments, setComments] = useState<CommentData[]>([]);
  // PRD 004 Reqs 13–17: the open document's unreadable-store verdict.
  const [stores, setStores] = useState<DocStores>(CLEAN_STORES);
  // PRD 004 Reqs 15/17: a store this build cannot interpret freezes authoring
  // for the WHOLE document — a save targets one store and must never strand
  // the other. The readable store's comments still render, read-only.
  const authoringFrozen = hasUnreadableStore(stores);
  const [positions, setPositions] = useState<Positions>({});
  // SPEC29: Open Recent (MRU, persisted to recent.json; menu rebuild rides it).
  const [recent, setRecent] = useState<RecentStore>({ version: 1, entries: [] });
  // PRD 002 §D15: recent workspaces — same lineage, its own file and cap.
  const [recentWs, setRecentWs] = useState<RecentStore>({ version: 1, entries: [] });
  // SPEC34: the folder sidebar — roots (PRD 002 §D17), expanded set, listings.
  const [folderRoots, setFolderRoots] = useState<string[]>([]);
  const [folderExpanded, setFolderExpanded] = useState<Set<string>>(new Set());
  const [folderChildren, setFolderChildren] = useState<Record<string, DirEntry[]>>({});
  const [folderShowNonMd, setFolderShowNonMd] = useState(false);
  // SPEC36: the open-file set (tree-ordered) and the only-open-files view.
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [folderOpenOnly, setFolderOpenOnly] = useState(false);
  // SPEC35 §4–§5: the row renaming in place (openOnDone: a just-created file
  // opens when the rename commits or cancels), and a failed commit's error.
  const [folderRenaming, setFolderRenaming] = useState<{ path: string; openOnDone: boolean } | null>(null);
  const [folderRenameError, setFolderRenameError] = useState<string | null>(null);
  // SPEC35 §6: the delete confirmation — “Move ‘NAME’ to the Trash?”.
  const [folderDeletePrompt, setFolderDeletePrompt] = useState<{ path: string; isDir: boolean } | null>(null);
  // PRD 007 Req 17: what this user may do in the storage scope the sidebar
  // shows — everything, unless the platform answers the grants seam (App
  // never asks which flavor that is).
  const [folderGrants, setFolderGrants] = useState<FileGrants>(ALL_FILE_GRANTS);
  // PRD 007 Req 17: and what they may do with the OPEN DOCUMENT, which is a
  // separate question: a doc the flavor holds outside any permission scope (a
  // hosted local file, Req 21) stays editable while the workspace grants
  // nothing.
  const [docGrants, setDocGrants] = useState<FileGrants>(ALL_FILE_GRANTS);
  // PRD 007 Req 17: the document is open for reading only — a role without
  // doc.edit. Deliberately NOT the same condition as PRD 004 Req 15's frozen
  // store, which closes comment authoring while the document text stays
  // editable (its save re-emits the trailer bytes verbatim): the two reasons
  // stay distinguishable, and each gets its own words to the user.
  const docReadOnly = !docGrants.edit;
  // Both close comment authoring, for their own reasons.
  const mayComment = !authoringFrozen && docGrants.commentWrite;
  // PRD 007 Req 19: a refused upload or move, shown in the sidebar. It names
  // the rule that failed — the whole point of rejecting before uploading.
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  // PRD 007 Req 19: the folder an Upload File… pick will land in, and the
  // hidden input that does the picking (null ⇒ no pick in flight).
  const [uploadDir, setUploadDir] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  // PRD 007 Req 20: the save the server refused because the file changed
  // under us — the prompt offering Reload / Overwrite / Cancel. `fileText` is
  // exactly what that write tried to store (trailer and all); `bufferText` is
  // the canonical buffer it came from, which becomes the clean baseline if
  // the user answers Overwrite.
  const [saveConflict, setSaveConflict] = useState<{
    path: string;
    fileText: string;
    bufferText: string;
  } | null>(null);
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
  // Issue #38: whether plain edit mode has a live selection, so that surface
  // can offer a comment affordance too (previously it dead-ended with nothing
  // at all). Only presence matters — the range itself rides in
  // lastEditorSelRef and reaches preview through the SPEC25 carry.
  const [editHasSelection, setEditHasSelection] = useState(false);
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
  // Pending intent awaiting the unsaved-changes decision: open a path, start
  // a new untitled buffer (SPEC22 §1.2), or close one open file (SPEC36 §3.4).
  const [openPrompt, setOpenPrompt] = useState<
    | { kind: 'open'; path: string }
    | { kind: 'new' }
    | { kind: 'close-file'; path: string }
    // Issue #22: File → Close File over a dirty untitled buffer.
    | { kind: 'close-untitled' }
    | null
  >(null);
  /**
   * Issue #22: the changed-workspace Save / Don't Save / Cancel prompt. The
   * ref holds the continuation (close / replace / quit) to run on proceed.
   */
  const [wsClosePrompt, setWsClosePrompt] = useState(false);
  const wsCloseResumeRef = useRef<(() => void) | null>(null);
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
  /**
   * SPEC36 §2: the park map — every open-but-inactive file's volatile state.
   * In-memory only; entries lazy-load from disk when absent (boot restore).
   */
  const parkRef = useRef(
    new Map<
      string,
      { buffer: string; savedText: string; comments: CommentData[]; stores: DocStores; editorHistory: unknown }
    >()
  );
  /** Live open set for stable handlers (mirrors the openFiles state). */
  const openFilesRef = useRef<string[]>([]);
  /** The active member of the open set (null while untitled / splash). */
  const activeFileRef = useRef<string | null>(null);
  /** SPEC36 §7: the quit walk's remaining dirty targets (null = no walk). */
  const quitQueueRef = useRef<string[] | null>(null);
  /**
   * Issue #22: what an exhausted quit walk does. Close Workspace borrows the
   * walk (every dirty tab guards first) and finishes here instead of closing
   * the window; null = the classic quit (delete draft, close the window).
   */
  const quitDoneRef = useRef<(() => void) | null>(null);
  /** Starts the walk; assigned each render (dodges declaration order). */
  const startQuitWalkRef = useRef<() => void>(() => {});
  /** Issue #22: the walk stepper, ref'd for the same declaration-order dodge. */
  const processQuitWalkRef = useRef<() => Promise<void>>(async () => {});
  /**
   * Issue #82: opens an OS-delivered workspace file (discard-guarded);
   * ref'd because the boot effect that registers onOpenFile runs before
   * openWorkspaceFromPath / guardWorkspaceDiscard are declared.
   */
  const openWorkspacePathRef = useRef<(p: Platform, path: string) => void>(() => {});
  /**
   * The editor snapshots its undo state into editorHistoryRef only on
   * UNMOUNT — which runs AFTER a doc switch commits. These two refs defer
   * (a) capturing the outgoing doc's real snapshot into its park entry and
   * (b) installing the incoming doc's history, until the post-commit effect.
   */
  const parkHistoryFixupRef = useRef<string | null>(null);
  const pendingHistoryRef = useRef<{ value: unknown } | null>(null);
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
  /** SPEC43 §5.2: the mounted editor's Smart Edit handle — null in preview,
   * so every format command is a silent no-op there. */
  const smartEditRef = useRef<SmartEditHandle | null>(null);
  /** SPEC30 §1.3: preview match mark groups, index-aligned with the count. */
  const findMarksRef = useRef<HTMLElement[][]>([]);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftWrittenRef = useRef(false);
  // SPEC25: selection carry across mode switches.
  const lastEditorSelRef = useRef<{ from: number; to: number }>({ from: 0, to: 0 });
  const pendingEditorSelRef = useRef<{ from: number; to: number } | null>(null);
  const pendingPreviewSelRef = useRef<{ from: number; to: number } | null>(null);
  // Issue #38: the edit-mode affordance routes through the SPEC25 carry —
  // armed on click, consumed when the carried selection lands as selInfo.
  const composeOnCarryRef = useRef(false);
  /** True once the preview injection pass ran to completion for the current DOM. */
  const injectionCompleteRef = useRef(false);
  const positionsRef = useRef<PositionStore>({ version: 1, entries: [] });
  const skipSaveRef = useRef(true);
  const unwatchRef = useRef<(() => void) | null>(null);
  /**
   * Issue #64: the pending debounced comment autosave (armed by the autosave
   * effect, null when nothing is pending), exposed so parkActive can flush
   * it before the doc's state is parked.
   */
  const commentFlushRef = useRef<(() => void) | null>(null);
  /**
   * Issue #64: the tail of the comment-write queue. persistComments chains
   * every write behind it, and openDoc awaits it before a parked doc's
   * freshness read — so a just-flushed write is never raced by that read.
   */
  const commentWriteRef = useRef<Promise<void> | null>(null);
  /** Source line carried across mode switches (line-anchored, not ratio). */
  const pendingScrollLineRef = useRef<number | null>(null);

  // SPEC40 §1.2: the Table ▸ toggle and the Settings checkbox flip this.
  const toggleTableGrid = useCallback(() => {
    const s = stateRef.current.settings;
    updateSettings({ ...s, tableGridView: !s.tableGridView });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SPEC41 §1.2: the Image ▸ toggle and the Settings checkbox flip this.
  const toggleInlineImages = useCallback(() => {
    const s = stateRef.current.settings;
    updateSettings({ ...s, inlineImages: !s.inlineImages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SPEC41 §2.1: the edit-pane widgets resolve local srcs through the same
  // asset seam the preview uses; identity without a platform or saved doc.
  const resolveEditorImage = useCallback((src: string) => {
    const s = stateRef.current;
    const p = s.platform;
    if (!p?.resolveAssetSrc || !s.docPath) return src;
    return p.resolveAssetSrc(src, p.dirname(s.docPath));
  }, []);

  // SPEC38 §3.5: the table-mode display grid never escapes the editor —
  // every place the buffer is compared or shipped uses the canonical
  // (collapsed) text. Identity whenever the mode is off.
  const canonicalOf = useCallback((t: string) => smartEditRef.current?.canonicalText(t) ?? t, []);
  // Issue #42: every dirty decision goes through the one shared predicate.
  const dirty = isDirtyText(canonicalOf(buffer), savedText);
  // Issue #42: the parked half of the same rule — every "is this parked file
  // dirty?" site asks here, so they can never disagree either. Park entries
  // hold canonical text (see parkActive), so no canonicalOf on this path.
  const parkedDirty = useCallback((path: string) => {
    const pk = parkRef.current.get(path);
    return !!pk && isDirtyText(pk.buffer, pk.savedText);
  }, []);
  // SPEC36 §3.6: open rows carrying unsaved changes (parked dirtiness only
  // moves on switches, so these deps re-derive it exactly when it can change).
  const dirtyOpenFiles = useMemo(() => {
    const set = new Set<string>();
    for (const f of openFiles) {
      if (f === docPath) {
        if (dirty) set.add(f);
        continue;
      }
      if (parkedDirty(f)) set.add(f);
    }
    return set;
  }, [openFiles, docPath, dirty, parkedDirty]);
  // SPEC26: display-parsed front matter for the card (null ⇒ none).
  const frontMatter = useMemo(() => ((docPath || untitled) ? parseFrontMatter(buffer) : null), [buffer, docPath, untitled]);
  const showFrontmatter = fmOverride ?? settings.showFrontmatter;
  // SPEC12 §2.3: a platform that owns a native menu gets no in-app header.
  // Issue #38: only while installs succeed — a rejected setAppMenu would
  // otherwise leave the window with neither a menu nor the toolbar, so a
  // failed install hands the session back to the in-app toolbar.
  const [menuInstallFailed, setMenuInstallFailed] = useState(false);
  const nativeMenu = !!platform?.setAppMenu && !menuInstallFailed;

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
    stores,
    platform,
    themes,
    positions,
    activeId,
    showComments,
    html,
    docGrants,
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
    stores,
    platform,
    themes,
    positions,
    activeId,
    showComments,
    html,
    // PRD 007 Req 17: the command handlers gate on this too, so a hotkey is
    // exactly as inert as the menu item it mirrors.
    docGrants,
  };

  /**
   * Issue #42: the document the MOUNTED editor's text belongs to. Assigned
   * only on renders that show an editor pane, so in the commit that switches
   * or closes a document (mode forced back to preview) it still names the
   * OUTGOING doc — exactly the identity editorChanged routes by.
   */
  const editorSessionDocRef = useRef<string | null>(null);
  if (mode !== 'preview') editorSessionDocRef.current = docIdentity(docPath, untitled);

  /**
   * Issue #42: every editor text push lands here. The editor's unmount
   * cleanup reports the OUTGOING doc's canonical text (SPEC40 §2.3), and
   * that cleanup runs in the same commit in which a tab switch, close, or
   * open-over has already re-pointed the buffer at ANOTHER document — an
   * unrouted push would clobber the new buffer and read as spurious dirt.
   * Same doc → the buffer (ordinary typing and the edit→preview
   * canonicalization); still-parked doc → its park entry; closed/replaced
   * doc → dropped. Dropping also covers issue #43: a close that lands on
   * the splash would otherwise have the unmount report resurrect the closed
   * buffer — and its preview render — under the logo.
   */
  const editorChanged = useCallback((t: string) => {
    const s = stateRef.current;
    const sessionDoc = editorSessionDocRef.current;
    if (sessionDoc === docIdentity(s.docPath, s.untitled)) {
      setBuffer(t);
      return;
    }
    const entry = sessionDoc ? parkRef.current.get(sessionDoc) : undefined;
    if (entry) entry.buffer = t;
  }, []);

  // --- SPEC23 §4: dev-shim-only __mmEdit seam (same gating as __mmMenu) ---------
  const seamEditState = useCallback(
    (s: { canonHead: number; head: number; headLine: number; selFrom: number; selTo: number; selText: string; focused: boolean }) => {
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

  // --- SPEC44: active line & word cues (either preview pane) -------------------
  // §3.1: the "standard containers" the tint may land on.
  // eslint-disable-next-line no-var — module-ish constant inside the component
  const ACTIVE_CONTAINERS = 'li, p, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th';
  const activeCueRef = useRef<{ head: number; headLine: number; hasSel: boolean } | null>(null);

  const clearActiveCues = useCallback((pane: HTMLElement) => {
    pane.querySelectorAll('.mm-active-block').forEach((el) => el.classList.remove('mm-active-block'));
    pane.querySelectorAll('mark.mm-active-word').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
    });
  }, []);

  /**
   * SPEC44 §3: the caret's block tint + position-exact word mark. The word is
   * located by normalized occurrence INDEX computed on the source side — the
   * caret's occurrence, never a text search that could hit a twin elsewhere.
   */
  const applyActiveCues = useCallback(
    (pane: HTMLElement, head: number, headLine: number, hasSel: boolean) => {
      clearActiveCues(pane);
      const buffer = stateRef.current.buffer;
      const stamped = Array.from(pane.querySelectorAll<HTMLElement>('[data-mm-line]'));
      if (stamped.length === 0) return;
      const anchors = stamped.map((el) => Number(el.dataset.mmLine));
      const blockLine = blockLineFor(anchors, headLine);
      if (blockLine === null) return;
      const blockEl = stamped[anchors.lastIndexOf(blockLine)];
      const lines = buffer.split('\n');
      const starts: number[] = [0];
      for (let n = 0; n < lines.length - 1; n++) starts.push(starts[n] + lines[n].length + 1);
      const blockStart = starts[Math.min(blockLine, lines.length) - 1] ?? 0;
      const region = document.createRange();
      region.setStartBefore(blockEl);
      region.setEndAfter(blockEl);
      const { start: rs, end: re } = rangeToOffsets(pane, region);
      const blockRendered = getDocText(pane).slice(rs, re);
      // §3.1: the tint target is ALWAYS the innermost standard container of
      // the caret / selection head — never the whole stamp (which can be an
      // entire list, table, or quote). The head resolves to a rendered point
      // through the pure mapping layer; the word mark refines it when it
      // exists, the stamped element is the last resort.
      const containerOf = (el: Element | null): HTMLElement | null =>
        (el?.closest<HTMLElement>(ACTIVE_CONTAINERS) ?? null);
      const containerAtHead = (): HTMLElement | null => {
        const off = renderedOffsetForSource(buffer, blockStart, head, blockRendered);
        if (off === null) return null;
        const r = offsetsToRange(pane, rs + Math.min(off, Math.max(0, blockRendered.length - 1)), rs + Math.min(off + 1, blockRendered.length));
        if (!r) return null;
        // The range START can land at the tail of an inter-item whitespace
        // node (parent = the list itself); the END sits inside the real
        // container's text — take the first that resolves.
        for (const node of [r.startContainer, r.endContainer]) {
          const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
          const c = el && pane.contains(el) ? containerOf(el) : null;
          if (c) return c;
        }
        return null;
      };
      const tint = (el: HTMLElement | null) => (el && pane.contains(el) ? el : blockEl).classList.add('mm-active-block');
      if (hasSel) {
        tint(containerAtHead()); // the head's container — like the editor's active line
        return;
      }
      const w = wordAt(buffer, head);
      const needle = w ? visibleTextForRange(buffer, w.start, w.end) : '';
      if (!w || !needle.trim()) {
        tint(containerAtHead());
        return;
      }
      const nth = countNormalized(visibleTextForRange(buffer, blockStart, w.start), needle);
      const hit = findNormalizedNth(blockRendered, needle, nth);
      if (!hit) {
        tint(containerAtHead());
        return;
      }
      const marks = highlightRange(pane, rs + hit.start, rs + hit.end, '__aw__');
      for (const m of marks) {
        m.className = 'mm-active-word';
        delete m.dataset.cid; // never the comment machinery's business
      }
      tint(containerOf(marks[0] ?? null) ?? containerAtHead());
    },
    [clearActiveCues]
  );

  /**
   * SPEC44 §4: a plain preview click (no link/image/comment/find targets, no
   * drag selection) resolves to a source caret: split mode moves the editor
   * caret (the report loop re-derives both panes' cues); preview-only shows
   * the cues now and parks the caret for the next Mod+E (E85 contract).
   */
  const placeFromPreviewClick = useCallback(
    (pane: HTMLElement | null, e: React.MouseEvent) => {
      if (!pane || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest?.('a[href], img, mark.hl, mark.mm-find, input, button, .fm-card')) return;
      const live = document.getSelection();
      if (live && !live.isCollapsed) return; // click-drag selection keeps priority
      const cr = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!cr || !pane.contains(cr.startContainer)) return;
      const base = cr.startContainer.nodeType === Node.ELEMENT_NODE
        ? (cr.startContainer as HTMLElement)
        : cr.startContainer.parentElement;
      const blockEl = base?.closest<HTMLElement>('[data-mm-line]');
      if (!blockEl) return;
      const buffer = stateRef.current.buffer;
      const lines = buffer.split('\n');
      const stamped = Array.from(pane.querySelectorAll<HTMLElement>('[data-mm-line]'));
      const blockLine = Number(blockEl.dataset.mmLine);
      const after = stamped.find((el) => Number(el.dataset.mmLine) > blockLine);
      const endLine = after ? Number(after.dataset.mmLine) - 1 : lines.length;
      const { start: at } = rangeToOffsets(pane, cr);
      const region = document.createRange();
      region.setStartBefore(blockEl);
      region.setEndAfter(blockEl);
      const { start: rs, end: re } = rangeToOffsets(pane, region);
      const blockText = getDocText(pane).slice(rs, re);
      const local = Math.max(0, Math.min(at - rs, blockText.length));
      const w = wordAt(blockText, local);
      const starts: number[] = [0];
      for (let n = 0; n < lines.length - 1; n++) starts.push(starts[n] + lines[n].length + 1);
      let src: { from: number; to: number } | null = null;
      if (w) {
        const word = blockText.slice(w.start, w.end);
        const nth = countNormalized(blockText.slice(0, w.start), word);
        src = sourceRangeForVisibleMatch(buffer, blockLine, endLine, word, nth);
      }
      // §4.1: a no-word click lands the caret at the CLICKED container's
      // source start (its first visible character) — inside a list that is
      // the clicked item, not the whole stamp.
      let fallback = starts[Math.min(blockLine, lines.length) - 1] ?? 0;
      const clickedContainer = base?.closest<HTMLElement>('li, p, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th');
      if (!src && clickedContainer && blockEl.contains(clickedContainer)) {
        const cRegion = document.createRange();
        cRegion.setStartBefore(blockEl);
        cRegion.setEndBefore(clickedContainer);
        const cLocal = rangeToOffsets(pane, cRegion).end - rs;
        const mapped = sourceOffsetForRendered(buffer, blockLine, endLine, blockText, Math.max(0, cLocal));
        if (mapped !== null) fallback = mapped;
      }
      const caret = src ? src.from : fallback;
      if (stateRef.current.mode === 'edit') {
        editorSelectRef.current?.(caret, caret); // the report loop paints the cues
      } else {
        pendingEditorSelRef.current = { from: caret, to: caret }; // Mod+E lands here
        const headLine = buffer.slice(0, caret).split('\n').length;
        activeCueRef.current = { head: caret, headLine, hasSel: false };
        applyActiveCues(pane, caret, headLine, false);
      }
    },
    [applyActiveCues]
  );

  /**
   * Editor selection reports drive the seam and the reverse mirror. The
   * preview side is marks, never the native selection (a focused CM
   * re-asserts that); unfocused reports only clear — the forward mirror's
   * own dispatch can never bounce back (SPEC24 §1.4).
   */
  const handleEditState = useCallback(
    (s: { canonHead: number; head: number; headLine: number; selFrom: number; selTo: number; selText: string; focused: boolean }) => {
      seamEditState(s);
      lastEditorSelRef.current = { from: s.selFrom, to: s.selTo }; // SPEC25 §2.1
      const st = stateRef.current;
      // Issue #38: plain edit mode tracks its selection in state so the
      // comment affordance can render from it (split's live preview keeps
      // the existing selInfo path).
      if (st.mode === 'edit' && !st.settings.splitEdit) {
        setEditHasSelection(s.selFrom !== s.selTo);
      }
      if (st.mode !== 'edit' || !st.settings.splitEdit) return;
      if (mirrorTimerRef.current) clearTimeout(mirrorTimerRef.current);
      mirrorTimerRef.current = setTimeout(() => {
        const pane = splitDocRef.current;
        if (!pane) return;
        clearMirrorMarks();
        // SPEC44 §3: block + word cues follow every caret report — in
        // CANONICAL coordinates (the grid's padding never reaches the html).
        activeCueRef.current = { head: s.canonHead, headLine: s.headLine, hasSel: s.selFrom !== s.selTo };
        applyActiveCues(pane, s.canonHead, s.headLine, s.selFrom !== s.selTo);
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
    [seamEditState, clearMirrorMarks, applyActiveCues]
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

  /**
   * Read a doc file and its comments from both stores (trailer wins by id).
   * PRD 004 Reqs 13–17: the per-store verdict rides along — an unreadable
   * store yields no comments but its bytes are remembered, never rewritten.
   */
  const loadDocParts = useCallback(async (p: Platform, path: string) => {
    const raw = await p.readTextFile(path);
    const split = splitEmbedded(raw);
    // PRD 007 Req 17: without comment.read this document's comments are not
    // loaded at all — no sidecar request to be refused, and the trailer's
    // comments (which arrive inside the document's own bytes, so no server
    // can withhold them) are dropped here rather than shown.
    const mayReadComments = (await grantsFor(p, path)).commentRead;
    let sidecarComments: CommentData[] = [];
    let sidecarStore: UnreadableStore | null = null;
    try {
      const sidecar = sidecarPathFor(path);
      if (mayReadComments && (await p.exists(sidecar))) {
        const read = readSidecar(await p.readTextFile(sidecar));
        sidecarComments = read.comments;
        if (!read.readable) sidecarStore = { declaredVersion: read.declaredVersion };
      }
    } catch {
      // Unreadable file or JSON that does not parse: ignore rather than
      // crash, and leave the verdict clean — only a sidecar the store layer
      // could read well enough to judge (`readable === false`) freezes a doc.
      sidecarComments = [];
    }
    const docStores: DocStores = {
      trailer: split.readable ? null : { declaredVersion: split.declaredVersion },
      sidecar: sidecarStore,
      trailerBytes: split.readable ? null : split.trailerBytes ?? null,
    };
    return {
      // Issue #42: line endings normalize ONCE, at load — buffer and
      // savedText are LF internally, so a CRLF file round-tripping through
      // CodeMirror (whose toString() joins with '\n') never reads as dirty.
      // Deliberate consequence: a Save of a CRLF file writes LF — which any
      // edited save already did — making the written form deterministic.
      // The trailer stays raw (trailerBytes are preserved byte-for-byte).
      content: normalizeEol(split.content),
      comments: mayReadComments ? mergeComments(split.comments, sidecarComments) : [],
      stores: docStores,
    };
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
    if (p) void writeRecentStore(p, 'recent.json', next);
  }, []);
  const recentRef = useRef<RecentStore>({ version: 1, entries: [] });

  /** PRD 002 §D15: same shape as commitRecent, for recent-workspaces.json. */
  const commitRecentWs = useCallback((next: RecentStore, platformNow?: Platform) => {
    recentWsRef.current = next;
    setRecentWs(next);
    const p = platformNow ?? stateRef.current.platform;
    // §H25: recent-workspaces.json is workspace machinery — never written
    // without the sidebar seam (web), even via Clear Menu.
    if (p?.readDirEntries) void writeRecentStore(p, 'recent-workspaces.json', next);
  }, []);
  const recentWsRef = useRef<RecentStore>({ version: 1, entries: [] });

  /** SPEC34 §2.3: write-through mirror of roots+expanded+eye for foldertree.json. */
  const folderStateRef = useRef<{ roots: string[]; expanded: Set<string>; showNonMd: boolean; openOnly: boolean }>({
    roots: [],
    expanded: new Set(),
    showNonMd: false,
    openOnly: false,
  });

  /** PRD 002 §C7: the single current workspace (none | untitled | named). */
  const curWorkspaceRef = useRef<Workspace>({ kind: 'none' });
  /** Issue #22: the ref's kind mirrored into state so the derived app mode re-renders. */
  const [wsKind, setWsKind] = useState<Workspace['kind']>('none');
  // PRD 007 Req 21/22: the managed (hosted) workspace dialogs, opened from the
  // start page or the File menu. Mounted on the `workspaces` capability, so
  // this state is simply never reached on a flavor without it.
  const [managedWsDialog, setManagedWsDialog] = useState<'none' | 'new' | 'open'>('none');

  const persistFolderState = useCallback((platformNow?: Platform) => {
    const p = platformNow ?? stateRef.current.platform;
    if (!p) return;
    const st = folderStateRef.current;
    // Issue #81: the live open set writes through unconditionally — open
    // state belongs to the current workspace's session, not to any setting.
    const open = { files: openFilesRef.current, active: activeFileRef.current };
    const ws = curWorkspaceRef.current;
    void (async () => {
      try {
        const cfg = await p.configDir();
        await p.writeTextFile(
          p.join(cfg, 'foldertree.json'),
          serializeFolderState({
            version: 1,
            root: st.roots[0] ?? null,
            expanded: [...st.expanded],
            showNonMd: st.showNonMd,
            openFiles: open.files,
            activeFile: open.active,
            openOnly: st.openOnly,
          })
        );
        // PRD 002 §B6/§F22: the same state is the current workspace's own
        // machine-local session store, keyed under <configDir>/session/ so
        // one workspace's tabs never leak into another's (or any shareable
        // file). foldertree.json above stays as the legacy mirror.
        if (!p.readDirEntries) return; // no workspace UI ⇒ no session stores (web)
        const dir = p.join(cfg, SESSION_DIR_NAME);
        await p.mkdirp(dir);
        if (ws.kind !== 'none') {
          const session: WorkspaceSession = {
            version: 1,
            folders: ws.folders.map((f) => f.path),
            expanded: [...st.expanded],
            showNonMd: st.showNonMd,
            openFiles: open.files,
            activeFile: open.active,
            openOnly: st.openOnly,
            // §C11: the untitled slot also carries the workspace settings.
            ...(ws.kind === 'untitled' ? { settings: ws.settings } : {}),
          };
          const slot = ws.kind === 'untitled' ? UNTITLED_SLOT_FILE : `${sessionKeyForWorkspaceFile(ws.file)}.json`;
          await p.writeTextFile(p.join(dir, slot), serializeWorkspaceSession(session));
        }
        // Issue #81 retired the §C13 launch pointer: launch never reopens a
        // workspace, so nothing marks which one was current.
      } catch {
        /* best effort */
      }
    })();
  }, []);

  /**
   * PRD 002 §C11–§C12: apply a workspace transition and autosave its stores —
   * a named workspace writes membership/settings back to its .marky-workspace
   * file (no explicit Save command, never session state); converting untitled
   * → named clears the single current-untitled slot. #16's menu flows (Add
   * Folder / Open Workspace / Save Workspace As) call this same seam.
   */
  /**
   * The raw layer inputs and workspace-open flag as of right now (PRD 002
   * §E18/§F21) — everything the settings panels render indicators from.
   */
  const currentLayerView = useCallback((): { layers: SettingsLayers; workspaceOpen: boolean } => {
    const ws = curWorkspaceRef.current;
    return {
      layers: {
        global: settingsLayersRef.current.global,
        team: settingsLayersRef.current.team,
        workspace: ws.kind === 'none' ? undefined : ws.settings,
        user: settingsLayersRef.current.user,
      },
      workspaceOpen: ws.kind !== 'none',
    };
  }, []);

  /** Re-run four-layer resolution and refresh both the effective settings and the panel's layer view. */
  const applyResolved = useCallback(() => {
    const view = currentLayerView();
    setLayerView(view);
    setSettings((prev) => {
      const next = { ...resolveSettings(view.layers), ...sessionOverridesRef.current };
      // Identity-stable: unchanged resolutions keep the previous object (no
      // spurious re-renders, editor reconfigures, or aux broadcasts), and an
      // entry-wise-equal hotkeys map keeps its identity too.
      const patch = diffSettings(prev, next);
      if (Object.keys(patch).length === 0) return prev;
      if (!patch.hotkeys) next.hotkeys = prev.hotkeys;
      return next;
    });
  }, [currentLayerView]);

  const updateWorkspace = useCallback(
    (next: Workspace, platformNow?: Platform) => {
      const prev = curWorkspaceRef.current;
      curWorkspaceRef.current = next;
      setWsKind(next.kind); // issue #22: the derived app mode follows
      // §E18/§B5: the workspace layer changed — pinned settings apply (or
      // stop applying) immediately, and the settings panels see fresh layers.
      applyResolved();
      const p = platformNow ?? stateRef.current.platform;
      if (!p) return;
      void (async () => {
        try {
          if (next.kind === 'named') {
            await p.writeTextFile(next.file, serializeWorkspaceFile(next, p.dirname(next.file)));
          }
          if (prev.kind === 'untitled' && next.kind === 'named') {
            const slot = p.join(await p.configDir(), SESSION_DIR_NAME, UNTITLED_SLOT_FILE);
            if (await p.exists(slot)) await p.remove(slot);
          }
        } catch {
          /* best effort */
        }
      })();
      persistFolderState(platformNow);
    },
    [applyResolved, persistFolderState]
  );

  /** SPEC36: the single write path for the open set — refs, state, disk. */
  const commitOpenSet = useCallback(
    (list: string[], active: string | null) => {
      openFilesRef.current = list;
      activeFileRef.current = active && list.includes(active) ? active : null;
      setOpenFiles(list);
      persistFolderState();
    },
    [persistFolderState]
  );

  /** SPEC36 §2.2: stash the active doc's volatile state before a tab switch. */
  const parkActive = useCallback(() => {
    const s = stateRef.current;
    if (!s.docPath) return;
    // Issue #64: flush the debounced comment autosave before parking — the
    // park entry and the disk must agree for openDoc's freshness check to
    // compare comments at all (and a comment edit followed by a quick tab
    // switch used to sit unpersisted until the next edit).
    commentFlushRef.current?.();
    parkRef.current.set(s.docPath, {
      // Issue #42 / SPEC38 §3.5: park entries store CANONICAL text — mid
      // table-mode the live buffer holds the display grid, and every parked
      // dirty check compares against the compact savedText. The outgoing
      // editor is still mounted here, so canonicalOf still collapses.
      buffer: canonicalOf(s.buffer),
      savedText: s.savedText,
      comments: s.comments,
      stores: s.stores, // PRD 004 Req 13: the verdict follows the document
      editorHistory: editorHistoryRef.current,
    });
    // If the switch leaves edit mode, the real snapshot only exists after the
    // editor unmounts — the post-commit effect patches this entry then.
    parkHistoryFixupRef.current = s.docPath;
  }, [canonicalOf]);

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
      let roots = folderStateRef.current.roots;
      let chain: string[] = [];
      for (const r of roots) {
        chain = ancestorsOf(r, path, p.dirname);
        if (chain.length > 0) break;
      }
      let expanded: Set<string>;
      if (chain.length === 0) {
        // PRD 002 §D17: a multi-root workspace's membership is never
        // retargeted by an outside open — skip the reveal entirely.
        if (roots.length > 1) return;
        const root = p.dirname(path);
        roots = [root];
        chain = [root];
        setFolderRoots(roots);
        setFolderChildren({});
        expanded = new Set();
      } else {
        expanded = new Set(folderStateRef.current.expanded);
      }
      for (const dir of chain) expanded.add(dir);
      setFolderExpanded(expanded);
      folderStateRef.current = { ...folderStateRef.current, roots, expanded };
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
   * SPEC35 §4: show what just landed in `dir` — the directory opens (a new
   * folder of its own stays collapsed), the expansion is persisted, and the
   * directory re-lists so the new row is there.
   */
  const revealNewEntry = useCallback(
    async (p: Platform, dir: string) => {
      const nextExpanded = new Set(folderStateRef.current.expanded);
      nextExpanded.add(dir);
      folderStateRef.current = { ...folderStateRef.current, expanded: nextExpanded };
      setFolderExpanded(nextExpanded);
      persistFolderState(p);
      await listFolderDir(p, dir);
    },
    [persistFolderState, listFolderDir]
  );

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
        await revealNewEntry(p, dir);
        startFolderRename({ path, openOnDone: kind === 'file' });
      } catch {
        /* creation failed — no row to rename */
      }
    },
    [revealNewEntry, startFolderRename]
  );

  /**
   * PRD 007 Req 17: ask the platform which file operations this user holds.
   * A platform without the seam has no permission model — everything its
   * other seams offer stays offered.
   */
  useEffect(() => {
    const p = stateRef.current.platform;
    if (!p) return;
    let live = true;
    void grantsFor(p).then((grants) => {
      if (live) setFolderGrants(grants);
    });
    return () => {
      live = false;
    };
  }, [folderRoots]);

  /**
   * PRD 007 Req 17: the same question for the open document — asked per path,
   * so an untitled buffer (which belongs to no scope until Save As says where
   * it lands) and a doc the flavor holds locally both stay editable.
   */
  useEffect(() => {
    const p = stateRef.current.platform;
    if (!p) return;
    if (!docPath) {
      setDocGrants(ALL_FILE_GRANTS);
      return;
    }
    let live = true;
    void grantsFor(p, docPath).then((grants) => {
      if (live) setDocGrants(grants);
    });
    return () => {
      live = false;
    };
  }, [docPath, platform]);

  /**
   * PRD 007 Req 19: upload ONE file into `dir`. The shared rule decides
   * first — an oversize or disallowed file is refused with the reason and
   * nothing is sent — then a free sibling name is chosen from the live
   * listing, so an upload never silently replaces what is already there.
   */
  const folderUpload = useCallback(
    async (dir: string, file: File) => {
      const p = stateRef.current.platform;
      if (!p?.uploadFile || !p.readDirEntries) return;
      const rejection = uploadRejection(file.name, file.size);
      if (rejection) {
        setFolderNotice(rejection);
        return;
      }
      try {
        const listing = await p.readDirEntries(dir);
        const name = uniqueChildName(
          listing.map((e) => e.name),
          file.name
        );
        await p.uploadFile(dir, name, new Uint8Array(await file.arrayBuffer()));
        await revealNewEntry(p, dir);
        setFolderNotice(null);
      } catch (e) {
        setFolderNotice(e instanceof Error ? e.message : String(e));
      }
    },
    [revealNewEntry]
  );

  /** SPEC35 §3: a folder-menu item was invoked — run the operation. */
  const folderMenuAction = useCallback(
    (id: string, target: { kind: 'dir' | 'file' | 'root'; path: string }) => {
      const p = stateRef.current.platform;
      if (!p) return;
      const roots = folderStateRef.current.roots;
      const root = roots.find((r) => target.path === r || ancestorsOf(r, target.path, p.dirname).length > 0) ?? null;
      if (id === 'reveal') void p.revealPath?.(target.path);
      else if (id === 'copy-path') void p.copyText?.(target.path);
      else if (id === 'copy-relative-path' && root) void p.copyText?.(relativePath(root, target.path));
      else if (id === 'rename') startFolderRename({ path: target.path, openOnDone: false });
      else if (id === 'new-file') void folderCreate(p, target.path, 'file');
      else if (id === 'new-folder') void folderCreate(p, target.path, 'dir');
      else if (id === 'delete') setFolderDeletePrompt({ path: target.path, isDir: target.kind === 'dir' });
      // PRD 007 Req 19: the folder menu's upload arms the hidden picker for
      // the clicked folder; the file menu's download takes the clicked file.
      else if (id === 'upload') {
        setUploadDir(target.path);
        uploadInputRef.current?.click();
      } else if (id === 'download') {
        void p.downloadFile?.(target.path).catch((e: unknown) => {
          setFolderNotice(e instanceof Error ? e.message : String(e));
        });
      }
    },
    [startFolderRename, folderCreate]
  );

  // Guards the SPEC15/SPEC16 preview restore against firing on stale html
  // (opening a doc from edit mode re-runs the effect before the new render).
  const renderPendingRef = useRef(false);

  // Issue #43: the document epoch. Bumped by closeToSplash — the single choke
  // point of every path back to the splash — so an in-flight renderMarkdown
  // promise from the closed document can never land after close. The render
  // effect's `cancelled` flag alone is not enough: it flips only at effect
  // cleanup, and a promise resolving in the gap between the close commit and
  // that cleanup would still repopulate `html` under the splash.
  const docEpochRef = useRef(0);

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
            setStores(fresh.stores); // the verdict re-derives from what landed
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
    let saved: string;
    let stored: CommentData[];
    let storeState: DocStores = CLEAN_STORES;
    let history: unknown = null;
    // SPEC36 §2: a parked file restores from its bundle — unless it is clean
    // and the disk moved on underneath (then the disk wins, fresh history).
    // A dirty parked buffer ALWAYS wins, the watcher's never-clobber rule.
    const parked = parkRef.current.get(path);
    if (parked) {
      parkRef.current.delete(path);
      // Issue #64: a comment write flushed by parkActive may still be in
      // flight — drain the queue so the freshness read below sees it.
      if (commentWriteRef.current) await commentWriteRef.current;
      let disk: { content: string; comments: CommentData[]; stores: DocStores } | null = null;
      try {
        disk = await loadDocParts(p, path);
      } catch {
        /* unreadable right now — the parked bundle carries on */
      }
      // Issue #42: both checks ride the shared predicate — a parked buffer
      // clean modulo EOL is clean, and a disk that moved only in EOL
      // representation has not moved on.
      // Issue #64: reopening a file lands here now that plain opens are
      // additive (it used to be a fresh disk read) — so "the disk moved on"
      // must also cover the comment stores (PRD 004: a trailer turned
      // unreadable, or readable again, underneath the clean parked buffer)
      // and the comments themselves (an external tool — e.g. the sibling
      // md-with-comments app — edited the sidecar or trailer). Comments
      // compare by canonical serialization (PRD 004 Req 27: same data ⇒
      // identical bytes, whatever the in-memory key order); parkActive's
      // flush plus the queue drain above guarantee an in-app edit sitting
      // mid-debounce has already landed on disk, so it never misreads as an
      // external change.
      if (
        disk &&
        !isDirtyText(parked.buffer, parked.savedText) &&
        (isDirtyText(disk.content, parked.savedText) ||
          JSON.stringify(disk.stores) !== JSON.stringify(parked.stores) ||
          serializeSidecar(disk.comments) !== serializeSidecar(parked.comments))
      ) {
        content = disk.content;
        saved = disk.content;
        stored = disk.comments;
        storeState = disk.stores;
      } else {
        content = parked.buffer;
        saved = parked.savedText;
        stored = parked.comments;
        storeState = parked.stores;
        history = parked.editorHistory;
      }
    } else {
      try {
        ({ content, comments: stored, stores: storeState } = await loadDocParts(p, path));
      } catch {
        return; // unreadable path (e.g. deleted file in a stale open event)
      }
      saved = content;
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
    // Fresh doc ⇒ fresh (null) history; parked ⇒ its own. Installed by the
    // post-commit effect — an unmounting editor's snapshot lands after us.
    pendingHistoryRef.current = { value: history };
    pendingEditorSelRef.current = null; // SPEC25: selection never crosses documents
    activeCueRef.current = null; // SPEC44: cues re-derive from the new caret
    pendingPreviewSelRef.current = null;
    lastEditorSelRef.current = { from: 0, to: 0 };
    setFmOverride(null); // SPEC26 §3.3: a new document follows the setting
    setDocPath(path);
    setUntitled(false); // SPEC22 §3.3: a real document replaces any untitled buffer
    setBuffer(content);
    setSavedText(saved);
    setComments(stored);
    setStores(storeState); // PRD 004 Req 13: per document, never per session
    setPositions({});
    setActiveId(null);
    setPending(null);
    setMode('preview');
    setShowDiff(false); // SPEC16 §2: the diff toggle resets per document
    setDiff(null);

    // SPEC36 §3: the active document is always a member of the open set.
    commitOpenSet(addOpen(openFilesRef.current, path), path);
    await installWatcher(p, path);
  }, [loadDocParts, recordPosition, currentTopLine, commitRecent, revealInFolders, commitOpenSet, installWatcher]);

  /**
   * SPEC36: the editor snapshots its state into editorHistoryRef during its
   * UNMOUNT cleanup — which runs in the same commit as a doc switch but
   * after openDoc's synchronous writes. This post-commit effect (a) patches
   * the outgoing doc's park entry with that real snapshot and (b) installs
   * the incoming doc's pending history over the clobber.
   */
  useEffect(() => {
    const fixup = parkHistoryFixupRef.current;
    if (fixup) {
      parkHistoryFixupRef.current = null;
      const entry = parkRef.current.get(fixup);
      if (entry) entry.editorHistory = editorHistoryRef.current;
    }
    if (pendingHistoryRef.current) {
      editorHistoryRef.current = pendingHistoryRef.current.value;
      pendingHistoryRef.current = null;
    }
  }, [docPath, untitled]);

  /**
   * SPEC36 §3.1/§3.2 (amended, issue #64): every switch to another file
   * parks the outgoing doc and opens the target — never a prompt. An
   * already-open target just activates; a not-open one joins the set
   * (openDoc's addOpen), exactly like Mod+click — the replace path is
   * retired. Callers have already resolved the §2.6 dirty-untitled guard
   * (a real dirty doc just parks).
   */
  const parkAndOpen = useCallback(
    async (p: Platform, path: string) => {
      if (stateRef.current.docPath === path) return;
      parkActive();
      await openDoc(p, path);
    },
    [parkActive, openDoc]
  );

  /**
   * SPEC36 §3.2 (amended, issue #64): every user-initiated open routes here
   * and opens ADDITIVELY — no unsaved-changes prompt, open-set member or
   * not. §2.6's dirty-untitled guard is the one prompt left.
   */
  const openDocGuarded = useCallback(
    (p: Platform, path: string) => {
      const s = stateRef.current;
      if (s.docPath === path) {
        void openDoc(p, path); // same-path re-open (existing semantics)
        return;
      }
      // §2.6: a dirty untitled buffer can't park — EVERY navigation away
      // from it keeps the classic guard, open-set member or not.
      if (s.untitled && s.dirty) {
        setOpenPrompt({ kind: 'open', path });
        return;
      }
      void parkAndOpen(p, path);
    },
    [openDoc, parkAndOpen]
  );

  /** SPEC36 §3.1: Mod+click — open IN ADDITION and activate; no guard ever. */
  const modOpenFile = useCallback(
    (path: string) => {
      const p = stateRef.current.platform;
      if (!p) return;
      const s = stateRef.current;
      if (s.untitled && s.dirty) {
        setOpenPrompt({ kind: 'open', path }); // §2.6: untitled can't park
        return;
      }
      void parkAndOpen(p, path); // active ⇒ no-op; not-open adds and activates
    },
    [parkAndOpen]
  );

  /** SPEC4 clean start: close the buffer down to the splash (SPEC36 §3.5). */
  const closeToSplash = useCallback(() => {
    recordPosition(stateRef.current.docPath, currentTopLine());
    docEpochRef.current++; // issue #43: orphan any in-flight markdown render
    // Issue #43: the preview panes are imperative (`innerHTML`), so scrub
    // them here, synchronously — no React effect ordering can then leave the
    // closed document's DOM behind for the splash to composite over.
    if (docRef.current) docRef.current.innerHTML = '';
    if (splitDocRef.current) splitDocRef.current.innerHTML = '';
    docTextRef.current = '';
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
    setStores(CLEAN_STORES); // PRD 004: a clean buffer never inherits a verdict
    setPositions({});
    setActiveId(null);
    setPending(null);
    setMode('preview');
    setShowDiff(false);
    setDiff(null);
    unwatchRef.current?.();
    unwatchRef.current = null;
  }, [recordPosition, currentTopLine]);

  /** SPEC36 §3.5: drop `path` from the set; neighbor activates, else splash. */
  const finishCloseFile = useCallback(
    (p: Platform, path: string) => {
      const { list, nextActive } = closeOpen(openFilesRef.current, path);
      parkRef.current.delete(path);
      const wasActive = stateRef.current.docPath === path;
      commitOpenSet(list, wasActive ? null : activeFileRef.current);
      if (!wasActive) return;
      if (nextActive) void openDoc(p, nextActive);
      else closeToSplash();
    },
    [commitOpenSet, openDoc, closeToSplash]
  );

  /** SPEC36 §3.4: the row ✕ — dirty files activate and prompt first. */
  const closeOpenFile = useCallback(
    (path: string) => {
      const p = stateRef.current.platform;
      if (!p) return;
      void (async () => {
        const s = stateRef.current;
        const isActive = s.docPath === path;
        const isDirty = isActive ? s.dirty : parkedDirty(path);
        if (isDirty) {
          if (!isActive) await parkAndOpen(p, path); // §3.4: visible behind the modal
          setOpenPrompt({ kind: 'close-file', path });
          return;
        }
        finishCloseFile(p, path);
      })();
    },
    [parkAndOpen, finishCloseFile, parkedDirty]
  );

  /** SPEC36 §6.3: Ctrl+Tab / Ctrl+Shift+Tab — tree order, wrap, no prompts. */
  const cycleFile = useCallback(
    (dir: 1 | -1) => {
      const p = stateRef.current.platform;
      if (!p) return;
      const s = stateRef.current;
      const list = openFilesRef.current;
      if (s.untitled) {
        // §2.6: untitled sits outside the set — the first open file is the
        // target, and a dirty untitled routes through the guard.
        const target = list[0];
        if (!target) return;
        if (s.dirty) setOpenPrompt({ kind: 'open', path: target });
        else void parkAndOpen(p, target);
        return;
      }
      const target = cycleOpen(list, s.docPath, dir);
      if (target) void parkAndOpen(p, target);
    },
    [parkAndOpen]
  );

  /** SPEC36 §7: the dirty documents, tree order, dirty untitled last. */
  const dirtyDocsQueue = useCallback((): string[] => {
    const s = stateRef.current;
    const q: string[] = [];
    for (const f of openFilesRef.current) {
      const isDirty = f === s.docPath ? s.dirty : parkedDirty(f);
      if (isDirty) q.push(f);
    }
    if (s.untitled && s.dirty) q.push(UNTITLED_SENTINEL);
    return q;
  }, [parkedDirty]);

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
      // SPEC36: the open set, the active pointer, and parked buffers follow.
      for (const [k, v] of [...parkRef.current]) {
        const nk = remap(k);
        if (nk !== null) {
          parkRef.current.delete(k);
          parkRef.current.set(nk, v);
        }
      }
      const nextActive = activeFileRef.current ? (remap(activeFileRef.current) ?? activeFileRef.current) : null;
      commitOpenSet(remapOpen(openFilesRef.current, oldPath, newPath), nextActive);
    },
    [installWatcher, persistFolderState, commitRecent, commitOpenSet]
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
   * PRD 007 Req 18: a row dropped on a folder row. `moveTarget` decides
   * whether the drop is legal at all (no folder into its own descendant, no
   * no-op back into the same parent, no name collision); a legal one runs the
   * SAME rename seam the in-place rename does, so open tabs and expanded
   * state follow through `remapAfterRename`.
   */
  const folderMoveEntry = useCallback(
    async (source: string, destDir: string) => {
      const p = stateRef.current.platform;
      if (!p?.renameEntry || !p.readDirEntries) return;
      const listing = await p.readDirEntries(destDir).catch(() => []);
      const target = moveTarget(
        source,
        destDir,
        listing.map((e) => e.name)
      );
      if (!target.ok) {
        setFolderNotice(target.reason); // null ⇒ a no-op drop, nothing to say
        return;
      }
      try {
        await p.renameEntry(source, target.path);
      } catch (e) {
        setFolderNotice(e instanceof Error ? e.message : String(e));
        return;
      }
      setFolderNotice(null);
      await listFolderDir(p, p.dirname(source));
      await listFolderDir(p, destDir);
      remapAfterRename(p, source, target.path);
    },
    [listFolderDir, remapAfterRename]
  );

  /**
   * Persist comments per the active storage mode (SPEC2 FR-C.5). Embedded
   * writes rewrite the file as LAST-SAVED text + trailer — never flushing
   * unsaved text edits — and clean up a stale sidecar (migration). Sidecar
   * mode behaves exactly like v1. Issue #64: writes queue serially behind
   * commentWriteRef so openDoc can await everything pending before a parked
   * doc's freshness read.
   */
  const persistComments = useCallback((current: CommentData[]) => {
    const s = stateRef.current; // captured NOW — the doc may switch under the queue
    const prev = commentWriteRef.current;
    const job = (async () => {
      await prev;
      if (!s.platform || !s.docPath) return;
      // PRD 004 Reqs 14/15: a document with an unreadable store never has its
      // comment stores written — not the trailer, not the sidecar, and not the
      // "clean up a stale sidecar" removal below. Authoring is closed in the UI
      // too; this is the belt to that pair of braces.
      if (hasUnreadableStore(s.stores)) return;
      // PRD 007 Req 17: and a member without comment.write never attempts the
      // sidecar write at all — the composer is gone, so there is nothing to
      // persist, and an autosave that could only earn a 403 is not issued.
      if (!s.docGrants.commentWrite) return;
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
    })();
    commentWriteRef.current = job;
    return job;
  }, []);

  // --- bootstrap ---------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    (async () => {
      const p = await getPlatform();
      if (disposed) return;

      const cfg = await p.configDir();
      // PRD 002 §F21 layer sources: Global = DEFAULT_SETTINGS plus an optional
      // admin file, Team = reserved (no local file), Workspace = empty at boot
      // (issue #81), User = the existing settings.json. An absent or corrupt
      // file simply leaves its layer empty.
      const readSettingsLayer = async (name: string): Promise<unknown> => {
        try {
          const path = p.join(cfg, name);
          if (await p.exists(path)) return JSON.parse(await p.readTextFile(path));
        } catch {
          /* absent or corrupt → empty layer */
        }
        return undefined;
      };
      // Issue #81 (reversing PRD 002 §C13 / SPEC30 §2): launch never reopens
      // a workspace or a document — every boot lands on the splash with no
      // workspace current. Session stores keep every workspace's open state
      // on disk; only an explicit reopen reads them back.
      const globalRaw = await readSettingsLayer('global-settings.json');
      const userRaw = await readSettingsLayer('settings.json');
      // §E18: keep the RAW layers — the panel's scope tabs write them back
      // individually, so the resolved result must never be re-persisted whole.
      settingsLayersRef.current = {
        global: globalRaw,
        user:
          typeof userRaw === 'object' && userRaw !== null && !Array.isArray(userRaw)
            ? (userRaw as Record<string, unknown>)
            : {},
      };
      let loaded = resolveSettings({
        global: globalRaw,
        // §B5/§F22: no workspace is current at boot (issue #81), so the
        // Workspace layer is empty until one is explicitly opened.
        user: userRaw,
      });
      if (p.kind === 'web') {
        // No sidecars on web — a session-only override, never a layer write.
        sessionOverridesRef.current.commentStorage = 'embedded';
        loaded = { ...loaded, commentStorage: 'embedded' };
        // SPEC17 §2.2: a review bundle may carry its export theme — apply it
        // for the session only (setSettings below never persists by itself).
        const payload = extractReviewPayload(document);
        if (payload?.theme) {
          sessionOverridesRef.current.themeLight = payload.theme;
          sessionOverridesRef.current.themeDark = payload.theme;
          loaded = { ...loaded, themeLight: payload.theme, themeDark: payload.theme };
        }
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

      // PRD 002 §D15: recent workspaces — their own file, same tolerance.
      try {
        const recWsPath = p.join(cfg, 'recent-workspaces.json');
        if (await p.exists(recWsPath)) {
          const loaded = parseRecent(await p.readTextFile(recWsPath));
          recentWsRef.current = loaded;
          setRecentWs(loaded);
        }
      } catch {
        /* start empty */
      }

      // Issue #81: no sidebar or workspace state restores at boot — the
      // saved sessions (and the legacy foldertree.json mirror) stay on disk
      // untouched until a workspace is explicitly reopened.

      setPlatform(p);
      // §E18: the panel's layer view boots alongside the resolved settings.
      setLayerView(currentLayerView());
      setSettings(loaded);
      setThemes(themeList);

      // Clean start (SPEC4 §5): no auto-opened welcome — only explicit opens.
      // Issue #82: every OS-delivered path (macOS RunEvent::Opened, pending
      // drains, Windows/Linux CLI args) lands here — .marky-workspace files
      // open as workspaces, everything else stays a document.
      await p.onOpenFile((path) =>
        isWorkspaceFilePath(path) ? openWorkspacePathRef.current(p, path) : openDocGuarded(p, path)
      );
      await p.onFileDrop((path) => openDocGuarded(p, path));

      // SPEC36 §7: the close guard triggers the quit walk over EVERY dirty
      // document (the walk ref dodges a declaration-order cycle).
      await p.registerCloseGuard(
        // Issue #22: a changed untitled workspace blocks too — quitting
        // discards it, so the Save / Don't Save / Cancel prompt must run.
        () => dirtyDocsQueue().length > 0 || untitledWorkspaceChanged(curWorkspaceRef.current),
        () => startQuitWalkRef.current()
      );

      // SPEC30 §3 (issue #81 removed §2's reopen-on-launch): only the draft
      // offer runs after boot. Explicit opens (association/CLI/#open/review)
      // land through the drains above — give them a beat first, so the
      // draft's staleness check sees the opened document.
      setTimeout(() => {
        void (async () => {
          if (disposed) return;
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
  }, [openDocGuarded, openDoc, listFolderDir, dirtyDocsQueue, commitOpenSet]);

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
    wsClosePrompt ||
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
    // Pane content floor: below it, panes scroll sideways instead of reflowing.
    el.style.setProperty('--mm-pane-min', `${settings.paneMinWidth}px`);
    // Text-only zoom (SPEC4 §4): a font multiplier consumed by the document
    // and editor styles — never CSS `zoom`, which would scale the whole UI.
    if (settings.zoom === 100) el.style.removeProperty('--mm-zoom');
    else el.style.setProperty('--mm-zoom', String(settings.zoom / 100));
    // `platform` in the deps: the pre-boot render has no rootRef, so this
    // must re-run once the real root mounts — otherwise defaults that equal
    // the initial state (e.g. fontSize 12) are never applied.
  }, [platform, settings.fontSize, settings.margins, settings.zoom, settings.paneMinWidth]);

  // PRD 003 Reqs 9–12: "the next pane-setting flip is a user toggle — slide".
  // Consumed (and cleared) by usePaneSlide's effect; unarmed flips (folder
  // reveals forcing the pane open, workspace-layer resolution swaps, launch
  // restores) switch instantly, exactly as before this PRD.
  const armFolderSlide = useRef(false);
  const armSplitSlide = useRef(false);

  // --- settings persistence ---------------------------------------------------
  /**
   * PRD 002 §E18 layer-targeted writes: a 'user' patch lands ONLY in
   * settings.json (the raw User layer); a 'workspace' patch lands ONLY in the
   * current workspace's settings (named → its .marky-workspace autosave,
   * untitled → the session slot, via the updateWorkspace seam). Either way
   * the effective settings re-resolve immediately.
   */
  const applySettingsEdit = useCallback(
    (scope: SettingsScopeTab, patch: Partial<Settings>) => {
      if (Object.keys(patch).length === 0) return;
      // PRD 003 Req 12: an explicit splitEdit edit slides the pane. Every
      // surface — the toggleSplit command (chevrons, View menu, Mod+\) and
      // the Settings checkbox in the overlay or the aux window — lands here;
      // programmatic resolution changes (workspace open/close) never do.
      if (patch.splitEdit !== undefined && patch.splitEdit !== stateRef.current.settings.splitEdit) {
        armSplitSlide.current = true;
      }
      if (scope === 'workspace') {
        const ws = curWorkspaceRef.current;
        if (ws.kind === 'none') return;
        updateWorkspace({ ...ws, settings: sanitizeWorkspaceSettings({ ...ws.settings, ...patch }) });
        return;
      }
      // An explicit user edit beats any session-only override of the same key.
      for (const k of Object.keys(patch) as Array<keyof Settings>) delete sessionOverridesRef.current[k];
      settingsLayersRef.current.user = { ...settingsLayersRef.current.user, ...patch };
      applyResolved();
      const p = stateRef.current.platform;
      if (!p) return;
      void (async () => {
        const path = p.join(await p.configDir(), 'settings.json');
        await p.writeTextFile(path, serializeSettingsLayer(settingsLayersRef.current.user));
      })();
    },
    [applyResolved, updateWorkspace]
  );

  /** Whole-Settings seam kept for in-app controls: the changed keys become a User-layer patch. */
  const updateSettings = useCallback(
    (next: Settings) => {
      applySettingsEdit('user', diffSettings(stateRef.current.settings, next));
    },
    [applySettingsEdit]
  );

  /**
   * Issue #22: run `proceed` through the changed-workspace guard. A changed
   * untitled workspace (non-empty workspace settings or 2+ folders) is about
   * to be discarded — Save / Don't Save / Cancel prompt first. Named
   * workspaces autosave and never prompt; unchanged untitled ones just go.
   */
  const guardWorkspaceDiscard = useCallback((proceed: () => void) => {
    if (!untitledWorkspaceChanged(curWorkspaceRef.current)) {
      proceed();
      return;
    }
    wsCloseResumeRef.current = proceed;
    setWsClosePrompt(true);
  }, []);

  /**
   * Issue #81: bring a reopened workspace's saved open set back — existing
   * files only, and onto an empty screen the saved active file (fallback:
   * the first survivor) reopens with the set. Only in-root files are
   * candidates — opening an outside-root member would retarget the root
   * (SPEC34 §5).
   */
  const restoreSessionOpenFiles = useCallback(
    async (p: Platform, session: WorkspaceSession, roots: string[]) => {
      const alive: string[] = [];
      for (const f of session.openFiles) if (await p.exists(f)) alive.push(f);
      commitOpenSet(alive, session.activeFile);
      const candidates = alive.filter((f) => roots.some((r) => ancestorsOf(r, f, p.dirname).length > 0));
      const st = stateRef.current;
      if (candidates.length > 0 && st.docPath === null && !st.untitled) {
        const act = session.activeFile && candidates.includes(session.activeFile) ? session.activeFile : candidates[0];
        await openDoc(p, act);
      }
    },
    [commitOpenSet, openDoc]
  );

  /** SPEC34 §4.2: pick a directory → root; the panel opens; no file opens. */
  const openFolderCmd = useCallback(() => {
    const p = stateRef.current.platform;
    if (!p?.openFolderDialog || !p.readDirEntries) return;
    // Issue #22: replacing a changed untitled workspace prompts first (§C8:
    // the pick starts a FRESH untitled workspace, discarding the current one).
    guardWorkspaceDiscard(() => {
      void (async () => {
        const picked = await p.openFolderDialog!();
        if (!picked) return;
        // Issue #81: picking the folder the untitled slot last held REVIVES
        // that session — its tabs and view state return like a named
        // workspace reopen. Any other pick starts fresh (§C8/§C11).
        let session: WorkspaceSession | null = null;
        try {
          const slotPath = p.join(await p.configDir(), SESSION_DIR_NAME, UNTITLED_SLOT_FILE);
          if (await p.exists(slotPath)) {
            const slot = parseWorkspaceSession(await p.readTextFile(slotPath));
            if (slot.folders.length === 1 && slot.folders[0] === picked) session = slot;
          }
        } catch {
          /* fresh */
        }
        const expanded = new Set(session && session.expanded.length > 0 ? session.expanded : [picked]);
        setFolderRoots([picked]);
        setFolderExpanded(expanded);
        setFolderChildren({});
        setFolderShowNonMd(session?.showNonMd ?? false);
        setFolderOpenOnly(session?.openOnly ?? false);
        folderStateRef.current = {
          roots: [picked],
          expanded,
          showNonMd: session?.showNonMd ?? false,
          openOnly: session?.openOnly ?? false,
        };
        // PRD 002 §C8: opening a folder starts a fresh untitled workspace holding
        // that one folder (a new untitled overwrites the slot, §C11); a revived
        // slot brings its workspace-scoped settings back with it.
        const ws = openFolderWorkspace(curWorkspaceRef.current, picked);
        updateWorkspace(ws.kind === 'untitled' && session?.settings ? { ...ws, settings: session.settings } : ws, p);
        if (session) await restoreSessionOpenFiles(p, session, [picked]);
        await listFolderDir(p, picked);
        for (const dir of expanded) if (dir !== picked) void listFolderDir(p, dir);
        if (!stateRef.current.settings.showFolders) {
          updateSettings({ ...stateRef.current.settings, showFolders: true });
        }
      })();
    });
  }, [guardWorkspaceDiscard, restoreSessionOpenFiles, listFolderDir, updateWorkspace, updateSettings]);

  /**
   * PRD 002 §D14: make `file` the current named workspace — corruption-
   * tolerant load, session state restored, sidebar roots swapped, MRU bump.
   */
  const openWorkspaceFromPath = useCallback(
    async (p: Platform, file: string) => {
      if (!p.readDirEntries) return;
      try {
        const data = parseWorkspaceFile(await p.readTextFile(file));
        const folders = workspaceFolderPaths(data, file);
        const unavailable = new Set<string>();
        for (const f of folders) if (!(await p.exists(f))) unavailable.add(f);
        const ws = workspaceFromFile(data, file, unavailable);
        // §B6: the workspace's own machine-local session state comes back.
        const sPath = p.join(await p.configDir(), SESSION_DIR_NAME, `${sessionKeyForWorkspaceFile(file)}.json`);
        const session = (await p.exists(sPath))
          ? parseWorkspaceSession(await p.readTextFile(sPath))
          : emptyWorkspaceSession(folders);
        session.folders = folders; // the .marky-workspace file owns membership
        const expanded = new Set(session.expanded.length > 0 ? session.expanded : folders);
        setFolderRoots(folders);
        setFolderExpanded(expanded);
        setFolderChildren({});
        setFolderShowNonMd(session.showNonMd);
        setFolderOpenOnly(session.openOnly);
        folderStateRef.current = { roots: folders, expanded, showNonMd: session.showNonMd, openOnly: session.openOnly };
        // The workspace flips FIRST so the tab restore below persists into
        // the opened workspace's own session, never the previous one's.
        updateWorkspace(ws, p);
        // §F22: the open-tab set restores (existing files only); the document
        // on screen stays — restoring tabs never yanks the editor.
        await restoreSessionOpenFiles(p, session, folders);
        commitRecentWs(rememberRecent(recentWsRef.current, file, new Date().toISOString()), p);
        for (const dir of new Set([...folders, ...expanded])) void listFolderDir(p, dir);
        if (!stateRef.current.settings.showFolders) {
          updateSettings({ ...stateRef.current.settings, showFolders: true });
        }
      } catch {
        showNotice(`Couldn’t open “${p.basename(file)}”`);
      }
    },
    [restoreSessionOpenFiles, updateWorkspace, commitRecentWs, listFolderDir, updateSettings, showNotice]
  );

  /** PRD 002 §D14: Open Workspace… — dialog filtered to .marky-workspace. */
  const openWorkspaceCmd = useCallback(() => {
    const p = stateRef.current.platform;
    if (!p?.openWorkspaceDialog || !p.readDirEntries) return;
    // Issue #22: replacing a changed untitled workspace prompts first.
    guardWorkspaceDiscard(() => {
      void (async () => {
        const picked = await p.openWorkspaceDialog!();
        if (!picked) return;
        await openWorkspaceFromPath(p, picked);
      })();
    });
  }, [guardWorkspaceDiscard, openWorkspaceFromPath]);

  // Issue #82: the boot effect's onOpenFile branch lands workspace files
  // here — same guarded open as a recent-workspace pick (a changed untitled
  // workspace prompts before being replaced). Assigned each render.
  openWorkspacePathRef.current = (p, path) => guardWorkspaceDiscard(() => void openWorkspaceFromPath(p, path));

  /**
   * PRD 002 §D14/§C8: Add Folder to Workspace… — a single-folder untitled
   * workspace becomes multi-root; with no workspace open it behaves like
   * Open Folder (a fresh untitled workspace holding the pick).
   */
  const addFolderToWorkspaceCmd = useCallback(async () => {
    const p = stateRef.current.platform;
    if (!p?.openFolderDialog || !p.readDirEntries) return;
    const picked = await p.openFolderDialog();
    if (!picked) return;
    const cur = curWorkspaceRef.current;
    const next = addWorkspaceFolder(cur, picked);
    if (next === cur) return; // duplicate member — nothing changes
    const roots = next.kind === 'none' ? [] : next.folders.map((f) => f.path);
    // Every root joins the expanded set so the grown tree stays visible
    // (the single root was implicitly expanded before it had a header row).
    const expanded = new Set([...folderStateRef.current.expanded, ...roots]);
    setFolderRoots(roots);
    setFolderExpanded(expanded);
    folderStateRef.current = { ...folderStateRef.current, roots, expanded };
    updateWorkspace(next, p);
    await listFolderDir(p, picked);
    if (!stateRef.current.settings.showFolders) {
      updateSettings({ ...stateRef.current.settings, showFolders: true });
    }
  }, [listFolderDir, updateWorkspace, updateSettings]);

  /**
   * PRD 007 Req 22 (PRD 002 §D14/§C11): New Workspace… for the LOCAL flavors —
   * the flow that did not exist before, when a local workspace was only
   * reachable through Open Folder + Save Workspace As…. The user names and
   * places the `.marky-workspace` file; it is written on the spot (an empty
   * named workspace is valid PRD 002 JSON), the app binds to it, it joins the
   * recent workspaces, and the sidebar opens on it with no roots and an Add
   * Folder button. Cancelling at any step changes nothing. The changed-
   * untitled-workspace guard runs first, exactly as Open Workspace… does.
   */
  const newWorkspaceCmd = useCallback(() => {
    const p = stateRef.current.platform;
    // The very predicate that puts the row on the start page and the item in
    // the File menu, so affordance and command cannot drift (startActions.ts).
    if (!p || !startCapabilities(p).localWorkspaceSave) return; // silent no-op, menu style
    guardWorkspaceDiscard(() => {
      void (async () => {
        const picked = await p.saveFileDialog!(`Untitled${WORKSPACE_FILE_EXT}`, 'workspace');
        if (!picked) return;
        const file = picked.endsWith(WORKSPACE_FILE_EXT) ? picked : `${picked}${WORKSPACE_FILE_EXT}`;
        setFolderRoots([]);
        setFolderExpanded(new Set());
        setFolderChildren({});
        folderStateRef.current = { ...folderStateRef.current, roots: [], expanded: new Set() };
        // updateWorkspace writes the file for a named workspace (§C12).
        updateWorkspace({ kind: 'named', file, folders: [], settings: {} }, p);
        commitRecentWs(rememberRecent(recentWsRef.current, file, new Date().toISOString()), p);
        if (!stateRef.current.settings.showFolders) {
          updateSettings({ ...stateRef.current.settings, showFolders: true });
        }
      })();
    });
  }, [guardWorkspaceDiscard, updateWorkspace, commitRecentWs, updateSettings]);

  /**
   * PRD 002 §D14/§C11: Save Workspace As… — untitled (or named) → named.
   * Issue #22: returns false when unsupported or the dialog was cancelled,
   * so the changed-workspace prompt's Save can abort the pending close.
   */
  const saveWorkspaceAsCmd = useCallback(async (): Promise<boolean> => {
    const p = stateRef.current.platform;
    const cur = curWorkspaceRef.current;
    if (!p?.saveFileDialog || cur.kind === 'none') return false; // silent no-op, menu style
    const suggested = cur.kind === 'named' ? p.basename(cur.file) : `Untitled${WORKSPACE_FILE_EXT}`;
    const picked = await p.saveFileDialog(suggested, 'workspace');
    if (!picked) return false;
    const file = picked.endsWith(WORKSPACE_FILE_EXT) ? picked : `${picked}${WORKSPACE_FILE_EXT}`;
    updateWorkspace(saveWorkspaceAs(cur, file), p);
    commitRecentWs(rememberRecent(recentWsRef.current, file, new Date().toISOString()), p);
    return true;
  }, [updateWorkspace, commitRecentWs]);

  /**
   * Issue #22: the workspace is closed for real — sidebar roots/tabs empty,
   * the open document closes too, the splash shows. Every dirty guard has
   * already run by the time this fires (see closeWorkspaceCmd).
   */
  const finishCloseWorkspace = useCallback(() => {
    const cur = curWorkspaceRef.current;
    if (cur.kind === 'none') return;
    setFolderRoots([]);
    setFolderExpanded(new Set());
    setFolderChildren({});
    folderStateRef.current = { ...folderStateRef.current, roots: [], expanded: new Set() };
    // The workspace flips to 'none' FIRST so the tab clear below can't
    // overwrite the closed workspace's saved session with an empty one.
    updateWorkspace(closeWorkspace(cur));
    commitOpenSet([], null);
    parkRef.current.clear();
    closeToSplash();
  }, [commitOpenSet, updateWorkspace, closeToSplash]);

  /**
   * PRD 002 §D16 + issue #22: Close Workspace — the changed-workspace prompt
   * (untitled with settings or 2+ folders), then the dirty-docs walk over
   * every open tab (Cancel anywhere aborts), then back to the splash.
   */
  const closeWorkspaceCmd = useCallback(() => {
    // §H25: no dialog capability to guard on here — gate on the sidebar seam
    // like every other workspace command, so the hotkey is inert on web.
    if (!stateRef.current.platform?.readDirEntries) return;
    if (curWorkspaceRef.current.kind === 'none') return;
    guardWorkspaceDiscard(() => {
      quitDoneRef.current = finishCloseWorkspace;
      quitQueueRef.current = dirtyDocsQueue();
      void processQuitWalkRef.current();
    });
  }, [guardWorkspaceDiscard, finishCloseWorkspace, dirtyDocsQueue]);

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
    const out = canonicalOf(s.buffer); // SPEC38 §3.5
    // PRD 004 Req 14: an unreadable store freezes this document's stores —
    // the trailer travels to the new path verbatim whatever the storage mode
    // (Save As must not be a way to drop it) and no migration runs.
    const text =
      hasUnreadableStore(s.stores) || s.settings.commentStorage === 'embedded'
        ? attachEmbedded(out, s.comments, s.stores.trailerBytes)
        : out;
    await p.writeTextFile(target, text);
    // An unreadable sidecar is never copied (out of scope) — and never read
    // from, so it contributed no comments to copy anyway.
    if (s.settings.commentStorage === 'sidecar' && !s.stores.sidecar && s.comments.length > 0) {
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
    // SPEC38 §3.5: mid-table-mode saves write the COMPACT table; the mode
    // itself stays on (savedText mirrors what landed on disk).
    const out = canonicalOf(s.buffer);
    // PRD 004 Req 14: an unreadable trailer is re-emitted byte-for-byte after
    // the modified content, and no store migration runs for such a document —
    // sidecar mode does NOT strip the trailer here as it otherwise would.
    const text =
      hasUnreadableStore(s.stores) || s.settings.commentStorage === 'embedded'
        ? attachEmbedded(out, s.comments, s.stores.trailerBytes)
        : out;
    try {
      await s.platform.writeTextFile(s.docPath, text);
    } catch (e) {
      // PRD 007 Req 20: the server refused the write because another member
      // saved first — their content is still what is stored. The buffer stays
      // dirty and unsaved until the user answers the prompt.
      if (isSaveConflict(e)) {
        setSaveConflict({ path: s.docPath, fileText: text, bufferText: out });
        return false;
      }
      // PRD 007 Req 17: a refusal the UI could not foresee — a role changed
      // in another tab, a grant set cached since page load — surfaces the
      // server's own named verb. The buffer stays dirty: the document is
      // never left looking saved when the save did not land.
      showNotice(`Couldn’t save: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    await s.platform.commitFile?.(s.docPath); // web download fallback for handle-less files
    setSavedText(out);
    if (s.settings.commentStorage === 'sidecar') {
      // Completes an embedded→sidecar migration: the plain write above
      // stripped the trailer; make sure the sidecar holds the comments.
      await persistComments(s.comments);
    }
    return true;
  }, [persistComments, saveDocAs, showNotice]);

  /**
   * PRD 007 Req 20: the conflict prompt's three answers, run through the
   * pure plan in lib/saveConflict.ts. Reload replaces the buffer with the
   * server's newer bytes (local edits discarded, buffer clean, the next save
   * conditional on the new version); Overwrite writes unconditionally and
   * re-arms it; Cancel leaves the buffer dirty and UNSAVED — never a silent
   * success.
   */
  const resolveSaveConflict = useCallback(
    async (choice: SaveConflictChoice) => {
      const conflict = saveConflict;
      const p = stateRef.current.platform;
      setSaveConflict(null);
      if (!conflict || !p) return;
      const plan = planSaveConflict(choice);
      if (plan.reload) {
        await openDoc(p, conflict.path);
        return;
      }
      if (plan.write) {
        await p.writeTextFile(conflict.path, conflict.fileText, { overwrite: true });
        await p.commitFile?.(conflict.path);
        setSavedText(conflict.bufferText);
      }
    },
    [saveConflict, openDoc]
  );

  const toggleMode = useCallback(() => {
    const s = stateRef.current;
    // Issue #40: entering edit mode requires an open document (file or
    // untitled) — the splash is preview-only, and a guardless toggle would
    // mount a phantom buffer that can never be saved. Guarding in the
    // handler keeps every dispatch route (hotkey, native menu, toolbar)
    // inert through one gate, like toggleFolders.
    if (s.mode === 'preview' && !s.docPath && !s.untitled) return;
    // PRD 007 Req 17: and entering edit mode needs the right to change the
    // document — the menu item is grayed, this makes the hotkey match.
    if (s.mode === 'preview' && !s.docGrants.edit) return;
    // SPEC25: carry the current selection across the mode switch.
    if (s.mode === 'preview') {
      pendingEditorSelRef.current =
        (docRef.current ? sourceRangeFromDomSelection(docRef.current) : null) ?? pendingEditorSelRef.current;
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
    setStores(CLEAN_STORES); // PRD 004: a clean buffer never inherits a verdict
    setPositions({});
    setActiveId(null);
    setPending(null);
    setMode('edit');
    setShowDiff(false);
    setDiff(null);
    unwatchRef.current?.();
    unwatchRef.current = null;
    // SPEC36 §2.6: untitled sits outside the set — the set is untouched
    // (the replaced file stays open, lazily reloadable). Deliberately no
    // persist here: ⌘N must not touch the disk (E78 discipline);
    // activeFile self-corrects on the next real open.
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

  /** SPEC36 §5.2: flip the only-open-files view (shows the panel if hidden). */
  const toggleOpenOnly = useCallback(() => {
    const st = stateRef.current;
    if (!st.platform?.readDirEntries) return; // no sidebar seam (web) ⇒ no-op
    if (curWorkspaceRef.current.kind === 'none') return; // issue #22: workspace mode only
    const next = !folderStateRef.current.openOnly;
    folderStateRef.current = { ...folderStateRef.current, openOnly: next };
    setFolderOpenOnly(next);
    persistFolderState();
    if (next && !st.settings.showFolders) updateSettings({ ...st.settings, showFolders: true });
  }, [persistFolderState, updateSettings]);

  /**
   * SPEC36 §7: advance the quit walk — activate the next dirty doc and show
   * the close prompt; an exhausted queue closes the window for real.
   */
  const processQuitWalk = useCallback(async () => {
    const p = stateRef.current.platform;
    const q = quitQueueRef.current;
    if (!p || !q) return;
    while (q.length > 0) {
      const t = q[0];
      const s = stateRef.current;
      if (t === UNTITLED_SENTINEL) {
        if (!(s.untitled && s.dirty)) {
          q.shift();
          continue;
        }
        setClosePrompt(true);
        return;
      }
      const isDirty = t === s.docPath ? s.dirty : parkedDirty(t);
      if (!openFilesRef.current.includes(t) || !isDirty) {
        q.shift();
        continue;
      }
      if (t !== s.docPath) await parkAndOpen(p, t); // §7.1: visible behind the modal
      setClosePrompt(true);
      return;
    }
    quitQueueRef.current = null;
    // Issue #22: a borrowed walk (Close Workspace) finishes its own way.
    const done = quitDoneRef.current;
    if (done) {
      quitDoneRef.current = null;
      done();
      return;
    }
    await deleteDraft();
    void p.closeNow();
  }, [parkAndOpen, deleteDraft, parkedDirty]);
  processQuitWalkRef.current = processQuitWalk;
  startQuitWalkRef.current = () => {
    // Issue #22: quitting discards a changed untitled workspace — the
    // Save / Don't Save / Cancel prompt runs before the dirty-docs walk.
    guardWorkspaceDiscard(() => {
      quitDoneRef.current = null;
      quitQueueRef.current = dirtyDocsQueue();
      void processQuitWalk();
    });
  };

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
      // SPEC36: deleted paths leave the open set and the park map too.
      for (const k of [...parkRef.current.keys()]) if (within(k)) parkRef.current.delete(k);
      const nextActive = activeFileRef.current && within(activeFileRef.current) ? null : activeFileRef.current;
      commitOpenSet(pruneOpen(openFilesRef.current, target.path), nextActive);
      const s = stateRef.current;
      if (s.docPath && within(s.docPath)) {
        // SPEC35 §6.3: to the splash, crash draft discarded (the confirm
        // already covered the data loss); reading positions age out on
        // their own pruning rules.
        closeToSplash();
        void deleteDraft();
      }
    },
    [listFolderDir, persistFolderState, commitRecent, commitOpenSet, closeToSplash, deleteDraft]
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

  // SPEC43 §4.5–4.6: the menu's clipboard row endpoints. Copy prefers the
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

  // SPEC43 §5.2: one guard for every format command — never steal a combo
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
      // PRD 007 Req 19: the File-menu entry points. Upload arms the hidden
      // picker for the sidebar root; download takes the open document.
      uploadFile: () => {
        setUploadDir(folderStateRef.current.roots[0] ?? null);
        uploadInputRef.current?.click();
      },
      downloadFile: () => {
        const s2 = stateRef.current;
        if (s2.platform?.downloadFile && s2.docPath) {
          void s2.platform.downloadFile(s2.docPath).catch((e: unknown) => {
            setFolderNotice(e instanceof Error ? e.message : String(e));
          });
        }
      },
      // PRD 007 Req 17: a save the role cannot make is not attempted — the
      // hotkey is as inert as the grayed menu row, and no request is issued
      // that could only earn a 403.
      save: () => {
        if (stateRef.current.docGrants.edit) void saveDoc();
      },
      saveAs: () => {
        if (stateRef.current.docGrants.edit) void saveDocAs();
      },
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
      // Issue #22: folder views only exist in workspace mode — the menu item
      // is grayed there; the hotkey lands here and must stay inert too.
      toggleFolders: () => {
        const st = stateRef.current;
        if (!st.platform?.readDirEntries) return;
        if (curWorkspaceRef.current.kind === 'none') return;
        // PRD 003 Reqs 9/12: chevrons, View menu and the hotkey all dispatch
        // this command — the explicit toggle is what slides the pane.
        armFolderSlide.current = true;
        updateSettings({ ...st.settings, showFolders: !st.settings.showFolders });
      },
      openFolder: openFolderCmd,
      // Issue #22: Close File — down to the splash through the dirty guard.
      closeFile: () => {
        const s = stateRef.current;
        if (!s.platform) return;
        if (s.docPath) {
          closeOpenFile(s.docPath); // dirty ⇒ three-way prompt; clean ⇒ close
          return;
        }
        if (!s.untitled) return; // splash — nothing to close
        if (s.dirty) setOpenPrompt({ kind: 'close-untitled' });
        else closeToSplash();
      },
      // PRD 002 §D14 + PRD 007 Req 21/22: the workspace flows (silent no-ops
      // without the seam). A platform that MANAGES workspaces (the hosted
      // lifecycle capability) drives its own dialogs; everything else takes
      // the PRD 002 file-based route. Capability, never flavor.
      newWorkspace: () => {
        if (stateRef.current.platform?.workspaces) setManagedWsDialog('new');
        else newWorkspaceCmd();
      },
      openWorkspace: () => {
        if (stateRef.current.platform?.workspaces) setManagedWsDialog('open');
        else openWorkspaceCmd();
      },
      addFolderToWorkspace: () => void addFolderToWorkspaceCmd(),
      saveWorkspaceAs: () => void saveWorkspaceAsCmd(),
      closeWorkspace: closeWorkspaceCmd,
      // SPEC29 §3.4 + §D15: Clear Menu wipes both sections — no-op when empty.
      clearRecent: () => {
        commitRecent(clearRecent());
        commitRecentWs(clearRecent());
      },
      toggleWordCount: () => {
        const s = stateRef.current.settings;
        updateSettings({ ...s, showWordCount: !s.showWordCount });
      },
      // Issue #10: same shape as Word Count — the persisted key is the state,
      // and the editor's lineNumbers Compartment reconfigures off it live.
      toggleLineNumbers: () => {
        const s = stateRef.current.settings;
        updateSettings({ ...s, lineNumbers: !s.lineNumbers });
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
      // SPEC43 §5.2: format commands forward to the mounted editor (the ref
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
      // SPEC36 §5.2/§6.3: the tabs commands (silent no-ops without the seam).
      toggleOpenOnly,
      nextFile: () => cycleFile(1),
      prevFile: () => cycleFile(-1),
      // SPEC12 §1.5 + SPEC13 §1.3: ⌘W with an aux window focused closes that
      // window (the native accelerator always lands here, in main's JS);
      // otherwise Quit/Exit/Close walk EVERY dirty document (SPEC36 §7).
      close: () => {
        void (async () => {
          const p = stateRef.current.platform;
          if (p?.closeFocusedAuxWindow && (await p.closeFocusedAuxWindow())) return;
          // Issue #22: one entry point — the changed-workspace prompt, then
          // the dirty-docs walk (the same path the native close guard takes).
          startQuitWalkRef.current();
        })();
      },
    });
  }, [newFile, openViaDialog, saveDoc, saveDocAs, toggleMode, openHelp, stepZoom, updateSettings, navigateComment, insertImage, commitRecent, commitRecentWs, openFind, openFolderCmd, openWorkspaceCmd, newWorkspaceCmd, addFolderToWorkspaceCmd, saveWorkspaceAsCmd, closeWorkspaceCmd, closeOpenFile, closeToSplash, fmtCommand, toggleOpenOnly, cycleFile, dirtyDocsQueue, processQuitWalk]);

  // SPEC29 §3.4: an Open Recent pick — guarded open if it still exists,
  // otherwise a notice and the entry drops off the list.
  useEffect(() => {
    registerRecentHandler((path, kind) => {
      void (async () => {
        const p = stateRef.current.platform;
        if (!p) return;
        if (kind === 'workspace') {
          // PRD 002 §D15: a recent workspace pick opens that workspace.
          // Issue #22: replacing a changed untitled workspace prompts first.
          if (await p.exists(path)) guardWorkspaceDiscard(() => void openWorkspaceFromPath(p, path));
          else {
            showNotice(`“${p.basename(path)}” is no longer there`);
            commitRecentWs(removeRecent(recentWsRef.current, path));
          }
          return;
        }
        if (await p.exists(path)) {
          openDocGuarded(p, path);
        } else {
          showNotice(`“${p.basename(path)}” is no longer there`);
          commitRecent(removeRecent(recentRef.current, path));
        }
      })();
    });
  }, [openDocGuarded, showNotice, commitRecent, commitRecentWs, openWorkspaceFromPath, guardWorkspaceDiscard]);

  /**
   * PRD 007 Req 21/22: the entry surface — the ordered actions this flavor can
   * honour, derived from platform capabilities alone (lib/startActions.ts).
   * The start page renders it and the File menu mirrors it, so the two can
   * never diverge: desktop/shim get all four, hosted gets everything but Open
   * Folder…, the single-file web build gets Open File alone.
   */
  const entryActions = useMemo(() => (platform ? startActions(startCapabilities(platform)) : []), [platform]);
  /**
   * Each row dispatches the command the File menu's twin item dispatches —
   * the ids coincide but for `openFile`, whose long-standing command id is
   * `open` (the menu's own "Open…").
   */
  const runEntryAction = useCallback((id: StartActionId) => {
    dispatchCommand(id === 'openFile' ? 'open' : id, 'ui');
  }, []);

  // Issue #22: the derived three-mode model — splash | file | workspace.
  const docOpen = docPath !== null || untitled;
  const appMode = deriveAppMode(docOpen, wsKind);

  // --- native menu install (SPEC12 §3.3): rebuilt whenever menu state changes ----
  useEffect(() => {
    if (!platform?.setAppMenu || menuInstallFailed) return;
    platform.setAppMenu(
      buildMenuSpec({
        isMac: platform.isMac,
        mode,
        appMode,
        docOpen,
        splitEdit: settings.splitEdit,
        showComments,
        commentsEnabled: settings.commentsEnabled,
        commentCount: comments.length,
        hotkeys: settings.hotkeys,
        showDiff,
        showWordCount: settings.showWordCount,
        showFrontmatter,
        // Issue #10: the View checkbox mirrors the persisted gutter setting.
        lineNumbers: settings.lineNumbers,
        showFolders: settings.showFolders,
        // PRD 007 Req 17+19: File-menu transfer rows exist only where the
        // seam does and only for a user holding the verb.
        canUpload: !!platform?.uploadFile && folderGrants.upload,
        canDownload: !!platform?.downloadFile && folderGrants.download,
        // PRD 007 Req 17: Edit Mode / Save / Save As… gray out for a member
        // who may not change the open document — the hotkeys they mirror are
        // gated in the command handlers, so both routes are equally inert.
        canEdit: docGrants.edit,
        // PRD 007 Req 22: the File menu carries exactly the start page's list.
        entryActions,
        openOnly: folderOpenOnly,
        // Issue #84: gates View → Next/Previous Open File.
        openFileCount: openFiles.length,
        recentFiles: recentMenuEntries(recent, platform.basename, platform.dirname),
        // PRD 002 §D15: the workspaces section, same disambiguated labels.
        recentWorkspaces: recentMenuEntries(recentWs, platform.basename, platform.dirname),
      })
      // Issue #38: a failed install must not strand the window with neither
      // a menu nor the toolbar — fall back to in-app chrome for the session.
    ).catch(() => setMenuInstallFailed(true));
  }, [platform, mode, appMode, docPath, untitled, showComments, settings.commentsEnabled, comments.length, settings.hotkeys, showDiff, settings.showWordCount, settings.splitEdit, fmOverride, settings.showFrontmatter, settings.lineNumbers, recent, recentWs, settings.showFolders, folderOpenOnly, openFiles.length, entryActions, menuInstallFailed, docGrants.edit]);

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
          buildAuxInit({
            settings: s.settings,
            ...currentLayerView(),
            themes: s.themes,
            isMac: platform.isMac,
            version: __APP_VERSION__,
          })
        );
      });
      const edit = await platform.busListen!(EV_SETTINGS_EDIT, (payload) => {
        // §3.5/§E18: aux edits arrive as {scope, patch} — sanitized (known,
        // panel-editable, scope-eligible keys only), then layer-targeted.
        const e = sanitizeSettingsEdit(payload);
        if (e) applySettingsEdit(e.scope, e.patch);
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
  }, [platform, applySettingsEdit, currentLayerView, reloadThemes]);

  // §3.5 canonical echo: every settings/layer change broadcasts, whatever its source.
  useEffect(() => {
    if (platform?.busEmit) {
      const b: SettingsBroadcast = { settings, ...layerView };
      void platform.busEmit(EV_SETTINGS_CHANGED, b);
    }
  }, [platform, settings, layerView]);
  useEffect(() => {
    if (platform?.busEmit) void platform.busEmit(EV_THEMES_CHANGED, themes);
  }, [platform, themes]);

  // --- SPEC16 §2: changes-since-save sets, recomputed on a debounce ------------
  useEffect(() => {
    if (!showDiff || mode !== 'edit') {
      setDiff(null);
      return;
    }
    const t = setTimeout(() => setDiff(diffLineSets(savedText, canonicalOf(buffer))), 200);
    return () => clearTimeout(t);
  }, [showDiff, mode, buffer, savedText, canonicalOf]);

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
      // SPEC38 §3.5: drafts shadow-save the canonical text, never the grid.
      const draft: Draft = { version: 1, docPath: s.docPath, content: canonicalOf(s.buffer), at: new Date().toISOString() };
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
      } else if (eventMatches(e, hk.toggleOpenOnly)) {
        e.preventDefault();
        dispatchCommand('toggleOpenOnly', 'hotkey');
      } else if (eventMatches(e, hk.nextFile)) {
        // SPEC36 §6.3: always consumed — the editor must never see the Tab.
        e.preventDefault();
        dispatchCommand('nextFile', 'hotkey');
      } else if (eventMatches(e, hk.prevFile)) {
        e.preventDefault();
        dispatchCommand('prevFile', 'hotkey');
      } else {
        // SPEC43 §5.2: the Smart Edit bindings, one command each.
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
    const epoch = docEpochRef.current; // issue #43: tied to the doc it renders
    const render = () =>
      // SPEC38 §3.5: the preview renders the canonical text — a real table,
      // never the display grid.
      void renderMarkdown(canonicalOf(buffer)).then((rendered) => {
        // Issue #43: `cancelled` flips at effect cleanup, which runs after
        // paint — a render resolving between the close-to-splash commit and
        // that cleanup passes it. The epoch check drops it regardless.
        if (cancelled || epoch !== docEpochRef.current) return;
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

  // Shared by both preview surfaces (#19): read the injected DOM's text,
  // re-anchor every comment against it, and paint the highlight marks. If an
  // anchor drifted, persist the refresh instead and return false — the
  // setComments write reruns the calling effect, which highlights then.
  const reanchorAndHighlight = useCallback(
    (el: HTMLElement): boolean => {
      const text = getDocText(el);
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
        setComments(updated);
        return false;
      }
      if (showComments && settings.commentsEnabled) {
        for (const c of comments) {
          if (c.resolved && !settings.showResolved) continue;
          const m = pos[c.id];
          if (m) {
            const marks = highlightRange(el, m.start, m.end, c.id);
            // Ghosted resolved highlights (SPEC6 §3): faint tint, still clickable.
            if (c.resolved) marks.forEach((mk) => mk.classList.add('ghost'));
          }
        }
      }
      return true;
    },
    [comments, showComments, settings.showResolved, settings.commentsEnabled]
  );

  // --- inject rendered doc, re-anchor, highlight ----------------------------------
  useLayoutEffect(() => {
    if (mode !== 'preview') return;
    const doc = docRef.current;
    if (!doc) return;
    injectionCompleteRef.current = false;
    // Issue #43: at the splash (`!docPath && !untitled`) the container stays
    // empty no matter what `html` still holds — whatever ordering let a stale
    // render through, it must not paint the closed document under the logo.
    const atSplash = !stateRef.current.docPath && !stateRef.current.untitled;
    doc.innerHTML = atSplash ? '' : html;
    if (atSplash || !html) {
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

    if (!reanchorAndHighlight(doc)) return;
    injectionCompleteRef.current = true; // SPEC25 §2: this DOM is final for now
    // SPEC44 §3.2: re-derive the placement cues the re-injection wiped.
    const cue = activeCueRef.current;
    if (cue) applyActiveCues(doc, cue.head, cue.headLine, cue.hasSel);
  }, [html, mode, reanchorAndHighlight, applyActiveCues]);

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
    // Issue #38: from here on the carry is consumed — a bail-out below must
    // also disarm the edit-affordance composer so it can't fire on a later,
    // unrelated selection.
    const abandonCompose = () => {
      composeOnCarryRef.current = false;
    };
    const buffer = stateRef.current.buffer;
    const needle = visibleTextForRange(buffer, pending.from, pending.to);
    if (!needle.replace(/\s+/g, ' ').trim()) return abandonCompose();
    const fromLine = buffer.slice(0, pending.from).split('\n').length;
    const toLine = buffer.slice(0, pending.to).split('\n').length;
    const stamped = Array.from(doc.querySelectorAll<HTMLElement>('[data-mm-line]'));
    if (stamped.length === 0) return abandonCompose();
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
    else return abandonCompose();
    const { start: rs, end: re } = rangeToOffsets(doc, region);
    const hit = findNormalized(getDocText(doc).slice(rs, re), needle);
    const range = offsetsToRange(doc, hit ? rs + hit.start : rs, hit ? rs + hit.end : re);
    if (!range) return abandonCompose();
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

  // --- split-edit live preview pane (SPEC7 §5, issue #19): live reading pane
  // that is also a comments surface — same re-anchor + highlight pass as the
  // preview injection above, so highlights survive the per-keystroke rebuild.
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

    if (!reanchorAndHighlight(el)) return;
    // SPEC44 §3.2: a re-render wiped the synthetic cues — re-derive them.
    const cue = activeCueRef.current;
    if (cue) applyActiveCues(el, cue.head, cue.headLine, cue.hasSel);
  }, [html, mode, settings.splitEdit, reanchorAndHighlight, applyActiveCues]);

  // --- SPEC15: synchronized split scrolling ------------------------------------
  // Whichever pane the user scrolls leads; the other follows within a frame.
  // Programmatic follower writes are counted in `suppress` so they never
  // re-lead (no feedback loop). Ends clamp mutually reachable (§1.3).
  useEffect(() => {
    if (mode !== 'edit' || !settings.splitEdit) return;
    const docEl = splitDocRef.current;
    const scroller = splitPreviewRef.current; // .split-preview (the doc sits in a .docwrap since #19)
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

    // SPEC45: while the SPEC44 cue is near the leader's viewport, the panes
    // align on IT — the selected word keeps the same vertical position on
    // both sides (clamped; far from the cue the line interpolation returns).
    const cueEl = () =>
      docEl.querySelector<HTMLElement>('mark.mm-active-word') ??
      docEl.querySelector<HTMLElement>('.mm-active-block');
    const cueContentTop = (el: HTMLElement) =>
      el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

    const editorLeads = () => {
      const ed = editorSyncRef.current;
      if (!ed) return;
      const { top, max } = ed.scrollInfo();
      const previewMax = scroller.scrollHeight - scroller.clientHeight;
      let target: number;
      const mark = cueEl();
      const vpY = mark ? ed.headTop() - top : 0; // caret's viewport offset
      if (top <= AT_END) target = 0;
      else if (top >= max - AT_END) target = previewMax;
      else if (mark && vpY > -scroller.clientHeight && vpY < scroller.clientHeight * 2) {
        target = Math.max(0, Math.min(cueContentTop(mark) - vpY, previewMax));
      } else target = Math.min(offsetForLine(anchors, contentHeight, ed.topLine()), previewMax);
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
      const mark = cueEl();
      const markVpY = mark ? cueContentTop(mark) - y : 0;
      if (y <= AT_END) ed.setScrollTop(0);
      else if (y >= previewMax - AT_END) ed.setScrollTop(max);
      else if (mark && markVpY > -scroller.clientHeight && markVpY < scroller.clientHeight * 2) {
        ed.setScrollTop(Math.max(0, Math.min(ed.headTop() - markVpY, max)));
      } else ed.scrollToLine(lineAtOffset(anchors, contentHeight, y));
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
    const doc = docRef.current ?? splitDocRef.current; // split-edit hosts marks too (#19)
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
    const doc = docRef.current ?? splitDocRef.current; // split-edit hosts marks too (#19)
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
    const t = setTimeout(() => {
      commentFlushRef.current = null;
      void persistComments(comments);
    }, 800);
    // Issue #64: parkActive flushes this early — the parked comment set and
    // the disk must agree before openDoc's freshness compare.
    commentFlushRef.current = () => {
      clearTimeout(t);
      commentFlushRef.current = null;
      void persistComments(comments);
    };
    return () => {
      clearTimeout(t);
      commentFlushRef.current = null;
    };
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
  // Preview mode and the split-edit preview pane both host selections (#19).
  useEffect(() => {
    const inSplit = mode === 'edit' && settings.splitEdit;
    if (mode !== 'preview' && !inSplit) return;
    const onSelection = () => {
      const sel = document.getSelection();
      const doc = inSplit ? splitDocRef.current : docRef.current;
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
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      // A surface swap (mode/split toggle) orphans the old selection's button.
      setSelInfo((prev) => (prev === null ? prev : null));
    };
  }, [mode, settings.splitEdit]);

  // --- comment operations -----------------------------------------------------------
  const startComposer = (seed = '') => {
    if (!selInfo || !mayComment) return; // PRD 004 Req 15 + PRD 007 Req 17
    setPending({ start: selInfo.start, end: selInfo.end });
    setDraft(seed);
    setActiveId(null);
    window.getSelection()?.removeAllRanges();
    setSelInfo(null);
  };

  // Issue #38: a stale edit selection must not survive the surface (or the
  // document) it came from — any swap retires the affordance; the editor's
  // next selection report re-establishes it if a selection is still there.
  useEffect(() => {
    setEditHasSelection(false);
  }, [mode, settings.splitEdit, docPath, untitled]);

  // Issue #38: the edit-mode affordance parks the selection in the SPEC25
  // carry and switches to preview; once the carry lands there as a native
  // selection (→ selInfo, with preview's own rendered-DOM offsets), the
  // composer opens for exactly the anchor preview would have produced.
  useEffect(() => {
    if (mode !== 'preview') {
      composeOnCarryRef.current = false;
      return;
    }
    if (!composeOnCarryRef.current || !selInfo) return;
    composeOnCarryRef.current = false;
    startComposer();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startComposer is recreated per render
  }, [mode, selInfo]);

  // --- type-to-comment (SPEC7 §3): a printable key over a selection opens the composer
  useEffect(() => {
    if (mode !== 'preview' || !selInfo || pending || !showComments) return;
    if (!settings.commentsEnabled || !settings.typeToComment) return;
    // PRD 004 Req 15: no composer for a frozen doc; PRD 007 Req 17: none
    // without comment.write either.
    if (!mayComment) return;
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
  }, [selInfo, pending, mode, showComments, settings.commentsEnabled, settings.typeToComment, mayComment]);

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
    const doc = docRef.current ?? splitDocRef.current; // split-edit hosts marks too (#19)
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

  // Comments live on whichever preview surface is up: full preview or the
  // split-edit live preview (#19).
  const commentSurfaceUp = mode === 'preview' || (mode === 'edit' && settings.splitEdit);

  // Issue #38: which surface may offer "Add comment" for the live selection —
  // the preview surfaces keep the floating button; plain edit mode gets an
  // affordance that routes through the SPEC25 carry instead of dead-ending.
  const affordanceSurface = commentAffordanceSurface({
    mode,
    splitEdit: settings.splitEdit,
    hasSelection: commentSurfaceUp ? selInfo !== null : editHasSelection,
    showComments,
    commentsEnabled: settings.commentsEnabled,
    composerOpen: pending !== null,
    authoringFrozen,
    // PRD 007 Req 17: a role without comment.write is offered no route to a
    // comment on either surface.
    canWrite: docGrants.commentWrite,
  });

  const panelVisible =
    commentSurfaceUp && showComments && settings.commentsEnabled && (comments.length > 0 || pending !== null);

  // Navigator pill label, frozen across the fade-out (SPEC14 §3.5).
  const navIdx = activeId ? open.findIndex((c) => c.id === activeId) : -1;
  if (navIdx >= 0) navLabelRef.current = `${navIdx + 1} / ${open.length}`;

  // One panel, two hosts (#19): the preview margin and the split preview pane.
  // Only one renders at a time, so the shared panelRef stays unambiguous.
  const panelAside = panelVisible ? (
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
            readOnly={!mayComment}
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
              readOnly={!mayComment}
              onActivate={(id) => setActiveId(id)}
              onUpdate={updateComment}
              onDelete={deleteComment}
            />
          ))}
        </details>
      )}
    </aside>
  ) : null;

  // Issue #22 / PRD 003 Req 5: the folder seam — pane or its edge chevron —
  // exists only in workspace mode on platforms with the folder capabilities.
  const folderSeam = !!platform?.readDirEntries && !!platform?.openFolderDialog && appMode === 'workspace';

  // PRD 003 Reqs 9–12: every toggle surface funnels into these two settings,
  // so phasing the render on them animates chevron, menu, hotkey and Settings
  // toggles alike. Above the platform guard — hooks must run every render.
  // Keyed on the settings alone: entering workspace mode (openFolder) or edit
  // mode must swap panes in instantly, as before — only toggles slide.
  const folderSlide = usePaneSlide(settings.showFolders, armFolderSlide);
  const splitSlide = usePaneSlide(settings.splitEdit, armSplitSlide);
  const { sliding: previewSliding, out: previewOut } = slideClasses(splitSlide);

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
              // PRD 007 Req 17: no Edit / Save rows for a read-only role.
              canEdit={docGrants.edit}
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
        {/* Issue #22: the folder sidebar is a workspace-mode surface only.
            PRD 003 Req 9: it stays mounted through the exit slide. */}
        {folderSeam && slideMounted(folderSlide, settings.showFolders) && (
          <FolderPanel
            slide={folderSlide}
            roots={folderRoots}
            children={folderChildren}
            expanded={folderExpanded}
            selectedPath={docPath}
            showNonMd={folderShowNonMd}
            openFiles={openFiles}
            openOnly={folderOpenOnly}
            dirtyFiles={dirtyOpenFiles}
            isMac={platform.isMac}
            width={settings.folderWidth}
            join={platform.join}
            basename={platform.basename}
            onToggleDir={toggleFolderDir}
            onToggleNonMd={toggleFolderNonMd}
            onOpenFile={(path) => openDocGuarded(platform, path)}
            onModOpenFile={modOpenFile}
            onCloseFile={closeOpenFile}
            onToggleOpenOnly={() => dispatchCommand('toggleOpenOnly')}
            onOpenFolder={() => dispatchCommand('openFolder')}
            // PRD 007 Req 22: with a workspace open and no roots yet (the
            // state local New Workspace… creates), the empty panel's button
            // GROWS the workspace instead of replacing it.
            onAddFolder={wsKind !== 'none' ? () => dispatchCommand('addFolderToWorkspace') : undefined}
            onSync={() => {
              // SPEC36 §5.4: from the only-open view, sync returns to the tree.
              if (folderOpenOnly) toggleOpenOnly();
              if (stateRef.current.docPath) void revealInFolders(platform, stateRef.current.docPath);
            }}
            onClose={() => dispatchCommand('toggleFolders')}
            onWidth={(w) => updateSettings({ ...stateRef.current.settings, folderWidth: w })}
            caps={{
              // SPEC35 §2.5 + PRD 007 Req 17: the seam must exist AND this
              // user must hold the verb — a Viewer sees no New File, no
              // Rename, no Delete and no drop target at all.
              canReveal: !!platform.revealPath,
              canTrash: !!platform.trashEntry && folderGrants.delete,
              canRename: !!platform.renameEntry && folderGrants.rename,
              canCopy: !!platform.copyText,
              canCreate: folderGrants.create,
              canCreateFolder: folderGrants.folderManage,
              canUpload: !!platform.uploadFile && folderGrants.upload,
              canDownload: !!platform.downloadFile && folderGrants.download,
            }}
            onMoveEntry={
              platform.renameEntry ? (source, dest) => void folderMoveEntry(source, dest) : undefined
            }
            onUploadDrop={
              platform.uploadFile
                ? (dir, files) => {
                    // PRD 007 Req 19 (non-goals: no bulk transfer) — one file.
                    if (files[0]) void folderUpload(dir, files[0]);
                  }
                : undefined
            }
            notice={folderNotice}
            onDismissNotice={() => setFolderNotice(null)}
            onMenuAction={folderMenuAction}
            renamingPath={folderRenaming?.path ?? null}
            renameError={folderRenameError}
            onRenameCommit={(oldPath, newName) => void folderRenameCommit(oldPath, newName)}
            onRenameCancel={folderRenameCancel}
          />
        )}

        {/* PRD 007 Req 19: the Upload File… picker. One hidden input serves
            the File menu and the folder context menu alike; it exists only
            where the platform offers the upload seam and the user holds the
            verb, so no other flavor grows a file input. */}
        {platform.uploadFile && folderGrants.upload && (
          <input
            ref={uploadInputRef}
            type="file"
            data-testid="upload-input"
            className="upload-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const dir = uploadDir ?? folderRoots[0];
              e.target.value = ''; // picking the same file twice must re-fire
              setUploadDir(null);
              if (file && dir) void folderUpload(dir, file);
            }}
          />
        )}

        {/* PRD 003 Req 2: with the pane closed, a chevron at the workspace's
            left edge reopens it. */}
        {folderSeam && !settings.showFolders && (
          <FolderExpandButton onClick={() => dispatchCommand('toggleFolders')} />
        )}

        {/* PRD 003 Reqs 6–7: the preview's edge chevron at the workspace's
            right edge — collapses the open split, reopens the closed one.
            Never in full preview: that's a different surface, not a closed
            split (and the splash is preview-only, so it never shows one). */}
        {mode === 'edit' && (
          <PreviewToggleButton open={settings.splitEdit} onClick={() => dispatchCommand('toggleSplit')} />
        )}

      {mode === 'preview' ? (
        <div className="workspace" ref={workspaceRef}>
          <div className="docwrap">
            {frontMatter && showFrontmatter && (
              <FrontMatterCard entries={frontMatter.entries} onClose={() => setFmOverride(false)} />
            )}
            {!docPath && !untitled && appMode === 'workspace' && (
              <div className="empty-center">
                {/* Issue #39: with a workspace open, the empty preview invites
                    a pick from the folder view — the splash is reserved for
                    the true initial state (no workspace, no document). */}
                <p className="workspace-empty-hint" data-testid="workspace-empty-hint">
                  Select a file in the folder view to open it
                </p>
              </div>
            )}
            {!docPath && !untitled && appMode !== 'workspace' && (
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
                  {/* PRD 007 Req 21/22: the entry actions — one list, shared
                      with the File menu, each row present only where this
                      flavor can honour it (lib/startActions.ts). */}
                  <StartPage actions={entryActions} onAction={runEntryAction} />
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
                placeFromPreviewClick(docRef.current, e); // SPEC44 §4.2
              }}
            />
          </div>
          {panelAside}
        </div>
      ) : slideMounted(splitSlide, settings.splitEdit) ? (
        <div
          className={`workspace split${previewSliding ? ' preview-sliding' : ''}${previewOut ? ' preview-out' : ''}`}
          ref={workspaceRef}
          style={{ '--mm-split': `${settings.splitRatio * 100}%` } as React.CSSProperties}
        >
          <div className="split-editor">
            <Suspense fallback={<div className="editor-wrap" data-testid="editor-loading" />}>
              <Editor
                value={buffer}
                // PRD 007 Req 17: a role without doc.edit types nothing.
                readOnly={docReadOnly}
                lineNumbers={settings.lineNumbers}
                onChange={editorChanged}
                historyRef={editorHistoryRef}
                syncRef={editorSyncRef}
                diff={diff}
                onPasteImages={pasteImages}
                insertRef={editorInsertRef}
                syntax={settings.editorSyntax}
                livePreview={settings.livePreview}
                onOpenExternal={(u) => void platform?.openExternal(u)}
                vimNav={settings.vimNav}
                onVimModeChange={seamVimMode}
                onEditState={handleEditState}
                selectRangeRef={editorSelectRef}
                activeWordSuppressed={findOpen}
                pendingSelectionRef={pendingEditorSelRef}
                searchRef={editorSearchRef}
                hotkeys={settings.hotkeys}
                isMac={platform?.isMac ?? true}
                canPaste={!!platform?.readClipboardText}
                onCopyText={copyToClipboard}
                onReadClipboard={readFromClipboard}
                smartRef={smartEditRef}
                tableGridView={settings.tableGridView}
                onToggleTableGrid={toggleTableGrid}
                inlineImages={settings.inlineImages}
                resolveImageSrc={resolveEditorImage}
                onToggleInlineImages={toggleInlineImages}
                onInsertImage={() => void insertImage()}
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
            <div className="docwrap">
              {frontMatter && showFrontmatter && (
                <FrontMatterCard entries={frontMatter.entries} onClose={() => setFmOverride(false)} />
              )}
              <div
                className="doc"
                ref={splitDocRef}
                onClick={(e) => {
                  // Highlights activate their card here too (#19).
                  const mark = (e.target as HTMLElement).closest?.('mark.hl') as HTMLElement | null;
                  if (mark?.dataset.cid && showComments) handleMarkClick(mark.dataset.cid);
                  else if (!mark) setActiveId(null); // click-away deactivates (SPEC14 §3.1)
                  placeFromPreviewClick(splitDocRef.current, e);
                }}
              />
            </div>
            {panelAside}
          </div>
        </div>
      ) : (
        <div className="workspace" ref={workspaceRef} style={{ overflowY: 'hidden', overflowX: 'auto' }}>
          <Suspense fallback={<div className="editor-wrap" data-testid="editor-loading" />}>
            <Editor
              value={buffer}
              // PRD 007 Req 17: a role without doc.edit types nothing.
              readOnly={docReadOnly}
              lineNumbers={settings.lineNumbers}
              onChange={editorChanged}
              historyRef={editorHistoryRef}
              syncRef={editorSyncRef}
              diff={diff}
              onPasteImages={pasteImages}
              insertRef={editorInsertRef}
              syntax={settings.editorSyntax}
              livePreview={settings.livePreview}
              onOpenExternal={(u) => void platform?.openExternal(u)}
              vimNav={settings.vimNav}
              onVimModeChange={seamVimMode}
              onEditState={handleEditState}
              selectRangeRef={editorSelectRef}
                activeWordSuppressed={findOpen}
              pendingSelectionRef={pendingEditorSelRef}
              searchRef={editorSearchRef}
              hotkeys={settings.hotkeys}
              isMac={platform?.isMac ?? true}
              canPaste={!!platform?.readClipboardText}
              onCopyText={copyToClipboard}
              onReadClipboard={readFromClipboard}
              smartRef={smartEditRef}
              tableGridView={settings.tableGridView}
              onToggleTableGrid={toggleTableGrid}
              inlineImages={settings.inlineImages}
              resolveImageSrc={resolveEditorImage}
              onToggleInlineImages={toggleInlineImages}
              onInsertImage={() => void insertImage()}
            />
          </Suspense>
        </div>
      )}

      </div>

      {selInfo && affordanceSurface === 'preview' && (
        <button
          className="add-comment-btn"
          data-testid="add-comment-btn"
          // The toolbar shell (z-index 80) covers the top 42px of the window,
          // so a selection near the pane's top edge used to clamp this button
          // (z-index 60) underneath it, where `.docname` swallowed the click
          // and the button could not be pressed at all (issue #18). Where that
          // shell exists, floor the button below it: 42px band + the 8px gap.
          style={{ left: selInfo.x, top: Math.max(nativeMenu ? 8 : 50, selInfo.y - 42) }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => startComposer()}
        >
          💬 Add comment
        </button>
      )}

      {/* Issue #38: plain edit mode's route to a comment. The editor has no
          rendered DOM to anchor from, so the click does NOT invent a source-
          offset anchor — it parks the selection in the SPEC25 carry, switches
          to preview, and the compose-on-carry effect opens the composer on
          the selection preview re-establishes. Fixed top-right (CM reports
          carry no pixel rect), floored below the toolbar band like the
          preview button (issue #18). */}
      {affordanceSurface === 'edit' && (
        <button
          className="add-comment-btn add-comment-btn-edit"
          data-testid="add-comment-btn-edit"
          style={{ top: nativeMenu ? 8 : 50 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            composeOnCarryRef.current = true;
            toggleMode();
          }}
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

      {/* PRD 004 Req 16: a PERSISTENT indication — no timer, no dismissal —
          for as long as a document with an unreadable comment store is open.
          Deliberately not the .mm-notice toast, which self-clears after 4s.
          Hidden with the rest of the comments UI when the master switch is
          off (SPEC7 §2); byte preservation applies in that state regardless. */}
      {authoringFrozen && settings.commentsEnabled && (
        <div className="mm-store-notice" data-testid="store-unreadable" role="status">
          {unreadableStoreMessage(stores)}
        </div>
      )}

      {/* PRD 007 Req 17: the permission case gets its own persistent line —
          a role without doc.edit is a different situation from PRD 004's
          frozen store above, and saying so is what stops the user hunting
          for the Edit button that is no longer there. Shown only for a real
          open document (an untitled buffer belongs to no scope yet). */}
      {!docGrants.edit && !!docPath && (
        <div className="mm-store-notice" data-testid="read-only-doc" role="status">
          Read-only: your role in this workspace does not include doc.edit.
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
              // Cancel any in-flight mode-switch scroll restore — its retry
              // loop would otherwise yank the viewport back to the carried
              // line and swallow this jump on slow machines.
              pendingScrollLineRef.current = null;
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
          layers={layerView.layers}
          workspaceOpen={layerView.workspaceOpen}
          scopeSelector={platform.kind !== 'web'}
          themes={themes}
          isMac={platform.isMac}
          storageLocked={platform.kind === 'web'}
          autoHideAvailable={!nativeMenu}
          onEdit={applySettingsEdit}
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
          workspaceActions={
            // PRD 007 Req 12 (+15/16): a capability check, not a flavor check
            // — only a platform offering the workspace lifecycle has a
            // workspace to administer or delete server-side. Each section
            // gates itself on the one permission it needs.
            platform.workspaces ? (
              <>
                <WorkspaceAccessSettings lifecycle={platform.workspaces} />
                <WorkspaceDangerZone lifecycle={platform.workspaces} />
              </>
            ) : undefined
          }
        />
      )}

      {/* PRD 007 Req 10/11: the workspace switcher and its New/Open flows,
          mounted on the same capability. */}
      {platform.workspaces && <WorkspaceSwitcher lifecycle={platform.workspaces} />}
      {/* PRD 007 Req 21/22: the same two flows, reached from the start page or
          the File menu instead of the switcher chip. */}
      {platform.workspaces && managedWsDialog === 'new' && (
        <NewWorkspaceDialog lifecycle={platform.workspaces} onClose={() => setManagedWsDialog('none')} />
      )}
      {platform.workspaces && managedWsDialog === 'open' && (
        <OpenWorkspaceDialog lifecycle={platform.workspaces} onClose={() => setManagedWsDialog('none')} />
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
              before{' '}
              {openPrompt.kind === 'open'
                ? `opening “${platform.basename(openPrompt.path)}”`
                : openPrompt.kind === 'close-file' || openPrompt.kind === 'close-untitled'
                  ? 'closing it'
                  : 'starting a new file'}
              ?
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
                  if (intent.kind === 'open') void parkAndOpen(platform, intent.path);
                  else if (intent.kind === 'close-file') finishCloseFile(platform, intent.path);
                  else if (intent.kind === 'close-untitled') closeToSplash(); // issue #22
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
                  if (intent.kind === 'open') void parkAndOpen(platform, intent.path);
                  else if (intent.kind === 'close-file') finishCloseFile(platform, intent.path);
                  else if (intent.kind === 'close-untitled') {
                    // Issue #22: the untitled buffer just became a real file
                    // (Save As ran inside saveDoc) — now close it for real.
                    const saved = stateRef.current.docPath;
                    if (saved) finishCloseFile(platform, saved);
                    else closeToSplash();
                  } else startUntitled();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRD 007 Req 20: the save was refused because the file changed on the
          server. Two real choices, and dismissing leaves the buffer dirty. */}
      {saveConflict && (
        <div className="overlay">
          <div
            className="modal"
            data-testid="save-conflict-prompt"
            onKeyDown={(e) => {
              if (e.key === 'Escape') void resolveSaveConflict('cancel');
            }}
          >
            <h2>File changed elsewhere</h2>
            <p style={{ fontSize: 13.5 }}>
              “{platform.basename(saveConflict.path)}” was changed by someone else since you opened it.
              Your save was not applied — their version is still stored.
            </p>
            <div className="actions">
              <button data-testid="save-conflict-cancel" onClick={() => void resolveSaveConflict('cancel')}>
                Cancel
              </button>
              <button data-testid="save-conflict-overwrite" onClick={() => void resolveSaveConflict('overwrite')}>
                Overwrite
              </button>
              <button
                className="primary"
                data-testid="save-conflict-reload"
                autoFocus
                onClick={() => void resolveSaveConflict('reload')}
              >
                Reload
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
            {/* PRD 007 non-goals: where deletes are permanent (no trash, no
                version history) the prompt says so instead of naming a Trash
                the user could go looking in. */}
            <h2>{platform.permanentDelete ? 'Delete' : 'Move to Trash'}</h2>
            <p style={{ fontSize: 13.5 }}>
              {platform.permanentDelete ? 'Permanently delete' : 'Move'} “
              {platform.basename(folderDeletePrompt.path)}”
              {folderDeletePrompt.isDir ? ' and its contents' : ''}
              {platform.permanentDelete ? '? This cannot be undone.' : ' to the Trash?'}
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

      {/* Issue #22: a changed untitled workspace is about to be discarded —
          Save runs Save Workspace As… (its dialog cancelling aborts), Cancel
          aborts the whole operation, Don't Save proceeds. */}
      {wsClosePrompt && (
        <div className="overlay">
          <div className="modal" data-testid="ws-close-prompt">
            <h2>Save workspace?</h2>
            <p style={{ fontSize: 13.5 }}>
              This workspace has unsaved changes (its folders or workspace settings). Save it as a workspace file
              before closing?
            </p>
            <div className="actions">
              <button
                data-testid="ws-close-cancel"
                onClick={() => {
                  wsCloseResumeRef.current = null;
                  setWsClosePrompt(false);
                }}
              >
                Cancel
              </button>
              <button
                data-testid="ws-close-discard"
                onClick={() => {
                  const go = wsCloseResumeRef.current;
                  wsCloseResumeRef.current = null;
                  setWsClosePrompt(false);
                  go?.();
                }}
              >
                Don’t save
              </button>
              <button
                className="primary"
                data-testid="ws-close-save"
                onClick={async () => {
                  const go = wsCloseResumeRef.current;
                  wsCloseResumeRef.current = null;
                  setWsClosePrompt(false);
                  // A cancelled Save Workspace As… dialog aborts the close.
                  if (!(await saveWorkspaceAsCmd())) return;
                  go?.();
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
              “{docPath ? platform.basename(docPath) : untitled ? 'Untitled' : 'This file'}” has unsaved changes. Save
              before closing?
            </p>
            <div className="actions">
              <button
                data-testid="close-cancel"
                onClick={() => {
                  // SPEC36 §7.1: Cancel aborts the ENTIRE quit walk — and any
                  // borrowed finish (issue #22: Close Workspace stays open).
                  quitQueueRef.current = null;
                  quitDoneRef.current = null;
                  setClosePrompt(false);
                }}
              >
                Cancel
              </button>
              <button
                data-testid="close-discard"
                onClick={() => {
                  setClosePrompt(false);
                  const q = quitQueueRef.current;
                  if (q) {
                    q.shift();
                    void processQuitWalk(); // next dirty doc, or the real close
                  } else {
                    // SPEC30 §3.2: an explicit discard removes the shadow draft
                    // before the window dies (the clean-transition path can't run).
                    void deleteDraft().then(() => platform.closeNow());
                  }
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
                  const q = quitQueueRef.current;
                  if (!ok) {
                    quitQueueRef.current = null; // aborted walk — everything stays
                    quitDoneRef.current = null; // issue #22: borrowed finish too
                    return;
                  }
                  if (q) {
                    q.shift();
                    void processQuitWalk();
                  } else {
                    void platform.closeNow();
                  }
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
