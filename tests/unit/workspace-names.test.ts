import { describe, expect, it } from 'vitest';
import {
  RESERVED_WORKSPACE_NAMES,
  UNIQUE_NAME_MAX_LENGTH,
  dedupeUniqueName,
  isReservedWorkspaceName,
  planUniqueNameMigration,
  slugifyWorkspaceName,
  uniqueNameFormatProblem,
  uniqueNameKey,
  uniqueNameProblem,
} from '../../src/lib/workspaceNames';

describe('PRD 020 Req 1 unique-name rules', () => {
  it('U1044: well-formed names pass; empty, over-long and charset violations are refused naming the problem', () => {
    for (const good of ['a', 'Design-Docs', 'a.b_c-d', '0', '.', 'A'.repeat(UNIQUE_NAME_MAX_LENGTH)]) {
      expect(uniqueNameFormatProblem(good), good).toBeNull();
      expect(uniqueNameProblem(good), good).toBeNull();
    }
    expect(uniqueNameFormatProblem('')).toBe('A unique name is required.');
    expect(uniqueNameFormatProblem('a'.repeat(UNIQUE_NAME_MAX_LENGTH + 1))).toBe(
      `A unique name must be at most ${UNIQUE_NAME_MAX_LENGTH} characters.`,
    );
    for (const bad of ['a b', 'a/b', 'ä', 'a\n', 'name!']) {
      expect(uniqueNameFormatProblem(bad), bad).toBe(
        'A unique name may only use letters, digits, and . _ - characters.',
      );
    }
  });

  it('U1045: reserved names are refused case-insensitively — scratch, scratchpad and the route words in use', () => {
    expect([...RESERVED_WORKSPACE_NAMES].sort()).toEqual(['api', 'assets', 'scratch', 'scratchpad']);
    for (const reserved of ['api', 'API', 'scratch', 'Scratchpad', 'ASSETS']) {
      expect(isReservedWorkspaceName(reserved), reserved).toBe(true);
      expect(uniqueNameProblem(reserved), reserved).toBe(`"${reserved}" is a reserved name.`);
      // Reserved is policy, not shape: the format half still accepts them, so
      // manifest validation never rejects a stored name over policy history.
      expect(uniqueNameFormatProblem(reserved), reserved).toBeNull();
    }
    expect(isReservedWorkspaceName('api-docs')).toBe(false);
    // Case-insensitive comparison runs through one key.
    expect(uniqueNameKey('Design-Docs')).toBe('design-docs');
  });
});

describe('PRD 020 Req 3 slugify and dedupe', () => {
  it('U1046: slugify lowercases, collapses unsafe runs to "-", clamps the length, and never yields empty', () => {
    expect(slugifyWorkspaceName('Design Docs')).toBe('design-docs');
    expect(slugifyWorkspaceName('Q3 — Plans & Notes')).toBe('q3-plans-notes');
    expect(slugifyWorkspaceName('release.notes_v2')).toBe('release.notes_v2');
    // A run of several unsafe characters is ONE dash, not one per character.
    expect(slugifyWorkspaceName('a   !!!   b')).toBe('a-b');
    expect(slugifyWorkspaceName('X'.repeat(150))).toBe('x'.repeat(UNIQUE_NAME_MAX_LENGTH));
    // Nothing usable still yields a charset-legal base for dedupe to suffix.
    expect(slugifyWorkspaceName('!!!')).toBe('-');
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
