import { describe, expect, test } from 'vitest';
import { buildAuxInit, mergeSettingsEdit, settingsEqual } from '../../src/lib/auxProtocol';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';
import type { Theme } from '../../src/lib/themes';

const theme: Theme = { id: 'crisp', name: 'Crisp', author: 'mm', variant: 'light', builtin: true, css: '.theme-root{}' };

describe('SPEC13 aux protocol', () => {
  test('U23: buildAuxInit carries settings, themes, isMac, and version', () => {
    const init = buildAuxInit({ settings: DEFAULT_SETTINGS, themes: [theme], isMac: true, version: '9.9.9' });
    expect(init.settings).toEqual(DEFAULT_SETTINGS);
    expect(init.themes).toEqual([theme]);
    expect(init.isMac).toBe(true);
    expect(init.version).toBe('9.9.9');
  });

  test('U24: merging an edit preserves panel-unedited keys; a re-applied broadcast is a no-op (no echo)', () => {
    // The panel edited zoom on top of a stale snapshot; meanwhile the main
    // window's split drag moved splitRatio. The merge must keep the drag.
    const canonical = { ...DEFAULT_SETTINGS, splitRatio: 0.7 };
    const staleEdit = { ...DEFAULT_SETTINGS, zoom: 125, splitRatio: 0.5 };
    const merged = mergeSettingsEdit(canonical, staleEdit);
    expect(merged.zoom).toBe(125);
    expect(merged.splitRatio).toBe(0.7);

    // Applying a received broadcast and merging it back changes nothing —
    // settingsEqual is the guard the settings view uses to not re-emit.
    expect(settingsEqual(mergeSettingsEdit(canonical, canonical), canonical)).toBe(true);
    expect(settingsEqual(canonical, { ...canonical, zoom: 150 })).toBe(false);
    expect(
      settingsEqual(canonical, { ...canonical, hotkeys: { ...canonical.hotkeys, save: 'Mod+Shift+D' } })
    ).toBe(false);
  });
});
