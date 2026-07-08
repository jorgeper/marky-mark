import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, MARGIN_WIDTHS, parseSettings, serializeSettings } from '../../src/lib/settings';

describe('v3 settings', () => {
  test('U13: new fields parse with defaults, invalid values fall back, legacy `theme` migrates to themeLight', () => {
    // Empty/malformed input → full defaults.
    const d = parseSettings('{}');
    expect(d.themeLight).toBe('crisp');
    expect(d.themeDark).toBe('one-dark');
    expect(d.useDarkTheme).toBe(true);
    expect(d.fontSize).toBe('auto');
    expect(d.zoom).toBe(100);
    expect(d.margins).toBe('default');
    expect(d.lineNumbers).toBe(true);
    expect(d.vimNav).toBe(false);
    expect(parseSettings('not json')).toEqual({ ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_SETTINGS.hotkeys } });

    // Legacy v1/v2 file: single `theme` key migrates to themeLight.
    const legacy = parseSettings('{"theme":"monokai","author":"Jorge"}');
    expect(legacy.themeLight).toBe('monokai');
    expect(legacy.themeDark).toBe('one-dark');
    expect(legacy.author).toBe('Jorge');

    // An explicit themeLight wins over a stale legacy key.
    expect(parseSettings('{"theme":"monokai","themeLight":"nord"}').themeLight).toBe('nord');

    // Valid custom values round-trip through serialize → parse.
    const custom = parseSettings(
      serializeSettings({
        ...DEFAULT_SETTINGS,
        themeLight: 'claude',
        themeDark: 'dracula',
        useDarkTheme: false,
        fontSize: 20,
        zoom: 150,
        margins: 'wide',
        lineNumbers: false,
        vimNav: true,
      })
    );
    expect(custom.themeLight).toBe('claude');
    expect(custom.themeDark).toBe('dracula');
    expect(custom.useDarkTheme).toBe(false);
    expect(custom.fontSize).toBe(20);
    expect(custom.zoom).toBe(150);
    expect(custom.margins).toBe('wide');
    expect(custom.lineNumbers).toBe(false);
    expect(custom.vimNav).toBe(true);

    // Out-of-range / unknown values fall back.
    expect(parseSettings('{"fontSize":8}').fontSize).toBe('auto'); // below min 10
    expect(parseSettings('{"fontSize":99}').fontSize).toBe('auto'); // above max 32
    expect(parseSettings('{"fontSize":"big"}').fontSize).toBe('auto');
    expect(parseSettings('{"zoom":137}').zoom).toBe(100); // not a preset level
    expect(parseSettings('{"margins":"gigantic"}').margins).toBe('default');
    // SPEC4 §7: super-narrow is a valid preset with a wider column than narrow.
    expect(parseSettings('{"margins":"super-narrow"}').margins).toBe('super-narrow');
    expect(MARGIN_WIDTHS['super-narrow']).toBe('76rem');
    expect(parseFloat(MARGIN_WIDTHS['super-narrow'])).toBeGreaterThan(parseFloat(MARGIN_WIDTHS.narrow));
    // SPEC5 §2: the toolbar does NOT auto-hide unless explicitly enabled.
    expect(parseSettings('{}').autoHideToolbar).toBe(false);
    expect(parseSettings('{"autoHideToolbar":true}').autoHideToolbar).toBe(true);
    expect(parseSettings('{"autoHideToolbar":"yes"}').autoHideToolbar).toBe(false);
    // SPEC7 §4: ghosted resolved comments are shown by default (opt-out).
    expect(parseSettings('{}').showResolved).toBe(true);
    expect(parseSettings('{"showResolved":true}').showResolved).toBe(true);
    expect(parseSettings('{"lineNumbers":"yes"}').lineNumbers).toBe(true);
  });
});

describe('v7 settings', () => {
  test('U15: comment controls and split-edit fields parse with defaults; malformed values fall back', () => {
    // Defaults (SPEC7): comments on, type-to-comment on, split off, ratio 0.5.
    const d = parseSettings('{}');
    expect(d.commentsEnabled).toBe(true);
    expect(d.typeToComment).toBe(true);
    expect(d.splitEdit).toBe(false);
    expect(d.splitRatio).toBe(0.5);

    // Explicit values round-trip through serialize → parse.
    const custom = parseSettings(
      serializeSettings({
        ...DEFAULT_SETTINGS,
        commentsEnabled: false,
        typeToComment: false,
        showResolved: false,
        splitEdit: true,
        splitRatio: 0.35,
      })
    );
    expect(custom.commentsEnabled).toBe(false);
    expect(custom.typeToComment).toBe(false);
    expect(custom.showResolved).toBe(false);
    expect(custom.splitEdit).toBe(true);
    expect(custom.splitRatio).toBe(0.35);

    // Malformed booleans fall back to their defaults.
    expect(parseSettings('{"commentsEnabled":"no"}').commentsEnabled).toBe(true);
    expect(parseSettings('{"typeToComment":0}').typeToComment).toBe(true);
    expect(parseSettings('{"splitEdit":"yes"}').splitEdit).toBe(false);

    // splitRatio clamps to [0.2, 0.8]; non-finite/non-number falls back to 0.5.
    expect(parseSettings('{"splitRatio":0.05}').splitRatio).toBe(0.2);
    expect(parseSettings('{"splitRatio":0.95}').splitRatio).toBe(0.8);
    expect(parseSettings('{"splitRatio":"half"}').splitRatio).toBe(0.5);
    expect(parseSettings('{"splitRatio":null}').splitRatio).toBe(0.5);
    expect(parseSettings('{"splitRatio":1e999}').splitRatio).toBe(0.5); // parses to Infinity
  });
});
