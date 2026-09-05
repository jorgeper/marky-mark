// PRD 007 Req 5: the hosted flavor's sign-in gate. Mounted (from main.tsx)
// only when the served HTML carries the hosted marker, it renders nothing but
// a sign-in page until a session exists — no editor, sidebar, menus, or
// document content pre-auth — then hands off to the untouched <App/>. Local
// mode signs in as a seeded dev user; azure mode drives the Entra ID
// auth-code + PKCE redirect flow (logic in src/lib/hostedAuth.ts).

import { useCallback, useEffect, useState } from 'react';
import App from '../App';
import {
  buildAuthorizeRedirect,
  codeChallengeS256,
  createCodeVerifier,
  exchangeCodeForToken,
  parseAuthCallback,
  parseAuthorizeUrl,
} from '../lib/hostedAuth';
import {
  clearToken,
  clearVisitIntent,
  readStoredToken,
  storeHostedBoot,
  storePendingSignIn,
  storeToken,
  storeVisitIntent,
  takePendingSignIn,
  takeVisitIntent,
  type HostedVisit,
  type HostedMode,
} from '../lib/hostedGate';
import {
  buildAppPath,
  buildScratchPath,
  findWorkspaceByUniqueName,
  parseAppPath,
  SCRATCH_SEGMENT,
  scratchBootsFresh,
  workspaceIdFromSearch,
} from '../lib/hostedPaths';
import type { WorkspaceListing } from '../lib/workspaceLifecycle';
import { AppBadge } from './Toolbar';
import { Button } from './ui/Button';

// The bundle's one network call site (SPEC11 §6.6 bundle-scan allowlist):
// every hosted request — sign-in, session validation, the PKCE token
// exchange — funnels through this wrapper, and only hosted-served pages
// reach any of the code that calls it.
const hostedFetch: typeof fetch = (input, init) => fetch(input, init);

/** Where Entra sends the browser back to — the SPA's own origin root. */
function redirectUri(): string {
  return `${window.location.origin}/`;
}

/** The generic failure both sign-in paths show when the server's answer is unusable. */
const SIGN_IN_FAILED = 'Sign-in failed — the server did not answer as expected.';

/** PRD 020 Req 8: what a failed resolve was looking for, for the page. */
interface VisitNotFound {
  workspace: string;
  file: string | null;
}

/**
 * One bearer-authenticated API call, collapsed to its parsed JSON body —
 * null on any failure (network, non-2xx, unparseable). The visit resolve
 * treats every failure shape the same, so its call sites stay one line each.
 */
async function getJson<T>(
  url: string,
  auth: { Authorization: string },
  init: { method?: string } = {},
): Promise<T | null> {
  const res = await hostedFetch(url, { ...init, headers: auth }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as T | null) : null;
}

/**
 * PRD 020 Req 5+7 (extending PRD 019 Req 1): a signed-in visit's URL is
 * resolved to a workspace binding BEFORE <App/> mounts. The visit is either
 * the live location (local dev mode never navigates, so it survives
 * naturally) or the sessionStorage record the azure redirect leg left behind
 * (Req 9); both are consumed here, once, on every successful entry into the
 * app. Four shapes resolve:
 *
 *   - `/` binds nothing (the normal splash);
 *   - `/scratch` (PRD 020 Req 11) resolves the caller's OWN scratch through
 *     the idempotent POST /api/me/scratchpad and lands on the canonical
 *     `/<username>/scratch`;
 *   - `/<username>/scratch[/<file…>]` (Req 10+13) is that user's scratch
 *     workspace — the caller's own via the same resolve-or-create, anyone
 *     else's via GET /api/scratch/<username>, which answers only when the
 *     workspace's access model admits the caller and 404s identically for
 *     unknown and inaccessible alike;
 *   - `/<workspace-name>[/<path…>/<file>]` matches the unique name
 *     case-insensitively against the caller's workspace listing — so a
 *     workspace the PRD 017 Req 11 policy hides resolves as not-found for
 *     this caller, revealing nothing — and verifies the file half exists;
 *   - the legacy `/?workspace=<uuid>` form (Req 7) resolves the id the same
 *     way and redirects to the canonical path.
 *
 * PRD 020 Req 6: the address bar is rewritten to the canonical path via
 * history.replaceState (the PRD 009 Req 6 pattern) before <App/> mounts —
 * createHostedPlatform reads the hostedGate boot record stored here, so the
 * rewrite landing first is what makes this boot (and any reload from here)
 * an ordinary workspace binding. The `#<heading-slug>` fragment rides the
 * rewrite untouched. Req 8: an unresolvable visit answers what was looked
 * for, and the caller renders the not-found page instead of the app.
 */
