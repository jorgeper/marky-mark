import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MARGIN_WIDTHS,
  parseSettings,
  serializeSettings,
  SETTINGS_SCOPES,
  WORKSPACE_ELIGIBLE_KEYS,
} from '../../src/lib/settings';
import { combosConflict, DEFAULT_HOTKEYS, type HotkeyMap } from '../../src/lib/hotkeys';

describe('v3 settings', () => {
  test('U13: new fields parse with defaults, invalid values fall back, legacy `theme` migrates to themeLight', () => {
    // Empty/malformed input → full defaults.
    const d = parseSettings('{}');
    expect(d.themeLight).toBe('crisp');
    expect(d.themeDark).toBe('gruvbox-dark');
    expect(d.useDarkTheme).toBe(true);
    expect(d.fontSize).toBe(14);
    expect(d.zoom).toBe(100);
    expect(d.margins).toBe('super-narrow'); // narrowest margins by default
    expect(d.paneMinWidth).toBe(768); // pane content floor (px)
    expect(d.lineNumbers).toBe(true);
    expect(d.vimNav).toBe(false);
    expect(parseSettings('not json')).toEqual({ ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_SETTINGS.hotkeys } });

    // Legacy v1/v2 file: single `theme` key migrates to themeLight.
    const legacy = parseSettings('{"theme":"monokai","author":"Jorge"}');
    expect(legacy.themeLight).toBe('monokai');
    expect(legacy.themeDark).toBe('gruvbox-dark');
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
    expect(parseSettings('{"fontSize":8}').fontSize).toBe(14); // below min 10 → default
    expect(parseSettings('{"fontSize":99}').fontSize).toBe(14); // above max 32 → default
    expect(parseSettings('{"fontSize":"big"}').fontSize).toBe(14);
    expect(parseSettings('{"fontSize":"auto"}').fontSize).toBe('auto'); // explicit auto preserved
    expect(parseSettings('{"zoom":137}').zoom).toBe(100); // not a preset level
    expect(parseSettings('{"margins":"gigantic"}').margins).toBe('super-narrow'); // unknown → the default
    expect(parseSettings('{"margins":"default"}').margins).toBe('default'); // explicit theme-default preserved
    expect(parseSettings('{"paneMinWidth":50}').paneMinWidth).toBe(120); // clamped to [120, 960]
    expect(parseSettings('{"paneMinWidth":5000}').paneMinWidth).toBe(960);
    expect(parseSettings('{"paneMinWidth":"wide"}').paneMinWidth).toBe(768);
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
    // Defaults: comments on, type-to-comment on, split ON (owner call,
    // SPEC20 follow-up — was off in SPEC7), ratio 0.5.
    const d = parseSettings('{}');
    expect(d.commentsEnabled).toBe(true);
    expect(d.typeToComment).toBe(true);
    expect(d.splitEdit).toBe(true);
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
    expect(parseSettings('{"splitEdit":"yes"}').splitEdit).toBe(true); // falls back to the (on) default
    expect(parseSettings('{"splitEdit":false}').splitEdit).toBe(false); // explicit off is honored

    // splitRatio clamps to [0.2, 0.8]; non-finite/non-number falls back to 0.5.
    expect(parseSettings('{"splitRatio":0.05}').splitRatio).toBe(0.2);
    expect(parseSettings('{"splitRatio":0.95}').splitRatio).toBe(0.8);
    expect(parseSettings('{"splitRatio":"half"}').splitRatio).toBe(0.5);
    expect(parseSettings('{"splitRatio":null}').splitRatio).toBe(0.5);
    expect(parseSettings('{"splitRatio":1e999}').splitRatio).toBe(0.5); // parses to Infinity
  });
});

describe('SPEC21 settings', () => {
  test('U48: newFile hotkey defaults to Mod+N, merges into pre-SPEC21 files, overrides round-trip', () => {
    expect(parseSettings('{}').hotkeys.newFile).toBe('Mod+N');
    // A settings file written before SPEC21 has no newFile key — it gains the
    // default without disturbing the user's other bindings.
    const old = parseSettings('{"hotkeys":{"save":"Mod+Shift+S"}}');
    expect(old.hotkeys.newFile).toBe('Mod+N');
    expect(old.hotkeys.save).toBe('Mod+Shift+S');
    const round = parseSettings(
      serializeSettings({ ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_SETTINGS.hotkeys, newFile: 'Mod+Shift+N' } })
    );
    expect(round.hotkeys.newFile).toBe('Mod+Shift+N');
    // Blank/invalid stored values fall back like every other hotkey.
    expect(parseSettings('{"hotkeys":{"newFile":"  "}}').hotkeys.newFile).toBe('Mod+N');
  });
});

