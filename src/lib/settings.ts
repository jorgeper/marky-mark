import { DEFAULT_HOTKEYS, type HotkeyMap } from './hotkeys';
import { isValidImageFolder } from './imagePaste';
import { isLlmProviderKind } from './llmSettings';
// PRD 011 Req 32: the accounting shape and its validator, defined once beside
// the fold that produces it rather than re-declared here.
import { EMPTY_USAGE_TALLY, isUsageTally, type UsageTally } from './llmUsage';
import type { LlmProviderKind } from './llmSeam';

export type CommentStorage = 'sidecar' | 'embedded';
/** Issue #125: the document view mode — the reading preview or the editor. */
export type ViewMode = 'preview' | 'edit';
/**
 * PRD 012 Req 1/Req 11: the sidebar pane's mutually exclusive views. It
 * lives here, with the setting that persists it, so the pure settings layer
 * names the union it validates instead of reaching into a React component.
 * PRD 014 Req 1: the Search view is the pane's third occupant.
 */
export type SidebarView = 'folders' | 'toc' | 'search';
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
  /**
   * Issue #125: the last view mode the reader chose. Remembered state, not a
   * preference with a Settings row — every mode switch records it and every
   * document open lands in it, so opening a file while editing keeps editing
   * (in the split layout when `splitEdit` is on).
   */
  lastViewMode: ViewMode;
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
  /**
   * Issue #122: colour fenced code blocks by language — in the preview (the
   * rehype-highlight output) and in the editor pane. Independent of
   * `editorSyntax`, which is markdown highlighting; on by default.
   */
  codeSyntax: boolean;
  /** PRD 006 §1: live preview in the edit pane — experimental, off by default. */
  livePreview: boolean;
  /** SPEC40 §1: show ALL tables as fitted grids in the editor (default on). */
  tableGridView: boolean;
  /** SPEC41 §1: render ALL images inline in the editor (default on). */
  inlineImages: boolean;
  /** Issue #157: fenced code blocks render as preview-style cards in the editor (default on). */
  codeBlockView: boolean;
  /** PRD 013 Req 5: registered-language fences render as diagrams in the editor (default on). */
  diagramView: boolean;
  /** SPEC26 §3: show the front-matter card by default when a doc has one. */
  showFrontmatter: boolean;
  /** SPEC34 §2.2: the folder sidebar's visibility (persisted toggle). */
  showFolders: boolean;
  /** SPEC34 §3.6: sidebar width in px, clamped [160, 480]. */
  folderWidth: number;
  /** PRD 012 Req 11: which of the pane's two views the sidebar last showed. */
  sidebarView: SidebarView;
  /** PRD 013 Reqs 13–14: the file tab strip's visibility (persisted, on by default). */
  fileTabs: boolean;
  /** Minimum content width per pane (px); narrower panes scroll sideways. */
  paneMinWidth: number;
  hotkeys: HotkeyMap;
  /**
   * PRD 011 Req 5: the one active provider kind. The settings store a kind, a
   * model and (desktop only) a credential; `resolveLlmProvider`
   * (`src/lib/llmSettings.ts`) turns those four into exactly one
   * `LlmProviderConfig`, so two live providers cannot be represented.
   */
  llmProvider: LlmProviderKind;
  /** PRD 011 Req 6: the model id, free text — a new model needs no release. */
  llmModel: string;
  /**
   * PRD 011 Req 7: the desktop credential. `U!`-scoped below, so no workspace
   * layer can supply it and it can never be written into a `.marky-workspace`
   * file, committed, or shared by opening a workspace.
   */
  llmApiKey: string;
  /** PRD 011 Req 5: the OpenAI-compatible endpoint the `custom` kind points at. */
  llmBaseUrl: string;
  /**
   * PRD 011 Req 32: measured usage for the most recent summarization run, and
   * the running total the reader can reset. They live in the settings layer
   * because that is what already reaches the desktop settings window — usage
   * arrives there on the ordinary `EV_SETTINGS_CHANGED` broadcast and a reset
   * travels back as an ordinary settings edit, so the aux window gains no
   * capability and no new bus round trip for this.
   */
  llmUsageLast: UsageTally;
  llmUsageTotal: UsageTally;
  /**
   * PRD 011 Req 33: ask before a zoomed level spends anything. On by default;
   * the confirmation's "don't ask again" turns it off, and the LLM providers
   * area turns it back on — no one-way door.
   */
  llmConfirmSummaries: boolean;
  /**
   * PRD 011 Reqs 1+2: the Experimental section's semantic-zoom switch, off by
   * default. It is the ONLY switch the feature reads: off means the control,
   * the View rows, the commands and the accelerators do not exist.
   */
  semanticZoom: boolean;
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
  // Issue #125: today's behaviour is the default — a fresh install opens
  // documents in the reading preview until the reader chooses otherwise.
  lastViewMode: 'preview',
  author: 'Reviewer',
  autosaveOnToggle: false,
  commentStorage: 'sidecar',
  exportTheme: 'current',
  imageFolder: 'images',
  imageNamePattern: '{doc} {n}',
  editorSyntax: true,
  codeSyntax: true,
  livePreview: false,
  tableGridView: true,
  inlineImages: true,
  // Issue #157: like tables and images, code blocks ship rendered.
  codeBlockView: true,
  // PRD 013 Req 5: like its three view neighbours, diagrams ship rendered.
  diagramView: true,
  showFrontmatter: true,
  showFolders: false,
  folderWidth: 240,
  // PRD 012 Req 11: a fresh install opens the pane on the folder tree — the
  // only view there was before the TOC.
  sidebarView: 'folders',
  // PRD 013 Req 13: the strip ships visible — the setting exists to turn it off.
  fileTabs: true,
  paneMinWidth: 768,
  hotkeys: { ...DEFAULT_HOTKEYS },
  // PRD 011 Req 7: the defaults leave the app UNCONFIGURED — an empty key and
  // no fabricated model, so a fresh install reports itself unavailable rather
  // than looking configured and failing on the first request.
  llmProvider: 'anthropic',
  llmModel: '',
  llmApiKey: '',
  llmBaseUrl: '',
  // PRD 011 Req 32: a fresh install has spent nothing, and says so rather than
  // reporting a measured zero.
  llmUsageLast: EMPTY_USAGE_TALLY,
  llmUsageTotal: EMPTY_USAGE_TALLY,
  // PRD 011 Req 33: the reader is asked before the first spend, not after it.
  llmConfirmSummaries: true,
  // PRD 011 Req 1: every Experimental feature ships off.
  semanticZoom: false,
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
  // Issue #125: machine/session-local, like its layout neighbours above — a
  // reader's current view mode is theirs, and no workspace or team layer may
  // force what mode someone else's documents open in.
  lastViewMode: 'M',
  author: 'U!',
  autosaveOnToggle: 'U',
  commentStorage: 'W',
  exportTheme: 'U',
  imageFolder: 'W',
  imageNamePattern: 'W',
  editorSyntax: 'U',
  // Issue #122: User scope, matching its neighbour editorSyntax — whether
  // code reads in colour is a reader's preference, not a workspace's to set.
  codeSyntax: 'U',
  livePreview: 'U',
  tableGridView: 'U',
  inlineImages: 'U',
  // Issue #157: User scope like its two view neighbours above — how code
  // reads in someone's editor is theirs, not a workspace's to dictate.
  codeBlockView: 'U',
  // PRD 013 Req 5: User scope, the tableGridView/inlineImages precedent —
  // whether diagrams draw in someone's editor is a reader's preference.
  diagramView: 'U',
  showFrontmatter: 'U',
  showFolders: 'M',
  folderWidth: 'M',
  // PRD 012 Req 11: machine-scoped like the sidebar's other two keys — which
  // view a reader left the pane on is theirs, not a workspace's to dictate.
  sidebarView: 'M',
  // PRD 013 Req 13: machine/session-local like its layout neighbours above
  // (showFolders / folderWidth / sidebarView) — whether the tab strip shows
  // is this reader's screen arrangement, not a workspace's to dictate.
  fileTabs: 'M',
  paneMinWidth: 'U',
  hotkeys: 'U',
  // PRD 011 Req 7: all four are `U!` — user-only identity, honored at the User
  // layer and ignored everywhere else. That is a hard requirement for the key
  // and the right answer for the rest: a provider/model/endpoint is chosen
  // together WITH the credential that reaches it, so a workspace pinning one
  // half would name a provider the user has no key for. `U!` also keeps every
  // one of them out of WORKSPACE_PINNABLE_KEYS by construction (it filters on
  // `U`), so none can travel to a shared layer.
  llmProvider: 'U!',
  llmModel: 'U!',
  llmApiKey: 'U!',
  llmBaseUrl: 'U!',
  // PRD 011 Req 32: what THIS reader spent through their own key, on their own
  // machine. `U!` for the same reason as the four above, and so the accounting
  // can never reach a workspace layer where it would be someone else's numbers
  // (`U!` keeps it out of WORKSPACE_PINNABLE_KEYS by construction).
  llmUsageLast: 'U!',
  llmUsageTotal: 'U!',
  // PRD 011 Req 33: a spending confirmation is the reader's own call, and no
  // shared layer may waive it on their behalf.
  llmConfirmSummaries: 'U!',
  // PRD 011 Req 1: user-personal — an experiment is a reader's own choice.
  // It is kept out of WORKSPACE_PINNABLE_KEYS explicitly below, so no shared
  // layer can switch an experiment on for someone else.
  semanticZoom: 'U',
};

