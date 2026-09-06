/**
 * SPEC15 §3.1: pure pixel-offset ↔ fractional-source-line mapping over a
 * table of block anchors ({ line, top }). The effective table always starts
 * at { line: 1, top: 0 } and ends at { line: last.line + 1, top:
 * contentHeight }, so every offset maps and the mapping inverts cleanly.
 * No DOM — both panes feed it their own geometry.
 */
export interface SyncAnchor {
  line: number;
  top: number;
}

/** Sort, dedupe, and drop non-monotonic entries; add implicit head + tail. */
function effectiveTable(anchors: SyncAnchor[], contentHeight: number): SyncAnchor[] {
  const sorted = [...anchors]
    .filter((a) => Number.isFinite(a.line) && Number.isFinite(a.top))
    .sort((a, b) => a.top - b.top || a.line - b.line);
  const table: SyncAnchor[] = [{ line: 1, top: 0 }];
  for (const a of sorted) {
    const prev = table[table.length - 1];
    if (a.line > prev.line && a.top > prev.top) table.push(a);
  }
  const last = table[table.length - 1];
  const height = Math.max(contentHeight, last.top + 1);
  table.push({ line: last.line + 1, top: height });
  return table;
}

export function lineAtOffset(anchors: SyncAnchor[], contentHeight: number, scrollTop: number): number {
  const table = effectiveTable(anchors, contentHeight);
  const y = Math.min(Math.max(scrollTop, 0), table[table.length - 1].top);
  for (let i = 1; i < table.length; i++) {
    if (y <= table[i].top) {
      const a = table[i - 1];
      const b = table[i];
      return a.line + ((y - a.top) / (b.top - a.top)) * (b.line - a.line);
    }
  }
  return table[table.length - 1].line;
}

/**
 * SPEC15 §3.3: anchor tops in the scroller's content coordinates, read from a
 * rendered pane's `data-mm-line` stamps. The one DOM-touching helper in this
 * module (the mapping above stays pure); both SplitView's sync and the app's
 * preview-mode scroll restore feed it their own scroller/doc pair.
 */
export function collectAnchors(scroller: HTMLElement, docEl: HTMLElement): SyncAnchor[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  return Array.from(docEl.querySelectorAll<HTMLElement>('[data-mm-line]')).map((el) => ({
    line: Number(el.dataset.mmLine),
    top: el.getBoundingClientRect().top - base,
  }));
}

export function offsetForLine(anchors: SyncAnchor[], contentHeight: number, line: number): number {
  const table = effectiveTable(anchors, contentHeight);
  const l = Math.min(Math.max(line, 1), table[table.length - 1].line);
  for (let i = 1; i < table.length; i++) {
    if (l <= table[i].line) {
      const a = table[i - 1];
      const b = table[i];
      return a.top + ((l - a.line) / (b.line - a.line)) * (b.top - a.top);
    }
  }
  return table[table.length - 1].top;
}

/** A row's vertical extent in its pane's CONTENT coordinates (scrollTop 0 = 0). */
export interface RowRect {
  top: number;
  bottom: number;
}

/**
 * Issue #310 (SPEC45 amended): whether a cue at `vpOffset` — its vertical
 * position relative to the viewport's top — is close enough to the leading
 * pane's viewport for cue-anchored alignment: one viewport above through two
 * below. Outside this window the SPEC15 block interpolation applies instead,
 * so a caret far from the reading position never yanks the follower.
 */
export function withinCueWindow(vpOffset: number, viewportHeight: number): boolean {
  return vpOffset > -viewportHeight && vpOffset < viewportHeight * 2;
}

/**
 * Issue #310 (SPEC45 amended): the follower's scrollTop that puts the vertical
 * CENTRE of its cue row level with the centre of the leader's row — centres,
 * not tops, so a heading's larger font no longer offsets the panes. Both rows
 * are in their own pane's content coordinates; the result clamps to
 * [0, followerMax] (SPEC15 §1.3: ends stay reachable), so an already-level
 * pair returns the follower's current position unchanged.
 */
export function centreAlignedOffset(leaderRow: RowRect, leaderScrollTop: number, followerCue: RowRect, followerMax: number): number {
  const leaderVpCentre = (leaderRow.top + leaderRow.bottom) / 2 - leaderScrollTop;
  const target = (followerCue.top + followerCue.bottom) / 2 - leaderVpCentre;
  return Math.min(Math.max(target, 0), Math.max(followerMax, 0));
}
