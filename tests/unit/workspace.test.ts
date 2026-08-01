import { describe, expect, test } from 'vitest';
import type { FolderState } from '../../src/lib/folderTree';
import {
  addWorkspaceFolder,
  adoptLegacyFolderState,
  closeWorkspace,
  isAbsolutePath,
  openFolderWorkspace,
  parentDirOf,
  parseWorkspaceFile,
  parseWorkspacePointer,
  parseWorkspaceSession,
  relativizeFolderPath,
  resolveFolderPath,
  sanitizeWorkspaceSettings,
  saveWorkspaceAs,
  serializeWorkspaceFile,
  serializeWorkspacePointer,
  serializeWorkspaceSession,
  sessionKeyForWorkspaceFile,
  workspaceFromFile,
  type Workspace,
  type WorkspaceSession,
} from '../../src/lib/workspace';

describe('PRD 002 §C7–§C8 workspace model transitions', () => {
  test('U100: open folder from every state yields a fresh one-folder untitled workspace', () => {
    const none: Workspace = { kind: 'none' };
    const fromNone = openFolderWorkspace(none, '/a');
    expect(fromNone).toEqual({ kind: 'untitled', folders: [{ path: '/a', available: true }], settings: {} });

    // From an existing untitled or named workspace, open-folder REPLACES it
    // (a new untitled workspace starts; §C11 overwrites the slot).
    const named: Workspace = {
      kind: 'named',
      file: '/ws/x.marky-workspace',
      folders: [{ path: '/old', available: true }],
      settings: { commentStorage: 'embedded' },
    };
    expect(openFolderWorkspace(named, '/b')).toEqual({
      kind: 'untitled',
      folders: [{ path: '/b', available: true }],
      settings: {},
    });
  });

  test('U101: add folder — none seeds untitled; order preserved; repeats deduped', () => {
    let ws = addWorkspaceFolder({ kind: 'none' }, '/a');
    expect(ws.kind).toBe('untitled');
    ws = addWorkspaceFolder(ws, '/b');
    ws = addWorkspaceFolder(ws, '/c');
    if (ws.kind === 'none') throw new Error('unreachable');
    expect(ws.folders.map((f) => f.path)).toEqual(['/a', '/b', '/c']);
    // A repeat is a no-op — same order, same length, same identity.
    const again = addWorkspaceFolder(ws, '/b');
    expect(again).toBe(ws);
    // A multi-root untitled workspace stays untitled (§C8).
    expect(ws.kind).toBe('untitled');
  });

  test('U102: add folder on a named workspace keeps it named (autosave target intact)', () => {
    const named = saveWorkspaceAs(addWorkspaceFolder({ kind: 'none' }, '/a'), '/ws/p.marky-workspace');
    const grown = addWorkspaceFolder(named, '/b');
    expect(grown.kind).toBe('named');
    if (grown.kind !== 'named') throw new Error('unreachable');
    expect(grown.file).toBe('/ws/p.marky-workspace');
    expect(grown.folders.map((f) => f.path)).toEqual(['/a', '/b']);
  });

  test('U103: save-as-named converts untitled, preserving folders and settings; none is a no-op', () => {
    const untitled: Workspace = {
      kind: 'untitled',
      folders: [{ path: '/a', available: true }],
      settings: { commentStorage: 'embedded' },
    };
    const named = saveWorkspaceAs(untitled, '/ws/team.marky-workspace');
    expect(named).toEqual({
      kind: 'named',
      file: '/ws/team.marky-workspace',
      folders: [{ path: '/a', available: true }],
      settings: { commentStorage: 'embedded' },
    });
    expect(saveWorkspaceAs({ kind: 'none' }, '/x.marky-workspace')).toEqual({ kind: 'none' });
  });

  test('U104: close returns the no-workspace state from anywhere', () => {
    expect(closeWorkspace({ kind: 'untitled', folders: [], settings: {} })).toEqual({ kind: 'none' });
    expect(closeWorkspace({ kind: 'none' })).toEqual({ kind: 'none' });
  });
});

