// PRD 020 Req 12: the stateful half of per-user URL segments (usernames).
// Derivation is the pure src/lib/usernames.ts; this module owns WHERE the
// result lives and the races around first assignment. There is no database,
// so two blobs carry all the state:
//
//   users/<id>/username.json       → the user's own assigned username — the
//                                    scratchpadPointerBlob precedent: read on
//                                    every later sign-in, never re-derived,
//                                    even if the identity string changes.
//   usernames/<key>.json           → the deployment-wide claim ({userId}),
//                                    one blob per taken username — what makes
//                                    dedupe and username→user resolution
//                                    possible, written with writeIfAbsent so
//                                    a contested slug goes to exactly one
//                                    user.

import { uniqueNameKey } from '../src/lib/workspaceNames.ts';
import { deriveUsername } from '../src/lib/usernames.ts';
import type { AuthUser, StorageProvider } from './providers/types.ts';
import { userPrefix } from './userFiles.ts';

/**
 * PRD 020 Req 12: the root prefix all username claims live under. Reserved
 * from the workspace-agnostic /api/files scaffold (server/app.ts) like the
 * other stateful prefixes: claims are readable only through the resolution
 * these routes perform.
 */
export const USERNAMES_PREFIX = 'usernames/';

/** One username's deployment-wide claim blob, keyed case-insensitively. */
export function usernameClaimBlob(username: string): string {
  return `${USERNAMES_PREFIX}${encodeURIComponent(uniqueNameKey(username))}.json`;
}

/** One user's own assigned-username record (the scratchpadPointerBlob precedent). */
export function usernameRecordBlob(userId: string): string {
  return `${userPrefix(userId)}username.json`;
}

/** The recorded string under `field`, or null when the blob is not a valid record. */
function parseRecord(content: string, field: 'username' | 'userId'): string | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const value = parsed?.[field];
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  }
}

/**
 * PRD 020 Req 12: resolve-or-assign the calling user's username. Later calls
 * read the stored record (never re-deriving, whatever the identity string
 * says now); the first call derives one — identity local part, slugified,
 * deduped deployment-wide past the reserved words — and claims it. Both
 * writes are conditional creates (the handleScratchpadResolve race pattern):
 * a contested slug goes to exactly one user (the loser re-dedupes), and two
 * concurrent first calls BY the same user mint exactly one username (the
 * loser releases its claim and adopts the recorded one). Null means a stored
 * record exists but does not parse — a server-side data problem the caller
 * surfaces as 500, never silently re-derived over.
 */
export async function ensureUsername(storage: StorageProvider, user: AuthUser): Promise<string | null> {
  const record = usernameRecordBlob(user.id);
  const stored = await storage.read(record);
  if (stored) return parseRecord(stored.content, 'username');

  // First assignment: derive against every claim already taken, then claim
  // atomically — a slug claimed between the list and the write just re-enters
  // the dedupe loop with that name now counted as taken.
  const taken = new Set<string>();
  for (const blob of await storage.list(USERNAMES_PREFIX)) {
    const key = /^usernames\/(.+)\.json$/.exec(blob.path)?.[1];
    if (key) taken.add(decodeURIComponent(key));
  }
  let username: string;
  for (;;) {
    username = deriveUsername(user, taken);
    const claimed = await storage.writeIfAbsent(usernameClaimBlob(username), JSON.stringify({ userId: user.id }));
    if (claimed) break;
    // Lost the claim — unless the standing claim is our own (a crashed
    // earlier attempt that claimed but never recorded), which is adopted.
    const owner = await storage.read(usernameClaimBlob(username));
    if (owner && parseRecord(owner.content, 'userId') === user.id) break;
    taken.add(uniqueNameKey(username));
  }
  const won = await storage.writeIfAbsent(record, JSON.stringify({ username }));
  if (won) return username;
  // A concurrent call by this same user recorded first: release this call's
  // extra claim and adopt the recorded username.
  const winner = await storage.read(record);
  const recorded = winner ? parseRecord(winner.content, 'username') : null;
  if (recorded !== null && uniqueNameKey(recorded) !== uniqueNameKey(username)) {
    await storage.delete(usernameClaimBlob(username));
  }
  return recorded;
}

/**
 * PRD 020 Req 13: username → user id, via the deployment-wide claim. Null for
 * an unknown (or malformed) username — the caller answers that identically to
 * every other unresolvable scratch visit, so nothing here needs to hedge.
 */
export async function resolveUsernameOwner(storage: StorageProvider, username: string): Promise<string | null> {
  const claim = await storage.read(usernameClaimBlob(username));
  return claim ? parseRecord(claim.content, 'userId') : null;
}
