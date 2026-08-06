/**
 * PRD 007 Req 17: which affordances the signed-in user may use — the pure
 * permission→affordance gating for the WHOLE surface: the open document, its
 * comments, and the sidebar's file rows. App code never asks which flavor it
 * is running in: a platform that answers this seam narrows what is offered,
 * and a platform that does not (desktop, the dev shim) gets `ALL_FILE_GRANTS`
 * — everything its own seams already offer. No DOM, no platform imports.
 */

import type { Permission } from './hostedWorkspace';

export interface FileGrants {
  /** Modify the open document at all: Edit Mode, Save, Save As…, the editor. */
  edit: boolean;
  /** New File. */
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
  /** Load and show the document's comments at all. */
  commentRead: boolean;
  /** Write one: the composer, replies, resolve, delete, the sidecar write. */
  commentWrite: boolean;
}

/** The unrestricted set — every flavor without a permission model. */
export const ALL_FILE_GRANTS: FileGrants = {
  edit: true,
  create: true,
  rename: true,
  delete: true,
  folderManage: true,
  upload: true,
  download: true,
  commentRead: true,
  commentWrite: true,
};

/**
 * PRD 007 Req 13+17: the catalog verbs a hosted member holds, mapped to the
 * affordances the app shows. Exactly one verb per affordance, matching the
 * one verb the corresponding endpoint requires (the route→verb table in
 * server/workspaces.ts), so the two cannot disagree about what a role means.
 * This is UI gating ONLY — every endpoint re-checks its verb server-side, so
 * a stale or forged grant set buys nothing (Req 17).
 */
export function fileGrantsFromPermissions(permissions: ReadonlySet<Permission>): FileGrants {
  return {
    edit: permissions.has('doc.edit'),
    // New File writes a blob that does not exist yet: the create verb, which
    // a custom role may grant without doc.edit (and vice versa).
    create: permissions.has('file.create'),
    rename: permissions.has('file.rename'),
    delete: permissions.has('file.delete'),
    folderManage: permissions.has('folder.manage'),
    upload: permissions.has('file.upload'),
    download: permissions.has('file.download'),
    commentRead: permissions.has('comment.read'),
    commentWrite: permissions.has('comment.write'),
  };
}
