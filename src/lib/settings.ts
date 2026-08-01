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
  /** SPEC36 §8: restore the open-file set (tabs) at launch. */
  restoreOpenFiles: boolean;
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
  restoreOpenFiles: true,
  showFolders: false,
  folderWidth: 240,
  paneMinWidth: 768,
  hotkeys: { ...DEFAULT_HOTKEYS },
};

/**
 * PRD 002 §B5 scope tags — every persisted setting carries exactly one:
 * - `U`  user-personal: settable at any layer as a default; a valid User value wins.
 * - `U!` user-only identity: honored only at the User layer, ignored elsewhere.
 * - `W`  workspace-authoritative: Global/Team/Workspace may set it; User is ignored.
 * - `M`  machine/session-local: never part of the layered merge.
 */
export type Scope = 'U' | 'U!' | 'W' | 'M';

/**
 * The scope-tag inventory (PRD §B5). Exhaustive by construction: adding a
 * `Settings` key without classifying it here fails the typecheck.
 */
export const SETTINGS_SCOPES: Record<keyof Settings, Scope> = {
  themeLight: 'U',
  themeDark: 'U',
  useDarkTheme: 'U',
  fontSize: 'U',
  zoom: 'U',
  margins: 'U',
  lineNumbers: 'U',
  vimNav: 'U',
  autoHideToolbar: 'U',
  showWordCount: 'U',
  showResolved: 'U',
  commentsEnabled: 'U',
  typeToComment: 'U',
  splitEdit: 'M',
  splitRatio: 'M',
  author: 'U!',
  autosaveOnToggle: 'U',
  commentStorage: 'W',
  exportTheme: 'U',
  imageFolder: 'W',
  imageNamePattern: 'W',
  editorSyntax: 'U',
  tableGridView: 'U',
  inlineImages: 'U',
  showFrontmatter: 'U',
  reopenLastDoc: 'U',
  restoreOpenFiles: 'U',
  showFolders: 'M',
  folderWidth: 'M',
  paneMinWidth: 'U',
  hotkeys: 'U',
};

const bool = (raw: unknown): boolean | undefined => (typeof raw === 'boolean' ? raw : undefined);
const nonEmptyString = (raw: unknown): string | undefined => (typeof raw === 'string' && raw ? raw : undefined);
const clampedInt =
  (min: number, max: number) =>
  (raw: unknown): number | undefined =>
    typeof raw === 'number' && Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.round(raw))) : undefined;

/**
 * Per-key tolerance (PRD §A4): accept one layer's raw value — validated and
 * clamped — or reject it with `undefined` so resolution falls through to the
 * next layer down and ultimately to `DEFAULT_SETTINGS`.
 */
const VALIDATORS: { [K in keyof Settings]: (raw: unknown) => Settings[K] | undefined } = {
  themeLight: nonEmptyString,
  themeDark: nonEmptyString,
  useDarkTheme: bool,
  // Explicit "auto" is preserved (the theme's own size); out-of-range numbers
  // are rejected rather than clamped, matching the pre-resolver behavior.
  fontSize: (raw) => {
    if (raw === 'auto') return 'auto';
    if (typeof raw === 'number' && raw >= FONT_SIZE_MIN && raw <= FONT_SIZE_MAX) return Math.round(raw);
    return undefined;
  },
  zoom: (raw) => (typeof raw === 'number' && (ZOOM_LEVELS as readonly number[]).includes(raw) ? raw : undefined),
  margins: (raw) =>
    raw === 'default' || raw === 'super-narrow' || raw === 'narrow' || raw === 'medium' || raw === 'wide'
      ? raw
      : undefined,
  lineNumbers: bool,
  vimNav: bool,
  autoHideToolbar: bool,
  showWordCount: bool,
  showResolved: bool,
  commentsEnabled: bool,
  typeToComment: bool,
  splitEdit: bool,
  splitRatio: (raw) =>
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, raw))
      : undefined,
  author: nonEmptyString,
  autosaveOnToggle: bool,
  commentStorage: (raw) => (raw === 'embedded' || raw === 'sidecar' ? raw : undefined),
  exportTheme: nonEmptyString,
  imageFolder: (raw) => (typeof raw === 'string' && isValidImageFolder(raw) ? raw.trim() : undefined),
  imageNamePattern: (raw) => (typeof raw === 'string' && raw.trim() ? raw : undefined),
  editorSyntax: bool,
  tableGridView: bool,
  inlineImages: bool,
  showFrontmatter: bool,
  reopenLastDoc: bool,
  restoreOpenFiles: bool,
  showFolders: bool,
  folderWidth: clampedInt(FOLDER_WIDTH_MIN, FOLDER_WIDTH_MAX),
  paneMinWidth: clampedInt(PANE_MIN_WIDTH_MIN, PANE_MIN_WIDTH_MAX),
  // A hotkeys object is accepted as a whole map: valid entries land on top of
  // the defaults, blank/invalid bindings fall back per key.
  hotkeys: (raw) => {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const rec = raw as Record<string, unknown>;
    const out: HotkeyMap = { ...DEFAULT_HOTKEYS };
    for (const k of Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>) {
      const v = rec[k];
      if (typeof v === 'string' && v.trim()) out[k] = v;
    }
    return out;
  },
};

