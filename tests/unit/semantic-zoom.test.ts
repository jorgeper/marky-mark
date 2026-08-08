import { describe, expect, test } from 'vitest';
import { parseSections } from '../../src/lib/sectionModel';
import { EXCERPT_PLACEHOLDER } from '../../src/lib/sectionExcerpt';
import { ZOOM_LEVEL_FULL, type ZoomLevel } from '../../src/lib/zoomLevels';
import {
  buildZoomDocument,
  canStepZoom,
  diveFrom,
  focusLine,
  isZoomReadOnly,
  stepZoomLevel,
  zoomDocumentFromSource,
  EXCERPT_NOTICE,
  SEMANTIC_ZOOM_COMBOS,
  ZOOM_LEVEL_LABELS,
} from '../../src/lib/semanticZoom';
import { combosConflict, DEFAULT_HOTKEYS, type HotkeyMap } from '../../src/lib/hotkeys';

const DOC = `# Marky Mark

The intro paragraph. It says what the document is for.

## Editing

Editing prose. A second sentence here.

### Smart edit

Smart edit prose.

## Viewing

Viewing prose.
`;

const LEVELS: ZoomLevel[] = [1, 2, 3, 4, 5];

describe('PRD 011 Req 18 read-only levels', () => {
  test('U581: levels 1–4 are read-only and L5 is not — one predicate, no scattered literals', () => {
    expect(LEVELS.filter(isZoomReadOnly)).toEqual([1, 2, 3, 4]);
    expect(isZoomReadOnly(ZOOM_LEVEL_FULL)).toBe(false);
  });
});

describe('PRD 011 Req 17 five levels, rendered from the existing model', () => {
  const doc = parseSections(DOC);

  test('U582: L5 is verbatim and contributes no blocks — today’s render path is untouched', () => {
    const view = buildZoomDocument(doc, 5);
    expect(view.verbatim).toBe(true);
    expect(view.blocks).toEqual([]);
  });

  test('U583: L4 keeps every heading, L3 depth 2, L2 the top level, L1 the document alone', () => {
    expect(buildZoomDocument(doc, 4).blocks.map((b) => b.title)).toEqual([
      'Marky Mark',
      'Editing',
      'Smart edit',
      'Viewing',
    ]);
    expect(buildZoomDocument(doc, 3).blocks.map((b) => b.title)).toEqual(['Marky Mark', 'Editing', 'Viewing']);
    expect(buildZoomDocument(doc, 2).blocks.map((b) => b.title)).toEqual(['Marky Mark']);

    const l1 = buildZoomDocument(doc, 1);
    expect(l1.blocks).toHaveLength(1);
    expect(l1.blocks[0].title).toBe('Marky Mark');
  });

  test('U584: nothing is silently dropped — a folded descendant is named and feeds its host block', () => {
    const editing = buildZoomDocument(doc, 3).blocks.find((b) => b.title === 'Editing');
    expect(editing?.folded.map((f) => f.title)).toEqual(['Smart edit']);
    expect(editing?.body.text).toContain('Editing prose.');
    expect(editing?.body.text).toContain('Smart edit prose.');
  });

  test('U585: every block is an excerpt, never a summary — EXCERPT_PLACEHOLDER covers an empty section', () => {
    const view = zoomDocumentFromSource('# Title\n\n## Empty\n', 4);
    for (const block of view.blocks) expect(block.body.kind).toBe('excerpt');
    expect(view.blocks.find((b) => b.title === 'Empty')?.body.text).toBe(EXCERPT_PLACEHOLDER);
    expect(EXCERPT_NOTICE).toMatch(/excerpts/i);
  });

  test('U586: a heading-less, an empty and a `###`-first document all render something at every level', () => {
    for (const source of ['just prose, no headings at all', '', '### Deep first\n\nSome prose.\n']) {
      for (const level of [1, 2, 3, 4] as ZoomLevel[]) {
        const view = zoomDocumentFromSource(source, level, 'notes.md');
        expect(view.blocks.length, `${JSON.stringify(source)} @L${level}`).toBeGreaterThan(0);
        // No depth-1 title is assumed: the fallback title carries the view.
        expect(view.title).toBeTruthy();
        for (const block of view.blocks) expect(block.title).toBeTruthy();
      }
    }
    expect(zoomDocumentFromSource('', 1, 'notes.md').title).toBe('notes.md');
  });
});

describe('PRD 011 Req 21 semantic zoom control', () => {
  test('U587: every level carries a short label saying what it means', () => {
    for (const level of LEVELS) expect(ZOOM_LEVEL_LABELS[level].length).toBeGreaterThan(0);
    expect(ZOOM_LEVEL_LABELS[5]).toBe('Full document');
  });

  test('U588: stepping clamps rather than wraps, and the far end is inert', () => {
    expect(stepZoomLevel(5, 1)).toBe(5);
    expect(stepZoomLevel(1, -1)).toBe(1);
    expect(stepZoomLevel(3, 1)).toBe(4);
    expect(stepZoomLevel(3, -1)).toBe(2);
    expect(canStepZoom(5, 1)).toBe(false);
    expect(canStepZoom(1, -1)).toBe(false);
    expect(canStepZoom(5, -1)).toBe(true);
    expect(canStepZoom(1, 1)).toBe(true);
  });
});

describe('PRD 011 Req 19 click to dive in', () => {
  const doc = parseSections(DOC);

  test('U589: one click moves exactly one level toward L5, focused on the clicked section', () => {
    expect(diveFrom(2, '1')).toEqual({ level: 3, focusId: '1' });
    expect(diveFrom(3, '1.1')).toEqual({ level: 4, focusId: '1.1' });
    expect(diveFrom(4, '1.2')).toEqual({ level: 5, focusId: '1.2' });
    // At L5 there is nowhere further to dive.
    expect(diveFrom(5, '1')).toEqual({ level: 5, focusId: null });
    // The whole-document entry focuses nothing in particular.
    expect(diveFrom(1, 'document')).toEqual({ level: 2, focusId: null });
  });

  test('U590: the focus target resolves to the section’s heading line for the shared scroll path', () => {
    expect(focusLine(doc, '1.2')).toBe(doc.sections[0].children[1].headingLine);
    expect(focusLine(doc, null)).toBeNull();
    expect(focusLine(doc, 'nope')).toBeNull();
    // A preamble has no heading of its own, so there is no line to scroll to.
    expect(focusLine(parseSections('lead in\n\n# Title\n'), 'preamble')).toBeNull();
  });
});

describe('PRD 011 Req 23 a distinct feature from text zoom', () => {
  test('U591: the three combos are exactly the ones the PRD names, and none is a text-zoom combo', () => {
    expect(SEMANTIC_ZOOM_COMBOS).toEqual({
      semanticZoomIn: 'Mod+Shift+=',
      semanticZoomOut: 'Mod+Shift+-',
      semanticZoomReset: 'Mod+Shift+0',
    });
    for (const combo of Object.values(SEMANTIC_ZOOM_COMBOS)) {
      for (const text of ['Mod+=', 'Mod+-', 'Mod+0']) {
        expect(combosConflict(combo, text), `${combo} vs ${text}`).toBe(false);
      }
    }
  });

  test('U592: no semantic-zoom combo collides with any DEFAULT_HOTKEYS binding', () => {
    for (const combo of Object.values(SEMANTIC_ZOOM_COMBOS)) {
      for (const action of Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>) {
        expect(combosConflict(combo, DEFAULT_HOTKEYS[action]), `${combo} vs ${action}`).toBe(false);
      }
    }
  });
});
