import { type ReactNode, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  diffSettings,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LAYER_LABELS,
  mergePendingEdit,
  NO_PENDING_EDITS,
  overlayPendingLayers,
  overlayPendingSettings,
  PANE_MIN_WIDTH_MAX,
  PANE_MIN_WIDTH_MIN,
  pendingIsDirty,
  pendingScopePatches,
  settingsRowStatus,
  ZOOM_LEVELS,
  type Margins,
  type PendingSettingsEdits,
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
  SMART_EDIT_NAME,
  type HotkeyMap,
} from '@marky-mark/editor';
import { expandImageName, isValidImageFolder } from '../lib/imagePaste';
import { LlmSettings } from './LlmSettings';
import { NO_LLM_CAPABILITIES, type LlmCapabilities, type LlmTestResult } from '../lib/llmSettings';
import type { SummaryCacheClearResult, SummaryCacheSizeResult } from '../lib/summaryCacheReport';
import type { DeploymentAdmin } from '../platform/hostedAdmin';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import type { SessionMe } from '../lib/deploymentSettings';
import { useWorkspaceAccess, WorkspaceSettingsTab } from './WorkspaceAccessSettings';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { SectionHeader } from './ui/SectionHeader';

/**
 * Issue #246: what a host window needs to close a Settings dialog politely —
 * whether closing would lose work, and the Cancel path to run instead.
 */
export interface SettingsCloseIntent {
  /** True while there are pending edits that closing would discard. */
  dirty: boolean;
  /** Run the Cancel path: confirm when dirty, close immediately otherwise. */
  request(): void;
}

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
  /**
   * PRD 013 Req 13 (issue #258): the file-tab strip's checkbox moved here from
   * the View menu, and rides the same seam the strip does
   * (`platform.multiFileSession`) — the static single-file web build has no
   * strip (Req 14), so it shows no row either.
   */
  fileTabsAvailable: boolean;
  /** §E18: an edit writes ONLY the named layer — never the other one. */
  onEdit(scope: SettingsScopeTab, patch: Partial<Settings>): void;
  onReloadThemes(): void;
  /** Web only: pick a .css file and add it as a user theme. */
  onImportTheme?: () => void | Promise<void>;
  /** Desktop only: reveal the themes folder in the OS file manager. */
  onRevealThemesDir?: () => void | Promise<void>;
  onClose(): void;
  /** SPEC13 §1.3 (issue #246): aux-window mode — no scrim; the footer stays. */
  frameless?: boolean;
  /**
   * Issue #246: the seam a host window closes THROUGH. The aux window's
   * Esc / Mod+W and its OS close guard read `dirty` and call `request()`
   * instead of closing outright, so those routes get the Cancel path's
   * confirmation rather than dropping unsaved edits on the floor.
   */
  closeIntentRef?: React.MutableRefObject<SettingsCloseIntent | null>;
  /** SPEC20 §1: current doc basename (no extension) for the pattern example. */
  docName?: string;
  /**
   * Issue #183 §1 (was PRD 007 Req 12's appended-ReactNode slot): the hosted
   * workspace lifecycle, when the host has one. It feeds the Workspace tab —
   * members, roles and the danger zone — which exists only while a workspace
   * is open and the member holds a permitted section. Absent (desktop, web,
   * aux windows) the tab never renders.
   */
  workspaceLifecycle?: WorkspaceLifecycle;
  /**
   * PRD 017 Req 32: the admin transport and the session's /api/me answer,
   * forwarded to the Workspace tab's invite row. Absent (desktop, web, aux
   * windows, non-admin sessions without the capability) nothing changes.
   */
  deploymentAdmin?: DeploymentAdmin;
  sessionMe?: SessionMe | null;
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
   * PRD 011 Req 22 (amended by issue #247): where to land, so a caller that
   * already knows where the reader is headed — the zoomed view's "configure a
   * provider" route — opens the LLM providers area itself rather than General.
   * `'llm'` now names the nested page under Semantic zoom. Absent keeps the
   * default, so every existing mount point is unchanged.
   */
  initialTab?: SettingsRoute;
  /**
   * Issue #247: whether this host can run the semantic-zoom experiment. A
   * CAPABILITY the window holding the platform forwards, beside
   * `llmCapabilities` and `summaryCacheAvailable` — the row branches on it,
   * never on a flavor. Absent means available, which keeps every mount point
   * that has no platform to ask (the desktop aux window) unchanged.
   */
  semanticZoomAvailable?: boolean;
}