/**
 * The four ordered layer inputs (PRD §A1), lowest→highest precedence:
 * Global → Team → Workspace → User. Each is untrusted, partial, and optional;
 * layers are plain data so future sources (Team, cloud) plug in as inputs
 * without changing precedence semantics (§I27).
 */
export interface SettingsLayers {
  /** On top of baked `DEFAULT_SETTINGS` — e.g. `<configDir>/global-settings.json`. */
  global?: unknown;
  /** Reserved slot: no local file today, honored when supplied (§F21). */
  team?: unknown;
  /** The `.marky-workspace` layer (empty until the workspace model lands). */
  workspace?: unknown;
  /** The existing `<configDir>/settings.json`. */
  user?: unknown;
}

/** Coerce an untrusted layer to a record; migrate the pre-v3 single `theme` key. */
function normalizeLayer(raw: unknown): Record<string, unknown> {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (typeof o.theme === 'string' && o.theme && !(typeof o.themeLight === 'string' && o.themeLight)) {
    return { ...o, themeLight: o.theme };
  }
  return o;
}

/** Baked defaults with an unshared hotkeys map. */
function freshDefaults(): Settings {
  return { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_HOTKEYS } };
}

/**
 * Shared merge core: for each key, walk its candidate layers from highest
 * precedence down and keep the first valid value; keys with no valid
 * candidate anywhere stay at the baked default.
 */
function mergeLayers(candidatesFor: (key: keyof Settings) => ReadonlyArray<Record<string, unknown>>): Settings {
  const out = freshDefaults();
  for (const key of Object.keys(SETTINGS_SCOPES) as Array<keyof Settings>) {
    const validate = VALIDATORS[key] as (raw: unknown) => unknown;
    for (const layer of candidatesFor(key)) {
      const v = validate(layer[key]);
      if (v !== undefined) {
        (out as Record<keyof Settings, unknown>)[key] = v;
        break;
      }
    }
  }
  return out;
}

/** The four named layers, plus 'default' for keys no layer supplies. */
export type LayerName = 'global' | 'team' | 'workspace' | 'user';

/** Indicator wording building block: display names for the layers (§E19). */
export const LAYER_LABELS: Record<LayerName, string> = {
  global: 'Global',
  team: 'Team',
  workspace: 'Workspace',
  user: 'User',
};

/**
 * Candidate layers per scope, highest precedence first (§A2). M-scoped keys
 * skip the merge; their machine-local store is still settings.json — the
 * same file the User layer reads — until the storage split lands.
 */
const CANDIDATE_LAYERS: Record<Scope, ReadonlyArray<LayerName>> = {
  U: ['user', 'workspace', 'team', 'global'],
  'U!': ['user'],
  W: ['workspace', 'team', 'global'],
  M: ['user'],
};

function normalizedLayers(layers: SettingsLayers): Record<LayerName, Record<string, unknown>> {
  return {
    global: normalizeLayer(layers.global),
    team: normalizeLayer(layers.team),
    workspace: normalizeLayer(layers.workspace),
    user: normalizeLayer(layers.user),
  };
}

/**
 * Pure, deterministic four-layer resolution (PRD §A1–§A4): for each key, walk
 * the layers its scope admits from highest precedence down and take the first
 * valid value; every miss falls back to `DEFAULT_SETTINGS`. No I/O.
 */
