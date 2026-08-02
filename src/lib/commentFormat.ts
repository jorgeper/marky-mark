import type { CommentData } from './anchoring';
import { parseSidecar } from './sidecar';

/**
 * The comment-format migration seam (PRD 004 §F): the single chokepoint that
 * every comment-store read passes through. It takes what `JSON.parse`
 * produced, decides whether this build may interpret it, and reports either
 * the current in-memory shape or an explicit "unsupported, do not parse".
 *
 * Pure module: no DOM, no React, no platform imports — same as embedded.ts
 * and sidecar.ts. Nothing outside tests/ imports it yet; wiring the two
 * stores through it is issue #15.
 */

/**
 * The highest comment-format version this build supports (PRD Req 2, Req 11),
 * declared exactly once. Deliberately unrelated to the app version in
 * package.json — the format and the app move independently (PRD non-goals).
 * `1.0.0` is a name for the comment/reply/anchor shape that already ships.
 */
export const SUPPORTED_COMMENT_FORMAT_VERSION = '1.0.0';

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
 * Extract comments in the current in-memory shape. The entry-level schema
 * check lives in parseSidecar and is deliberately not duplicated here (it
 * would be free to drift); issue #15 lifts that check out of sidecar.ts so
 * this re-serialization round-trip goes away. Anything JSON.stringify cannot
 * represent — never produced by JSON.parse — contributes zero comments rather
 * than throwing.
 */
function extractComments(record: Record<string, unknown>): CommentData[] {
  try {
    return parseSidecar(JSON.stringify({ comments: record.comments ?? [] }));
  } catch {
    return [];
  }
}

/**
 * Read a raw parsed payload (the result of `JSON.parse`, not a pre-validated
 * object) through the seam. Never throws: a payload that is not an object at
 * all carries no version key, so it is interpreted at 1.0.0 and contributes
 * zero comments — matching what parseSidecar does with such input today.
 */
export function readCommentPayload(payload: unknown): CommentFormatRead {
  const record = asRecord(payload);
  const version = resolveVersion(record);
  if (version === null || !isSupportedVersion(version)) {
    return { supported: false, declaredVersion: record.version };
  }
  return { supported: true, version, comments: extractComments(record) };
}
