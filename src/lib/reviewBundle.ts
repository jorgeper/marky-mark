/**
 * SPEC16 §1: review bundles. buildReviewBundle bakes a document (markdown
 * with its embedded-comment trailer) into the single-file web viewer as an
 * inert JSON payload; the web build's boot path extracts it and opens the
 * document in memory. Pure — shared by the exporter, the web platform, and
 * the tests. JSON is escaped so `</script>` / `<!--` inside documents can
 * never break out of the script element.
 */

export const REVIEW_PAYLOAD_ID = 'mm-review-doc';

export interface ReviewPayload {
  name: string;
  markdown: string;
}

/** The document surface extract needs — satisfied by `document` and stubs. */
export interface PayloadHost {
  getElementById(id: string): { textContent: string | null } | null;
}

export function buildReviewBundle(templateHtml: string, payload: ReviewPayload): string {
  // The LAST </head>: the single-file viewer inlines all its JS into <head>,
  // and that JS (this very function included) contains the literal string —
  // the document's real head close is the final occurrence.
  const at = templateHtml.lastIndexOf('</head>');
  if (at === -1) throw new Error('review template has no </head>');
  // `<` → < inside JSON strings: no `</script>`, no `<!--`, still JSON.
  const json = JSON.stringify({ name: payload.name, markdown: payload.markdown }).replace(/</g, '\\u003c');
  const script = `<script type="application/json" id="${REVIEW_PAYLOAD_ID}">${json}</script>`;
  return templateHtml.slice(0, at) + script + templateHtml.slice(at);
}

export function extractReviewPayload(host: PayloadHost): ReviewPayload | null {
  const el = host.getElementById(REVIEW_PAYLOAD_ID);
  if (!el?.textContent) return null;
  try {
    const data = JSON.parse(el.textContent) as { name?: unknown; markdown?: unknown };
    if (typeof data.name === 'string' && data.name && typeof data.markdown === 'string') {
      return { name: data.name, markdown: data.markdown };
    }
  } catch {
    /* not a payload */
  }
  return null;
}
