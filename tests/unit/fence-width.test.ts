import { describe, expect, test } from 'vitest';
import { readFenceWidth, rewriteFenceWidth } from '../../src/lib/fenceWidth';
import { fenceLanguage } from '../../src/lib/fenceRenderers';

describe('PRD 015 Req 3 — tolerant width reading', () => {
  test('U761: reads width=N after the language word, case-insensitively, never mutating', () => {
    const info = 'mermaid width=500';
    expect(readFenceWidth(info)).toBe(500);
    expect(info).toBe('mermaid width=500');
    expect(readFenceWidth('mermaid Width=500')).toBe(500);
    expect(readFenceWidth('mermaid WIDTH=42 theme=dark')).toBe(42);
  });

  test('U762: null for no string, no meta, meta without width, and class-shaped strings', () => {
    expect(readFenceWidth(null)).toBeNull();
    expect(readFenceWidth(undefined)).toBeNull();
    expect(readFenceWidth('')).toBeNull();
    expect(readFenceWidth('mermaid')).toBeNull();
    expect(readFenceWidth('mermaid theme=dark title="x"')).toBeNull();
    expect(readFenceWidth('language-mermaid')).toBeNull();
  });

  test('U763: null for every malformed or non-positive value', () => {
    expect(readFenceWidth('mermaid width')).toBeNull();
    expect(readFenceWidth('mermaid width=')).toBeNull();
    expect(readFenceWidth('mermaid width=abc')).toBeNull();
    expect(readFenceWidth('mermaid width=500px')).toBeNull();
    expect(readFenceWidth('mermaid width=12.5')).toBeNull();
    expect(readFenceWidth('mermaid width=0')).toBeNull();
    expect(readFenceWidth('mermaid width=-40')).toBeNull();
  });

  test('U764: width sits anywhere in the meta; the first qualifying token wins; the language word is never a width', () => {
    expect(readFenceWidth('mermaid width=300 theme=dark')).toBe(300);
    expect(readFenceWidth('mermaid theme=dark width=300')).toBe(300);
    expect(readFenceWidth('mermaid theme=dark width=300 title="x"')).toBe(300);
    expect(readFenceWidth('mermaid width=300 width=900')).toBe(300);
    expect(readFenceWidth('width=500')).toBeNull(); // first word is the language
  });

  test('U765: a height= token is never read as a width', () => {
    expect(readFenceWidth('mermaid height=200')).toBeNull();
    expect(readFenceWidth('mermaid height=200 width=300')).toBe(300);
  });
});

