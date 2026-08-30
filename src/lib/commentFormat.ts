import type { Anchor, CommentData, RetainedKeys, ThreadReply } from './anchoring.ts';

/**
 * The comment-format migration seam (PRD 004 §F): the single chokepoint that
 * every comment-store read passes through. It takes what `JSON.parse`
 * produced, decides whether this build may interpret it, and reports either
 * the current in-memory shape or an explicit "unsupported, do not parse".
 * It also owns the write side of the shared payload — the entry schema, the
 * unknown-key bag and the stamped version — so sidecar.ts and embedded.ts
 * differ only by container (PRD Req 26).
 *
 * Pure module: no DOM, no React, no platform imports — same as embedded.ts
 * and sidecar.ts, both of which read and write through it (issue #15).
 */

/**
 * The highest comment-format version this build supports (PRD Req 2, Req 11),
 * declared exactly once. Deliberately unrelated to the app version in
 * package.json — the format and the app move independently (PRD non-goals).
 * `1.0.0` is a name for the comment/reply/anchor shape that already ships.
 */
export const SUPPORTED_COMMENT_FORMAT_VERSION = '1.0.0';

/**
 * The lowest version capable of representing a comment set that uses no field
 * newer than the original shape (PRD Req 23). It is deliberately its own
 * declaration and NOT derived from SUPPORTED_COMMENT_FORMAT_VERSION: the two
 * mean different things, and bumping the supported version to 1.4.0 later must
 * not silently start stamping 1.4.0 on data that 1.0.0 can hold.
 */
export const BASELINE_COMMENT_FORMAT_VERSION = '1.0.0';

/** A version parsed into its three numeric components. */
export interface FormatVersionParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

