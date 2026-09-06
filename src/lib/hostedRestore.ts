// Issue #242 (PRD 007 Req 5): the hosted sign-in page can come back on screen
// without ever remounting.
//
// The Entra sign-in leaves the page with a full-page navigation while its
// React state still says "busy" — the redirect is in flight and only failures
// clear that flag. Browser Back then restores the whole page from the
// back/forward cache with that state frozen: a disabled button, no session
// check, no way out. The mount-only boot effect in
// src/components/HostedSignIn.tsx never runs again there, so something has to
// re-ask its two questions on every re-show — is there a session to continue
// into, and if not, is this page still usable?
//
// This module owns that decision, and only that decision: pure, no React, no
// DOM, no storage of its own (the caller reads the token and applies the
// plan), so both branches are testable without a renderer.

/**
 * How the sign-in page came (back) on screen:
 *
 *   - `first-load` — the ordinary `pageshow` of a page that was just parsed
 *     (`persisted === false`). The boot effect is already handling this load;
 *     a re-show plan must not duplicate its work.
 *   - `restored` — a back/forward-cache restore (`pageshow` with
 *     `persisted === true`): the page is exactly as the redirect left it,
 *     stale `busy` included.
 *   - `revisited` — an equivalent re-show that keeps the page's state but
 *     proves nothing about it, e.g. the tab becoming visible again.
 */
export type SignInReshow = 'first-load' | 'restored' | 'revisited';

/**
 * What the caller does about a re-show:
 *
 *   - `ignore` — nothing to do; leave the page exactly as it is;
 *   - `resume` — a session is stored: resolve it the way a fresh load with
 *     this token does, and land in the app (PRD 007 Req 5: the sign-in page
 *     is never the resting surface of a restore that has a session);
 *   - `reset` — no session: the page is the signed-out visitor's own
 *     destination again, so drop whatever the redirect froze into it.
 */
export type SignInRestorePlan = { kind: 'ignore' } | { kind: 'resume'; token: string } | { kind: 'reset' };

/**
 * The one restore decision. Deliberately conservative about what it acts on:
 *
 *   - a first load is the boot effect's, not a restore's;
 *   - a re-show while the gate is off the sign-in page, or already resolving
 *     a session, is ignored — that is what keeps Back → Forward → Back from
 *     accumulating state, or a restore from double-running the resolve
 *     (`pageshow` and the visibility change that follows it are two events
 *     for one restore);
 *   - a `revisited` page with no token is left alone. It was not restored
 *     from anywhere: its `busy` is live, its error is the one the visitor is
 *     reading, and PRD 020 Req 9's stored visit intent belongs to the sign-in
 *     that may still be in flight. Only a real restore resets.
 */
export function planSignInRestore(input: {
  reshow: SignInReshow;
  /** Is the sign-in page the surface on screen? Only it can be restored. */
  onSignInPage: boolean;
  /** Is a session resolve already running (this gate's own boot, or a resume)? */
  resolving: boolean;
  /** `localStorage['marky-mark.hosted.token']`, as the caller read it. */
  token: string | null;
}): SignInRestorePlan {
  if (input.reshow === 'first-load' || !input.onSignInPage || input.resolving) return { kind: 'ignore' };
  if (input.token !== null) return { kind: 'resume', token: input.token };
  return input.reshow === 'restored' ? { kind: 'reset' } : { kind: 'ignore' };
}

/** Issue #242: what the page says while a sign-in redirect is in flight. */
export const SIGNING_IN_STATUS = 'Signing you in…';
