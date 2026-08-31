import { describe, expect, test } from 'vitest';
import { parseSections } from '../../src/lib/sectionModel';
import {
  activeTocEntryId,
  activeTocReveal,
  buildTocTree,
  expandTocAncestors,
  findTocEntry,
  flattenToc,
  tocAncestorIds,
  toggleTocCollapsed,
  visibleTocEntries,
} from '../../src/lib/tocModel';

/**
 * PRD 012 Req 13: the TOC's pure logic, tested straight — the module takes the
 * section model's output in and returns plain data, so every case here is a
 * markdown string through `parseSections` and an assertion on the result. No
 * component, no DOM: nothing user-visible lands with this module.
 */

const tree = (source: string) => buildTocTree(parseSections(source));

const doc = [
  'Intro prose before any heading.', // 1
  '', // 2
  '# Title', // 3
  '', // 4
  'Title body.', // 5
  '', // 6
  '### Deep', // 7 — a skipped level (H1 → H3)
  '', // 8
  'Deep body.', // 9
  '', // 10
  '## Alpha', // 11
  '', // 12
  '### Alpha one', // 13
  '', // 14
  'Alpha one body.', // 15
  '', // 16
  '## Beta', // 17
  '', // 18
  'Beta body.', // 19
].join('\n');

describe('PRD 012 Req 2 — TOC tree derivation from the section model', () => {
  test('U654: every H1–H6 in document order, nested under its nearest shallower heading', () => {
    const entries = tree(doc);

    // One root: the H1. Everything below hangs off it, skipped levels included.
    expect(entries).toHaveLength(1);
    const title = entries[0];
    expect(title.id).toBe('1');
    expect(title.title).toBe('Title');
    expect(title.depth).toBe(1);
    expect(title.headingLine).toBe(3);
    expect(title.endLine).toBe(19); // covers descendants — the rest of the document

    // PRD 012 Req 2: an H1 followed by an H3 nests the H3 under the H1.
    expect(title.children.map((c) => [c.id, c.title, c.depth])).toEqual([
      ['1.1', 'Deep', 3],
      ['1.2', 'Alpha', 2],
      ['1.3', 'Beta', 2],
    ]);
    expect(title.children[1].children.map((c) => [c.id, c.title])).toEqual([['1.2.1', 'Alpha one']]);

    // Document order, depth-first, with the heading lines the view navigates to.
    expect(flattenToc(entries).map((e) => [e.title, e.headingLine])).toEqual([
      ['Title', 3],
      ['Deep', 7],
      ['Alpha', 11],
      ['Alpha one', 13],
      ['Beta', 17],
    ]);
  });

  test('U655: an H3 with no shallower heading before it is a root', () => {
    const entries = tree(['### Orphan', '', 'Body.', '', '# Later', '', 'More.'].join('\n'));
    expect(entries.map((e) => [e.id, e.title, e.depth])).toEqual([
      ['1', 'Orphan', 3],
      ['2', 'Later', 1],
    ]);
    expect(entries.every((e) => e.children.length === 0)).toBe(true);
  });

  test('U656: the preamble is not a TOC entry — content before the first heading yields no row', () => {
    const parsed = parseSections(doc);
    expect(parsed.preamble?.id).toBe('preamble'); // the section model does have one
    // ...and it is nowhere in the TOC: no depth-0 row, no 'preamble' id.
    const all = flattenToc(buildTocTree(parsed));
    expect(all.some((e) => e.id === 'preamble')).toBe(false);
    expect(all.every((e) => e.depth >= 1 && e.depth <= 6)).toBe(true);

    // A document that is nothing but preamble has no entries at all.
    expect(tree('Just prose.\n\nMore prose.\n')).toEqual([]);
  });

  test('U657: derivation is from the mdast parse — headings inside a fenced code block are not entries', () => {
    const entries = tree(
      [
        '# Real',
        '',
        '```md',
        '# Fake heading',
        '## Also fake',
        '```',
        '',
        '## Really real',
        '',
        'Body.',
      ].join('\n')
    );

    const titles = flattenToc(entries).map((e) => e.title);
    expect(titles).toEqual(['Real', 'Really real']);
    expect(titles.some((t) => t.toLowerCase().includes('fake'))).toBe(false);
  });
});

