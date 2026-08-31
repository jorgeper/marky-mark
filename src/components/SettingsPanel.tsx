import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  diffSettings,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LAYER_LABELS,
  PANE_MIN_WIDTH_MAX,
  PANE_MIN_WIDTH_MIN,
  settingsRowStatus,
  ZOOM_LEVELS,
  type Margins,
  type Settings,
  type SettingsLayers,
  type SettingsScopeTab,
} from '../lib/settings';
import type { Theme } from '../lib/themes';
import {
  comboFromEvent,
  combosConflict,
  DEFAULT_HOTKEYS,
  displayCombo,
  type HotkeyMap,
} from '../lib/hotkeys';
import { SMART_EDIT_NAME } from '../lib/smartEdit';
import { expandImageName, isValidImageFolder } from '../lib/imagePaste';
import { LlmSettings } from './LlmSettings';
import { NO_LLM_CAPABILITIES, type LlmCapabilities, type LlmTestResult } from '../lib/llmSettings';
import type { SummaryCacheClearResult, SummaryCacheSizeResult } from '../lib/summaryCacheReport';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { useWorkspaceAccess, WorkspacePeopleTab } from './WorkspaceAccessSettings';

interface Props {
  /** The EFFECTIVE (resolved) settings — every row displays these (§E19). */
  settings: Settings;
  /** Raw layer inputs, for override indicators and row locking. */
  layers: SettingsLayers;
  /** §E18: the Workspace scope tab enables only while a workspace is open. */
  workspaceOpen: boolean;
  /** §H25: desktop-only — the web build shows no User|Workspace selector. */
  scopeSelector: boolean;
  themes: Theme[];
  isMac: boolean;
  /** Web build: comments are always embedded; the storage control locks. */
  storageLocked: boolean;
  /** SPEC12 §4.1: desktop has no toolbar, so the auto-hide option hides too. */
  autoHideAvailable: boolean;
  /** §E18: an edit writes ONLY the named layer — never the other one. */
  onEdit(scope: SettingsScopeTab, patch: Partial<Settings>): void;
  onReloadThemes(): void;
  /** Web only: pick a .css file and add it as a user theme. */
  onImportTheme?: () => void | Promise<void>;
  /** Desktop only: reveal the themes folder in the OS file manager. */
  onRevealThemesDir?: () => void | Promise<void>;
  onClose(): void;
  /** SPEC13 §1.3: aux-window mode — no scrim, no Done button. */
  frameless?: boolean;
  /** SPEC20 §1: current doc basename (no extension) for the pattern example. */
  docName?: string;
  /**
   * Issue #183 §1 (was PRD 007 Req 12's appended-ReactNode slot): the hosted
   * workspace lifecycle, when the host has one. It feeds the People tab —
   * members, roles and the danger zone — which exists only while a workspace
   * is open and the member holds a permitted section. Absent (desktop, web,
   * aux windows) the tab never renders.
   */
  workspaceLifecycle?: WorkspaceLifecycle;
  /**
   * PRD 011 Req 9: what the window holding the platform can do about LLM
   * requests. The panel forwards it; the LLM tab branches on it (never on a
   * flavor). Absent means "no LLM path", which is exactly the static web build.
   */
  llmCapabilities?: LlmCapabilities;
  /**
   * PRD 011 Req 10: run one test-connection request on behalf of the panel.
   * Supplied by whoever actually holds the capability — the main window inline,
   * or the aux window's round trip over the bus — so the panel itself never
   * calls the seam or an IPC command.
   */
  onLlmTest?: () => Promise<LlmTestResult>;
  /**
   * PRD 011 Reqs 9+30: whether the window holding the platform reached a
   * summary-cache store. Absent means none, which draws no cache section.
   */
  summaryCacheAvailable?: boolean;
  /**
   * PRD 011 Req 30: read the cache size, and clear it. Supplied by whoever
   * holds the store — the main window inline, or the aux window's round trip —
   * so the panel itself reaches no store and invokes no IPC command.
   */
  onSummaryCacheSize?: () => Promise<SummaryCacheSizeResult>;
  onSummaryCacheClear?: () => Promise<SummaryCacheClearResult>;
  /**
   * PRD 011 Req 22: the tab to land on, so a caller that already knows where
   * the reader is headed — the zoomed view's "configure a provider" route —
   * opens the LLM providers area itself rather than General. Absent keeps the
   * default, so every existing mount point is unchanged.
   */
  initialTab?: SettingsTab;
}