describe('SPEC23 settings', () => {
  test('U51: editorSyntax defaults true, explicit false honored, malformed falls back, round-trips', () => {
    expect(parseSettings('{}').editorSyntax).toBe(true);
    expect(DEFAULT_SETTINGS.editorSyntax).toBe(true);
    expect(parseSettings('{"editorSyntax":false}').editorSyntax).toBe(false);
    expect(parseSettings('{"editorSyntax":true}').editorSyntax).toBe(true);
    expect(parseSettings('{"editorSyntax":"off"}').editorSyntax).toBe(true); // malformed → default
    expect(parseSettings('{"editorSyntax":0}').editorSyntax).toBe(true);
    const round = parseSettings(serializeSettings({ ...DEFAULT_SETTINGS, editorSyntax: false }));
    expect(round.editorSyntax).toBe(false);
  });
});

describe('Issue #122 code-block syntax colouring setting', () => {
  // Intent: the new switch has to behave exactly like its neighbour U51 —
  // colour is ON for a fresh install, a hand-written `false` is obeyed, and
  // anything that is not a boolean in settings.json falls back to the default
  // rather than reaching the panes as a truthy string.
  test('U676: codeSyntax defaults true, explicit false honored, malformed falls back, round-trips', () => {
    expect(parseSettings('{}').codeSyntax).toBe(true);
    expect(DEFAULT_SETTINGS.codeSyntax).toBe(true);
    expect(parseSettings('{"codeSyntax":false}').codeSyntax).toBe(false);
    expect(parseSettings('{"codeSyntax":true}').codeSyntax).toBe(true);
    expect(parseSettings('{"codeSyntax":"off"}').codeSyntax).toBe(true); // malformed → default
    expect(parseSettings('{"codeSyntax":0}').codeSyntax).toBe(true);
    const round = parseSettings(serializeSettings({ ...DEFAULT_SETTINGS, codeSyntax: false }));
    expect(round.codeSyntax).toBe(false);
    // Independent of editorSyntax: turning one off leaves the other alone.
    const one = parseSettings('{"codeSyntax":false}');
    expect(one.editorSyntax).toBe(true);
    expect(parseSettings('{"editorSyntax":false}').codeSyntax).toBe(true);
  });
});

describe('PRD 013 Req 13 file tab strip setting', () => {
  // Intent: same contract as its boolean neighbours (U676 / U51) — the strip
  // is ON for a fresh install, a hand-written `false` is obeyed, and anything
  // that is not a boolean in settings.json falls back to the default rather
  // than reaching the strip as a truthy string.
  test('U913: fileTabs defaults true, explicit false honored, malformed falls back, round-trips', () => {
    expect(DEFAULT_SETTINGS.fileTabs).toBe(true);
    expect(parseSettings('{}').fileTabs).toBe(true);
    expect(parseSettings('{"fileTabs":false}').fileTabs).toBe(false);
    expect(parseSettings('{"fileTabs":true}').fileTabs).toBe(true);
    expect(parseSettings('{"fileTabs":"off"}').fileTabs).toBe(true); // malformed → default
    expect(parseSettings('{"fileTabs":0}').fileTabs).toBe(true);
    expect(parseSettings('{"fileTabs":null}').fileTabs).toBe(true);
    const round = parseSettings(serializeSettings({ ...DEFAULT_SETTINGS, fileTabs: false }));
    expect(round.fileTabs).toBe(false);
  });

  test('U914: it is machine-scoped, like its layout neighbours the sidebar keys', () => {
    expect(SETTINGS_SCOPES.fileTabs).toBe('M');
    expect(SETTINGS_SCOPES.showFolders).toBe('M');
    // 'M' keeps it out of the workspace-editable set by construction — no
    // shared layer can force a tab strip onto (or off) someone else's screen.
    expect(WORKSPACE_ELIGIBLE_KEYS).not.toContain('fileTabs');
  });
});

