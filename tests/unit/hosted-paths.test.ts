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
  LEGACY_SCRATCH_SEGMENT,
  SCRATCH_SEGMENT,
  buildAppPath,
  buildScratchPath,
  findWorkspaceByUniqueName,
  isOwnScratch,
  parseAppPath,
  renamedWorkspaceUrl,
  scratchBootsFresh,
} from '../../src/lib/hostedPaths';
import { parseWorkspaceFile } from '../../src/lib/workspace';
import { isReservedWorkspaceName } from '../../src/lib/workspaceNames';

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
  it('U1036: exactly /scratchpad (trailing slash tolerated, case-insensitive like name matching) is the shortcut — nothing nested or prefixed', () => {
    // PRD 020 Req 11, amended by issue #244: the shortcut word is PRD 019
    // Req 1's own `/scratchpad` again.
    expect(parseAppPath('/scratchpad')).toEqual({ kind: 'scratch' });
    expect(parseAppPath('/scratchpad/')).toEqual({ kind: 'scratch' });
    expect(parseAppPath('/Scratchpad')).toEqual({ kind: 'scratch' });
    // Everything else boots as a normal page: nested variants resolve as a
    // workspace named `scratchpad` — reserved, so never found.
    expect(parseAppPath('/scratchpad/notes.md')).toEqual({
      kind: 'workspace',
      name: 'scratchpad',
      file: ['notes.md'],
    });
    expect(parseAppPath('/scratchpads')).toEqual({ kind: 'workspace', name: 'scratchpads', file: [] });
  });

  it('U1061: the legacy /scratch shortcut still resolves — same target as /scratchpad, no dead bookmark', () => {
    // Issue #244: PRD 020 Req 11's shipped word stays a parse-only alias, so
    // an old bookmark lands in exactly the same place; HostedSignIn's
    // replaceState rewrite is what moves the bar to the canonical URL.
    expect(parseAppPath('/scratch')).toEqual({ kind: 'scratch' });
    expect(parseAppPath('/scratch/')).toEqual({ kind: 'scratch' });
    expect(parseAppPath('/Scratch')).toEqual({ kind: 'scratch' });
    // The alias is only the whole segment: nested and prefixed forms still
    // fall through to workspace-name resolution, reserved so never found.
    expect(parseAppPath('/scratch/notes.md')).toEqual({ kind: 'workspace', name: 'scratch', file: ['notes.md'] });
    expect(parseAppPath('/scratches')).toEqual({ kind: 'workspace', name: 'scratches', file: [] });
  });

  it('U1062: scratchpad as a second segment always addresses user seg1’s scratchpad workspace — files beneath, shadowing folders', () => {
    expect(parseAppPath('/ada/scratchpad')).toEqual({ kind: 'user-scratch', username: 'ada', file: [] });
    expect(parseAppPath('/ada/scratchpad/')).toEqual({ kind: 'user-scratch', username: 'ada', file: [] });
    expect(parseAppPath('/ada/Scratchpad')).toEqual({ kind: 'user-scratch', username: 'ada', file: [] });
    expect(parseAppPath('/ada/scratchpad/guides/intro.md')).toEqual({
      kind: 'user-scratch',
      username: 'ada',
      file: ['guides', 'intro.md'],
    });
    // The documented shadowing (PRD 020 Non-goals): a workspace named `notes`
    // with a root folder literally named `scratchpad` cannot be path-addressed
    // — seg2 is the reserved word, whoever seg1 names.
    expect(parseAppPath('/notes/scratchpad/kept.md')).toEqual({
      kind: 'user-scratch',
      username: 'notes',
      file: ['kept.md'],
    });
    // A THIRD segment named scratchpad is an ordinary file segment.
    expect(parseAppPath('/notes/docs/scratchpad')).toEqual({
      kind: 'workspace',
      name: 'notes',
      file: ['docs', 'scratchpad'],
    });
  });

  it('U1180: the legacy /<username>/scratch[/<file…>] form resolves to the identical target, and both words stay reserved', () => {
    // Issue #244: an old shared link keeps working — same username, same file
    // segments, same kind — so the visit binds the same workspace and opens
    // the same file before the bar is normalized.
    expect(parseAppPath('/ada/scratch')).toEqual(parseAppPath('/ada/scratchpad'));
    expect(parseAppPath('/ada/Scratch/')).toEqual({ kind: 'user-scratch', username: 'ada', file: [] });
    expect(parseAppPath('/ada/scratch/guides/intro.md')).toEqual(parseAppPath('/ada/scratchpad/guides/intro.md'));
    expect(parseAppPath('/notes/scratch/kept.md')).toEqual({
      kind: 'user-scratch',
      username: 'notes',
      file: ['kept.md'],
    });
    // Neither word can be shadowed by a real workspace or a derived username.
    expect(isReservedWorkspaceName('scratch')).toBe(true);
    expect(isReservedWorkspaceName('Scratchpad')).toBe(true);
  });

  it('U1063: buildScratchPath builds the canonical /<username>/scratchpad[/…] URL and round-trips through parseAppPath', () => {
    expect(buildScratchPath('ada')).toBe('/ada/scratchpad');
    expect(buildScratchPath('ada', ['guides', 'meeting notes.md'])).toBe('/ada/scratchpad/guides/meeting%20notes.md');
    expect(parseAppPath(buildScratchPath('ada', ['meeting notes.md']))).toEqual({
      kind: 'user-scratch',
      username: 'ada',
      file: ['meeting notes.md'],
    });
  });

  it('U1181: the canonical word is the only one ever emitted — a legacy visit normalizes through buildScratchPath', () => {
    // Issue #244: this is the whole redirect contract in pure form —
    // resolveHostedVisit rewrites the bar to buildScratchPath(owner, file)
    // on EVERY scratchpad landing, so a legacy visit ends on the canonical
    // URL, and re-parsing that URL yields the same target it started from.
    expect(SCRATCH_SEGMENT).toBe('scratchpad');
    expect(LEGACY_SCRATCH_SEGMENT).toBe('scratch');
    for (const legacy of ['/ada/scratch', '/ada/scratch/guides/intro.md', '/Ada/Scratch']) {
      const target = parseAppPath(legacy);
      if (target.kind !== 'user-scratch') throw new Error(`${legacy} must parse as a scratchpad target`);
      const canonical = buildScratchPath(target.username, target.file);
      expect(canonical.split('/')[2]).toBe(SCRATCH_SEGMENT);
      expect(parseAppPath(canonical)).toEqual(target);
    }
  });
});