const HOTKEY_LABELS: Record<keyof HotkeyMap, string> = {
  toggleEdit: 'Toggle edit / preview',
  toggleSplit: 'Split edit',
  newFile: 'New file',
  openFile: 'Open file',
  // Issue #158: listed, rebindable and reset-to-default like every row.
  closeFile: 'Close file',
  find: 'Find',
  // SPEC34 §4.1 (issue #258): the row names the pane the View item names.
  toggleFolders: 'Show / hide sidebar',
  // PRD 012 Req 10: listed, rebindable and reset-to-default like every row.
  toggleToc: 'Show / hide table of contents',
  // PRD 014 Req 3: listed, rebindable and reset-to-default like every row.
  searchAllFiles: 'Search all files',
  toggleComments: 'Show / hide comments',
  save: 'Save',
  nextComment: 'Next comment',
  prevComment: 'Previous comment',
  // PRD 023 §12 (issue #286): listed, rebindable and reset-to-default like
  // every row — beside their comment-navigation neighbours, not the Smart
  // Edit format group (they author records, not markdown).
  insertComment: 'Insert comment',
  applyHighlight: 'Highlight (last-used color)',
  toggleWordCount: 'Show / hide word count',
  smartMenu: 'Open Smart Edit menu',
  bold: 'Bold',
  italic: 'Italic',
  strikethrough: 'Strikethrough',
  inlineCode: 'Inline code',
  link: 'Link',
  // SPEC43 §11 (issue #270): listed, rebindable and reset-to-default like
  // every row, in the Smart Edit group beside its Create Link sibling.
  openLink: 'Open link',
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
  // SPEC43 §11 (issue #270): the open-link binding, beside Create Link.
  'openLink',
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

// PRD 011 Req 4 (superseded by issue #247): the LLM providers area is still a
// page of its own — but a SECOND-LEVEL one reached from the experiment it
// serves, not a top-level tab beside General, Editor or Appearance.
type SettingsTab = 'appearance' | 'general' | 'editor' | 'workspace' | 'hotkeys' | 'experimental';

/**
 * Issue #247: the second-level pages. A nested page is a page opened from a
 * ROW on a tab, drawn in place of the rail + tab content with a breadcrumb
 * saying where the reader is and a Back affordance out. The mechanism is
 * general on purpose: a second experiment gets one by adding a `page`
 * descriptor to its `EXPERIMENTAL_FEATURES` entry and one entry to
 * `pageContent` below — no copy of the markup.
 */
type SettingsPageId = 'llm';

/**
 * PRD 011 Req 22 (amended by issue #247): where a caller that already knows
 * the destination lands. A tab, or a nested page id — `'llm'` still names the
 * LLM providers area, which is now the nested page rather than a tab.
 */
export type SettingsRoute = SettingsTab | SettingsPageId;

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
   * Issue #247: which platform capability decides whether this experiment can
   * be turned on here at all. Named as DATA so the row branches on a
   * capability the panel was handed, never on a flavor test; an entry without
   * one is enableable everywhere.
   */
  capability?: keyof ExperimentalCapabilities;
  /** Issue #247: the one line shown where `capability` is absent. */
  unavailableNote?: string;
  /**
   * Issue #247: the experiment's own settings, as a nested page reached from
   * this row. Data, not markup: a second experiment names its page here.
   */
  page?: { id: SettingsPageId; buttonLabel: string };
  /**
   * PRD 011 Req 3: where an experiment's stored data and credentials are
   * removed. A reader standing the feature down must not have to hunt for the
   * actions, so the row names the page and routes there in one click (the
   * excerpt notice's route to the same tab is the precedent).
   */
  standDown?: { page: SettingsPageId; sentence: string; linkLabel: string };
}> = [
  {
    key: 'semanticZoom',
    testId: 'experimental-semantic-zoom',
    label: 'Semantic zoom',
    description:
      'Adds a level control to the document view that collapses the document through five levels — every heading with a short block, down to the whole document in a paragraph — and back.',
    // Issue #247: summarizing needs an LLM path this host does not have.
    capability: 'semanticZoom',
    unavailableNote: 'Not available in the web version — this feature needs the desktop app.',
    // Issue #247: PRD 011 Req 4's page, now reached through the experiment it
    // serves rather than from the top-level rail.
    page: { id: 'llm', buttonLabel: 'Settings…' },
    standDown: {
      page: 'llm',
      sentence:
        'Turning this off stops every summary but deletes nothing. Your API key and the cached summaries are removed on the LLM providers page, one action each:',
      linkLabel: 'Remove the key or clear the summary cache',
    },
  },
];

