import { describe, expect, it } from 'vitest';
import {
  HOSTED_CONFIG_DIR,
  apiPathFor,
  hostedAssetUrl,
  hostedFilesRoot,
  hostedResolveAssetSrc,
  hostedWorkspaceDir,
  hostedWorkspaceFilePath,
  manifestSettingsToWorkspaceFile,
  normalizeHostedPath,
  parseHostedPath,
  workspaceFileToManifestSettings,
  workspaceIdFromSearch,
  buildAppPath,
  buildScratchPath,
  findWorkspaceByUniqueName,
  parseAppPath,
  scratchBootsFresh,
} from '../../src/lib/hostedPaths';
import { parseWorkspaceFile } from '../../src/lib/workspace';

// PRD 007 Req 2+8+9: the hosted platform's whole path→URL translation, proven
// without a server. The platform itself (src/platform/hosted.ts) does nothing
// but call these and fetch; the e2e suite covers the round trip end to end.

describe('PRD 007 Req 2 hosted virtual paths', () => {
  it('U272: every virtual path resolves to the endpoint that owns it', () => {
    const id = 'ws-1';
    expect(parseHostedPath(`${HOSTED_CONFIG_DIR}/settings.json`)).toEqual({ kind: 'user', rel: 'settings.json' });
    expect(parseHostedPath(HOSTED_CONFIG_DIR)).toEqual({ kind: 'user', rel: '' });
    expect(parseHostedPath(hostedWorkspaceFilePath(id))).toEqual({ kind: 'manifest', id });
    expect(parseHostedPath(hostedFilesRoot(id))).toEqual({ kind: 'workspace', id, rel: '' });
    expect(parseHostedPath(`${hostedFilesRoot(id)}/notes/a.md`)).toEqual({ kind: 'workspace', id, rel: 'notes/a.md' });

    expect(apiPathFor({ kind: 'user', rel: 'themes/nord.css' })).toBe('/api/me/files/themes/nord.css');
    expect(apiPathFor({ kind: 'user', rel: '' })).toBe('/api/me/files');
    expect(apiPathFor({ kind: 'manifest', id })).toBe('/api/workspaces/ws-1/manifest');
    expect(apiPathFor({ kind: 'workspace', id, rel: '' })).toBe('/api/workspaces/ws-1/files');
    expect(apiPathFor({ kind: 'workspace', id, rel: 'notes/a.md' })).toBe('/api/workspaces/ws-1/files/notes/a.md');
    // Names with URL-significant characters survive the trip as one segment.
    expect(apiPathFor({ kind: 'workspace', id, rel: 'im ages/a b?.png' })).toBe(
      '/api/workspaces/ws-1/files/im%20ages/a%20b%3F.png',
    );
  });

  it('U273: paths outside the two roots map nowhere — there is no filesystem to fall back to', () => {
    for (const path of ['/etc/passwd', '/w', '/w/ws-1', '/w/ws-1/other/a.md', '', '/']) {
      expect(parseHostedPath(path), path).toBeNull();
    }
    // A dot-walk collapses before it is classified, so it cannot climb out of
    // the workspace prefix into another workspace's blobs.
    expect(normalizeHostedPath('/w/ws-1/files/notes/../a.md')).toBe('/w/ws-1/files/a.md');
    expect(parseHostedPath('/w/ws-1/files/../../ws-2/files/a.md')).toEqual({
      kind: 'workspace',
      id: 'ws-2',
      rel: 'a.md',
    });
    // Climbing off the files root lands on the workspace directory itself,
    // which is not a readable target either.
    expect(parseHostedPath('/w/ws-1/files/..')).toBeNull();
    expect(hostedWorkspaceDir('ws-1')).toBe('/w/ws-1');
  });

  it('U274: doc-relative image refs resolve to a bearer-carrying same-origin URL', () => {
    const id = 'ws-1';
    const docDir = `${hostedFilesRoot(id)}/notes`;
    // The markdown ref imageMarkdownRef() writes is percent-encoded; it must
    // decode back to the blob path the paste wrote.
    expect(hostedResolveAssetSrc('images/pic%20one.png', docDir, 'tok')).toBe(
      '/api/workspaces/ws-1/files/notes/images/pic%20one.png?raw=1&access_token=tok',
    );
    expect(hostedAssetUrl(id, 'a.png', 'to/k')).toBe('/api/workspaces/ws-1/files/a.png?raw=1&access_token=to%2Fk');
    // Inline and remote sources pass through untouched…
    for (const src of ['data:image/png;base64,AAAA', 'blob:http://x/y', 'https://example.com/a.png']) {
      expect(hostedResolveAssetSrc(src, docDir, 'tok'), src).toBe(src);
    }
    // …and anything that cannot land inside a workspace neutralizes rather
    // than pointing the webview at a URL it would only 404 on.
    expect(hostedResolveAssetSrc('', docDir, 'tok')).toBe('');
    expect(hostedResolveAssetSrc('../../../etc/passwd', docDir, 'tok')).toBe('');
    expect(hostedResolveAssetSrc('a.png', HOSTED_CONFIG_DIR, 'tok')).toBe('');
  });

  it('U275: the ?workspace= binding accepts an id and refuses anything path-shaped', () => {
    expect(workspaceIdFromSearch('?workspace=ws-1&x=2')).toBe('ws-1');
    expect(workspaceIdFromSearch('')).toBeNull();
    expect(workspaceIdFromSearch('?workspace=')).toBeNull();
    expect(workspaceIdFromSearch('?workspace=../other')).toBeNull();
  });
});

