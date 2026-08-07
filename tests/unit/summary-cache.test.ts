import { describe, expect, test } from 'vitest';
import { flattenSections, parseSections } from '../../src/lib/sectionModel';
import {
  SUMMARY_PROMPT_VERSION,
  contentHash,
  reconcileSummaryKeys,
  summaryKeyForEntry,
  summaryKeyForSection,
  type SummaryKeyContext,
} from '../../src/lib/summaryCache';
import { zoomView } from '../../src/lib/zoomLevels';

const CTX: SummaryKeyContext = { level: 4, providerId: 'openai', modelId: 'gpt-4o-mini' };

const SOURCE = '# Guide\n\nOpening.\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body.\n';

const sectionsOf = (source: string) => flattenSections(parseSections(source)).filter((s) => s.depth > 0);
const keyed = (source: string, ctx: SummaryKeyContext = CTX) =>
  Object.fromEntries(sectionsOf(source).map((s) => [s.title, summaryKeyForSection(s, ctx)]));

describe('PRD 011 Req 28 — summary cache keying and invalidation', () => {
  test('U504: identical content yields an identical key across runs and restarts', () => {
    const first = keyed(SOURCE);
    const second = keyed(SOURCE);
    expect(second).toEqual(first);

    // Pinned literally: the key is arithmetic over the content, with nothing
    // ambient in it, so a restarted process reuses the same cache entry.
    expect(first.Alpha).toBe('mmz1:p1:openai:gpt-4o-mini:l4:54dee9778eefb215');
    expect(SUMMARY_PROMPT_VERSION).toBe('p1');
    expect(contentHash(['ab', 'c'])).not.toBe(contentHash(['a', 'bc']));
  });

  test('U505: editing one section changes that section key and no other', () => {
    const before = keyed(SOURCE);
    const after = keyed(SOURCE.replace('Alpha body.', 'Alpha body, revised.'));
    expect(after.Alpha).not.toBe(before.Alpha);
    expect(after.Beta).toBe(before.Beta);
    expect(after.Guide).toBe(before.Guide);

    // Re-titling or re-levelling a section invalidates it too.
    expect(keyed(SOURCE.replace('## Alpha', '## Alpha renamed')).Beta).toBe(before.Beta);
    expect(keyed(SOURCE.replace('## Alpha', '### Alpha')).Alpha).not.toBe(before.Alpha);
  });

  test('U506: moving an unchanged section elsewhere does not change its key', () => {
    const before = keyed(SOURCE);
    const moved = keyed('# Guide\n\nOpening.\n\n## Beta\n\nBeta body.\n\n## Alpha\n\nAlpha body.\n');
    expect(moved.Alpha).toBe(before.Alpha);
    expect(moved.Beta).toBe(before.Beta);
  });

  test('U507: changing model, provider, level or prompt version changes the key', () => {
    const base = keyed(SOURCE).Alpha;
    expect(keyed(SOURCE, { ...CTX, modelId: 'gpt-4o' }).Alpha).not.toBe(base);
    expect(keyed(SOURCE, { ...CTX, providerId: 'anthropic' }).Alpha).not.toBe(base);
    expect(keyed(SOURCE, { ...CTX, level: 2 }).Alpha).not.toBe(base);
    expect(keyed(SOURCE, { ...CTX, promptVersion: 'p2' }).Alpha).not.toBe(base);
  });

  test('U508: reconciliation says which keys survive an edit and which went stale', () => {
    const previous = sectionsOf(SOURCE);
    const current = sectionsOf(SOURCE.replace('Alpha body.', 'Alpha body, revised.'));
    const result = reconcileSummaryKeys(previous, current, CTX);

    expect(result.needed.map((n) => n.id)).toEqual(['1', '1.1', '1.2']);
    expect(result.missing).toEqual([summaryKeyForSection(current[1], CTX)]);
    expect(result.stale).toEqual([summaryKeyForSection(previous[1], CTX)]);
    expect(result.valid.sort()).toEqual(
      [summaryKeyForSection(previous[0], CTX), summaryKeyForSection(previous[2], CTX)].sort()
    );

    // An untouched document strands nothing and needs nothing new.
    const unchanged = reconcileSummaryKeys(previous, sectionsOf(SOURCE), CTX);
    expect(unchanged.stale).toEqual([]);
    expect(unchanged.missing).toEqual([]);
    expect(unchanged.valid).toHaveLength(3);
  });

  test('U509: a folded entry key covers everything folded into it', () => {
    const deep = '# Guide\n\nOpening.\n\n## Alpha\n\nAlpha body.\n\n### Deep\n\nDeep body.\n';
    const entryKey = (source: string) => {
      const entry = zoomView(parseSections(source), 3).entries.find((e) => e.title === 'Alpha');
      return summaryKeyForEntry(entry!, { ...CTX, level: 3 });
    };
    expect(entryKey(deep)).toBe(entryKey(deep));
    expect(entryKey(deep.replace('Deep body.', 'Deep body, revised.'))).not.toBe(entryKey(deep));
  });
});
