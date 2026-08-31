import { describe, expect, it } from 'vitest';
import { ALL_FILE_GRANTS, fileGrantsFromPermissions } from '../../src/lib/fileGrants';
import { BUILT_IN_ROLES, PERMISSIONS, type Permission } from '../../src/lib/hostedWorkspace';

// PRD 007 Req 17: the catalog verbs a member holds, mapped to the affordances
// they may use — the open document, its comments and the sidebar's rows. UI
// gating only — every endpoint re-checks its own verb — so this is pure: no
// DOM, no server, no platform.

const grants = (role: keyof typeof BUILT_IN_ROLES) =>
  fileGrantsFromPermissions(new Set<Permission>(BUILT_IN_ROLES[role]));

describe('PRD 007 Req 17 permission → affordance', () => {
  it('U839: each built-in role gets exactly the sidebar affordances its verbs allow', () => {
    // Owner and Editor hold the whole file/folder set.
    expect(grants('Owner')).toEqual(ALL_FILE_GRANTS);
    expect(grants('Editor')).toEqual(ALL_FILE_GRANTS);
    // Contributor may create and upload but not rename, delete or manage folders.
    expect(grants('Contributor')).toEqual({
      edit: true,
      create: true,
      rename: false,
      delete: false,
      folderManage: false,
      upload: true,
      download: true,
      commentRead: true,
      commentWrite: true,
    });
    // A Viewer sees no management affordance at all — only download.
    expect(grants('Viewer')).toEqual({
      edit: false,
      create: false,
      rename: false,
      delete: false,
      folderManage: false,
      upload: false,
      download: true,
      commentRead: true,
      commentWrite: false,
    });
    // No verbs at all ⇒ nothing offered.
    expect(fileGrantsFromPermissions(new Set())).toEqual({
      edit: false,
      create: false,
      rename: false,
      delete: false,
      folderManage: false,
      upload: false,
      download: false,
      commentRead: false,
      commentWrite: false,
    });
  });

  it('U320: the document and comment affordances separate a Commenter from a Viewer', () => {
    // PRD 007 Req 14+17: the headline distinction the two read-only roles
    // have — a Commenter may write a comment on a document they may not
    // change; a Viewer may read the same comments and write neither.
    expect(grants('Commenter')).toMatchObject({ edit: false, commentRead: true, commentWrite: true });
    expect(grants('Viewer')).toMatchObject({ edit: false, commentRead: true, commentWrite: false });
    // Only the comment verbs tell them apart — everything else matches.
    expect({ ...grants('Commenter'), commentWrite: false }).toEqual(grants('Viewer'));
    // Editing a document is doc.edit and creating one is file.create: an
    // Editor holds both, and every built-in that holds neither is read-only.
    expect(grants('Editor')).toMatchObject({ edit: true, create: true });
    for (const role of ['Commenter', 'Viewer'] as const) {
      expect(grants(role)).toMatchObject({ edit: false, create: false });
    }
  });

  it('U321: a restricted custom role gets exactly its own verbs — each affordance maps to exactly one', () => {
    // PRD 007 Req 15: custom roles are why no affordance may stand for two
    // verbs. A role with file.create and NOT doc.edit may make new files and
    // change none of them; the mirror image may change what exists and make
    // nothing new.
    const creator = fileGrantsFromPermissions(new Set<Permission>(['doc.read', 'file.create']));
    expect(creator).toMatchObject({ create: true, edit: false });
    const editor = fileGrantsFromPermissions(new Set<Permission>(['doc.read', 'doc.edit']));
    expect(editor).toMatchObject({ create: false, edit: true });
    // comment.write without comment.read is a role that may write comments it
    // cannot see: the mapping reports exactly that rather than inventing a
    // dependency the server does not enforce either.
    const blind = fileGrantsFromPermissions(new Set<Permission>(['doc.read', 'comment.write']));
    expect(blind).toMatchObject({ commentRead: false, commentWrite: true });
    // One verb, one affordance: dropping any single verb from the full
    // catalog flips exactly one field off.
    const all = fileGrantsFromPermissions(new Set<Permission>(PERMISSIONS));
    expect(all).toEqual(ALL_FILE_GRANTS);
    for (const verb of PERMISSIONS) {
      const without = fileGrantsFromPermissions(
        new Set<Permission>(PERMISSIONS.filter((p) => p !== verb)),
      );
      const flipped = Object.keys(all).filter(
        (k) => all[k as keyof typeof all] !== without[k as keyof typeof without],
      );
      // doc.read is the price of admission (without it there is no workspace
      // to show at all) and the workspace.* verbs drive the settings
      // surfaces — neither is one of these affordances.
      const unmapped = verb === 'doc.read' || verb.startsWith('workspace.');
      expect(flipped.length, verb).toBe(unmapped ? 0 : 1);
    }
  });
});
