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
  clearScratchpadIntent,
  clearToken,
  readStoredToken,
  storePendingSignIn,
  storeScratchBoot,
  storeScratchpadIntent,
  storeToken,
  takePendingSignIn,
  takeScratchpadIntent,
  type HostedMode,
} from '../lib/hostedGate';
import { isScratchpadPath } from '../lib/hostedPaths';
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

/**
 * PRD 019 Req 1: a signed-in /scratchpad visit resolves the user's own
 * scratchpad through the idempotent `POST /api/me/scratchpad` (issue #213) —
 * no new server routes. The intent is either the live pathname (local dev
 * mode never navigates, so it survives naturally) or the sessionStorage
 * record the azure redirect leg left behind (Req 2); both are consumed here,
 * once, on every successful entry into the app.
 *
 * PRD 019 Req 3: the address bar is rewritten to the canonical
 * `/?workspace=<id>` via history.replaceState (the PRD 009 Req 6 pattern)
 * BEFORE <App/> mounts — createHostedPlatform reads location.search once at
 * creation, so the rewrite landing first is what makes this boot (and any
 * reload from here) an ordinary workspace binding.
 */
async function resolveScratchpadVisit(): Promise<void> {
  const stored = takeScratchpadIntent(window.sessionStorage);
  if (!stored && !isScratchpadPath(window.location.pathname)) return;
  const token = readStoredToken(window.localStorage) ?? '';
  const res = await hostedFetch('/api/me/scratchpad', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as { id?: string } | null) : null;
  if (body?.id) {
    window.history.replaceState(null, '', `/?workspace=${encodeURIComponent(body.id)}`);
    // PRD 019 Req 10: tell the platform (created after this, inside <App/>)
    // that this one binding is a scratchpad visit — fresh scratch buffer.
    storeScratchBoot(window.sessionStorage, body.id);
  } else {
    // An unanswerable resolve must not leave the app parked on a path only
    // this gate understands: land on the plain start page instead.
    window.history.replaceState(null, '', '/');
  }
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'signed-out'; error: string | null; busy: boolean }
  | { kind: 'ready' };

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
            // PRD 019 Req 2: the sign-in that just completed may have begun
            // at /scratchpad — the recorded intent continues there now.
            await resolveScratchpadVisit();
            finish({ kind: 'ready' });
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
          // PRD 019 Req 1: an already-signed-in /scratchpad visit resolves
          // and normalizes before the app mounts.
          await resolveScratchpadVisit();
          finish({ kind: 'ready' });
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
      // PRD 019 Req 2: local dev mode never navigated, so a sign-in that
      // began at /scratchpad still sits on that pathname — continue there.
      await resolveScratchpadVisit();
      setPhase({ kind: 'ready' });
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
    // PRD 019 Req 2: the Entra redirect comes back to the origin root, so a
    // sign-in that begins at /scratchpad records the intent beside the
    // pending sign-in — and any other sign-in clears a leftover one, so an
    // abandoned /scratchpad attempt cannot replay into a later session.
    if (isScratchpadPath(window.location.pathname)) storeScratchpadIntent(window.sessionStorage);
    else clearScratchpadIntent(window.sessionStorage);
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
