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

  test('U824: issue #42 — a disk copy differing only in line endings makes the draft stale', () => {
    const doc: Draft = { version: 1, docPath: '/docs/a.md', content: 'one\ntwo\nthree\n', at: '2026-08-04T12:00:00Z' };
    expect(isStaleDraft(doc, 'one\r\ntwo\r\nthree\r\n')).toBe(true);
    // A real content difference still offers the restore.
    expect(isStaleDraft(doc, 'one\r\ntwo!\r\nthree\r\n')).toBe(false);
  });

  test('U1235: issue #319 — a draft equal to the body of a file carrying an embedded-comment trailer is stale', () => {
    // SPEC30 §3.3: the buffer (and so the draft) holds the body after
    // splitEmbedded; the disk holds body + trailer. Staleness is judged
    // against the body, or a leftover draft for any commented document would
    // be re-offered on every launch until the user clicked Discard.
    const body = '# Reviewed\n\nA paragraph someone commented on.\n';
    const trailer =
      '\n<!-- marky-mark-comments\n{"version":"1.0.0","comments":[{"id":"c1","author":"Ada","createdAt":"2026-09-01T00:00:00.000Z","body":"nit","resolved":false,"thread":[],"anchor":{"kind":"text","start":0,"end":1,"text":"#"}}]}\n-->\n';
    const doc: Draft = { version: 1, docPath: '/docs/reviewed.md', content: body, at: '2026-09-06T12:00:00Z' };
    expect(isStaleDraft(doc, body + trailer)).toBe(true);
    // The legacy marker strips too, and line endings still do not count (issue #42).
    expect(isStaleDraft(doc, body.replace(/\n/g, '\r\n') + trailer.replace('marky-mark', 'markimark'))).toBe(true);
    // A real content difference under the same trailer is still offered.
    expect(isStaleDraft({ ...doc, content: body + 'unsaved words\n' }, body + trailer)).toBe(false);
    // The trailer itself is never mistaken for restorable content.
    expect(isStaleDraft({ ...doc, content: body + trailer }, body + trailer)).toBe(true);
  });
});
