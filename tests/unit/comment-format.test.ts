import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  ANCHOR_KEYS,
  BASELINE_COMMENT_FORMAT_VERSION,
  COMMENT_COLORS,
  COMMENT_RECORD_KEYS,
  HIGHLIGHT_RECORD_KEYS,
  REPLY_KEYS,
  SUPPORTED_COMMENT_FORMAT_VERSION,
  compareFormatVersions,
  isFormatVersion,
  parseFormatVersion,
  readCommentPayload,
  stampedFormatVersion,
  type CommentFormatRead,
} from '../../src/lib/commentFormat';
import { attachEmbedded, mergeComments, serializeTrailer, splitEmbedded } from '../../src/lib/embedded';
import { parseSidecar, readSidecar, serializeSidecar, sidecarPathFor } from '../../src/lib/sidecar';
import { CONTEXT_LENGTH, type CommentRecord, type HighlightRecord } from '../../src/lib/anchoring';
import { alpha4ParseSidecar, alpha4SplitEmbedded } from '../frozen/alpha4-reader';

const seamSource = readFileSync(
  fileURLToPath(new URL('../../src/lib/commentFormat.ts', import.meta.url)),
  'utf8',
);

/** The source of one of the two stores, for the wiring assertions of U132/U138. */
function storeSource(name: 'sidecar' | 'embedded'): string {
  return readFileSync(fileURLToPath(new URL(`../../src/lib/${name}.ts`, import.meta.url)), 'utf8');
}

/** The JSON text inside a written trailer block. */
function splitTrailerJson(text: string): string {
  const m = /<!-- marky-mark-comments\n([\s\S]*?)\n-->/.exec(text);
  if (!m) throw new Error('expected a trailer block');
  return m[1];
}

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { version: string };

const comment: CommentRecord = {
  kind: 'comment',
  id: 'c1a2b3c4-1111-4222-8333-abcdefabcdef',
  author: 'Jorge',
  createdAt: '2026-08-02T10:00:00.000Z',
  body: 'A root comment',
  resolved: false,
  thread: [
    { id: 'r1a2b3c4-2222-4333-8444-555566667777', author: 'Reviewer', createdAt: '2026-08-02T10:05:00.000Z', body: 'a reply' },
  ],
  anchor: { exact: 'the selected text', prefix: 'before ', suffix: ' after', start: 10, end: 27 },
};

/** PRD 023 §1 (issue #283): a highlight record — color required, nothing noted. */
const highlight: HighlightRecord = {
  kind: 'highlight',
  id: 'h1a2b3c4-3333-4444-8555-abcdefabcdef',
  author: 'Jorge',
  createdAt: '2026-08-02T10:10:00.000Z',
  color: 'orange',
  anchor: { exact: 'painted text', prefix: 'some ', suffix: ' nearby', start: 40, end: 52 },
};

/** A raw parsed payload as JSON.parse would produce it, at a declared version. */
function payloadAt(version: unknown): unknown {
  return JSON.parse(JSON.stringify({ version, comments: [comment, highlight] })) as unknown;
}

// vitest's expect() does not narrow, so each branch assertion doubles as a
// type guard; `label` names the case inside a loop when one iteration fails.
function expectSupported(read: CommentFormatRead, label?: string) {
  expect(read.supported, label).toBe(true);
  if (!read.supported) throw new Error(`expected a supported read: ${label ?? ''}`);
  return read;
}

function expectUnsupported(read: CommentFormatRead, label?: string) {
  expect(read.supported, label).toBe(false);
  if (read.supported) throw new Error(`expected an unsupported read: ${label ?? ''}`);
  return read;
}

