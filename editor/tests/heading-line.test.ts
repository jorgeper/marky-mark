import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { isHeadingLine } from '../src/lib/headingLine';

/** A state whose background parse has NOT been given time to finish. */
function fresh(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
}

/** Does the state's own snapshot tree see a heading on this line? */
function treeSaysHeading(state: EditorState, line: number): boolean {
  const l = state.doc.line(line);
  let hit = false;
  syntaxTree(state).iterate({
    from: l.from,
    to: l.to,
    enter: (n) => {
      if (/^(ATX|Setext)Heading/.test(n.name)) hit = true;
    },
  });
  return hit;
}

// A document far too long for one parse slice: a heading at the very bottom
// is past whatever the background parse has reached on a fresh state.
const HUGE = [
  '# Top',
  '',
  ...Array.from({ length: 4000 }, (_, i) => [
    `paragraph ${i} with **bold**, _italic_, \`code\` and [a link](https://example.com).`,
    '',
    '- item one',
    '  - nested item',
    '',
  ]).flat(),
  '## Bottom Heading',
  '',
].join('\n');

describe('PRD 020 Req 18 (issue #260): the gutter heading pre-filter', () => {
  test('U1187: a heading past the background parse still answers "heading" — the snapshot tree alone does not', () => {
    const state = fresh(HUGE);
    const bottom = state.doc.lines - 1;
    expect(state.doc.line(bottom).text).toBe('## Bottom Heading');
    // The bug: the state's own tree has not reached this far, so reading it
    // directly reports "not a heading" and the marker never renders.
    expect(treeSaysHeading(state, bottom)).toBe(false);
    // The fix: parse up to the line first (or abstain), so the answer is yes.
    expect(isHeadingLine(state, state.doc.line(bottom))).toBe(true);
  });

  test('U1188: it still says no to a fenced `#` line and yes to setext and container-nested headings', () => {
    const doc = ['# Top', '', '```sh', '# not a heading', '```', '', 'Setext Title', '===', '', '- item', '  ## Listed', ''].join('\n');
    const state = fresh(doc);
    ensureSyntaxTree(state, state.doc.length, 5000);
    const s = state.update({}).state;
    const at = (n: number) => isHeadingLine(s, s.doc.line(n));
    expect(at(1)).toBe(true); // # Top
    expect(at(4)).toBe(false); // fenced `# not a heading`
    expect(at(7)).toBe(true); // setext title line
    expect(at(11)).toBe(true); // heading indented under a list item
  });
});
