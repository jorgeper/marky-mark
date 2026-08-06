import { describe, expect, it } from 'vitest';
import { ALL_FILE_GRANTS, fileGrantsFromPermissions } from '../../src/lib/fileGrants';
import { BUILT_IN_ROLES, type Permission } from '../../src/lib/hostedWorkspace';

// PRD 007 Req 17: the catalog verbs a member holds, mapped to the sidebar
// affordances they may use. UI gating only — every endpoint re-checks its own
// verb — so this is pure: no DOM, no server, no platform.

describe('PRD 007 Req 17 permission → affordance', () => {
  it('U297: each built-in role gets exactly the sidebar affordances its verbs allow', () => {
    const grants = (role: keyof typeof BUILT_IN_ROLES) =>
      fileGrantsFromPermissions(new Set<Permission>(BUILT_IN_ROLES[role]));
    // Owner and Editor hold the whole file/folder set.
    expect(grants('Owner')).toEqual(ALL_FILE_GRANTS);
    expect(grants('Editor')).toEqual(ALL_FILE_GRANTS);
    // Contributor may create and upload but not rename, delete or manage folders.
    expect(grants('Contributor')).toEqual({
      create: true,
      rename: false,
      delete: false,
      folderManage: false,
      upload: true,
      download: true,
    });
    // A Viewer sees no management affordance at all — only download.
    expect(grants('Viewer')).toEqual({
      create: false,
      rename: false,
      delete: false,
      folderManage: false,
      upload: false,
      download: true,
    });
    expect(grants('Commenter')).toEqual(grants('Viewer'));
    // No verbs at all ⇒ nothing offered.
    expect(fileGrantsFromPermissions(new Set())).toEqual({
      create: false,
      rename: false,
      delete: false,
      folderManage: false,
      upload: false,
      download: false,
    });
  });
});
