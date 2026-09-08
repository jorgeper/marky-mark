import { describe, expect, it } from 'vitest';
import {
  RESERVED_WORKSPACE_NAMES,
  UNIQUE_NAME_MAX_LENGTH,
  WORKSPACE_SLUG_FALLBACK,
  dedupeUniqueName,
  isReservedWorkspaceName,
  legacyUniqueNameFormatProblem,
  planUniqueNameMigration,
  recordFormerName,
  slugifyWorkspaceName,
  uniqueNameFormatProblem,
  uniqueNameKey,
  uniqueNameProblem,
} from '../../src/lib/workspaceNames';

/** PRD 026 Req 1: the one charset message every caller shows. */
const CHARSET_PROBLEM = 'A unique name may only use lowercase letters, numbers and single dashes between them.';

describe('PRD 020 Req 1 unique-name rules (amended by PRD 026 Req 1)', () => {
  it('U1044: well-formed names pass; empty, over-long and charset violations are refused naming the problem', () => {
    // PRD 026 Req 1: a chosen name is lowercase-dash — PRD 020's uppercase,
    // dots and underscores no longer pass here (they stay valid only as
    // STORED names, U1317).
    for (const good of ['a', 'design-docs', 'a-b-c-d', '0', 'a'.repeat(UNIQUE_NAME_MAX_LENGTH)]) {
      expect(uniqueNameFormatProblem(good), good).toBeNull();
      expect(uniqueNameProblem(good), good).toBeNull();
    }
    expect(uniqueNameFormatProblem('')).toBe('A unique name is required.');
    expect(uniqueNameFormatProblem('a'.repeat(UNIQUE_NAME_MAX_LENGTH + 1))).toBe(
      `A unique name must be at most ${UNIQUE_NAME_MAX_LENGTH} characters.`,
    );
    for (const bad of ['a b', 'a/b', 'ä', 'a\n', 'name!', 'Design-Docs', 'a.b', 'a_b', '-a', 'a-', 'a--b']) {
      expect(uniqueNameFormatProblem(bad), bad).toBe(CHARSET_PROBLEM);
    }
  });

  it('U1315: the PRD 026 Req 1 accept/reject table — lowercase, digits and single inner dashes only, 1–100 characters', () => {
    const hundred = `${'ab-'.repeat(33)}c`;
    expect(hundred.length).toBe(100);
    for (const good of ['a-b', 'a1', '0', 'team-docs-2', '9-9', hundred]) {
      expect(uniqueNameFormatProblem(good), good).toBeNull();
      expect(uniqueNameProblem(good), good).toBeNull();
    }
    // Each refusal names its own problem: charset, empty and over-length
    // stay three distinct messages.
    const charset = [
      ['Design-Docs', 'uppercase'],
      ['TEAM', 'all caps'],
      ['a.b', 'dot'],
      ['a_b', 'underscore'],
      ['-a', 'leading dash'],
      ['a-', 'trailing dash'],
      ['a--b', 'double dash'],
      ['-', 'a lone dash'],
      ['a b', 'space'],
      [' a', 'leading space'],
      ['a/b', 'slash'],
      ['日本語', 'non-ASCII'],
      ['café', 'accented'],
    ] as const;
    for (const [bad, why] of charset) {
      expect(uniqueNameFormatProblem(bad), why).toBe(CHARSET_PROBLEM);
      expect(uniqueNameProblem(bad), why).toBe(CHARSET_PROBLEM);
    }
    expect(uniqueNameFormatProblem('')).toBe('A unique name is required.');
    expect(uniqueNameFormatProblem('a'.repeat(101))).toBe('A unique name must be at most 100 characters.');
    // The strict rule refuses before the reserved list gets a look…
    expect(uniqueNameProblem('API')).toBe(CHARSET_PROBLEM);
    // …and the reserved list still layers on top of a well-formed name.
    expect(uniqueNameProblem('api')).toBe('"api" is a reserved name.');
    expect(uniqueNameProblem('api-docs')).toBeNull();
  });

  it('U1317: PRD 026 Req 9 — the legacy check keeps PRD 020\u2019s charset for stored names while the strict check refuses it', () => {
    // Grandfathered stored names: uppercase, underscore, dot — legal on
    // disk, no longer choosable.
    for (const stored of ['Team_Docs', 'Design-Docs', 'a.b', 'release.notes_v2', '.', 'A'.repeat(UNIQUE_NAME_MAX_LENGTH)]) {
      expect(legacyUniqueNameFormatProblem(stored), stored).toBeNull();
      expect(uniqueNameFormatProblem(stored), stored).not.toBeNull();
    }
    // Every strict-legal name is legacy-legal too (the new rule is a subset).
    for (const both of ['a', 'team-docs', 'a1-b2']) {
      expect(legacyUniqueNameFormatProblem(both), both).toBeNull();
      expect(uniqueNameFormatProblem(both), both).toBeNull();
    }
    // Both refuse what neither rule ever allowed, with the same empty and
    // over-length messages and each its own charset wording.
    for (const bad of ['a b', 'a/b', 'ä', '']) {
      expect(legacyUniqueNameFormatProblem(bad), bad).not.toBeNull();
      expect(uniqueNameFormatProblem(bad), bad).not.toBeNull();
    }
    expect(legacyUniqueNameFormatProblem('')).toBe('A unique name is required.');
    expect(legacyUniqueNameFormatProblem('a'.repeat(101))).toBe('A unique name must be at most 100 characters.');
    expect(legacyUniqueNameFormatProblem('a b')).toBe('A unique name may only use letters, digits, and . _ - characters.');
    expect(legacyUniqueNameFormatProblem('a b')).not.toBe(uniqueNameFormatProblem('a b'));
  });

  it('U1045: reserved names are refused case-insensitively — scratch, scratchpad and the route words in use', () => {
    expect([...RESERVED_WORKSPACE_NAMES].sort()).toEqual(['api', 'assets', 'scratch', 'scratchpad']);
    for (const reserved of ['api', 'scratch', 'scratchpad', 'assets']) {
      expect(isReservedWorkspaceName(reserved), reserved).toBe(true);
      expect(uniqueNameProblem(reserved), reserved).toBe(`"${reserved}" is a reserved name.`);
      // Reserved is policy, not shape: the format half still accepts them, so
      // manifest validation never rejects a stored name over policy history.
      expect(uniqueNameFormatProblem(reserved), reserved).toBeNull();
      expect(legacyUniqueNameFormatProblem(reserved), reserved).toBeNull();
    }
    // Case-insensitively reserved still — and, PRD 026 Req 1, a capitalised
    // form is refused before the reserved list is consulted (the strict
    // charset trips first), while the legacy shape check keeps accepting it.
    for (const cased of ['API', 'Scratchpad', 'ASSETS']) {
      expect(isReservedWorkspaceName(cased), cased).toBe(true);
      expect(uniqueNameProblem(cased), cased).toBe(CHARSET_PROBLEM);
      expect(legacyUniqueNameFormatProblem(cased), cased).toBeNull();
    }
    expect(isReservedWorkspaceName('api-docs')).toBe(false);
    // Case-insensitive comparison runs through one key.
    expect(uniqueNameKey('Design-Docs')).toBe('design-docs');
  });
});

