/**
 * PRD 023 Req 6 (issue #291): the one place a document's display name is
 * decided. The toolbar name, the file tab strip's untitled tab and the
 * window-title effect all consume this helper, so the three surfaces cannot
 * drift: a named document shows its basename, an ordinary untitled buffer
 * shows "Untitled", and the boot-opened scratch buffer shows the
 * "Scratchpad file" placeholder (marked `scratch` so the surfaces can apply
 * the PRD 023 Req 7 accent/italic treatment).
 */

/** PRD 023 Req 6 (issue #244): the scratch buffer's placeholder display name. */
export const SCRATCH_NAME = 'Scratchpad file';

export interface DocNameState {
  /** The open document's path, or null (untitled buffer or splash). */
  path: string | null;
  /** SPEC22 §1: a blank unsaved buffer is on screen. */
  untitled: boolean;
  /**
   * PRD 019 Req 11 / PRD 023 Req 8: the untitled buffer on screen is the
   * scratch boot's buffer — every other untitled buffer passes false.
   */
  scratch: boolean;
}

export interface DocDisplayName {
  /** What every name surface shows; null ⇒ nothing is open (splash). */
  name: string | null;
  /**
   * PRD 023 Req 7: this name is the scratch placeholder — render it in the
   * `--mm-scratch-name` token treatment (accent + italic). Never true for a
   * named document or an ordinary untitled buffer (PRD 023 Req 8).
   */
  scratch: boolean;
}

/**
 * PRD 023 Reqs 6–8: the untitled buffer's half of the resolution, on its own
 * because the file tab strip renders that case and nothing else — it needs no
 * path, no basename seam and no "nothing is open" branch. `docDisplayName`
 * delegates here, so the tab can never drift from the toolbar or the title.
 */
export function untitledDisplayName(scratch: boolean): { name: string; scratch: boolean } {
  // PRD 023 Req 8: only the boot's scratch buffer carries the placeholder —
  // a ⌘N buffer (even inside the scratch workspace) stays "Untitled".
  return scratch ? { name: SCRATCH_NAME, scratch: true } : { name: 'Untitled', scratch: false };
}

export function docDisplayName(
  s: DocNameState,
  basename: (p: string) => string
): DocDisplayName {
  // PRD 023 Req 8: a named file is untouched even if a stale marker were
  // still set — the scratch treatment is for the unsaved buffer only.
  if (s.path) return { name: basename(s.path), scratch: false };
  if (!s.untitled) return { name: null, scratch: false };
  return untitledDisplayName(s.scratch);
}

/**
 * Issue #311: the scratch buffer's presence in the open-set surfaces — the
 * folder panel's "Scratchpad file" row and the file tab strip's scratch tab
 * both derive from this one value, so they cannot disagree about whether the
 * buffer is alive, active, or dirty. Null ⇒ no scratch buffer is alive (the
 * surfaces render nothing for it); an ordinary untitled buffer never has one
 * (PRD 023 Req 8 — callers pass `scratch` from the boot mark only).
 */
export interface ScratchPresence {
  /** The scratch buffer is the document on screen (row `selected`, tab active). */
  active: boolean;
  /** Unsaved changes — the active buffer's own flag, or the parked entry's. */
  dirty: boolean;
}

export function scratchPresence(s: {
  /** PRD 019 Req 11: the buffer on screen is the boot's scratch buffer. */
  scratch: boolean;
  /** The on-screen buffer's dirty flag (read only while `scratch`). */
  dirty: boolean;
  /** Issue #311: the parked scratch entry's dirtiness, or null when none is parked. */
  parked: { dirty: boolean } | null;
}): ScratchPresence | null {
  // The active buffer wins over any park entry: while the scratch is on
  // screen, an entry could only be a stale one (an open that never
  // committed), and rendering both would show the buffer twice.
  if (s.scratch) return { active: true, dirty: s.dirty };
  if (s.parked) return { active: false, dirty: s.parked.dirty };
  return null;
}
