import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  SUPPORTED_COMMENT_FORMAT_VERSION,
  isFormatVersion,
  parseFormatVersion,
  readCommentPayload,
  type CommentFormatRead,
} from '../../src/lib/commentFormat';
import { serializeTrailer } from '../../src/lib/embedded';
import { serializeSidecar } from '../../src/lib/sidecar';
import type { CommentData } from '../../src/lib/anchoring';

const seamSource = readFileSync(
  fileURLToPath(new URL('../../src/lib/commentFormat.ts', import.meta.url)),
  'utf8',
);

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { version: string };

const comment: CommentData = {
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

/** A raw parsed payload as JSON.parse would produce it, at a declared version. */
function payloadAt(version: unknown): unknown {
  return JSON.parse(JSON.stringify({ version, comments: [comment] })) as unknown;
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
  test('U124: the supported comment-format version is declared once as "1.0.0", independent of the app version', () => {
    expect(SUPPORTED_COMMENT_FORMAT_VERSION).toBe('1.0.0');
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

  test('U126: the two registered legacy coercions — integer 1 and an absent version key — both read as 1.0.0', () => {
    // PRD Req 3: existing embedded trailers.
    const trailer = expectSupported(readCommentPayload(payloadAt(1)));
    expect(trailer.version).toBe('1.0.0');
    expect(trailer.comments).toEqual([comment]);

    // PRD Req 4: existing sidecars, which have no version key at all.
    const sidecar = expectSupported(
      readCommentPayload(JSON.parse(serializeSidecar([comment])) as unknown),
    );
    expect(sidecar.version).toBe('1.0.0');
    expect(sidecar.comments).toEqual([comment]);
  });

  test('U127: a valid version string is taken at face value — same MAJOR with a greater MINOR is supported, PATCH never decides', () => {
    for (const version of ['1.0.0', '1.0.9', '1.0.99', '1.1.0', '1.7.2']) {
      const read = expectSupported(readCommentPayload(payloadAt(version)), version);
      // Interpreted as itself, not rewritten to the build's own version.
      expect(read.version).toBe(version);
      expect(read.comments).toEqual([comment]);
    }
  });

  test('U128: a present but uninterpretable version is unsupported, not 1.0.0, and is reported as it appeared', () => {
    // PRD Req 5: neither the integer 1 nor a valid semver string.
    const malformed: unknown[] = ['1', '1.0', 2, 1.5, true, false, null, [], {}, 'newest', '', 'v1.0.0', '1.0.0-beta'];
    for (const version of malformed) {
      const read = expectUnsupported(readCommentPayload(payloadAt(version)), JSON.stringify(version));
      expect(read.declaredVersion).toEqual(version);
    }
    // null is *present*: it is unsupported, unlike an absent key (U126).
    const explicitNull = readCommentPayload({ version: null, comments: [] });
    expect(explicitNull.supported).toBe(false);
    const absent = readCommentPayload({ comments: [] });
    expect(absent.supported).toBe(true);
  });

  test('U129: MAJOR decides first — a greater MAJOR is unreadable, and a version below the supported one has no registered transformation', () => {
    for (const version of ['2.0.0', '9.1.4', '2.0.99']) {
      const read = expectUnsupported(readCommentPayload(payloadAt(version)), version);
      expect(read.declaredVersion).toBe(version);
    }
    // Below 1.0.0: no transformation is registered and none may be invented
    // for a version that never existed (PRD Req 30).
    for (const version of ['0.9.0', '0.0.1']) {
      expectUnsupported(readCommentPayload(payloadAt(version)), version);
    }
  });

  test('U130: a payload that is not an object is handled without throwing', () => {
    for (const payload of [null, 'a string', 42, ['an', 'array'], true, undefined]) {
      const read = expectSupported(readCommentPayload(payload), JSON.stringify(payload ?? null));
      // No version key to read, so 1.0.0 with zero comments — exactly what
      // parseSidecar yields for such input today.
      expect(read.version).toBe('1.0.0');
      expect(read.comments).toEqual([]);
    }
    // Malformed entries are skipped rather than crashing the read, as today.
    const partial = expectSupported(
      readCommentPayload({ version: 1, comments: [comment, { id: 'no-anchor' }, 7, null] }),
    );
    expect(partial.comments).toEqual([comment]);
    // Even a value JSON.parse could never have produced yields a result.
    expectSupported(readCommentPayload({ version: 1, comments: [{ ...comment, body: 1n }] }));
  });

  test('U131: the discriminant makes comments unreadable off the unsupported branch, and `version` is the only versioning key', () => {
    const unsupported = readCommentPayload(payloadAt('2.0.0'));
    // @ts-expect-error — the unsupported branch carries no comments (PRD Req 29).
    expect(unsupported.comments).toBeUndefined();
    const supported = readCommentPayload(payloadAt('1.0.0'));
    // @ts-expect-error — the supported branch carries no declared version.
    expect(supported.declaredVersion).toBeUndefined();

    // PRD Req 6: `version` is the only versioning key the module reads or
    // names — no formatVersion alias, no parallel major/minor payload fields.
    expect(seamSource).not.toMatch(/formatVersion|schemaVersion/);
    expect(seamSource).not.toMatch(/(record|payload)\??\.(major|minor)\b|'(major|minor)' in /);
    expect(seamSource).toContain("'version' in payload");
  });

  test('U132: the seam is pure and nothing is rewired — both stores keep the bytes they write today', () => {
    // PRD Req 31: no DOM, no React, no platform imports.
    expect(seamSource).not.toMatch(/@tauri-apps|from 'react'|\bdocument\.|\bwindow\./);
    expect(seamSource.match(/^import .*/gm)).toEqual([
      "import type { CommentData } from './anchoring';",
      "import { parseSidecar } from './sidecar';",
    ]);

    // No store is rewired here: nothing outside tests/ imports the seam yet
    // (issue #15 moves both stores onto it).
    const srcFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) srcFiles.push(full);
      }
    };
    walk(fileURLToPath(new URL('../../src', import.meta.url)));
    const importers = srcFiles.filter(
      (f) => !f.endsWith('/commentFormat.ts') && /from '[^']*commentFormat'/.test(readFileSync(f, 'utf8')),
    );
    expect(importers).toEqual([]);

    // The stores are untouched in this issue: the trailer still writes the
    // integer 1 and the sidecar still writes no version key (issue #15).
    const trailer = serializeTrailer([comment]);
    expect(trailer).toContain('"version": 1');
    const sidecar = serializeSidecar([comment]);
    const parsedSidecar = JSON.parse(sidecar) as { comments: unknown };
    expect(parsedSidecar).not.toHaveProperty('version');
    // …and still 2-space pretty-printed with a trailing newline, byte for byte.
    expect(sidecar).toBe(`${JSON.stringify({ comments: parsedSidecar.comments }, null, 2)}\n`);
  });
});
