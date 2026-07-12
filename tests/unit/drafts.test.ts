import { describe, expect, test } from 'vitest';
import { isStaleDraft, parseDraft, serializeDraft, type Draft } from '../../src/lib/drafts';

describe('SPEC30 crash-safe drafts', () => {
  test('U58: round-trip, corruption tolerance, staleness — real docs and untitled buffers', () => {
    const doc: Draft = { version: 1, docPath: '/docs/a.md', content: '# WIP\n\nunsaved words', at: '2026-07-12T12:00:00Z' };
    expect(parseDraft(serializeDraft(doc))).toEqual(doc);

    const untitled: Draft = { version: 1, docPath: null, content: 'scratch', at: '2026-07-12T12:01:00Z' };
    expect(parseDraft(serializeDraft(untitled))).toEqual(untitled);

    // Corruption and shape violations parse to null, never throw.
    expect(parseDraft('not json')).toBeNull();
    expect(parseDraft('{}')).toBeNull();
    expect(parseDraft('{"version":2,"docPath":null,"content":"x","at":"t"}')).toBeNull();
    expect(parseDraft('{"version":1,"docPath":7,"content":"x","at":"t"}')).toBeNull();
    expect(parseDraft('{"version":1,"docPath":"/a.md","content":3,"at":"t"}')).toBeNull();

    // Stale ⇔ disk already matches; a missing file is never stale (still restorable).
    expect(isStaleDraft(doc, '# WIP\n\nunsaved words')).toBe(true);
    expect(isStaleDraft(doc, '# WIP\n')).toBe(false);
    expect(isStaleDraft(doc, null)).toBe(false);

    // Untitled: stale only when empty (there is no disk to compare).
    expect(isStaleDraft(untitled, null)).toBe(false);
    expect(isStaleDraft({ ...untitled, content: '' }, null)).toBe(true);
  });
});