const HOTKEY_LABELS: Record<keyof HotkeyMap, string> = {
  toggleEdit: 'Toggle edit / preview',
  toggleSplit: 'Split edit',
  newFile: 'New file',
  openFile: 'Open file',
  // Issue #158: listed, rebindable and reset-to-default like every row.
  closeFile: 'Close file',
  find: 'Find',
  toggleFolders: 'Show / hide folders',
  // PRD 012 Req 10: listed, rebindable and reset-to-default like every row.
  toggleToc: 'Show / hide table of contents',
  // PRD 014 Req 3: listed, rebindable and reset-to-default like every row.
  searchAllFiles: 'Search all files',
  toggleComments: 'Show / hide comments',
  save: 'Save',
  nextComment: 'Next comment',
  prevComment: 'Previous comment',
  headingPalette: 'Go to heading',
  toggleWordCount: 'Show / hide word count',
  smartMenu: 'Open Smart Edit menu',
  bold: 'Bold',
  italic: 'Italic',
  strikethrough: 'Strikethrough',
  inlineCode: 'Inline code',
  link: 'Link',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  heading4: 'Heading 4',
  heading5: 'Heading 5',
  heading6: 'Heading 6',
  bulletList: 'Bullet list',
  numberedList: 'Numbered list',
  taskList: 'Task list',
  blockquote: 'Blockquote',
  codeBlock: 'Code block',
  horizontalRule: 'Horizontal rule',
  toggleOpenOnly: 'Only open files',
  nextFile: 'Next open file',
  prevFile: 'Previous open file',
};

/** SPEC43 §5.3: the Smart Edit recorder group, rendered under its own heading. */
const SMART_EDIT_KEYS: Array<keyof HotkeyMap> = [
  'smartMenu',
  'bold',
  'italic',
  'strikethrough',
  'inlineCode',
  'link',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'bulletList',
  'numberedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
];

const MARGIN_LABELS: Array<{ value: Margins; label: string }> = [
  { value: 'default', label: 'Theme default' },
  { value: 'super-narrow', label: 'Super narrow margins (max text)' },
  { value: 'narrow', label: 'Narrow margins (wide text)' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide margins (narrow text)' },
];

// PRD 011 Req 4: the LLM providers area is a page of its own, not a row
// appended to General, Editor or Appearance.
type SettingsTab = 'appearance' | 'general' | 'editor' | 'people' | 'hotkeys' | 'llm' | 'experimental';

/**
 * PRD 011 Req 1: the Experimental features, as DATA. A second experiment is
 * one more entry here — a key, a label and one line saying what turning it on
 * DOES — not a copy of the row markup below.
 */
const EXPERIMENTAL_FEATURES: Array<{
  key: keyof Settings;
  testId: string;
  label: string;
  description: string;
  /**
   * PRD 011 Req 3: where an experiment's stored data and credentials are
   * removed. A reader standing the feature down must not have to hunt for the
   * actions, so the row names the page and routes there in one click (the
   * excerpt notice's route to the same tab is the precedent).
   */
  standDown?: { tab: SettingsTab; sentence: string; linkLabel: string };
}> = [
  {
    key: 'semanticZoom',
    testId: 'experimental-semantic-zoom',
    label: 'Semantic zoom',
    description:
      'Adds a level control to the document view that collapses the document through five levels — every heading with a short block, down to the whole document in a paragraph — and back.',
    standDown: {
      tab: 'llm',
      sentence:
        'Turning this off stops every summary but deletes nothing. Your API key and the cached summaries are removed on the LLM providers page, one action each:',
      linkLabel: 'Remove the key or clear the summary cache',
    },
  },
];

/** PRD 011 Req 1: said once, for the whole section. */
const EXPERIMENTAL_WARNING =
  'These features are experiments. They may change, or be removed, in any release.';

/** PRD 011 Req 4 (following issue #21's Hotkeys precedent): User-scope-only tabs. */
const USER_ONLY_TABS: ReadonlyArray<SettingsTab> = ['hotkeys', 'llm', 'experimental'];

// Issue #21: General leads, and Hotkeys is a User-scope-only tab.
const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  // Issue #183 §1: People sits immediately after Editor. It renders only
  // while a hosted workspace is open and the member holds a permitted
  // section (the render-time filter below), and — being workspace-tied, not
  // layer-tied — it shows in both scopes of the scope selector.
  { id: 'people', label: 'People' },
  { id: 'hotkeys', label: 'Hotkeys' },
  // PRD 011 Req 4: unconditional — no experimental flag gates it.
  { id: 'llm', label: 'LLM providers' },
  // PRD 011 Req 1: the Experimental area is a page of its own, User-scope
  // only — it reads as *the* place experiments live, and it is last.
  { id: 'experimental', label: 'Experimental' },
];

