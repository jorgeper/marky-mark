import { DEFAULT_HOTKEYS, type HotkeyMap } from './hotkeys';
import { isValidImageFolder } from './imagePaste';

export type CommentStorage = 'sidecar' | 'embedded';
export type Margins = 'default' | 'super-narrow' | 'narrow' | 'medium' | 'wide';

export const ZOOM_LEVELS = [50, 75, 90, 100, 110, 125, 150, 175, 200] as const;
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 32;
/** Split-edit divider bounds (SPEC7 §5): the editor pane's fraction. */
export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;
/** SPEC34 §2.2: folder sidebar width bounds (px). */
export const FOLDER_WIDTH_MIN = 160;
export const FOLDER_WIDTH_MAX = 480;
/** Pane content floor bounds (px) — below the floor, panes scroll sideways. */
export const PANE_MIN_WIDTH_MIN = 120;
export const PANE_MIN_WIDTH_MAX = 960;

/** Margin presets → content-column max-width overrides (SPEC3 §2, SPEC4 §7). */
export const MARGIN_WIDTHS: Record<Exclude<Margins, 'default'>, string> = {
  'super-narrow': '76rem',
  narrow: '60rem',
  medium: '48rem',
  wide: '38rem',
};

/** Persisted app settings (settings.json in the app config dir, pretty-printed). */
export interface Settings {
  themeLight: string;
  themeDark: string;
  useDarkTheme: boolean;
  fontSize: 'auto' | number;
  zoom: number;
  margins: Margins;
  lineNumbers: boolean;
  vimNav: boolean;
  autoHideToolbar: boolean;
  /** SPEC16 §5 + follow-up: the word-count chip is a visible-by-default toggle. */
  showWordCount: boolean;
  showResolved: boolean;
  commentsEnabled: boolean;
  typeToComment: boolean;
  splitEdit: boolean;
  /** Editor pane fraction in split-edit mode, clamped to [0.2, 0.8]. */
  splitRatio: number;
  author: string;
  autosaveOnToggle: boolean;
  commentStorage: CommentStorage;
  /** SPEC17 §4: the Export dialog's sticky theme — 'current' or a theme id. */
  exportTheme: string;
  /** SPEC20 §1: folder (single path segment) pasted images land in, next to the doc. */
  imageFolder: string;
  /** SPEC20 §1: pasted-image name pattern; tokens {doc} {n} {date} {time}. */
  imageNamePattern: string;
  /** SPEC23 §3: markdown syntax highlighting in the editor (on by default). */
  editorSyntax: boolean;
  /** SPEC40 §1: show ALL tables as fitted grids in the editor (default on). */
  tableGridView: boolean;
  /** SPEC41 §1: render ALL images inline in the editor (default on). */
  inlineImages: boolean;
  /** SPEC26 §3: show the front-matter card by default when a doc has one. */
  showFrontmatter: boolean;
  /** SPEC30 §2: reopen the most recent document at launch. */
  reopenLastDoc: boolean;
  /** SPEC34 §2.2: the folder sidebar's visibility (persisted toggle). */
  showFolders: boolean;
  /** SPEC34 §3.6: sidebar width in px, clamped [160, 480]. */
  folderWidth: number;
  /** Minimum content width per pane (px); narrower panes scroll sideways. */
  paneMinWidth: number;
  hotkeys: HotkeyMap;
}

export const DEFAULT_SETTINGS: Settings = {
  themeLight: 'crisp',
  themeDark: 'one-dark',
  useDarkTheme: true,
  fontSize: 12,
  zoom: 100,
  margins: 'super-narrow',
  lineNumbers: true,
  vimNav: false,
  autoHideToolbar: false,
  showWordCount: true,
  showResolved: true,
  commentsEnabled: true,
  typeToComment: true,
  splitEdit: true,
  splitRatio: 0.5,
  author: 'Reviewer',
  autosaveOnToggle: false,
  commentStorage: 'sidecar',
  exportTheme: 'current',
  imageFolder: 'images',
  imageNamePattern: '{doc} {n}',
  editorSyntax: true,
  tableGridView: true,
  inlineImages: true,
  showFrontmatter: true,
  reopenLastDoc: true,
  showFolders: false,
  folderWidth: 240,
  paneMinWidth: 768,
  hotkeys: { ...DEFAULT_HOTKEYS },
};

