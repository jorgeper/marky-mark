/**
 * PRD 020 Req 12 (slugify amended by PRD 026 Req 11): the pure half of
 * per-user URL segments (usernames) — how a signed-in identity is turned into
 * the `/<username>/scratchpad` path segment. Derivation happens ONCE per user
 * (the server stores the result and never re-derives), so everything here is
 * deterministic and I/O-free: the server layers the storage claims on top,
 * and unit tests cover the rules alone. Charset, reserved words and dedupe
 * are deliberately the SAME machinery as workspace unique names
 * (workspaceNames.ts): usernames and workspace names share the first URL
 * path segment, so a username minted here is lowercase-dash exactly like a
 * chosen workspace name (PRD 026 Req 1), while usernames stored under PRD
 * 020's wider charset are read back as they are (server/usernames.ts).
 */

import { dedupeUniqueName, slugifyWorkspaceName } from './workspaceNames.ts';

/** PRD 026 Req 11: the word derivation mints when a local part slugifies to nothing. */
export const USERNAME_SLUG_FALLBACK = 'user';

/** The identity facts derivation reads — a subset of the server's AuthUser. */
export interface UsernameIdentity {
  /** Sign-in name (UPN). Guests carry Entra's mangled `…#EXT#@…` form. */
  username: string;
  /** The user's mail address, when the auth provider surfaces one. */
  email?: string;
}

/**
 * PRD 020 Req 12: the derivation source — the local part (before `@`) of the
 * identity. Members use their AAD alias (the UPN's local part); a guest's UPN
 * is Entra's mangled `jane_gmail.com#EXT#@tenant…` form, so a guest with a
 * known email uses ITS local part instead. An identity with no `@` at all
 * (the seeded local dev users) is already a bare local part.
 */
export function identityLocalPart(identity: UsernameIdentity): string {
  const source =
    identity.username.includes('#EXT#') && identity.email ? identity.email : identity.username;
  const at = source.indexOf('@');
  return at === -1 ? source : source.slice(0, at);
}

/**
 * PRD 026 Req 11 (amending PRD 020 Req 12): a local part slugified by THE
 * shared slugifier (`slugifyWorkspaceName`, PRD 026 Req 2) — lowercased, runs
 * outside `[a-z0-9]` collapsed to one dash, leading/trailing dashes gone,
 * clamped to the shared length limit — so `jane.doe` derives `jane-doe` and
 * `j_smith` derives `j-smith`. `user` is this caller's fallback word,
 * supplied only when the slugifier returns the empty string (a local part
 * with nothing usable: `!!!`, `日本語`); every other result already satisfies
 * PRD 026 Req 1. No second copy of the slugify rule lives here.
 */
export function slugifyUsername(localPart: string): string {
  const slug = slugifyWorkspaceName(localPart);
  return slug === '' ? USERNAME_SLUG_FALLBACK : slug;
}

/**
 * PRD 020 Req 12: the username a fresh identity would be assigned, given the
 * usernames already claimed deployment-wide (as `uniqueNameKey`-normalized
 * keys). Dedupe suffixes `-2`, `-3`… exactly like workspace names, and the
 * reserved route words (`scratch`, `scratchpad`, `api`, `assets`) count as
 * taken — a username may never shadow `/api/…` or the reserved routes.
 */
export function deriveUsername(identity: UsernameIdentity, taken: ReadonlySet<string>): string {
  return dedupeUniqueName(slugifyUsername(identityLocalPart(identity)), taken);
}