describe('Issue #167 scrollbar and sync-scroll settings', () => {
  // Intent: the three keys follow their neighbours' boolean contract — all
  // three ship ON, a hand-written `false` is obeyed, and a non-boolean in
  // settings.json falls back to the default instead of reaching the app.
  test('U940: autoHideScrollbars / syncScroll / showSyncScrollButton default true, malformed falls back, round-trip', () => {
    for (const key of ['autoHideScrollbars', 'syncScroll', 'showSyncScrollButton'] as const) {
      expect(DEFAULT_SETTINGS[key]).toBe(true);
      expect(parseSettings('{}')[key]).toBe(true);
      expect(parseSettings(`{"${key}":false}`)[key]).toBe(false);
      expect(parseSettings(`{"${key}":"off"}`)[key]).toBe(true); // malformed → default
      expect(parseSettings(`{"${key}":0}`)[key]).toBe(true);
      const round = parseSettings(serializeSettings({ ...DEFAULT_SETTINGS, [key]: false }));
      expect(round[key]).toBe(false);
    }
  });

  test('U941: the fade and button keys are user-personal; syncScroll is machine-local like its split neighbours', () => {
    expect(SETTINGS_SCOPES.autoHideScrollbars).toBe('U');
    expect(SETTINGS_SCOPES.showSyncScrollButton).toBe('U');
    expect(SETTINGS_SCOPES.syncScroll).toBe('M');
    expect(SETTINGS_SCOPES.splitEdit).toBe('M');
    // 'M' keeps it out of the workspace-editable set by construction — no
    // shared layer can link (or unlink) someone else's panes.
    expect(WORKSPACE_ELIGIBLE_KEYS).not.toContain('syncScroll');
  });
});

describe('PRD 011 Req 6+7 LLM provider settings', () => {
  test('U577: the defaults leave the app unconfigured — empty key, no fabricated model', () => {
    const d = parseSettings('{}');
    expect(d.llmApiKey).toBe('');
    expect(d.llmModel).toBe('');
    expect(d.llmBaseUrl).toBe('');
    // A kind must be *something*; choosing one configures nothing on its own.
    expect(d.llmProvider).toBe('anthropic');
    expect(DEFAULT_SETTINGS.llmApiKey).toBe('');
    expect(DEFAULT_SETTINGS.llmModel).toBe('');
  });

  test('U578: any model id the provider accepts persists and survives a save/reload unchanged', () => {
    // PRD 011 Req 6: nothing rejects an id for being absent from the curated
    // list — a new model must never require an app release.
    for (const model of ['claude-opus-5', 'some-model-shipped-tomorrow', 'vendor/slug:v2', 'x']) {
      const round = parseSettings(serializeSettings({ ...DEFAULT_SETTINGS, llmModel: model }));
      expect(round.llmModel).toBe(model);
    }
    const custom = parseSettings(
      serializeSettings({
        ...DEFAULT_SETTINGS,
        llmProvider: 'custom',
        llmBaseUrl: 'https://llm.example.com/v1',
        llmApiKey: 'sk-secret',
      })
    );
    expect(custom.llmProvider).toBe('custom');
    expect(custom.llmBaseUrl).toBe('https://llm.example.com/v1');
    expect(custom.llmApiKey).toBe('sk-secret');
    // The unconfigured state is a real stored value, not a missing one.
    expect(parseSettings('{"llmModel":""}').llmModel).toBe('');
  });

  test('U579: a provider kind the seam does not have falls back rather than reaching providerFor', () => {
    expect(parseSettings('{"llmProvider":"perplexity"}').llmProvider).toBe('anthropic');
    expect(parseSettings('{"llmProvider":7}').llmProvider).toBe('anthropic');
    expect(parseSettings('{"llmProvider":"openrouter"}').llmProvider).toBe('openrouter');
    // Non-string credentials are refused too.
    expect(parseSettings('{"llmApiKey":{"leak":1}}').llmApiKey).toBe('');
  });
});

describe('PRD 011 Req 1: the Experimental section ships off', () => {
  test('U596: semanticZoom defaults to false and round-trips as a plain boolean', () => {
    expect(DEFAULT_SETTINGS.semanticZoom).toBe(false);
    expect(parseSettings('{}').semanticZoom).toBe(false);
    expect(parseSettings('{"semanticZoom":true}').semanticZoom).toBe(true);
    // A non-boolean is rejected rather than coerced — the feature stays off.
    expect(parseSettings('{"semanticZoom":"yes"}').semanticZoom).toBe(false);
    expect(parseSettings(serializeSettings({ ...DEFAULT_SETTINGS, semanticZoom: true })).semanticZoom).toBe(true);
  });
});