describe('PRD 020 Req 3 slugify and dedupe (slugifier amended by PRD 026 Req 2)', () => {
  it('U1046: slugify lowercases, collapses runs outside [a-z0-9] to one "-", trims edge dashes, clamps the length, and yields empty for nothing usable', () => {
    expect(slugifyWorkspaceName('Design Docs')).toBe('design-docs');
    expect(slugifyWorkspaceName('Q3 — Plans & Notes')).toBe('q3-plans-notes');
    // PRD 026 Req 2: dots and underscores are outside the charset now, so
    // they become dashes rather than surviving.
    expect(slugifyWorkspaceName('release.notes_v2')).toBe('release-notes-v2');
    // A run of several unsafe characters is ONE dash, not one per character.
    expect(slugifyWorkspaceName('a   !!!   b')).toBe('a-b');
    expect(slugifyWorkspaceName('X'.repeat(150))).toBe('x'.repeat(UNIQUE_NAME_MAX_LENGTH));
    // Nothing usable is the empty string — the fallback word belongs to the
    // callers (U1318), not the slugifier.
    expect(slugifyWorkspaceName('!!!')).toBe('');
  });

  it('U1316: the PRD 026 Req 2 slugifier examples, and every non-empty output satisfies Req 1', () => {
    const examples: [string, string][] = [
      ['Team Docs', 'team-docs'],
      ['  Hello, World!! ', 'hello-world'],
      ['jane.doe', 'jane-doe'],
      ['A--B', 'a-b'],
      ['release.notes_v2', 'release-notes-v2'],
      ['j_smith', 'j-smith'],
      ['--edge--', 'edge'],
      ['UPPER', 'upper'],
      ['already-fine-9', 'already-fine-9'],
      ['!!!', ''],
      ['日本語', ''],
      ['', ''],
      ['   ', ''],
    ];
    for (const [input, slug] of examples) {
      expect(slugifyWorkspaceName(input), JSON.stringify(input)).toBe(slug);
      if (slug !== '') expect(uniqueNameFormatProblem(slug), slug).toBeNull();
    }
    // Clamping: 150 x's then dash material clamps to exactly 100 characters…
    const long = slugifyWorkspaceName(`${'x'.repeat(150)}-!-y`);
    expect(long).toBe('x'.repeat(UNIQUE_NAME_MAX_LENGTH));
    // …and a clamp that lands right after a dash strips it again, so the
    // result is never a trailing-dash name Req 1 would refuse.
    const cutOnDash = slugifyWorkspaceName(`${'x'.repeat(99)} ${'y'.repeat(50)}`);
    expect(cutOnDash).toBe('x'.repeat(99));
    expect(cutOnDash.length).toBe(99);
    expect(uniqueNameFormatProblem(cutOnDash)).toBeNull();
    // A run of separators at the cut point collapses to one dash first, so
    // the clamp sees a single dash there and the strip removes exactly it.
    const cutOnRun = slugifyWorkspaceName(`${'x'.repeat(99)}-_.${'y'.repeat(50)}`);
    expect(cutOnRun).toBe('x'.repeat(99));
  });

  it('U1318: the migration planner supplies the "workspace" fallback when a display name slugifies to nothing', () => {
    // PRD 026 Req 2: the slugifier yields '' for `!!!` and `日本語`; the
    // planner (like the server's name-only create, U1057) substitutes the
    // fallback word and dedupes it exactly as any other base.
    expect(WORKSPACE_SLUG_FALLBACK).toBe('workspace');
    expect(
      planUniqueNameMigration([
        { id: 'w1', name: '!!!', created: '2026-01-01T00:00:00.000Z' },
        { id: 'w2', name: '日本語', created: '2026-02-01T00:00:00.000Z' },
        { id: 'w3', name: 'Team Docs', created: '2026-03-01T00:00:00.000Z' },
      ]),
    ).toEqual([
      { id: 'w1', uniqueName: 'workspace' },
      { id: 'w2', uniqueName: 'workspace-2' },
      { id: 'w3', uniqueName: 'team-docs' },
    ]);
  });

  it('U1047: dedupe suffixes -2, -3… past taken names (case-insensitively) and reserved words, within the length cap', () => {
    expect(dedupeUniqueName('docs', new Set())).toBe('docs');
    expect(dedupeUniqueName('docs', new Set(['docs']))).toBe('docs-2');
    expect(dedupeUniqueName('docs', new Set(['docs', 'docs-2']))).toBe('docs-3');
    // The taken set holds lowercased keys; the candidate compares through them.
    expect(dedupeUniqueName('Docs', new Set(['docs']))).toBe('Docs-2');
    // PRD 020 Req 3: reserved words count as taken, so migration never mints
    // one — the existing "Scratchpad" workspace lands on scratchpad-2.
    expect(dedupeUniqueName('scratchpad', new Set())).toBe('scratchpad-2');
    // The suffix truncates the base rather than exceeding the limit.
    const long = 'a'.repeat(UNIQUE_NAME_MAX_LENGTH);
    const deduped = dedupeUniqueName(long, new Set([long]));
    expect(deduped).toBe(`${'a'.repeat(UNIQUE_NAME_MAX_LENGTH - 2)}-2`);
    expect(deduped.length).toBe(UNIQUE_NAME_MAX_LENGTH);
  });

  it('U1048: migration planning slugifies unnamed workspaces oldest-first, dedupes deployment-wide, and is idempotent', () => {
    const plan = planUniqueNameMigration([
      // Already migrated: skipped, but its name counts as taken.
      { id: 'w0', name: 'Kept', uniqueName: 'design-docs', created: '2026-01-01T00:00:00.000Z' },
      // Newer of the two "Design Docs" — created later, gets the suffix.
      { id: 'w2', name: 'Design Docs', created: '2026-03-01T00:00:00.000Z' },
      { id: 'w1', name: 'Design Docs', created: '2026-02-01T00:00:00.000Z' },
      // PRD 019's scratchpad slugifies into a reserved word → deduped past it.
      { id: 'w3', name: 'Scratchpad', created: '2026-04-01T00:00:00.000Z' },
    ]);
    expect(plan).toEqual([
      { id: 'w1', uniqueName: 'design-docs-2' },
      { id: 'w2', uniqueName: 'design-docs-3' },
      { id: 'w3', uniqueName: 'scratchpad-2' },
    ]);
    // Idempotency: once every workspace carries a unique name, a second run
    // plans nothing at all.
    expect(
      planUniqueNameMigration([
        { id: 'w0', name: 'Kept', uniqueName: 'design-docs', created: '2026-01-01T00:00:00.000Z' },
        { id: 'w1', name: 'Design Docs', uniqueName: 'design-docs-2', created: '2026-02-01T00:00:00.000Z' },
      ]),
    ).toEqual([]);
  });
});

