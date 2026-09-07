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

  // Rewritten for issue #341: the quote is located in the source's VISIBLE
  // text now, so a rendered quote that crosses a `**` marker paints (the
  // PRD 023 Req 21 "updated to the new UX, not deleted" precedent). The
  // painted span runs from the first through the last visible character:
  // the closing `**` between them paints along, the opening one before
  // them does not.
  test('U1108: a quote crossing a ** marker paints over the visible-text match, first through last visible character', () => {
    const source = 'Some **bold** prose here.\n';
    const ranges = mapHighlightsToSource([note('c1', anchorFor('bold prose'))], source);
    expect(ranges).toHaveLength(1);
    expect(source.slice(ranges[0].from, ranges[0].to)).toBe('bold** prose');
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

  // --- Issue #341: visible-text mapping across inline syntax ---------------

  /** The source text the one mapped range of `entries` covers. */
  const painted = (source: string, exact: string, prefix = '', suffix = ''): string | null => {
    const ranges = mapHighlightsToSource([note('c1', anchorFor(exact, prefix, suffix))], source);
    if (ranges.length === 0) return null;
    expect(ranges).toHaveLength(1);
    return source.slice(ranges[0].from, ranges[0].to);
  };

  test('U1306: issue #341 — strong and emphasis markers inside or at the edges of the quote: between-syntax paints along, outer syntax does not', () => {
    const source = 'Say **strong** then *em* and _under_ words.\n';
    // Markers inside the match paint along; the opening ** before the first
    // visible char and the closing _ after the last are excluded.
    expect(painted(source, 'strong then em and under')).toBe('strong** then *em* and _under');
    // A quote ending on a marked word stops at its last visible character.
    expect(painted(source, 'Say strong')).toBe('Say **strong');
    // A quote starting mid-word inside the marker.
    expect(painted(source, 'em and')).toBe('em* and');
  });

  test('U1307: issue #341 — inline code backticks vanish from the match and paint along only when they sit inside it', () => {
    const source = 'Call `foo()` now, then ``x`y`` later.\n';
    expect(painted(source, 'Call foo() now')).toBe('Call `foo()` now');
    expect(painted(source, 'foo() now')).toBe('foo()` now');
    expect(painted(source, 'then x`y later')).toBe('then ``x`y`` later');
  });

  test('U1308: issue #341 — link text maps to its source text, with the `](url)` tail painted only when the quote continues past it', () => {
    const source = 'Read [the docs](https://example.com/d) today and [more](./m.md).\n';
    expect(painted(source, 'the docs today')).toBe('the docs](https://example.com/d) today');
    expect(painted(source, 'Read the docs')).toBe('Read [the docs');
    expect(painted(source, 'the docs')).toBe('the docs');
  });

  test('U1309: issue #341 — backslash escapes: the escaped character is the visible one, the backslash paints only between visible characters', () => {
    const source = 'Costs 5\\*3 or \\_ten\\_ dollars.\n';
    expect(painted(source, '5*3 or')).toBe('5\\*3 or');
    expect(painted(source, '*3 or _ten_')).toBe('*3 or \\_ten\\_');
  });

  test('U1310: issue #341 — a soft line break inside one paragraph collapses like a space, whichever way the rendered quote spells it', () => {
    const source = '# Title\n\nfirst line of prose\nsecond line of prose\n';
    expect(painted(source, 'prose\nsecond')).toBe('prose\nsecond');
    expect(painted(source, 'prose second')).toBe('prose\nsecond');
    expect(painted(source, 'line of prose  second  line')).toBe('line of prose\nsecond line');
  });

  test('U1311: issue #341 — a quote beginning on a heading, list or blockquote line starts after the block prefix', () => {
    const source = '# Heading words\n\n- item text here\n\n1. ordered item\n\n> quoted text\n';
    expect(painted(source, 'Heading words')).toBe('Heading words');
    expect(painted(source, 'item text here')).toBe('item text here');
    expect(painted(source, 'ordered item')).toBe('ordered item');
    expect(painted(source, 'quoted text')).toBe('quoted text');
    // …and a quote spanning a heading into its paragraph paints across the
    // block boundary from first to last visible character.
    expect(painted(source, 'words item')).toBe('words\n\n- item');
  });

  test('U1312: issue #341 — the skip rule survives in visible space: absent skips, a tie skips, a strictly best context wins, one occurrence across syntax paints', () => {
    // Absent: no visible-text occurrence at all.
    expect(painted('Some **bold** prose here.\n', 'bold prose nowhere')).toBeNull();
    // Ambiguous: the twin lines (E426's fixture) have identical context.
    const line = 'identical sentence with the twin phrase inside it and identical padding after.';
    expect(painted(`${line}\n\n${line}\n`, 'twin phrase', 'sentence with the ', ' inside it and ')).toBeNull();
    // Ambiguous across syntax: a literal and a marked-up occurrence, no
    // context — a 0–0 tie never guesses.
    const mixed = 'first bold prose here.\n\nthen **bold** prose again.\n';
    expect(painted(mixed, 'bold prose')).toBeNull();
    // The stored (rendered) context picks the marked-up one strictly.
    expect(painted(mixed, 'bold prose', 'then ', ' again.')).toBe('bold** prose');
    // The rendered quote spelled with a literal `*` in code does not match
    // emphasis-stripped prose: `2 * 3` renders the asterisk but the source's
    // is a vanished marker, so no occurrence exists and nothing paints.
    expect(painted('a *b* c\n', 'a *b* c')).toBeNull();
  });

  test('U1313: issue #341 — the visible index is built once per mapping pass and shared by every record', () => {
    // Fifty records over one document map in a single pass; the offsets of
    // every mapped range agree with the source (no per-record drift), which
    // is the observable contract of one shared index.
    const source = Array.from({ length: 50 }, (_, i) => `Paragraph **p${i}x** marks *item q${i}x* clearly.`).join('\n\n') + '\n';
    const entries = Array.from({ length: 50 }, (_, i) => note(`n${i}`, anchorFor(`p${i}x marks item q${i}x`)));
    const ranges = mapHighlightsToSource(entries, source);
    expect(ranges).toHaveLength(50);
    for (let i = 0; i < 50; i++) {
      expect(source.slice(ranges[i].from, ranges[i].to)).toBe(`p${i}x** marks *item q${i}x`);
    }
  });
});
