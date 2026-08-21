import { describe, expect, test } from 'vitest';
import {
  MIN_DIAGRAM_WIDTH,
  resizedDiagramBox,
  rewriteFenceWidthAt,
  type DiagramCorner,
} from '../../src/lib/diagramResize';

// A mermaid-ish drawing: 300 wide, 150 tall — a 2:1 aspect that makes the
// height assertions unambiguous.
const VB_W = 300;
const VB_H = 150;

describe('PRD 015 Req 6: aspect-locked drag, clamped to [40px, the natural viewBox width]', () => {
  test('U783: a drag below the floor clamps to 40, from east and west corners alike', () => {
    // East corner shrinking: pointer moved far left of the start.
    expect(resizedDiagramBox('se', 200, -500, VB_W, VB_H).width).toBe(MIN_DIAGRAM_WIDTH);
    expect(resizedDiagramBox('ne', 200, -500, VB_W, VB_H).width).toBe(MIN_DIAGRAM_WIDTH);
    // West corners inject the inverted delta: moving RIGHT shrinks.
    expect(resizedDiagramBox('sw', 200, 500, VB_W, VB_H).width).toBe(MIN_DIAGRAM_WIDTH);
    expect(resizedDiagramBox('nw', 200, 500, VB_W, VB_H).width).toBe(MIN_DIAGRAM_WIDTH);
    // And the same pointer travel GROWS from a west corner.
    expect(resizedDiagramBox('nw', 200, -50, VB_W, VB_H).width).toBe(250);
  });

  test('U784: a drag past the natural layout width clamps to the viewBox width', () => {
    for (const corner of ['se', 'ne'] as DiagramCorner[]) {
      expect(resizedDiagramBox(corner, 200, 5000, VB_W, VB_H).width).toBe(VB_W);
    }
    expect(resizedDiagramBox('sw', 200, -5000, VB_W, VB_H).width).toBe(VB_W);
    // A degenerate viewBox leaves the drag uncapped above (never NaN).
    expect(resizedDiagramBox('se', 200, 5000, 0, 0).width).toBe(5200);
  });

  test('U785: the height follows the viewBox aspect at both clamped ends and in between — the whole drawing scales', () => {
    const min = resizedDiagramBox('se', 200, -500, VB_W, VB_H);
    expect(min.height).toBe(min.width * (VB_H / VB_W));
    const max = resizedDiagramBox('se', 200, 5000, VB_W, VB_H);
    expect(max.height).toBe(VB_W * (VB_H / VB_W));
    // Mid-range: the width follows the pointer exactly, the height follows it.
    const mid = resizedDiagramBox('se', 200, -60, VB_W, VB_H);
    expect(mid.width).toBe(140);
    expect(mid.height).toBe(70);
  });
});

const DOC = [
  '# Title',
  '',
  '```mermaid width=200 keep=this',
  'graph TD',
  '  A --> B',
  '```',
  '',
  'A closing paragraph.',
].join('\n');

describe('PRD 015 Reqs 7–8: the release rewrite over the whole buffer text', () => {
  test('U786: a resize rewrites exactly the opening fence line; every other byte and token survives', () => {
    const out = rewriteFenceWidthAt(DOC, 3, 350);
    expect(out).toBe(DOC.replace('```mermaid width=200 keep=this', '```mermaid width=350 keep=this'));
    // A fence with no token gains one at the end of the meta.
    const bare = 'intro\n```mermaid\nA --> B\n```\n';
    expect(rewriteFenceWidthAt(bare, 2, 120)).toBe('intro\n```mermaid width=120\nA --> B\n```\n');
  });

  test('U787: a reset removes the token and the single space before it; resetting a widthless fence is byte-identical (the SAME text back)', () => {
    expect(rewriteFenceWidthAt(DOC, 3, null)).toBe(
      DOC.replace('```mermaid width=200 keep=this', '```mermaid keep=this')
    );
    const bare = 'intro\n```mermaid\nA --> B\n```\n';
    // Identity, not just equality: the caller compares references to skip the
    // buffer write entirely — no dirty dot, no undo entry, no save.
    expect(rewriteFenceWidthAt(bare, 2, null)).toBe(bare);
  });

  test('U788: writing the width the line already carries, aiming past the document, or aiming at a non-fence line all return the input itself', () => {
    expect(rewriteFenceWidthAt(DOC, 3, 200)).toBe(DOC);
    expect(rewriteFenceWidthAt(DOC, 99, 350)).toBe(DOC);
    expect(rewriteFenceWidthAt(DOC, 0, 350)).toBe(DOC);
    expect(rewriteFenceWidthAt(DOC, 1, 350)).toBe(DOC); // a heading, not a fence
    // The last line of a document without a trailing newline is reachable.
    const tailFence = '# T\n```mermaid width=90';
    expect(rewriteFenceWidthAt(tailFence, 2, 91)).toBe('# T\n```mermaid width=91');
  });
});
