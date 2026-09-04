import { describe, expect, test } from 'vitest';
import { findSection, flattenSections, parseSections, sectionContent } from '../../src/lib/sectionModel';

describe('PRD 011 Req 24 — source-level section tree', () => {
  test('U480: headings nest by depth with 1-based source ranges and own bodies', () => {
    const doc = parseSections(
      ['# Title', '', 'Intro line.', '', '## Alpha', '', 'Alpha body.', '', '## Beta', '', 'Beta body.'].join('\n')
    );

    expect(doc.title).toBe('Title');
    expect(doc.preamble).toBeNull();
    expect(doc.sections).toHaveLength(1);

    const title = doc.sections[0];
    expect(title.depth).toBe(1);
    expect(title.headingLine).toBe(1);
    expect(title.startLine).toBe(1);
    expect(title.endLine).toBe(11); // the whole document, descendants included
    expect(title.body).toBe('Intro line.'); // own body only — stops at `## Alpha`
    expect(title.bodyEndLine).toBe(4);
    expect(title.children.map((c) => c.title)).toEqual(['Alpha', 'Beta']);

    const [alpha, beta] = title.children;
    expect([alpha.startLine, alpha.endLine]).toEqual([5, 8]);
    expect(alpha.body).toBe('Alpha body.');
    expect([beta.startLine, beta.endLine]).toEqual([9, 11]); // runs to end of document
    expect(beta.body).toBe('Beta body.');
  });

  test('U481: an empty document yields nothing, and a document with no headings is all preamble', () => {
    const empty = parseSections('');
    expect(empty).toEqual({ sections: [], preamble: null, title: null, lineCount: 0, headings: [] });

    const headless = parseSections('Just prose.\n\nMore prose.\n');
    expect(headless.sections).toEqual([]);
    expect(headless.title).toBeNull();
    expect(headless.lineCount).toBe(3);
    expect(headless.preamble).toMatchObject({
      id: 'preamble',
      depth: 0,
      headingLine: 0,
      startLine: 1,
      endLine: 3,
      body: 'Just prose.\n\nMore prose.',
    });
  });

  test('U482: preamble content before the first heading is its own node', () => {
    const doc = parseSections('Lead paragraph.\n\n# Heading\n\nBody.\n');
    expect(doc.preamble?.body).toBe('Lead paragraph.');
    expect(doc.preamble?.endLine).toBe(2);
    expect(doc.sections[0].startLine).toBe(3);
    expect(flattenSections(doc).map((s) => s.id)).toEqual(['preamble', '1']);
  });

  test('U483: skipped depths nest under the nearest shallower heading', () => {
    const doc = parseSections('# One\n\n### Three\n\nBody.\n\n#### Four\n\n## Two\n');
    const one = doc.sections[0];
    expect(one.children.map((c) => [c.title, c.id])).toEqual([
      ['Three', '1.1'],
      ['Two', '1.2'],
    ]);
    expect(one.children[0].children.map((c) => c.id)).toEqual(['1.1.1']);
    expect(one.children[0].endLine).toBe(8); // `### Three` ends before `## Two`
  });

  test('U484: a document opening below depth 1 keeps its deep headings as roots', () => {
    const doc = parseSections('### Deep\n\nBody.\n\n### Other\n');
    expect(doc.title).toBeNull();
    expect(doc.sections.map((s) => [s.id, s.depth])).toEqual([
      ['1', 3],
      ['2', 3],
    ]);
  });

  test('U485: identical heading text still yields distinct ids', () => {
    const doc = parseSections('## Notes\n\nFirst.\n\n## Notes\n\nSecond.\n');
    expect(doc.sections.map((s) => s.id)).toEqual(['1', '2']);
    expect(doc.sections.map((s) => s.title)).toEqual(['Notes', 'Notes']);
    expect(doc.sections.map((s) => s.body)).toEqual(['First.', 'Second.']);
    expect(findSection(doc, '2')?.body).toBe('Second.');
  });

  test('U486: setext headings are headings, and their underline is not body text', () => {
    const doc = parseSections('Title\n=====\n\nBody line.\n\nSub\n---\n\nSub body.\n');
    expect(doc.preamble).toBeNull();
    expect(doc.sections[0]).toMatchObject({ depth: 1, title: 'Title', headingLine: 1, body: 'Body line.' });
    expect(doc.sections[0].children[0]).toMatchObject({ depth: 2, title: 'Sub', body: 'Sub body.' });
  });

  test('U487: a `#` line inside a fenced code block is not a heading', () => {
    const doc = parseSections('# Real\n\n```sh\n# not a heading\necho hi\n```\n\nAfter.\n');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].children).toEqual([]);
    expect(doc.sections[0].body).toContain('# not a heading');
    expect(doc.sections[0].endLine).toBe(8);
  });

  test('U488: YAML front matter is excluded from every section body', () => {
    const doc = parseSections('---\ntitle: Demo\ntags: a\n---\n\n# Head\n\nBody.\n');
    expect(doc.preamble).toBeNull(); // the front matter is not preamble content
    expect(doc.sections[0].headingLine).toBe(6);
    expect(doc.sections[0].body).toBe('Body.');
    expect(flattenSections(doc).some((s) => s.body.includes('title: Demo'))).toBe(false);

    const noHeadings = parseSections('---\ntitle: Demo\n---\n\nJust prose.\n');
    expect(noHeadings.preamble?.startLine).toBe(4);
    expect(noHeadings.preamble?.body).toBe('Just prose.');
  });

  test('U489: canonical section content carries the heading depth and text', () => {
    const doc = parseSections('# Title\n\n## Alpha\n\nAlpha body.\n');
    const alpha = findSection(doc, '1.1');
    expect(alpha).not.toBeNull();
    expect(sectionContent(alpha!)).toBe('## Alpha\nAlpha body.');
    expect(findSection(doc, 'nope')).toBeNull();
  });
});