// PRD Req 1: a valid version is MAJOR.MINOR.PATCH, each component a run of
// digits. Nothing else qualifies — no "v" prefix, no pre-release suffix, no
// two- or four-component forms.
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parse a `MAJOR.MINOR.PATCH` version string; null when it is not one. */
export function parseFormatVersion(value: unknown): FormatVersionParts | null {
  if (typeof value !== 'string') return null;
  const m = VERSION_RE.exec(value);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** True when `value` is a valid `MAJOR.MINOR.PATCH` version string. */
export function isFormatVersion(value: unknown): value is string {
  return parseFormatVersion(value) !== null;
}

/**
 * Order two versions: negative when `a` precedes `b`, 0 when they are equal,
 * positive when `a` follows it. MAJOR, then MINOR, then PATCH — PATCH orders
 * here even though it never decides supportability (Req 11), because picking
 * the highest version a write needs is a total order, not a support question.
 * An uninterpretable version sorts below every valid one: it can never win the
 * "highest retained version" contest and so can never be stamped.
 */
export function compareFormatVersions(a: unknown, b: unknown): number {
  const pa = parseFormatVersion(a);
  const pb = parseFormatVersion(b);
  if (pa === null && pb === null) return 0;
  if (pa === null) return -1;
  if (pb === null) return 1;
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/**
 * A registered transformation: how a payload this build recognizes but that
 * does not carry a valid version string is interpreted. The table is ordered
 * and a future step is appended here — but per PRD Req 30 no speculative step
 * is written for a version that does not exist, so today it holds exactly the
 * two legacy coercions of Req 3 and Req 4.
 */
interface MigrationStep {
  /** Why the step exists, so the table reads as a changelog. */
  readonly reason: string;
  /** True when this step is the one that interprets `payload`. */
  readonly recognizes: (payload: Record<string, unknown>) => boolean;
  /**
   * The format version a recognized payload is interpreted as. It is the
   * version that legacy encoding *is*, not the version this build supports,
   * so it stays a literal even once SUPPORTED_COMMENT_FORMAT_VERSION moves on.
   */
  readonly resolvesTo: string;
}

const MIGRATIONS: readonly MigrationStep[] = [
  {
    reason: 'PRD Req 3: existing embedded trailers carry the integer version 1.',
    recognizes: (payload) => payload.version === 1,
    resolvesTo: '1.0.0',
  },
  {
    reason: 'PRD Req 4: existing sidecars carry no version key at all.',
    recognizes: (payload) => !('version' in payload),
    resolvesTo: '1.0.0',
  },
];

/**
 * The result of reading a payload through the seam. The `supported`
 * discriminant is what makes it a type error to read comments off the
 * unsupported branch (PRD Req 29): that branch has no `comments` property at
 * all, only the version as it was declared, for the indication issue #16 adds.
 */
export type CommentFormatRead =
  | {
      readonly supported: true;
      /** The version the payload was interpreted at, after any coercion. */
      readonly version: string;
      readonly comments: CommentData[];
    }
  | {
      readonly supported: false;
      /** The declared version exactly as it appeared in the payload. */
      readonly declaredVersion: unknown;
    };

/**
 * Narrow a raw parsed payload to a plain record. A payload that is not one —
 * null, a string, a number, an array — becomes the empty record: it declares
 * no version and holds no comments, which is exactly how parseSidecar treats
 * such input today, and it keeps every step below free of a null case.
 */
function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

/**
 * Resolve the version a payload is to be interpreted at: a registered
 * transformation first, then a valid version string taken at face value.
 * null means the declared version is uninterpretable — per PRD Req 5 that is
 * a signal to be careful, not to guess, so the caller treats it as
 * unsupported rather than assuming 1.0.0.
 */
function resolveVersion(record: Record<string, unknown>): string | null {
  for (const step of MIGRATIONS) {
    if (step.recognizes(record)) return step.resolvesTo;
  }
  const declared = record.version;
  return isFormatVersion(declared) ? declared : null;
}

/** The version this build supports, parsed once for comparison. */
const SUPPORTED_PARTS = parseFormatVersion(SUPPORTED_COMMENT_FORMAT_VERSION);

/**
 * Decide whether this build may interpret a resolved version: MAJOR first,
 * then MINOR; PATCH is informational and never decides (PRD Req 11).
 *
 * A greater MAJOR is unreadable by definition (PRD Req 12); a greater MINOR
 * within the supported MAJOR parses normally (PRD Req 18). A version below
 * the supported one is unsupported too: no transformation is registered for
 * it, and PRD Req 30 forbids inventing one for a version that never existed —
 * Req 5's principle applies, an uninterpretable version is a signal to be
 * careful, not to guess.
 */
function isSupportedVersion(version: string): boolean {
  const parts = parseFormatVersion(version);
  // Both operands are version literals this module owns, so a failed parse
  // would mean the module itself is malformed: refuse rather than guess.
  if (parts === null || SUPPORTED_PARTS === null) return false;
  return parts.major === SUPPORTED_PARTS.major && parts.minor >= SUPPORTED_PARTS.minor;
}

/**
 * The keys this build understands at each level of the payload. Everything
 * else on an entry is unknown to this build and is retained verbatim rather
 * than dropped (PRD Req 19); a key listed here is parsed by the build's own
 * rules and is never also bagged (PRD Req 20), including when its value has
 * the wrong type — a wrong-typed known key is a schema question, not an
 * unknown one.
 */
export const COMMENT_KEYS: readonly string[] = [
  'id',
  'author',
  'createdAt',
  'body',
  'resolved',
  'thread',
  'anchor',
];
export const REPLY_KEYS: readonly string[] = ['id', 'author', 'createdAt', 'body'];
export const ANCHOR_KEYS: readonly string[] = ['exact', 'prefix', 'suffix', 'start', 'end'];

const COMMENT_KEY_SET = new Set(COMMENT_KEYS);
const REPLY_KEY_SET = new Set(REPLY_KEYS);
const ANCHOR_KEY_SET = new Set(ANCHOR_KEYS);

/**
 * Build the in-memory object for one level of the payload: the known keys the
 * caller has already extracted, plus a bag holding every key of the raw object
 * this build does not recognize (PRD Req 19). The bag is absent rather than
 * empty when there was nothing unknown, so an ordinary payload parses to
 * exactly the objects the pre-#15 code produced. Built with
 * Object.fromEntries, which defines own properties, so a key named
 * `__proto__` cannot reach the prototype setter.
 */
function bagUnknownKeys<T extends { extra?: RetainedKeys }>(
  known: T,
  raw: Record<string, unknown>,
  knownKeys: ReadonlySet<string>,
): T {
  const unknown = Object.entries(raw).filter(([key]) => !knownKeys.has(key));
  if (unknown.length === 0) return known;
  return { ...known, extra: Object.fromEntries(unknown) };
}

/** True when this comment, one of its replies or its anchor retained a key. */
function hasRetained(c: CommentData): boolean {
  return (
    c.extra !== undefined ||
    c.anchor.extra !== undefined ||
    c.thread.some((r) => r.extra !== undefined)
  );
}

/** Re-attach a bag's retained keys to a freshly built known-key object for output. */
function withRetained<T extends object>(known: T, extra: RetainedKeys | undefined): T {
  if (!extra) return known;
  // A retained key can never shadow a known one (Req 20): the filter drops any
  // collision — own keys only, so a retained key that happens to be named
  // after something on Object.prototype still survives — and spreading
  // (rather than assigning) keeps `__proto__` an ordinary key.
  const fresh = Object.fromEntries(
    Object.entries(extra).filter(([k]) => !Object.prototype.hasOwnProperty.call(known, k)),
  );
  return { ...known, ...fresh } as T;
}

function isReply(r: unknown): r is Record<string, unknown> {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.author === 'string' &&
    typeof o.createdAt === 'string' &&
    typeof o.body === 'string'
  );
}

function isAnchor(a: unknown): a is Record<string, unknown> {
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

function parseReply(o: Record<string, unknown>): ThreadReply {
  const reply: ThreadReply = {
    id: o.id as string,
    author: o.author as string,
    createdAt: o.createdAt as string,
    body: o.body as string,
  };
  return bagUnknownKeys(reply, o, REPLY_KEY_SET);
}

function parseAnchor(o: Record<string, unknown>): Anchor {
  const anchor: Anchor = {
    exact: o.exact as string,
    prefix: o.prefix as string,
    suffix: o.suffix as string,
    start: o.start as number,
    end: o.end as number,
  };
  return bagUnknownKeys(anchor, o, ANCHOR_KEY_SET);
}

/**
 * The entry-level schema check and the in-memory shape it produces, in exactly
 * one place (the stores call it through readCommentPayload, and nothing
 * re-serializes a payload in order to parse it). An entry that fails the check
 * is skipped rather than crashing the parse (PRD Req 22) — and is skipped
 * whole, so it takes its unknown keys with it: retention applies to entries
 * that parse, deliberately, because a bag with nothing valid to hang off has
 * nowhere to be re-emitted from.
 *
 * `version` is the version the payload was interpreted at; a comment that
 * retained anything from it remembers it, which is how a newer minor survives
 * a read → write round-trip without the caller threading it (PRD Req 21/24).
 */
function parseEntries(list: unknown, version: string): CommentData[] {
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
    const comment: CommentData = {
      id: c.id,
      author: c.author,
      createdAt: c.createdAt,
      body: c.body,
      resolved: c.resolved === true,
      thread: Array.isArray(c.thread) ? c.thread.filter(isReply).map(parseReply) : [],
      anchor: parseAnchor(c.anchor),
    };
    const parsed = bagUnknownKeys(comment, c, COMMENT_KEY_SET);
    out.push(hasRetained(parsed) ? { ...parsed, extraVersion: version } : parsed);
  }
  return out;
}

/**
 * Read a raw parsed payload (the result of `JSON.parse`, not a pre-validated
 * object) through the seam. Never throws: a payload that is not an object at
 * all carries no version key, so it is interpreted at 1.0.0 and contributes
 * zero comments — matching what parseSidecar did with such input before #15.
 */
export function readCommentPayload(payload: unknown): CommentFormatRead {
  const record = asRecord(payload);
  const version = resolveVersion(record);
  if (version === null || !isSupportedVersion(version)) {
    return { supported: false, declaredVersion: record.version };
  }
  return { supported: true, version, comments: parseEntries(record.comments, version) };
}

/**
 * The version to stamp on a write: the lowest one capable of representing the
 * data (PRD Req 23), which is the baseline unless some comment carries fields
 * retained from a newer version (PRD Req 24). It defers to the retained
 * *fields*, not to the version a file happened to declare, and when comments
 * from several reads are written together (mergeComments) the highest wins.
 */
export function stampedFormatVersion(comments: readonly CommentData[]): string {
  let stamp = BASELINE_COMMENT_FORMAT_VERSION;
  for (const c of comments) {
    if (!hasRetained(c) || c.extraVersion === undefined) continue;
    if (compareFormatVersions(c.extraVersion, stamp) > 0) stamp = c.extraVersion;
  }
  return stamp;
}

/**
 * The payload both stores write: the same schema, the same `version` key in
 * the same place (PRD Req 26), differing only by container. Known keys are
 * emitted in a fixed order and retained keys follow in the order they were
 * read, so serializing twice produces identical bytes (PRD Req 27). The bag is
 * an in-memory field only — `extra`/`extraVersion` are never emitted, only
 * their contents, at the level they were found at.
 */
export function commentPayload(comments: readonly CommentData[]): {
  version: string;
  comments: unknown[];
} {
  return {
    version: stampedFormatVersion(comments),
    comments: comments.map((c) =>
      withRetained(
        {
          id: c.id,
          author: c.author,
          createdAt: c.createdAt,
          body: c.body,
          resolved: c.resolved,
          thread: c.thread.map((r) =>
            withRetained({ id: r.id, author: r.author, createdAt: r.createdAt, body: r.body }, r.extra),
          ),
          anchor: withRetained(
            {
              exact: c.anchor.exact,
              prefix: c.anchor.prefix,
              suffix: c.anchor.suffix,
              start: c.anchor.start,
              end: c.anchor.end,
            },
            c.anchor.extra,
          ),
        },
        c.extra,
      ),
    ),
  };
}