/**
 * PRD 011 Req 1: the Experimental section's keys. U-scoped so a user sets
 * them for themselves, but never workspace-editable: they appear in neither
 * WORKSPACE_PINNABLE_KEYS nor WORKSPACE_ELIGIBLE_KEYS.
 */
export const EXPERIMENTAL_KEYS: ReadonlyArray<keyof Settings> = ['semanticZoom'];

const bool = (raw: unknown): boolean | undefined => (typeof raw === 'boolean' ? raw : undefined);
/**
 * PRD 011 Req 6: any string, INCLUDING the empty one. A model id is free text
 * and the unconfigured state is a real value, so `''` must survive a save and
 * reload rather than falling back to a default that would look configured.
 */
const anyString = (raw: unknown): string | undefined => (typeof raw === 'string' ? raw : undefined);
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
  // Issue #125: only the two real modes; a hand-edited settings.json naming
  // anything else falls back to the default rather than reaching the app.
  lastViewMode: (raw) => (raw === 'preview' || raw === 'edit' ? raw : undefined),
  author: nonEmptyString,
  autosaveOnToggle: bool,
  commentStorage: (raw) => (raw === 'embedded' || raw === 'sidecar' ? raw : undefined),
  exportTheme: nonEmptyString,
  imageFolder: (raw) => (typeof raw === 'string' && isValidImageFolder(raw) ? raw.trim() : undefined),
  imageNamePattern: (raw) => (typeof raw === 'string' && raw.trim() ? raw : undefined),
  editorSyntax: bool,
  codeSyntax: bool,
  livePreview: bool,
  tableGridView: bool,
  inlineImages: bool,
  codeBlockView: bool,
  // PRD 013 Req 5: a hand-edited non-boolean falls back to the default.
  diagramView: bool,
  showFrontmatter: bool,
  showFolders: bool,
  folderWidth: clampedInt(FOLDER_WIDTH_MIN, FOLDER_WIDTH_MAX),
  // PRD 012 Req 11 + PRD 014 Req 1: only the views that exist; a hand-edited
  // settings.json naming anything else reopens on the folder tree rather than
  // an empty pane.
  sidebarView: (raw) => (raw === 'folders' || raw === 'toc' || raw === 'search' ? raw : undefined),
  // PRD 013 Req 13: a hand-edited "off"/0 falls back to the default (on)
  // rather than reaching the strip as a truthy string.
  fileTabs: bool,
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
  // PRD 011 Req 5: the kind is validated against the seam's own union, so a
  // hand-edited settings.json naming a provider that does not exist falls back
  // to the default rather than reaching `providerFor` with a bad key.
  llmProvider: (raw) => (isLlmProviderKind(raw) ? raw : undefined),
  llmModel: anyString,
  llmApiKey: anyString,
  llmBaseUrl: anyString,
  // PRD 011 Req 32: a hand-edited file must not put a NaN or a negative count
  // into the accounting — the shape's own validator answers that, once.
  llmUsageLast: (raw) => (isUsageTally(raw) ? raw : undefined),
  llmUsageTotal: (raw) => (isUsageTally(raw) ? raw : undefined),
  llmConfirmSummaries: bool,
  semanticZoom: bool,
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
 * §E18 + issue #21: every U-scoped setting a workspace author may pin as a
 * shared default — the full user-personal set, no longer a curated cosmetic
 * subset. Never M- or U!-scoped keys; hotkeys stay User-only per issue #21.
 */
export const WORKSPACE_PINNABLE_KEYS: ReadonlyArray<keyof Settings> = (
  Object.keys(SETTINGS_SCOPES) as Array<keyof Settings>
).filter((k) => SETTINGS_SCOPES[k] === 'U' && k !== 'hotkeys' && !EXPERIMENTAL_KEYS.includes(k));

/** Everything Workspace scope may edit: the W-scoped keys plus the pinnable set. */
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
  /** M-/U!-scoped key viewed on the Workspace tab: shown, but the workspace layer can't supply it. */
  userOnly: boolean;
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
    userOnly: tab === 'workspace' && !WORKSPACE_ELIGIBLE_KEYS.includes(key),
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
