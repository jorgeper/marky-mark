import { describe, expect, test } from 'vitest';
import { FLUID_DURATIONS_MS, FLUID_LARGE_OPERATION_CHARS, FLUID_LARGE_OPERATION_LINES } from '../src/lib/fluid';
import { elasticAt, glideAt } from '../src/lib/fluidCursor';
import {
  fluidRectAt,
  fluidSelectionCurve,
  fluidSelectionDecision,
  fluidSelectionRects,
  fluidSelectionShape,
  type FluidRect,
  type FluidSelectionDescriptor,
} from '../src/lib/fluidSelection';

const change = (over: Partial<FluidSelectionDescriptor> = {}): FluidSelectionDescriptor => ({
  docChanged: false,
  selectionSet: true,
  userEvent: 'select',
  from: { anchor: 4, head: 4 },
  to: { anchor: 4, head: 9 },
  fromLines: 1,
  toLines: 1,
  ...over,
});

describe('PRD 025 Fluid mode — selection change (issue #335)', () => {
  test('U1292: PRD 025 Req 11 — a selection-only change landing a range animates, whatever its user event; undo/redo landing a range too', () => {
    expect(fluidSelectionDecision(change({ userEvent: 'select' }))).toBe('animate'); // Shift+arrow/Home/End, select-all
    expect(fluidSelectionDecision(change({ userEvent: 'select.pointer' }))).toBe('animate'); // a drag step, shift-click
    expect(fluidSelectionDecision(change({ userEvent: null }))).toBe('animate'); // host selectRange, find-hit, vim visual
    expect(fluidSelectionDecision(change({ docChanged: true, userEvent: 'undo' }))).toBe('animate');
    expect(fluidSelectionDecision(change({ docChanged: true, userEvent: 'redo' }))).toBe('animate');
    // caret → range and range → range (grow, shrink, move the anchor).
    expect(fluidSelectionDecision(change({ from: { anchor: 4, head: 4 }, to: { anchor: 4, head: 9 } }))).toBe('animate');
    expect(fluidSelectionDecision(change({ from: { anchor: 4, head: 9 }, to: { anchor: 4, head: 12 } }))).toBe('animate');
    expect(fluidSelectionDecision(change({ from: { anchor: 4, head: 9 }, to: { anchor: 4, head: 6 } }))).toBe('animate');
    expect(fluidSelectionDecision(change({ from: { anchor: 4, head: 9 }, to: { anchor: 2, head: 9 } }))).toBe('animate');
    // A backwards range (head before anchor) is a range all the same.
    expect(fluidSelectionDecision(change({ from: { anchor: 9, head: 9 }, to: { anchor: 9, head: 3 } }))).toBe('animate');
  });

  test('U1293: PRD 025 Req 11 — no selection set, a caret result, unchanged ends, and every non-history document change are none', () => {
    expect(fluidSelectionDecision(change({ selectionSet: false }))).toBe('none');
    // A caret result belongs to the cursor effect: one transaction never triggers both.
    expect(fluidSelectionDecision(change({ from: { anchor: 4, head: 9 }, to: { anchor: 9, head: 9 } }))).toBe('none');
    expect(fluidSelectionDecision(change({ from: { anchor: 4, head: 4 }, to: { anchor: 7, head: 7 } }))).toBe('none');
    // Neither end moved.
    expect(fluidSelectionDecision(change({ from: { anchor: 4, head: 9 }, to: { anchor: 4, head: 9 } }))).toBe('none');
    // Typing over a selection, deleting it, pasting, completing, rewriting: the document keeps pace.
    for (const userEvent of ['input.type', 'delete.selection', 'input.paste', 'input.complete', 'delete.backward', null]) {
      expect(fluidSelectionDecision(change({ docChanged: true, userEvent }))).toBe('none');
    }
    // An undo that lands a caret is still none here (the cursor effect's territory).
    expect(
      fluidSelectionDecision(change({ docChanged: true, userEvent: 'undo', to: { anchor: 9, head: 9 } }))
    ).toBe('none');
  });

  test('U1294: PRD 025 Req 14 — a previous or new range past either #333 threshold snaps; exactly at a threshold still animates', () => {
    const over = FLUID_LARGE_OPERATION_CHARS + 1;
    // The new range is large by characters, or by lines.
    expect(fluidSelectionDecision(change({ to: { anchor: 0, head: over } }))).toBe('snap');
    expect(fluidSelectionDecision(change({ to: { anchor: over, head: 0 } }))).toBe('snap');
    expect(fluidSelectionDecision(change({ to: { anchor: 0, head: 60 }, toLines: FLUID_LARGE_OPERATION_LINES + 1 }))).toBe(
      'snap'
    );
    // The previous range was large and the new one is small: the shrink snaps too.
    expect(fluidSelectionDecision(change({ from: { anchor: 0, head: over }, to: { anchor: 0, head: 5 } }))).toBe('snap');
    expect(
      fluidSelectionDecision(
        change({ from: { anchor: 0, head: 60 }, fromLines: FLUID_LARGE_OPERATION_LINES + 1, to: { anchor: 0, head: 5 } })
      )
    ).toBe('snap');
    // Exactly at the thresholds: the predicate is strictly-greater (U1284).
    expect(fluidSelectionDecision(change({ to: { anchor: 0, head: FLUID_LARGE_OPERATION_CHARS } }))).toBe('animate');
    expect(fluidSelectionDecision(change({ to: { anchor: 0, head: 60 }, toLines: FLUID_LARGE_OPERATION_LINES }))).toBe(
      'animate'
    );
    // Snap is decided after the 'none' rules: a large-range result from typing is still none.
    expect(
      fluidSelectionDecision(change({ docChanged: true, userEvent: 'input.paste', to: { anchor: 0, head: over } }))
    ).toBe('none');
  });

  test('U1295: PRD 025 Req 11 — the ghost geometry: one rect for a single line, three for a multi-line range, a zero-width rect for a caret', () => {
    const contentLeft = 40;
    const contentRight = 640;
    // Single line: start → end on the same line box.
    const single = fluidSelectionRects({
      start: { left: 100, top: 20, bottom: 40 },
      end: { left: 180, top: 20, bottom: 40 },
      contentLeft,
      contentRight,
    });
    expect(single).toEqual([{ left: 100, top: 20, width: 80, height: 20 }]);

    // Caret (both ends the same box): one zero-width rect at the caret.
    const caret = fluidSelectionRects({
      start: { left: 100, top: 20, bottom: 40 },
      end: { left: 100, top: 20, bottom: 40 },
      contentLeft,
      contentRight,
    });
    expect(caret).toEqual([{ left: 100, top: 20, width: 0, height: 20 }]);

    // Multi-line: first line's tail to the content's right edge, a full-width
    // middle block between the two lines, the last line's head from the
    // content's left edge.
    const multi = fluidSelectionRects({
      start: { left: 100, top: 20, bottom: 40 },
      end: { left: 130, top: 80, bottom: 100 },
      contentLeft,
      contentRight,
    });
    expect(multi).toEqual([
      { left: 100, top: 20, width: contentRight - 100, height: 20 },
      { left: contentLeft, top: 40, width: contentRight - contentLeft, height: 40 },
      { left: contentLeft, top: 80, width: 130 - contentLeft, height: 20 },
    ]);
    // Two adjacent lines: the middle block is present but zero-height.
    const adjacent = fluidSelectionRects({
      start: { left: 100, top: 20, bottom: 40 },
      end: { left: 130, top: 40, bottom: 60 },
      contentLeft,
      contentRight,
    });
    expect(adjacent).toHaveLength(3);
    expect(adjacent[1]).toEqual({ left: contentLeft, top: 40, width: contentRight - contentLeft, height: 0 });

    // The fixed three slots: a one-rect shape pads with collapsed middle and
    // last-line slots so it tweens element-to-element into a three-rect one.
    const shape = fluidSelectionShape(single);
    expect(shape).toEqual([
      { left: 100, top: 20, width: 80, height: 20 },
      { left: 100, top: 40, width: 80, height: 0 },
      { left: 180, top: 20, width: 0, height: 20 },
    ]);
    expect(fluidSelectionShape(multi)).toEqual(multi);

    // Interpolation: endpoints exact, midpoint linear, overshoot extrapolates
    // the edges but never a negative size.
    const a: FluidRect = { left: 0, top: 0, width: 100, height: 10 };
    const b: FluidRect = { left: 50, top: 20, width: 0, height: 30 };
    expect(fluidRectAt(a, b, 0)).toEqual(a);
    expect(fluidRectAt(a, b, 1)).toEqual(b);
    expect(fluidRectAt(a, b, 0.5)).toEqual({ left: 25, top: 10, width: 50, height: 20 });
    expect(fluidRectAt(a, b, 1.5)).toEqual({ left: 75, top: 30, width: 0, height: 40 });

    // The curves are the cursor's own, over the catalogue durations.
    expect(fluidSelectionCurve('glide')).toEqual({ at: glideAt, durationMs: FLUID_DURATIONS_MS.glide });
    expect(fluidSelectionCurve('elastic')).toEqual({ at: elasticAt, durationMs: FLUID_DURATIONS_MS.elastic });
  });
});
