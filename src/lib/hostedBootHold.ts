// PRD 020 Req 5+6 (issue #253): the hosted boot's ONE holding frame.
//
// Entering a workspace on the hosted build used to paint its way there — the
// sign-in page's "Checking session…", a bare app shell, then the home page —
// because every step of the boot (session validation, visit resolution,
// platform bootstrap, workspace open) got its own render. The gate now holds
// a single quiet frame over the whole wait and drops it when the destination
// surface is on screen; this module owns the two decisions that involves, so
// they are testable without a DOM: whether a page load holds at all, and
// whether what it was holding for has arrived.
//
// Pure by construction: no React, no platform, no DOM — the callers
// (src/components/HostedSignIn.tsx, src/App.tsx) own the rendering.

/**
 * What the hold is waiting for once the gate has resolved the visit:
 *
 *   - `app` — no workspace binding (a plain `/` visit): the destination is
 *     the home page, which exists as soon as App's platform bootstrap lands;
 *   - `workspace` — the visit bound a workspace (a row click's canonical
 *     path, a deep link, the legacy `?workspace=` form, a scratchpad route):
 *     the destination is that workspace, and the file half of a deep link.
 */
export type BootHoldTarget = 'app' | 'workspace';

/**
 * Is this page load one the hold covers? Only a load that may end up inside
 * the app: a stored session (the signed-in boot the issue is about), or the
 * Entra callback leg carrying a session back (PRD 020 Req 9 — its stored
 * visit intent continues into the intended workspace, so it must not paint
 * the home page on the way either).
 *
 * A signed-out visitor answers false — the sign-in page is their
 * destination, and it is what they see first, with no frame in front of it.
 */
export function holdsBootFrame(input: {
  token: string | null;
  search: string;
}): boolean {
  return input.token !== null || isAuthCallback(input.search);
}

/**
 * The Entra redirect leg's answer, by shape alone — the single-use `code`
 * plus its `state`, or the error form. Deliberately not a validation (that
 * is hostedAuth's parseAuthCallback, which needs the pending record): this
 * only decides whether the frame is held while that answer is processed.
 */
export function isAuthCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return (params.has('code') && params.has('state')) || params.has('error');
}

/** What App has painted so far, as the hold's release condition reads it. */
export interface BootHoldState {
  /** App's async bootstrap has landed — the app shell renders from here on. */
  platformReady: boolean;
  /** The bound workspace is open (its sidebar roots and session restored). */
  workspaceOpen: boolean;
  /** The visit named a file half (`platform.bootDocument`). */
  bootDocument: boolean;
  /** A document is on screen. */
  docOpen: boolean;
}

/**
 * Is the destination surface on screen — i.e. may the holding frame go?
 * A workspace visit waits for the workspace itself, and for the deep link's
 * document when it named one; anything else waits only for the shell.
 */
export function bootHoldSatisfied(
  target: BootHoldTarget,
  state: BootHoldState,
): boolean {
  if (!state.platformReady) return false;
  if (target === 'app') return true;
  return state.workspaceOpen && (!state.bootDocument || state.docOpen);
}

/**
 * The escape hatch: however the boot ends — a workspace open that failed, a
 * seam that never answered — the frame is never the last word on screen.
 * Generous on purpose: it is a backstop for a broken boot, not the timing
 * anything correct relies on.
 */
export const BOOT_HOLD_TIMEOUT_MS = 10_000;
