import { describe, expect, it } from 'vitest';
import {
  buildNewWorkspaceManifest,
  createWorkspaceManifest,
  isKnownRoleName,
  resolvePermissions,
  workspaceOwnerIds,
  type WorkspaceManifest,
} from '../../src/lib/hostedWorkspace';
import type { MemberEntry } from '../../src/lib/membership';
import {
  DEFAULT_EVERYONE_ROLE,
  deleteConfirmationMatches,
  emptyNewWorkspaceForm,
  filterWorkspaces,
  formatOwnerNames,
  noAccessMessage,
  validateNewWorkspaceForm,
  type WorkspaceListing,
} from '../../src/lib/workspaceLifecycle';

const NOW = '2026-08-06T10:00:00.000Z';

const listing = (over: Partial<WorkspaceListing> & { id: string; name: string }): WorkspaceListing => ({
  created: NOW,
  modified: NOW,
  owners: [],
  access: true,
  ...over,
});

const member = (id: string, displayName: string, resolved = true): MemberEntry => ({
  id,
  displayName,
  username: displayName.toLowerCase(),
  resolved,
});

describe('PRD 007 Req 10: the create-workspace request', () => {
  it('U277: a name-only body still creates the creator-as-sole-Owner manifest', () => {
    const built = buildNewWorkspaceManifest({ name: '  Design docs  ' }, 'mock-ada', NOW);
    expect(built.ok).toBe(true);
    const manifest = (built as { manifest: WorkspaceManifest }).manifest;
    // The name is trimmed and the legacy shape is byte-for-byte what
    // createWorkspaceManifest already produced — existing callers unchanged.
    expect(manifest).toEqual(createWorkspaceManifest('Design docs', 'mock-ada', NOW));
  });

  it('U278: an empty or whitespace-only name is rejected, and so is a non-object body', () => {
    for (const body of [{ name: '' }, { name: '   ' }, { name: 42 }, {}]) {
      const built = buildNewWorkspaceManifest(body, 'mock-ada', NOW);
      expect(built).toEqual({ ok: false, error: 'name must be a non-empty string' });
    }
    expect(buildNewWorkspaceManifest('nope', 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'request body must be a JSON object',
    });
  });

  it('U279: initial members are granted their roles, with the creator retained as Owner', () => {
    const built = buildNewWorkspaceManifest(
      {
        name: 'Shared',
        members: [
          { id: 'mock-grace', role: 'Editor' },
          { id: 'mock-alan', role: 'Viewer' },
        ],
      },
      'mock-ada',
      NOW,
    );
    expect(built.ok).toBe(true);
    expect((built as { manifest: WorkspaceManifest }).manifest.members).toEqual([
      { id: 'mock-ada', role: 'Owner' },
      { id: 'mock-grace', role: 'Editor' },
      { id: 'mock-alan', role: 'Viewer' },
    ]);
  });

  it('U280: a body that tries to demote the creator (or list them twice) cannot', () => {
    const built = buildNewWorkspaceManifest(
      { name: 'Shared', members: [{ id: 'mock-ada', role: 'Viewer' }] },
      'mock-ada',
      NOW,
    );
    const manifest = (built as { manifest: WorkspaceManifest }).manifest;
    expect(manifest.members).toEqual([{ id: 'mock-ada', role: 'Owner' }]);
    expect(resolvePermissions(manifest, 'mock-ada').has('workspace.delete')).toBe(true);
  });

  it('U281: an unknown role name is an error, on a member and on everyone-access alike', () => {
    expect(
      buildNewWorkspaceManifest({ name: 'W', members: [{ id: 'x', role: 'Superuser' }] }, 'mock-ada', NOW),
    ).toEqual({ ok: false, error: 'unknown role "Superuser"' });
    expect(
      buildNewWorkspaceManifest({ name: 'W', everyone: { enabled: true, role: 'Superuser' } }, 'mock-ada', NOW),
    ).toEqual({ ok: false, error: 'unknown role "Superuser"' });
    // Malformed member/everyone shapes are named too, never coerced.
    expect(buildNewWorkspaceManifest({ name: 'W', members: 'grace' }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'members must be an array',
    });
    expect(buildNewWorkspaceManifest({ name: 'W', everyone: { enabled: 'yes' } }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'everyone must be {enabled: boolean, role?: string}',
    });
  });

  it('U282: everyone-access defaults to Viewer (PRD 007 Req 16) and honours an explicit role', () => {
    const dflt = buildNewWorkspaceManifest({ name: 'W', everyone: { enabled: true } }, 'mock-ada', NOW);
    expect((dflt as { manifest: WorkspaceManifest }).manifest.everyone).toEqual({ enabled: true, role: 'Viewer' });
    const explicit = buildNewWorkspaceManifest(
      { name: 'W', everyone: { enabled: true, role: 'Commenter' } },
      'mock-ada',
      NOW,
    );
    expect((explicit as { manifest: WorkspaceManifest }).manifest.everyone).toEqual({
      enabled: true,
      role: 'Commenter',
    });
  });

  it('U283: role validation spans built-ins and the manifest own custom roles', () => {
    const manifest: WorkspaceManifest = {
      ...createWorkspaceManifest('W', 'mock-ada', NOW),
      roles: [{ name: 'Reviewer', permissions: ['doc.read'] }],
    };
    expect(isKnownRoleName(manifest, 'Owner')).toBe(true);
    expect(isKnownRoleName(manifest, 'Reviewer')).toBe(true);
    expect(isKnownRoleName(manifest, 'Auditor')).toBe(false);
  });
});

