// PRD 007 Req 3: the three provider seams the hosted backend talks through —
// auth (token validation/sign-in), storage (files + metadata), and user
// directory (search, display names, avatars). Request handling reaches vendor
// services ONLY via these interfaces, so a non-Azure stack is a new set of
// implementations, not a rewrite. Workspace semantics are deliberately absent
// (sibling issues own the manifest and permission model).

/** The authenticated principal a valid token resolves to. */
export interface AuthUser {
  /** Stable unique id (Entra object id, or a mock id in local dev). */
  id: string;
  /** Sign-in name (UPN / username). */
  username: string;
  displayName: string;
  // PRD 020 Req 12: a guest's UPN is Entra's mangled `…#EXT#@…` form, so
  // username derivation needs the real address — surfaced by providers that
  // know it (the Entra `email` claim; seeded mail in local dev), absent
  // otherwise.
  /** The user's mail address, when the auth provider surfaces one. */
  email?: string;
}

/**
 * What a sign-in attempt yields. Local dev mode issues a token directly;
 * Entra ID sign-in is an auth-code + PKCE flow the SPA drives, so the Azure
 * implementation answers with the authorize URL to redirect to.
 */
export type SignInResult =
  | { kind: 'token'; token: string; user: AuthUser }
  | { kind: 'redirect'; authorizeUrl: string };

/** Auth seam: token validation and sign-in. */
export interface AuthProvider {
  /** Which implementation is wired in — used by tests and diagnostics. */
  readonly kind: string;
  /**
   * Start a sign-in. `username` is only meaningful to providers that issue
   * tokens themselves (the local mock); redirect-based providers ignore it.
   * Returns null when the credentials identify no user.
   */
  signIn(request: { username?: string }): Promise<SignInResult | null>;
  /** Resolve a bearer token to a user, or null when invalid/expired. */
  validateToken(token: string): Promise<AuthUser | null>;
}

/** Per-request auth context handed to providers that act as the caller. */
export interface RequestAuth {
  token: string;
  user: AuthUser;
  /**
   * PRD 017 Req 4: the caller's id is listed in `MM_ADMINS`. Stamped once per
   * request in app.ts; absent means non-admin, so any constructor that knows
   * nothing of admins fails closed.
   */
  isAdmin?: boolean;
}

/** A stored file's metadata. */
export interface FileStat {
  path: string;
  size: number;
  /** ISO 8601 last-modified timestamp. */
  lastModified: string;
  etag: string;
}

/** A stored file's raw bytes plus the media type it was written with. */
export interface StoredBytes {
  data: Uint8Array;
  contentType: string;
  etag: string;
}

/** Storage seam: file contents + metadata. */
export interface StorageProvider {
  readonly kind: string;
  /** One-time startup work (e.g. ensure the backing container exists). */
  init?(): Promise<void>;
  /** Read a file, or null when it does not exist. */
  read(path: string): Promise<{ content: string; etag: string } | null>;
  write(path: string, content: string): Promise<{ etag: string }>;
  /**
   * PRD 007 Req 20: the conditional write behind optimistic concurrency. The
   * write happens ONLY while the stored blob still carries `ifMatch` (an ETag
   * from a prior read); resolves null — with the stored content untouched —
   * when it does not, which is exactly the "someone else saved first" case
   * the API answers 412 for. Unconditional writes keep using `write`: a first
   * write of a path that does not exist yet has no ETag to match.
   */
  writeIfMatch(path: string, content: string, ifMatch: string): Promise<{ etag: string } | null>;
  /**
   * PRD 019 Req 5: the conditional CREATE behind idempotent provisioning —
   * the write lands ONLY while nothing is stored at `path` (Azure blob's
   * `If-None-Match: *` precondition, one atomic request against the
   * service). Resolves null — with the stored content untouched — when a
   * blob is already there, so of two racing first writes exactly one wins
   * and the loser learns it lost.
   */
  writeIfAbsent(path: string, content: string): Promise<{ etag: string } | null>;
  /**
   * PRD 007 Req 8: the same blobs as bytes. Pasted images are stored and
   * served without a text round trip — blob storage is byte-native, so
   * base64-in-a-string would only be a lossy detour — and the media type
   * rides along so the webview gets a usable Content-Type back.
   */
  readBytes(path: string): Promise<StoredBytes | null>;
  writeBytes(path: string, data: Uint8Array, contentType: string): Promise<{ etag: string }>;
  /** Delete a file; resolves false when it did not exist. */
  delete(path: string): Promise<boolean>;
  /** List files under a prefix ('' lists everything). */
  list(prefix: string): Promise<FileStat[]>;
}