describe('comment format: version literal and migration seam (PRD 004 §A/C/F)', () => {
  test('U124: the supported comment-format version is declared once as "2.0.0", independent of the app version', () => {
    expect(SUPPORTED_COMMENT_FORMAT_VERSION).toBe('2.0.0');
    expect(typeof SUPPORTED_COMMENT_FORMAT_VERSION).toBe('string');
    // PRD non-goal: the format version is not coupled to the app version.
    expect(SUPPORTED_COMMENT_FORMAT_VERSION).not.toBe(pkg.version);
    // Not derived from and not compared against the app version: the module
    // never pulls it in (the only mention of package.json is a doc comment).
    expect(seamSource).not.toMatch(/import[^\n]*package\.json|APP_VERSION/);
    // Declared exactly once: a single assignment, and no second constant.
    expect(seamSource.match(/SUPPORTED_COMMENT_FORMAT_VERSION\s*=/g)?.length).toBe(1);
  });

  test('U125: a valid version is MAJOR.MINOR.PATCH with digit components; nothing else qualifies', () => {
    for (const good of ['1.0.0', '0.0.0', '1.7.2', '9.1.4', '10.20.30', '1.0.9']) {
      expect(isFormatVersion(good)).toBe(true);
    }
    for (const bad of ['1.0', 'v1.0.0', '1.0.0-beta', '1.0.0.0', '1', '', '1.0.x', ' 1.0.0', '1.0.0 ', 1, 1.5, null, undefined, true, [], {}]) {
      expect(isFormatVersion(bad)).toBe(false);
      expect(parseFormatVersion(bad)).toBeNull();
    }
    expect(parseFormatVersion('1.7.2')).toEqual({ major: 1, minor: 7, patch: 2 });
  });

  test('U126: the two registered legacy coercions — integer 1 and an absent version key — resolve to 1.0.0 and read as legacy-empty', () => {
    // PRD Req 3: existing embedded trailers. Issue #283: a resolved 1.0.0 is
    // now a LESSER major — supported (no freeze, no notice) but empty.
    const trailer = expectSupported(readCommentPayload(payloadAt(1)));
    expect(trailer.version).toBe('1.0.0');
    expect(trailer.comments).toEqual([]);

    // PRD Req 4: existing sidecars, which have no version key at all — same
    // legacy verdict, whatever entries they carry.
    const sidecar = expectSupported(readCommentPayload({ comments: [comment] }));
    expect(sidecar.version).toBe('1.0.0');
    expect(sidecar.comments).toEqual([]);
  });

  test('U127: a valid version string is taken at face value — same MAJOR with a greater MINOR is supported, PATCH never decides', () => {
    for (const version of ['2.0.0', '2.0.9', '2.0.99', '2.1.0', '2.7.2']) {
      const read = expectSupported(readCommentPayload(payloadAt(version)), version);
      // Interpreted as itself, not rewritten to the build's own version.
      expect(read.version).toBe(version);
      expect(read.comments).toEqual([comment, highlight]);
    }
  });

  test('U128: a present but uninterpretable version is unsupported, not coerced, and is reported as it appeared', () => {
    // PRD Req 5: neither the integer 1 nor a valid semver string.
    const malformed: unknown[] = ['1', '1.0', 2, 1.5, true, false, null, [], {}, 'newest', '', 'v1.0.0', '1.0.0-beta'];
    for (const version of malformed) {
      const read = expectUnsupported(readCommentPayload(payloadAt(version)), JSON.stringify(version));
      expect(read.declaredVersion).toEqual(version);
    }
    // null is *present*: it is unsupported, unlike an absent key (U126's
    // legacy coercion, which reads — as empty — rather than freezing).
    const explicitNull = readCommentPayload({ version: null, comments: [] });
    expect(explicitNull.supported).toBe(false);
    const absent = readCommentPayload({ comments: [] });
    expect(absent.supported).toBe(true);
  });

  test('U129: MAJOR decides first — a greater MAJOR is unreadable; a lesser MAJOR is the deliberate legacy break, readable as empty', () => {
    for (const version of ['3.0.0', '9.1.4', '3.0.99']) {
      const read = expectUnsupported(readCommentPayload(payloadAt(version)), version);
      expect(read.declaredVersion).toBe(version);
    }
    // Issue #283: a lesser MAJOR — 1.x that really shipped, or below-baseline
    // versions that never did — is legacy: supported, zero comments, so the
    // app neither freezes nor warns, and the next save writes over it.
    for (const version of ['1.0.0', '1.1.0', '1.99.0', '0.9.0', '0.0.1']) {
      const read = expectSupported(readCommentPayload(payloadAt(version)), version);
      expect(read.comments, version).toEqual([]);
    }
  });

  test('U130: a payload that is not an object is handled without throwing', () => {
    for (const payload of [null, 'a string', 42, ['an', 'array'], true, undefined]) {
      const read = expectSupported(readCommentPayload(payload), JSON.stringify(payload ?? null));
      // No version key to read, so the legacy 1.0.0 with zero comments.
      expect(read.version).toBe('1.0.0');
      expect(read.comments).toEqual([]);
    }
    // Malformed entries are skipped rather than crashing the read, as today.
    const partial = expectSupported(
      readCommentPayload({ version: '2.0.0', comments: [comment, { kind: 'comment', id: 'no-anchor' }, 7, null] }),
    );
    expect(partial.comments).toEqual([comment]);
    // Even a value JSON.parse could never have produced yields a result.
    expectSupported(readCommentPayload({ version: '2.0.0', comments: [{ ...comment, body: 1n }] }));
  });

  test('U131: the discriminant makes comments unreadable off the unsupported branch, and `version` is the only versioning key', () => {
    const unsupported = readCommentPayload(payloadAt('3.0.0'));
    // @ts-expect-error — the unsupported branch carries no comments (PRD Req 29).
    expect(unsupported.comments).toBeUndefined();
    const supported = readCommentPayload(payloadAt('2.0.0'));
    // @ts-expect-error — the supported branch carries no declared version.
    expect(supported.declaredVersion).toBeUndefined();

    // PRD Req 6: `version` is the only versioning key the module reads or
    // names — no formatVersion alias, no parallel major/minor payload fields.
    expect(seamSource).not.toMatch(/formatVersion|schemaVersion/);
    expect(seamSource).not.toMatch(/(record|payload)\??\.(major|minor)\b|'(major|minor)' in /);
    expect(seamSource).toContain("'version' in payload");
  });

  test('U132: the seam is pure, both stores are wired through it, and both write the same version key', () => {
    // PRD Req 31: no DOM, no React, no platform imports.
    expect(seamSource).not.toMatch(/@tauri-apps|from 'react'|\bdocument\.|\bwindow\./);
    // The seam owns the entry schema now, so it imports nothing but the types
    // (issue #15) — in particular it no longer re-serializes to reuse
    // parseSidecar, and no store can import it back into a cycle.
    expect(seamSource.match(/^import .*/gm)).toEqual([
      "import type { Anchor, CommentColor, CommentData, RetainedKeys, ThreadReply } from './anchoring.ts';",
    ]);
    expect(seamSource).not.toMatch(/JSON\.stringify/);

    // Both stores — and only the stores — read and write through the seam.
    const srcFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) srcFiles.push(full);
      }
    };
    walk(fileURLToPath(new URL('../../src', import.meta.url)));
    const importers = srcFiles
      .filter((f) => !f.endsWith('/commentFormat.ts') && /from '[^']*commentFormat(\.ts)?'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(f.lastIndexOf('/src/')))
      .sort();
    expect(importers).toEqual(['/src/lib/embedded.ts', '/src/lib/sidecar.ts']);
    for (const store of [storeSource('embedded'), storeSource('sidecar')]) {
      expect(store).toMatch(/readCommentPayload/);
      expect(store).toMatch(/commentPayload/);
    }

    // PRD Req 26: the same version key in both containers, a semver string in
    // both.
    const trailer = serializeTrailer([comment]);
    expect(trailer).toContain('"version": "2.0.0"');
    const sidecar = serializeSidecar([comment]);
    const parsedSidecar = JSON.parse(sidecar) as { version: string; comments: unknown };
    expect(parsedSidecar.version).toBe('2.0.0');
    // …and still 2-space pretty-printed with a trailing newline, byte for byte.
    expect(sidecar).toBe(`${JSON.stringify({ version: '2.0.0', comments: parsedSidecar.comments }, null, 2)}\n`);
  });
});

/** A comment record with an unknown key at every level, as a newer minor might write. */
function payloadWithExtras(version: unknown): Record<string, unknown> {
  return {
    version,
    comments: [
      {
        kind: 'comment',
        id: comment.id,
        author: comment.author,
        createdAt: comment.createdAt,
        body: comment.body,
        resolved: comment.resolved,
        thread: [{ ...comment.thread[0], reactions: ['👍', '🎉'] }],
        anchor: { ...comment.anchor, selector: { type: 'range', nested: { deep: true } } },
        pinned: true,
        labels: ['blocker', 'ux'],
      },
    ],
  };
}

/** The trailer bytes a store would find in a file, for a raw payload. */
function trailerOf(payload: unknown, marker = 'marky-mark-comments'): string {
  return `\n<!-- ${marker}\n${JSON.stringify(payload, null, 2)}\n-->\n`;
}

const DOC = '# Doc\n\nBody text.\n';