describe('PRD 002 §C9 .marky-workspace parse/serialize', () => {
  test('U105: round-trip — pretty JSON, version marker, ordered folders, W+cosmetic settings', () => {
    const ws: Workspace = {
      kind: 'named',
      file: '/ws/proj.marky-workspace',
      folders: [
        { path: '/ws/docs', available: true },
        { path: '/other/notes', available: false },
      ],
      settings: { commentStorage: 'embedded', imageFolder: 'assets', themeLight: 'crisp' },
    };
    if (ws.kind !== 'named') throw new Error('unreachable');
    const text = serializeWorkspaceFile(ws, '/ws');
    // Pretty-printed with a version marker.
    expect(text).toContain('\n  "version": 1');
    expect(text.endsWith('\n')).toBe(true);
    const parsed = parseWorkspaceFile(text);
    expect(parsed.version).toBe(1);
    // Ordered references, relative where possible.
    expect(parsed.folders).toEqual(['docs', '../other/notes']);
    expect(parsed.settings).toEqual({ commentStorage: 'embedded', imageFolder: 'assets', themeLight: 'crisp' });
  });

  test('U106: no machine/session state ever serializes — M and U! keys are scrubbed', () => {
    const dirty = {
      commentStorage: 'embedded', // W — kept
      themeLight: 'one-dark', // U cosmetic — kept (pinned default)
      author: 'Alice', // U! — dropped
      splitEdit: true, // M — dropped
      splitRatio: 0.4, // M — dropped
      showFolders: true, // M — dropped
      folderWidth: 300, // M — dropped
      openFiles: ['/a.md'], // session junk — dropped
      activeFile: '/a.md', // session junk — dropped
      recents: [], // unknown — dropped
    };
    expect(sanitizeWorkspaceSettings(dirty)).toEqual({ commentStorage: 'embedded', themeLight: 'one-dark' });
    const text = serializeWorkspaceFile({ folders: [], settings: dirty }, '/ws');
    for (const banned of ['author', 'splitEdit', 'splitRatio', 'showFolders', 'folderWidth', 'openFiles', 'activeFile'])
      expect(text).not.toContain(banned);
  });

  test('U107: corruption tolerance — malformed input yields a sane empty workspace', () => {
    for (const bad of ['', 'not json', 'null', '[]', '42', '{"folders": "nope", "settings": []}']) {
      expect(parseWorkspaceFile(bad)).toEqual({ version: 1, folders: [], settings: {} });
    }
    // Junk entries inside folders are filtered; repeats deduped.
    expect(parseWorkspaceFile('{"folders": ["a", "", 3, null, "a", "b"]}').folders).toEqual(['a', 'b']);
  });
});

describe('PRD 002 §C10 folder references — relative storage, absolute resolution', () => {
  test('U108: relativize/resolve round-trips (posix)', () => {
    expect(relativizeFolderPath('/ws/docs', '/ws')).toBe('docs');
    expect(relativizeFolderPath('/ws/a/b', '/ws')).toBe('a/b');
    expect(relativizeFolderPath('/other/notes', '/ws')).toBe('../other/notes');
    expect(relativizeFolderPath('/ws', '/ws')).toBe('.');
    for (const [stored, dir, abs] of [
      ['docs', '/ws', '/ws/docs'],
      ['../other/notes', '/ws', '/other/notes'],
      ['.', '/ws', '/ws'],
      ['/already/abs', '/ws', '/already/abs'],
    ]) {
      expect(resolveFolderPath(stored, dir)).toBe(abs);
    }
    // Round-trip identity for the model's absolute paths.
    for (const p of ['/ws/docs', '/other/deep/nest', '/ws']) {
      expect(resolveFolderPath(relativizeFolderPath(p, '/ws'), '/ws')).toBe(p);
    }
  });

  test('U109: windows drives — same drive relativizes, different drive stays absolute', () => {
    expect(relativizeFolderPath('C:\\ws\\docs', 'C:\\ws')).toBe('docs');
    expect(resolveFolderPath('docs', 'C:\\ws')).toBe('C:\\ws\\docs');
    // A different drive cannot be expressed relatively — absolute is kept.
    expect(relativizeFolderPath('D:\\data', 'C:\\ws')).toBe('D:\\data');
    expect(resolveFolderPath('D:\\data', 'C:\\ws')).toBe('D:\\data');
    expect(isAbsolutePath('C:\\ws')).toBe(true);
    expect(isAbsolutePath('docs/sub')).toBe(false);
    expect(parentDirOf('/ws/proj.marky-workspace')).toBe('/ws');
    expect(parentDirOf('C:\\ws\\p.marky-workspace')).toBe('C:\\ws');
  });

  test('U110: unreachable folders stay in the model flagged unavailable, never dropped', () => {
    const data = parseWorkspaceFile('{"version":1,"folders":["docs","../gone"],"settings":{}}');
    const ws = workspaceFromFile(data, '/ws/proj.marky-workspace', new Set(['/gone']));
    if (ws.kind !== 'named') throw new Error('unreachable');
    expect(ws.folders).toEqual([
      { path: '/ws/docs', available: true },
      { path: '/gone', available: false },
    ]);
  });
});

