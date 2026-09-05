import type { Anchor, CommentColor, CommentData, RetainedKeys, ThreadReply } from './anchoring.ts';

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
 * `2.0.0` is the PRD 023 kind split (issue #283): every record carries a
 * required `kind` discriminant — `"comment"` (body/thread/resolved) or
 * `"highlight"` (color) — a deliberate MAJOR break with the `1.x` shape.
 */
export const SUPPORTED_COMMENT_FORMAT_VERSION = '2.0.0';

/**
 * The lowest version capable of representing a comment set that uses no field
 * newer than the current baseline shape (PRD Req 23). It is deliberately its
 * own declaration and NOT derived from SUPPORTED_COMMENT_FORMAT_VERSION: the
 * two mean different things, and bumping the supported version to 2.4.0 later
 * must not silently start stamping 2.4.0 on data that 2.0.0 can hold.
 * `2.0.0` here because `kind` is required on every record (issue #283): no
 * older version can represent even the plainest 2.0.0 record.
 */
export const BASELINE_COMMENT_FORMAT_VERSION = '2.0.0';

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
 * unsupported rather than assuming a version.
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

/** The oldest version of the supported MAJOR, parsed once for comparison. */
const BASELINE_PARTS = parseFormatVersion(BASELINE_COMMENT_FORMAT_VERSION);

/**
 * Decide whether this build may interpret a resolved version: MAJOR first,
 * then MINOR; PATCH is informational and never decides (PRD Req 11).
 *
 * A greater MAJOR is unreadable by definition (PRD Req 12); a greater MINOR
 * within the supported MAJOR parses normally (PRD Req 18). Within that MAJOR
 * the floor is the baseline's MINOR, not the supported one (issue #230):
 * every minor from the baseline up to the supported one really shipped, and
 * each is the previous shape plus optional fields. Below the baseline nothing
 * of this MAJOR ever existed — Req 5's principle applies, an uninterpretable
 * version is a signal to be careful, not to guess. A *lesser* MAJOR is the
 * legacy case, decided by readCommentPayload itself (issue #283).
 */
function isSupportedVersion(version: string): boolean {
  const parts = parseFormatVersion(version);
  // All operands are version literals this module owns, so a failed parse
  // would mean the module itself is malformed: refuse rather than guess.
  if (parts === null || SUPPORTED_PARTS === null || BASELINE_PARTS === null) return false;
  return parts.major === SUPPORTED_PARTS.major && parts.minor >= BASELINE_PARTS.minor;
}

/**
 * PRD 023 §4 (issue #283): the third verdict beside supported and
 * unsupported. A resolved version at a *lesser* MAJOR than this build's is
 * legacy: a shape this build deliberately does not migrate, read as zero
 * records rather than refused, so the document opens unannotated instead of
 * frozen. Same refuse-rather-than-guess guard as isSupportedVersion.
 */
function isLegacyVersion(version: string): boolean {
  const parts = parseFormatVersion(version);
  if (parts === null || SUPPORTED_PARTS === null) return false;
  return parts.major < SUPPORTED_PARTS.major;
}

/**
 * PRD 023 §1 (issue #283): the per-kind known-key sets — what this build
 * understands on each record kind, in the exact order the writer emits.
 * `kind` leads (it is the discriminant a reader dispatches on), the shared
 * identity fields follow, then the kind's own fields, then `anchor`.
 * Everything else on a record is unknown to this build and is retained
 * verbatim rather than dropped (PRD 004 Req 19) — with one deliberate
 * exception: a key that is known to the OTHER kind (e.g. `color` on a
 * comment record, `body` on a highlight record) is a *foreign known key*.
 * It is ignored at parse — not interpreted, not bagged, not re-emitted —
 * the same stance the seam takes on a wrong-typed known key: a known key is
 * a schema question, never an unknown-key one (documented in
 * docs/COMMENT-FORMAT.md, pinned by U1088/U1122).
 */
export const COMMENT_RECORD_KEYS: readonly string[] = [
  'kind',
  'id',
  'author',
  'createdAt',
  'body',
  'resolved',
  'thread',
  'anchor',
];
export const HIGHLIGHT_RECORD_KEYS: readonly string[] = [
  'kind',
  'id',
  'author',
  'createdAt',
  'color',
  'anchor',
];
export const REPLY_KEYS: readonly string[] = ['id', 'author', 'createdAt', 'body'];
export const ANCHOR_KEYS: readonly string[] = ['exact', 'prefix', 'suffix', 'start', 'end'];

/**
 * PRD 023 §3 (issue #283): the exact highlight `color` vocabulary of format
 * 2.0.0 — `orange` replaces 1.1.0's `blue` (blue is the comment tint now).
 * The wire format admits these four literals and nothing else; the type they
 * narrow to lives with CommentData in anchoring.ts.
 */
export const COMMENT_COLORS: readonly CommentColor[] = ['yellow', 'green', 'orange', 'pink'];

const COMMENT_COLOR_SET: ReadonlySet<unknown> = new Set(COMMENT_COLORS);

/** True when `value` is one of the four color literals the format admits. */
function isCommentColor(value: unknown): value is CommentColor {
  return COMMENT_COLOR_SET.has(value);
}

// The bag filter uses the UNION of both kinds' key sets, so a foreign known
// key can never fall into the unknown-key bag by accident (issue #283): it
// is decided by the rule above, not by whichever kind the record happens
// to be.
const RECORD_KEY_SET = new Set([...COMMENT_RECORD_KEYS, ...HIGHLIGHT_RECORD_KEYS]);
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

/** True when this record, one of its replies or its anchor retained a key. */
function hasRetained(c: CommentData): boolean {
  return (
    c.extra !== undefined ||
    c.anchor.extra !== undefined ||
    (c.kind === 'comment' && c.thread.some((r) => r.extra !== undefined))
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
 * PRD 023 §1 (issue #283): the check dispatches on the required `kind`
 * discriminant first. A record with a missing, non-string or unrecognized
 * `kind` is dropped whole — never crashed on, never guessed at. A comment
 * record then needs its `body`; a highlight record needs a `color` inside
 * the four-literal vocabulary — a highlight whose color is `"blue"` (1.1.0's
 * vocabulary) or anything else outside it is dropped, deliberately harder
 * than 1.1.0's "invalid color reads as absent", because a highlight IS its
 * color: there is no colorless highlight to degrade to.
 *
 * `version` is the version the payload was interpreted at; a record that
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
      !isAnchor(c.anchor)
    ) {
      continue;
    }
    let known: CommentData;
    if (c.kind === 'comment') {
      if (typeof c.body !== 'string') continue;
      known = {
        kind: 'comment',
        id: c.id,
        author: c.author,
        createdAt: c.createdAt,
        body: c.body,
        resolved: c.resolved === true,
        thread: Array.isArray(c.thread) ? c.thread.filter(isReply).map(parseReply) : [],
        anchor: parseAnchor(c.anchor),
      };
    } else if (c.kind === 'highlight') {
      if (!isCommentColor(c.color)) continue;
      known = {
        kind: 'highlight',
        id: c.id,
        author: c.author,
        createdAt: c.createdAt,
        color: c.color,
        anchor: parseAnchor(c.anchor),
      };
    } else {
      continue; // missing/non-string/unrecognized kind: dropped whole (issue #283)
    }
    const parsed = bagUnknownKeys(known, c, RECORD_KEY_SET);
    out.push(hasRetained(parsed) ? { ...parsed, extraVersion: version } : parsed);
  }
  return out;
}

/**
 * Read a raw parsed payload (the result of `JSON.parse`, not a pre-validated
 * object) through the seam. Never throws.
 *
 * PRD 023 §4 (issue #283): a payload at a LESSER MAJOR — a `1.x` version
 * string, or a legacy coercion (the integer `1`, an absent version key, a
 * non-object payload) resolving to `1.0.0` — is supported-but-empty: it
 * contributes zero comments, raises no unreadable verdict, and is simply
 * written over by the next save (Marky Mark is unreleased; PRD 023's
 * non-goal is explicit that `1.x` stores are not migrated). A GREATER major
 * and an uninterpretable version keep PRD 004's frozen-store behaviour:
 * unsupported, zero comments, bytes preserved, authoring frozen.
 */
export function readCommentPayload(payload: unknown): CommentFormatRead {
  const record = asRecord(payload);
  const version = resolveVersion(record);
  if (version === null) {
    return { supported: false, declaredVersion: record.version };
  }
  if (isLegacyVersion(version)) {
    return { supported: true, version, comments: [] }; // readable, and empty by design
  }
  if (!isSupportedVersion(version)) {
    return { supported: false, declaredVersion: record.version };
  }
  return { supported: true, version, comments: parseEntries(record.comments, version) };
}

/**
 * The version to stamp on a write: the lowest one capable of representing the
 * data (PRD Req 23), which is the baseline unless some record carries fields
 * retained from a newer version (PRD Req 24). It defers to the retained
 * *fields*, not to the version a file happened to declare, and when records
 * from several reads are written together (mergeComments) the highest wins.
 * Every 2.0.0 field's Min version IS the baseline (the kind split landed
 * whole, issue #283), so no per-field minimum outranks it today; a future
 * optional field brings its own Min literal here, like 1.1.0's `color` did.
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
 * One anchor as it is written: ANCHOR_KEYS in their fixed order, then the
 * keys that anchor retained. Shared by both record kinds, whose anchors are
 * the same object (PRD 023 §1, issue #283) — written once so the two branches
 * of commentPayload differ only where the kinds themselves do.
 */
function anchorPayload(anchor: Anchor) {
  return withRetained(
    {
      exact: anchor.exact,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      start: anchor.start,
      end: anchor.end,
    },
    anchor.extra,
  );
}

/**
 * The payload both stores write: the same schema, the same `version` key in
 * the same place (PRD Req 26), differing only by container. Known keys are
 * emitted in the fixed per-kind order of COMMENT_RECORD_KEYS /
 * HIGHLIGHT_RECORD_KEYS and retained keys follow in the order they were
 * read, so serializing twice produces identical bytes (PRD Req 27). The bag
 * is an in-memory field only — `extra`/`extraVersion` are never emitted, only
 * their contents, at the level they were read from.
 */
export function commentPayload(comments: readonly CommentData[]): {
  version: string;
  comments: unknown[];
} {
  return {
    version: stampedFormatVersion(comments),
    comments: comments.map((c) =>
      withRetained(
        c.kind === 'comment'
          ? {
              kind: c.kind,
              id: c.id,
              author: c.author,
              createdAt: c.createdAt,
              body: c.body,
              resolved: c.resolved,
              thread: c.thread.map((r) =>
                withRetained({ id: r.id, author: r.author, createdAt: r.createdAt, body: r.body }, r.extra),
              ),
              anchor: anchorPayload(c.anchor),
            }
          : {
              kind: c.kind,
              id: c.id,
              author: c.author,
              createdAt: c.createdAt,
              color: c.color,
              anchor: anchorPayload(c.anchor),
            },
        c.extra,
      ),
    ),
  };
}
