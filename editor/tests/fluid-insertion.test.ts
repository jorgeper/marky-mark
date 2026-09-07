import { describe, expect, test } from 'vitest';
import {
  FLUID_DURATIONS_MS,
  FLUID_LARGE_OPERATION_CHARS,
  FLUID_LARGE_OPERATION_LINES,
  fluidEffectsFor,
} from '../src/lib/fluid';
import { fluidInsertionSpans, type FluidInsertedSpan, type FluidInsertionDescriptor } from '../src/lib/fluidInsertion';

/** A pure insertion of `toB - fromB` characters at `fromB`, on one line. */
const insertion = (fromB: number, toB: number, over: Partial<FluidInsertedSpan> = {}): FluidInsertedSpan => ({
  fromB,
  toB,
  removedLength: 0,
  removedLines: 1,
  insertedLines: 1,
  ...over,
});

/** A pure removal: nothing inserted (`toB === fromB`). */
const removal = (fromB: number, removedLength: number, removedLines = 1): FluidInsertedSpan => ({
  fromB,
  toB: fromB,
  removedLength,
  removedLines,
  insertedLines: 1,
});

const change = (over: Partial<FluidInsertionDescriptor> = {}): FluidInsertionDescriptor => ({
  docChanged: true,
  userEvent: 'input.type',
  spans: [insertion(4, 5)],
  ...over,
});

describe('PRD 025 Fluid mode — insertion (issue #337)', () => {
  test('U1302: PRD 025 Req 13 — every inserting span is animated whatever its user event, a replacement included, multi-line or not, and two spans are both returned', () => {
    for (const userEvent of ['input.type', 'input.paste', 'input.drop', 'input.complete', 'undo', 'redo', null]) {
      expect(fluidInsertionSpans(change({ userEvent }))).toEqual([insertion(4, 5)]);
    }
    // Typing over a selection, a completion, a smart-edit rewrite: the new text is an insertion.
    const replacement = insertion(0, 1, { removedLength: 12 });
    for (const userEvent of ['input.type', 'input.paste', 'input.complete', null]) {
      expect(fluidInsertionSpans(change({ userEvent, spans: [replacement] }))).toEqual([replacement]);
    }
    // A multi-line paste.
    const multi = insertion(10, 60, { insertedLines: 3 });
    expect(fluidInsertionSpans(change({ userEvent: 'input.paste', spans: [multi] }))).toEqual([multi]);
    // Multi-cursor typing: one span per cursor, both returned in order.
    const a = insertion(4, 5);
    const b = insertion(21, 22);
    expect(fluidInsertionSpans(change({ spans: [a, b] }))).toEqual([a, b]);
  });

  test('U1303: PRD 025 Req 13 — no document change, removal-only spans and an IME composition step draw nothing; a mixed transaction masks only the inserting span', () => {
    expect(fluidInsertionSpans(change({ docChanged: false }))).toEqual([]);
    // Backspace, Delete, cut, delete-line, a removal-only undo/redo: nothing inserted.
    for (const userEvent of ['delete.backward', 'delete.forward', 'delete.cut', 'delete.line', 'undo', 'redo', null]) {
      expect(fluidInsertionSpans(change({ userEvent, spans: [removal(4, 1)] }))).toEqual([]);
    }
    expect(fluidInsertionSpans(change({ spans: [removal(0, 30, 3), removal(50, 2)] }))).toEqual([]);
    expect(fluidInsertionSpans(change({ spans: [] }))).toEqual([]);
    // An IME composition step: its text is still being decided and must stay readable.
    expect(fluidInsertionSpans(change({ userEvent: 'input.type.compose' }))).toEqual([]);
    expect(
      fluidInsertionSpans(
        change({
          userEvent: 'input.type.compose',
          spans: [insertion(0, 3, { removedLength: 2 })],
        })
      )
    ).toEqual([]);
    // Mixed (multi-cursor, a drop): the inserting span alone.
    const inserting = insertion(19, 24);
    expect(fluidInsertionSpans(change({ userEvent: 'input.drop', spans: [removal(4, 5), inserting] }))).toEqual([
      inserting,
    ]);
  });

  test('U1304: PRD 025 Req 14 — inserting or removing more than 2,000 characters or more than 50 lines draws nothing, two spans count together, and exactly at a threshold still animates', () => {
    const overChars = insertion(0, FLUID_LARGE_OPERATION_CHARS + 1);
    expect(fluidInsertionSpans(change({ userEvent: 'input.paste', spans: [overChars] }))).toEqual([]);
    const overLines = insertion(0, 100, {
      insertedLines: FLUID_LARGE_OPERATION_LINES + 1,
    });
    expect(fluidInsertionSpans(change({ userEvent: 'input.paste', spans: [overLines] }))).toEqual([]);
    // Select-all + type on a long document: one character replaces more than
    // a threshold's worth of removed text — the change touched it all.
    const overRemovedChars = insertion(0, 1, {
      removedLength: FLUID_LARGE_OPERATION_CHARS + 1,
      removedLines: 40,
    });
    expect(fluidInsertionSpans(change({ spans: [overRemovedChars] }))).toEqual([]);
    const overRemovedLines = insertion(0, 1, {
      removedLength: 500,
      removedLines: FLUID_LARGE_OPERATION_LINES + 1,
    });
    expect(fluidInsertionSpans(change({ spans: [overRemovedLines] }))).toEqual([]);
    // Two spans that only together exceed a threshold: the whole change is large.
    const halfChars = insertion(0, FLUID_LARGE_OPERATION_CHARS / 2 + 1);
    const otherHalf = insertion(3000, 3000 + FLUID_LARGE_OPERATION_CHARS / 2);
    expect(fluidInsertionSpans(change({ spans: [halfChars, otherHalf] }))).toEqual([]);
    const someLines = insertion(0, 10, { insertedLines: 30 });
    const moreLines = insertion(500, 510, { insertedLines: 21 });
    expect(fluidInsertionSpans(change({ spans: [someLines, moreLines] }))).toEqual([]);
    // Exactly at either threshold still animates (strictly greater).
    const exactChars = insertion(0, FLUID_LARGE_OPERATION_CHARS);
    expect(fluidInsertionSpans(change({ spans: [exactChars] }))).toEqual([exactChars]);
    const exactLines = insertion(0, 100, {
      insertedLines: FLUID_LARGE_OPERATION_LINES,
    });
    expect(fluidInsertionSpans(change({ spans: [exactLines] }))).toEqual([exactLines]);
    const exactRemoved = insertion(0, 1, {
      removedLength: FLUID_LARGE_OPERATION_CHARS,
      removedLines: FLUID_LARGE_OPERATION_LINES,
    });
    expect(fluidInsertionSpans(change({ spans: [exactRemoved] }))).toEqual([exactRemoved]);
  });

  test('U1305: PRD 025 Reqs 7, 8, 13 — Fade and Pop live within 120–250 ms and are exactly the effects offered for an insertion', () => {
    for (const effect of ['fade', 'pop'] as const) {
      expect(FLUID_DURATIONS_MS[effect]).toBeGreaterThanOrEqual(120);
      expect(FLUID_DURATIONS_MS[effect]).toBeLessThanOrEqual(250);
    }
    expect(fluidEffectsFor('insertion')).toEqual(['fade', 'pop']);
  });
});
