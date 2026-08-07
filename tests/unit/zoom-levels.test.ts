import { describe, expect, test } from 'vitest';
import { parseSections } from '../../src/lib/sectionModel';
import { UNTITLED_DOCUMENT, clampZoomLevel, zoomView } from '../../src/lib/zoomLevels';

const SOURCE = [
  '# Guide', // 1
  '', //       2
  'Opening.', // 3
  '', //       4
  '## Setup', // 5
  '', //       6
  'Setup body.', // 7
  '', //       8
  '### Windows', // 9
  '', //       10
  'Windows body.', // 11
  '', //       12
  '#### Notes', // 13
  '', //       14
  'Notes body.', // 15
  '', //       16
  '## Usage', // 17
  '', //       18
  'Usage body.', // 19
].join('\n');

const doc = parseSections(SOURCE);

describe('PRD 011 Req 17 — level-to-content mapping', () => {
  test('U490: L5 marks the source as shown verbatim and asks for no summaries', () => {
    const view = zoomView(doc, 5);
    expect(view.verbatim).toBe(true);
    expect(view.entries).toEqual([]);
    expect(view.title).toBe('Guide');
  });

  test('U491: L4 keeps every heading with its own per-section summary slot', () => {
    const view = zoomView(doc, 4);
    expect(view.verbatim).toBe(false);
    expect(view.entries.map((e) => e.title)).toEqual(['Guide', 'Setup', 'Windows', 'Notes', 'Usage']);
    for (const entry of view.entries) {
      expect(entry.summary).toEqual({ kind: 'section', sectionIds: [entry.id] });
      expect(entry.folded).toEqual([]);
    }
    expect(view.entries[1]).toMatchObject({ id: '1.1', depth: 2, headingLine: 5, startLine: 5, endLine: 16 });
  });

  test('U492: L3 keeps depth 2 and folds deeper sections into the nearest kept ancestor', () => {
    const view = zoomView(doc, 3);
    expect(view.entries.map((e) => e.id)).toEqual(['1', '1.1', '1.2']);

    const setup = view.entries[1];
    expect(setup.folded.map((f) => [f.id, f.title, f.depth])).toEqual([
      ['1.1.1', 'Windows', 3],
      ['1.1.1.1', 'Notes', 4],
    ]);
    expect(setup.summary.sectionIds).toEqual(['1.1', '1.1.1', '1.1.1.1']);
    expect(setup.sources.map((s) => s.body)).toEqual(['Setup body.', 'Windows body.', 'Notes body.']);

    // Nothing is silently dropped: every section reaches exactly one entry.
    const covered = view.entries.flatMap((e) => e.summary.sectionIds).sort();
    expect(covered).toEqual(['1', '1.1', '1.1.1', '1.1.1.1', '1.2']);
  });

  test('U493: L2 keeps depth-1 headings only, one summary slot each', () => {
    const view = zoomView(doc, 2);
    expect(view.entries.map((e) => e.id)).toEqual(['1']);
    expect(view.entries[0].summary.sectionIds).toEqual(['1', '1.1', '1.1.1', '1.1.1.1', '1.2']);
    expect(view.entries[0].folded.map((f) => f.id)).toEqual(['1.1', '1.1.1', '1.1.1.1', '1.2']);
  });

  test('U494: L1 is the title plus one whole-document summary slot', () => {
    const view = zoomView(doc, 1);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({ id: 'document', title: 'Guide', startLine: 1, endLine: doc.lineCount });
    expect(view.entries[0].summary.kind).toBe('document');
    expect(view.entries[0].summary.sectionIds).toEqual(['1', '1.1', '1.1.1', '1.1.1.1', '1.2']);
  });

  test('U495: the caller supplies the title when the document has no depth-1 heading', () => {
    const titleless = parseSections('## Only a subheading\n\nBody.\n');
    expect(zoomView(titleless, 1, { fallbackTitle: 'notes.md' }).title).toBe('notes.md');
    expect(zoomView(titleless, 1).title).toBe(UNTITLED_DOCUMENT);
  });

  test('U496: levels outside 1–5 clamp rather than throw', () => {
    expect(clampZoomLevel(0)).toBe(1);
    expect(clampZoomLevel(-7)).toBe(1);
    expect(clampZoomLevel(9)).toBe(5);
    expect(clampZoomLevel(3.4)).toBe(3);
    expect(clampZoomLevel(Number.NaN)).toBe(5);
    expect(zoomView(doc, 42).level).toBe(5);
    expect(zoomView(doc, 0).entries).toHaveLength(1);
  });

  test('U497: a document with no headings still yields a usable entry at every level', () => {
    const headless = parseSections('Just prose, no headings at all.\n');
    for (const level of [1, 2, 3, 4] as const) {
      const view = zoomView(headless, level, { fallbackTitle: 'plain.md' });
      expect(view.entries.length, `level ${level}`).toBeGreaterThan(0);
      expect(view.entries[0].sources.length, `level ${level}`).toBeGreaterThan(0);
      expect(view.title).toBe('plain.md');
    }
    // Even a wholly empty document has one entry to render at every level.
    const empty = parseSections('');
    expect(zoomView(empty, 3, { fallbackTitle: 'empty.md' }).entries.map((e) => e.id)).toEqual(['document']);
    expect(zoomView(empty, 1).entries[0].summary.sectionIds).toEqual([]);
  });
});