describe('PRD 002 §B6/§C11 per-workspace session state', () => {
  const session: WorkspaceSession = {
    version: 1,
    folders: ['/ws/docs', '/other'],
    expanded: ['/ws/docs', '/ws/docs/sub'],
    showNonMd: true,
    openFiles: ['/ws/docs/a.md', '/other/b.md'],
    activeFile: '/other/b.md',
    openOnly: true,
    settings: { commentStorage: 'embedded' },
  };

  test('U111: session round-trip including the untitled slot settings', () => {
    expect(parseWorkspaceSession(serializeWorkspaceSession(session))).toEqual(session);
    // A named-workspace session omits settings and round-trips without them.
    const { settings: _settings, ...named } = session;
    expect(parseWorkspaceSession(serializeWorkspaceSession(named as WorkspaceSession))).toEqual(named);
  });

  test('U112: session corruption tolerance — bad input is a sane empty session', () => {
    const empty = {
      version: 1,
      folders: [],
      expanded: [],
      showNonMd: false,
      openFiles: [],
      activeFile: null,
      openOnly: false,
    };
    for (const bad of ['', '{', 'null', '"x"']) expect(parseWorkspaceSession(bad)).toEqual(empty);
    // An activeFile outside openFiles is forced null (mirrors parseFolderState).
    const fixed = parseWorkspaceSession('{"openFiles":["/a.md"],"activeFile":"/zzz.md"}');
    expect(fixed.activeFile).toBeNull();
  });

  test('U113: session keys are stable, distinct per path, and filesystem-safe', () => {
    const a = sessionKeyForWorkspaceFile('/ws/proj.marky-workspace');
    expect(a).toBe(sessionKeyForWorkspaceFile('/ws/proj.marky-workspace'));
    expect(a).not.toBe(sessionKeyForWorkspaceFile('/elsewhere/proj.marky-workspace'));
    expect(a).toMatch(/^ws-proj-[0-9a-f]{8}$/);
    expect(sessionKeyForWorkspaceFile('/x/Ünt itled?.marky-workspace')).toMatch(/^ws-[A-Za-z0-9_-]+-[0-9a-f]{8}$/);
  });

  test('U114: launch pointer round-trips per state and tolerates corruption', () => {
    const named: Workspace = { kind: 'named', file: '/ws/p.marky-workspace', folders: [], settings: {} };
    expect(parseWorkspacePointer(serializeWorkspacePointer(named))).toEqual({
      version: 1,
      kind: 'named',
      file: '/ws/p.marky-workspace',
    });
    expect(parseWorkspacePointer(serializeWorkspacePointer({ kind: 'untitled', folders: [], settings: {} }))).toEqual({
      version: 1,
      kind: 'untitled',
    });
    for (const bad of ['', 'nope', '{"kind":"named"}', '{"kind":"weird"}', 'null']) {
      expect(parseWorkspacePointer(bad)).toEqual({ version: 1, kind: 'none' });
    }
  });
});

describe('PRD 002 §G24 legacy foldertree.json adoption', () => {
  test('U115: a single root becomes an untitled workspace with that one folder', () => {
    const ft: FolderState = {
      version: 1,
      root: '/notes',
      expanded: ['/notes', '/notes/sub'],
      showNonMd: true,
      openFiles: ['/notes/a.md'],
      activeFile: '/notes/a.md',
      openOnly: true,
    };
    // Adoption only names the workspace; the caller keeps applying `ft`
    // itself, so the same sidebar, tabs, and expanded state show as before.
    expect(adoptLegacyFolderState(ft)).toEqual({
      kind: 'untitled',
      folders: [{ path: '/notes', available: true }],
      settings: {},
    });
  });

  test('U116: no root (fresh install / never opened a folder) adopts nothing', () => {
    expect(
      adoptLegacyFolderState({ version: 1, root: null, expanded: [], showNonMd: false })
    ).toBeNull();
  });
});
