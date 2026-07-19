import { useState } from 'react';
import { DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, PANE_MIN_WIDTH_MAX, PANE_MIN_WIDTH_MIN, ZOOM_LEVELS, type Margins, type Settings } from '../lib/settings';
import type { Theme } from '../lib/themes';
import { comboFromEvent, DEFAULT_HOTKEYS, displayCombo, type HotkeyMap } from '../lib/hotkeys';
import { SMART_EDIT_NAME } from '../lib/smartEdit';
import { expandImageName, isValidImageFolder } from '../lib/imagePaste';

interface Props {
  settings: Settings;
  themes: Theme[];
  isMac: boolean;
  /** Web build: comments are always embedded; the storage control locks. */
  storageLocked: boolean;
  /** SPEC12 §4.1: desktop has no toolbar, so the auto-hide option hides too. */
  autoHideAvailable: boolean;
  onChange(next: Settings): void;
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
}

const HOTKEY_LABELS: Record<keyof HotkeyMap, string> = {
  toggleEdit: 'Toggle edit / preview',
  toggleSplit: 'Split edit',
  newFile: 'New file',
  openFile: 'Open file',
  find: 'Find',
  toggleFolders: 'Show / hide folders',
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

type SettingsTab = 'appearance' | 'general' | 'editor' | 'hotkeys';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'hotkeys', label: 'Hotkeys' },
];

export function SettingsPanel({
  settings,
  themes,
  isMac,
  storageLocked,
  autoHideAvailable,
  onChange,
  onReloadThemes,
  onImportTheme,
  onRevealThemesDir,
  onClose,
  frameless,
  docName,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>('appearance');
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
  const commitPaneMin = () => {
    const n = Math.round(Number(paneMinDraft));
    const clamped = Number.isFinite(n)
      ? Math.min(PANE_MIN_WIDTH_MAX, Math.max(PANE_MIN_WIDTH_MIN, n))
      : settings.paneMinWidth;
    setPaneMinDraft(String(clamped));
    if (clamped !== settings.paneMinWidth) onChange({ ...settings, paneMinWidth: clamped });
  };

  const recordHotkey = (action: keyof HotkeyMap) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      (e.target as HTMLInputElement).blur();
      return;
    }
    const combo = comboFromEvent(e);
    if (!combo) return; // modifier only — keep recording
    const conflict = (Object.keys(settings.hotkeys) as Array<keyof HotkeyMap>).find(
      (k) => k !== action && settings.hotkeys[k] === combo
    );
    if (conflict) {
      setHint(`${displayCombo(combo, isMac)} is already bound to “${HOTKEY_LABELS[conflict]}”`);
      return;
    }
    setHint('');
    onChange({ ...settings, hotkeys: { ...settings.hotkeys, [action]: combo } });
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

  const appearanceTab = (
    <>
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
      </div>

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
      </div>

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
      </div>

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
      </div>

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
      </div>

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
      </div>

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
      </div>
    </>
  );

  const generalTab = (
    <>
      <h3 className="tab-section">Editor</h3>
      <div className="checkbox-row">
        <input
          id="settings-line-numbers"
          type="checkbox"
          data-testid="settings-line-numbers"
          checked={settings.lineNumbers}
          onChange={(e) => onChange({ ...settings, lineNumbers: e.target.checked })}
        />
        <label htmlFor="settings-line-numbers" style={{ margin: 0, fontWeight: 400 }}>
          Show line numbers
        </label>
      </div>

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
      </div>

      <div className="checkbox-row">
        <input
          id="set-split-edit"
          type="checkbox"
          data-testid="set-split-edit"
          checked={settings.splitEdit}
          onChange={(e) => onChange({ ...settings, splitEdit: e.target.checked })}
        />
        <label htmlFor="set-split-edit" style={{ margin: 0, fontWeight: 400 }}>
          Edit side by side with a live preview (instead of a full-screen swap)
        </label>
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
      </div>

      <div className="field">
        <label htmlFor="author-input">Comment author name</label>
        <input
          id="author-input"
          type="text"
          data-testid="author-input"
          value={settings.author}
          onChange={(e) => onChange({ ...settings, author: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="comment-storage">Comment storage</label>
        <select
          id="comment-storage"
          data-testid="comment-storage"
          value={settings.commentStorage}
          disabled={storageLocked}
          onChange={(e) =>
            onChange({ ...settings, commentStorage: e.target.value === 'embedded' ? 'embedded' : 'sidecar' })
          }
        >
          <option value="sidecar">Sidecar file (name.md.comments.json)</option>
          <option value="embedded">Embedded in the markdown file (invisible)</option>
        </select>
        {storageLocked && <p className="hotkey-hint">The web version always embeds comments in the file.</p>}
      </div>

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
        </div>
      )}

      <div className="checkbox-row">
        <input
          id="settings-reopen"
          type="checkbox"
          data-testid="settings-reopen"
          checked={settings.reopenLastDoc}
          onChange={(e) => onChange({ ...settings, reopenLastDoc: e.target.checked })}
        />
        <label htmlFor="settings-reopen" style={{ margin: 0, fontWeight: 400 }}>
          Reopen last document on launch
        </label>
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
      </div>
    </>
  );

  const patternExample = expandImageName(
    settings.imageNamePattern || DEFAULT_SETTINGS.imageNamePattern,
    'png',
    { docName: docName || 'document', now: new Date(), exists: () => false }
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
      </div>
      <div className="field">
        <label htmlFor="image-folder">Folder for pasted images (created next to the document)</label>
        <input
          id="image-folder"
          type="text"
          data-testid="image-folder"
          value={folderDraft}
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
      </div>
      <div className="field">
        <label htmlFor="image-pattern">File name for pasted images</label>
        <input
          id="image-pattern"
          type="text"
          data-testid="image-pattern"
          value={settings.imageNamePattern}
          onChange={(e) => onChange({ ...settings, imageNamePattern: e.target.value })}
        />
        <p className="hotkey-hint" data-testid="image-pattern-example">
          {'Example: '}
          {patternExample}
          {' — tokens: {doc} (document name), {n} (next free number), {date}, {time}.'}
        </p>
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

  const body = (
    <div className="modal settings-modal" data-testid="settings-panel">
      <nav className="tab-rail" data-testid="settings-tabs">
        {TABS.map((t) => (
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
      <div className="tab-content">
        {tab === 'appearance' && appearanceTab}
        {tab === 'general' && generalTab}
        {tab === 'editor' && editorTab}
        {tab === 'hotkeys' && hotkeysTab}
        {!frameless && (
          <div className="actions">
            <button className="primary" data-testid="settings-close" onClick={onClose}>
              Done
            </button>
          </div>
        )}
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