export function SettingsPanel({
  settings,
  layers,
  workspaceOpen,
  scopeSelector,
  themes,
  isMac,
  storageLocked,
  autoHideAvailable,
  onEdit,
  onReloadThemes,
  onImportTheme,
  onRevealThemesDir,
  onClose,
  frameless,
  docName,
  workspaceLifecycle,
  llmCapabilities,
  onLlmTest,
  summaryCacheAvailable,
  onSummaryCacheSize,
  onSummaryCacheClear,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  // §E18: which layer this window writes. Without the selector (web) it is
  // permanently 'user'; closing the workspace kicks the view back to User.
  const [scope, setScope] = useState<SettingsScopeTab>('user');
  useEffect(() => {
    if (scope === 'workspace' && (!scopeSelector || !workspaceOpen)) setScope('user');
  }, [scope, scopeSelector, workspaceOpen]);
  // Issue #21 + PRD 011 Req 4: Hotkeys and LLM providers are User-only —
  // landing in Workspace scope on one bounces to General.
  useEffect(() => {
    if (scope === 'workspace' && USER_ONLY_TABS.includes(tab)) setTab('general');
  }, [scope, tab]);
  // Issue #183 §1: what the People tab may show, loaded once per open
  // workspace; the tab itself appears only when there is something to show.
  const wsAccess = useWorkspaceAccess(workspaceLifecycle);
  // Closing the workspace (or losing the permission) while People is up
  // bounces to General, like the scope machinery above.
  useEffect(() => {
    if (tab === 'people' && !wsAccess.peopleTab) setTab('general');
  }, [tab, wsAccess.peopleTab]);
  const [hint, setHint] = useState('');
  // SPEC20 §1: the folder field keeps the raw draft; only valid single-segment
  // names commit to settings (the last valid value survives bad keystrokes).
  const [folderDraft, setFolderDraft] = useState(settings.imageFolder);
  const folderInvalid = !isValidImageFolder(folderDraft);
  // Remember the last custom size so toggling Auto → Customized restores it.
  const [customSize, setCustomSize] = useState(typeof settings.fontSize === 'number' ? settings.fontSize : 16);
  // Pane-min is a free-typing draft: valid in-range values commit live,
  // blur/Enter clamps and normalizes (a clamping spinner fought every key).
  const [paneMinDraft, setPaneMinDraft] = useState(String(settings.paneMinWidth));

  // Rows still build whole-Settings edits; only the changed keys travel, to
  // the layer the current scope names (§E18 layer-targeted writes).
  const onChange = (next: Settings) => {
    const patch = diffSettings(settings, next);
    if (Object.keys(patch).length > 0) onEdit(scope, patch);
  };

  // §E19 row status: override indicator + per-scope locking (W keys lock in
  // User scope; M/U! keys lock in Workspace scope).
  const rowStatus = (key: keyof Settings) => settingsRowStatus(key, scope, layers);
  const scopeLocked = (key: keyof Settings) => {
    const st = rowStatus(key);
    return st.workspaceControlled || st.userOnly;
  };
  const scopeNote = (key: keyof Settings) => {
    const st = rowStatus(key);
    let note: string | null = null;
    if (st.userOnly) {
      note = 'User setting — edit it in User scope.';
    } else if (st.workspaceControlled) {
      note = st.overriddenBy
        ? `Workspace setting — set by ${LAYER_LABELS[st.overriddenBy]}; edit it in Workspace scope.`
        : 'Workspace setting — edit it in Workspace scope.';
    } else if (st.overriddenBy) {
      note = `Overridden by ${LAYER_LABELS[st.overriddenBy]}`;
    }
    if (!note) return null;
    // Issue #25: absolutely positioned icon — the note must never change a
    // row's height between scopes; the text lives in the hover tooltip.
    return (
      <span
        className="scope-note"
        data-testid={`scope-note-${key}`}
        title={note}
        aria-label={note}
        tabIndex={0}
      >
        ⓘ
      </span>
    );
  };

  const commitPaneMin = () => {
    const n = Math.round(Number(paneMinDraft));
    const clamped = Number.isFinite(n)
      ? Math.min(PANE_MIN_WIDTH_MAX, Math.max(PANE_MIN_WIDTH_MIN, n))
      : settings.paneMinWidth;
    setPaneMinDraft(String(clamped));
    if (clamped !== settings.paneMinWidth) onChange({ ...settings, paneMinWidth: clamped });
  };

  /** Bind one action, clearing any stale conflict hint (recorder and per-row restore alike). */
  const setHotkey = (action: keyof HotkeyMap, combo: string) => {
    setHint('');
    onChange({ ...settings, hotkeys: { ...settings.hotkeys, [action]: combo } });
  };

  const recordHotkey = (action: keyof HotkeyMap) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      (e.target as HTMLInputElement).blur();
      return;
    }
    // Issue #84: record what was pressed — a mac ⌃-chord stores strict Ctrl.
    const combo = comboFromEvent(e, isMac);
    if (!combo) return; // modifier only — keep recording
    // Issue #84: chord collision, not string equality — ⌃Tab fires both
    // "Ctrl+Tab" and "Mod+Tab", so those must still read as bound.
    const conflict = (Object.keys(settings.hotkeys) as Array<keyof HotkeyMap>).find(
      (k) => k !== action && combosConflict(settings.hotkeys[k], combo)
    );
    if (conflict) {
      setHint(`${displayCombo(combo, isMac)} is already bound to “${HOTKEY_LABELS[conflict]}”`);
      return;
    }
    setHotkey(action, combo);
    (e.target as HTMLInputElement).blur();
  };

  const themeOptions = themes.map((t) => (
    <option value={t.id} key={t.id}>
      {t.name}
      {t.builtin ? '' : ' (yours)'}
    </option>
  ));

  const setCustomFontSize = (n: number) => {
    const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)));
    setCustomSize(clamped);
    onChange({ ...settings, fontSize: clamped });
  };

  // --- shared rows: both scopes render the same tabs; the current scope
  // --- names the target layer and locks ineligible rows (§E18, issue #21) ---

  const fontSizeRow = (
    <div className="field">
      <label>Font size</label>
      <div className="inline-row">
        <label className="radio-label">
          <input
            type="radio"
            name="fontsize-mode"
            data-testid="fontsize-auto"
            checked={settings.fontSize === 'auto'}
            onChange={() => onChange({ ...settings, fontSize: 'auto' })}
          />
          Auto (recommended)
        </label>
        <label className="radio-label">
          <input
            type="radio"
            name="fontsize-mode"
            data-testid="fontsize-custom"
            checked={settings.fontSize !== 'auto'}
            onChange={() => onChange({ ...settings, fontSize: customSize })}
          />
          Customized
        </label>
        <input
          type="number"
          data-testid="fontsize-input"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          value={settings.fontSize === 'auto' ? customSize : settings.fontSize}
          disabled={settings.fontSize === 'auto'}
          onChange={(e) => setCustomFontSize(Number(e.target.value))}
          style={{ width: 64 }}
        />
        <span className="unit">px</span>
      </div>
      {scopeNote('fontSize')}
    </div>
  );

  const zoomRow = (
    <div className="field">
      <label htmlFor="zoom-select">Zoom (document text only)</label>
      <div className="inline-row">
        <select
          id="zoom-select"
          data-testid="zoom-select"
          value={settings.zoom}
          onChange={(e) => onChange({ ...settings, zoom: Number(e.target.value) })}
          style={{ width: 120 }}
        >
          {ZOOM_LEVELS.map((z) => (
            <option value={z} key={z}>
              {z}%
            </option>
          ))}
        </select>
        <button className="linklike" data-testid="zoom-reset" onClick={() => onChange({ ...settings, zoom: 100 })}>
          Reset to Default
        </button>
      </div>
      {scopeNote('zoom')}
    </div>
  );

  const themeLightRow = (
    <div className="field">
      <label htmlFor="settings-theme-light">Light theme</label>
      <select
        id="settings-theme-light"
        data-testid="settings-theme-light"
        value={settings.themeLight}
        onChange={(e) => onChange({ ...settings, themeLight: e.target.value })}
      >
        {themeOptions}
      </select>
      {scopeNote('themeLight')}
    </div>
  );

  const themeDarkRow = (
    <div className="field">
      <label htmlFor="settings-theme-dark">Dark theme</label>
      <select
        id="settings-theme-dark"
        data-testid="settings-theme-dark"
        value={settings.themeDark}
        onChange={(e) => onChange({ ...settings, themeDark: e.target.value })}
      >
        {themeOptions}
      </select>
      {scopeNote('themeDark')}
    </div>
  );

  const darkModeRow = (
    <div className="checkbox-row">
      <input
        id="use-dark-theme"
        type="checkbox"
        data-testid="use-dark-theme"
        checked={settings.useDarkTheme}
        onChange={(e) => onChange({ ...settings, useDarkTheme: e.target.checked })}
      />
      <label htmlFor="use-dark-theme" style={{ margin: 0, fontWeight: 400 }}>
        Use separate theme in dark mode
      </label>
      {scopeNote('useDarkTheme')}
    </div>
  );

  const marginsRow = (
    <div className="field">
      <label htmlFor="settings-margins">Text margins</label>
      <select
        id="settings-margins"
        data-testid="settings-margins"
        value={settings.margins}
        onChange={(e) => onChange({ ...settings, margins: e.target.value as Margins })}
      >
        {MARGIN_LABELS.map((m) => (
          <option value={m.value} key={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {scopeNote('margins')}
    </div>
  );

  const storageRow = (
    <div className="field">
      <label htmlFor="comment-storage">Comment storage</label>
      <select
        id="comment-storage"
        data-testid="comment-storage"
        value={settings.commentStorage}
        disabled={storageLocked || scopeLocked('commentStorage')}
        onChange={(e) =>
          onChange({ ...settings, commentStorage: e.target.value === 'embedded' ? 'embedded' : 'sidecar' })
        }
      >
        <option value="sidecar">Sidecar file (name.md.comments.json)</option>
        <option value="embedded">Embedded in the markdown file (invisible)</option>
      </select>
      {storageLocked && <p className="hotkey-hint">The web version always embeds comments in the file.</p>}
      {!storageLocked && scopeNote('commentStorage')}
    </div>
  );

  const patternExample = expandImageName(
    settings.imageNamePattern || DEFAULT_SETTINGS.imageNamePattern,
    'png',
    { docName: docName || 'document', now: new Date(), exists: () => false }
  );

  const imageFolderRow = (
    <div className="field">
      <label htmlFor="image-folder">Folder for pasted images (created next to the document)</label>
      <input
        id="image-folder"
        type="text"
        data-testid="image-folder"
        value={folderDraft}
        disabled={scopeLocked('imageFolder')}
        onChange={(e) => {
          const v = e.target.value;
          setFolderDraft(v);
          if (isValidImageFolder(v)) onChange({ ...settings, imageFolder: v.trim() });
        }}
      />
      {folderInvalid && (
        <p className="hotkey-hint" data-testid="image-folder-error">
          Folder must be a single name — no slashes or “..”.
        </p>
      )}
      {scopeNote('imageFolder')}
    </div>
  );

  const imagePatternRow = (
    <div className="field">
      <label htmlFor="image-pattern">File name for pasted images</label>
      <input
        id="image-pattern"
        type="text"
        data-testid="image-pattern"
        value={settings.imageNamePattern}
        disabled={scopeLocked('imageNamePattern')}
        onChange={(e) => onChange({ ...settings, imageNamePattern: e.target.value })}
      />
      <p className="hotkey-hint" data-testid="image-pattern-example">
        {'Example: '}
        {patternExample}
        {' — tokens: {doc} (document name), {n} (next free number), {date}, {time}.'}
      </p>
      {scopeNote('imageNamePattern')}
    </div>
  );

  const appearanceTab = (
    <>
      {fontSizeRow}
      {zoomRow}
      {themeLightRow}
      {themeDarkRow}
      {darkModeRow}

      {/* Issue #21: machine-local ACTIONS (not settings) stay User-scope-only. */}
      {scope === 'user' && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="linklike" data-testid="reload-themes" onClick={onReloadThemes}>
            ↻ Reload themes
          </button>
          {onRevealThemesDir && (
            <button className="linklike" data-testid="open-theme-folder" onClick={() => void onRevealThemesDir()}>
              Open Theme Folder
            </button>
          )}
          {onImportTheme && (
            <button className="linklike" data-testid="import-theme" onClick={() => void onImportTheme()}>
              + Import theme…
            </button>
          )}
        </div>
      )}

      {marginsRow}

      <div className="field">
        <label htmlFor="settings-pane-min">
          Minimum pane width (px) — narrower panes scroll sideways
        </label>
        <input
          id="settings-pane-min"
          type="text"
          inputMode="numeric"
          data-testid="settings-pane-min"
          value={paneMinDraft}
          onChange={(e) => {
            const raw = e.target.value;
            setPaneMinDraft(raw);
            const v = Math.round(Number(raw));
            if (Number.isFinite(v) && v >= PANE_MIN_WIDTH_MIN && v <= PANE_MIN_WIDTH_MAX) {
              onChange({ ...settings, paneMinWidth: v });
            }
          }}
          onBlur={commitPaneMin}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          style={{ width: 80 }}
        />
        {scopeNote('paneMinWidth')}
      </div>
    </>
  );

  const generalTab = (
    <>
      <h3 className="tab-section">Editor</h3>
      {/* Issue #10: line numbers moved to View → Line Numbers. The persisted
          `lineNumbers` key is unchanged — only this row is gone. */}
      <div className="checkbox-row">
        <input
          id="autosave-toggle"
          type="checkbox"
          data-testid="autosave-toggle"
          checked={settings.autosaveOnToggle}
          onChange={(e) => onChange({ ...settings, autosaveOnToggle: e.target.checked })}
        />
        <label htmlFor="autosave-toggle" style={{ margin: 0, fontWeight: 400 }}>
          Save automatically when switching to preview
        </label>
        {scopeNote('autosaveOnToggle')}
      </div>

      <div className="checkbox-row">
        <input
          id="set-split-edit"
          type="checkbox"
          data-testid="set-split-edit"
          checked={settings.splitEdit}
          disabled={scopeLocked('splitEdit')}
          onChange={(e) => onChange({ ...settings, splitEdit: e.target.checked })}
        />
        <label htmlFor="set-split-edit" style={{ margin: 0, fontWeight: 400 }}>
          Edit side by side with a live preview (instead of a full-screen swap)
        </label>
        {scopeNote('splitEdit')}
      </div>

      <h3 className="tab-section">Comments</h3>
      <div className="checkbox-row">
        <input
          id="set-comments-enabled"
          type="checkbox"
          data-testid="set-comments-enabled"
          checked={settings.commentsEnabled}
          onChange={(e) => onChange({ ...settings, commentsEnabled: e.target.checked })}
        />
        <label htmlFor="set-comments-enabled" style={{ margin: 0, fontWeight: 400 }}>
          Enable comments (highlights, panel, and the selection button)
        </label>
        {scopeNote('commentsEnabled')}
      </div>

      <div className="checkbox-row">
        <input
          id="set-type-to-comment"
          type="checkbox"
          data-testid="set-type-to-comment"
          disabled={!settings.commentsEnabled}
          checked={settings.typeToComment}
          onChange={(e) => onChange({ ...settings, typeToComment: e.target.checked })}
        />
        <label htmlFor="set-type-to-comment" style={{ margin: 0, fontWeight: 400 }}>
          Start a comment by typing over a selection (no button click needed)
        </label>
        {scopeNote('typeToComment')}
      </div>

      <div className="checkbox-row">
        <input
          id="show-resolved"
          type="checkbox"
          data-testid="show-resolved"
          disabled={!settings.commentsEnabled}
          checked={settings.showResolved}
          onChange={(e) => onChange({ ...settings, showResolved: e.target.checked })}
        />
        <label htmlFor="show-resolved" style={{ margin: 0, fontWeight: 400 }}>
          Show resolved comments, ghosted in place
        </label>
        {scopeNote('showResolved')}
      </div>

      <div className="field">
        <label htmlFor="author-input">Comment author name</label>
        <input
          id="author-input"
          type="text"
          data-testid="author-input"
          value={settings.author}
          disabled={scopeLocked('author')}
          onChange={(e) => onChange({ ...settings, author: e.target.value })}
        />
        {scopeNote('author')}
      </div>

      {storageRow}

      {autoHideAvailable && (
        <div className="checkbox-row">
          <input
            id="settings-autohide"
            type="checkbox"
            data-testid="settings-autohide"
            checked={settings.autoHideToolbar}
            onChange={(e) => onChange({ ...settings, autoHideToolbar: e.target.checked })}
          />
          <label htmlFor="settings-autohide" style={{ margin: 0, fontWeight: 400 }}>
            Auto-hide the toolbar (reveal by moving the mouse to the top)
          </label>
          {scopeNote('autoHideToolbar')}
        </div>
      )}

      {/* Issue #167: scrollbars fade when idle; off restores always-visible
          bars. Takes effect live — the fade installer keys off the value. */}
      <div className="checkbox-row">
        <input
          id="settings-autohide-scrollbars"
          type="checkbox"
          data-testid="settings-autohide-scrollbars"
          checked={settings.autoHideScrollbars}
          onChange={(e) => onChange({ ...settings, autoHideScrollbars: e.target.checked })}
        />
        <label htmlFor="settings-autohide-scrollbars" style={{ margin: 0, fontWeight: 400 }}>
          Auto-hide scrollbars (show while scrolling or under the pointer)
        </label>
        {scopeNote('autoHideScrollbars')}
      </div>

      {/* Issue #167: hides only the corner button — the sync state itself
          stays where it is, reachable through View ▸ Sync Scrolling. */}
      <div className="checkbox-row">
        <input
          id="settings-sync-scroll-button"
          type="checkbox"
          data-testid="settings-sync-scroll-button"
          checked={settings.showSyncScrollButton}
          onChange={(e) => onChange({ ...settings, showSyncScrollButton: e.target.checked })}
        />
        <label htmlFor="settings-sync-scroll-button" style={{ margin: 0, fontWeight: 400 }}>
          Show the sync-scroll button in the split view's corner
        </label>
        {scopeNote('showSyncScrollButton')}
      </div>

      <div className="checkbox-row">
        <input
          id="settings-frontmatter"
          type="checkbox"
          data-testid="settings-frontmatter"
          checked={settings.showFrontmatter}
          onChange={(e) => onChange({ ...settings, showFrontmatter: e.target.checked })}
        />
        <label htmlFor="settings-frontmatter" style={{ margin: 0, fontWeight: 400 }}>
          Show front matter (when a document has it)
        </label>
        {scopeNote('showFrontmatter')}
      </div>

      <h3 className="tab-section">Navigation</h3>
      <div className="checkbox-row">
        <input
          id="settings-vimnav"
          type="checkbox"
          data-testid="settings-vimnav"
          checked={settings.vimNav}
          onChange={(e) => onChange({ ...settings, vimNav: e.target.checked })}
        />
        <label htmlFor="settings-vimnav" style={{ margin: 0, fontWeight: 400 }}>
          Vim-style navigation (preview: j/k, Ctrl+d/u, gg/G; edit: Esc for nav mode, i to type)
        </label>
        {scopeNote('vimNav')}
      </div>

    </>
  );

  const editorTab = (
    <>
      <h3 className="tab-section">Syntax</h3>
      <div className="checkbox-row">
        <input
          id="editor-syntax"
          type="checkbox"
          data-testid="editor-syntax"
          checked={settings.editorSyntax}
          onChange={(e) => onChange({ ...settings, editorSyntax: e.target.checked })}
        />
        <label htmlFor="editor-syntax" style={{ margin: 0, fontWeight: 400 }}>
          Markdown syntax highlighting
        </label>
        {scopeNote('editorSyntax')}
      </div>
      {/* Issue #122: code-block colouring — a different thing from the row
          above (that one colours the markdown you are typing; this one colours
          what is inside a fenced block, in the preview and the editor alike). */}
      <div className="checkbox-row">
        <input
          id="code-syntax"
          type="checkbox"
          data-testid="code-syntax"
          checked={settings.codeSyntax}
          onChange={(e) => onChange({ ...settings, codeSyntax: e.target.checked })}
        />
        <label htmlFor="code-syntax" style={{ margin: 0, fontWeight: 400 }}>
          Code block syntax coloring
        </label>
        {scopeNote('codeSyntax')}
      </div>
      {/* PRD 006 §1: the experimental live-preview opt-in, off by default. */}
      <div className="checkbox-row">
        <input
          id="editor-live-preview"
          type="checkbox"
          data-testid="editor-live-preview"
          checked={settings.livePreview}
          onChange={(e) => onChange({ ...settings, livePreview: e.target.checked })}
        />
        <label htmlFor="editor-live-preview" style={{ margin: 0, fontWeight: 400 }}>
          Live preview (experimental)
        </label>
        {scopeNote('livePreview')}
      </div>

      <h3 className="tab-section">Tables</h3>
      <div className="checkbox-row">
        <input
          id="settings-table-grid"
          type="checkbox"
          data-testid="settings-table-grid"
          checked={settings.tableGridView}
          onChange={(e) => onChange({ ...settings, tableGridView: e.target.checked })}
        />
        <label htmlFor="settings-table-grid" style={{ margin: 0, fontWeight: 400 }}>
          Show tables as grids in the editor
        </label>
        {scopeNote('tableGridView')}
      </div>

      <h3 className="tab-section">Images</h3>
      <div className="checkbox-row">
        <input
          id="settings-inline-images"
          type="checkbox"
          data-testid="settings-inline-images"
          checked={settings.inlineImages}
          onChange={(e) => onChange({ ...settings, inlineImages: e.target.checked })}
        />
        <label htmlFor="settings-inline-images" style={{ margin: 0, fontWeight: 400 }}>
          Show images in the editor
        </label>
        {scopeNote('inlineImages')}
      </div>
      {imageFolderRow}
      {imagePatternRow}

      {/* Issue #157: the fenced-code card view, beside its Tables/Images kin. */}
      <h3 className="tab-section">Code</h3>
      <div className="checkbox-row">
        <input
          id="settings-code-block-view"
          type="checkbox"
          data-testid="settings-code-block-view"
          checked={settings.codeBlockView}
          onChange={(e) => onChange({ ...settings, codeBlockView: e.target.checked })}
        />
        <label htmlFor="settings-code-block-view" style={{ margin: 0, fontWeight: 400 }}>
          Show code blocks as cards in the editor
        </label>
        {scopeNote('codeBlockView')}
      </div>

      {/* PRD 013 Req 6: the edit-pane diagram view, beside its three view kin. */}
      <h3 className="tab-section">Diagrams</h3>
      <div className="checkbox-row">
        <input
          id="settings-diagram-view"
          type="checkbox"
          data-testid="settings-diagram-view"
          checked={settings.diagramView}
          onChange={(e) => onChange({ ...settings, diagramView: e.target.checked })}
        />
        <label htmlFor="settings-diagram-view" style={{ margin: 0, fontWeight: 400 }}>
          Show diagrams in the editor
        </label>
        {scopeNote('diagramView')}
      </div>
    </>
  );

  const hotkeyRow = (action: keyof HotkeyMap) => (
    <div className="hotkey-row" key={action}>
      <label htmlFor={`hotkey-${action}`}>{HOTKEY_LABELS[action]}</label>
      <input
        id={`hotkey-${action}`}
        type="text"
        readOnly
        data-testid={`hotkey-${action}`}
        data-hotkey-recorder="true"
        value={displayCombo(settings.hotkeys[action], isMac)}
        placeholder="Press keys…"
        onKeyDown={recordHotkey(action)}
        onFocus={(e) => e.target.select()}
      />
      {/* Issue #84: per-row restore — what makes one mis-recorded binding
          recoverable without resetting the whole map. */}
      <button
        className="hotkey-reset"
        data-testid={`reset-hotkey-${action}`}
        title={`Restore default (${displayCombo(DEFAULT_HOTKEYS[action], isMac)})`}
        aria-label={`Restore default for ${HOTKEY_LABELS[action]}`}
        disabled={settings.hotkeys[action] === DEFAULT_HOTKEYS[action]}
        onClick={() => setHotkey(action, DEFAULT_HOTKEYS[action])}
      >
        ↺
      </button>
    </div>
  );

  const hotkeysTab = (
    <>
      {(Object.keys(HOTKEY_LABELS) as Array<keyof HotkeyMap>)
        .filter((a) => !SMART_EDIT_KEYS.includes(a))
        .map(hotkeyRow)}
      {/* SPEC43 §5.3: the Smart Edit group. */}
      <h4 className="hotkey-group" data-testid="hotkey-group-smart-edit">
        {SMART_EDIT_NAME}
      </h4>
      {SMART_EDIT_KEYS.map(hotkeyRow)}
      <p className="hotkey-hint" data-testid="hotkey-hint">
        {hint || 'Click a field, then press the new key combination.'}
      </p>
      <div className="row">
        <button className="linklike" data-testid="reset-hotkeys" onClick={() => onChange({ ...settings, hotkeys: { ...DEFAULT_HOTKEYS } })}>
          Reset hotkeys
        </button>
      </div>
    </>
  );

  // PRD 011 Req 4: the LLM providers page. It renders identically from both
  // mount points — the inline panel in App.tsx and the desktop aux window —
  // because everything platform-specific arrives as these two props.
  const llmTab = (
    <LlmSettings
      values={settings}
      capabilities={llmCapabilities ?? NO_LLM_CAPABILITIES}
      onChange={(patch) => onChange({ ...settings, ...patch })}
      onTest={onLlmTest}
      // PRD 011 Req 30: the cache capability and its two actions, forwarded
      // from whichever window holds the store.
      summaryCacheAvailable={summaryCacheAvailable}
      onCacheSize={onSummaryCacheSize}
      onCacheClear={onSummaryCacheClear}
    />
  );

  // PRD 011 Req 1: one row per data entry — off by default, each carrying the
  // one line that says what turning it on does.
  const experimentalTab = (
    <>
      <p className="hotkey-hint experimental-warning" data-testid="experimental-warning">
        {EXPERIMENTAL_WARNING}
      </p>
      {EXPERIMENTAL_FEATURES.map((f) => {
        const { standDown } = f;
        return (
          <div className="experimental-row" key={f.key}>
            <div className="checkbox-row">
              <input
                id={f.testId}
                type="checkbox"
                data-testid={f.testId}
                checked={settings[f.key] === true}
                onChange={(e) => onChange({ ...settings, [f.key]: e.target.checked })}
              />
              <label htmlFor={f.testId} style={{ margin: 0, fontWeight: 400 }}>
                {f.label}
              </label>
              {scopeNote(f.key)}
            </div>
            <p className="hotkey-hint experimental-desc" data-testid={`${f.testId}-description`}>
              {f.description}
            </p>
            {/* PRD 011 Req 3: standing down is OFFERED, never imposed — the row
                says the switch deletes nothing and routes to where it is done. */}
            {standDown && (
              <p className="hotkey-hint experimental-desc" data-testid={`${f.testId}-stand-down`}>
                {standDown.sentence}{' '}
                <button
                  className="linklike"
                  data-testid={`${f.testId}-stand-down-link`}
                  onClick={() => setTab(standDown.tab)}
                >
                  {standDown.linkLabel}
                </button>
              </p>
            )}
          </div>
        );
      })}
    </>
  );

  const doneButton = !frameless && (
    <div className="actions">
      <button className="primary" data-testid="settings-close" onClick={onClose}>
        Done
      </button>
    </div>
  );

  const body = (
    <div className="modal settings-modal" data-testid="settings-panel">
      {/* §E18/§H25: the User | Workspace scope selector — desktop only. */}
      {scopeSelector && (
        <nav className="scope-rail" data-testid="settings-scope">
          <button
            className={`tab-btn scope-btn${scope === 'user' ? ' active' : ''}`}
            data-testid="settings-scope-user"
            onClick={() => setScope('user')}
          >
            User
          </button>
          <button
            className={`tab-btn scope-btn${scope === 'workspace' ? ' active' : ''}`}
            data-testid="settings-scope-workspace"
            disabled={!workspaceOpen}
            title={workspaceOpen ? undefined : 'Open a workspace to edit its settings'}
            onClick={() => setScope('workspace')}
          >
            Workspace
          </button>
          {!workspaceOpen && (
            <span className="scope-hint" data-testid="settings-scope-hint">
              No workspace open
            </span>
          )}
        </nav>
      )}
      <div className="settings-body">
        {/* Issue #21: both scopes share one tab rail; Hotkeys is User-only. */}
        <nav className="tab-rail" data-testid="settings-tabs">
          {TABS.filter(
            (t) =>
              (scope === 'user' || !USER_ONLY_TABS.includes(t.id)) &&
              // Issue #183 §1: no workspace open, or no permitted section —
              // no People tab (and no placeholder in its place).
              (t.id !== 'people' || wsAccess.peopleTab),
          ).map((t) => (
            <button
              key={t.id}
              className={`tab-btn${tab === t.id ? ' active' : ''}`}
              data-testid={`settings-tab-${t.id}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="tab-content" data-testid={`settings-scope-content-${scope}`}>
          {tab === 'general' && generalTab}
          {tab === 'appearance' && appearanceTab}
          {tab === 'editor' && editorTab}
          {/* Issue #183 §1: members, roles, then the danger zone — the
              sections PRD 007 Req 12 used to append to the General tab. */}
          {tab === 'people' && workspaceLifecycle && (
            <WorkspacePeopleTab lifecycle={workspaceLifecycle} access={wsAccess} />
          )}
          {tab === 'hotkeys' && scope === 'user' && hotkeysTab}
          {tab === 'llm' && scope === 'user' && llmTab}
          {tab === 'experimental' && scope === 'user' && experimentalTab}
          {doneButton}
        </div>
      </div>
    </div>
  );

  // SPEC13 §1.3: in an aux window the OS chrome is the close affordance.
  if (frameless) return body;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {body}
    </div>
  );
}
