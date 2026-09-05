import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCOPES,
  parseSettings,
  resolveSettings,
  winningLayer,
  type Scope,
  type Settings,
} from '../../src/lib/settings';

/** Fresh defaults with an unshared hotkeys map, for whole-object comparisons. */
const freshDefaults = (): Settings => ({ ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_SETTINGS.hotkeys } });

describe('PRD 002 §B5 scope inventory', () => {
  test('U77: every Settings key carries exactly one scope tag, matching the adopted classification', () => {
    const expected: Record<keyof Settings, Scope> = {
      themeLight: 'U',
      themeDark: 'U',
      useDarkTheme: 'U',
      fontSize: 'U',
      zoom: 'U',
      margins: 'U',
      paneMinWidth: 'U',
      lineNumbers: 'U',
      editorSyntax: 'U',
      // Issue #122: code-block colouring sits beside editorSyntax — a reader's
      // own preference, honored at the User layer like its neighbour.
      codeSyntax: 'U',
      livePreview: 'U',
      // PRD 011 Req 1: the Experimental section's switch — user-personal.
      semanticZoom: 'U',
      tableGridView: 'U',
      inlineImages: 'U',
      // Issue #157: the fenced-code card view sits beside its two view
      // neighbours — a reader's own preference.
      codeBlockView: 'U',
      // PRD 013 Req 5: the edit-pane diagram view, the same reader-owned scope.
      diagramView: 'U',
      showFrontmatter: 'U',
      showWordCount: 'U',
      showResolved: 'U',
      vimNav: 'U',
      typeToComment: 'U',
      // PRD 022 Req 4: the last-used marker color — the reader's own memory.
      lastMarkerColor: 'U',
      autosaveOnToggle: 'U',
      autoHideToolbar: 'U',
      // Issue #167: how the chrome fades is a reader's preference, like the
      // toolbar key beside it; the corner button's visibility follows the
      // showWordCount precedent.
      autoHideScrollbars: 'U',
      showSyncScrollButton: 'U',
      exportTheme: 'U',
      hotkeys: 'U',
      commentsEnabled: 'U',
      author: 'U!',
      // PRD 011 Req 7: the LLM credential and the configuration that reaches
      // it are user-only identity — honored at the User layer and ignored
      // everywhere else, so no shared layer can supply any of them.
      llmProvider: 'U!',
      llmModel: 'U!',
      llmApiKey: 'U!',
      llmBaseUrl: 'U!',
      // PRD 011 Reqs 32+33: this reader's own spend, and their own decision to
      // be asked before spending — never a shared layer's to set.
      llmUsageLast: 'U!',
      llmUsageTotal: 'U!',
      llmConfirmSummaries: 'U!',
      commentStorage: 'W',
      imageFolder: 'W',
      imageNamePattern: 'W',
      splitEdit: 'M',
      splitRatio: 'M',
      // Issue #167: whether THIS screen's split panes track each other is
      // the reader's own layout, like the two split keys beside it.
      syncScroll: 'M',
      // Issue #125: the remembered view mode is this reader's own layout
      // state, like the split keys beside it.
      lastViewMode: 'M',
      showFolders: 'M',
      folderWidth: 'M',
      // PRD 012 Req 11: the sidebar's remembered view joins its two
      // machine-scoped neighbours — a reader's own layout, never a team's.
      sidebarView: 'M',
      // PRD 013 Req 13: the tab strip's visibility is this reader's own
      // screen arrangement, like the three sidebar keys beside it.
      fileTabs: 'M',
      // PRD 023 §15 (issue #284): the comments pane's open/closed state is
      // this reader's own screen arrangement, like showFolders beside it.
      showComments: 'M',
    };
    expect(SETTINGS_SCOPES).toEqual(expected);
    // The inventory covers the runtime key set exactly — no extras, no gaps.
    expect(Object.keys(SETTINGS_SCOPES).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});

describe('PRD 002 §A layered resolver', () => {
  test('U78: U precedence — User beats Workspace beats Team beats Global; lower layers fill omissions', () => {
    const r = resolveSettings({
      global: { fontSize: 14, zoom: 150, margins: 'wide', themeLight: 'nord' },
      team: { fontSize: 16, zoom: 125 },
      workspace: { fontSize: 18 },
      user: { fontSize: 20 },
    });
    expect(r.fontSize).toBe(20); // all four set it → User wins
    expect(r.zoom).toBe(125); // User/Workspace silent → Team supplies it
    expect(r.margins).toBe('wide'); // only Global sets it
    expect(r.themeLight).toBe('nord');
    expect(r.themeDark).toBe(DEFAULT_SETTINGS.themeDark); // nobody → baked default
    // Workspace beats Team and Global when the User layer is silent.
    expect(resolveSettings({ global: { zoom: 150 }, team: { zoom: 125 }, workspace: { zoom: 75 } }).zoom).toBe(75);
  });

  test('U79: U! exclusion — author is honored only from the User layer', () => {
    const ignored = resolveSettings({
      global: { author: 'Admin' },
      team: { author: 'Team' },
      workspace: { author: 'Workspace' },
    });
    expect(ignored.author).toBe(DEFAULT_SETTINGS.author);
    // A User value still wins over noise in the other layers.
    expect(resolveSettings({ global: { author: 'Admin' }, user: { author: 'Jorge' } }).author).toBe('Jorge');
  });

  test('U80: W exclusion — User value ignored; Workspace beats Team beats Global', () => {
    // Only the User layer sets W keys → they stay at their defaults.
    const userOnly = resolveSettings({
      user: { commentStorage: 'embedded', imageFolder: 'mine', imageNamePattern: 'u-{n}' },
    });
    expect(userOnly.commentStorage).toBe(DEFAULT_SETTINGS.commentStorage);
    expect(userOnly.imageFolder).toBe(DEFAULT_SETTINGS.imageFolder);
    expect(userOnly.imageNamePattern).toBe(DEFAULT_SETTINGS.imageNamePattern);
    const r = resolveSettings({
      global: { imageFolder: 'g-images', imageNamePattern: 'g-{n}', commentStorage: 'embedded' },
      team: { imageFolder: 't-images' },
      workspace: { imageFolder: 'w-images' },
      user: { imageFolder: 'u-images', commentStorage: 'sidecar' },
    });
    expect(r.imageFolder).toBe('w-images'); // Workspace beats Team beats Global
    expect(r.imageNamePattern).toBe('g-{n}'); // Global supplies when W/T are silent
    expect(r.commentStorage).toBe('embedded'); // the (valid) User value is ignored
  });

  test('U81: M exclusion — never merged from Global/Team/Workspace; machine store (settings.json) still applies', () => {
    const r = resolveSettings({
      global: { splitRatio: 0.7, splitEdit: false, showFolders: true, folderWidth: 400 },
      team: { splitRatio: 0.6 },
      workspace: { splitRatio: 0.3, folderWidth: 300 },
      user: { splitRatio: 0.25, splitEdit: false },
    });
    // M values in the shareable layers are ignored…
    expect(r.showFolders).toBe(DEFAULT_SETTINGS.showFolders);
    expect(r.folderWidth).toBe(DEFAULT_SETTINGS.folderWidth);
    // …while the machine-local store (settings.json, read as the User input) holds.
    expect(r.splitRatio).toBe(0.25);
    expect(r.splitEdit).toBe(false);
  });

  test('U1133: showComments (issue #284) is M-excluded like its layout neighbours — no shared layer can force the pane open', () => {
    const shared = resolveSettings({
      global: { showComments: true },
      team: { showComments: true },
      workspace: { showComments: true },
    });
    expect(shared.showComments).toBe(false); // the baked default: closed
    // The machine-local store (read as the User input) is the one that holds.
    expect(resolveSettings({ user: { showComments: true } }).showComments).toBe(true);
    expect(resolveSettings({ user: { showComments: 'open' } }).showComments).toBe(false); // invalid → default
  });

  test('U82: malformed values fall through layers to the next valid one, ultimately baked defaults', () => {
    const r = resolveSettings({
      global: { fontSize: 14 },
      team: { fontSize: 99 }, // out of range → rejected
      workspace: { fontSize: 'big' }, // wrong type → rejected
      user: { fontSize: null }, // → rejected → Global's 14
    });
    expect(r.fontSize).toBe(14);
    // Every layer invalid → the baked default.
    expect(resolveSettings({ global: { zoom: 1 }, user: { zoom: 137 } }).zoom).toBe(100);
    // Per-key clamping/validation applies to whichever layer's value is taken.
    expect(resolveSettings({ global: { paneMinWidth: 5000 } }).paneMinWidth).toBe(960);
    expect(resolveSettings({ user: { splitRatio: 0.95 } }).splitRatio).toBe(0.8);
    expect(resolveSettings({ workspace: { imageFolder: 'a/b' } }).imageFolder).toBe('images'); // invalid folder
    expect(resolveSettings({ team: { hotkeys: { newFile: '  ' } } }).hotkeys.newFile).toBe('Mod+N');
    // Unrecognized keys and non-object layers are ignored.
    expect(resolveSettings({ global: { nonsense: 1 }, user: { alsoNot: true } })).toEqual(freshDefaults());
    expect(resolveSettings({ global: 'junk', team: 42, workspace: null, user: [1, 2] })).toEqual(freshDefaults());
  });

  test('U83: pure and deterministic — same inputs, same output; inputs untouched; hotkeys never shared', () => {
    const layers = { global: { fontSize: 14 }, user: { fontSize: 'auto', hotkeys: { save: 'Mod+Shift+S' } } };
    const snapshot = JSON.parse(JSON.stringify(layers));
    const a = resolveSettings(layers);
    const b = resolveSettings(layers);
    expect(a).toEqual(b);
    expect(layers).toEqual(snapshot); // no input mutation
    expect(a.fontSize).toBe('auto');
    expect(resolveSettings({})).toEqual(freshDefaults());
    expect(resolveSettings({}).hotkeys).not.toBe(DEFAULT_SETTINGS.hotkeys); // fresh map, not the shared default
  });

  test('U84: hotkeys resolve as a map — highest layer with a hotkeys object wins, merged over defaults', () => {
    const g = resolveSettings({ global: { hotkeys: { save: 'Mod+Shift+S' } } });
    expect(g.hotkeys.save).toBe('Mod+Shift+S');
    expect(g.hotkeys.newFile).toBe('Mod+N'); // unset bindings keep their defaults
    const u = resolveSettings({
      global: { hotkeys: { save: 'Mod+Shift+S' } },
      user: { hotkeys: { newFile: 'Mod+J' } },
    });
    expect(u.hotkeys.newFile).toBe('Mod+J');
  });

  test('U85: legacy `theme` migrates per layer; parseSettings stays the flat User-file parse', () => {
    expect(resolveSettings({ user: { theme: 'monokai' } }).themeLight).toBe('monokai');
    expect(resolveSettings({ user: { theme: 'monokai', themeLight: 'nord' } }).themeLight).toBe('nord');
    // parseSettings (the settings.json reader) still honors every key flat,
    // because that file doubles as the machine-local store today.
    const flat = parseSettings('{"imageFolder":"assets","splitEdit":false,"author":"Jorge"}');
    expect(flat.imageFolder).toBe('assets');
    expect(flat.splitEdit).toBe(false);
    expect(flat.author).toBe('Jorge');
  });
});

describe('PRD 002 §H26 web shape — the same resolver with the workspace layer absent', () => {
  // On web no workspace can ever open, so the app calls resolveSettings with
  // `workspace` undefined — exactly the Global < Team < User chain.
  test('U117: U-scoped keys resolve Global < Team < User; lower layers fill omissions', () => {
    const r = resolveSettings({
      global: { fontSize: 14, zoom: 150, margins: 'wide', themeLight: 'nord' },
      team: { fontSize: 16, zoom: 125 },
      user: { fontSize: 20 },
    });
    expect(r.fontSize).toBe(20); // all three set it → User wins
    expect(r.zoom).toBe(125); // User silent → Team beats Global
    expect(r.margins).toBe('wide'); // only Global sets it
    expect(r.themeLight).toBe('nord');
    expect(r.themeDark).toBe(DEFAULT_SETTINGS.themeDark); // nobody → baked default
    expect(resolveSettings({ global: { zoom: 150 }, team: { zoom: 75 } }).zoom).toBe(75);
  });

  test('U118: W-scoped keys with no workspace layer fall through Team/Global to the default; User still never wins', () => {
    // Scope rules are unchanged: the User value for a W key stays ignored.
    const r = resolveSettings({
      global: { commentStorage: 'embedded', imageFolder: 'g-images' },
      team: { imageFolder: 't-images' },
      user: { commentStorage: 'sidecar', imageFolder: 'u-images', imageNamePattern: 'u-{n}' },
    });
    expect(r.commentStorage).toBe('embedded'); // Global supplies it, User ignored
    expect(r.imageFolder).toBe('t-images'); // Team beats Global
    expect(r.imageNamePattern).toBe(DEFAULT_SETTINGS.imageNamePattern); // only User set it → default
    // Nothing but the User layer present → every W key sits at its default.
    const userOnly = resolveSettings({ user: { commentStorage: 'sidecar', imageFolder: 'mine' } });
    expect(userOnly.commentStorage).toBe(DEFAULT_SETTINGS.commentStorage);
    expect(userOnly.imageFolder).toBe(DEFAULT_SETTINGS.imageFolder);
  });

  test("U119: winningLayer never reports 'workspace' when the workspace layer is absent", () => {
    const layers = {
      global: { ...DEFAULT_SETTINGS, author: 'Admin' },
      team: { fontSize: 16, imageFolder: 't-images' },
      user: { fontSize: 20, author: 'Jorge', commentStorage: 'sidecar' },
    };
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
      expect(winningLayer(key, layers)).not.toBe('workspace');
    }
    expect(winningLayer('fontSize', layers)).toBe('user');
    expect(winningLayer('imageFolder', layers)).toBe('team'); // W key skips the absent layer AND the User value
    expect(winningLayer('author', layers)).toBe('user'); // U!: only the User layer is a candidate
    expect(winningLayer('commentStorage', {})).toBe('default');
  });
});

describe('PRD 022 Req 4: the last-used marker color', () => {
  // Renumbered from U1101 (issue #185 collision rule): #240's editor-boundary
  // suite took U1101 first on this branch, and #232's anchoring suite took
  // U1103–U1105, so the newer test moved up past both.
  test('U1106: validated to the four literals, defaulting to yellow; merged at the User layer like any U key', () => {
    // Default: yellow — the legacy tint family.
    expect(DEFAULT_SETTINGS.lastMarkerColor).toBe('yellow');
    expect(SETTINGS_SCOPES.lastMarkerColor).toBe('U');

    // The four literals are accepted from the User layer.
    for (const color of ['yellow', 'green', 'orange', 'pink'] as const) {
      expect(resolveSettings({ user: { lastMarkerColor: color } }).lastMarkerColor).toBe(color);
    }
    // Anything else — a fifth color, wrong type — falls through to the
    // next layer down and ultimately the default. PRD 023 §3 (issue #283):
    // 'blue' left the vocabulary with format 2.0.0, so a persisted 'blue'
    // fails validation and falls back like any invalid value — it never
    // survives as a fifth color.
    expect(resolveSettings({ user: { lastMarkerColor: 'chartreuse' } }).lastMarkerColor).toBe('yellow');
    expect(resolveSettings({ user: { lastMarkerColor: 'blue' } }).lastMarkerColor).toBe('yellow');
    expect(resolveSettings({ user: { lastMarkerColor: 3 } }).lastMarkerColor).toBe('yellow');
    expect(
      resolveSettings({ workspace: { lastMarkerColor: 'orange' }, user: { lastMarkerColor: 'nope' } }).lastMarkerColor
    ).toBe('orange');

    // U-layer precedence: the User value wins over every shared layer.
    expect(
      resolveSettings({ global: { lastMarkerColor: 'green' }, user: { lastMarkerColor: 'pink' } }).lastMarkerColor
    ).toBe('pink');
    expect(winningLayer('lastMarkerColor', { user: { lastMarkerColor: 'pink' } })).toBe('user');

    // parseSettings (the flat User file) honors and validates it the same way.
    expect(parseSettings('{"lastMarkerColor":"green"}').lastMarkerColor).toBe('green');
    expect(parseSettings('{"lastMarkerColor":"mauve"}').lastMarkerColor).toBe('yellow');
  });
});
