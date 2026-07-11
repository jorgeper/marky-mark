import { DEFAULT_SETTINGS, type Settings } from './settings';
import { DEFAULT_HOTKEYS, type HotkeyMap } from './hotkeys';
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
export const EV_SETTINGS_EDIT = 'mm://settings-edit'; // aux → main, payload Settings
export const EV_AUX_REQUEST = 'mm://aux-request'; // aux → main, payload AuxRequest
export const EV_SETTINGS_CHANGED = 'mm://settings-changed'; // main → aux, payload Settings
export const EV_THEMES_CHANGED = 'mm://themes-changed'; // main → aux, payload Theme[]

export interface AuxInit {
  settings: Settings;
  themes: Theme[];
  isMac: boolean;
  version: string;
}

export type AuxRequest =
  | { req: 'reloadThemes' }
  | { req: 'revealThemesDir' }
  | { req: 'openExternal'; url: string };

/** Everything an aux view needs to render (SPEC13 §3.2). */
export function buildAuxInit(args: AuxInit): AuxInit {
  return { settings: args.settings, themes: args.themes, isMac: args.isMac, version: args.version };
}

/** Keys the settings panel never edits — an edit must not clobber them (§3.5). */
const PANEL_UNEDITED: ReadonlyArray<keyof Settings> = ['splitRatio'];

export function mergeSettingsEdit(canonical: Settings, edit: Settings): Settings {
  const out: Settings = { ...edit, hotkeys: { ...edit.hotkeys } };
  for (const k of PANEL_UNEDITED) {
    (out as Record<keyof Settings, unknown>)[k] = canonical[k];
  }
  return out;
}

/** Field-wise equality — the aux view's no-echo guard (§3.5). */
export function settingsEqual(a: Settings, b: Settings): boolean {
  for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (k === 'hotkeys') continue;
    if (a[k] !== b[k]) return false;
  }
  for (const k of Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>) {
    if (a.hotkeys[k] !== b.hotkeys[k]) return false;
  }
  return true;
}