describe('PRD 020 Req 10+11 the scratch routes', () => {
  it('U1036: exactly /scratch (trailing slash tolerated, case-insensitive like name matching) is the shortcut — nothing nested or prefixed', () => {
    // PRD 020 Req 11 replaces PRD 019 Req 1's /scratchpad shortcut.
    expect(parseAppPath('/scratch')).toEqual({ kind: 'scratch' });
    expect(parseAppPath('/scratch/')).toEqual({ kind: 'scratch' });
    expect(parseAppPath('/Scratch')).toEqual({ kind: 'scratch' });
    // Everything else boots as a normal page: nested variants resolve as a
    // workspace named `scratch` — reserved, so never found.
    expect(parseAppPath('/scratch/notes.md')).toEqual({ kind: 'workspace', name: 'scratch', file: ['notes.md'] });
    expect(parseAppPath('/scratches')).toEqual({ kind: 'workspace', name: 'scratches', file: [] });
  });

  it('U1061: /scratchpad is replaced, not kept — it falls through to workspace-name resolution', () => {
    // PRD 020 Req 10: the old route resolves like any other name; being
    // reserved, no workspace can hold it, so the visit renders not-found.
    expect(parseAppPath('/scratchpad')).toEqual({ kind: 'workspace', name: 'scratchpad', file: [] });
    expect(parseAppPath('/scratchpad/')).toEqual({ kind: 'workspace', name: 'scratchpad', file: [] });
  });

  it('U1062: scratch as a second segment always addresses user seg1’s scratch workspace — files beneath, shadowing folders', () => {
    expect(parseAppPath('/ada/scratch')).toEqual({ kind: 'user-scratch', username: 'ada', file: [] });
    expect(parseAppPath('/ada/scratch/')).toEqual({ kind: 'user-scratch', username: 'ada', file: [] });
    expect(parseAppPath('/ada/Scratch')).toEqual({ kind: 'user-scratch', username: 'ada', file: [] });
    expect(parseAppPath('/ada/scratch/guides/intro.md')).toEqual({
      kind: 'user-scratch',
      username: 'ada',
      file: ['guides', 'intro.md'],
    });
    // The documented shadowing (PRD 020 Non-goals): a workspace named `notes`
    // with a root folder literally named `scratch` cannot be path-addressed —
    // seg2 `scratch` is the reserved word, whoever seg1 names.
    expect(parseAppPath('/notes/scratch/kept.md')).toEqual({
      kind: 'user-scratch',
      username: 'notes',
      file: ['kept.md'],
    });
    // A THIRD segment named scratch is an ordinary file segment.
    expect(parseAppPath('/notes/docs/scratch')).toEqual({
      kind: 'workspace',
      name: 'notes',
      file: ['docs', 'scratch'],
    });
  });

  it('U1063: buildScratchPath builds the canonical /<username>/scratch[/…] URL and round-trips through parseAppPath', () => {
    expect(buildScratchPath('ada')).toBe('/ada/scratch');
    expect(buildScratchPath('ada', ['guides', 'meeting notes.md'])).toBe('/ada/scratch/guides/meeting%20notes.md');
    expect(parseAppPath(buildScratchPath('ada', ['meeting notes.md']))).toEqual({
      kind: 'user-scratch',
      username: 'ada',
      file: ['meeting notes.md'],
    });
  });
});

