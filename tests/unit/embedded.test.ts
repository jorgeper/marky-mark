import { describe, expect, test } from 'vitest';
import { attachEmbedded, mergeComments, serializeTrailer, splitEmbedded } from '../../src/lib/embedded';
import type { CommentData } from '../../src/lib/anchoring';

function makeComment(id: string, body: string): CommentData {
  return {
    id,
    author: 'Jorge',
    createdAt: '2026-07-07T12:00:00.000Z',
    body,
    resolved: false,
    thread: [{ id: `${id}-r1`, author: 'Reviewer', createdAt: '2026-07-07T12:05:00.000Z', body: `re: ${body}` }],
    anchor: { exact: 'some anchored text', prefix: 'before ', suffix: ' after', start: 100, end: 118 },
  };
}

describe('embedded comment trailer', () => {
  test('U9: trailer round-trip is lossless, including a body containing "-->"', () => {
    const comments = [makeComment('c1', 'plain body'), makeComment('c2', 'tricky --> body --> twice')];
    const trailer = serializeTrailer(comments);

    // The raw trailer must be a single well-formed HTML comment: no premature
    // terminator before the final one.
    expect(trailer.startsWith('\n<!-- markimark-comments\n')).toBe(true);
    expect(trailer.trimEnd().endsWith('-->')).toBe(true);
    const inner = trailer.slice(0, trailer.lastIndexOf('-->'));
    expect(inner.includes('-->')).toBe(false); // "-->" never appears before the close

    const doc = `# Title\n\nSome content.\n${trailer}`;
    const split = splitEmbedded(doc);
    expect(split.hadTrailer).toBe(true);
    expect(split.comments).toEqual(comments); // escape restored by JSON.parse
    expect(split.comments[1].body).toBe('tricky --> body --> twice');

    // Zero comments → no trailer at all.
    expect(serializeTrailer([])).toBe('');
  });

  test('U10: strip/attach preserve markdown content byte-exactly and are idempotent', () => {
    const content = '# Doc\n\nBody text with trailing spaces  \nand a final newline.\n';
    const comments = [makeComment('c1', 'note')];

    const withTrailer = attachEmbedded(content, comments);
    const split = splitEmbedded(withTrailer);
    expect(split.content).toBe(content); // byte-exact
    expect(split.comments).toEqual(comments);

    // attach on already-attached text never doubles the trailer.
    const twice = attachEmbedded(withTrailer, comments);
    expect(twice).toBe(withTrailer);
    expect(twice.match(/markimark-comments/g)?.length).toBe(1);

    // No-trailer documents pass through untouched.
    const plain = splitEmbedded(content);
    expect(plain.hadTrailer).toBe(false);
    expect(plain.content).toBe(content);
    expect(plain.comments).toEqual([]);

    // Removing all comments removes the trailer entirely.
    expect(attachEmbedded(withTrailer, [])).toBe(content);
  });

  test('U11: sidecar+trailer merge by id with trailer precedence; migration produces clean end states', () => {
    const trailerVersion = { ...makeComment('shared', 'trailer wins'), resolved: true };
    const trailerOnly = makeComment('t-only', 'from trailer');
    const sidecarVersion = makeComment('shared', 'sidecar loses');
    const sidecarOnly = makeComment('s-only', 'from sidecar');

    const merged = mergeComments([trailerVersion, trailerOnly], [sidecarVersion, sidecarOnly]);
    expect(merged).toHaveLength(3);
    expect(merged.find((c) => c.id === 'shared')?.body).toBe('trailer wins');
    expect(merged.find((c) => c.id === 'shared')?.resolved).toBe(true);
    expect(merged.map((c) => c.id)).toEqual(['shared', 't-only', 's-only']);

    // Migration sidecar → embedded: attach trailer to plain content.
    const content = '# Doc\n\ntext\n';
    const embedded = attachEmbedded(content, merged);
    expect(splitEmbedded(embedded).comments).toEqual(merged);

    // Migration embedded → sidecar: strip trailer, file is plain again.
    expect(splitEmbedded(embedded).content).toBe(content);
    expect(attachEmbedded(embedded, [])).toBe(content);
  });
});
