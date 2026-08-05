import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_ROLES,
  createWorkspaceManifest,
  isBuiltInRoleName,
  isPermission,
  MANIFEST_VERSION,
  parseWorkspaceManifest,
  PERMISSIONS,
  removeCustomRole,
  resolvePermissions,
  serializeWorkspaceManifest,
  upsertCustomRole,
  validateWorkspaceManifest,
  type WorkspaceManifest,
} from '../../src/lib/hostedWorkspace';

describe('PRD 007 Req 13 permission catalog', () => {
  it('U243: the catalog is exactly the fourteen PRD verbs — no more, no fewer', () => {
    expect([...PERMISSIONS].sort()).toEqual(
      [
        'doc.read',
        'doc.edit',
        'file.create',
        'file.delete',
        'file.rename',
        'file.upload',
        'file.download',
        'folder.manage',
        'comment.read',
        'comment.write',
        'workspace.settings',
        'workspace.members',
        'workspace.roles',
        'workspace.delete',
      ].sort()
    );
    expect(PERMISSIONS).toHaveLength(14);
    expect(isPermission('doc.read')).toBe(true);
    expect(isPermission('doc.publish')).toBe(false);
    expect(isPermission(42)).toBe(false);
  });
});

describe('PRD 007 Req 14 built-in roles', () => {
  it('U244: Owner holds all fourteen permissions', () => {
    expect([...BUILT_IN_ROLES.Owner].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('U245: Editor holds exactly the doc/file/folder/comment verbs', () => {
    expect([...BUILT_IN_ROLES.Editor].sort()).toEqual(
      [
        'doc.read',
        'doc.edit',
        'file.create',
        'file.delete',
        'file.rename',
        'file.upload',
        'file.download',
        'folder.manage',
        'comment.read',
        'comment.write',
      ].sort()
    );
  });

  it('U246: Contributor is exactly Editor minus file.delete, file.rename, folder.manage', () => {
    const expected = BUILT_IN_ROLES.Editor.filter(
      (p) => !['file.delete', 'file.rename', 'folder.manage'].includes(p)
    );
    expect([...BUILT_IN_ROLES.Contributor].sort()).toEqual([...expected].sort());
    expect(BUILT_IN_ROLES.Contributor).toHaveLength(7);
  });

  it('U247: Commenter and Viewer hold exactly their pinned read-and-comment sets', () => {
    expect([...BUILT_IN_ROLES.Commenter].sort()).toEqual(
      ['doc.read', 'file.download', 'comment.read', 'comment.write'].sort()
    );
    expect([...BUILT_IN_ROLES.Viewer].sort()).toEqual(['doc.read', 'file.download', 'comment.read'].sort());
  });

  it('U248: exactly five built-in roles exist and isBuiltInRoleName knows them', () => {
    expect(Object.keys(BUILT_IN_ROLES).sort()).toEqual(
      ['Owner', 'Editor', 'Contributor', 'Commenter', 'Viewer'].sort()
    );
    expect(isBuiltInRoleName('Owner')).toBe(true);
    expect(isBuiltInRoleName('owner')).toBe(false);
    expect(isBuiltInRoleName('Reviewer')).toBe(false);
  });
});

const NOW = '2026-08-05T12:00:00.000Z';

const base = (): WorkspaceManifest => createWorkspaceManifest('Docs', 'mock-ada', NOW);

describe('PRD 007 Req 14 built-in immutability', () => {
  it('U249: upsertCustomRole refuses every built-in name — built-ins cannot be edited or shadowed', () => {
    for (const name of Object.keys(BUILT_IN_ROLES)) {
      const res = upsertCustomRole(base(), { name, permissions: ['doc.read'] });
      expect(res.ok, name).toBe(false);
      if (!res.ok) expect(res.error).toContain('built-in');
    }
  });

  it('U250: removeCustomRole refuses built-in names — built-ins cannot be deleted', () => {
    const res = removeCustomRole(base(), 'Viewer');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('cannot be deleted');
  });

  it('U251: custom roles round-trip through upsert and remove; unknown verbs are refused', () => {
    const added = upsertCustomRole(base(), { name: 'Reviewer', permissions: ['doc.read', 'comment.write'] });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.manifest.roles).toEqual([{ name: 'Reviewer', permissions: ['doc.read', 'comment.write'] }]);
    const removed = removeCustomRole(added.manifest, 'Reviewer');
    expect(removed.ok && removed.manifest.roles).toEqual([]);
    expect(removeCustomRole(base(), 'Reviewer').ok).toBe(false);
    const bad = upsertCustomRole(base(), { name: 'X', permissions: ['doc.publish' as never] });
    expect(bad.ok).toBe(false);
  });

  it('U252: a manifest whose custom role shadows a built-in name is rejected by validation', () => {
    const data = { ...base(), roles: [{ name: 'Editor', permissions: [] }] };
    const res = validateWorkspaceManifest(data);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('shadows a built-in');
  });
});

describe('PRD 007 Req 7 workspace manifest', () => {
  it('U253: createWorkspaceManifest makes the creator the sole Owner with everyone-access off', () => {
    expect(base()).toEqual({
      version: MANIFEST_VERSION,
      name: 'Docs',
      created: NOW,
      modified: NOW,
      members: [{ id: 'mock-ada', role: 'Owner' }],
      roles: [],
      everyone: { enabled: false, role: 'Viewer' },
      settings: {},
    });
  });

  it('U254: a full manifest survives a serialize/parse round-trip byte-stable', () => {
    const manifest: WorkspaceManifest = {
      ...base(),
      members: [
        { id: 'mock-ada', role: 'Owner' },
        { id: 'mock-grace', role: 'Reviewer' },
      ],
      roles: [{ name: 'Reviewer', permissions: ['doc.read', 'comment.read', 'comment.write'] }],
      everyone: { enabled: true, role: 'Viewer' },
      settings: { theme: 'slate' },
    };
    const json = serializeWorkspaceManifest(manifest);
    const parsed = parseWorkspaceManifest(json);
    expect(parsed).toEqual({ ok: true, manifest });
    if (parsed.ok) expect(serializeWorkspaceManifest(parsed.manifest)).toBe(json);
  });

  it('U255: an unsupported schema version is rejected with an error naming both versions — never coerced', () => {
    const res = parseWorkspaceManifest(JSON.stringify({ ...base(), version: 2 }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('unsupported manifest version 2');
      expect(res.error).toContain(`version ${MANIFEST_VERSION}`);
    }
    expect(parseWorkspaceManifest(JSON.stringify({ ...base(), version: '1' })).ok).toBe(false);
  });

  it('U256: malformed JSON and non-object manifests are rejected with clear errors', () => {
    for (const input of ['not json {', '"a string"', 'null', '[]']) {
      const res = parseWorkspaceManifest(input);
      expect(res.ok, input).toBe(false);
    }
  });

  it('U257: field-level validation rejects bad names, timestamps, members, roles, everyone and settings', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base(), name: '' }, 'name'],
      [{ ...base(), created: 'yesterday-ish' }, 'created'],
      [{ ...base(), modified: 42 }, 'modified'],
      [{ ...base(), members: 'nope' }, 'members'],
      [{ ...base(), members: [{ id: 'a' }] }, 'member'],
      [{ ...base(), members: [{ id: 'a', role: 'Owner' }, { id: 'a', role: 'Viewer' }] }, 'duplicate member'],
      [{ ...base(), roles: [{ name: 'X', permissions: ['doc.publish'] }] }, 'unknown permission'],
      [{ ...base(), roles: [{ name: 'X', permissions: [] }, { name: 'X', permissions: [] }] }, 'duplicate custom role'],
      [{ ...base(), everyone: { enabled: 'yes', role: 'Viewer' } }, 'everyone'],
      [{ ...base(), settings: [] }, 'settings'],
    ];
    for (const [data, hint] of cases) {
      const res = validateWorkspaceManifest(data);
      expect(res.ok, hint).toBe(false);
      if (!res.ok) expect(res.error.toLowerCase()).toContain(hint.split(' ')[0]);
    }
    // A member whose role names nothing known is still a VALID manifest —
    // resolution fails closed instead (U262).
    expect(validateWorkspaceManifest({ ...base(), members: [{ id: 'a', role: 'Ghost' }] }).ok).toBe(true);
  });
});

