import { describe, expect, test } from 'vitest';
import { createAnchor, reanchor } from '../../src/lib/anchoring';

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
