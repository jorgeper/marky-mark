/**
 * FROZEN — a transcription of the comment-parsing path shipped in Marky Mark
 * v0.4.0-alpha.4 (`git show v0.4.0-alpha.4:src/lib/embedded.ts` and
 * `…:src/lib/sidecar.ts`). PRD 004 Req 39 needs proof that a file written by
 * TODAY's build is still read correctly by that released build — in
 * particular that `"version": "1.0.0"` where alpha.4 wrote the integer `1`
 * disturbs nothing, because alpha.4 ignores the field entirely.
 *
 * It is a record of a released binary, not a copy of live code: it must NEVER
 * be updated to track `src/`, and it deliberately imports nothing from `src/`
 * (only the type, erased at runtime). If a change to `src/` makes this reader
 * fail, that is the test doing its job — the format broke compatibility.
 */
import type { Anchor, CommentData, ThreadReply } from '../../src/lib/anchoring';

const TRAILER_RE = /\n?<!-- (?:marky-mark|markimark)-comments\n([\s\S]*?)\n-->\s*$/;

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

/** alpha.4's parseSidecar, verbatim: tolerant of unknown keys, no version check. */
export function alpha4ParseSidecar(json: string): CommentData[] {
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

/** alpha.4's splitEmbedded, verbatim. */
export function alpha4SplitEmbedded(text: string): { content: string; comments: CommentData[]; hadTrailer: boolean } {
  const m = TRAILER_RE.exec(text);
  if (!m) return { content: text, comments: [], hadTrailer: false };
  let comments: CommentData[] = [];
  try {
    comments = alpha4ParseSidecar(m[1]);
  } catch {
    /* unparseable trailer: content-less rather than a crash */
  }
  return { content: text.slice(0, m.index), comments, hadTrailer: true };
}
