import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVERYONE_ROLE,
  buildNewWorkspaceManifest,
  createWorkspaceManifest,
  isKnownRoleName,
  resolvePermissions,
  workspaceOwnerIds,
  type WorkspaceManifest,
} from '../../src/lib/hostedWorkspace';
import type { MemberEntry } from '../../src/lib/membership';
import {
  deleteConfirmationMatches,
  deleteOffered,
  emptyNewWorkspaceForm,
  filterWorkspaces,
  formatOwnerNames,
  noAccessMessage,
  validateNewWorkspaceForm,
  workspaceRowBadge,
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

describe('PRD 007 Req 10 + PRD 020 Req 2: the New Workspace form', () => {
  it('U284: a missing or malformed unique name blocks submission with a message naming the problem', () => {
    // PRD 020 Req 2: the unique name is the hard stop now — a friendly
    // display name alone no longer submits.
    expect(validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), name: 'Design docs' })).toEqual({
      ok: false,
      error: 'A unique name is required.',
    });
    // Whitespace is outside the charset (never silently trimmed away).
    const spaced = validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), uniqueName: 'design docs' });
    expect(spaced).toEqual({ ok: false, error: 'A unique name may only use letters, digits, and . _ - characters.' });
  });

  it('U285: a valid form becomes the POST body — unique name, trimmed friendly name, members, everyone-access', () => {
    const result = validateNewWorkspaceForm({
      uniqueName: 'design-docs',
      name: '  Design docs ',
      members: [{ id: 'mock-grace', role: 'Editor' }],
      everyoneEnabled: true,
      everyoneRole: 'Commenter',
    });
    expect(result).toEqual({
      ok: true,
      request: {
        uniqueName: 'design-docs',
        name: 'Design docs',
        members: [{ id: 'mock-grace', role: 'Editor' }],
        everyone: { enabled: true, role: 'Commenter' },
      },
    });
    // A fresh form defaults everyone-access to off at Viewer (PRD 007 Req 16).
    expect(emptyNewWorkspaceForm()).toEqual({
      uniqueName: '',
      name: '',
      members: [],
      everyoneEnabled: false,
      everyoneRole: DEFAULT_EVERYONE_ROLE,
    });
  });

  it('U1043: a blank friendly name means the unique name is the display, and reserved names are refused before submit', () => {
    // PRD 020 Req 2: unset friendly name → the unique name IS the display —
    // the request stores it as the manifest name so all chrome keeps working.
    const bare = validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), uniqueName: 'design-docs' });
    expect(bare.ok && bare.request.name).toBe('design-docs');
    expect(bare.ok && bare.request.uniqueName).toBe('design-docs');
    // PRD 020 Req 1: reserved words are refused client-side with the same
    // message the server would answer.
    expect(validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), uniqueName: 'Scratchpad' })).toEqual({
      ok: false,
      error: '"Scratchpad" is a reserved name.',
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

describe('PRD 019 Reqs 8–9: the scratchpad row in the lifecycle UI', () => {
  it('U1033: only the flagged scratchpad row reads "My scratchpad"; every other row gets no badge', () => {
    expect(workspaceRowBadge(listing({ id: 'sp', name: 'Scratchpad', scratchpad: true }))).toBe('My scratchpad');
    expect(workspaceRowBadge(listing({ id: 'w', name: 'Docs' }))).toBeNull();
  });

  it('U1034: the delete section needs workspace.delete AND a non-scratchpad workspace', () => {
    const canDelete = ['doc.read', 'workspace.delete'];
    // A regular workspace with the verb: offered, exactly as before.
    expect(deleteOffered(listing({ id: 'w', name: 'Docs' }), canDelete)).toBe(true);
    // The caller's own scratchpad: withheld even though its Owner holds the
    // verb — the server refuses that delete anyway (PRD 019 Req 9).
    expect(deleteOffered(listing({ id: 'sp', name: 'Scratchpad', scratchpad: true }), canDelete)).toBe(false);
    // Without the verb nothing changes: never offered.
    expect(deleteOffered(listing({ id: 'w', name: 'Docs' }), ['doc.read'])).toBe(false);
  });
});

describe('PRD 020 Req 1+2: buildNewWorkspaceManifest and the unique name', () => {
  const NOW = '2026-09-03T00:00:00.000Z';

  it('U1051: a create body carries both names into the manifest; omitting the friendly name makes the unique name the display', () => {
    const both = buildNewWorkspaceManifest({ uniqueName: 'design-docs', name: 'Design Docs' }, 'mock-ada', NOW);
    expect(both.ok && both.manifest.uniqueName).toBe('design-docs');
    expect(both.ok && both.manifest.name).toBe('Design Docs');
    // No friendly name → the unique name is the display (PRD 020 Req 2).
    const bare = buildNewWorkspaceManifest({ uniqueName: 'design-docs' }, 'mock-ada', NOW);
    expect(bare.ok && bare.manifest.name).toBe('design-docs');
    // No unique name at all is still the pre-#219 API — old callers keep
    // working and the Req 3 migration names their workspaces later.
    const legacy = buildNewWorkspaceManifest({ name: 'Old style' }, 'mock-ada', NOW);
    expect(legacy.ok && 'uniqueName' in legacy.manifest).toBe(false);
  });

  it('U1052: an invalid or reserved unique name is refused with the message the dialog shows verbatim', () => {
    expect(buildNewWorkspaceManifest({ uniqueName: 'has spaces', name: 'W' }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'A unique name may only use letters, digits, and . _ - characters.',
    });
    expect(buildNewWorkspaceManifest({ uniqueName: 'scratch', name: 'W' }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: '"scratch" is a reserved name.',
    });
    expect(buildNewWorkspaceManifest({ uniqueName: 42, name: 'W' }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'uniqueName must be a string',
    });
  });
});
