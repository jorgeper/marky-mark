import { describe, expect, test } from 'vitest';
import { intersectCodeSelection } from '../src/lib/codeSelection';

describe('selection ∩ code ranges (issue #123)', () => {
  test('U675: the tint range is the part of the selection that lands inside a code construct — clipped at both ends, merged, sorted, empties dropped', () => {
    // A selection that starts in prose and runs into a fenced body: only the
    // code part is re-painted (the drawn layer already covers the prose).
    expect(intersectCodeSelection([{ from: 10, to: 20 }], [{ from: 4, to: 15 }])).toEqual([
      { from: 10, to: 15 },
    ]);
    // Fully inside, and fully containing, a code span.
    expect(intersectCodeSelection([{ from: 10, to: 20 }], [{ from: 12, to: 14 }])).toEqual([
      { from: 12, to: 14 },
    ]);
    expect(intersectCodeSelection([{ from: 10, to: 20 }], [{ from: 0, to: 99 }])).toEqual([
      { from: 10, to: 20 },
    ]);

    // No overlap (and a touching-but-empty overlap) contributes nothing:
    // a zero-length mark would make CodeMirror's RangeSetBuilder unhappy.
    expect(intersectCodeSelection([{ from: 10, to: 20 }], [{ from: 30, to: 40 }])).toEqual([]);
    expect(intersectCodeSelection([{ from: 10, to: 20 }], [{ from: 20, to: 25 }])).toEqual([]);

    // Multiple code spans crossed by one selection, out of order on input:
    // output is sorted, so the caller can feed a RangeSetBuilder directly.
    expect(
      intersectCodeSelection(
        [
          { from: 30, to: 40 },
          { from: 10, to: 20 },
        ],
        [{ from: 15, to: 35 }],
      ),
    ).toEqual([
      { from: 15, to: 20 },
      { from: 30, to: 35 },
    ]);

    // The same code node reported twice (one per visible range) and adjacent
    // pieces collapse into one mark instead of nesting duplicates.
    expect(
      intersectCodeSelection(
        [
          { from: 10, to: 20 },
          { from: 10, to: 20 },
          { from: 20, to: 26 },
        ],
        [{ from: 0, to: 99 }],
      ),
    ).toEqual([{ from: 10, to: 26 }]);

    // Multiple cursors: each non-empty selection contributes its own piece.
    expect(
      intersectCodeSelection(
        [{ from: 10, to: 40 }],
        [
          { from: 12, to: 14 },
          { from: 20, to: 22 },
        ],
      ),
    ).toEqual([
      { from: 12, to: 14 },
      { from: 20, to: 22 },
    ]);
  });
});
