import { describe, expect, test } from 'vitest';
import { findNormalized, mapSelectionToSource, stripInline, visibleTextForRange } from '../../src/lib/selectionMap';

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
});
