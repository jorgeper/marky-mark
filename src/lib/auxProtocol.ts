import {
  SETTINGS_SCOPES,
  WORKSPACE_ELIGIBLE_KEYS,
  type Settings,
  type SettingsLayers,
  type SettingsScopeTab,
} from './settings';
import type { Theme } from './themes';

/**
 * SPEC13 §3: the event protocol between the main window (sole owner of
 * settings state, persistence, themes, and command handlers) and the aux
 * windows (dumb views). Pure — no Tauri or DOM imports; the platform layer
 * carries these events over Tauri events (desktop) or BroadcastChannel
 * (dev shim).
 */

export type AuxKind = 'settings' | 'about';

export const EV_AUX_READY = 'mm://aux-ready'; // aux → main, payload { kind: AuxKind }
export const EV_AUX_INIT = 'mm://aux-init'; // main → aux, payload AuxInit
export const EV_SETTINGS_EDIT = 'mm://settings-edit'; // aux → main, payload SettingsEdit
export const EV_AUX_REQUEST = 'mm://aux-request'; // aux → main, payload AuxRequest
export const EV_SETTINGS_CHANGED = 'mm://settings-changed'; // main → aux, payload SettingsBroadcast
export const EV_THEMES_CHANGED = 'mm://themes-changed'; // main → aux, payload Theme[]

/** PRD 002 §E18–§E19: the per-layer data the settings panel renders from. */
export interface SettingsBroadcast {
  /** The effective (resolved) settings — what every row displays. */
  settings: Settings;
  /** The raw layer inputs, for override indicators and scope routing. */
  layers: SettingsLayers;
  /** `Workspace.kind !== 'none'` — enables the Workspace scope tab. */
  workspaceOpen: boolean;
}

export interface AuxInit extends SettingsBroadcast {
  themes: Theme[];
  isMac: boolean;
  version: string;
}

/** An aux settings edit: which layer to write, and only the changed keys. */
export interface SettingsEdit {
  scope: SettingsScopeTab;
  patch: Partial<Settings>;
}

export type AuxRequest =
  | { req: 'reloadThemes' }
  | { req: 'revealThemesDir' }
  | { req: 'openExternal'; url: string };

/** Everything an aux view needs to render (SPEC13 §3.2). */
export function buildAuxInit(args: AuxInit): AuxInit {
  return {
    settings: args.settings,
    layers: args.layers,
    workspaceOpen: args.workspaceOpen,
    themes: args.themes,
    isMac: args.isMac,
    version: args.version,
  };
}

/** Keys the settings panel never edits — an edit must not clobber them (§3.5). */
const PANEL_UNEDITED: ReadonlyArray<keyof Settings> = ['splitRatio'];

/**
 * Validate an incoming aux edit (§3.5): known keys only, panel-unedited keys
 * dropped, and a workspace-scoped patch limited to workspace-eligible keys.
 * Null when nothing valid remains — the main window applies nothing.
 */
export function sanitizeSettingsEdit(raw: unknown): SettingsEdit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { scope, patch } = raw as { scope?: unknown; patch?: unknown };
  if (scope !== 'user' && scope !== 'workspace') return null;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in SETTINGS_SCOPES)) continue;
    if ((PANEL_UNEDITED as ReadonlyArray<string>).includes(k)) continue;
    if (scope === 'workspace' && !(WORKSPACE_ELIGIBLE_KEYS as ReadonlyArray<string>).includes(k)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? { scope, patch: out as Partial<Settings> } : null;
}
