/**
 * SPEC11 §2.1: image sources are local-only — remote srcs (http/https/
 * protocol-relative) never load; callers render the blocked-origin
 * placeholder instead. PRD 021 Req 6 (issue #236) keeps these two helpers
 * as a pure module with no unified/remark or other app imports, so the
 * edit-pane widget (`components/imageView.ts`) shares the exact test and
 * label with the preview pipeline (`lib/markdown.ts`) without the editing
 * surface reaching the markdown pipeline.
 */

const REMOTE_SRC = /^(?:https?:)?\/\//i;

/** SPEC41 §2.1: the edit-pane widget applies the same remote-src test. */
export function isRemoteSrc(src: string): boolean {
  return REMOTE_SRC.test(src);
}

/** Hostname for the placeholder label; tolerant of unparsable URLs. */
export function remoteHost(src: string): string {
  try {
    return new URL(src.startsWith('//') ? `https:${src}` : src).hostname || 'remote host';
  } catch {
    return 'remote host';
  }
}
