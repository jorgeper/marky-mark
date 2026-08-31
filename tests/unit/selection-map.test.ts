import { describe, expect, test } from 'vitest';
import {
  findNormalized,
  mapSelectionToSource,
  sourceCaretForRendered,
  sourceOffsetForRendered,
  sourceRangeForVisibleMatch,
  stripInline,
  visibleTextForRange,
} from '../../src/lib/selectionMap';

describe('SPEC23 selection mapping', () => {
  test('U50: stripInline visible text + offset maps; mapSelectionToSource exact offsets and null fallbacks', () => {
    // Block prefixes vanish, offsets point into the source line.
    expect(stripInline('# Heading one').visible).toBe('Heading one');
    expect(stripInline('# Heading one').map[0]).toBe(2);
    expect(stripInline('> quoted text').visible).toBe('quoted text');
    expect(stripInline('- item').visible).toBe('item');
    expect(stripInline('12. numbered').visible).toBe('numbered');

    // Inline markers vanish; content offsets are exact.
    const bold = stripInline('some **bold move** here');
    expect(bold.visible).toBe('some bold move here');
    expect(bold.map[bold.visible.indexOf('bold')]).toBe('some **'.length);
    expect(stripInline('*em* and _u_ and ~~gone~~').visible).toBe('em and u and gone');
    expect(stripInline('snake_case_stays').visible).toBe('snake_case_stays');

    const code = stripInline('run `npm test` now');
    expect(code.visible).toBe('run npm test now');
    expect(code.map[code.visible.indexOf('npm')]).toBe('run `'.length);

    // Links show their text; images show nothing; escapes show the char.
    const link = stripInline('see [the docs](https://x.y) for more');
    expect(link.visible).toBe('see the docs for more');
    expect(link.map[link.visible.indexOf('the')]).toBe('see ['.length);
    expect(stripInline('a ![alt text](img.png) b').visible).toBe('a  b');
    expect(stripInline('not \\*bold\\*').visible).toBe('not *bold*');

    // mapSelectionToSource: a phrase crossing a bold boundary maps to the
    // exact source span (markers inside included).
    const src = '# Title\n\nsome **bold move** here today\n\n- item one\n';
    const hit = mapSelectionToSource(src, 3, 3, 'bold move here');
    expect(hit).not.toBeNull();
    expect(src.slice(hit!.from, hit!.to)).toBe('bold move** here');

    // Whitespace-normalized: rendered selections collapse newlines/spaces.
    const multi = mapSelectionToSource(src, 1, 5, 'Title some');
    expect(multi).not.toBeNull();
    expect(src.slice(multi!.from, multi!.to)).toBe('Title\n\nsome');

    // Unlocatable (table cell text reordered by rendering) → null.
    const table = '| a | b |\n|---|---|\n| c | d |\n';
    expect(mapSelectionToSource(table, 1, 3, 'zebra')).toBeNull();

    // Ambiguous (two identical phrases in range) → null, caller falls back.
    const dup = 'same phrase\n\nsame phrase\n';
    expect(mapSelectionToSource(dup, 1, 3, 'same phrase')).toBeNull();

    // Empty/whitespace selections never match.
    expect(mapSelectionToSource(src, 1, 5, '   ')).toBeNull();
  });

  test('U52: visibleTextForRange strips markers within bounds; findNormalized locates, rejects ambiguity', () => {
    const src = '# Title\n\nsome **bold move** here today\n\n- item one\n';

    // Whole bold-bearing line renders without its markers.
    const lineStart = src.indexOf('some');
    const lineEnd = src.indexOf(' today') + ' today'.length;
    expect(visibleTextForRange(src, lineStart, lineEnd)).toBe('some bold move here today');

    // A range starting inside the strong markers picks up only in-range visible chars.
    const from = src.indexOf('bold');
    const to = src.indexOf(' here');
    expect(visibleTextForRange(src, from, to)).toBe('bold move');

    // Multi-line ranges join with a space; prefixes stay stripped.
    expect(visibleTextForRange(src, 0, src.indexOf(' move'))).toBe('Title some bold');

    // Degenerate ranges are empty.
    expect(visibleTextForRange(src, 5, 5)).toBe('');

    // findNormalized: exact raw offsets, whitespace-collapsed matching.
    const hay = 'The quick\n  brown fox';
    const hit = findNormalized(hay, 'quick brown');
    expect(hit).not.toBeNull();
    expect(hay.slice(hit!.start, hit!.end)).toBe('quick\n  brown');
    // Absent and ambiguous needles both refuse.
    expect(findNormalized(hay, 'zebra')).toBeNull();
    expect(findNormalized('abc abc', 'abc')).toBeNull();
    expect(findNormalized(hay, '   ')).toBeNull();
  });

  // Issue #138: fenced code blocks render verbatim — the mapping layer must
  // not strip their content as if it were prose, and the fence delimiter
  // lines (which the preview never renders) must contribute no visible text.
  test('U713: fence body maps verbatim — list/heading/emphasis/underscore/link-looking code keeps every character', () => {
    const body = ['- item', '# not a heading', 'a * b * c', 'snake_case_name', 'x = *ptr;', '[label](url)'];
    const src = '```js\n' + body.join('\n') + '\n```\n';
    for (const line of body) {
      const lineStart = src.indexOf(line);
      // The rendered text of the whole line is the source line, character
      // for character, and offsets round-trip exactly.
      expect(visibleTextForRange(src, lineStart, lineStart + line.length)).toBe(line);
    }
    // A rendered-side selection of code that looks like markdown maps back
    // to the identical source characters.
    const hit = mapSelectionToSource(src, 2, 3, '- item # not a heading');
    expect(hit).not.toBeNull();
    expect(src.slice(hit!.from, hit!.to)).toBe('- item\n# not a heading');
  });

  test('U714: fence delimiter lines (``` / ```js / ~~~) contribute no visible characters', () => {
    const src = 'before\n\n```js\ncode line\n```\n\n~~~\ntilde body\n~~~\n\nafter\n';
    // Ranges covering only a delimiter line render as nothing.
    expect(visibleTextForRange(src, src.indexOf('```js'), src.indexOf('```js') + 5)).toBe('');
    expect(visibleTextForRange(src, src.indexOf('~~~'), src.indexOf('~~~') + 3)).toBe('');
    // A range spanning a fence boundary shows only prose + code — no
    // literal backticks or language tag poison the haystack.
    expect(visibleTextForRange(src, 0, src.indexOf('code line') + 'code line'.length)).toBe('before code line');
    // The close delimiter is equally invisible from the code side out.
    expect(visibleTextForRange(src, src.indexOf('code line'), src.indexOf('after') + 5)).toBe(
      'code line tilde body after'
    );
  });

  test('U715: a selection spanning prose→fence→prose maps to exact source offsets', () => {
    const src = 'The intro line.\n\n```\nlet x = 1;\n```\n\nThe outro line.\n';
    const hit = mapSelectionToSource(src, 1, 7, 'intro line. let x = 1; The outro');
    expect(hit).not.toBeNull();
    expect(src.slice(hit!.from, hit!.to)).toBe('intro line.\n\n```\nlet x = 1;\n```\n\nThe outro');
    // And the forward direction agrees: the same span's visible text is the
    // needle a rendered-text search can find.
    expect(visibleTextForRange(src, hit!.from, hit!.to)).toBe('intro line. let x = 1; The outro');
  });

  test('U716: fence body containing backticks stays verbatim; fence state derives from the document start', () => {
    const src = '# Doc\n\n````md\nuse `inline code` here\n```\nnested fence text\n```\n````\n\ntail prose\n';
    const line = 'use `inline code` here';
    const at = src.indexOf(line);
    expect(visibleTextForRange(src, at, at + line.length)).toBe(line);
    // A range that BEGINS mid-fence is still recognised as code: the
    // backticks are not eaten as inline-code markers, because fence state
    // is scanned from the top of the document, not from the range start.
    const nested = src.indexOf('nested fence text');
    expect(visibleTextForRange(src, at, nested + 'nested fence text'.length)).toBe(
      'use `inline code` here ``` nested fence text'
    );
    // sourceRangeForVisibleMatch sees the same verbatim haystack.
    const hit = sourceRangeForVisibleMatch(src, 3, 8, 'use `inline code` here', 0);
    expect(hit).not.toBeNull();
    expect(src.slice(hit!.from, hit!.to)).toBe(line);
  });

  test('U718: fence OPENING rules — a backtick info string is not a fence; an unclosed fence runs to the end', () => {
    // CommonMark: a backtick fence's info string may not contain backticks,
    // so this first line is a paragraph and the list line stays prose.
    const notAFence = '```md`x`\n- item\n';
    const atProse = notAFence.indexOf('- item');
    expect(visibleTextForRange(notAFence, atProse, atProse + '- item'.length)).toBe('item');
    // With a real opener that never closes, the same line is code to the end
    // of the document — the list marker is content, not a marker.
    const unclosed = '```md\n- item\n';
    const atCode = unclosed.indexOf('- item');
    expect(visibleTextForRange(unclosed, atCode, atCode + '- item'.length)).toBe('- item');
  });

  test('U717: sourceOffsetForRendered lands inside a fence body, not on stripped phantom text', () => {
    const src = '```py\nvalue = a * b\n```\n';
    // Rendered <pre> text is the body verbatim (plus a trailing newline).
    const rendered = 'value = a * b\n';
    // The rendered offset of '*' maps to the '*' in the source — under the
    // old prose stripping the asterisk had no visible slot at all.
    const star = rendered.indexOf('*');
    const at = sourceOffsetForRendered(src, 1, 3, rendered, star);
    expect(at).not.toBeNull();
    expect(src[at!]).toBe('*');
  });
});

