import { describe, expect, it } from 'vitest';
import {
  addWorkspaceMember,
  ADMIN_IMPLICIT_PERMISSIONS,
  BUILT_IN_ROLES,
  createCustomRole,
  createWorkspaceManifest,
  customRoleUsage,
  DEFAULT_EVERYONE_ROLE,
  DEPLOYMENT_PERMISSIONS,
  grantableRoleNames,
  isBuiltInRoleName,
  isCustomRoleInUse,
  isPermission,
  MANIFEST_VERSION,
  parseWorkspaceManifest,
  PERMISSIONS,
  removeCustomRole,
  removeWorkspaceMember,
  resolvePermissions,
  serializeWorkspaceManifest,
  setEveryoneAccess,
  setWorkspaceMemberRole,
  updateCustomRole,
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

  it('U804: member display-name snapshots round-trip, old manifests without them still parse, and mutations preserve them', () => {
    // PRD 007 Req 6 (issue #180): the add-time snapshot `resolveMembers`
    // falls back to when the directory cannot answer.
    const withSnapshot: WorkspaceManifest = {
      ...base(),
      members: [
        { id: 'mock-ada', role: 'Owner', displayName: 'Ada Lovelace' },
        { id: 'mock-grace', role: 'Editor' }, // pre-#180 member: no snapshot
      ],
    };
    const parsed = parseWorkspaceManifest(serializeWorkspaceManifest(withSnapshot));
    expect(parsed).toEqual({ ok: true, manifest: withSnapshot });
    if (parsed.ok) expect(parsed.manifest.members[1]).not.toHaveProperty('displayName');
    // A present snapshot must be a non-empty string — never coerced.
    expect(validateWorkspaceManifest({ ...base(), members: [{ id: 'a', role: 'Owner', displayName: 7 }] }).ok).toBe(false);
    expect(validateWorkspaceManifest({ ...base(), members: [{ id: 'a', role: 'Owner', displayName: '' }] }).ok).toBe(false);
    // addWorkspaceMember carries the snapshot in; a role change keeps it.
    const added = addWorkspaceMember(withSnapshot, { id: 'mock-alan', role: 'Viewer', displayName: 'Alan Turing' });
    expect(added.ok && added.manifest.members[2]).toEqual({ id: 'mock-alan', role: 'Viewer', displayName: 'Alan Turing' });
    if (!added.ok) return;
    const changed = setWorkspaceMemberRole(added.manifest, 'mock-alan', 'Editor');
    expect(changed.ok && changed.manifest.members[2]).toEqual({ id: 'mock-alan', role: 'Editor', displayName: 'Alan Turing' });
    // …and one added without a snapshot stays snapshot-free.
    const bare = addWorkspaceMember(withSnapshot, { id: 'mock-kay', role: 'Viewer' });
    expect(bare.ok && bare.manifest.members[2]).toEqual({ id: 'mock-kay', role: 'Viewer' });
    if (bare.ok) expect(bare.manifest.members[2]).not.toHaveProperty('displayName');
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

// PRD 007 Req 16: the membership decisions the Workspace settings people
// section and the server endpoints share — add, remove, role change, the
// everyone-access toggle, and the invariant that a workspace never loses its
// last Owner. Pure: no manifest is mutated in place, so a refusal leaves the
// caller's manifest exactly as it was.
describe('PRD 007 Req 16 membership management', () => {
  /** Ada as Owner plus `extra` members, and a Reviewer custom role. */
  const shared = (extra: { id: string; role: string }[] = []): WorkspaceManifest => ({
    ...base(),
    members: [{ id: 'mock-ada', role: 'Owner' }, ...extra],
    roles: [{ name: 'Reviewer', permissions: ['doc.read', 'comment.write'] }],
  });

  it('U295: adding a member takes a built-in or custom role and refuses unknown names and duplicates', () => {
    const added = addWorkspaceMember(shared(), { id: 'mock-grace', role: 'Editor' });
    expect(added.ok && added.manifest.members).toEqual([
      { id: 'mock-ada', role: 'Owner' },
      { id: 'mock-grace', role: 'Editor' },
    ]);
    // A custom role of this workspace is grantable exactly like a built-in.
    expect(addWorkspaceMember(shared(), { id: 'mock-grace', role: 'Reviewer' }).ok).toBe(true);
    // A role name nothing defines is a refusal, not a member with no permissions.
    const unknown = addWorkspaceMember(shared(), { id: 'mock-grace', role: 'Superuser' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toContain('Superuser');
    // An id already on the list would be the duplicate validation rejects.
    expect(addWorkspaceMember(shared(), { id: 'mock-ada', role: 'Viewer' }).ok).toBe(false);
    expect(addWorkspaceMember(shared(), { id: '  ', role: 'Viewer' }).ok).toBe(false);
  });

  it('U296: removing a member works — except the last Owner, who cannot be removed', () => {
    const two = shared([{ id: 'mock-grace', role: 'Editor' }]);
    const removed = removeWorkspaceMember(two, 'mock-grace');
    expect(removed.ok && removed.manifest.members).toEqual([{ id: 'mock-ada', role: 'Owner' }]);
    // Ada is the only Owner: removing her would leave nobody to administer it.
    const last = removeWorkspaceMember(two, 'mock-ada');
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.error).toContain('at least one Owner');
    // With a second Owner the same removal is fine.
    const coOwned = shared([{ id: 'mock-grace', role: 'Owner' }]);
    expect(removeWorkspaceMember(coOwned, 'mock-ada').ok).toBe(true);
    // A non-member is a refusal naming the id, not a silent no-op.
    expect(removeWorkspaceMember(two, 'mock-alan').ok).toBe(false);
  });

  it('U297: a role change refuses demoting the last Owner — the same invariant, differently spelled', () => {
    const two = shared([{ id: 'mock-grace', role: 'Editor' }]);
    const promoted = setWorkspaceMemberRole(two, 'mock-grace', 'Reviewer');
    expect(promoted.ok && promoted.manifest.members[1]).toEqual({ id: 'mock-grace', role: 'Reviewer' });
    const demoted = setWorkspaceMemberRole(two, 'mock-ada', 'Viewer');
    expect(demoted.ok).toBe(false);
    if (!demoted.ok) expect(demoted.error).toContain('at least one Owner');
    // Setting the last Owner to Owner again is a no-op, not a refusal.
    expect(setWorkspaceMemberRole(two, 'mock-ada', 'Owner').ok).toBe(true);
    // Promoting someone else first makes the demotion legal.
    const co = setWorkspaceMemberRole(two, 'mock-grace', 'Owner');
    expect(co.ok && setWorkspaceMemberRole(co.manifest, 'mock-ada', 'Viewer').ok).toBe(true);
    expect(setWorkspaceMemberRole(two, 'mock-grace', 'Superuser').ok).toBe(false);
    expect(setWorkspaceMemberRole(two, 'mock-alan', 'Viewer').ok).toBe(false);
  });

  it('U298: everyone-access toggles with a role that must be grantable; omitting it keeps the stored one', () => {
    const manifest = shared();
    expect(manifest.everyone).toEqual({ enabled: false, role: DEFAULT_EVERYONE_ROLE });
    const on = setEveryoneAccess(manifest, { enabled: true, role: 'Editor' });
    expect(on.ok && on.manifest.everyone).toEqual({ enabled: true, role: 'Editor' });
    // Toggling again without naming a role keeps the raised one.
    const off = on.ok ? setEveryoneAccess(on.manifest, { enabled: false }) : on;
    expect(off.ok && off.manifest.everyone).toEqual({ enabled: false, role: 'Editor' });
    // A custom role is grantable to everyone; an unknown one is refused.
    expect(setEveryoneAccess(manifest, { enabled: true, role: 'Reviewer' }).ok).toBe(true);
    expect(setEveryoneAccess(manifest, { enabled: true, role: 'Superuser' }).ok).toBe(false);
  });

  it('U299: the role list a picker offers is the five built-ins then the workspace’s own custom roles', () => {
    expect(grantableRoleNames(shared())).toEqual([
      'Owner',
      'Editor',
      'Contributor',
      'Commenter',
      'Viewer',
      'Reviewer',
    ]);
    expect(grantableRoleNames(base())).toEqual(['Owner', 'Editor', 'Contributor', 'Commenter', 'Viewer']);
  });

  it('U300: explicit membership still overrides the everyone-role after an everyone-access edit', () => {
    // The Req 16 invariant that predates this issue, re-pinned against the
    // helper that now writes `everyone`: a member keeps their own role.
    const two = shared([{ id: 'mock-grace', role: 'Viewer' }]);
    const open = setEveryoneAccess(two, { enabled: true, role: 'Editor' });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(resolvePermissions(open.manifest, 'mock-grace').has('doc.edit')).toBe(false);
    expect(resolvePermissions(open.manifest, 'mock-katherine').has('doc.edit')).toBe(true);
  });
});

// PRD 007 Req 15: the custom-roles editor's decisions — create, rename, edit
// and delete named subsets of the catalog, with built-in, duplicate and
// in-use refusals.
describe('PRD 007 Req 15 custom-roles editor', () => {
  const withReviewer = (): WorkspaceManifest => ({
    ...base(),
    roles: [{ name: 'Reviewer', permissions: ['doc.read', 'comment.write'] }],
  });

  it('U301: creating a role refuses blank, slash-bearing, built-in and duplicate names', () => {
    const made = createCustomRole(base(), { name: '  Reviewer  ', permissions: ['doc.read'] });
    expect(made.ok && made.manifest.roles).toEqual([{ name: 'Reviewer', permissions: ['doc.read'] }]);
    for (const name of ['', '   ', 'Owner', 'Viewer']) {
      expect(createCustomRole(base(), { name, permissions: [] }).ok, name).toBe(false);
    }
    // A role name addresses its own endpoint path segment.
    expect(createCustomRole(base(), { name: 'a/b', permissions: [] }).ok).toBe(false);
    // Never a silent redefinition of a role members may already hold.
    const dup = createCustomRole(withReviewer(), { name: 'Reviewer', permissions: [] });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain('already exists');
    // Only catalog verbs exist.
    const bad = createCustomRole(base(), { name: 'Auditor', permissions: ['doc.publish'] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('doc.publish');
  });

  it('U302: renaming a role carries its members and everyone-grant over in the same update', () => {
    const held: WorkspaceManifest = {
      ...withReviewer(),
      members: [
        { id: 'mock-ada', role: 'Owner' },
        { id: 'mock-grace', role: 'Reviewer' },
      ],
      everyone: { enabled: true, role: 'Reviewer' },
    };
    const renamed = updateCustomRole(held, 'Reviewer', {
      name: 'Auditor',
      permissions: ['doc.read', 'comment.read'],
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.manifest.roles).toEqual([{ name: 'Auditor', permissions: ['doc.read', 'comment.read'] }]);
    // Nobody silently drops to a role that resolves to no permissions.
    expect(renamed.manifest.members[1]).toEqual({ id: 'mock-grace', role: 'Auditor' });
    expect(renamed.manifest.everyone).toEqual({ enabled: true, role: 'Auditor' });
    expect([...resolvePermissions(renamed.manifest, 'mock-grace')].sort()).toEqual(
      ['comment.read', 'doc.read'].sort()
    );
  });

  it('U303: editing permissions without renaming works; built-in and duplicate targets are refused', () => {
    const edited = updateCustomRole(withReviewer(), 'Reviewer', {
      name: 'Reviewer',
      permissions: ['doc.read'],
    });
    expect(edited.ok && edited.manifest.roles).toEqual([{ name: 'Reviewer', permissions: ['doc.read'] }]);
    // Built-ins are not editable and cannot be renamed into or out of.
    expect(updateCustomRole(withReviewer(), 'Viewer', { name: 'Peeker', permissions: [] }).ok).toBe(false);
    expect(updateCustomRole(withReviewer(), 'Reviewer', { name: 'Owner', permissions: [] }).ok).toBe(false);
    // A rename onto another custom role's name would merge two grants.
    const two: WorkspaceManifest = {
      ...withReviewer(),
      roles: [
        { name: 'Reviewer', permissions: ['doc.read'] },
        { name: 'Auditor', permissions: ['doc.read'] },
      ],
    };
    expect(updateCustomRole(two, 'Reviewer', { name: 'Auditor', permissions: [] }).ok).toBe(false);
    expect(updateCustomRole(withReviewer(), 'Nobody', { name: 'X', permissions: [] }).ok).toBe(false);
  });

  it('U304: a role held by a member or by everyone-access cannot be deleted, and the error names it', () => {
    const held: WorkspaceManifest = {
      ...withReviewer(),
      members: [
        { id: 'mock-ada', role: 'Owner' },
        { id: 'mock-grace', role: 'Reviewer' },
      ],
    };
    expect(isCustomRoleInUse(held, 'Reviewer')).toBe(true);
    expect(customRoleUsage(held, 'Reviewer')).toEqual({ members: ['mock-grace'], everyone: false });
    const refused = removeCustomRole(held, 'Reviewer');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('Reviewer');
      expect(refused.error).toContain('1 member');
    }
    // A live everyone-grant counts as in use: deleting would strip it silently.
    const everyone: WorkspaceManifest = { ...withReviewer(), everyone: { enabled: true, role: 'Reviewer' } };
    expect(isCustomRoleInUse(everyone, 'Reviewer')).toBe(true);
    const byEveryone = removeCustomRole(everyone, 'Reviewer');
    expect(byEveryone.ok).toBe(false);
    if (!byEveryone.ok) expect(byEveryone.error).toContain('everyone-access');
    // Disabled everyone-access is not a live grant, so the role is free again.
    const disabled: WorkspaceManifest = { ...withReviewer(), everyone: { enabled: false, role: 'Reviewer' } };
    expect(isCustomRoleInUse(disabled, 'Reviewer')).toBe(false);
    expect(removeCustomRole(disabled, 'Reviewer').ok).toBe(true);
  });
});

// PRD 017 Req 2: the deployment-level permission names live BESIDE the
// workspace catalog, and Req 4: the implicit admin union in the one shared
// resolution path.
describe('PRD 017 Req 2+4 deployment-level permissions and the implicit admin union', () => {
  const manifest: WorkspaceManifest = {
    ...base(),
    members: [
      { id: 'mock-ada', role: 'Owner' },
      { id: 'mock-grace', role: 'Reviewer' },
    ],
    roles: [{ name: 'Reviewer', permissions: ['doc.read', 'comment.read', 'comment.write'] }],
    everyone: { enabled: false, role: 'Viewer' },
  };

  it('U809: deployment.admin and deployment.create are named outside the catalog — no role can grant them', () => {
    expect([...DEPLOYMENT_PERMISSIONS]).toEqual(['deployment.admin', 'deployment.create']);
    for (const name of DEPLOYMENT_PERMISSIONS) {
      // The fourteen-verb catalog is unchanged and rejects both names…
      expect((PERMISSIONS as readonly string[]).includes(name)).toBe(false);
      expect(isPermission(name)).toBe(false);
      // …so a custom role granting one is refused by validation, both on the
      // role-mutation path and on a whole manifest arriving from storage.
      const created = createCustomRole(manifest, { name: 'Sneaky', permissions: [name] });
      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.error).toContain(name);
      const smuggled = {
        ...manifest,
        roles: [{ name: 'Sneaky', permissions: [name] }],
      } as unknown as WorkspaceManifest;
      const parsed = parseWorkspaceManifest(JSON.stringify(smuggled));
      expect(parsed.ok).toBe(false);
    }
    expect(PERMISSIONS).toHaveLength(14);
  });

  it('U810: an admin who is not a member holds exactly the seven implicit read/administer verbs', () => {
    expect([...resolvePermissions(manifest, 'mock-katherine', true)].sort()).toEqual(
      [
        'doc.read',
        'file.download',
        'comment.read',
        'workspace.settings',
        'workspace.members',
        'workspace.roles',
        'workspace.delete',
      ].sort(),
    );
    // No write verb is ever implicit: everything outside the implicit set
    // stays withheld — doc.edit, the file writes, folder.manage, comment.write.
    const held = resolvePermissions(manifest, 'mock-katherine', true);
    for (const verb of PERMISSIONS.filter((p) => !ADMIN_IMPLICIT_PERMISSIONS.includes(p))) {
      expect(held.has(verb)).toBe(false);
    }
  });

  it('U811: membership unions with the implicit set — never an override', () => {
    // An admin who is also an Owner keeps full Owner permissions.
    expect([...resolvePermissions(manifest, 'mock-ada', true)].sort()).toEqual([...PERMISSIONS].sort());
    // An admin with a narrow custom role gets that role PLUS the implicit set.
    expect([...resolvePermissions(manifest, 'mock-grace', true)].sort()).toEqual(
      [...new Set(['doc.read', 'comment.read', 'comment.write', ...ADMIN_IMPLICIT_PERMISSIONS])].sort(),
    );
  });

  it('U812: the everyone-role unions too, and a non-admin caller is untouched', () => {
    const open: WorkspaceManifest = { ...manifest, everyone: { enabled: true, role: 'Commenter' } };
    // Admin non-member in an open workspace: Commenter ∪ the implicit seven.
    expect([...resolvePermissions(open, 'mock-katherine', true)].sort()).toEqual(
      [...new Set([...BUILT_IN_ROLES.Commenter, ...ADMIN_IMPLICIT_PERMISSIONS])].sort(),
    );
    // Non-admin callers — flag false or omitted — resolve exactly as before.
    expect([...resolvePermissions(open, 'mock-katherine', false)].sort()).toEqual(
      [...BUILT_IN_ROLES.Commenter].sort(),
    );
    expect(resolvePermissions(manifest, 'mock-katherine').size).toBe(0);
  });
});