describe('PRD 024 Req 2+3+4 former-name history', () => {
  it('U1240: recordFormerName appends the name given up, ignores a case-only change, and reclaims a name off the list', () => {
    // Req 2: a real rename appends the previous name; Req 4: append order is
    // the whole history — one flat list, no old→new mapping.
    expect(recordFormerName([], 'a', 'b')).toEqual(['a']);
    expect(recordFormerName(['a'], 'b', 'c')).toEqual(['a', 'b']);
    // Req 2: a case-only change shares a key with the previous name, so it
    // records nothing.
    expect(recordFormerName(['a'], 'B', 'b')).toEqual(['a']);
    // Req 3: the name becoming current leaves the list (case-insensitively),
    // so after A → B → A the history is exactly [B] and never holds the
    // current name.
    expect(recordFormerName(['a', 'b'], 'c', 'A')).toEqual(['b', 'c']);
    expect(recordFormerName(['ping'], 'pong', 'PING')).toEqual(['pong']);
    // An entry is never duplicated, and a rename from nothing — a manifest
    // that carried no unique name — records nothing.
    expect(recordFormerName(['a'], 'a', 'b')).toEqual(['a']);
    expect(recordFormerName(['a'], undefined, 'b')).toEqual(['a']);
    // The input is left alone: the caller's stored array is not mutated.
    const history = ['a'];
    recordFormerName(history, 'b', 'c');
    expect(history).toEqual(['a']);
  });
});