describe('comment stores through the seam (PRD 004 §B/D/E — issue #15)', () => {
  test('U133: a newer MAJOR contributes zero comments in both stores and is reported unreadable', () => {
    const payload = { version: '3.0.0', comments: [comment] };

    const split = splitEmbedded(`${DOC}${trailerOf(payload)}`);
    expect(split.comments).toEqual([]); // Req 12: not a best-effort subset
    expect(split.hadTrailer).toBe(true);
    expect(split.readable).toBe(false);
    expect(split.declaredVersion).toBe('3.0.0');
    expect(split.content).toBe(DOC); // still stripped byte-exactly

    const read = readSidecar(JSON.stringify(payload));
    expect(read.comments).toEqual([]);
    expect(read.readable).toBe(false);
    expect(read.declaredVersion).toBe('3.0.0');
    expect(parseSidecar(JSON.stringify(payload))).toEqual([]);

    // Req 5 routes a present-but-uninterpretable version to the same branch.
    const junk = { version: 'newest', comments: [comment] };
    expect(splitEmbedded(`${DOC}${trailerOf(junk)}`).comments).toEqual([]);
    expect(splitEmbedded(`${DOC}${trailerOf(junk)}`).declaredVersion).toBe('newest');
    expect(readSidecar(JSON.stringify(junk)).readable).toBe(false);
  });

  test('U134: a newer MINOR at a supported MAJOR parses normally in both stores', () => {
    for (const version of ['2.3.0', '2.7.2']) {
      const payload = { version, comments: [comment, highlight] };
      const split = splitEmbedded(`${DOC}${trailerOf(payload)}`);
      expect(split.comments, version).toEqual([comment, highlight]);
      expect(split.readable, version).toBe(true);
      const read = readSidecar(JSON.stringify(payload));
      expect(read.comments, version).toEqual([comment, highlight]);
      expect(read.readable, version).toBe(true);
    }
  });

  test('U135: unknown keys on a record, a reply and an anchor are retained and re-emitted verbatim by both stores', () => {
    const raw = payloadWithExtras('2.0.0');
    const entry = (raw.comments as Record<string, unknown>[])[0];

    for (const [store, roundTrip] of [
      ['sidecar', (text: string) => JSON.parse(serializeSidecar(parseSidecar(text))) as Record<string, unknown>],
      [
        'trailer',
        (text: string) => {
          const doc = `${DOC}${trailerOf(JSON.parse(text))}`;
          const split = splitEmbedded(doc);
          const attached = attachEmbedded(split.content, split.comments);
          return JSON.parse(splitTrailerJson(attached)) as Record<string, unknown>;
        },
      ],
    ] as const) {
      const out = roundTrip(JSON.stringify(raw));
      const outEntry = (out.comments as Record<string, unknown>[])[0];
      // Req 19: same key, same value, at the same level — including nested
      // objects and arrays.
      expect(outEntry.pinned, store).toBe(true);
      expect(outEntry.labels, store).toEqual(['blocker', 'ux']);
      expect((outEntry.thread as Record<string, unknown>[])[0].reactions, store).toEqual(['👍', '🎉']);
      expect((outEntry.anchor as Record<string, unknown>).selector, store).toEqual({
        type: 'range',
        nested: { deep: true },
      });
      // The known keys are unharmed by the splice.
      expect(outEntry.id, store).toBe(entry.id);
      expect(outEntry.kind, store).toBe('comment');
      expect((outEntry.anchor as Record<string, unknown>).exact, store).toBe(comment.anchor.exact);
      // The bag itself is in-memory only: no `extra`/`extraVersion` key is
      // ever written, at any level.
      expect(JSON.stringify(out), store).not.toMatch(/"extra"|"extraVersion"/);
    }
  });

  test('U136: known keys are parsed by the build’s rules and never also bagged; the bag is absent when empty', () => {
    // PRD 023 §1 (issue #283): the exact per-kind known-key sets, asserted
    // rather than assumed — kind first, then identity, then the kind's own
    // fields, then anchor.
    expect(COMMENT_RECORD_KEYS).toEqual(['kind', 'id', 'author', 'createdAt', 'body', 'resolved', 'thread', 'anchor']);
    expect(HIGHLIGHT_RECORD_KEYS).toEqual(['kind', 'id', 'author', 'createdAt', 'color', 'anchor']);
    expect(REPLY_KEYS).toEqual(['id', 'author', 'createdAt', 'body']);
    expect(ANCHOR_KEYS).toEqual(['exact', 'prefix', 'suffix', 'start', 'end']);

    const parsed = parseSidecar(JSON.stringify(payloadWithExtras('2.0.0')));
    // Req 20: only the unknown keys are in the bag, at each level.
    expect(Object.keys(parsed[0].extra ?? {})).toEqual(['pinned', 'labels']);
    if (parsed[0].kind !== 'comment') throw new Error('expected the comment record');
    expect(Object.keys(parsed[0].thread[0].extra ?? {})).toEqual(['reactions']);
    expect(Object.keys(parsed[0].anchor.extra ?? {})).toEqual(['selector']);
    for (const known of COMMENT_RECORD_KEYS) expect(parsed[0].extra).not.toHaveProperty(known);
    for (const known of REPLY_KEYS) expect(parsed[0].thread[0].extra).not.toHaveProperty(known);
    for (const known of ANCHOR_KEYS) expect(parsed[0].anchor.extra).not.toHaveProperty(known);

    // A wrong-typed known key stays the build's business: `resolved: "yes"` is
    // still coerced by the existing `=== true` rule, not retained as unknown.
    const wrongType = parseSidecar(
      JSON.stringify({ version: '2.0.0', comments: [{ ...comment, resolved: 'yes' }] }),
    );
    expect(wrongType[0].kind === 'comment' && wrongType[0].resolved).toBe(false);
    expect(wrongType[0].extra).toBeUndefined();
    expect(JSON.parse(serializeSidecar(wrongType))).toEqual({
      version: '2.0.0',
      comments: [{ ...comment, resolved: false }],
    });

    // Absent, not empty: a payload with no extra keys parses to exactly the
    // plain records.
    const plain = parseSidecar(serializeSidecar([comment, highlight]));
    expect(plain).toEqual([comment, highlight]);
    expect(plain[0]).not.toHaveProperty('extra');
    expect(plain[0].anchor).not.toHaveProperty('extra');
    expect(plain[1]).not.toHaveProperty('extra');
    expect(plain[0]).not.toHaveProperty('extraVersion');
  });

  test('U137: a malformed entry is still skipped — with its unknown keys — and valid neighbours survive', () => {
    const text = JSON.stringify({
      version: '2.0.0',
      comments: [
        { kind: 'comment', id: 'no-anchor', author: 'A', createdAt: 'now', body: 'b', mystery: 1 },
        comment,
        7,
        null,
        { ...comment, id: 'bad-anchor', anchor: { exact: 'x' }, mystery: 2 },
        { ...comment, id: 'bad-thread', thread: [{ id: 'r' }, comment.thread[0]] },
        highlight,
      ],
    });
    const parsed = parseSidecar(text);
    expect(parsed.map((c) => c.id)).toEqual([comment.id, 'bad-thread', highlight.id]);
    // Req 22 wins over Req 19: a skipped entry takes its unknown keys with it.
    expect(JSON.stringify(parsed)).not.toContain('mystery');
    // A malformed reply is dropped, the valid one is kept.
    expect(parsed[1].kind === 'comment' ? parsed[1].thread : []).toEqual([comment.thread[0]]);
    // The trailer store behaves identically.
    expect(splitEmbedded(`${DOC}${trailerOf(JSON.parse(text))}`).comments.map((c) => c.id)).toEqual([
      comment.id,
      'bad-thread',
      highlight.id,
    ]);
  });

  test('U138: plain data stamps "2.0.0" in both stores, computed from its own baseline rather than the supported version', () => {
    expect(BASELINE_COMMENT_FORMAT_VERSION).toBe('2.0.0');
    expect(stampedFormatVersion([comment, highlight])).toBe('2.0.0');
    expect(stampedFormatVersion([])).toBe('2.0.0');
    expect(JSON.parse(serializeSidecar([comment])).version).toBe('2.0.0');
    expect(JSON.parse(splitTrailerJson(attachEmbedded(DOC, [highlight]))).version).toBe('2.0.0');

    // Req 23: the stamp is computed, not read from the supported version, so
    // bumping the build to 2.4.0 would not start stamping 2.4.0. The baseline
    // is its own literal, and neither the stamping function nor either store
    // mentions SUPPORTED_COMMENT_FORMAT_VERSION.
    expect(seamSource).toMatch(/BASELINE_COMMENT_FORMAT_VERSION = '\d+\.\d+\.\d+'/);
    const writePath = seamSource.slice(seamSource.indexOf('export function stampedFormatVersion'));
    expect(writePath).not.toContain('SUPPORTED_COMMENT_FORMAT_VERSION');
    expect(storeSource('sidecar')).not.toContain('SUPPORTED_COMMENT_FORMAT_VERSION');
    expect(storeSource('embedded')).not.toContain('SUPPORTED_COMMENT_FORMAT_VERSION');
  });

  test('U139: a higher MINOR with retained fields survives a store round-trip; without them the stamp falls back to "2.0.0"', () => {
    // Req 21/24: "2.3.0" in, "2.3.0" out — the version rides with the parsed
    // records, so neither call site threads it by hand.
    const withExtras = JSON.stringify(payloadWithExtras('2.3.0'));
    expect(JSON.parse(serializeSidecar(parseSidecar(withExtras))).version).toBe('2.3.0');
    const doc = `${DOC}${trailerOf(JSON.parse(withExtras))}`;
    const split = splitEmbedded(doc);
    expect(JSON.parse(splitTrailerJson(attachEmbedded(split.content, split.comments))).version).toBe('2.3.0');

    // The complement: read at "2.3.0" but carrying no unknown field at all →
    // 2.0.0 can represent it, so 2.0.0 is stamped (Req 24 defers to fields).
    const plain = JSON.stringify({ version: '2.3.0', comments: [comment] });
    expect(JSON.parse(serializeSidecar(parseSidecar(plain))).version).toBe('2.0.0');
    expect(
      JSON.parse(splitTrailerJson(attachEmbedded(DOC, splitEmbedded(`${DOC}${trailerOf(JSON.parse(plain))}`).comments)))
        .version,
    ).toBe('2.0.0');
  });

  test('U140: versions compare by MAJOR then MINOR then PATCH, and a mixed write stamps the highest retained version', () => {
    expect(compareFormatVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareFormatVersions('1.3.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareFormatVersions('1.0.0', '1.3.0')).toBeLessThan(0);
    expect(compareFormatVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareFormatVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
    // An uninterpretable version sorts below every valid one, so it can never
    // be stamped by winning the comparison.
    expect(compareFormatVersions('nonsense', '1.0.0')).toBeLessThan(0);
    expect(compareFormatVersions('1.0.0', undefined)).toBeGreaterThan(0);
    expect(compareFormatVersions('nope', 'also nope')).toBe(0);

    // Two reads at different versions, both carrying retained fields, land in
    // one write via mergeComments: the highest version any of them needs wins.
    const low = parseSidecar(JSON.stringify(payloadWithExtras('2.2.0')));
    const highSource = payloadWithExtras('2.5.1');
    (highSource.comments as Record<string, unknown>[])[0].id = 'other-comment';
    const high = parseSidecar(JSON.stringify(highSource));
    const merged = mergeComments(low, high);
    expect(merged).toHaveLength(2);
    expect(stampedFormatVersion(merged)).toBe('2.5.1');
    expect(JSON.parse(serializeSidecar(merged)).version).toBe('2.5.1');
    expect(JSON.parse(splitTrailerJson(attachEmbedded(DOC, merged))).version).toBe('2.5.1');
  });

  test('U141: writing is idempotent and byte-stable, including with retained keys, and zero comments write no trailer', () => {
    for (const source of [[comment, highlight], parseSidecar(JSON.stringify(payloadWithExtras('2.3.0')))]) {
      // Req 27: the same record set serializes to identical bytes twice, and
      // a re-read of those bytes serializes to them again (key order is fixed).
      expect(serializeSidecar(source)).toBe(serializeSidecar(source));
      expect(serializeSidecar(parseSidecar(serializeSidecar(source)))).toBe(serializeSidecar(source));
      expect(serializeTrailer(source)).toBe(serializeTrailer(source));
      const attached = attachEmbedded(DOC, source);
      expect(attachEmbedded(attached, source)).toBe(attached); // never double-attached
      expect(attached.match(/marky-mark-comments/g)?.length).toBe(1);
      expect(splitEmbedded(attached).content).toBe(DOC);
      expect(serializeTrailer(splitEmbedded(attached).comments)).toBe(serializeTrailer(source));
    }
    // Req 28: no trailer at all for zero comments — not a versioned empty one.
    expect(serializeTrailer([])).toBe('');
    expect(attachEmbedded(attachEmbedded(DOC, [comment]), [])).toBe(DOC);
  });

  test('U142: pre-2.0.0 files in the wild open as legacy-empty — readable, no freeze, and the next save writes 2.0.0 over them', () => {
    // Issue #283: the 1.x shapes this app shipped (integer-1 trailers, the
    // pre-0.4 marker, versionless sidecars, 1.x version strings) all read as
    // zero comments with readable: true — no unreadable verdict for the app
    // to freeze or warn on.
    const legacyPayload = {
      version: 1,
      comments: [{ ...comment, kind: undefined }],
    };
    const legacySplit = splitEmbedded(`${DOC}${trailerOf(legacyPayload)}`);
    expect(legacySplit.comments).toEqual([]);
    expect(legacySplit.readable).toBe(true);
    expect(legacySplit.hadTrailer).toBe(true);
    expect(legacySplit.declaredVersion).toBeUndefined();
    // …and the marker it used before 0.4, same verdict.
    const legacyMarker = splitEmbedded(`${DOC}${trailerOf(legacyPayload, 'markimark-comments')}`);
    expect(legacyMarker.comments).toEqual([]);
    expect(legacyMarker.readable).toBe(true);

    // A save composes from the (empty → then re-authored) in-memory set, so
    // a fresh 2.0.0 store replaces the legacy trailer: annotations authored
    // now persist, the 1.x ones are deliberately gone.
    const resaved = attachEmbedded(legacyMarker.content, [highlight]);
    expect(resaved).toContain('<!-- marky-mark-comments');
    expect(resaved).not.toContain('markimark-comments');
    expect(JSON.parse(splitTrailerJson(resaved)).version).toBe('2.0.0');
    // And with nothing authored, the legacy trailer simply disappears.
    expect(attachEmbedded(legacyMarker.content, legacyMarker.comments)).toBe(DOC);

    // Versionless sidecars (what pre-versioning builds and md-with-comments
    // wrote): legacy-empty, not an error and not a freeze.
    const read = readSidecar(JSON.stringify({ comments: [{ ...comment, kind: undefined }] }));
    expect(read.readable).toBe(true);
    expect(read.comments).toEqual([]);
    // A declared 1.x string is the same story in both stores.
    expect(readSidecar(JSON.stringify({ version: '1.1.0', comments: [comment] })).readable).toBe(true);
    expect(readSidecar(JSON.stringify({ version: '1.1.0', comments: [comment] })).comments).toEqual([]);
    expect(splitEmbedded(`${DOC}${trailerOf({ version: '1.1.0', comments: [comment] })}`).readable).toBe(true);
  });

  test('U143: the other two readability verdicts — unparseable trailer JSON is unreadable, no trailer at all is readable', () => {
    // A trailer whose JSON never parses reports the same unreadable verdict as
    // an unsupported version, with no declared version to name; the block is
    // still stripped byte-exactly so it cannot leak into the editor.
    const broken = splitEmbedded(`${DOC}\n<!-- marky-mark-comments\n{ "comments": [ \n-->\n`);
    expect(broken.hadTrailer).toBe(true);
    expect(broken.readable).toBe(false);
    expect(broken.declaredVersion).toBeUndefined();
    expect(broken.comments).toEqual([]);
    expect(broken.content).toBe(DOC);

    // Nothing there is not unreadable: a document without a trailer is
    // readable, so issue #16 has nothing to indicate.
    const none = splitEmbedded(DOC);
    expect(none.hadTrailer).toBe(false);
    expect(none.readable).toBe(true);

    // The sidecar keeps its throw-on-unparseable-JSON contract instead
    // (src/App.tsx's existing try/catch covers it).
    expect(() => readSidecar('{ "comments": [ ')).toThrow();
  });
});

describe('unreadable stores keep their bytes (PRD 004 Reqs 14/39 — issue #16)', () => {
  test('U144: splitEmbedded reports the trailer block it stripped, byte-for-byte, whatever the trailer was', () => {
    // A newer MAJOR: unreadable, and its exact bytes come back out.
    const newer = trailerOf({ version: '3.0.0', comments: [comment], future: { shape: 1 } });
    const split = splitEmbedded(`${DOC}${newer}`);
    expect(split.readable).toBe(false);
    expect(split.trailerBytes).toBe(newer);
    expect(`${split.content}${split.trailerBytes}`).toBe(`${DOC}${newer}`); // input reproduced

    // The legacy marker: the marker is reported as it was FOUND, not renamed.
    const legacy = trailerOf({ version: '3.0.0', comments: [comment] }, 'markimark-comments');
    const legacySplit = splitEmbedded(`${DOC}${legacy}`);
    expect(legacySplit.readable).toBe(false);
    expect(legacySplit.trailerBytes).toBe(legacy);
    expect(legacySplit.trailerBytes).toContain('markimark-comments');

    // Unparseable JSON (U143's verdict): still byte-exact, oddities included.
    const brokenTrailer = '\n<!-- marky-mark-comments\n{ "comments": [ \n-->\n\n';
    const broken = splitEmbedded(`${DOC}${brokenTrailer}`);
    expect(broken.readable).toBe(false);
    expect(broken.trailerBytes).toBe(brokenTrailer); // trailing blank line and all

    // A readable trailer reports its bytes too — nothing else consults them.
    const fine = splitEmbedded(attachEmbedded(DOC, [comment]));
    expect(fine.readable).toBe(true);
    expect(fine.trailerBytes).toBe(serializeTrailer([comment]));
    // …and no trailer at all reports none.
    expect(splitEmbedded(DOC).trailerBytes).toBeUndefined();
  });

  test('U145: the preserving composition re-emits those bytes verbatim after the content changed, and stays idempotent', () => {
    // Req 14: open → edit text → save leaves the payload bit-identical, and
    // the comments argument is ignored entirely — no migration can slip in.
    const preserved = trailerOf({ version: '3.0.0', comments: [comment], future: 'unknown to us' });
    const onDisk = `${DOC}${preserved}`;
    const split = splitEmbedded(onDisk);
    const edited = `${split.content}\nAn edit made while the trailer was unreadable.\n`;

    const saved = attachEmbedded(edited, [], split.trailerBytes);
    expect(saved).toBe(`${edited}${preserved}`);
    expect(saved.slice(edited.length)).toBe(preserved); // byte-for-byte
    expect(attachEmbedded(edited, [comment], split.trailerBytes)).toBe(saved); // comments ignored
    expect(saved).not.toContain('"2.0.0"'); // never restamped to our version

    // Re-saving repeatedly keeps it so, and never doubles the trailer.
    let text = saved;
    for (let i = 0; i < 3; i++) text = attachEmbedded(text, [], splitEmbedded(text).trailerBytes);
    expect(text).toBe(saved);
    expect(text.match(/marky-mark-comments/g)?.length).toBe(1);
    expect(splitEmbedded(text).content).toBe(edited);

    // A trailer carrying an escaped "-->" survives the same way (the hazard
    // that makes a regex re-run in the app the wrong place to get bytes from).
    const trickyJson = JSON.stringify(
      { version: '3.0.0', comments: [{ ...comment, body: 'tricky --> body' }] },
      null,
      2,
    ).replace(/-->/g, '-\\u002d>'); // exactly what serializeTrailer does
    const tricky = `\n<!-- marky-mark-comments\n${trickyJson}\n-->\n`;
    const trickySplit = splitEmbedded(`${DOC}${tricky}`);
    expect(trickySplit.readable).toBe(false);
    expect(trickySplit.trailerBytes).toBe(tricky);
    expect(trickySplit.trailerBytes).toContain('-\\u002d>'); // the escape, not a raw "-->"
    expect(attachEmbedded(`${DOC}more\n`, [], trickySplit.trailerBytes)).toBe(`${DOC}more\n${tricky}`);

    // The legacy marker is preserved as found — a save does NOT migrate it
    // for a document this build could not read.
    const legacy = trailerOf({ version: '3.0.0', comments: [comment] }, 'markimark-comments');
    const legacyBytes = splitEmbedded(`${DOC}${legacy}`).trailerBytes;
    expect(attachEmbedded(`${DOC}x\n`, [], legacyBytes)).toContain('markimark-comments');

    // Without the argument, attachEmbedded is exactly what it always was.
    expect(attachEmbedded(DOC, [comment], undefined)).toBe(attachEmbedded(DOC, [comment]));
  });

  test('U146: the 2.0.0 MAJOR deliberately ends PRD 004 Req 39 — the shipped v0.4.0-alpha.4 reader no longer round-trips this build’s output (issue #283)', () => {
    // Before issue #283 this test proved the alpha.4 reader read today's
    // stores losslessly. The kind split is a MAJOR precisely because it
    // cannot: the changelog's 2.0.0 entry states the break, and this test now
    // pins what the break actually does to the old reader.
    const comments = [comment, highlight];
    const written = attachEmbedded(DOC, comments);
    expect(JSON.parse(splitTrailerJson(written)).version).toBe('2.0.0');

    // alpha.4 has no version check, so it does not refuse — it misreads:
    // the highlight record (no body) fails its schema check and vanishes,
    // and the comment record survives only stripped of its `kind` (alpha.4
    // retains no unknown keys), so a round-trip through it is lossy twice.
    const readBack = alpha4SplitEmbedded(written);
    expect(readBack.hadTrailer).toBe(true);
    expect(readBack.content).toBe(DOC);
    expect(readBack.comments.map((c) => c.id)).toEqual([comment.id]); // the highlight is gone
    expect(readBack.comments[0]).not.toHaveProperty('kind'); // and the discriminant with it

    // The sidecar, same story.
    const sidecar = serializeSidecar(comments);
    expect(alpha4ParseSidecar(sidecar).map((c) => c.id)).toEqual([comment.id]);

    // And the frozen reader is genuinely the old one: it still accepts a
    // payload our build refuses outright (a newer-to-it MAJOR), which is why
    // it must never be re-pointed at src/.
    expect(alpha4ParseSidecar(JSON.stringify({ version: '3.0.0', comments: [{ ...comment, kind: undefined }] }))).toHaveLength(1);
    expect(readSidecar(JSON.stringify({ version: '3.0.0', comments })).readable).toBe(false);
  });
});

describe('comment format 2.0.0: the kind split (PRD 023 §1/§3 — issue #283)', () => {
  test('U1087: color is a known key — each of the four literals parses onto a highlight record and is never bagged as unknown', () => {
    // PRD 023 §3: orange replaced 1.1.0's blue.
    expect(COMMENT_COLORS).toEqual(['yellow', 'green', 'orange', 'pink']);
    for (const color of COMMENT_COLORS) {
      const parsed = parseSidecar(JSON.stringify({ version: '2.0.0', comments: [{ ...highlight, color }] }));
      expect(parsed[0].kind === 'highlight' && parsed[0].color, color).toBe(color);
      // A known key is parsed, not retained (PRD 004 Req 20): no bag and no
      // extraVersion.
      expect(parsed[0].extra, color).toBeUndefined();
      expect(parsed[0].extraVersion, color).toBeUndefined();
    }
  });

  test('U1088: a highlight whose color is outside the vocabulary — "blue" included — is dropped whole, never coerced', () => {
    // PRD 023 §3 (issue #283): a deliberate change from 1.1.0's "invalid
    // color reads as absent" — a highlight IS its color, so there is no
    // colorless fallback to degrade to; the record is skipped like any other
    // schema failure, and the parse never crashes.
    for (const bad of ['blue', 'purple', 'YELLOW', 'yellow ', '', 7, true, null, ['yellow'], { name: 'yellow' }, undefined]) {
      const label = JSON.stringify(bad) ?? 'undefined'; // stringify(undefined) is undefined
      const parsed = parseSidecar(
        JSON.stringify({ version: '2.0.0', comments: [{ ...highlight, color: bad }, comment] }),
      );
      // The bad highlight is gone; its valid neighbour survives.
      expect(parsed.map((c) => c.id), label).toEqual([comment.id]);
    }
  });

  test('U1089: stamping — a 2.0.0 set stamps the 2.0.0 baseline, and retained newer bags still win', () => {
    expect(stampedFormatVersion([comment])).toBe('2.0.0');
    expect(stampedFormatVersion([highlight])).toBe('2.0.0');
    expect(stampedFormatVersion([comment, highlight])).toBe('2.0.0');
    // The stamp lands in both containers' actual bytes.
    expect(JSON.parse(serializeSidecar([comment, highlight])).version).toBe('2.0.0');
    expect(JSON.parse(splitTrailerJson(attachEmbedded(DOC, [highlight]))).version).toBe('2.0.0');
    // A bag retained from a newer minor still wins the contest (PRD 004 Req 24).
    const retained = parseSidecar(JSON.stringify(payloadWithExtras('2.3.0')));
    expect(stampedFormatVersion([...retained, highlight])).toBe('2.3.0');
  });

  test('U1090: the floor is the baseline minor of the supported MAJOR — 2.x reads, 1.x is legacy-empty, 3.x is refused', () => {
    const read = expectSupported(readCommentPayload(payloadAt('2.0.0')));
    expect(read.version).toBe('2.0.0');
    expect(read.comments).toEqual([comment, highlight]);
    // The two legacy coercions resolve to 1.0.0: supported-but-empty now.
    expect(expectSupported(readCommentPayload(payloadAt(1))).comments).toEqual([]);
    expect(expectSupported(readCommentPayload({ comments: [comment] })).comments).toEqual([]);
    // A greater MAJOR is still refused outright.
    expectUnsupported(readCommentPayload(payloadAt('3.0.0')));
    // Both stores agree on the verdicts.
    expect(readSidecar(JSON.stringify({ version: '2.0.0', comments: [comment] })).readable).toBe(true);
    expect(splitEmbedded(`${DOC}${trailerOf({ version: '2.0.0', comments: [comment] })}`).readable).toBe(true);
  });

  test('U1091: both kinds round-trip byte-stably in both containers, each at its fixed per-kind key order', () => {
    const set = [highlight, comment];

    // Sidecar: identical bytes twice, and a read → write reproduces them.
    const sidecar = serializeSidecar(set);
    expect(serializeSidecar(set)).toBe(sidecar);
    expect(serializeSidecar(parseSidecar(sidecar))).toBe(sidecar);
    expect(parseSidecar(sidecar)).toEqual(set);

    // Trailer: same story, through a real attach → split → attach cycle.
    expect(serializeTrailer(set)).toBe(serializeTrailer(set));
    const attached = attachEmbedded(DOC, set);
    expect(splitEmbedded(attached).comments).toEqual(set);
    expect(attachEmbedded(DOC, splitEmbedded(attached).comments)).toBe(attached);

    // The two containers carry the identical payload (PRD 004 Req 26).
    expect(JSON.parse(splitTrailerJson(attached))).toEqual(JSON.parse(sidecar));

    // The per-kind emission orders are pinned: kind leads both.
    const entries = (JSON.parse(sidecar) as { comments: Record<string, unknown>[] }).comments;
    expect(Object.keys(entries[0])).toEqual(['kind', 'id', 'author', 'createdAt', 'color', 'anchor']);
    expect(Object.keys(entries[1])).toEqual(['kind', 'id', 'author', 'createdAt', 'body', 'resolved', 'thread', 'anchor']);
  });

  test('U1115: a record with a missing, non-string or unrecognized kind is dropped whole — never crashed on, never guessed at', () => {
    const text = JSON.stringify({
      version: '2.0.0',
      comments: [
        { ...comment, kind: undefined },
        { ...comment, id: 'kind-number', kind: 7 },
        { ...comment, id: 'kind-null', kind: null },
        { ...comment, id: 'kind-note', kind: 'note' },
        { ...highlight, kind: 'Highlight' }, // case matters: not the literal
        comment,
        highlight,
      ],
    });
    expect(parseSidecar(text).map((c) => c.id)).toEqual([comment.id, highlight.id]);
    // Same verdict through the trailer store; a comment record missing its
    // per-kind required body is dropped the same way.
    expect(splitEmbedded(`${DOC}${trailerOf(JSON.parse(text))}`).comments.map((c) => c.id)).toEqual([
      comment.id,
      highlight.id,
    ]);
    const noBody = JSON.stringify({ version: '2.0.0', comments: [{ ...comment, body: undefined }, highlight] });
    expect(parseSidecar(noBody).map((c) => c.id)).toEqual([highlight.id]);
  });

  test('U1116: a foreign known key — the other kind’s field — is ignored: not parsed, not bagged, not re-emitted', () => {
    // PRD 023 §1 (issue #283), as documented in docs/COMMENT-FORMAT.md: a
    // known key is a schema question, never an unknown-key one, so `color`
    // on a comment (and body/thread/resolved on a highlight) neither rides
    // the record nor falls into the unknown-key bag by accident.
    const text = JSON.stringify({
      version: '2.0.0',
      comments: [
        { ...comment, color: 'orange' },
        { ...highlight, body: 'smuggled', thread: [comment.thread[0]], resolved: true },
      ],
    });
    const parsed = parseSidecar(text);
    expect(parsed).toEqual([comment, highlight]); // the foreign keys are simply gone
    expect(parsed[0].extra).toBeUndefined();
    expect(parsed[1].extra).toBeUndefined();
    // …and a re-write emits clean per-kind records, byte-equal to the plain set.
    expect(serializeSidecar(parsed)).toBe(serializeSidecar([comment, highlight]));
    expect(serializeSidecar(parsed)).not.toContain('smuggled');
    // A genuinely unknown key beside a foreign one still bags normally.
    const mixed = parseSidecar(
      JSON.stringify({ version: '2.0.0', comments: [{ ...comment, color: 'orange', pinned: true }] }),
    );
    expect(Object.keys(mixed[0].extra ?? {})).toEqual(['pinned']);
  });

  test('U1117: legacy and malformed stores are tolerated end to end — zero annotations, readable verdicts, no throw from the seam', () => {
    // Issue #283 acceptance: a pre-2.0.0 or malformed store must never cost
    // the user the document. Legacy versions (with real 1.x-shaped entries):
    for (const payload of [
      { version: '1.0.0', comments: [{ ...comment, kind: undefined }] },
      { version: '1.1.0', comments: [{ ...comment, kind: undefined, color: 'blue' }] },
      { version: 1, comments: [{ ...comment, kind: undefined }] },
      { comments: [{ ...comment, kind: undefined }] },
    ]) {
      const label = JSON.stringify(payload.version ?? 'no-version');
      const read = readSidecar(JSON.stringify(payload));
      expect(read.readable, label).toBe(true);
      expect(read.comments, label).toEqual([]);
      const split = splitEmbedded(`${DOC}${trailerOf(payload)}`);
      expect(split.readable, label).toBe(true);
      expect(split.comments, label).toEqual([]);
      expect(split.content, label).toBe(DOC);
    }
    // Malformed payloads: non-objects, non-array comments, junk entries,
    // wrong-typed fields — all read without throwing, contributing nothing.
    for (const payload of [null, [], 'text', 7, { version: '2.0.0', comments: 'nope' }, { version: '2.0.0', comments: { a: 1 } }]) {
      const label = JSON.stringify(payload);
      expect(expectSupported(readCommentPayload(payload), label).comments).toEqual([]);
    }
    const junkEntries = {
      version: '2.0.0',
      comments: [7, null, 'x', { kind: 'comment' }, { ...highlight, anchor: 'not-an-anchor' }, comment],
    };
    expect(parseSidecar(JSON.stringify(junkEntries))).toEqual([comment]);
    expect(splitEmbedded(`${DOC}${trailerOf(junkEntries)}`).comments).toEqual([comment]);
  });
});

describe('the published comment-format specification (docs/COMMENT-FORMAT.md — issue #17)', () => {
  test('U147: PRD Reqs 25/32–37 — docs/COMMENT-FORMAT.md still describes this build', () => {
    // The drift guard for the published spec (issue #17): every claim below is
    // read out of the document and checked against the code, so the document
    // cannot rot while the format moves. Reading a repo file from a unit test
    // follows tests/unit/licenses.test.ts (vitest runs in the node env).
    const doc = readFileSync(
      fileURLToPath(new URL('../../docs/COMMENT-FORMAT.md', import.meta.url)),
      'utf8',
    );

    /** The document from `heading` up to the next heading of the same level. */
    function sectionAfter(heading: string): string {
      const from = doc.indexOf(heading);
      expect(from, heading).toBeGreaterThan(-1);
      const hashes = heading.slice(0, heading.indexOf(' ')); // '##' or '###'
      const next = doc.indexOf(`\n${hashes} `, from + 1);
      return next === -1 ? doc.slice(from) : doc.slice(from, next);
    }

    /** The bodies of the fenced `lang` blocks inside the section at `heading`. */
    function fencedBlocks(heading: string, lang: string): string[] {
      const re = new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\\n\`\`\``, 'g');
      const blocks = [...sectionAfter(heading).matchAll(re)].map((m) => m[1]);
      expect(blocks.length, `${lang} blocks under ${heading}`).toBeGreaterThan(0);
      return blocks;
    }

    /** The `| \`key\` | … | min version | …` rows of the table under `heading`. */
    function schemaTable(heading: string): { keys: string[]; minVersions: string[] } {
      const keys: string[] = [];
      const minVersions: string[] = [];
      const rows = sectionAfter(heading).matchAll(/^\| `([^`]+)`[^|]*\|[^|]*\|[^|]*\|\s*([^|\s]+)\s*\|/gm);
      for (const row of rows) {
        keys.push(row[1]);
        minVersions.push(row[2]);
      }
      expect(keys.length, heading).toBeGreaterThan(0);
      return { keys, minVersions };
    }

    /** The first capture of `re`, naming what was missing when there is none. */
    function captured(re: RegExp, text: string, what: string): string {
      const m = re.exec(text);
      if (!m) throw new Error(`docs/COMMENT-FORMAT.md: could not find ${what}`);
      return m[1];
    }

    // 1. The version the document presents, and its changelog.
    expect(
      captured(/\*\*Current format version: `([^`]+)`\*\*/, doc, 'the current-version line'),
    ).toBe(SUPPORTED_COMMENT_FORMAT_VERSION);
    const changelog = doc.slice(doc.indexOf('## Changelog'));
    // Newest first: the top entry is the version this build supports…
    expect(captured(/^### (\d+\.\d+\.\d+)/m, changelog, 'a changelog entry')).toBe(
      SUPPORTED_COMMENT_FORMAT_VERSION,
    );
    // …it states the issue #283 break in so many words…
    const topEntry = changelog.slice(0, changelog.indexOf('### 1.1.0'));
    expect(topEntry).toMatch(/kind/);
    expect(topEntry).toMatch(/`"orange"`/);
    expect(topEntry).toMatch(/deliberate/);
    expect(topEntry).toMatch(/v0\.4\.0-alpha\.4 reader/);
    // …and the 1.x history it broke from is still recorded below it.
    expect(changelog).toMatch(/^### 1\.1\.0 /m);
    expect(changelog).toMatch(/^### 1\.0\.0 /m);
    // And it says the format version is not the app version (Req 36).
    expect(doc).toMatch(/independent of the Marky Mark application\s*\n?version/);

    // 2. The schema tables list exactly the keys this build knows, per kind,
    //    and every row records the minimum version that field requires
    //    (Req 25) — all of them the 2.0.0 baseline, since the kind split
    //    landed as one MAJOR.
    for (const [heading, keys] of [
      ['### The payload object', ['version', 'comments']],
      ['### The comment record', COMMENT_RECORD_KEYS],
      ['### The highlight record', HIGHLIGHT_RECORD_KEYS],
      ['### The reply object', REPLY_KEYS],
      ['### The anchor object', ANCHOR_KEYS],
    ] as const) {
      const table = schemaTable(heading);
      expect(table.keys, heading).toEqual([...keys]);
      expect(table.minVersions, heading).toEqual(keys.map(() => BASELINE_COMMENT_FORMAT_VERSION));
    }
    // The anchor's documented context length is the real one.
    expect(doc).toContain(`Up to ${CONTEXT_LENGTH} characters of context`);
    // The foreign-known-key rule is stated, per kind (issue #283).
    expect(doc).toMatch(/Foreign known keys/);

    // 3. The worked example parses to the records the document claims, and
    //    is byte-exactly what this build writes for them — in both containers.
    const [example] = fencedBlocks('## A complete worked example', 'json');
    const read = readCommentPayload(JSON.parse(example) as unknown);
    expect(read.supported).toBe(true);
    if (!read.supported) throw new Error('worked example must be supported');
    expect(read.version).toBe(SUPPORTED_COMMENT_FORMAT_VERSION);
    expect(read.comments.map((c) => c.id)).toEqual(['h-27b1', 'c-9f2a']);
    expect(read.comments.map((c) => c.kind)).toEqual(['highlight', 'comment']);
    const exampleComment = read.comments[1];
    if (exampleComment.kind !== 'comment') throw new Error('second example record is the comment');
    expect(exampleComment.thread.map((r) => r.id)).toEqual(['r-41c8']);
    expect(exampleComment.anchor.exact).toBe('signed');
    expect(exampleComment.thread[0].body).toContain('-->'); // the escape, restored
    const exampleHighlight = read.comments[0];
    expect(exampleHighlight.kind === 'highlight' && exampleHighlight.color).toBe('orange');
    expect(serializeSidecar(read.comments)).toBe(`${example}\n`);

    // The worked example shows the same payload in both containers; the
    // trailer is the fenced block that opens with the HTML comment.
    const trailerBlock = fencedBlocks('## A complete worked example', 'text').find((block) =>
      block.startsWith('<!--'),
    );
    if (trailerBlock === undefined) throw new Error('no trailer block in the worked example');
    expect(serializeTrailer(read.comments)).toBe(`\n${trailerBlock}\n`);

    // 4. The frozen container strings are the real ones (Reqs 32/33).
    const marker = captured(/^<!-- (\S+)$/m, trailerBlock, 'the trailer marker');
    expect(marker).toBe('marky-mark-comments');
    const legacyMarker = 'markimark-comments';
    expect(doc, 'the legacy marker').toContain(`\`${legacyMarker}\``);
    const docText = '# Notes\n';
    for (const documented of [marker, legacyMarker]) {
      const split = splitEmbedded(`${docText}\n${trailerBlock.replace(marker, documented)}\n`);
      expect(split.hadTrailer, documented).toBe(true);
      expect(split.readable, documented).toBe(true);
      expect(split.content, documented).toBe(docText);
      expect(split.comments, documented).toEqual(read.comments);
    }
    const sidecarDoc = captured(/`([\w.-]+\.md)\.comments\.json`/, doc, 'a sidecar filename example');
    expect(sidecarPathFor(sidecarDoc)).toBe(`${sidecarDoc}.comments.json`);
  });
});