describe('PRD 015 Req 2 — surgical rewrite of the opening fence line', () => {
  test('U766: appends " width=N" at the end of the meta when none exists', () => {
    expect(rewriteFenceWidth('```mermaid', 500)).toBe('```mermaid width=500');
    expect(rewriteFenceWidth('```mermaid theme=dark', 500)).toBe('```mermaid theme=dark width=500');
    // Trailing whitespace on the line stays where it was, after the new token.
    expect(rewriteFenceWidth('```mermaid ', 500)).toBe('```mermaid width=500 ');
  });

  test('U767: replaces an existing width in place — first, last, or between other tokens', () => {
    expect(rewriteFenceWidth('```mermaid width=300 theme=dark', 500)).toBe('```mermaid width=500 theme=dark');
    expect(rewriteFenceWidth('```mermaid theme=dark width=300', 500)).toBe('```mermaid theme=dark width=500');
    expect(rewriteFenceWidth('```mermaid theme=dark width=300 title="x"', 500)).toBe(
      '```mermaid theme=dark width=500 title="x"'
    );
    // Replacement always emits lowercase, wherever it sits.
    expect(rewriteFenceWidth('```mermaid Width=300 theme=dark', 500)).toBe('```mermaid width=500 theme=dark');
    // A token whose value the reader rejects is still the width slot: it is
    // overwritten in place, never left beside a second width token.
    expect(rewriteFenceWidth('```mermaid width=500px theme=dark', 500)).toBe('```mermaid width=500 theme=dark');
  });

  test('U768: removal deletes only the token and the single space before it; removing from a widthless line is a no-op', () => {
    expect(rewriteFenceWidth('```mermaid width=300', null)).toBe('```mermaid');
    expect(rewriteFenceWidth('```mermaid width=300 theme=dark', null)).toBe('```mermaid theme=dark');
    expect(rewriteFenceWidth('```mermaid theme=dark width=300', null)).toBe('```mermaid theme=dark');
    // Extra internal spacing outside the deleted single space survives.
    expect(rewriteFenceWidth('```mermaid  width=300 theme=dark', null)).toBe('```mermaid  theme=dark');
    const untouched = '```mermaid theme=dark';
    expect(rewriteFenceWidth(untouched, null)).toBe(untouched);
  });

  test('U769: tilde fences, longer runs, indentation and CRLF endings are preserved verbatim', () => {
    expect(rewriteFenceWidth('~~~mermaid', 500)).toBe('~~~mermaid width=500');
    expect(rewriteFenceWidth('~~~~mermaid width=300', 500)).toBe('~~~~mermaid width=500');
    expect(rewriteFenceWidth('````mermaid', 500)).toBe('````mermaid width=500');
    expect(rewriteFenceWidth('   ```mermaid width=300', null)).toBe('   ```mermaid');
    expect(rewriteFenceWidth(' ```mermaid theme=dark', 500)).toBe(' ```mermaid theme=dark width=500');
    expect(rewriteFenceWidth('```mermaid width=300\r', 500)).toBe('```mermaid width=500\r');
    expect(rewriteFenceWidth('```mermaid\r\n', 500)).toBe('```mermaid width=500\r\n');
  });

  test('U770: a fence with no language word — or a non-fence line — is returned unchanged', () => {
    expect(rewriteFenceWidth('```', 500)).toBe('```');
    expect(rewriteFenceWidth('```   ', 500)).toBe('```   ');
    expect(rewriteFenceWidth('~~~', 500)).toBe('~~~');
    expect(rewriteFenceWidth('plain text', 500)).toBe('plain text');
    expect(rewriteFenceWidth('``not a fence``', 500)).toBe('``not a fence``');
  });

  test('U771: writing the width a line already carries is byte-identical; repeats are idempotent; duplicates collapse to one', () => {
    const carried = '```mermaid width=500 theme=dark';
    expect(rewriteFenceWidth(carried, 500)).toBe(carried);
    expect(rewriteFenceWidth(rewriteFenceWidth('```mermaid', 500), 500)).toBe('```mermaid width=500');
    expect(rewriteFenceWidth('```mermaid width=300 width=900', 500)).toBe('```mermaid width=500');
    expect(rewriteFenceWidth('```mermaid width=300 theme=dark width=900', null)).toBe('```mermaid theme=dark');
  });

  test('U772: a height= token is never written and survives every rewrite verbatim', () => {
    expect(rewriteFenceWidth('```mermaid height=200', 500)).toBe('```mermaid height=200 width=500');
    expect(rewriteFenceWidth('```mermaid height=200 width=300', null)).toBe('```mermaid height=200');
    expect(rewriteFenceWidth('```mermaid height=200 width=300', 500)).toBe('```mermaid height=200 width=500');
  });

  test('U773: an invalid target width (zero, negative, fractional) leaves the line unchanged', () => {
    expect(rewriteFenceWidth('```mermaid', 0)).toBe('```mermaid');
    expect(rewriteFenceWidth('```mermaid width=300', -40)).toBe('```mermaid width=300');
    expect(rewriteFenceWidth('```mermaid', 12.5)).toBe('```mermaid');
  });
});

describe('PRD 015 Req 1 — the token rides the info string after the language word', () => {
  const matrix = [
    '```mermaid',
    '```mermaid theme=dark',
    '```mermaid width=300',
    '```mermaid width=300 theme=dark',
    '```mermaid theme=dark width=300',
    '```mermaid theme=dark width=300 title="x"',
    '~~~mermaid width=300',
    '````mermaid',
    '   ```mermaid width=300',
    '```mermaid width=300\r',
  ];

  // The info string as `fenceLanguage` and `readFenceWidth` are handed it:
  // the opening fence line minus indentation, fence run and line ending.
  const infoOf = (line: string) => line.replace(/^[ \t]*(`{3,}|~{3,})/, '').replace(/[\r\n]+$/, '');

  test('U774: round-trip — read(rewrite(line, N)) === N and read(rewrite(line, null)) === null across the matrix', () => {
    for (const line of matrix) {
      expect(readFenceWidth(infoOf(rewriteFenceWidth(line, 640)))).toBe(640);
      expect(readFenceWidth(infoOf(rewriteFenceWidth(line, null)))).toBeNull();
    }
  });

  test('U775: the language word stays first — fenceLanguage still detects it after every rewrite', () => {
    for (const line of matrix) {
      expect(fenceLanguage(infoOf(rewriteFenceWidth(line, 640)))).toBe('mermaid');
      expect(fenceLanguage(infoOf(rewriteFenceWidth(line, null)))).toBe('mermaid');
    }
  });
});
