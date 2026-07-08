import type { Anchor, CommentData, ThreadReply } from './anchoring';

/**
 * Sidecar (.md.comments.json) serialization. The schema is byte-schema
 * compatible with the sibling md-with-comments app:
 *   { comments: [{ id, author, createdAt, body, resolved, thread[], anchor }] }
 * Pretty-printed with 2-space indent so sidecars diff cleanly in git.
 */

export function sidecarPathFor(docPath: string): string {
  return `${docPath}.comments.json`;
}

function isReply(r: unknown): r is ThreadReply {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.author === 'string' &&
    typeof o.createdAt === 'string' &&
    typeof o.body === 'string'
  );
}

function isAnchor(a: unknown): a is Anchor {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o.exact === 'string' &&
    typeof o.prefix === 'string' &&
    typeof o.suffix === 'string' &&
    typeof o.start === 'number' &&
    typeof o.end === 'number'
  );
}

/**
 * Parse sidecar JSON text into comments. Tolerant of unknown extra keys
 * (they are dropped); throws only on unparseable JSON. Entries that do not
 * conform to the schema are skipped rather than crashing the app.
 */
export function parseSidecar(json: string): CommentData[] {
  const data: unknown = JSON.parse(json);
  if (typeof data !== 'object' || data === null) return [];
  const list = (data as Record<string, unknown>).comments;
  if (!Array.isArray(list)) return [];
  const out: CommentData[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as Record<string, unknown>;
    if (
      typeof c.id !== 'string' ||
      typeof c.author !== 'string' ||
      typeof c.createdAt !== 'string' ||
      typeof c.body !== 'string' ||
      !isAnchor(c.anchor)
    ) {
      continue;
    }
    const thread = Array.isArray(c.thread) ? c.thread.filter(isReply) : [];
    out.push({
      id: c.id,
      author: c.author,
      createdAt: c.createdAt,
      body: c.body,
      resolved: c.resolved === true,
      thread,
      anchor: {
        exact: c.anchor.exact,
        prefix: c.anchor.prefix,
        suffix: c.anchor.suffix,
        start: c.anchor.start,
        end: c.anchor.end,
      },
    });
  }
  return out;
}

/** Serialize comments to pretty-printed sidecar JSON (trailing newline). */
export function serializeSidecar(comments: CommentData[]): string {
  const clean = comments.map((c) => ({
    id: c.id,
    author: c.author,
    createdAt: c.createdAt,
    body: c.body,
    resolved: c.resolved,
    thread: c.thread.map((r) => ({ id: r.id, author: r.author, createdAt: r.createdAt, body: r.body })),
    anchor: {
      exact: c.anchor.exact,
      prefix: c.anchor.prefix,
      suffix: c.anchor.suffix,
      start: c.anchor.start,
      end: c.anchor.end,
    },
  }));
  return `${JSON.stringify({ comments: clean }, null, 2)}\n`;
}