describe('issue #125: the remembered view mode', () => {
  test('U909: lastViewMode defaults to preview, takes only the two real modes, and round-trips', () => {
    // The default is today's behaviour: a fresh install still opens documents
    // in the reading preview.
    expect(DEFAULT_SETTINGS.lastViewMode).toBe('preview');
    expect(parseSettings('{}').lastViewMode).toBe('preview');

    expect(parseSettings('{"lastViewMode":"edit"}').lastViewMode).toBe('edit');
    expect(parseSettings('{"lastViewMode":"preview"}').lastViewMode).toBe('preview');

    // A hand-edited garbage value never reaches the app.
    expect(parseSettings('{"lastViewMode":"split"}').lastViewMode).toBe('preview');
    expect(parseSettings('{"lastViewMode":"EDIT"}').lastViewMode).toBe('preview');
    expect(parseSettings('{"lastViewMode":true}').lastViewMode).toBe('preview');
    expect(parseSettings('{"lastViewMode":null}').lastViewMode).toBe('preview');

    // Save → reload keeps the choice, which is the whole point of the key.
    expect(parseSettings(serializeSettings({ ...DEFAULT_SETTINGS, lastViewMode: 'edit' })).lastViewMode).toBe('edit');
  });

  test('U910: it is machine-local — no workspace or team layer can force a reader’s view mode', () => {
    expect(SETTINGS_SCOPES.lastViewMode).toBe('M');
    // 'M' keeps it out of the workspace-editable set by construction, like
    // splitEdit and splitRatio beside it.
    expect(WORKSPACE_ELIGIBLE_KEYS).not.toContain('lastViewMode');
  });
});

describe('PRD 012 Req 10: the toggleToc hotkey', () => {
  test('U671: toggleToc defaults to Mod+Shift+T, merges into older settings files, and rebinds round-trip', () => {
    expect(DEFAULT_HOTKEYS.toggleToc).toBe('Mod+Shift+T');
    expect(parseSettings('{}').hotkeys.toggleToc).toBe('Mod+Shift+T');

    // A settings file written before this issue has no toggleToc key — it
    // gains the default without disturbing the bindings already stored.
    const old = parseSettings('{"hotkeys":{"toggleFolders":"Mod+Shift+D"}}');
    expect(old.hotkeys.toggleToc).toBe('Mod+Shift+T');
    expect(old.hotkeys.toggleFolders).toBe('Mod+Shift+D');

    // Remappable and persisted like every other row of the map.
    const round = parseSettings(
      serializeSettings({ ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_SETTINGS.hotkeys, toggleToc: 'Mod+Alt+T' } })
    );
    expect(round.hotkeys.toggleToc).toBe('Mod+Alt+T');
    // An absent or invalid stored value falls back to the default.
    expect(parseSettings('{"hotkeys":{"toggleToc":"   "}}').hotkeys.toggleToc).toBe('Mod+Shift+T');
    expect(parseSettings('{"hotkeys":{"toggleToc":7}}').hotkeys.toggleToc).toBe('Mod+Shift+T');
  });

  test('U672: no two shipped defaults fire on one keypress — toggleToc included', () => {
    const actions = Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>;
    expect(actions).toContain('toggleToc');
    for (const a of actions) {
      for (const b of actions) {
        if (a === b) continue;
        // combosConflict, not string equality: Mod matches ⌘-or-Ctrl, so two
        // differently-spelled defaults could still collide as chords.
        expect(combosConflict(DEFAULT_HOTKEYS[a], DEFAULT_HOTKEYS[b]), `${a} vs ${b}`).toBe(false);
      }
    }
    // The folders view keeps its own binding, unchanged and distinct.
    expect(DEFAULT_HOTKEYS.toggleFolders).toBe('Mod+Shift+E');
  });
});