describe('Issue #178 collapsed-caret mapping', () => {
  test('U978: sourceCaretForRendered — a mid-word caret lands at the exact source offset, through stripped markers and repeated words', () => {
    // The within-word offset rides along past the stripped ** markers.
    const src = '# T\n\nThe **quick brown** fox jumps far.\n';
    const rendered = 'The quick brown fox jumps far.';
    const at = sourceCaretForRendered(src, 3, 3, rendered, rendered.indexOf('jumps') + 2);
    expect(at).toBe(src.indexOf('jumps') + 2);
    // A repeated word resolves by the CARET's occurrence, not the first.
    const twice = 'cat and cat again\n';
    const at2 = sourceCaretForRendered(twice, 1, 1, 'cat and cat again', 'cat and c'.length);
    expect(at2).toBe('cat and c'.length);
  });

  test('U979: sourceCaretForRendered — end-of-word affinity, punctuation runs via the flat prefix, invisible blocks null', () => {
    const src = 'plus +++ plus2\n';
    const r = 'plus +++ plus2';
    // Caret just past 'plus' keeps left affinity: the word's end, not the run.
    expect(sourceCaretForRendered(src, 1, 1, r, 4)).toBe(4);
    // Caret on the middle '+' (no word) maps through the flat prefix.
    expect(sourceCaretForRendered(src, 1, 1, r, 6)).toBe(6);
    // A block with no visible text cannot resolve — the caller falls back.
    expect(sourceCaretForRendered('```\n```\n', 1, 2, '', 0)).toBeNull();
  });

  test('U980: sourceCaretForRendered — fence bodies map verbatim and the nth count spans mid-word hits', () => {
    const src = '```py\nvalue = a * b\n```\n';
    const rendered = 'value = a * b\n';
    // 'a' occurs inside 'value' first — the standalone 'a' is occurrence 1.
    const at = sourceCaretForRendered(src, 1, 3, rendered, rendered.indexOf(' a ') + 1);
    expect(at).not.toBeNull();
    expect(src[at!]).toBe('a');
    expect(at).toBe(src.indexOf(' a ') + 1);
  });
});
