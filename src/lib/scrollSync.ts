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
