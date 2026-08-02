import type { CommentData } from './anchoring';
import { commentPayload, readCommentPayload } from './commentFormat';

/**
 * Sidecar (.md.comments.json) serialization. The schema is byte-schema
 * compatible with the sibling md-with-comments app:
 *   { version, comments: [{ id, author, createdAt, body, resolved, thread[], anchor }] }
 * Pretty-printed with 2-space indent so sidecars diff cleanly in git.
 *
 * The entry schema, the version decision and the unknown-key bag all live in
 * commentFormat.ts (PRD 004 Req 29): this module is the container — JSON text
 * in a file next to the document — and nothing more.
 */

export function sidecarPathFor(docPath: string): string {
  return `${docPath}.comments.json`;
}

/** What a sidecar read yielded, including whether it was readable at all. */
export interface SidecarRead {
  /** Comments parsed from the sidecar; [] when it was not readable. */
  comments: CommentData[];
  /** False when the sidecar declares a version this build may not interpret. */
  readable: boolean;
  /** Set only when `readable` is false: the version exactly as declared. */
  declaredVersion?: unknown;
}

/**
 * Read sidecar JSON text through the seam. Throws only on unparseable JSON,
 * as before. A sidecar at an unsupported MAJOR (or with a present but
 * uninterpretable version) is reported unreadable and yields zero comments
 * rather than a best-effort subset (PRD Req 12); entries that fail the schema
 * check are still skipped individually (PRD Req 22).
 */
export function readSidecar(json: string): SidecarRead {
  const read = readCommentPayload(JSON.parse(json));
  if (!read.supported) return { comments: [], readable: false, declaredVersion: read.declaredVersion };
  return { comments: read.comments, readable: true };
}

/** Parse sidecar JSON text into comments (the comments-only view of a read). */
export function parseSidecar(json: string): CommentData[] {
  return readSidecar(json).comments;
}

/** Serialize comments to pretty-printed sidecar JSON (trailing newline). */
export function serializeSidecar(comments: CommentData[]): string {
  return `${JSON.stringify(commentPayload(comments), null, 2)}\n`;
}
