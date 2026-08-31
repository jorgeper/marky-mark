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
}

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
