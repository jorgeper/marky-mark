import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SETTINGS,
  diffSettings,
  resolveSettings,
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

  test('U33: issue #21 — every U key except hotkeys is pinnable; hotkeys stay User-only', () => {
    const uKeys = (Object.keys(SETTINGS_SCOPES) as Array<keyof Settings>).filter((k) => SETTINGS_SCOPES[k] === 'U');
    expect([...WORKSPACE_PINNABLE_KEYS].sort()).toEqual(uKeys.filter((k) => k !== 'hotkeys').sort());
    expect(WORKSPACE_PINNABLE_KEYS).not.toContain('hotkeys');
    expect(WORKSPACE_ELIGIBLE_KEYS).not.toContain('hotkeys');
  });

  test('U576: PRD 011 Req 7 — no LLM key is workspace-editable, and no layer but User supplies one', () => {
    const llmKeys: Array<keyof Settings> = ['llmProvider', 'llmModel', 'llmApiKey', 'llmBaseUrl'];
    for (const k of llmKeys) {
      expect(WORKSPACE_ELIGIBLE_KEYS).not.toContain(k);
      expect(WORKSPACE_PINNABLE_KEYS).not.toContain(k);
      // Shown on the Workspace tab, but the workspace layer cannot supply it.
      expect(settingsRowStatus(k, 'workspace', {}).userOnly).toBe(true);
    }
    // `U!`: a workspace-layer (and global-layer) value never wins resolution —
    // a committed `.marky-workspace` cannot hand a reader someone else's key.
    const planted = { llmApiKey: 'sk-planted', llmProvider: 'openai', llmModel: 'gpt-5', llmBaseUrl: 'https://x/v1' };
    const resolved = resolveSettings({ global: planted, team: planted, workspace: planted, user: {} });
    expect(resolved.llmApiKey).toBe(DEFAULT_SETTINGS.llmApiKey);
    expect(resolved.llmApiKey).toBe('');
    expect(resolved.llmProvider).toBe(DEFAULT_SETTINGS.llmProvider);
    expect(resolved.llmModel).toBe('');
    expect(resolved.llmBaseUrl).toBe('');
    for (const k of llmKeys) expect(winningLayer(k, { workspace: planted, global: planted })).toBe('default');
    // The reader's own User layer is the one that does win.
    expect(resolveSettings({ workspace: planted, user: { llmApiKey: 'sk-mine' } }).llmApiKey).toBe('sk-mine');
    expect(winningLayer('llmApiKey', { workspace: planted, user: { llmApiKey: 'sk-mine' } })).toBe('user');
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
      userOnly: false,
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
      userOnly: false,
    });
    const st = settingsRowStatus('commentStorage', 'user', { workspace: { commentStorage: 'embedded' } });
    expect(st.workspaceControlled).toBe(true);
    expect(st.overriddenBy).toBe('workspace');
  });

  test('U34: issue #21 — M/U! keys viewed in Workspace scope read as user-only (shown but locked)', () => {
    expect(settingsRowStatus('splitEdit', 'workspace', {}).userOnly).toBe(true);
    expect(settingsRowStatus('author', 'workspace', {}).userOnly).toBe(true);
    // Workspace-eligible keys (U and W) are editable there…
    expect(settingsRowStatus('lineNumbers', 'workspace', {}).userOnly).toBe(false);
    expect(settingsRowStatus('commentStorage', 'workspace', {}).userOnly).toBe(false);
    // …and nothing is user-only on the User tab.
    expect(settingsRowStatus('splitEdit', 'user', {}).userOnly).toBe(false);
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
