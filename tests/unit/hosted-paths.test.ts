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
