import { describe, expect, it } from 'vitest';
import {
  BOOT_HOLD_TIMEOUT_MS,
  bootHoldSatisfied,
  holdsBootFrame,
  isAuthCallback,
  type BootHoldState,
} from '../../src/lib/hostedBootHold';

/** The state of an App that has painted nothing yet. */
const cold: BootHoldState = { platformReady: false, workspaceOpen: false, bootDocument: false, docOpen: false };

// PRD 020 Req 5+6 (issue #253): which page loads hold a frame, and when the
// frame may go — the two decisions behind "no intermediate screens".
describe('hosted boot hold', () => {
  it('U1207: a stored session holds the frame; a signed-out visitor does not', () => {
    expect(holdsBootFrame({ token: 'tok', search: '' })).toBe(true);
    // The sign-in page is the signed-out visitor's destination, not an
    // intermediate screen — nothing is painted in front of it.
    expect(holdsBootFrame({ token: null, search: '' })).toBe(false);
    expect(holdsBootFrame({ token: null, search: '?workspace=abc' })).toBe(false);
  });

  it('U1200: the Entra callback leg holds the frame even before a token exists', () => {
    // PRD 020 Req 9: the callback carries a stored visit intent into the
    // intended workspace — the home page must not flash on the way.
    expect(holdsBootFrame({ token: null, search: '?code=abc&state=xyz' })).toBe(true);
    expect(isAuthCallback('?code=abc&state=xyz')).toBe(true);
    expect(isAuthCallback('?error=access_denied')).toBe(true);
    // A half-shaped answer is not the callback leg.
    expect(isAuthCallback('?code=abc')).toBe(false);
    expect(isAuthCallback('')).toBe(false);
  });

  it('U1201: nothing is released before App has a platform', () => {
    expect(bootHoldSatisfied('app', cold)).toBe(false);
    expect(bootHoldSatisfied('workspace', { ...cold, workspaceOpen: true, docOpen: true })).toBe(false);
  });

  it('U1202: a home visit releases as soon as the shell exists', () => {
    expect(bootHoldSatisfied('app', { ...cold, platformReady: true })).toBe(true);
  });

  it('U1203: a workspace visit waits for the workspace, and for the deep link’s file', () => {
    const ready = { ...cold, platformReady: true };
    // The shell alone is the home page — exactly the frame that must not show.
    expect(bootHoldSatisfied('workspace', ready)).toBe(false);
    expect(bootHoldSatisfied('workspace', { ...ready, workspaceOpen: true })).toBe(true);
    // A path deep link's file half is part of the destination.
    expect(bootHoldSatisfied('workspace', { ...ready, workspaceOpen: true, bootDocument: true })).toBe(false);
    expect(bootHoldSatisfied('workspace', { ...ready, workspaceOpen: true, bootDocument: true, docOpen: true })).toBe(
      true
    );
  });

  it('U1204: the backstop is a broken boot’s escape, not a timing anything waits on', () => {
    expect(BOOT_HOLD_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });
});