export function resolveSettings(layers: SettingsLayers): Settings {
  const norm = normalizedLayers(layers);
  return mergeLayers((key) => CANDIDATE_LAYERS[SETTINGS_SCOPES[key]].map((name) => norm[name]));
}

/**
 * §E19: the layer that supplies `key`'s effective value — the first candidate
 * in its scope's precedence chain holding a valid value, or 'default'.
 */
export function winningLayer(key: keyof Settings, layers: SettingsLayers): LayerName | 'default' {
  const norm = normalizedLayers(layers);
  const validate = VALIDATORS[key] as (raw: unknown) => unknown;
  for (const name of CANDIDATE_LAYERS[SETTINGS_SCOPES[key]]) {
    if (validate(norm[name][key]) !== undefined) return name;
  }
  return 'default';
}

/** The Settings window's two writable scopes (§E18); Global/Team never edit. */
export type SettingsScopeTab = 'user' | 'workspace';

/**
 * §E18: the curated cosmetic (U-scoped) settings a workspace author may pin
 * as shared defaults. Never M- or U!-scoped keys.
 */
export const WORKSPACE_PINNABLE_KEYS: ReadonlyArray<keyof Settings> = [
  'themeLight',
  'themeDark',
  'useDarkTheme',
  'fontSize',
  'zoom',
  'margins',
];

/** Everything the Workspace tab shows: the W-scoped keys plus the pinnable set. */
export const WORKSPACE_ELIGIBLE_KEYS: ReadonlyArray<keyof Settings> = [
  ...(Object.keys(SETTINGS_SCOPES) as Array<keyof Settings>).filter((k) => SETTINGS_SCOPES[k] === 'W'),
  ...WORKSPACE_PINNABLE_KEYS,
];

/** §E19: what one settings row must convey on a given scope tab. */
export interface SettingsRowStatus {
  /** The layer supplying the effective value ('default' when none does). */
  winner: LayerName | 'default';
  /** Non-null → the row's indicator names this layer as winning over the tab's own layer. */
  overriddenBy: LayerName | null;
  /** W-scoped key viewed on the User tab: shown, but not user-editable. */
  workspaceControlled: boolean;
}

export function settingsRowStatus(
  key: keyof Settings,
  tab: SettingsScopeTab,
  layers: SettingsLayers
): SettingsRowStatus {
  const winner = winningLayer(key, layers);
  return {
    winner,
    overriddenBy: winner !== 'default' && winner !== tab ? winner : null,
    workspaceControlled: tab === 'user' && SETTINGS_SCOPES[key] === 'W',
  };
}

/**
 * The keys where `next` differs from `prev` — the panel's whole-Settings
 * edits become per-layer patches through this (hotkeys compare entry-wise,
 * so a rebuilt-but-equal map is no change).
 */
export function diffSettings(prev: Settings, next: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const key of Object.keys(SETTINGS_SCOPES) as Array<keyof Settings>) {
    if (key === 'hotkeys') {
      const changed = (Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>).some(
        (k) => prev.hotkeys[k] !== next.hotkeys[k]
      );
      if (changed) out.hotkeys = { ...next.hotkeys };
    } else if (prev[key] !== next[key]) {
      (out as Record<keyof Settings, unknown>)[key] = next[key];
    }
  }
  return out;
}

/**
 * settings.json now stores the raw User LAYER (sparse, only what the user
 * set) rather than the full effective Settings — serialize it as-is.
 */
export function serializeSettingsLayer(layer: Record<string, unknown>): string {
  return `${JSON.stringify(layer, null, 2)}\n`;
}

/**
 * Parse settings.json text; unknown/missing/malformed fields fall back to
 * defaults. This is the flat single-file (User) parse: every key is honored
 * regardless of scope, because settings.json doubles as the machine-local
 * store today. Layered resolution is `resolveSettings`.
 */
export function parseSettings(json: string): Settings {
  let data: unknown = null;
  try {
    data = JSON.parse(json);
  } catch {
    /* defaults */
  }
  const flat = [normalizeLayer(data)];
  return mergeLayers(() => flat);
}

export function serializeSettings(s: Settings): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}