describe('PRD 007 Req 13+16 permission resolution', () => {
  const manifest: WorkspaceManifest = {
    ...base(),
    members: [
      { id: 'mock-ada', role: 'Owner' },
      { id: 'mock-grace', role: 'Reviewer' },
      { id: 'mock-alan', role: 'Ghost' },
    ],
    roles: [{ name: 'Reviewer', permissions: ['doc.read', 'comment.read', 'comment.write'] }],
    everyone: { enabled: false, role: 'Viewer' },
  };

  it('U258: an explicit member with a built-in role gets exactly that role’s set', () => {
    expect([...resolvePermissions(manifest, 'mock-ada')].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('U259: an explicit member with a custom role gets exactly the custom definition', () => {
    expect([...resolvePermissions(manifest, 'mock-grace')].sort()).toEqual(
      ['doc.read', 'comment.read', 'comment.write'].sort()
    );
  });

  it('U260: a non-member of a workspace without everyone-access gets no permissions', () => {
    expect(resolvePermissions(manifest, 'mock-katherine').size).toBe(0);
  });

  it('U261: everyone-access grants non-members its default role; a custom everyone-role also resolves', () => {
    const open: WorkspaceManifest = { ...manifest, everyone: { enabled: true, role: 'Viewer' } };
    expect([...resolvePermissions(open, 'mock-katherine')].sort()).toEqual(
      ['doc.read', 'file.download', 'comment.read'].sort()
    );
    const custom: WorkspaceManifest = { ...manifest, everyone: { enabled: true, role: 'Reviewer' } };
    expect([...resolvePermissions(custom, 'mock-katherine')].sort()).toEqual(
      ['doc.read', 'comment.read', 'comment.write'].sort()
    );
    // An everyone-role naming nothing known fails closed too.
    const ghost: WorkspaceManifest = { ...manifest, everyone: { enabled: true, role: 'Ghost' } };
    expect(resolvePermissions(ghost, 'mock-katherine').size).toBe(0);
  });

  it('U262: explicit membership overrides the everyone-role — including a member whose role resolves to nothing, who fails closed', () => {
    const open: WorkspaceManifest = { ...manifest, everyone: { enabled: true, role: 'Owner' } };
    // Grace is a member: her Reviewer set applies, NOT the everyone Owner role.
    expect(resolvePermissions(open, 'mock-grace').has('workspace.settings')).toBe(false);
    // Alan's role name resolves to nothing: empty, not the everyone fallback.
    expect(resolvePermissions(open, 'mock-alan').size).toBe(0);
  });
});
