/**
 * SPEC16 §4: the heading palette's matcher. Case-insensitive subsequence
 * match with a simple score — word-start hits and consecutive runs rank
 * higher. Empty query returns the items unchanged (document order). Pure.
 */

function score(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  let total = 0;
  let lastHit = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === c) {
        found = ti;
        break;
      }
    }
    if (found === -1) return null; // not a subsequence
    let points = 1;
    if (found === 0 || /[\s\-_/.]/.test(t[found - 1])) points += 3; // word start
    if (found === lastHit + 1) points += 4; // consecutive runs beat scattered word starts
    total += points;
    lastHit = found;
    ti = found + 1;
  }
  return total;
}

export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string): T[] {
  if (!query.trim()) return [...items];
  const scored: Array<{ item: T; s: number; i: number }> = [];
  items.forEach((item, i) => {
    const s = score(query.trim(), text(item));
    if (s !== null) scored.push({ item, s, i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i); // score desc, stable by position
  return scored.map((e) => e.item);
}
