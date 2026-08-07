import {
  SETTINGS_SCOPES,
  WORKSPACE_ELIGIBLE_KEYS,
  type Settings,
  type SettingsLayers,
  type SettingsScopeTab,
} from './settings';
import type { Theme } from './themes';
import type { LlmCapabilities, LlmTestResult } from './llmSettings';
import type { LlmFailureKind } from './llmSeam';

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
/**
 * PRD 011 Req 10: main → aux, payload {@link LlmTestResult}. The aux settings
 * window holds no LLM capability of its own — it asks for a test over
 * {@link EV_AUX_REQUEST} and renders whatever comes back here.
 */
export const EV_LLM_TEST_RESULT = 'mm://llm-test-result';

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
  /**
   * PRD 011 Req 9: what the MAIN window's platform can do about LLM requests.
   * The aux window has no platform capabilities of its own, so availability is
   * told to it rather than discovered — and it still branches on capabilities,
   * never on a flavor.
   */
  llm: LlmCapabilities;
}

/** An aux settings edit: which layer to write, and only the changed keys. */
export interface SettingsEdit {
  scope: SettingsScopeTab;
  patch: Partial<Settings>;
}

export type AuxRequest =
  | { req: 'reloadThemes' }
  | { req: 'revealThemesDir' }
  | { req: 'openExternal'; url: string }
  /**
   * PRD 011 Req 10: "test the connection". It carries NO configuration and no
   * credential — the main window already owns the settings, so it resolves the
   * active provider itself and nothing sensitive crosses the bus in either
   * direction.
   */
  | { req: 'llmTestConnection' };

/** Everything an aux view needs to render (SPEC13 §3.2). */
export function buildAuxInit(args: AuxInit): AuxInit {
  return {
    settings: args.settings,
    layers: args.layers,
    workspaceOpen: args.workspaceOpen,
    themes: args.themes,
    isMac: args.isMac,
    version: args.version,
    llm: args.llm,
  };
}

/**
 * SPEC13 §3.5 + PRD 011 Req 10: an incoming aux request, validated rather than
 * trusted. Same precedent as {@link sanitizeSettingsEdit} — an unknown `req`,
 * a missing url, or a non-object payload is refused, so a malformed event
 * cannot reach a handler.
 */
export function sanitizeAuxRequest(raw: unknown): AuxRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { req, url } = raw as { req?: unknown; url?: unknown };
  if (req === 'reloadThemes' || req === 'revealThemesDir' || req === 'llmTestConnection') return { req };
  if (req === 'openExternal' && typeof url === 'string' && url) return { req, url };
  return null;
}

/**
 * PRD 011 Req 10: the failure kinds as values, keyed by the seam's own union so
 * adding a kind fails the typecheck until it is named here (the `TRIGGERS`
 * precedent in `llmDeployment.ts`).
 */
const FAILURE_KINDS: Record<LlmFailureKind, true> = {
  'bad-key': true,
  'unknown-model': true,
  'unreachable-host': true,
  'rate-limited': true,
  'invalid-config': true,
  unexpected: true,
};

/**
 * PRD 011 Req 10: a test-connection result read back off the bus. Every field
 * is checked — a failure with an unknown kind or no sentence is refused rather
 * than rendered — and only the fields the area shows are carried through, so
 * nothing extra a sender attached rides along.
 */
export function sanitizeLlmTestResult(raw: unknown): LlmTestResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { ok, failure } = raw as { ok?: unknown; failure?: unknown };
  if (ok === true) return { ok: true };
  if (ok !== false || typeof failure !== 'object' || failure === null) return null;
  const f = failure as { kind?: unknown; message?: unknown; retryAfterSeconds?: unknown };
  if (typeof f.kind !== 'string' || !Object.hasOwn(FAILURE_KINDS, f.kind)) return null;
  if (typeof f.message !== 'string' || !f.message) return null;
  const retry = f.retryAfterSeconds;
  return {
    ok: false,
    failure: {
      kind: f.kind as LlmFailureKind,
      message: f.message,
      ...(typeof retry === 'number' && Number.isFinite(retry) ? { retryAfterSeconds: retry } : {}),
    },
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
    const key = k as keyof Settings;
    if (PANEL_UNEDITED.includes(key)) continue;
    if (scope === 'workspace' && !WORKSPACE_ELIGIBLE_KEYS.includes(key)) continue;
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? { scope, patch: out as Partial<Settings> } : null;
}
