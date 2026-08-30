// This mapping lives in its own module rather than inside
// server/workspaces.ts so any storage-seam code that needs a content type
// for a path derives exactly what the API layer would have written, not a
// second opinion.

/**
 * PRD 007 Req 8: the media type a raw blob is stored and served with,
 * derived from its extension ALONE. The uploader's Content-Type is
 * deliberately ignored: these bytes come back from the app's own origin, so
 * letting a caller label an upload `text/html` would turn a pasted "image"
 * into stored same-origin script. Anything unrecognised is a download.
 */
const RAW_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'application/octet-stream', // SVG is script-capable — never served as an image
};

export function contentTypeFor(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return RAW_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}