describe('PRD 014 Req 3: the searchAllFiles hotkey', () => {
  test('U702: searchAllFiles defaults to Mod+Shift+F, merges into older settings files, and rebinds round-trip', () => {
    expect(DEFAULT_HOTKEYS.searchAllFiles).toBe('Mod+Shift+F');
    expect(parseSettings('{}').hotkeys.searchAllFiles).toBe('Mod+Shift+F');

    // A settings file written before this issue has no searchAllFiles key —
    // it gains the default without disturbing the bindings already stored.
    const old = parseSettings('{"hotkeys":{"toggleFolders":"Mod+Shift+D"}}');
    expect(old.hotkeys.searchAllFiles).toBe('Mod+Shift+F');
    expect(old.hotkeys.toggleFolders).toBe('Mod+Shift+D');

    // Remappable and persisted like every other row of the map.
    const round = parseSettings(
      serializeSettings({
        ...DEFAULT_SETTINGS,
        hotkeys: { ...DEFAULT_SETTINGS.hotkeys, searchAllFiles: 'Mod+Alt+F' },
      })
    );
    expect(round.hotkeys.searchAllFiles).toBe('Mod+Alt+F');
    // A blank or non-string stored value falls back to the default.
    expect(parseSettings('{"hotkeys":{"searchAllFiles":"   "}}').hotkeys.searchAllFiles).toBe('Mod+Shift+F');
    expect(parseSettings('{"hotkeys":{"searchAllFiles":7}}').hotkeys.searchAllFiles).toBe('Mod+Shift+F');
  });

  test('U703: no two shipped defaults fire on one keypress — searchAllFiles included — and no sibling binding moved', () => {
    const actions = Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>;
    expect(actions).toContain('searchAllFiles');
    for (const a of actions) {
      for (const b of actions) {
        if (a === b) continue;
        // combosConflict, not string equality: Mod matches ⌘-or-Ctrl, so two
        // differently-spelled defaults could still collide as chords.
        expect(combosConflict(DEFAULT_HOTKEYS[a], DEFAULT_HOTKEYS[b]), `${a} vs ${b}`).toBe(false);
      }
    }
    // The neighbours keep their shipped meanings, unchanged and distinct:
    // Mod+F stays the in-document find, and Shift keeps the two apart.
    expect(DEFAULT_HOTKEYS.find).toBe('Mod+F');
    expect(DEFAULT_HOTKEYS.toggleFolders).toBe('Mod+Shift+E');
    expect(DEFAULT_HOTKEYS.toggleToc).toBe('Mod+Shift+T');
    expect(combosConflict(DEFAULT_HOTKEYS.find, DEFAULT_HOTKEYS.searchAllFiles)).toBe(false);
  });
});

describe('PRD 012 Req 11: the remembered sidebar view', () => {
  test('U673: sidebarView defaults to folders, takes only the known views, and round-trips', () => {
    expect(DEFAULT_SETTINGS.sidebarView).toBe('folders');
    expect(parseSettings('{}').sidebarView).toBe('folders');

    expect(parseSettings('{"sidebarView":"toc"}').sidebarView).toBe('toc');
    expect(parseSettings('{"sidebarView":"folders"}').sidebarView).toBe('folders');
    // PRD 014 Req 1: the Search view persists like the other two.
    expect(parseSettings('{"sidebarView":"search"}').sidebarView).toBe('search');

    // Anything else — a retired view name, a case slip, a wrong type — falls
    // back to the folder tree rather than reaching the app as an empty pane.
    expect(parseSettings('{"sidebarView":"outline"}').sidebarView).toBe('folders');
    expect(parseSettings('{"sidebarView":"TOC"}').sidebarView).toBe('folders');
    expect(parseSettings('{"sidebarView":true}').sidebarView).toBe('folders');
    expect(parseSettings('{"sidebarView":null}').sidebarView).toBe('folders');

    // Save → reload keeps the view, which is the whole point of the key.
    expect(parseSettings(serializeSettings({ ...DEFAULT_SETTINGS, sidebarView: 'toc' })).sidebarView).toBe('toc');
  });

  test('U674: it is machine-scoped, like the sidebar’s visibility and width', () => {
    expect(SETTINGS_SCOPES.sidebarView).toBe('M');
    expect(SETTINGS_SCOPES.showFolders).toBe('M');
    expect(SETTINGS_SCOPES.folderWidth).toBe('M');
    expect(WORKSPACE_ELIGIBLE_KEYS).not.toContain('sidebarView');
  });
});