async function resolveHostedVisit(): Promise<VisitNotFound | null> {
  const intent = takeVisitIntent(window.sessionStorage);
  const visit: HostedVisit = intent ?? {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
  const legacyId = workspaceIdFromSearch(visit.search);
  const path = parseAppPath(visit.pathname);
  if (path.kind === 'home' && legacyId === null) return null;

  const auth = { Authorization: `Bearer ${readStoredToken(window.localStorage) ?? ''}` };
  const listRows = async (): Promise<WorkspaceListing[]> =>
    (await getJson<WorkspaceListing[]>('/api/workspaces', auth)) ?? [];

  /**
   * PRD 020 Req 10+13: land in a scratch workspace — verify the file half
   * exists (like any workspace visit), rewrite the bar to the canonical
   * `/<username>/scratch[/…]` form, and bind. `fresh` is scratchBootsFresh's
   * one PRD 023 decision — own scratch, no target file — and marks the visit
   * that boots the fresh scratch buffer.
   */
  const bindScratch = async (
    id: string,
    owner: string,
    file: readonly string[],
    fresh: boolean,
  ): Promise<VisitNotFound | null> => {
    const rel = file.length > 0 ? file.join('/') : null;
    if (rel !== null) {
      const files = await getJson<{ path: string }[]>(`/api/workspaces/${encodeURIComponent(id)}/files`, auth);
      if (!files?.some((f) => f.path === rel)) return { workspace: `${owner}/${SCRATCH_SEGMENT}`, file: rel };
    }
    window.history.replaceState(null, '', `${buildScratchPath(owner, file)}${visit.hash}`);
    storeHostedBoot(window.sessionStorage, {
      workspaceId: id,
      scratchOwner: owner,
      ...(rel !== null ? { file: rel } : {}),
      ...(fresh ? { scratch: true } : {}),
    });
    return null;
  };

  /**
   * PRD 020 Req 12: the caller's assigned handle, from /api/me — what
   * `/scratch` lands on, and what tells an own-scratch visit from someone
   * else's. Undefined on any failure, like every getJson miss.
   */
  const myHandle = async (): Promise<string | undefined> =>
    (await getJson<{ handle?: string }>('/api/me', auth))?.handle;

  if (path.kind === 'scratch' || path.kind === 'user-scratch') {
    const handle = await myHandle();
    const own =
      path.kind === 'scratch' || (handle !== undefined && path.username.toLowerCase() === handle.toLowerCase());
    if (own && handle !== undefined) {
      // The caller's own scratch: the idempotent resolve-or-create (PRD 019 Reqs 5–7).
      const body = await getJson<{ id?: string }>('/api/me/scratchpad', auth, { method: 'POST' });
      if (!body?.id) {
        // An unanswerable resolve must not leave the app parked on a path
        // only this gate understands: land on the plain start page instead.
        window.history.replaceState(null, '', '/');
        return null;
      }
      // PRD 023 Req 1 (amending PRD 019 Req 10): BOTH bare URL forms boot the
      // fresh scratch buffer on every entry, reloads of the canonical URL
      // included — the old "a reload just re-binds" guard is gone. Only a
      // file segment suppresses the boot (Req 2).
      return bindScratch(
        body.id,
        handle,
        path.kind === 'user-scratch' ? path.file : [],
        scratchBootsFresh(path, handle),
      );
    }
    if (path.kind === 'scratch') {
      // No handle to land on — same bail-out as an unanswerable resolve.
      window.history.replaceState(null, '', '/');
      return null;
    }
    // PRD 020 Req 13: someone else's scratch — server-side resolution, which
    // 404s identically for an unknown username, an unprovisioned scratch,
    // and an existing-but-inaccessible one. The not-found page names the
    // visited path either way, so no probe distinguishes them here either.
    const resolved = await getJson<{ id?: string; owner?: string }>(
      `/api/scratch/${encodeURIComponent(path.username)}`,
      auth,
    );
    if (!resolved?.id) {
      return {
        workspace: `${path.username}/${SCRATCH_SEGMENT}`,
        file: path.file.length > 0 ? path.file.join('/') : null,
      };
    }
    // PRD 023 Req 5: someone else's scratch (or an own visit with no resolved
    // handle) never boots a scratch buffer — the same one decision answers no.
    return bindScratch(resolved.id, resolved.owner ?? path.username, path.file, scratchBootsFresh(path, handle));
  }

  const rows = await listRows();
  const wanted = path.kind === 'workspace' ? path : null;
  const row = wanted ? findWorkspaceByUniqueName(rows, wanted.name) : rows.find((r) => r.id === legacyId);
  // PRD 020 Req 10: a scratch workspace reached by any OTHER address — its
  // own unique-name path or the legacy ?workspace= form — still shows the
  // canonical `/<username>/scratch` bar form (a flagged row is always the
  // caller's own scratch; nobody else's is ever listed).
  if (row?.scratchpad) {
    const handle = await myHandle();
    if (handle !== undefined) {
      // PRD 023 Reqs 1+2 (one rule, not per-route): a flagged row is always
      // the caller's OWN scratch, so this address too decides the boot on its
      // canonical user-scratch form — own scratch + no target file = fresh.
      const file = wanted?.file ?? [];
      return bindScratch(
        row.id,
        handle,
        file,
        scratchBootsFresh({ kind: 'user-scratch', username: handle, file }, handle),
      );
    }
  }
  const file = wanted && wanted.file.length > 0 ? wanted.file.join('/') : null;
  if (!row?.uniqueName) {
    // PRD 020 Req 8: no workspace to bind — name exactly what was asked for
    // (an unlisted workspace answers the same way as a nonexistent one).
    return { workspace: wanted ? wanted.name : (legacyId ?? ''), file: null };
  }
  if (file !== null && row.access) {
    // PRD 020 Req 8: the workspace is real but the file half must be too —
    // checked against the files listing, the same read the sidebar makes.
    const files = await getJson<{ path: string }[]>(`/api/workspaces/${encodeURIComponent(row.id)}/files`, auth);
    if (!files?.some((f) => f.path === file)) return { workspace: row.uniqueName, file };
  }
  const openFile = row.access && wanted ? wanted.file : [];
  window.history.replaceState(null, '', `${buildAppPath(row.uniqueName, openFile)}${visit.hash}`);
  storeHostedBoot(window.sessionStorage, {
    workspaceId: row.id,
    uniqueName: row.uniqueName,
    ...(file !== null && row.access ? { file } : {}),
  });
  return null;
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'signed-out'; error: string | null; busy: boolean }
  // PRD 020 Req 8: the visit resolved to nothing — render the friendly
  // not-found page (naming what was looked for) instead of the app.
  | { kind: 'not-found'; workspace: string; file: string | null }
  | { kind: 'ready' };

/** Resolve the visit and pick the phase entry into the app lands on. */
async function resolvedPhase(): Promise<Phase> {
  const missing = await resolveHostedVisit();
  return missing ? { kind: 'not-found', ...missing } : { kind: 'ready' };
}

export function HostedShell({ mode }: { mode: HostedMode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [username, setUsername] = useState('');

  // Boot: finish an in-flight Entra callback if this is one, else revalidate
  // a stored session against the API guard so it survives a page reload.
  useEffect(() => {
    let cancelled = false;
    const finish = (p: Phase) => {
      if (!cancelled) setPhase(p);
    };
    void (async () => {
      if (mode === 'azure') {
        const pending = takePendingSignIn(window.sessionStorage);
        const callback = parseAuthCallback(window.location.search, pending?.state ?? null);
        if (callback.kind !== 'none') {
          // Strip code/state from the address bar before any await: the code
          // is single-use and must not survive into history or a reload.
          window.history.replaceState(null, '', window.location.pathname);
          if (callback.kind === 'error' || !pending) {
            const message = callback.kind === 'error' ? callback.message : 'Sign-in session expired — please try again.';
            finish({ kind: 'signed-out', error: message, busy: false });
            return;
          }
          try {
            const token = await exchangeCodeForToken(hostedFetch, {
              tenantId: pending.tenantId,
              clientId: pending.clientId,
              code: callback.code,
              redirectUri: redirectUri(),
              codeVerifier: pending.verifier,
              scope: pending.scope,
            });
            storeToken(window.localStorage, token);
            // PRD 020 Req 9: the sign-in that just completed may have begun
            // at a deep link — the recorded intent continues there now.
            finish(await resolvedPhase());
          } catch (err) {
            finish({ kind: 'signed-out', error: err instanceof Error ? err.message : String(err), busy: false });
          }
          return;
        }
      }
      const token = readStoredToken(window.localStorage);
      if (token) {
        const res = await hostedFetch('/api/me', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
        if (res?.ok) {
          // PRD 020 Req 5+7: an already-signed-in path (or legacy-query)
          // visit resolves and canonicalizes before the app mounts.
          finish(await resolvedPhase());
          return;
        }
        clearToken(window.localStorage);
      }
      finish({ kind: 'signed-out', error: null, busy: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Local dev mode: `POST /api/auth/sign-in {username}` answers a token.
  const signInLocal = useCallback(async () => {
    setPhase({ kind: 'signed-out', error: null, busy: true });
    const res = await hostedFetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim() }),
    }).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => null)) as { kind?: string; token?: string } | null) : null;
    if (body?.kind === 'token' && typeof body.token === 'string') {
      storeToken(window.localStorage, body.token);
      // PRD 020 Req 9: local dev mode never navigated, so a sign-in that
      // began at a deep link still sits on that URL — continue there.
      setPhase(await resolvedPhase());
      return;
    }
    const error =
      res && res.status === 401
        ? 'Unknown user — sign in as one of the seeded dev users (e.g. ada).'
        : SIGN_IN_FAILED;
    setPhase({ kind: 'signed-out', error, busy: false });
  }, [username]);

  // Azure mode: ask the server for the tenant's authorize URL, remember the
  // PKCE verifier + state for the round trip, and redirect the browser.
  const signInMicrosoft = useCallback(async () => {
    setPhase({ kind: 'signed-out', error: null, busy: true });
    const res = await hostedFetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => null);
    const body = res?.ok
      ? ((await res.json().catch(() => null)) as { kind?: string; authorizeUrl?: string } | null)
      : null;
    const authorizeUrl = body?.kind === 'redirect' ? body.authorizeUrl : undefined;
    const app = authorizeUrl ? parseAuthorizeUrl(authorizeUrl) : null;
    if (!authorizeUrl || !app) {
      setPhase({ kind: 'signed-out', error: SIGN_IN_FAILED, busy: false });
      return;
    }
    // PRD 020 Req 9: the Entra redirect comes back to the origin root, so a
    // sign-in that begins at a deep link — a path, the legacy query form, or
    // /scratchpad — records the whole visit beside the pending sign-in; any
    // other sign-in clears a leftover one, so an abandoned deep-link attempt
    // cannot replay into a later, unrelated session.
    const { pathname, search, hash } = window.location;
    if (pathname !== '/' || workspaceIdFromSearch(search) !== null) {
      storeVisitIntent(window.sessionStorage, { pathname, search, hash });
    } else {
      clearVisitIntent(window.sessionStorage);
    }
    const verifier = createCodeVerifier();
    const state = createCodeVerifier();
    const challenge = await codeChallengeS256(verifier);
    storePendingSignIn(window.sessionStorage, {
      state,
      verifier,
      tenantId: app.tenantId,
      clientId: app.clientId,
      scope: app.scope,
    });
    window.location.assign(
      buildAuthorizeRedirect(authorizeUrl, { redirectUri: redirectUri(), state, codeChallenge: challenge }),
    );
  }, []);

  if (phase.kind === 'ready') return <App />;

  // PRD 020 Req 8: the friendly not-found page — in-app chrome (the sign-in
  // page's splash shape), naming exactly what was looked for, with a link
  // back to the start page and its workspace list. Never a blank screen, a
  // raw 404, or a silent fall-through to the splash.
  if (phase.kind === 'not-found') {
    return (
      <div className="hosted-signin" data-testid="hosted-not-found">
        <div className="splash-mark" aria-hidden="true">
          <AppBadge size={132} testId="hosted-not-found-badge" />
        </div>
        <p className="hosted-notfound-what" data-testid="hosted-not-found-message">
          {phase.file !== null ? (
            <>
              There’s no file named “{phase.file}” in the workspace “{phase.workspace}”.
            </>
          ) : (
            <>There’s no workspace named “{phase.workspace}”.</>
          )}
        </p>
        <p className="hosted-signin-hint">It may have been renamed, deleted, or shared by mistake.</p>
        <a className="hosted-notfound-link" href="/" data-testid="hosted-not-found-home">
          Go to your workspaces
        </a>
      </div>
    );
  }

  // Issue #196: the sign-in page mirrors the splash (SPEC27 §3) — no card
  // box, no title text: the badge at the splash's size sits directly on the
  // app background, with just the sign-in control beneath it.
  return (
    <div className="hosted-signin" data-testid="hosted-sign-in">
      <div className="splash-mark" aria-hidden="true">
        <AppBadge size={132} testId="hosted-sign-in-badge" />
      </div>
      {phase.kind === 'checking' ? (
        <p className="hosted-signin-hint">Checking session…</p>
      ) : mode === 'local' ? (
        <form
          className="hosted-signin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void signInLocal();
          }}
        >
          <label className="hosted-signin-hint" htmlFor="hosted-signin-username">
            Local dev mode — sign in as a seeded user
          </label>
          <input
            id="hosted-signin-username"
            className="field"
            data-testid="hosted-sign-in-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username (e.g. ada)"
            autoFocus
          />
          {/* PRD 018 Req 12 (issue #204): explicit type="submit" — the Button
              wrapper defaults to type="button", which would stop the form's
              Enter-to-submit path. */}
          <Button type="submit" data-testid="hosted-sign-in-submit" disabled={phase.busy || !username.trim()}>
            Sign in
          </Button>
        </form>
      ) : (
        // PRD 018 Req 20 (issue #204): the Microsoft button keeps its branded
        // logo + label (issue #196) on a neutral .btn fill; dimensions, radius
        // and font now come from the primitive, `hosted-signin-ms` stays as
        // the layout/locator hook.
        <Button
          className="hosted-signin-ms"
          data-testid="hosted-sign-in-microsoft"
          onClick={() => void signInMicrosoft()}
          disabled={phase.busy}
        >
          {/* Issue #196: Microsoft's standard branded sign-in button — the
              four-square logo (their fixed brand colors, one inline SVG so
              the bundle stays asset-free) + "Sign in with Microsoft". */}
          <svg className="hosted-signin-ms-logo" width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </Button>
      )}
      {phase.kind === 'signed-out' && phase.error && (
        <p className="hosted-signin-error" data-testid="hosted-sign-in-error" role="alert">
          {phase.error}
        </p>
      )}
    </div>
  );
}