describe('PRD 007 Req 10: the New Workspace form', () => {
  it('U284: a blank or whitespace-only name blocks submission with a message', () => {
    for (const name of ['', '   ', '\t\n']) {
      expect(validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), name })).toEqual({
        ok: false,
        error: 'Enter a name for the workspace.',
      });
    }
  });

  it('U285: a valid form becomes the POST body — trimmed name, members, everyone-access', () => {
    const result = validateNewWorkspaceForm({
      name: '  Design docs ',
      members: [{ id: 'mock-grace', role: 'Editor' }],
      everyoneEnabled: true,
      everyoneRole: 'Commenter',
    });
    expect(result).toEqual({
      ok: true,
      request: {
        name: 'Design docs',
        members: [{ id: 'mock-grace', role: 'Editor' }],
        everyone: { enabled: true, role: 'Commenter' },
      },
    });
    // A fresh form defaults everyone-access to off at Viewer (PRD 007 Req 16).
    expect(emptyNewWorkspaceForm()).toEqual({
      name: '',
      members: [],
      everyoneEnabled: false,
      everyoneRole: DEFAULT_EVERYONE_ROLE,
    });
  });
});

describe('PRD 007 Req 11: the Open Workspace list', () => {
  const items = [
    listing({ id: 'a', name: 'Design docs', modified: '2026-08-01T00:00:00.000Z' }),
    listing({ id: 'b', name: 'Release notes', modified: '2026-08-05T00:00:00.000Z' }),
    listing({ id: 'c', name: 'Design system', modified: '2026-08-03T00:00:00.000Z', access: false }),
  ];

  it('U286: an empty query lists everything, most recently modified first', () => {
    expect(filterWorkspaces('', items).map((w) => w.id)).toEqual(['b', 'c', 'a']);
    expect(filterWorkspaces('   ', items).map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('U287: the query is a fuzzy subsequence match over the name, inaccessible ones included', () => {
    // Every workspace in the deployment is listable — access decides what
    // choosing one does, never whether it appears.
    expect(filterWorkspaces('desgn', items).map((w) => w.id).sort()).toEqual(['a', 'c']);
    expect(filterWorkspaces('rel', items).map((w) => w.id)).toEqual(['b']);
    expect(filterWorkspaces('zzz', items)).toEqual([]);
  });

  it('U288: the access flag on the row is what distinguishes open from ask-for-access', () => {
    expect(items.filter((w) => w.access).map((w) => w.id)).toEqual(['a', 'b']);
    expect(items.filter((w) => !w.access).map((w) => w.id)).toEqual(['c']);
  });
});

describe('PRD 007 Req 11: naming the Owners of an inaccessible workspace', () => {
  it('U289: owner ids come from the Owner-role members', () => {
    const manifest: WorkspaceManifest = {
      ...createWorkspaceManifest('W', 'mock-ada', NOW),
      members: [
        { id: 'mock-ada', role: 'Owner' },
        { id: 'mock-grace', role: 'Editor' },
        { id: 'mock-alan', role: 'Owner' },
      ],
    };
    expect(workspaceOwnerIds(manifest)).toEqual(['mock-ada', 'mock-alan']);
  });

  it('U290: with no Owner-role member, anyone who can grant membership is named instead', () => {
    const manifest: WorkspaceManifest = {
      ...createWorkspaceManifest('W', 'mock-ada', NOW),
      members: [
        { id: 'mock-grace', role: 'Steward' },
        { id: 'mock-alan', role: 'Editor' },
      ],
      roles: [{ name: 'Steward', permissions: ['doc.read', 'workspace.members'] }],
    };
    expect(workspaceOwnerIds(manifest)).toEqual(['mock-grace']);
  });

  it('U291: display names join naturally, and an unresolvable owner falls back to its identifier', () => {
    expect(formatOwnerNames([])).toBe('');
    expect(formatOwnerNames([member('a', 'Ada Lovelace')])).toBe('Ada Lovelace');
    expect(formatOwnerNames([member('a', 'Ada Lovelace'), member('g', 'Grace Hopper')])).toBe(
      'Ada Lovelace and Grace Hopper',
    );
    expect(
      formatOwnerNames([member('a', 'Ada Lovelace'), member('g', 'Grace Hopper'), member('t', 'Alan Turing')]),
    ).toBe('Ada Lovelace, Grace Hopper and Alan Turing');
    // resolved: false ⇒ the plain identifier, exactly as resolveMembers left it.
    expect(formatOwnerNames([{ id: 'mock-gone', displayName: 'mock-gone', username: '', resolved: false }])).toBe(
      'mock-gone',
    );
  });

  it('U292: the no-access message names the workspace and who to ask', () => {
    expect(noAccessMessage('Design docs', [member('a', 'Ada Lovelace')])).toBe(
      'You don\'t have access to "Design docs". Ask Ada Lovelace for access.',
    );
    expect(noAccessMessage('Orphan', [])).toBe(
      'You don\'t have access to "Orphan", and it has no owner to ask.',
    );
  });
});

describe('PRD 007 Req 12: the delete confirmation gate', () => {
  it('U293: only the exact workspace name arms the action', () => {
    expect(deleteConfirmationMatches('Design docs', 'Design docs')).toBe(true);
    expect(deleteConfirmationMatches('', 'Design docs')).toBe(false);
    expect(deleteConfirmationMatches('design docs', 'Design docs')).toBe(false);
    expect(deleteConfirmationMatches('Design doc', 'Design docs')).toBe(false);
  });

  it('U294: whitespace is NOT trimmed away — a near-miss stays a near-miss', () => {
    expect(deleteConfirmationMatches(' Design docs', 'Design docs')).toBe(false);
    expect(deleteConfirmationMatches('Design docs ', 'Design docs')).toBe(false);
    // …and a name that genuinely has surrounding space matches only itself.
    expect(deleteConfirmationMatches(' spaced ', ' spaced ')).toBe(true);
    expect(deleteConfirmationMatches('spaced', ' spaced ')).toBe(false);
  });
});
