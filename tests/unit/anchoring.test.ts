import { describe, expect, test } from 'vitest';
import { createAnchor, isComment, mapHighlightsToSource, reanchor, type Anchor, type CommentData } from '../../src/lib/anchoring';

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

/** A trivial anchor for predicate tests (offsets do not matter there). */
function anchorAt(exact: string): Anchor {
  return { exact, prefix: '', suffix: '', start: 0, end: exact.length };
}

/** PRD 023 §1 (issue #283): a highlight record for the mapping tests. */
function hl(id: string, color: 'yellow' | 'green' | 'orange' | 'pink', anchor: Anchor): CommentData {
  return { kind: 'highlight', id, author: 'a', createdAt: '2026-09-04T00:00:00.000Z', color, anchor };
}

/** A comment record: maps too, with no color (the fixed comment tint). */
function note(id: string, anchor: Anchor): CommentData {
  return { kind: 'comment', id, author: 'a', createdAt: '2026-09-04T00:00:00.000Z', body: 'n', resolved: false, thread: [], anchor };
}

describe('PRD 023 §1 standing-card predicate, re-expressed on kind (issue #283)', () => {
  const reply = { id: 'r1', author: 'a', createdAt: '2026-09-04T00:00:00.000Z', body: 'a reply' };
  const base = { id: 'x', author: 'a', createdAt: '2026-09-04T00:00:00.000Z', anchor: anchorAt('x') };

  test('U1103: a highlight record is never a comment — no standing card, whatever else it carries', () => {
    expect(isComment({ ...base, kind: 'highlight', color: 'orange' })).toBe(false);
    expect(isComment({ ...base, kind: 'highlight', color: 'pink' })).toBe(false);
  });

  test('U1104: a comment record is a comment — the discriminant decides, not the body', () => {
    expect(isComment({ ...base, kind: 'comment', body: 'a note', resolved: false, thread: [] })).toBe(true);
  });

  test('U1105: an empty-bodied comment record still stands — kind decides where 1.1.0 sniffed body/thread', () => {
    expect(isComment({ ...base, kind: 'comment', body: '', resolved: false, thread: [reply] })).toBe(true);
    expect(isComment({ ...base, kind: 'comment', body: '', resolved: false, thread: [] })).toBe(true);
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
      [hl('c1', 'green', anchorFor('lone needle phrase'))],
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
    const ranges = mapHighlightsToSource([note('c1', anchorFor('bold prose'))], source);
    expect(ranges).toEqual([]);
  });

  test('U1109: an ambiguous quote with no deciding context skips — never a guess', () => {
    const line = 'identical sentence with the twin phrase inside it and identical padding after.';
    const source = `${line}\n\n${line}\n`;
    const ranges = mapHighlightsToSource(
      [note('c1', anchorFor('twin phrase', 'sentence with the ', ' inside it and '))],
      source
    );
    expect(ranges).toEqual([]);
  });

  test('U1110: stored context disambiguates multiple occurrences when it yields one confident winner', () => {
    const source = 'alpha lead-in the target phrase ends alpha.\n\nbeta lead-in the target phrase ends beta.\n';
    const ranges = mapHighlightsToSource(
      [note('c1', anchorFor('the target phrase', 'beta lead-in ', ' ends beta.'))],
      source
    );
    expect(ranges).toHaveLength(1);
    const second = source.indexOf('the target phrase', source.indexOf('beta'));
    expect(ranges[0].from).toBe(second);
    expect(source.slice(ranges[0].from, ranges[0].to)).toBe('the target phrase');
  });

  test('U1111: an empty exact skips, and mixed entries keep only the confident ones (a comment record maps colorless)', () => {
    const source = 'One clear phrase here. Duplicate bit. Duplicate bit.\n';
    const ranges = mapHighlightsToSource(
      [
        note('empty', anchorFor('')),
        note('ok', anchorFor('clear phrase')),
        note('dup', anchorFor('Duplicate bit')),
      ],
      source
    );
    expect(ranges.map((r) => r.id)).toEqual(['ok']);
    expect(ranges[0].color).toBeUndefined();
  });
});