describe('PRD 023 Reqs 1–5 the scratch boot decision', () => {
  // One rule, not per-route: own scratch AND no target file boots the fresh
  // scratch buffer; everything else boots nothing. scratchBootsFresh is the
  // pure decision every bindScratch call in HostedSignIn.tsx routes through.
  it('U1115: /scratch boots fresh — it is definitionally the caller’s own; without a resolved handle nothing binds, so nothing boots', () => {
    expect(scratchBootsFresh(parseAppPath('/scratch'), 'ada')).toBe(true);
    expect(scratchBootsFresh(parseAppPath('/scratch'), undefined)).toBe(false);
  });

  it('U1116: the caller’s own bare /<username>/scratch boots fresh on EVERY ask — case-insensitively, and again on re-entry (the decision is stateless)', () => {
    const target = parseAppPath('/ada/scratch');
    expect(scratchBootsFresh(target, 'ada')).toBe(true);
    // Handle matching is case-insensitive, like workspace-name matching.
    expect(scratchBootsFresh(parseAppPath('/Ada/scratch'), 'ada')).toBe(true);
    expect(scratchBootsFresh(target, 'Ada')).toBe(true);
    // PRD 023 Req 4: re-entry (a reload, the Open Workspace row, a repeat
    // visit) re-asks the same question and gets the same yes — no "already
    // booted once" state suppresses the fresh buffer.
    expect(scratchBootsFresh(target, 'ada')).toBe(true);
  });

  it('U1117: a file segment suppresses the boot — the caller’s own /<username>/scratch/<path> opens the file, fresh buffer never', () => {
    expect(scratchBootsFresh(parseAppPath('/ada/scratch/notes.md'), 'ada')).toBe(false);
    expect(scratchBootsFresh(parseAppPath('/ada/scratch/guides/intro.md'), 'ada')).toBe(false);
  });

  it('U1118: someone else’s scratch boots nothing — with or without a file segment, and whether or not the caller’s handle resolved', () => {
    expect(scratchBootsFresh(parseAppPath('/grace/scratch'), 'ada')).toBe(false);
    expect(scratchBootsFresh(parseAppPath('/grace/scratch/notes.md'), 'ada')).toBe(false);
    expect(scratchBootsFresh(parseAppPath('/grace/scratch'), undefined)).toBe(false);
  });

  it('U1119: only scratch targets can boot — home and workspace paths never do, and the unique-name/legacy route decides on its canonical user-scratch form', () => {
    expect(scratchBootsFresh(parseAppPath('/'), 'ada')).toBe(false);
    expect(scratchBootsFresh(parseAppPath('/notes/intro.md'), 'ada')).toBe(false);
    // The row?.scratchpad branch (a flagged row is always the caller's own)
    // constructs exactly this canonical form: no file boots fresh, a file
    // suppresses — the same one rule as the scratch URLs.
    expect(scratchBootsFresh({ kind: 'user-scratch', username: 'ada', file: [] }, 'ada')).toBe(true);
    expect(scratchBootsFresh({ kind: 'user-scratch', username: 'ada', file: ['kept.md'] }, 'ada')).toBe(false);
  });
});

