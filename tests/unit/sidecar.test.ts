import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseSidecar, serializeSidecar, sidecarPathFor } from '../../src/lib/sidecar';
import type { CommentData } from '../../src/lib/anchoring';

const interopPath = fileURLToPath(new URL('../../fixtures/interop-sidecar.comments.json', import.meta.url));

describe('sidecar round-trip and md-with-comments interop', () => {
  test('U8: serialize → parse yields identical comments, and a real md-with-comments sidecar parses without loss', () => {
    const comments: CommentData[] = [
      {
        id: '4c5a2b6e-1111-4222-8333-abcdefabcdef',
        author: 'Jorge',
        createdAt: '2026-07-07T10:00:00.000Z',
        body: 'A root comment',
        resolved: false,
        thread: [
          { id: 'aaaa1111-2222-4333-8444-555566667777', author: 'Jorge', createdAt: '2026-07-07T10:05:00.000Z', body: 'a reply' },
        ],
        anchor: { exact: 'the selected text', prefix: 'chars before ', suffix: ' chars after', start: 1042, end: 1059 },
      },
      {
        id: '9d8c7b6a-5555-4444-8333-222211110000',
        author: 'Reviewer',
        createdAt: '2026-07-07T11:00:00.000Z',
        body: 'Resolved one',
        resolved: true,
        thread: [],
        anchor: { exact: 'other text', prefix: '', suffix: '', start: 12, end: 22 },
      },
    ];

    // Round-trip must be lossless.
    const roundTripped = parseSidecar(serializeSidecar(comments));
    expect(roundTripped).toEqual(comments);

    // Path convention matches md-with-comments: foo.md → foo.md.comments.json
    expect(sidecarPathFor('/docs/foo.md')).toBe('/docs/foo.md.comments.json');

    // A real sidecar written by the md-with-comments app parses without loss:
    // every comment survives with schema fields intact, and re-serializing
    // preserves the parsed content exactly.
    const raw = readFileSync(interopPath, 'utf8');
    const rawComments = (JSON.parse(raw) as { comments: unknown[] }).comments;
    const parsed = parseSidecar(raw);
    expect(parsed.length).toBe(rawComments.length);
    expect(parsed.length).toBeGreaterThan(0);
    for (const c of parsed) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.body).toBe('string');
      expect(typeof c.anchor.exact).toBe('string');
      expect(c.anchor.end).toBeGreaterThanOrEqual(c.anchor.start);
    }
    expect(parseSidecar(serializeSidecar(parsed))).toEqual(parsed);
    // Field-level spot check against the raw JSON (no silent renames).
    const first = rawComments[0] as Record<string, unknown>;
    expect(parsed[0].id).toBe(first.id);
    expect(parsed[0].body).toBe(first.body);
    expect(parsed[0].anchor.exact).toBe((first.anchor as Record<string, unknown>).exact);
  });
});
