import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildRows, citedSpecKeys, e2eCitations, mapFromTree, parseSpec, renderMap } from '../../scripts/map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A minimal tree: one spec per key, plus whatever files the case needs. */
const tree = (keys: string[], srcFiles: { path: string; text: string }[] = [], e2eFiles: { path: string; text: string }[] = []) => ({
  specs: keys.map((k) => ({ path: `docs/specs/${k}.md`, text: `# ${k}: title of ${k}\n\nbody\n` })),
  srcFiles,
  e2eFiles,
});

describe('docs/MAP.md generator (issue #35, prd/005 §E)', () => {
  test('U155: a spec row takes its title from the spec\'s own first heading, and survives a spec with none', () => {
    expect(parseSpec('docs/specs/SPEC31.md', '# SPEC31: Marky Mark v31 — New Window (multi-window)\n\nDelta spec.\n')).toEqual({
      key: 'SPEC31',
      file: 'SPEC31.md',
      title: 'SPEC31: Marky Mark v31 — New Window (multi-window)',
    });
    // The first `# ` heading wins over later ones, and `##` is not a title.
    expect(parseSpec('SPEC2.md', '## not the title\n\n# SPEC2: real title\n\n# later\n').title).toBe('SPEC2: real title');
    // No heading at all: an empty title, not a crash.
    expect(parseSpec('SPEC9.md', 'no headings here\n').title).toBe('');
  });

  test('U156: citation matching is word-boundary exact — SPEC3 is not SPEC30/SPEC34, and a bare SPEC buckets to SPEC.md', () => {
    expect(citedSpecKeys('// SPEC3 §2: the thing')).toEqual(['SPEC3']);
    expect(citedSpecKeys('// SPEC30 and SPEC34 amendments')).toEqual(['SPEC30', 'SPEC34']);
    // The bare citation in src/platform/types.ts must land on SPEC.md, not SPEC2.
    expect(citedSpecKeys('* The single seam between the app and the host (SPEC FR-6).')).toEqual(['SPEC']);
    expect(citedSpecKeys('SPEC §8 and SPEC2 §7')).toEqual(['SPEC', 'SPEC2']);
    // Words that merely start with SPEC are not citations.
    expect(citedSpecKeys('SPECIAL SPECIFIC specs SPEC_DIR')).toEqual([]);
    // Deduped and sorted numerically, never lexicographically.
    expect(citedSpecKeys('SPEC10 SPEC9 SPEC10 SPEC2')).toEqual(['SPEC2', 'SPEC9', 'SPEC10']);
  });

  test('U157: e2e citations are attributed to the enclosing E-numbered test; ones outside every test belong to the file', () => {
    const source = [
      "// W-tests (SPEC2 §7): file header, outside any test.",
      'test.beforeEach(async ({ page }) => {',
      '  // SPEC5 §1: shared setup also sits outside a test body.',
      '  await freshApp(page);',
      '});',
      '',
      "test('E1: launch shows the empty state', async ({ page }) => {",
      '  // SPEC27 §4.1 amendment (revised): the empty state is the icon splash.',
      "  await expect(page.locator('[data-x=\")(\"]')).toHaveClass(/selected/); // SPEC3",
      '});',
      '',
      "test('E12: something else', async ({ page }) => {",
      '  await expect(page).toHaveTitle(`${name} — SPEC27 §5`);',
      '});',
      '',
      '// SPEC34: trailing note after the last test.',
    ].join('\n');

    expect(e2eCitations(source)).toEqual([
      { key: 'SPEC2', test: null },
      { key: 'SPEC3', test: 'E1' },
      { key: 'SPEC5', test: null },
      { key: 'SPEC27', test: 'E1' },
      { key: 'SPEC27', test: 'E12' },
      { key: 'SPEC34', test: null },
    ]);

    // The rows render the E-numbers, and file-level citations name the file.
    const { rows } = buildRows(tree(['SPEC2', 'SPEC3', 'SPEC27', 'SPEC34', 'SPEC5'], [], [{ path: 'tests/e2e/app.spec.ts', text: source }]));
    expect(rows.map((r) => [r.key, r.tests])).toEqual([
      ['SPEC2', ['tests/e2e/app.spec.ts']],
      ['SPEC3', ['E1']],
      ['SPEC5', ['tests/e2e/app.spec.ts']],
      ['SPEC27', ['E1', 'E12']],
      ['SPEC34', ['tests/e2e/app.spec.ts']],
    ]);
  });

  test('U158: an uncited spec still gets a row, marked none — an absent row and an uncited spec must not look alike', () => {
    const { rows } = buildRows(
      tree(['SPEC', 'SPEC2', 'SPEC31'], [{ path: 'src/lib/a.ts', text: '// SPEC2 §3 (SPEC FR-1)' }]),
    );
    expect(rows.map((r) => r.key)).toEqual(['SPEC', 'SPEC2', 'SPEC31']);
    expect(rows.find((r) => r.key === 'SPEC31')).toMatchObject({ src: [], tests: [] });

    const markdown = renderMap(rows);
    expect(markdown).toContain('| [SPEC31](specs/SPEC31.md) | SPEC31: title of SPEC31 | _none_ | _none_ |');
    expect(markdown).toContain('| [SPEC2](specs/SPEC2.md) | SPEC2: title of SPEC2 | `src/lib/a.ts` | _none_ |');
    // The header says what the file is and how to regenerate it.
    expect(markdown).toContain('npm run map');
    expect(markdown).toContain('scripts/map.mjs');
    expect(markdown).toMatch(/never hand-edited/);
  });

  test('U159: rendering is deterministic — identical input renders byte-identical output, order-independent', () => {
    const srcFiles = [
      { path: 'src/b.ts', text: '// SPEC10 §2' },
      { path: 'src/a.ts', text: '// SPEC10 §1, SPEC2' },
    ];
    const first = renderMap(buildRows(tree(['SPEC2', 'SPEC10'], srcFiles)).rows);
    const second = renderMap(buildRows(tree(['SPEC10', 'SPEC2'], [...srcFiles].reverse())).rows);
    expect(second).toBe(first);
    expect(first).toContain('| [SPEC10](specs/SPEC10.md) | SPEC10: title of SPEC10 | `src/a.ts`, `src/b.ts` | _none_ |');
    // No timestamps, no absolute paths.
    expect(first).not.toMatch(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(first).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });

  test('U160: a citation naming a spec with no file in docs/specs/ is reported, not turned into a row, and never crashes', () => {
    const { rows, unknown } = buildRows(
      tree(['SPEC27', 'SPEC29'], [{ path: 'src/x.ts', text: '// SPEC28 was withdrawn; SPEC47/SPEC48 were removed; SPEC29 lives' }]),
    );
    expect(rows.map((r) => r.key)).toEqual(['SPEC27', 'SPEC29']);
    expect(unknown).toEqual(['SPEC28', 'SPEC47', 'SPEC48']);
    expect(rows.find((r) => r.key === 'SPEC29')?.src).toEqual(['src/x.ts']);
  });

  test('U161: the real tree yields one row per spec file, each carrying its own title', () => {
    const { rows } = mapFromTree(root);
    expect(rows).toHaveLength(45);
    expect(rows[0].key).toBe('SPEC'); // the unnumbered base spec sorts first
    expect(rows.at(-1)?.key).toBe('SPEC46');
    expect(rows.map((r) => r.key)).not.toContain('SPEC28'); // withdrawn: no file, no row
    for (const row of rows) expect(row.title, row.key).not.toBe('');
  });
});
