import { describe, expect, it } from 'vitest';
import {
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  uploadExtension,
  uploadRejection,
} from '../../src/lib/fileTransfer';
import { isMarkdownFile } from '../../src/lib/folderTree';
import { ALL_FILE_GRANTS, fileGrantsFromPermissions } from '../../src/lib/fileGrants';
import { BUILT_IN_ROLES, type Permission } from '../../src/lib/hostedWorkspace';
import { planSaveConflict, SaveConflictError, isSaveConflict } from '../../src/lib/saveConflict';

// PRD 007 Req 19+20: the rules the client and the server both run — the
// upload allowlist and cap, the permission→affordance mapping, and the
// conflict-resolution plan. All pure: no DOM, no server, no platform.

describe('PRD 007 Req 19 upload rule', () => {
  it('U295: the 20 MB cap is enforced, and the message names the limit', () => {
    expect(UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(uploadRejection('notes.md', UPLOAD_MAX_BYTES)).toBeNull(); // exactly at the cap is fine
    expect(uploadRejection('notes.md', UPLOAD_MAX_BYTES - 1)).toBeNull();
    const tooBig = uploadRejection('notes.md', UPLOAD_MAX_BYTES + 1);
    expect(tooBig).toMatch(/20 MB/);
    expect(tooBig).toMatch(/notes\.md/);
    // Size is judged before type: an oversize .exe reports the size, the one
    // rule renaming cannot work around.
    expect(uploadRejection('virus.exe', UPLOAD_MAX_BYTES + 1)).toMatch(/20 MB/);
  });

  it('U296: only Markdown and the asset types the app renders are allowed', () => {
    // The allowlist IS Markdown (folderTree's own test) plus the rendered set.
    expect(UPLOAD_EXTENSIONS.filter((e) => isMarkdownFile(`x.${e}`))).toEqual(['md', 'markdown']);
    expect([...UPLOAD_EXTENSIONS]).toEqual(['md', 'markdown', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
    for (const ext of UPLOAD_EXTENSIONS) {
      expect(uploadRejection(`file.${ext}`, 10), ext).toBeNull();
      expect(uploadRejection(`FILE.${ext.toUpperCase()}`, 10), ext).toBeNull(); // case-insensitive
    }
    // A rejection names the offending extension AND the allowed set, so the
    // user knows what would work.
    const bad = uploadRejection('report.pdf', 10);
    expect(bad).toMatch(/\.pdf/);
    expect(bad).toMatch(/\.md/);
    for (const name of ['archive.zip', 'run.exe', 'notes.txt', 'page.html']) {
      expect(uploadRejection(name, 10), name).toBeTypeOf('string');
    }
    // No extension at all is its own message, not a confusing “.” one.
    expect(uploadRejection('README', 10)).toMatch(/no file extension/);
    expect(uploadExtension('README')).toBe('');
    expect(uploadExtension('.hidden')).toBe(''); // a leading dot is not an extension
    expect(uploadExtension('a.b.PNG')).toBe('png');
  });
});

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

describe('PRD 007 Req 20 conflict resolution', () => {
  it('U298: reload, overwrite and cancel each do exactly one thing — cancel never “succeeds”', () => {
    expect(planSaveConflict('reload')).toEqual({ reload: true, write: false, dirty: false, saved: false });
    expect(planSaveConflict('overwrite')).toEqual({ reload: false, write: true, dirty: false, saved: true });
    // The whole point: dismissing leaves the buffer dirty and UNSAVED.
    expect(planSaveConflict('cancel')).toEqual({ reload: false, write: false, dirty: true, saved: false });
    // The error the platform throws instead of writing is recognisable across
    // module boundaries (App reacts to the type, never to the flavor).
    const err = new SaveConflictError('/w/1/files/a.md');
    expect(isSaveConflict(err)).toBe(true);
    expect(err.path).toBe('/w/1/files/a.md');
    expect(err.message).toMatch(/a\.md/);
    expect(isSaveConflict(new Error('write failed (500)'))).toBe(false);
  });
});
