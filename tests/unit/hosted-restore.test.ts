import { describe, expect, it } from 'vitest';
import { planSignInRestore, SIGNING_IN_STATUS, type SignInReshow } from '../../src/lib/hostedRestore';

/** A re-show of the sign-in page with nothing else going on. */
const reshown = (reshow: SignInReshow, token: string | null) => ({
  reshow,
  onSignInPage: true,
  resolving: false,
  token,
});

// Issue #242 (PRD 007 Req 5): what a sign-in page that comes back on screen —
// a bfcache restore after the Entra redirect, or the tab becoming visible
// again — does about the session it may now have.
describe('issue #242 hosted sign-in restore', () => {
  it('U1216: a restore with a stored token resumes that session', () => {
    // The dead-end the issue reports: Back lands here with a token in hand,
    // so the page continues into the app instead of showing itself.
    expect(planSignInRestore(reshown('restored', 'tok'))).toEqual({ kind: 'resume', token: 'tok' });
    // A tab that becomes visible again holds the same session; it resumes too.
    expect(planSignInRestore(reshown('revisited', 'tok'))).toEqual({ kind: 'resume', token: 'tok' });
  });

  it('U1217: a restore with no session resets to a clean signed-out page', () => {
    // The `busy` the redirect froze into the page is not state about this
    // visitor any more — the page is a fresh sign-in page again.
    expect(planSignInRestore(reshown('restored', null))).toEqual({ kind: 'reset' });
  });

  it('U1218: an ordinary first load is the boot effect’s, not a restore’s', () => {
    // `pageshow` fires on every load; only the persisted one is a restore.
    expect(planSignInRestore(reshown('first-load', 'tok'))).toEqual({ kind: 'ignore' });
    expect(planSignInRestore(reshown('first-load', null))).toEqual({ kind: 'ignore' });
  });

  it('U1219: a re-show the sign-in page is not on, or is already resolving, does nothing', () => {
    // The app is on screen (Back went somewhere else, or the resume landed):
    // re-showing it must not tear it down and boot again.
    expect(planSignInRestore({ ...reshown('restored', 'tok'), onSignInPage: false })).toEqual({ kind: 'ignore' });
    // One restore raises `pageshow` AND a visibility change; the second one
    // finds the first still resolving and leaves it alone — which is also
    // what keeps Back → Forward → Back from stacking resolves.
    expect(planSignInRestore({ ...reshown('restored', 'tok'), resolving: true })).toEqual({ kind: 'ignore' });
    expect(planSignInRestore({ ...reshown('restored', null), resolving: true })).toEqual({ kind: 'ignore' });
  });

  it('U1220: a visible-again page with no token is left exactly as it is', () => {
    // It was not restored from anywhere: its error is the one the visitor is
    // reading, and PRD 020 Req 9's stored visit intent belongs to a sign-in
    // that may still be in flight. Nothing here may consume or clear either.
    expect(planSignInRestore(reshown('revisited', null))).toEqual({ kind: 'ignore' });
  });

  it('U1221: the in-flight sign-in has words of its own', () => {
    // Issue #242 criterion 3: a disabled button never stands alone.
    expect(SIGNING_IN_STATUS).toMatch(/signing you in/i);
  });
});