describe('PRD 012 Req 3 — positional identity', () => {
  test('U658: two headings with identical text are distinct entries', () => {
    const entries = tree(
      ['# Notes', '', '## Setup', '', 'First.', '', '# Other', '', '## Setup', '', 'Second.'].join('\n')
    );

    const setups = flattenToc(entries).filter((e) => e.title === 'Setup');
    expect(setups).toHaveLength(2);
    // Ids come from SectionNode.id — positional, not derived from the text.
    expect(setups.map((e) => e.id)).toEqual(['1.1', '2.1']);
    expect(setups.map((e) => e.headingLine)).toEqual([3, 9]);
    expect(findTocEntry(entries, '1.1')?.headingLine).toBe(3);
    expect(findTocEntry(entries, '2.1')?.headingLine).toBe(9);
  });
});

describe('PRD 012 Req 4 — collapse-set handling', () => {
  test('U659: entries default to expanded — the empty collapse set shows the whole tree', () => {
    const entries = tree(doc);
    const visible = visibleTocEntries(entries, new Set());

    expect(visible.map((v) => v.entry.title)).toEqual(['Title', 'Deep', 'Alpha', 'Alpha one', 'Beta']);
    expect(visible.every((v) => !v.collapsed)).toBe(true);
    expect(visible.map((v) => v.hasChildren)).toEqual([true, false, true, false, false]);
  });

  test('U660: toggling collapses and re-expands one entry; an unknown id is a no-op', () => {
    const entries = tree(doc);

    const collapsed = toggleTocCollapsed(entries, new Set(), '1.2');
    expect([...collapsed]).toEqual(['1.2']);
    expect([...toggleTocCollapsed(entries, collapsed, '1.2')]).toEqual([]);

    // Unknown ids never enter the set — no throw, nothing added.
    expect([...toggleTocCollapsed(entries, collapsed, 'nope')]).toEqual(['1.2']);
    expect([...toggleTocCollapsed(entries, new Set(), 'preamble')]).toEqual([]);

    // The input set is never mutated.
    const input = new Set(['1.2']);
    toggleTocCollapsed(entries, input, '1.3');
    expect([...input]).toEqual(['1.2']);
  });

  test('U661: a collapsed entry stays visible; its descendants do not', () => {
    const entries = tree(doc);
    const visible = visibleTocEntries(entries, new Set(['1.2']));

    // 'Alpha' itself renders (collapsed), 'Alpha one' is hidden beneath it.
    expect(visible.map((v) => v.entry.title)).toEqual(['Title', 'Deep', 'Alpha', 'Beta']);
    expect(visible.find((v) => v.entry.id === '1.2')?.collapsed).toBe(true);

    // Collapsing the root hides everything below it, root row included.
    expect(visibleTocEntries(entries, new Set(['1'])).map((v) => v.entry.title)).toEqual(['Title']);

    // A collapsed id inside a collapsed ancestor changes nothing visible.
    expect(visibleTocEntries(entries, new Set(['1', '1.2'])).map((v) => v.entry.title)).toEqual(['Title']);
  });

  test('U662: the ancestor chain expands for reveal, outermost first, and is a no-op when nothing is collapsed', () => {
    const entries = tree(doc);

    expect(tocAncestorIds(entries, '1.2.1')).toEqual(['1', '1.2']);
    expect(tocAncestorIds(entries, '1')).toEqual([]); // a root has no chain
    expect(tocAncestorIds(entries, 'nope')).toEqual([]); // unknown id: no chain, no throw

    // PRD 012 Req 7's auto-reveal: everything on the chain is expanded, other
    // collapsed entries are left alone.
    const revealed = expandTocAncestors(entries, new Set(['1', '1.2', '1.3']), '1.2.1');
    expect([...revealed]).toEqual(['1.3']);
    expect(visibleTocEntries(entries, revealed).map((v) => v.entry.id)).toEqual(['1', '1.1', '1.2', '1.2.1', '1.3']);

    // No-op when nothing on the chain is collapsed, and for an unknown id.
    expect([...expandTocAncestors(entries, new Set(['1.3']), '1.2.1')]).toEqual(['1.3']);
    expect([...expandTocAncestors(entries, new Set(['1.3']), 'nope')]).toEqual(['1.3']);
  });
});

