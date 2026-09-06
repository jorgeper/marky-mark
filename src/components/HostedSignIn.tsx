// PRD 007 Req 5: the hosted flavor's sign-in gate. Mounted (from main.tsx)
// only when the served HTML carries the hosted marker, it renders nothing but
// a sign-in page until a session exists — no editor, sidebar, menus, or
// document content pre-auth — then hands off to the untouched <App/>. Local
// mode signs in as a seeded dev user; azure mode drives the Entra ID
// auth-code + PKCE redirect flow (logic in src/lib/hostedAuth.ts).

import { useCallback, useEffect, useRef, useState } from 'react';
import App from '../App';
import {
  buildAuthorizeRedirect,
  codeChallengeS256,
  createCodeVerifier,
  exchangeCodeForToken,
  parseAuthCallback,
  parseAuthorizeUrl,
} from '../lib/hostedAuth';
import { BOOT_HOLD_TIMEOUT_MS, holdsBootFrame, type BootHoldTarget } from '../lib/hostedBootHold';
import { planSignInRestore, SIGNING_IN_STATUS, type SignInReshow } from '../lib/hostedRestore';
import type { SessionMe } from '../lib/deploymentSettings';
import {
  clearToken,
  clearVisitIntent,
  readStoredToken,
  storeHostedBoot,
  storePendingSignIn,
  storeSessionRecord,
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
  isOwnScratch,
  parseAppPath,
  SCRATCH_SEGMENT,
  scratchBootsFresh,
  workspaceIdFromSearch,
  type AppPathTarget,
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
 * What the visit resolved to. PRD 020 Req 5+6 (issue #253): "bound a
 * workspace" and "landed on the home page" are now different answers rather
 * than one shared `null` — the holding frame below waits for a different
 * surface in each case, and only the gate knows which one this load is.
 */
type VisitOutcome = { kind: 'bound' } | { kind: 'home' } | ({ kind: 'not-found' } & VisitNotFound);

/**
 * PRD 020 Req 5+6 (issue #253): the boot's network reads, started TOGETHER.
 * The session validation (`GET /api/me`) and the reads the visit's own shape
 * calls for — the workspace listing, the own-scratch resolve-or-create — have
 * no data dependency on each other, so chaining them through awaits only
 * staggered the boot; each is started here and awaited where its answer is
 * first needed. PRD 017 Req 3: the session record is fetched ONCE for the
 * whole boot — the validation, the visit's handle lookup, and (through
 * storeSessionRecord) the platform all read this one answer.
 */
interface BootProbes {
  auth: { Authorization: string };
  visit: HostedVisit;
  path: AppPathTarget;
  legacyId: string | null;
  me: Promise<SessionMe | null>;
  /** The caller's workspaces — only a visit a listing can name asks for it. */
  rows: Promise<WorkspaceListing[] | null> | null;
  /** PRD 019 Reqs 5–7: the own-scratch resolve-or-create. */
  scratch: Promise<{ id?: string } | null> | null;
}

function startBootProbes(visit: HostedVisit, token: string): BootProbes {
  const auth = { Authorization: `Bearer ${token}` };
  const path = parseAppPath(visit.pathname);
  const legacyId = workspaceIdFromSearch(visit.search);
  return {
    auth,
    visit,
    path,
    legacyId,
    me: getJson<SessionMe>('/api/me', auth),
    rows:
      path.kind === 'workspace' || (path.kind === 'home' && legacyId !== null)
        ? getJson<WorkspaceListing[]>('/api/workspaces', auth)
        : null,
    // PRD 020 Req 11: a bare `/scratchpad` is always the caller's OWN, so its
    // idempotent resolve-or-create needs no other answer to start.
    scratch: path.kind === 'scratch' ? getJson<{ id?: string }>('/api/me/scratchpad', auth, { method: 'POST' }) : null,
  };
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
 *   - `/scratchpad` (PRD 020 Req 11, issue #244) resolves the caller's OWN
 *     scratchpad through the idempotent POST /api/me/scratchpad and lands on
 *     the canonical `/<username>/scratchpad`;
 *   - `/<username>/scratchpad[/<file…>]` (Req 10+13) is that user's scratchpad
 *     workspace — the caller's own via the same resolve-or-create, anyone
 *     else's via GET /api/scratchpad/<username>, which answers only when the
 *     workspace's access model admits the caller and 404s identically for
 *     unknown and inaccessible alike;
 *   - issue #244: the legacy `/scratch` and `/<username>/scratch[/<file…>]`
 *     spellings parse to those same two targets (hostedPaths.ts), so an old
 *     bookmark resolves identically and the replaceState rewrite below leaves
 *     the bar on the canonical `/scratchpad` URL — including when the visit
 *     rode through the Req 9 sign-in redirect as a stored intent;
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
async function resolveHostedVisit(probes: BootProbes, me: SessionMe | null): Promise<VisitOutcome> {
  const { auth, visit, path, legacyId } = probes;
  if (path.kind === 'home' && legacyId === null) return { kind: 'home' };
  // PRD 020 Req 12 (issue #253): the caller's assigned handle — what
  // `/scratchpad` lands on, and what tells an own-scratch visit from someone
  // else's. It rides the ONE session record this boot fetched, so resolving a
  // scratch route costs no second `/api/me`. Undefined when that read failed,
  // exactly as the handle probe it replaces was.
  const handle = me?.handle;

  /**
   * PRD 020 Req 10+13: land in a scratchpad workspace — verify the file half
   * exists (like any workspace visit), rewrite the bar to the canonical
   * `/<username>/scratchpad[/…]` form, and bind. That rewrite is also what
   * normalizes a legacy `/scratch` visit (issue #244). `fresh` is what boots
   * the PRD 019 Req 10 scratch buffer, and every caller answers it the one
   * PRD 023 way: scratchBootsFresh — own scratchpad, no target file.
   */
  const bindScratch = async (
    id: string,
    owner: string,
    file: readonly string[],
    fresh: boolean,
  ): Promise<VisitOutcome> => {
    const rel = file.length > 0 ? file.join('/') : null;
    if (rel !== null) {
      const files = await getJson<{ path: string }[]>(`/api/workspaces/${encodeURIComponent(id)}/files`, auth);
      if (!files?.some((f) => f.path === rel)) {
        return { kind: 'not-found', workspace: `${owner}/${SCRATCH_SEGMENT}`, file: rel };
      }
    }
    window.history.replaceState(null, '', `${buildScratchPath(owner, file)}${visit.hash}`);
    storeHostedBoot(window.sessionStorage, {
      workspaceId: id,
      scratchOwner: owner,
      ...(rel !== null ? { file: rel } : {}),
      ...(fresh ? { scratch: true } : {}),
    });
    return { kind: 'bound' };
  };

  if (path.kind === 'scratch' || path.kind === 'user-scratch') {
    // PRD 020 Req 12: whose scratch this addresses — the same case-insensitive
    // handle match the boot decision below makes, so the two can't disagree.
    if (handle !== undefined && isOwnScratch(path, handle)) {
      // The caller's own scratch: the idempotent resolve-or-create (PRD 019
      // Reqs 5–7) — already in flight for a bare `/scratchpad` (issue #253).
      const body = await (probes.scratch ?? getJson<{ id?: string }>('/api/me/scratchpad', auth, { method: 'POST' }));
      if (!body?.id) {
        // An unanswerable resolve must not leave the app parked on a path
        // only this gate understands: land on the plain start page instead.
        window.history.replaceState(null, '', '/');
        return { kind: 'home' };
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
      return { kind: 'home' };
    }
    // PRD 020 Req 13: someone else's scratch — server-side resolution, which
    // 404s identically for an unknown username, an unprovisioned scratch,
    // and an existing-but-inaccessible one. The not-found page names the
    // visited path either way, so no probe distinguishes them here either.
    const resolved = await getJson<{ id?: string; owner?: string }>(
      `/api/scratchpad/${encodeURIComponent(path.username)}`,
      auth,
    );
    if (!resolved?.id) {
      return {
        kind: 'not-found',
        workspace: `${path.username}/${SCRATCH_SEGMENT}`,
        file: path.file.length > 0 ? path.file.join('/') : null,
      };
    }
    // PRD 023 Req 5: someone else's scratch (or an own visit with no resolved
    // handle) never boots a scratch buffer — the same one decision answers no.
    return bindScratch(resolved.id, resolved.owner ?? path.username, path.file, scratchBootsFresh(path, handle));
  }

  const rows = (await probes.rows) ?? [];
  const wanted = path.kind === 'workspace' ? path : null;
  const row = wanted ? findWorkspaceByUniqueName(rows, wanted.name) : rows.find((r) => r.id === legacyId);
  // PRD 020 Req 10: a scratchpad workspace reached by any OTHER address — its
  // own unique-name path or the legacy ?workspace= form — still shows the
  // canonical `/<username>/scratchpad` bar form (a flagged row is always the
  // caller's own scratch; nobody else's is ever listed).
  if (row?.scratchpad) {
    if (handle !== undefined) {
      // PRD 023 Reqs 1+2 (one rule, not per-route): a flagged row is always
      // the caller's OWN scratch, so this address decides the boot the same
      // way the URLs do — on the canonical target bindScratch rewrites to.
      const file = wanted?.file ?? [];
      const canonical: AppPathTarget = { kind: 'user-scratch', username: handle, file };
      return bindScratch(row.id, handle, file, scratchBootsFresh(canonical, handle));
    }
  }
  const file = wanted && wanted.file.length > 0 ? wanted.file.join('/') : null;
  if (!row?.uniqueName) {
    // PRD 020 Req 8: no workspace to bind — name exactly what was asked for
    // (an unlisted workspace answers the same way as a nonexistent one).
    return { kind: 'not-found', workspace: wanted ? wanted.name : (legacyId ?? ''), file: null };
  }
  if (file !== null && row.access) {
    // PRD 020 Req 8: the workspace is real but the file half must be too —
    // checked against the files listing, the same read the sidebar makes.
    const files = await getJson<{ path: string }[]>(`/api/workspaces/${encodeURIComponent(row.id)}/files`, auth);
    if (!files?.some((f) => f.path === file)) return { kind: 'not-found', workspace: row.uniqueName, file };
  }
  const openFile = row.access && wanted ? wanted.file : [];
  window.history.replaceState(null, '', `${buildAppPath(row.uniqueName, openFile)}${visit.hash}`);
  storeHostedBoot(window.sessionStorage, {
    workspaceId: row.id,
    uniqueName: row.uniqueName,
    ...(file !== null && row.access ? { file } : {}),
  });
  return { kind: 'bound' };
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'signed-out'; error: string | null; busy: boolean }
  // PRD 020 Req 8: the visit resolved to nothing — render the friendly
  // not-found page (naming what was looked for) instead of the app.
  | { kind: 'not-found'; workspace: string; file: string | null }
  // PRD 020 Req 5+6 (issue #253): `target` is what the holding frame waits
  // for inside <App/> — the bound workspace, or the home page's own shell.
  | { kind: 'ready'; target: BootHoldTarget };

/** Resolve the visit and pick the phase entry into the app lands on. */
async function resolvedPhase(probes: BootProbes, me: SessionMe | null): Promise<Phase> {
  const outcome = await resolveHostedVisit(probes, me);
  return outcome.kind === 'not-found'
    ? { kind: 'not-found', workspace: outcome.workspace, file: outcome.file }
    : { kind: 'ready', target: outcome.kind === 'bound' ? 'workspace' : 'app' };
}

/**
 * The visit this page load entered on: the live location (local dev mode
 * never navigates, so it survives naturally) or the sessionStorage record the
 * azure redirect leg left behind (PRD 020 Req 9). Read-and-clear, once per
 * boot, like the intent it consumes.
 */
function currentVisit(): HostedVisit {
  return (
    takeVisitIntent(window.sessionStorage) ?? {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    }
  );
}

/**
 * PRD 007 Req 5 + PRD 020 Req 5+6 (issue #253): the phase the very first paint
 * shows. A visitor with no session and no callback to finish IS signed out —
 * knowable synchronously — so their destination, the sign-in page, is the
 * first thing painted, with no "Checking session…" frame in front of it.
 * Every other load starts held (`holdsBootFrame`, the same one answer), and
 * paints nothing until the app itself is ready.
 */
function initialPhase(): Phase {
  return holdsBootFrame({ token: readStoredToken(window.localStorage), search: window.location.search })
    ? { kind: 'checking' }
    : { kind: 'signed-out', error: null, busy: false };
}

/**
 * PRD 017 Req 3 + PRD 020 Req 5+6 (issue #253): open the boot from a token in
 * hand — the visit's probes started together, and the ONE session record they
 * fetch handed on to the platform, so nothing asks the server who this is a
 * second time before the workspace is on screen. Every entry into the app
 * (stored session, the Entra callback leg, a local sign-in) starts here, so
 * none of them can forget the hand-off. `me` is null when that read failed;
 * only the stored-token path reads that as "no session".
 */
async function startBootSession(token: string): Promise<{ probes: BootProbes; me: SessionMe | null }> {
  const probes = startBootProbes(currentVisit(), token);
  const me = await probes.me;
  if (me) storeSessionRecord(window.sessionStorage, me);
  return { probes, me };
}

/**
 * The phase a stored token resolves to — the ONE answer every entry that
 * starts from a token in hand lands on: the mount boot below, and (issue
 * #242) a sign-in page restored from the back/forward cache with that same
 * token. Issue #253: the session validation IS the visit's `/api/me` read —
 * one request, started alongside the visit's own probes rather than in front
 * of them, and handed on to the platform (PRD 017 Req 3) so nothing asks the
 * server who this is a second time before the workspace is on screen. PRD 020
 * Req 5+7: an already-signed-in path (or legacy-query) visit resolves and
 * canonicalizes before the app mounts. A token the guard no longer honours is
 * cleared, and the visitor lands on a usable sign-in page.
 */
async function phaseForToken(token: string): Promise<Phase> {
  const { probes, me } = await startBootSession(token);
  if (me) return resolvedPhase(probes, me);
  clearToken(window.localStorage);
  return { kind: 'signed-out', error: null, busy: false };
}

export function HostedShell({ mode }: { mode: HostedMode }) {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [username, setUsername] = useState('');
  /**
   * PRD 020 Req 5+6 (issue #253): the ONE holding frame. Raised before the
   * first paint of any load that may end up inside the app — that is exactly
   * the `checking` phase initialPhase picked, read once here so the frame and
   * the phase cannot disagree about which loads hold — and dropped exactly
   * once — when the gate answers with a surface of its own (sign-in,
   * not-found) or, for a load that enters the app, when <App/> reports its
   * destination on screen. Nothing intermediate is painted under it, and one
   * boot never raises it twice: entering a workspace is one frame held, and
   * then the workspace. Issue #242: a restored sign-in page that finds a
   * session is a second boot of the same page, and raises it again — the
   * alternative is showing the sign-in page while that resolve runs.
   */
  const [holding, setHolding] = useState(() => phase.kind === 'checking');
  const releaseHold = useCallback(() => setHolding(false), []);
  /**
   * Issue #242: what the re-show handler below needs to know, without
   * re-subscribing on every phase change — whether a session resolve is
   * already running (so one restore's two events, and a Back → Forward → Back
   * burst, cannot stack resolves), and whether the sign-in page is still the
   * surface on screen (only it can have been restored).
   */
  const resolving = useRef(phase.kind === 'checking');
  const onSignInPage = useRef(phase.kind === 'signed-out');
  useEffect(() => {
    onSignInPage.current = phase.kind === 'signed-out';
  });

  /**
   * The end of a session resolve, wherever it started (the mount boot below,
   * or the issue #242 restore after it): the resolve is no longer running, the
   * phase it landed on is the phase, and — issue #253 — the gate's own
   * surfaces ARE the destination. Sign-in for a visitor whose session is gone,
   * the PRD 020 Req 8 not-found page for a visit that resolves to nothing:
   * each is the first screen painted, so the frame comes down in the same
   * update that renders it. Only a load entering the app keeps holding (App
   * drops that one).
   */
  const settle = useCallback((p: Phase) => {
    resolving.current = false;
    setPhase(p);
    if (p.kind !== 'ready') setHolding(false);
  }, []);

  // The backstop — never the timing anything correct relies on: however a boot
  // ends (a workspace open that failed, a seam that never answered), the held
  // frame is not the last word on screen. It covers only the window where
  // <App/> is mounted under the frame: while the session is still resolving
  // there is nothing underneath, so dropping the frame there would paint a
  // blank page rather than a destination.
  useEffect(() => {
    if (!holding || phase.kind !== 'ready') return;
    const timer = window.setTimeout(() => setHolding(false), BOOT_HOLD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [holding, phase.kind]);

  // Boot: finish an in-flight Entra callback if this is one, else revalidate
  // a stored session against the API guard so it survives a page reload.
  useEffect(() => {
    let cancelled = false;
    const finish = (p: Phase) => {
      if (!cancelled) settle(p);
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
            // at a deep link — the recorded intent continues there now, with
            // its probes started together like any other boot (issue #253),
            // and no home page painted on the way.
            const { probes, me } = await startBootSession(token);
            finish(await resolvedPhase(probes, me));
          } catch (err) {
            finish({ kind: 'signed-out', error: err instanceof Error ? err.message : String(err), busy: false });
          }
          return;
        }
      }
      const token = readStoredToken(window.localStorage);
      finish(token ? await phaseForToken(token) : { kind: 'signed-out', error: null, busy: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, settle]);

  // Issue #242 (PRD 007 Req 5): the sign-in page can come back on screen
  // without remounting. The Entra redirect leaves it mid-sign-in — `busy`
  // set, the button disabled — and browser Back restores it from the
  // back/forward cache exactly like that, session and all; the boot effect
  // above runs on mount only, so it never notices the token the round trip
  // just stored. This re-asks its question on every re-show. The decision is
  // hostedRestore's (pure, unit-tested); only applying it lives here.
  useEffect(() => {
    let cancelled = false;
    const handleReshow = (reshow: SignInReshow) => {
      const plan = planSignInRestore({
        reshow,
        onSignInPage: onSignInPage.current,
        resolving: resolving.current,
        token: readStoredToken(window.localStorage),
      });
      switch (plan.kind) {
        case 'ignore':
          return;
        case 'reset':
          // No session behind the restore: nothing the abandoned redirect
          // froze into the page survives it — an enabled button, no stale
          // error, the signed-out visitor's own destination again.
          setPhase({ kind: 'signed-out', error: null, busy: false });
          return;
        case 'resume': {
          // A session to continue into: the same resolve a fresh load with
          // this token makes, under the same one holding frame (issue #253) —
          // so the page the restore rests on is the app, never the sign-in
          // page, and never a bare shell on the way.
          resolving.current = true;
          setHolding(true);
          setPhase({ kind: 'checking' });
          void (async () => {
            const next = await phaseForToken(plan.token);
            if (!cancelled) settle(next);
          })();
          return;
        }
      }
    };
    const onPageShow = (e: PageTransitionEvent) => handleReshow(e.persisted ? 'restored' : 'first-load');
    // The equivalent re-show: a tab that becomes visible again was never
    // reparsed either, so it carries the same frozen state a restore does.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') handleReshow('revisited');
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [settle]);

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
      const { probes, me } = await startBootSession(body.token);
      setPhase(await resolvedPhase(probes, me));
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
    // Issue #242: replace, not assign — the sign-in page has done its job and
    // drops out of the back stack, so Back from the app does not aim at it in
    // the first place. Not the fix on its own (where Back lands after this is
    // Microsoft's history handling, not ours): the re-show effect above is
    // what makes a restored page work whatever the browser decides.
    window.location.replace(
      buildAuthorizeRedirect(authorizeUrl, { redirectUri: redirectUri(), state, codeChallenge: challenge }),
    );
  }, []);

  // PRD 020 Req 5+6 (issue #253): ONE element, in ONE slot, for the whole
  // wait — React keeps this node mounted across every phase change under it,
  // so a boot can never alternate between two holding surfaces or re-enter
  // this one. Quiet by construction: the app background, and a spinner that
  // only fades in if the wait outlasts a beat. Issue #316: the spinner is
  // styled by its own rule (a 32px accent ring), no longer the search
  // panel's 9px caption spinner.
  const hold = holding ? (
    <div className="hosted-booting" data-testid="hosted-booting" role="status" aria-label="Opening Marky Mark">
      <span className="hosted-booting-spinner" data-testid="hosted-booting-spinner" aria-hidden="true" />
    </div>
  ) : null;

  // Issue #253: while the frame is up the app mounts UNDER it and paints
  // nothing of its own until its destination is ready (App's `bootHold`), so
  // no bare shell and no home page ever exists on the way into a workspace.
  if (phase.kind === 'ready') {
    return (
      <>
        {hold}
        <App bootHold={holding ? phase.target : undefined} onBootHoldRelease={releaseHold} />
      </>
    );
  }

  // Issue #253: the session is still being resolved — the held frame above is
  // the whole screen. No sign-in shell, no "Checking session…": a signed-in
  // visitor never sees a screen they did not ask for.
  if (phase.kind === 'checking') return hold;

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
      {/* Issue #253: the "Checking session…" frame is gone — a load with a
          session to check never renders this page at all, so what is left here
          is only ever the signed-out visitor's own destination. */}
      {mode === 'local' ? (
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
      {/* Issue #242: a disabled sign-in button never stands on screen alone —
          while the sign-in is in flight the page says so, in both modes. It
          shares the error's slot and shape: the two are mutually exclusive,
          because every failure path clears `busy` as it sets the message. */}
      {phase.busy && (
        <p className="hosted-signin-hint" data-testid="hosted-sign-in-status" role="status">
          {SIGNING_IN_STATUS}
        </p>
      )}
      {phase.error && (
        <p className="hosted-signin-error" data-testid="hosted-sign-in-error" role="alert">
          {phase.error}
        </p>
      )}
    </div>
  );
}
