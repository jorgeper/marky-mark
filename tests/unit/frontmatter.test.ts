import { describe, expect, test } from 'vitest';
import { parseFrontMatter } from '../../src/lib/frontmatter';

describe('SPEC26 front matter', () => {
  test('U54: fenced blocks parse to entries; unclosed/absent/offset fences are not front matter', () => {
    const doc = '---\ndate: 2026-07-05\nkind: article\ntags:\n  - agentic-engineering\n  - llm\n{weird}\n---\n\n# Title\n';
    const fm = parseFrontMatter(doc)!;
    expect(fm).not.toBeNull();
    expect(fm.endLine).toBe(8);
    expect(fm.entries).toEqual([
      { key: 'date', value: '2026-07-05' },
      { key: 'kind', value: 'article' },
      { key: 'tags', value: 'agentic-engineering, llm' },
      { key: '', value: '{weird}' }, // raw passthrough row
    ]);
    expect(fm.raw).toContain('kind: article');

    // Quoted scalars unquote; blank lines inside are skipped.
    const quoted = parseFrontMatter('---\ntitle: "Hello: world"\n\nauthor: \'Jorge\'\n...\nbody\n')!;
    expect(quoted.entries).toEqual([
      { key: 'title', value: 'Hello: world' },
      { key: 'author', value: 'Jorge' },
    ]);
    expect(quoted.endLine).toBe(5); // `...` closes too

    // Not front matter: no fence, unclosed fence, fence not on line 1.
    expect(parseFrontMatter('# Just a doc\n')).toBeNull();
    expect(parseFrontMatter('---\nkey: value\nno closing fence\n')).toBeNull();
    expect(parseFrontMatter('\n---\nkey: value\n---\n')).toBeNull();
    expect(parseFrontMatter('')).toBeNull();
  });
});
