/**
 * PRD 020 Req 12: the pure half of per-user URL segments (usernames) — how a
 * signed-in identity is turned into the `/<username>/scratch` path segment.
 * Derivation happens ONCE per user (the server stores the result and never
 * re-derives), so everything here is deterministic and I/O-free: the server
 * layers the storage claims on top, and unit tests cover the rules alone.
 * Charset, reserved words and dedupe are deliberately the SAME machinery as
 * workspace unique names (workspaceNames.ts): usernames and workspace names
 * share the first URL path segment.
 */

import { dedupeUniqueName, UNIQUE_NAME_MAX_LENGTH } from './workspaceNames.ts';

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
 * PRD 020 Req 12: a local part slugified to Req 1's charset — lowercased,
 * runs of characters outside `[a-z0-9._-]` collapsed to `-`, clamped to the
 * shared length limit (the workspaceNames slugify, with a `user` fallback for
 * a local part with nothing usable at all).
 */
export function slugifyUsername(localPart: string): string {
  const slug = localPart
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, UNIQUE_NAME_MAX_LENGTH);
  return slug === '' ? 'user' : slug;
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
