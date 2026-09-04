import { describe, expect, test } from 'vitest';
import { createAnchor, hasNote, mapHighlightsToSource, reanchor, type Anchor } from '../../src/lib/anchoring';

const DOC = [
  'Markimark is a lightweight markdown viewer.',
  'Anchors survive ordinary edits to the document.',
  'The quick brown fox jumps over the lazy dog.',
  'Selections are stored with prefix and suffix context.',
  'This is the closing paragraph of the sample text.',
].join('\n\n');

describe('re-anchoring cascade', () => {
  test('U1: exact-offset re-anchor succeeds after no edit', () => {
    const start = DOC.indexOf('quick brown fox');
    const anchor = createAnchor(DOC, start, start + 'quick brown fox'.length);
    const m = reanchor(anchor, DOC);
    expect(m).not.toBeNull();
    expect(m!.strategy).toBe('exact');
    expect(DOC.slice(m!.start, m!.end)).toBe('quick brown fox');
  });

  test('U2: quote-search re-anchor succeeds after text inserted before the anchor', () => {
    const start = DOC.indexOf('quick brown fox');
    const anchor = createAnchor(DOC, start, start + 'quick brown fox'.length);
    const edited = `A brand new opening paragraph pushes everything down.\n\n${DOC}`;
    const m = reanchor(anchor, edited);
    expect(m).not.toBeNull();
    expect(m!.strategy).toBe('quote');
    expect(edited.slice(m!.start, m!.end)).toBe('quick brown fox');
    expect(m!.start).not.toBe(anchor.start);
  });

  test('U3: prefix/suffix disambiguates when exact appears 3+ times', () => {
    const doc = [
      'alpha section: the target phrase appears here first.',
      'beta section: the target phrase appears here again.',
      'gamma section: the target phrase appears here finally.',
    ].join('\n\n');
    // Anchor the SECOND occurrence.
    const second = doc.indexOf('the target phrase', doc.indexOf('beta'));
    const anchor = createAnchor(doc, second, second + 'the target phrase'.length);
    expect(doc.split('the target phrase').length - 1).toBeGreaterThanOrEqual(3);

    // Shift everything so stored offsets are stale, then re-anchor.
    const edited = `INSERTED HEAD MATERIAL.\n\n${doc}`;
    const m = reanchor(anchor, edited);
    expect(m).not.toBeNull();
    expect(m!.strategy).toBe('quote');
    // It must pick the beta-section occurrence, identified by its prefix.
    const before = edited.slice(Math.max(0, m!.start - 14), m!.start);
    expect(before).toContain('beta section: ');
  });

  test('U4: fuzzy re-anchor survives a 1–2 character typo inside the anchored text', () => {
    const start = DOC.indexOf('Anchors survive ordinary edits');
    const anchor = createAnchor(DOC, start, start + 'Anchors survive ordinary edits'.length);
    const edited = DOC.replace('survive ordinary', 'survivee ordnary'); // 2 typos inside the anchor
    expect(edited).not.toContain(anchor.exact);
    const m = reanchor(anchor, edited);
    expect(m).not.toBeNull();
    expect(m!.strategy).toBe('fuzzy');
    expect(edited.slice(m!.start, m!.end)).toContain('ordnary');
  });

  test('U5: orphaning triggers when the anchored text is fully deleted', () => {
    const start = DOC.indexOf('The quick brown fox jumps over the lazy dog.');
    const sentence = 'The quick brown fox jumps over the lazy dog.';
    const anchor = createAnchor(DOC, start, start + sentence.length);
    const edited = DOC.replace(`${sentence}\n\n`, '');
    expect(edited).not.toContain('quick brown fox');
    const m = reanchor(anchor, edited);
    expect(m).toBeNull();
  });
});

describe('PRD 022 Req 9 standing-card predicate (issue #232)', () => {
  const reply = { id: 'r1', author: 'a', createdAt: '2026-09-04T00:00:00.000Z', body: 'a reply' };

  test('U1103: an empty or whitespace-only body with no thread is note-less', () => {
    expect(hasNote({ body: '', thread: [] })).toBe(false);
    expect(hasNote({ body: '  \n\t', thread: [] })).toBe(false);
  });

  test('U1104: a root note makes the entry noted', () => {
    expect(hasNote({ body: 'a note', thread: [] })).toBe(true);
  });

  test('U1105: a reply alone makes the entry noted — legacy shapes keep their standing card', () => {
    expect(hasNote({ body: '', thread: [reply] })).toBe(true);
  });
});

describe('PRD 022 Req 12 editor-pane highlight mapping (issue #234)', () => {
  const anchorFor = (exact: string, prefix = '', suffix = ''): Anchor => ({
    exact,
    prefix,
    suffix,
    start: 0,
    end: exact.length,
  });

  test('U1107: a unique exact-quote match paints with correct source offsets, id and color passed through', () => {
    const source = '# Title\n\nSome **bold** prose with a lone needle phrase in it.\n';
    const ranges = mapHighlightsToSource(
      [{ id: 'c1', color: 'green', anchor: anchorFor('lone needle phrase') }],
      source
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].id).toBe('c1');
    expect(ranges[0].color).toBe('green');
    expect(source.slice(ranges[0].from, ranges[0].to)).toBe('lone needle phrase');
  });

  test('U1108: an absent quote skips — rendered text that crosses markdown syntax never mispaints', () => {
    // Rendered "bold prose" spans a ** marker in source, so the exact quote
    // is absent there; the entry simply does not map.
    const source = 'Some **bold** prose here.\n';
    const ranges = mapHighlightsToSource([{ id: 'c1', anchor: anchorFor('bold prose') }], source);
    expect(ranges).toEqual([]);
  });

  test('U1109: an ambiguous quote with no deciding context skips — never a guess', () => {
    const line = 'identical sentence with the twin phrase inside it and identical padding after.';
    const source = `${line}\n\n${line}\n`;
    const ranges = mapHighlightsToSource(
      [{ id: 'c1', anchor: anchorFor('twin phrase', 'sentence with the ', ' inside it and ') }],
      source
    );
    expect(ranges).toEqual([]);
  });

  test('U1110: stored context disambiguates multiple occurrences when it yields one confident winner', () => {
    const source = 'alpha lead-in the target phrase ends alpha.\n\nbeta lead-in the target phrase ends beta.\n';
    const ranges = mapHighlightsToSource(
      [{ id: 'c1', anchor: anchorFor('the target phrase', 'beta lead-in ', ' ends beta.') }],
      source
    );
    expect(ranges).toHaveLength(1);
    const second = source.indexOf('the target phrase', source.indexOf('beta'));
    expect(ranges[0].from).toBe(second);
    expect(source.slice(ranges[0].from, ranges[0].to)).toBe('the target phrase');
  });

  test('U1111: an empty exact skips, and mixed entries keep only the confident ones (colorless stays colorless)', () => {
    const source = 'One clear phrase here. Duplicate bit. Duplicate bit.\n';
    const ranges = mapHighlightsToSource(
      [
        { id: 'empty', anchor: anchorFor('') },
        { id: 'ok', anchor: anchorFor('clear phrase') },
        { id: 'dup', anchor: anchorFor('Duplicate bit') },
      ],
      source
    );
    expect(ranges.map((r) => r.id)).toEqual(['ok']);
    expect(ranges[0].color).toBeUndefined();
  });
});
