import { describe, expect, test } from 'vitest';
import { previewLinkAction } from '../../src/lib/previewLinks';
import { headingAnchors } from '../../src/lib/shareLinks';
import { parseSections } from '../../src/lib/sectionModel';

const DOC = [
  '# Guide',
  '',
  'intro [down](#setup) and [again](#setup-1).',
  '',
  '## Setup',
  '',
  'first.',
  '',
  '## Setup',
  '',
  'second.',
  '',
  '## Café Notes',
  '',
  '> ### Quoted Tail',
  '',
].join('\n');

describe('SPEC11 §4 (issue #268): in-document fragment links resolve through the Req 18 anchors', () => {
  test('U1211: previewLinkAction — a fragment resolves to its heading line through the ONE slug table, duplicates keep their own occurrence, a percent-encoded fragment decodes, an unmatched one is a graceful miss, and external/inert keep the SPEC11 §4 parity contract', () => {
    const anchors = headingAnchors(parseSections(DOC));
    expect(anchors.map((a) => a.slug)).toEqual(['guide', 'setup', 'setup-1', 'café-notes', 'quoted-tail']);

    // The load-bearing case: `#setup` lands on the FIRST occurrence's source
    // line, `#setup-1` on the second — GitHub-style dedupe, the E335 rule.
    expect(previewLinkAction('#setup', anchors)).toEqual({ kind: 'heading', line: 5 });
    expect(previewLinkAction('#setup-1', anchors)).toEqual({ kind: 'heading', line: 9 });
    // A container-nested heading (issue #226) is addressable like any other.
    expect(previewLinkAction('#quoted-tail', anchors)).toEqual({ kind: 'heading', line: 15 });
    // Percent-encoded fragments decode through classifyManagedLink's existing
    // rule before matching — a unicode slug travels encoded and still lands.
    expect(previewLinkAction('#caf%C3%A9-notes', anchors)).toEqual({ kind: 'heading', line: 13 });
    // PRD 020 Req 19: no heading answers it — the miss, not a scroll to top.
    expect(previewLinkAction('#renamed-away', anchors)).toEqual({ kind: 'miss' });
    expect(previewLinkAction('#a%20b', anchors)).toEqual({ kind: 'miss' }); // decoded to 'a b'
    expect(previewLinkAction('#', anchors)).toEqual({ kind: 'miss' });
    // A document with no headings at all answers nothing.
    expect(previewLinkAction('#setup', [])).toEqual({ kind: 'miss' });

    // The unchanged halves of SPEC11 §4, through the same one classifier.
    expect(previewLinkAction('https://example.com/page', anchors)).toEqual({
      kind: 'external',
      url: 'https://example.com/page',
    });
    for (const inert of ['./other.md', '../up.md', 'mailto:a@b.c', 'ftp://x', '']) {
      expect(previewLinkAction(inert, anchors)).toEqual({ kind: 'inert' });
    }
  });
});