/** Parse settings.json text; unknown/missing/malformed fields fall back to defaults. */
export function parseSettings(json: string): Settings {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_HOTKEYS } };
  }
  const o = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const hk = (typeof o.hotkeys === 'object' && o.hotkeys !== null ? o.hotkeys : {}) as Record<string, unknown>;
  const hotkeys: HotkeyMap = { ...DEFAULT_HOTKEYS };
  for (const k of Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>) {
    if (typeof hk[k] === 'string' && (hk[k] as string).trim()) hotkeys[k] = hk[k] as string;
  }
  // Migration: pre-v3 settings stored a single `theme` key.
  const legacyTheme = typeof o.theme === 'string' && o.theme ? o.theme : null;

  // Explicit "auto" is preserved; missing/invalid falls back to the default
  // (12px). Auto still means "the theme's own size".
  let fontSize: 'auto' | number = DEFAULT_SETTINGS.fontSize;
  if (o.fontSize === 'auto') {
    fontSize = 'auto';
  } else if (typeof o.fontSize === 'number' && o.fontSize >= FONT_SIZE_MIN && o.fontSize <= FONT_SIZE_MAX) {
    fontSize = Math.round(o.fontSize);
  }

  const zoom =
    typeof o.zoom === 'number' && (ZOOM_LEVELS as readonly number[]).includes(o.zoom)
      ? o.zoom
      : DEFAULT_SETTINGS.zoom;

  const margins: Margins =
    o.margins === 'default' || o.margins === 'super-narrow' || o.margins === 'narrow' || o.margins === 'medium' || o.margins === 'wide'
      ? o.margins
      : DEFAULT_SETTINGS.margins;

  return {
    themeLight:
      typeof o.themeLight === 'string' && o.themeLight
        ? o.themeLight
        : (legacyTheme ?? DEFAULT_SETTINGS.themeLight),
    themeDark: typeof o.themeDark === 'string' && o.themeDark ? o.themeDark : DEFAULT_SETTINGS.themeDark,
    useDarkTheme: typeof o.useDarkTheme === 'boolean' ? o.useDarkTheme : DEFAULT_SETTINGS.useDarkTheme,
    fontSize,
    zoom,
    margins,
    lineNumbers: typeof o.lineNumbers === 'boolean' ? o.lineNumbers : DEFAULT_SETTINGS.lineNumbers,
    vimNav: o.vimNav === true,
    autoHideToolbar: o.autoHideToolbar === true,
    showWordCount: typeof o.showWordCount === 'boolean' ? o.showWordCount : DEFAULT_SETTINGS.showWordCount,
    showResolved: typeof o.showResolved === 'boolean' ? o.showResolved : DEFAULT_SETTINGS.showResolved,
    commentsEnabled: typeof o.commentsEnabled === 'boolean' ? o.commentsEnabled : DEFAULT_SETTINGS.commentsEnabled,
    typeToComment: typeof o.typeToComment === 'boolean' ? o.typeToComment : DEFAULT_SETTINGS.typeToComment,
    splitEdit: typeof o.splitEdit === 'boolean' ? o.splitEdit : DEFAULT_SETTINGS.splitEdit,
    splitRatio:
      typeof o.splitRatio === 'number' && Number.isFinite(o.splitRatio)
        ? Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, o.splitRatio))
        : DEFAULT_SETTINGS.splitRatio,
    author: typeof o.author === 'string' && o.author ? o.author : DEFAULT_SETTINGS.author,
    autosaveOnToggle: o.autosaveOnToggle === true,
    commentStorage: o.commentStorage === 'embedded' ? 'embedded' : 'sidecar',
    exportTheme: typeof o.exportTheme === 'string' && o.exportTheme ? o.exportTheme : DEFAULT_SETTINGS.exportTheme,
    imageFolder:
      typeof o.imageFolder === 'string' && isValidImageFolder(o.imageFolder)
        ? o.imageFolder.trim()
        : DEFAULT_SETTINGS.imageFolder,
    imageNamePattern:
      typeof o.imageNamePattern === 'string' && o.imageNamePattern.trim()
        ? o.imageNamePattern
        : DEFAULT_SETTINGS.imageNamePattern,
    editorSyntax: typeof o.editorSyntax === 'boolean' ? o.editorSyntax : DEFAULT_SETTINGS.editorSyntax,
    tableGridView: typeof o.tableGridView === 'boolean' ? o.tableGridView : DEFAULT_SETTINGS.tableGridView,
    inlineImages: typeof o.inlineImages === 'boolean' ? o.inlineImages : DEFAULT_SETTINGS.inlineImages,
    showFrontmatter: typeof o.showFrontmatter === 'boolean' ? o.showFrontmatter : DEFAULT_SETTINGS.showFrontmatter,
    reopenLastDoc: typeof o.reopenLastDoc === 'boolean' ? o.reopenLastDoc : DEFAULT_SETTINGS.reopenLastDoc,
    showFolders: o.showFolders === true,
    folderWidth:
      typeof o.folderWidth === 'number' && Number.isFinite(o.folderWidth)
        ? Math.min(FOLDER_WIDTH_MAX, Math.max(FOLDER_WIDTH_MIN, Math.round(o.folderWidth)))
        : DEFAULT_SETTINGS.folderWidth,
    paneMinWidth:
      typeof o.paneMinWidth === 'number' && Number.isFinite(o.paneMinWidth)
        ? Math.min(PANE_MIN_WIDTH_MAX, Math.max(PANE_MIN_WIDTH_MIN, Math.round(o.paneMinWidth)))
        : DEFAULT_SETTINGS.paneMinWidth,
    hotkeys,
  };
}

export function serializeSettings(s: Settings): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}