describe('PRD 023 Reqs 1–5 the scratch boot decision', () => {
  // One rule, not per-route: own scratch AND no target file boots the fresh
  // scratch buffer; everything else boots nothing. scratchBootsFresh is the
  // pure decision every bindScratch call in HostedSignIn.tsx routes through.
  it('U1115: /scratchpad boots fresh — it is definitionally the caller’s own; without a resolved handle nothing binds, so nothing boots', () => {
    expect(scratchBootsFresh(parseAppPath('/scratchpad'), 'ada')).toBe(true);
    expect(scratchBootsFresh(parseAppPath('/scratchpad'), undefined)).toBe(false);
    // Issue #244: the legacy shortcut makes the very same decision.
    expect(scratchBootsFresh(parseAppPath('/scratch'), 'ada')).toBe(true);
    expect(scratchBootsFresh(parseAppPath('/scratch'), undefined)).toBe(false);
  });

  it('U1116: the caller’s own bare /<username>/scratchpad boots fresh on EVERY ask — case-insensitively, and again on re-entry (the decision is stateless)', () => {
    const target = parseAppPath('/ada/scratchpad');
    expect(scratchBootsFresh(target, 'ada')).toBe(true);
    // Handle matching is case-insensitive, like workspace-name matching.
    expect(scratchBootsFresh(parseAppPath('/Ada/scratchpad'), 'ada')).toBe(true);
    // Issue #244: and the legacy spelling of the same bare form.
    expect(scratchBootsFresh(parseAppPath('/ada/scratch'), 'ada')).toBe(true);
    expect(scratchBootsFresh(target, 'Ada')).toBe(true);
    // PRD 023 Req 4: re-entry (a reload, the Open Workspace row, a repeat
    // visit) re-asks the same question and gets the same yes — no "already
    // booted once" state suppresses the fresh buffer.
    expect(scratchBootsFresh(target, 'ada')).toBe(true);
  });

  it('U1117: a file segment suppresses the boot — the caller’s own /<username>/scratchpad/<path> opens the file, fresh buffer never', () => {
    expect(scratchBootsFresh(parseAppPath('/ada/scratchpad/notes.md'), 'ada')).toBe(false);
    expect(scratchBootsFresh(parseAppPath('/ada/scratchpad/guides/intro.md'), 'ada')).toBe(false);
    // Issue #244: the legacy file URL suppresses it the same way.
    expect(scratchBootsFresh(parseAppPath('/ada/scratch/notes.md'), 'ada')).toBe(false);
  });

  it('U1118: someone else’s scratchpad boots nothing — with or without a file segment, and whether or not the caller’s handle resolved', () => {
    expect(scratchBootsFresh(parseAppPath('/grace/scratchpad'), 'ada')).toBe(false);
    expect(scratchBootsFresh(parseAppPath('/grace/scratchpad/notes.md'), 'ada')).toBe(false);
    expect(scratchBootsFresh(parseAppPath('/grace/scratchpad'), undefined)).toBe(false);
    expect(scratchBootsFresh(parseAppPath('/grace/scratch'), 'ada')).toBe(false);
  });

  it('U1119: only scratchpad targets can boot — home and workspace paths never do, and the unique-name/legacy route decides on its canonical user-scratch form', () => {
    expect(scratchBootsFresh(parseAppPath('/'), 'ada')).toBe(false);
    expect(scratchBootsFresh(parseAppPath('/notes/intro.md'), 'ada')).toBe(false);
    // The row?.scratchpad branch (a flagged row is always the caller's own)
    // constructs exactly this canonical form: no file boots fresh, a file
    // suppresses — the same one rule as the scratch URLs.
    expect(scratchBootsFresh({ kind: 'user-scratch', username: 'ada', file: [] }, 'ada')).toBe(true);
    expect(scratchBootsFresh({ kind: 'user-scratch', username: 'ada', file: ['kept.md'] }, 'ada')).toBe(false);
  });

  it('U1120: the ownership half (PRD 020 Req 12) is its own answer — the routing gate in HostedSignIn.tsx asks it, and a file segment does not change it', () => {
    // isOwnScratch decides own-vs-someone-else's (resolve-or-create against
    // /api/scratchpad/<username>); scratchBootsFresh adds "no target file".
    expect(isOwnScratch(parseAppPath('/scratchpad'), 'ada')).toBe(true);
    expect(isOwnScratch(parseAppPath('/Ada/scratchpad'), 'ada')).toBe(true);
    expect(isOwnScratch(parseAppPath('/ada/scratchpad/notes.md'), 'ada')).toBe(true);
    expect(isOwnScratch(parseAppPath('/grace/scratchpad'), 'ada')).toBe(false);
    expect(isOwnScratch(parseAppPath('/notes/intro.md'), 'ada')).toBe(false);
    // No resolved handle: not even the shortcut is anyone's own scratchpad.
    expect(isOwnScratch(parseAppPath('/scratchpad'), undefined)).toBe(false);
    // Issue #244: a legacy URL answers ownership identically.
    expect(isOwnScratch(parseAppPath('/scratch'), 'ada')).toBe(true);
    expect(isOwnScratch(parseAppPath('/ada/scratch/notes.md'), 'ada')).toBe(true);
    expect(isOwnScratch(parseAppPath('/grace/scratch'), 'ada')).toBe(false);
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

// PRD 024 Reqs 11–13 (issue #302): where the address bar goes when the
// workspace this tab is bound to is renamed — the whole decision, taken from
// the visited path alone, so the platform layer only has to call it.
describe('PRD 024 Req 11 the renaming tab’s new URL', () => {
  it('U1241: renamedWorkspaceUrl swaps the workspace segment, keeping the file path and the #heading fragment', () => {
    // The nested file the tab has open (and the fragment it arrived with)
    // belong to the same document after the rename — only the name moved.
    expect(renamedWorkspaceUrl('/notes/guides/intro.md', '#setup', 'field-notes')).toBe(
      '/field-notes/guides/intro.md#setup',
    );
    // No fragment on the URL, none invented.
    expect(renamedWorkspaceUrl('/notes/guides/intro.md', '', 'field-notes')).toBe('/field-notes/guides/intro.md');
    // The workspace-only form stays the workspace-only form.
    expect(renamedWorkspaceUrl('/notes', '', 'field-notes')).toBe('/field-notes');
    expect(renamedWorkspaceUrl('/notes/', '', 'field-notes')).toBe('/field-notes');
    // A rename that only changes case still moves the bar to the stored casing.
    expect(renamedWorkspaceUrl('/notes', '', 'Notes')).toBe('/Notes');
  });

  it('U1242: renamedWorkspaceUrl percent-encodes the new name and every file segment, per segment', () => {
    // buildAppPath's encoding, reached through the rename path: an already
    // encoded file segment survives the decode/encode round trip unchanged.
    expect(renamedWorkspaceUrl('/notes/meeting%20notes.md', '', 'my notes')).toBe('/my%20notes/meeting%20notes.md');
    expect(renamedWorkspaceUrl('/notes/100%.md', '#a%20b', 'q?notes')).toBe('/q%3Fnotes/100%25.md#a%20b');
  });

  it('U1243: renamedWorkspaceUrl rewrites nothing for the paths a unique name does not address', () => {
    // PRD 024 Req 12 + PRD 020 Req 10/11: the start page and both scratchpad
    // routes address their workspace by something other than its unique name,
    // so a new unique name moves neither bar.
    expect(renamedWorkspaceUrl('/', '', 'field-notes')).toBeNull();
    expect(renamedWorkspaceUrl('', '', 'field-notes')).toBeNull();
    expect(renamedWorkspaceUrl('/scratchpad', '', 'field-notes')).toBeNull();
    expect(renamedWorkspaceUrl('/ada/scratchpad', '', 'field-notes')).toBeNull();
    expect(renamedWorkspaceUrl('/ada/scratchpad/notes.md', '#top', 'field-notes')).toBeNull();
  });
});