describe('PRD 012 Req 7 — active-section resolution', () => {
  test('U663: the active entry is the deepest heading whose range contains the line', () => {
    const entries = tree(doc);

    // A line ON a heading is that heading.
    expect(activeTocEntryId(entries, 3)).toBe('1'); // # Title
    expect(activeTocEntryId(entries, 13)).toBe('1.2.1'); // ### Alpha one

    // A line inside a nested section's body is that nested section — the
    // ancestor contains the line too, and loses to the deeper match.
    expect(activeTocEntryId(entries, 15)).toBe('1.2.1'); // Alpha one body
    expect(activeTocEntryId(entries, 9)).toBe('1.1'); // Deep body
    expect(activeTocEntryId(entries, 19)).toBe('1.3'); // Beta body

    // A line in an ancestor's OWN body resolves to the ancestor.
    expect(activeTocEntryId(entries, 5)).toBe('1'); // Title body, before ### Deep
    expect(activeTocEntryId(entries, 12)).toBe('1.2'); // between ## Alpha and its child
  });

  test('U664: a line before the first heading has no active entry', () => {
    const entries = tree(doc);
    expect(activeTocEntryId(entries, 1)).toBeNull(); // preamble prose
    expect(activeTocEntryId(entries, 2)).toBeNull();
    // Out-of-range lines resolve to no entry rather than throwing.
    expect(activeTocEntryId(entries, 0)).toBeNull();
    expect(activeTocEntryId(entries, 999)).toBeNull();
  });
});

describe('PRD 012 Req 13 — the empty document', () => {
  test('U665: no headings yields an empty tree, an empty visible list and a null active entry', () => {
    for (const source of ['', '\n', 'Just prose.\n', '```md\n# Fenced only\n```\n']) {
      const entries = tree(source);
      expect(entries).toEqual([]);
      expect(flattenToc(entries)).toEqual([]);
      expect(visibleTocEntries(entries, new Set())).toEqual([]);
      expect(activeTocEntryId(entries, 1)).toBeNull();
      expect(findTocEntry(entries, '1')).toBeNull();
      expect(tocAncestorIds(entries, '1')).toEqual([]);
      expect([...toggleTocCollapsed(entries, new Set(), '1')]).toEqual([]);
      expect([...expandTocAncestors(entries, new Set(), '1')]).toEqual([]);
    }
  });
});

describe('PRD 012 Req 7 — the active entry and its reveal, resolved together', () => {
  test('U912: the resolver returns the active id with the collapse set the reveal needs, and the SAME set when nothing had to move', () => {
    const entries = tree(doc);

    // Nothing collapsed: the id is `activeTocEntryId`'s answer and the caller's
    // own set comes back BY IDENTITY — a scroll inside an already-visible
    // subtree must not look like a state change to the caller.
    const open = new Set<string>();
    const inAlphaOne = activeTocReveal(entries, open, 15);
    expect(inAlphaOne.id).toBe('1.2.1');
    expect(inAlphaOne.collapsed).toBe(open);

    // Buried under collapsed ancestors: the chain expands, and only the chain.
    const folded = new Set(['1', '1.2', '1.3']);
    const revealed = activeTocReveal(entries, folded, 15);
    expect(revealed.id).toBe('1.2.1');
    expect(revealed.collapsed).not.toBe(folded);
    expect([...revealed.collapsed]).toEqual(['1.3']); // the unrelated fold stays
    expect(visibleTocEntries(entries, revealed.collapsed).map((v) => v.entry.id)).toContain('1.2.1');

    // The ACTIVE entry's own fold is not opened — it is its ancestors that hide
    // it, and a reader who folded the active section keeps that fold.
    const selfFolded = new Set(['1.2.1']);
    const self = activeTocReveal(entries, selfFolded, 15);
    expect(self.id).toBe('1.2.1');
    expect(self.collapsed).toBe(selfFolded);

    // No line (the mode has none yet) and a preamble line: no id, no reveal.
    expect(activeTocReveal(entries, folded, null)).toEqual({ id: null, collapsed: folded });
    expect(activeTocReveal(entries, folded, null).collapsed).toBe(folded);
    const preamble = activeTocReveal(entries, folded, 1);
    expect(preamble.id).toBeNull();
    expect(preamble.collapsed).toBe(folded);

    // A heading-less document resolves to nothing and leaves the set alone.
    const none = new Set<string>(['x']);
    expect(activeTocReveal(tree('Just prose.\n'), none, 1)).toEqual({ id: null, collapsed: none });
  });
});
