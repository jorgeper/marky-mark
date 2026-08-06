/**
 * PRD 007 Req 17: which file-management affordances the signed-in user may
 * use — the pure permission→menu-item gating. App code never asks which
 * flavor it is running in: a platform that answers this seam narrows the
 * sidebar's menu items and drop targets, and a platform that does not
 * (desktop, the dev shim) gets `ALL_FILE_GRANTS` — everything its own seams
 * already offer. No DOM, no platform imports.
 */

import type { Permission } from './hostedWorkspace';

export interface FileGrants {
  /** New File / New Folder. */
  create: boolean;
  /** Rename or move a file (SPEC35's rename seam covers both). */
  rename: boolean;
  /** Delete a file. */
  delete: boolean;
  /** Create, rename, move or delete a folder. */
  folderManage: boolean;
  /** PRD 007 Req 19: single-file upload. */
  upload: boolean;
  /** PRD 007 Req 19: single-file download. */
  download: boolean;
}

/** The unrestricted set — every flavor without a permission model. */
export const ALL_FILE_GRANTS: FileGrants = {
  create: true,
  rename: true,
  delete: true,
  folderManage: true,
  upload: true,
  download: true,
};

/**
 * PRD 007 Req 13+17+18/19: the catalog verbs a hosted member holds, mapped to
 * the affordances the sidebar shows. This is UI gating ONLY — every endpoint
 * re-checks its one verb server-side, so a stale or forged grant set buys
 * nothing (Req 17).
 */
export function fileGrantsFromPermissions(permissions: ReadonlySet<Permission>): FileGrants {
  return {
    // New File writes a blob: the same verb the save path needs.
    create: permissions.has('doc.edit'),
    rename: permissions.has('file.rename'),
    delete: permissions.has('file.delete'),
    folderManage: permissions.has('folder.manage'),
    upload: permissions.has('file.upload'),
    download: permissions.has('file.download'),
  };
}