/** PRD 011 Req 1: said once, for the whole section. */
const EXPERIMENTAL_WARNING =
  'These features are experiments. They may change, or be removed, in any release.';

/** Issue #21's Hotkeys precedent: User-scope-only tabs. */
const USER_ONLY_TABS: ReadonlyArray<SettingsTab> = ['hotkeys', 'experimental'];

/** Issue #247: the per-experiment capabilities the panel is handed. */
interface ExperimentalCapabilities {
  semanticZoom: boolean;
}

// Issue #21: General leads, and Hotkeys is a User-scope-only tab.
const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  // Issue #183 §1: the workspace tab sits immediately after Editor. It
  // renders only while a hosted workspace is open and the member holds a
  // permitted section (the render-time filter below).
  // Issue #314: labelled "Manage" and shown only while the Workspace scope
  // is selected — it manages the workspace, so it lives under the
  // workspace's scope (reversing #183's "shows in both scopes"). The tab id
  // and the `settings-tab-workspace` test id are unchanged: only the label.
  { id: 'workspace', label: 'Manage' },
  { id: 'hotkeys', label: 'Hotkeys' },
  // Issue #247: no `llm` tab — PRD 011 Req 4's top-level LLM providers tab is
  // superseded; the page is nested under the Semantic zoom experiment it
  // serves (EXPERIMENTAL_FEATURES above).
  // PRD 011 Req 1: the Experimental area is a page of its own, User-scope
  // only — it reads as *the* place experiments live, and it is last.
  { id: 'experimental', label: 'Experimental' },
];

/**
 * Issue #247: the rail label a nested page's breadcrumb leads with. Read off
 * TABS rather than a second list, so renaming a tab renames its breadcrumbs
 * with it.
 */
function tabLabel(id: SettingsTab): string {
  return TABS.find((t) => t.id === id)?.label ?? '';
}

