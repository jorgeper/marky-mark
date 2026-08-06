/**
 * PRD 007 Req 19: the single-file upload rule — the 20 MB cap and the
 * Markdown-plus-rendered-asset allowlist — as one pure function shared by the
 * client (which rejects before uploading anything, naming the rule that
 * failed) and the server (`server/workspaces.ts`, which enforces it again so a
 * hand-rolled request cannot bypass the UI, PRD 007 Req 17). No DOM and no
 * platform imports: the whole rule is unit-testable without either side.
 */

/** PRD 007 Req 19: the cap, in bytes. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** Human form of the cap, for the rejection message. */
export const UPLOAD_MAX_LABEL = '20 MB';

/**
 * PRD 007 Req 19: what may be uploaded — Markdown (`isMarkdownFile` in
 * folderTree.ts) plus exactly the asset types the app renders (the
 * `RAW_CONTENT_TYPES` set the server stores raw bytes under, which is also
 * the desktop image dialog's filter). Anything else is a rejection, not a
 * silently stored blob nobody can open.
 */
export const UPLOAD_EXTENSIONS = [
  'md',
  'markdown',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
] as const;

/** The extension of `name`, lowercased and without the dot ('' when none). */
export function uploadExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * PRD 007 Req 19: why this upload is refused, or null when it is allowed.
 * The message names the rule that failed — the limit for an oversize file,
 * the offending extension and the allowed set for a disallowed one — because
 * "upload failed" tells the user nothing about what to do next. Size is
 * checked first: an oversize `.exe` is both, and the cheaper fix to report is
 * the one the user cannot work around by renaming.
 */
export function uploadRejection(name: string, size: number): string | null {
  if (size > UPLOAD_MAX_BYTES) {
    return `“${name}” is larger than the ${UPLOAD_MAX_LABEL} upload limit`;
  }
  const ext = uploadExtension(name);
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return ext
      ? `“.${ext}” files cannot be uploaded — allowed: ${UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(', ')}`
      : `“${name}” has no file extension — allowed: ${UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(', ')}`;
  }
  return null;
}