/** A user as the directory sees them (member pickers, avatars). */
export interface DirectoryUser {
  id: string;
  displayName: string;
  username: string;
  /** URL the client can fetch an avatar from, when the directory has one. */
  avatarUrl?: string;
  // PRD 007 Req 6 (issue #180): guests (Graph userType === 'Guest') are
  // badged in the People UI, so the seam carries the flag through.
  /** True when the directory marks this user a guest of the tenant. */
  isGuest?: boolean;
  // PRD 017 Req 33: Graph externalUserState === 'PendingAcceptance' — an
  // invited guest who has not redeemed yet; both People surfaces badge it.
  /** True while an invited guest's invitation is unredeemed. */
  pending?: boolean;
  // Issue #195: the address the invitation went to — Graph's `mail`, which
  // for a guest is the real external address while userPrincipalName is the
  // mangled #EXT# form. The copy-link re-POST must invite THIS address.
  /** The user's mail address, when the directory records one. */
  email?: string;
}

/** PRD 017 Req 29: what the server asks the directory to send. */
export interface DirectoryInvitation {
  email: string;
  /** Where the redeemed invitee lands — the deployment's origin, trailing slash. */
  redirectUrl: string;
  /** The invitation mail's customized body (pure template + optional note). */
  message: string;
  // Issue #195: false creates (or refreshes) the invitation WITHOUT
  // Microsoft's mail — Graph's sendInvitationMessage: false — so the redeem
  // URL can be handed over in the app instead.
  /** Whether the directory should send its invitation mail. */
  sendEmail: boolean;
}

/**
 * PRD 017 Req 29: an invitation's outcome — the now-pending guest, or the
 * directory's own refusal AS DATA (its code and message become the route's
 * 502), never a silent success. Transport failures reject instead.
 */
export type DirectoryInviteResult =
  // Issue #195: `redeemUrl` is Graph's inviteRedeemUrl — it exists ONLY in
  // the creation answer (it cannot be read back later), works without any
  // email, and must never reach a log line.
  | { ok: true; user: DirectoryUser; redeemUrl: string }
  | { ok: false; code: string; message: string };

/**
 * Issue #193: a rescind's outcome — deleted, or the directory's own refusal
 * AS DATA (its code and message become the route's 502), mirroring
 * DirectoryInviteResult. Transport failures reject instead.
 */
export type DirectoryDeleteResult = { ok: true } | { ok: false; code: string; message: string };

/** A user's profile photo as raw bytes plus its media type. */
export interface UserPhoto {
  contentType: string;
  data: Uint8Array;
}

// PRD 007 Req 6: avatars reach the SPA only through the app's own origin —
// this is the one definition of that URL, shared by the providers that stamp
// it onto results and the route in server/app.ts that serves it.
export function userPhotoUrl(id: string): string {
  return `/api/directory/users/${encodeURIComponent(id)}/photo`;
}

/** User-directory seam: search and profile resolution. */
export interface DirectoryProvider {
  readonly kind: string;
  /** Substring search over the tenant's users, acting as the caller. */
  search(query: string, auth: RequestAuth): Promise<DirectoryUser[]>;
  /** Resolve one user by id, or null when unknown (e.g. left the tenant). */
  getUser(id: string, auth: RequestAuth): Promise<DirectoryUser | null>;
  // PRD 017 Req 19: the Management People tab lists EVERY tenant user, which
  // no substring search can answer — the one new method this PRD adds to the
  // seam. A failure rejects (the tab shows an error state, never an empty
  // tenant); Graph pages through @odata.nextLink, the mock answers the
  // seeded list.
  /** Every user in the tenant, acting as the caller. */
  listUsers(auth: RequestAuth): Promise<DirectoryUser[]>;
  // PRD 017 Req 29: guest invitations ride the same seam — Graph POSTs
  // /v1.0/invitations as the signed-in admin over the OBO exchange, the
  // mock records an in-memory pending guest for the offline e2e lane.
  /** Invite an external email address into the tenant, acting as the caller. */
  invite(invitation: DirectoryInvitation, auth: RequestAuth): Promise<DirectoryInviteResult>;
  // Issue #193: rescinding an invitation deletes the pending guest's user
  // object — Graph DELETE /v1.0/users/{id} as the signed-in admin over the
  // OBO exchange, the mock forgetting its in-memory invitee. ELIGIBILITY IS
  // THE ROUTE'S JOB (only pending guests, 409 otherwise); the seam just
  // deletes what it is told to.
  /** Delete a user object from the tenant, acting as the caller. */
  deleteUser(id: string, auth: RequestAuth): Promise<DirectoryDeleteResult>;
  // PRD 007 Req 6: a missing photo answers null (the picker falls back to
  // initials), never an error — an unknown user answers null the same way.
  /** A user's profile photo, or null when the user is unknown or has none. */
  getUserPhoto(id: string, auth: RequestAuth): Promise<UserPhoto | null>;
}

/** The full provider set the request handlers receive. */
export interface Providers {
  auth: AuthProvider;
  storage: StorageProvider;
  directory: DirectoryProvider;
}