export function SettingsPanel({
  settings: incomingSettings,
  layers: incomingLayers,
  workspaceOpen,
  scopeSelector,
  themes,
  isMac,
  storageLocked,
  autoHideAvailable,
  fileTabsAvailable,
  onEdit,
  onReloadThemes,
  onImportTheme,
  onRevealThemesDir,
  onClose,
  frameless,
  closeIntentRef,
  docName,
  workspaceLifecycle,
  deploymentAdmin,
  sessionMe,
  llmCapabilities,
  onLlmTest,
  summaryCacheAvailable,
  onSummaryCacheSize,
  onSummaryCacheClear,
  initialTab,
  semanticZoomAvailable,
}: Props) {
  // Issue #246: edits are PENDING, not live — every row's edit lands here and
  // nothing reaches `onEdit` (settings.json, the workspace layer, the aux
  // bus) until Save. `settings`/`layers` below are the incoming props with
  // the pending set overlaid, so the rest of the panel reads them unchanged.
  const [pending, setPending] = useState<PendingSettingsEdits>(NO_PENDING_EDITS);
  const dirty = pendingIsDirty(pending);
  const settings = overlayPendingSettings(incomingSettings, incomingLayers, pending);
  const layers = overlayPendingLayers(incomingLayers, pending);
  // Issue #246: Cancel (and Esc, the scrim, the aux window's close routes)
  // asks before discarding pending work; with nothing pending it just closes.
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Issue #247: an `'llm'` route is the nested page under Experimental, so it
  // sets both levels at once — the reader lands on the page with the tab
  // behind it, and Back leads somewhere sensible.
  const [tab, setTab] = useState<SettingsTab>(
    initialTab === 'llm' ? 'experimental' : (initialTab ?? 'general'),
  );
  /**
   * Issue #247: the second-level page on top of `tab`, or null for the tab
   * itself. ONE piece of state for every nested page there will ever be — the
   * descriptor on the row says which page opens, so a second experiment adds
   * data here, not markup.
   */
  const [page, setPage] = useState<SettingsPageId | null>(initialTab === 'llm' ? 'llm' : null);
  /** Issue #247: what each nested page is reached from — its breadcrumb and Back. */
  const pageOwner = EXPERIMENTAL_FEATURES.find((f) => f.page?.id === page);
  const capabilities: ExperimentalCapabilities = {
    // Absent ⇒ available: see the prop's note.
    semanticZoom: semanticZoomAvailable !== false,
  };
  // §E18: which layer this window writes. Without the selector (web) it is
  // permanently 'user'; closing the workspace kicks the view back to User.
  const [scope, setScope] = useState<SettingsScopeTab>('user');
  useEffect(() => {
    if (scope === 'workspace' && (!scopeSelector || !workspaceOpen)) setScope('user');
  }, [scope, scopeSelector, workspaceOpen]);
  // Issue #21: Hotkeys and Experimental are User-only — landing in Workspace
  // scope on one bounces to General, and issue #247's nested pages hang off
  // those tabs, so the bounce closes the page with them.
  useEffect(() => {
    if (scope === 'workspace' && USER_ONLY_TABS.includes(tab)) {
      setTab('general');
      setPage(null);
    }
  }, [scope, tab]);
  // Issue #183 §1: what the Workspace tab may show, loaded once per open
  // workspace; the tab itself appears only when there is something to show.
  const wsAccess = useWorkspaceAccess(workspaceLifecycle);
  // Closing the workspace (or losing the permission) while Workspace is up
  // bounces to General, like the scope machinery above.
  useEffect(() => {
    if (tab === 'workspace' && !wsAccess.workspaceTab) setTab('general');
  }, [tab, wsAccess.workspaceTab]);
  // Issue #314: Manage is Workspace-scope-only — the mirror of the
  // USER_ONLY_TABS bounce above. Landing in User scope while on it (a click
  // on the scope rail, or the automatic reset when the workspace closes or
  // there is no scope selector) bounces to General and closes any nested
  // page with it.
  useEffect(() => {
    if (scope === 'user' && tab === 'workspace') {
      setTab('general');
      setPage(null);
    }
  }, [scope, tab]);
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
    if (Object.keys(patch).length === 0) return;
    // Issue #246: held per scope against the INCOMING settings, so an edit
    // walked back to its original value leaves nothing to save.
    setPending((p) => mergePendingEdit(p, scope, patch, incomingSettings));
  };

  /** Issue #246: flush one `onEdit` per non-empty scope, then close. */
  const save = () => {
    for (const [target, patch] of pendingScopePatches(pending)) onEdit(target, patch);
    onClose();
  };

  /**
   * Issue #246: the Cancel path — shared by the button, Esc, the scrim and
   * the aux window's close routes. Pending work asks first; a clean dialog
   * closes straight away.
   */
  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
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

  /**
   * Issue #246: Esc is a Cancel, not a silent discard — it prompts when there
   * is pending work, and dismisses the prompt itself when one is up. Bubble
   * phase, on purpose: a nested control that owns Esc (the membership
   * picker's dropdown, the hotkey recorder) stops the event first and the
   * dialog stays open. The frameless window routes ITS Esc / Mod+W through
   * `closeIntentRef` instead, so it is handled exactly once. No dep array,
   * like the `closeIntentRef` effect below: the listener must read this
   * render's pending set and prompt state, never a captured stale one.
   */
  useEffect(() => {
    if (frameless) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-hotkey-recorder]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (confirmDiscard) setConfirmDiscard(false);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Issue #246: the host's window-level close routes (the aux window's
  // Esc / Mod+W and, through `registerCloseGuard`, the OS close button) read
  // the live dialog state here — refreshed every render, since an OS close
  // can land between any two of them.
  useEffect(() => {
    if (!closeIntentRef) return;
    closeIntentRef.current = { dirty, request: requestClose };
    return () => {
      closeIntentRef.current = null;
    };
  });

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
          className="field"
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
          className="field"
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
        <Button variant="quiet" size="sm" data-testid="zoom-reset" onClick={() => onChange({ ...settings, zoom: 100 })}>
          Reset to Default
        </Button>
      </div>
      {scopeNote('zoom')}
    </div>
  );

  const themeLightRow = (
    <div className="field">
      <label htmlFor="settings-theme-light">Light theme</label>
      <select
        id="settings-theme-light"
        className="field"
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
        className="field"
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
        className="field"
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
        className="field"
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
        className="field"
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
        className="field"
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

  // Issue #249: Appearance is a FLAT list of rows — font size, zoom, the two
  // theme pickers, the theme actions, margins, the tab strip, pane width — so
  // it has no second-level sections and no header of its own to unify (and no
  // hand-rolled heading style to retire). Rows added here that do form a
  // section take `<SectionHeader>`, never a heading of their own.
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
          <Button variant="quiet" size="sm" data-testid="reload-themes" onClick={onReloadThemes}>
            ↻ Reload themes
          </Button>
          {onRevealThemesDir && (
            <Button variant="quiet" size="sm" data-testid="open-theme-folder" onClick={() => void onRevealThemesDir()}>
              Open Theme Folder
            </Button>
          )}
          {onImportTheme && (
            <Button variant="quiet" size="sm" data-testid="import-theme" onClick={() => void onImportTheme()}>
              + Import theme…
            </Button>
          )}
        </div>
      )}

      {marginsRow}

      {/* PRD 013 Req 13 (issue #258): the tab strip's toggle, moved off the
          View menu. Present only where the strip's seam is — the static web
          build (Req 14) has no strip and gets no row. Takes effect live. */}
      {fileTabsAvailable && (
        <div className="checkbox-row">
          <input
            id="settings-file-tabs"
            type="checkbox"
            data-testid="settings-file-tabs"
            checked={settings.fileTabs}
            onChange={(e) => onChange({ ...settings, fileTabs: e.target.checked })}
          />
          <label htmlFor="settings-file-tabs" style={{ margin: 0, fontWeight: 400 }}>
            Show the file tab strip above the document
          </label>
          {scopeNote('fileTabs')}
        </div>
      )}

      <div className="field">
        <label htmlFor="settings-pane-min">
          Minimum pane width (px) — narrower panes scroll sideways
        </label>
        <input
          id="settings-pane-min"
          type="text"
          className="field"
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
      <SectionHeader>Editor</SectionHeader>
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

      <SectionHeader>Comments</SectionHeader>
      <div className="checkbox-row">
        <input
          id="set-comments-enabled"
          type="checkbox"
          data-testid="set-comments-enabled"
          checked={settings.commentsEnabled}
          onChange={(e) => onChange({ ...settings, commentsEnabled: e.target.checked })}
        />
        <label htmlFor="set-comments-enabled" style={{ margin: 0, fontWeight: 400 }}>
          Enable comments (highlights, panel, and the menu entries)
        </label>
        {scopeNote('commentsEnabled')}
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
          className="field"
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

      {/* Issue #167, amended by issue #258: hides only the corner button. That
          button is now sync scrolling's one toggle — there is no View row and
          no hotkey behind it — so hiding it leaves the persisted state as it
          stands, which is the accepted consequence. */}
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

      <SectionHeader>Navigation</SectionHeader>
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
      <SectionHeader>Syntax</SectionHeader>
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

      <SectionHeader>Tables</SectionHeader>
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

      <SectionHeader>Images</SectionHeader>
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
      <SectionHeader>Code</SectionHeader>
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
      <SectionHeader>Diagrams</SectionHeader>
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

      {/* SPEC43 §11 (issue #270): the rendered-links view, beside its four view kin. */}
      <SectionHeader>Links</SectionHeader>
      <div className="checkbox-row">
        <input
          id="settings-link-view"
          type="checkbox"
          data-testid="settings-link-view"
          checked={settings.linkView}
          onChange={(e) => onChange({ ...settings, linkView: e.target.checked })}
        />
        <label htmlFor="settings-link-view" style={{ margin: 0, fontWeight: 400 }}>
          Show rendered links in the editor
        </label>
        {scopeNote('linkView')}
      </div>

      {/* Issue #318: the edit-pane callout view, beside its five view kin. */}
      <SectionHeader>Callouts</SectionHeader>
      <div className="checkbox-row">
        <input
          id="settings-callout-view"
          type="checkbox"
          data-testid="settings-callout-view"
          checked={settings.calloutView}
          onChange={(e) => onChange({ ...settings, calloutView: e.target.checked })}
        />
        <label htmlFor="settings-callout-view" style={{ margin: 0, fontWeight: 400 }}>
          Show callouts in the editor
        </label>
        {scopeNote('calloutView')}
      </div>
    </>
  );

  const hotkeyRow = (action: keyof HotkeyMap) => (
    <div className="hotkey-row" key={action}>
      <label htmlFor={`hotkey-${action}`}>{HOTKEY_LABELS[action]}</label>
      <input
        id={`hotkey-${action}`}
        type="text"
        className="field"
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
      <IconButton
        data-testid={`reset-hotkey-${action}`}
        title={`Restore default (${displayCombo(DEFAULT_HOTKEYS[action], isMac)})`}
        aria-label={`Restore default for ${HOTKEY_LABELS[action]}`}
        disabled={settings.hotkeys[action] === DEFAULT_HOTKEYS[action]}
        onClick={() => setHotkey(action, DEFAULT_HOTKEYS[action])}
      >
        ↺
      </IconButton>
    </div>
  );

  const hotkeysTab = (
    <>
      {(Object.keys(HOTKEY_LABELS) as Array<keyof HotkeyMap>)
        .filter((a) => !SMART_EDIT_KEYS.includes(a))
        .map(hotkeyRow)}
      {/* SPEC43 §5.3: the Smart Edit group. Issue #249: through the same
          section-header primitive as every other settings section —
          `.hotkey-group` carries only its separating rule now. */}
      <SectionHeader className="hotkey-group" data-testid="hotkey-group-smart-edit">
        {SMART_EDIT_NAME}
      </SectionHeader>
      {SMART_EDIT_KEYS.map(hotkeyRow)}
      <p className="hotkey-hint" data-testid="hotkey-hint">
        {hint || 'Click a field, then press the new key combination.'}
      </p>
      <div className="row">
        <Button variant="quiet" size="sm" data-testid="reset-hotkeys" onClick={() => onChange({ ...settings, hotkeys: { ...DEFAULT_HOTKEYS } })}>
          Reset hotkeys
        </Button>
      </div>
    </>
  );

  // PRD 011 Req 4 (nested by issue #247): the LLM providers page, UNCHANGED —
  // it renders identically from both mount points (the inline panel in
  // App.tsx and the desktop aux window) because everything platform-specific
  // arrives as these props. Only where it is mounted moved.
  const llmPage = (
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

  /**
   * Issue #247: the nested pages, by id. The ONE place a second-level page's
   * content is named — the row descriptor says which id it opens, the header
   * and Back below are shared, so adding a page is an entry here plus a `page`
   * field on the row, never a copy of the nesting markup.
   */
  const pageContent: Record<SettingsPageId, ReactNode> = { llm: llmPage };

  // PRD 011 Req 1: one row per data entry — off by default, each carrying the
  // one line that says what turning it on does.
  const experimentalTab = (
    <>
      <p className="hotkey-hint experimental-warning" data-testid="experimental-warning">
        {EXPERIMENTAL_WARNING}
      </p>
      {EXPERIMENTAL_FEATURES.map((f) => {
        // `page` is the panel's own state below, so the row's descriptor is
        // named apart from it.
        const { page: featurePage, standDown } = f;
        // Issue #247: what this host can do with this experiment, from the
        // capability the panel was handed — never a flavor test here.
        const available = f.capability === undefined || capabilities[f.capability];
        const on = available && settings[f.key] === true;
        return (
          <div className="experimental-row" key={f.key}>
            <div className="checkbox-row">
              <input
                id={f.testId}
                type="checkbox"
                data-testid={f.testId}
                // Issue #247: where the host cannot run it, the row still says
                // the feature exists — but unchecked and unturnable.
                disabled={!available}
                checked={on}
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
            {/* Issue #247: one line saying why the box is dead here. */}
            {!available && f.unavailableNote && (
              <p className="hotkey-hint experimental-desc" data-testid={`${f.testId}-unavailable`}>
                {f.unavailableNote}
              </p>
            )}
            {/* Issue #247: the experiment's own settings, one level down. Live
                only while the experiment is on — so it is dead with the box
                unchecked, and dead where the host cannot run it at all. */}
            {featurePage && (
              <p className="experimental-desc experimental-page-row">
                <Button
                  size="sm"
                  data-testid={`${f.testId}-settings`}
                  disabled={!on}
                  title={on ? undefined : `Turn ${f.label} on to change its settings`}
                  onClick={() => setPage(featurePage.id)}
                >
                  {featurePage.buttonLabel}
                </Button>
              </p>
            )}
            {/* PRD 011 Req 3: standing down is OFFERED, never imposed — the row
                says the switch deletes nothing and routes to where it is done.
                Issue #247: the route is the nested page, and this link stays
                live whatever the box says — a reader who has JUST unchecked the
                experiment must still reach Remove key and Clear the cache. It
                is pointless where the host never ran the feature, so a row the
                capability turned off shows the note instead. */}
            {standDown && available && (
              <p className="hotkey-hint experimental-desc" data-testid={`${f.testId}-stand-down`}>
                {standDown.sentence}{' '}
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid={`${f.testId}-stand-down-link`}
                  onClick={() => setPage(standDown.page)}
                >
                  {standDown.linkLabel}
                </Button>
              </p>
            )}
          </div>
        );
      })}
    </>
  );

  /**
   * Issue #246: the pinned action footer — a SIBLING of the scrolling
   * `.tab-content`, so it is on screen on every tab and in both scopes
   * (frameless included: the aux window no longer leans on OS chrome alone).
   * With a discard pending it becomes the confirmation, in place.
   */
  const footer = (
    <div className="dialog-actions settings-actions" data-testid="settings-actions">
      {confirmDiscard ? (
        <>
          <span className="settings-discard-prompt" data-testid="settings-discard-prompt">
            Discard your unsaved settings changes?
          </span>
          <Button data-testid="settings-discard-cancel" onClick={() => setConfirmDiscard(false)}>
            Keep editing
          </Button>
          <Button variant="danger" data-testid="settings-discard-confirm" onClick={onClose}>
            Discard
          </Button>
        </>
      ) : (
        <>
          <Button data-testid="settings-cancel" onClick={requestClose}>
            Cancel
          </Button>
          <Button variant="primary" data-testid="settings-save" onClick={save}>
            Save
          </Button>
        </>
      )}
    </div>
  );

  /**
   * Issue #247: a second-level page in place of the rail + tab content — a
   * breadcrumb saying where the reader is and the Back affordance out of it.
   * The markup is shared by every nested page there will be; `pageContent`
   * above is the only place a page says what it draws.
   */
  const nestedBody =
    page && pageOwner ? (
      <div className="settings-body settings-nested">
        <header className="settings-page-header">
          <Button
            variant="quiet"
            size="sm"
            data-testid="settings-page-back"
            onClick={() => setPage(null)}
          >
            ‹ Back
          </Button>
          <span className="settings-page-crumb" data-testid="settings-page-crumb">
            {tabLabel(tab)} › {pageOwner.label}
          </span>
        </header>
        <div className="tab-content" data-testid={`settings-page-${page}`}>
          {pageContent[page]}
        </div>
      </div>
    ) : null;

  /** The tab rail and the tab it is on — the first level, unchanged. */
  const tabsBody = (
    <div className="settings-body">
      {/* Issue #21: both scopes share one tab rail; Hotkeys is User-only. */}
      <nav className="tab-rail" data-testid="settings-tabs">
        {TABS.filter(
          (t) =>
            (scope === 'user' || !USER_ONLY_TABS.includes(t.id)) &&
            // Issue #183 §1: no workspace open, or no permitted section —
            // no Manage tab (and no placeholder in its place).
            // Issue #314: and only under the Workspace scope — in User scope
            // it is absent, not disabled.
            (t.id !== 'workspace' || (scope === 'workspace' && wsAccess.workspaceTab)),
        ).map((t) => (
          <button
            key={t.id}
            className={`btn btn-quiet tab-btn${tab === t.id ? ' on' : ''}`}
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
        {/* Issue #183 §1: the sections PRD 007 Req 12 used to append to
            the General tab — members, roles, then the danger zone, with
            PRD 020 Req 4's names section ahead of them. */}
        {tab === 'workspace' && workspaceLifecycle && (
          <WorkspaceSettingsTab
            lifecycle={workspaceLifecycle}
            access={wsAccess}
            admin={deploymentAdmin}
            me={sessionMe}
          />
        )}
        {tab === 'hotkeys' && scope === 'user' && hotkeysTab}
        {tab === 'experimental' && scope === 'user' && experimentalTab}
      </div>
    </div>
  );

  const body = (
    <div className="dialog settings-modal" data-testid="settings-panel">
      {/* §E18/§H25: the User | Workspace scope selector — desktop only. */}
      {scopeSelector && (
        <nav className="scope-rail" data-testid="settings-scope">
          <button
            className={`btn btn-quiet tab-btn scope-btn${scope === 'user' ? ' on' : ''}`}
            data-testid="settings-scope-user"
            onClick={() => setScope('user')}
          >
            User
          </button>
          <button
            className={`btn btn-quiet tab-btn scope-btn${scope === 'workspace' ? ' on' : ''}`}
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
      {/* Issue #247: a nested page takes the whole body, so the rail and the
          tab content give way to it — but the pinned footer below still
          governs BOTH levels (Save commits edits made on the page with the
          rest, Cancel discards them). */}
      {nestedBody ?? tabsBody}
      {footer}
    </div>
  );

  // SPEC13 §1.3 (superseded in part by issue #246): an aux window still has
  // no scrim — but it now carries the same Save / Cancel footer as the
  // overlay, and its OS close routes come back through `closeIntentRef`.
  if (frameless) return body;
  // Issue #246: a scrim mousedown is a Cancel, prompt and all.
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      {body}
    </div>
  );
}
