import { describe, expect, test } from 'vitest';
import { buildAuxInit, sanitizeSettingsEdit } from '../../src/lib/auxProtocol';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';
import type { Theme } from '../../src/lib/themes';

const theme: Theme = { id: 'crisp', name: 'Crisp', author: 'mm', variant: 'light', builtin: true, css: '.theme-root{}' };

describe('SPEC13 aux protocol', () => {
  test('U23: buildAuxInit carries settings, layers, workspace state, themes, isMac, and version', () => {
    const layers = { workspace: { themeLight: 'monokai' }, user: { zoom: 125 } };
    const init = buildAuxInit({
      settings: DEFAULT_SETTINGS,
      layers,
      workspaceOpen: true,
      themes: [theme],
      isMac: true,
      version: '9.9.9',
    });
    expect(init.settings).toEqual(DEFAULT_SETTINGS);
    expect(init.layers).toEqual(layers);
    expect(init.workspaceOpen).toBe(true);
    expect(init.themes).toEqual([theme]);
    expect(init.isMac).toBe(true);
    expect(init.version).toBe('9.9.9');
  });

  test('U24: sanitizeSettingsEdit keeps known editable keys and drops panel-unedited ones', () => {
    // splitRatio belongs to the main window's split drag — a panel edit
    // must never carry it (PRD 002 §E18 + SPEC13 §3.5).
    const e = sanitizeSettingsEdit({ scope: 'user', patch: { zoom: 125, splitRatio: 0.5, bogus: 1 } });
    expect(e).toEqual({ scope: 'user', patch: { zoom: 125 } });
  });

  test('U24b: a workspace-scoped edit is limited to workspace-eligible keys', () => {
    // Issue #21: any U key (vimNav included) may land as a workspace default,
    // but author (U!), splitEdit (M), and hotkeys never travel to the
    // shareable workspace layer through the panel.
    const e = sanitizeSettingsEdit({
      scope: 'workspace',
      patch: { commentStorage: 'embedded', themeLight: 'monokai', author: 'Eve', vimNav: true, splitEdit: false, hotkeys: {} },
    });
    expect(e).toEqual({
      scope: 'workspace',
      patch: { commentStorage: 'embedded', themeLight: 'monokai', vimNav: true },
    });
  });

  test('U24c: malformed edits sanitize to null', () => {
    expect(sanitizeSettingsEdit(null)).toBeNull();
    expect(sanitizeSettingsEdit({ scope: 'global', patch: { zoom: 125 } })).toBeNull();
    expect(sanitizeSettingsEdit({ scope: 'user', patch: null })).toBeNull();
    expect(sanitizeSettingsEdit({ scope: 'user', patch: { splitRatio: 0.5 } })).toBeNull();
    expect(sanitizeSettingsEdit({ scope: 'workspace', patch: { author: 'Eve' } })).toBeNull();
  });
});
