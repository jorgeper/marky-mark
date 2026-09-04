import DiffMatchPatch from 'diff-match-patch';

/**
 * SPEC16 §2: line-level buffer-vs-saved diff for the Changes Since Save
 * decorations. Built on the existing diff-match-patch line mode — no new
 * dependencies. Lines are 1-based positions in the CURRENT buffer;
 * `deletedAfter` entries are the current line a deletion follows (0 = saved
 * text was removed before the first line).
 */

export interface DiffLineSets {
  changed: number[];
  deletedAfter: number[];
}

const dmp = new DiffMatchPatch();

export function diffLineSets(saved: string, current: string): DiffLineSets {
  if (saved === current) return { changed: [], deletedAfter: [] };

  // Normalize trailing newlines so "the last line" compares as itself —
  // otherwise appending below it makes the unchanged line read as changed.
  const s = saved.endsWith('\n') ? saved : `${saved}\n`;
  const c = current.endsWith('\n') ? current : `${current}\n`;
  if (s === c) return { changed: [], deletedAfter: [] };

  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(s, c);
  const diffs = dmp.diff_main(chars1, chars2, false);
  dmp.diff_charsToLines_(diffs, lineArray);

  const changed = new Set<number>();
  const deletedAfter = new Set<number>();
  let line = 0; // last completed current-buffer line

  const lineCount = (text: string) => {
    // Each diff chunk is whole lines; a trailing chunk may lack the final \n.
    const n = (text.match(/\n/g) ?? []).length;
    return text.length > 0 && !text.endsWith('\n') ? n + 1 : n;
  };

  for (const [op, text] of diffs as Array<[number, string]>) {
    const n = lineCount(text);
    if (op === 0) {
      line += n;
    } else if (op === 1) {
      for (let i = 1; i <= n; i++) changed.add(line + i);
      line += n;
    } else {
      // Deletion: saved lines vanished after the current position.
      if (n > 0) deletedAfter.add(line);
    }
  }

  // A replacement produces adjacent delete+insert; the changed tint already
  // tells the story there — drop deletion markers that sit on a changed line.
  for (const d of [...deletedAfter]) {
    if (changed.has(d + 1)) deletedAfter.delete(d);
  }

  return {
    changed: [...changed].sort((a, b) => a - b),
    deletedAfter: [...deletedAfter].sort((a, b) => a - b),
  };
}
