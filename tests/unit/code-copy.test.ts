import { describe, expect, test } from 'vitest';
import { codeBlockText } from '../../src/lib/codeCopy';

describe('Issue #122 code-block copy text', () => {
  // Intent: the clipboard carries the block's exact source characters. The
  // rendered fence body ends with the newline its closing delimiter implies —
  // that one, and only that one, is dropped, so a two-line block copies as two
  // lines while the block's own blank lines survive verbatim.
  test('U677: exactly one trailing newline is dropped; interior and leading blanks survive', () => {
    expect(codeBlockText('const a = 1;\nconst b = 2;\n')).toBe('const a = 1;\nconst b = 2;');
    expect(codeBlockText('const a = 1;\nconst b = 2;')).toBe('const a = 1;\nconst b = 2;');
    // The block's own trailing blank line is content: only the fence's newline goes.
    expect(codeBlockText('a\n\n')).toBe('a\n');
    expect(codeBlockText('\nleading blank\n')).toBe('\nleading blank');
    expect(codeBlockText('  indented\n\tand tabbed\n')).toBe('  indented\n\tand tabbed');
    expect(codeBlockText('')).toBe('');
    expect(codeBlockText('\n')).toBe('');
  });
});
