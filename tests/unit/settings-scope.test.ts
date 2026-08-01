import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SETTINGS,
  diffSettings,
  SETTINGS_SCOPES,
  settingsRowStatus,
  winningLayer,
  WORKSPACE_ELIGIBLE_KEYS,
  WORKSPACE_PINNABLE_KEYS,
  type Settings,
} from '../../src/lib/settings';

describe('PRD 002 §E18 workspace-eligible keys', () => {
  test('U25: the eligible list is exactly the W keys plus the curated pinnable subset', () => {
    const wKeys = (Object.keys(SETTINGS_SCOPES) as Array<keyof Settings>).filter((k) => SETTINGS_SCOPES[k] === 'W');
    for (const k of wKeys) expect(WORKSPACE_ELIGIBLE_KEYS).toContain(k);
    for (const k of WORKSPACE_PINNABLE_KEYS) expect(WORKSPACE_ELIGIBLE_KEYS).toContain(k);
    expect(WORKSPACE_ELIGIBLE_KEYS.length).toBe(wKeys.length + WORKSPACE_PINNABLE_KEYS.length);
  });

  test('U26: no M- or U!-scoped key is workspace-eligible; pinnable keys are all U-scoped', () => {
    for (const k of WORKSPACE_ELIGIBLE_KEYS) {
      expect(['U', 'W']).toContain(SETTINGS_SCOPES[k]);
    }
    for (const k of WORKSPACE_PINNABLE_KEYS) expect(SETTINGS_SCOPES[k]).toBe('U');
  });
});

describe('PRD 002 §E19 winning layer / override indicators', () => {
  test('U27: winningLayer walks each scope chain and falls back to default', () => {
    // U key: a valid User value beats a workspace pin…
    expect(winningLayer('themeLight', { workspace: { themeLight: 'monokai' }, user: { themeLight: 'crisp' } })).toBe(
      'user'
    );
    // …no user value → the pin wins; nothing anywhere → default.
    expect(winningLayer('themeLight', { workspace: { themeLight: 'monokai' }, user: {} })).toBe('workspace');
    expect(winningLayer('themeLight', {})).toBe('default');
    // W key: the User layer is never a candidate (§B5).
    expect(winningLayer('commentStorage', { user: { commentStorage: 'embedded' } })).toBe('default');
    expect(
      winningLayer('commentStorage', { global: { commentStorage: 'embedded' }, user: { commentStorage: 'sidecar' } })
    ).toBe('global');
    // Invalid values fall through to the next layer down.
    expect(
      winningLayer('themeLight', { workspace: { themeLight: 42 }, global: { themeLight: 'one-dark' } })
    ).toBe('global');
  });

  test('U28: a workspace-pinned theme reads as overridden-by-Workspace on the User tab', () => {
    const layers = { workspace: { themeLight: 'monokai' }, user: {} };
    expect(settingsRowStatus('themeLight', 'user', layers)).toEqual({
      winner: 'workspace',
      overriddenBy: 'workspace',
      workspaceControlled: false,
    });
    // Once the user sets their own value, the indicator clears.
    expect(settingsRowStatus('themeLight', 'user', { ...layers, user: { themeLight: 'crisp' } }).overriddenBy).toBeNull();
  });

  test('U29: a User value reads as overridden-by-User on the Workspace tab', () => {
    const layers = { workspace: { themeLight: 'monokai' }, user: { themeLight: 'crisp' } };
    expect(settingsRowStatus('themeLight', 'workspace', layers).overriddenBy).toBe('user');
    // The workspace's own value with no user override carries no indicator.
    expect(settingsRowStatus('themeLight', 'workspace', { workspace: { themeLight: 'monokai' } }).overriddenBy).toBeNull();
  });

  test('U30: W keys on the User tab are workspace-controlled and name the supplying layer', () => {
    expect(settingsRowStatus('commentStorage', 'user', {})).toEqual({
      winner: 'default',
      overriddenBy: null,
      workspaceControlled: true,
    });
    const st = settingsRowStatus('commentStorage', 'user', { workspace: { commentStorage: 'embedded' } });
    expect(st.workspaceControlled).toBe(true);
    expect(st.overriddenBy).toBe('workspace');
  });

  test('U31: §E20 Global/Team contributions surface as effective values with the layer named', () => {
    const layers = { global: { fontSize: 18 }, team: { margins: 'wide' } };
    expect(settingsRowStatus('fontSize', 'user', layers)).toMatchObject({ winner: 'global', overriddenBy: 'global' });
    expect(settingsRowStatus('margins', 'workspace', layers)).toMatchObject({ winner: 'team', overriddenBy: 'team' });
  });
});

describe('diffSettings', () => {
  test('U32: only changed keys travel; hotkeys compare entry-wise', () => {
    const next = { ...DEFAULT_SETTINGS, zoom: 125 };
    expect(diffSettings(DEFAULT_SETTINGS, next)).toEqual({ zoom: 125 });
    // A rebuilt-but-identical hotkeys map is no change at all.
    expect(diffSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_SETTINGS.hotkeys } })).toEqual({});
    const rebound = { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_SETTINGS.hotkeys, save: 'Mod+Shift+D' } };
    expect(diffSettings(DEFAULT_SETTINGS, rebound)).toEqual({ hotkeys: rebound.hotkeys });
  });
});
