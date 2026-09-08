import { describe, expect, test } from 'vitest';
import { PREVIEW_BTN, previewButtonPos } from '../../src/lib/previewButton';

const viewport = { width: 1280, height: 720 };

describe('PRD 023 §13 preview selection button geometry (issues #306, #343)', () => {
  test('U1365: centred on the anchor line in the padding column; beneath a level copy-link when one is grafted; clamped below the toolbar floor and the tab strip', () => {
    const { size, gap, edge, toolbarFloor } = PREVIEW_BTN;
    // Issue #306: left hangs off the doc's content edge, top centres on the line.
    expect(previewButtonPos({ contentLeft: 300, y: 200, h: 20 }, viewport)).toEqual({
      left: 300 - gap - size,
      top: 200 + 10 - size / 2,
    });
    // Issue #343: with a copy-link level with the line, the button stacks one
    // gap beneath the link's bottom edge, centred on the link's x (the
    // graft's clip-aware position, not the content edge).
    expect(previewButtonPos({ contentLeft: 300, y: 200, h: 20, stack: { bottom: 222, centerX: 290 } }, viewport)).toEqual({
      left: 290 - size / 2,
      top: 222 + gap,
    });
    // The floor: the toolbar band by default…
    expect(previewButtonPos({ contentLeft: 300, y: 10, h: 20 }, viewport).top).toBe(toolbarFloor);
    // …pushed down to the tab strip's bottom edge while the strip shows.
    expect(previewButtonPos({ contentLeft: 300, y: 10, h: 20, floor: 80 }, viewport).top).toBe(80);
    // A strip floor never LIFTS the toolbar floor.
    expect(previewButtonPos({ contentLeft: 300, y: 10, h: 20, floor: 20 }, viewport).top).toBe(toolbarFloor);
    // Viewport clamps on both axes.
    expect(previewButtonPos({ contentLeft: 10, y: 5000, h: 20 }, viewport)).toEqual({
      left: edge,
      top: viewport.height - size - edge,
    });
  });
});