describe('PRD 007 Req 9 the manifest as the Workspace settings layer', () => {
  it('U276: the manifest settings slot presents as a .marky-workspace file and round-trips back', () => {
    const settings = { themeLight: 'nord', commentStorage: 'sidecar' };
    const json = manifestSettingsToWorkspaceFile(settings);
    // App parses it with the ordinary PRD 002 §C9 reader — the Workspace
    // layer arrives with no hosted-specific code anywhere in App.
    const parsed = parseWorkspaceFile(json);
    expect(parsed.settings).toEqual(settings);
    // Its single folder is the workspace's own blob prefix.
    expect(parsed.folders).toEqual(['files']);

    // The write-back keeps only settings: members, roles and timestamps are
    // the server's, and folders are not a hosted concept.
    expect(workspaceFileToManifestSettings(json)).toEqual(settings);
    expect(workspaceFileToManifestSettings('{"folders":["a"]}')).toEqual({});
    expect(workspaceFileToManifestSettings('not json')).toEqual({});
    expect(workspaceFileToManifestSettings('{"settings":[1,2]}')).toEqual({});
  });
});

// PRD 020 Req 5: the canonical path router — pathname → workspace/file
// target and back, unit-proven so the shell's resolve logic stays a thin
// I/O wrapper over it.
describe('PRD 020 Req 5 the canonical path router', () => {
  it('U1058: parseAppPath maps home, workspace and file paths, decoding each segment individually', () => {
    expect(parseAppPath('/')).toEqual({ kind: 'home' });
    expect(parseAppPath('')).toEqual({ kind: 'home' });
    expect(parseAppPath('/notes')).toEqual({ kind: 'workspace', name: 'notes', file: [] });
    expect(parseAppPath('/notes/')).toEqual({ kind: 'workspace', name: 'notes', file: [] });
    expect(parseAppPath('/notes/guides/intro.md')).toEqual({
      kind: 'workspace',
      name: 'notes',
      file: ['guides', 'intro.md'],
    });
    // Percent-decoding is per segment; a malformed escape stays verbatim.
    expect(parseAppPath('/notes/meeting%20notes.md')).toEqual({
      kind: 'workspace',
      name: 'notes',
      file: ['meeting notes.md'],
    });
    expect(parseAppPath('/notes/100%.md')).toEqual({ kind: 'workspace', name: 'notes', file: ['100%.md'] });
  });

  it('U1059: buildAppPath percent-encodes each segment and round-trips through parseAppPath', () => {
    expect(buildAppPath('notes')).toBe('/notes');
    expect(buildAppPath('notes', ['guides', 'intro.md'])).toBe('/notes/guides/intro.md');
    expect(buildAppPath('notes', ['meeting notes.md'])).toBe('/notes/meeting%20notes.md');
    // A segment holding URL-significant characters survives the round trip.
    const awkward = ['a b', '#tag', '50%', 'q?.md'];
    expect(parseAppPath(buildAppPath('my-notes', awkward))).toEqual({
      kind: 'workspace',
      name: 'my-notes',
      file: awkward,
    });
  });

  it('U1060: findWorkspaceByUniqueName matches case-insensitively and skips rows without a unique name', () => {
    const rows = [{ id: 'a' }, { id: 'b', uniqueName: 'Design-Docs' }, { id: 'c', uniqueName: 'notes' }];
    expect(findWorkspaceByUniqueName(rows, 'design-docs')?.id).toBe('b');
    expect(findWorkspaceByUniqueName(rows, 'NOTES')?.id).toBe('c');
    expect(findWorkspaceByUniqueName(rows, 'missing')).toBeUndefined();
    // A pre-migration row (no unique name) is unaddressable, never matched.
    expect(findWorkspaceByUniqueName(rows, '')).toBeUndefined();
  });
});
