import { describe, expect, it, beforeEach } from 'vitest';
import {
  CODE_HIGHLIGHT_BUDGET,
  clearCodeHighlightCache,
  codeHighlightSlice,
  flattenHighlight,
  highlightCode,
  highlightCodeCached,
  resolveFenceLanguage,
} from '../src/lib/codeHighlight';

/**
 * The nested-parser predicate `Editor.tsx` passes in: issue #122's
 * `CODE_LANGUAGES` matched the way `markdown({ codeLanguages })` matches an
 * info string — fuzzily, which is why `scss` lands on the CSS grammar.
 */
const NATIVE = ['javascript', 'js', 'jsx', 'ts', 'tsx', 'typescript', 'node', 'css', 'scss', 'html', 'htm', 'xhtml'];
const isNative = (name: string) => NATIVE.includes(name);

/** Line bounds over a plain string, the shape CodeMirror's `doc.lineAt` has. */
function lineBoundsOf(text: string) {
  return (pos: number) => {
    const from = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    const nl = text.indexOf('\n', pos);
    return { from, to: nl === -1 ? text.length : nl };
  };
}

/** Every class a token run carries, for the code text it covers. */
function tokensOf(lang: string, code: string): Array<[string, string]> {
  return highlightCode(lang, code).map((t) => [code.slice(t.from, t.to), t.cls]);
}

describe('SPEC23 §3 (issue #269) editor fenced-code highlighting', () => {
  beforeEach(() => clearCodeHighlightCache());

  it('U1169: resolves the common preview languages, and only their first info word', () => {
    for (const lang of [
      'arduino', 'bash', 'c', 'cpp', 'csharp', 'diff', 'go', 'graphql', 'ini',
      'java', 'json', 'kotlin', 'less', 'lua', 'makefile', 'markdown',
      'objectivec', 'perl', 'php', 'plaintext', 'python', 'r', 'ruby', 'rust',
      'shell', 'sql', 'swift', 'vbnet', 'wasm', 'xml', 'yaml',
    ]) {
      expect(resolveFenceLanguage(lang, isNative), lang).toBe(lang);
    }
    // A registered alias is a grammar name lowlight answers to, so it comes
    // back as written; meta after the tag, case and padding are all ignored.
    expect(resolveFenceLanguage('py', isNative)).toBe('py');
    expect(resolveFenceLanguage('python {1,3}', isNative)).toBe('python');
    expect(resolveFenceLanguage('  YAML  ', isNative)).toBe('yaml');
  });

  it('U1170: an absent, empty, bogus or natively-parsed info string stays plain', () => {
    expect(resolveFenceLanguage(undefined, isNative)).toBeNull();
    expect(resolveFenceLanguage(null, isNative)).toBeNull();
    expect(resolveFenceLanguage('', isNative)).toBeNull();
    expect(resolveFenceLanguage('   ', isNative)).toBeNull();
    expect(resolveFenceLanguage('notalang', isNative)).toBeNull();
    // Issue #122's nested CodeMirror parsers already colour these — lowlight
    // must stay off them so no span is painted twice, even where lowlight has
    // a grammar of its own for the tag (`scss`, `xhtml`).
    for (const lang of NATIVE) expect(resolveFenceLanguage(lang, isNative), lang).toBeNull();
    expect(highlightCode('notalang', 'x = 1')).toEqual([]);
    expect(highlightCode('python', '')).toEqual([]);
  });

  it('U1171: tokens carry only the eight mm-code-* classes, in document order', () => {
    const EIGHT = new Set([
      'mm-code-keyword', 'mm-code-string', 'mm-code-comment', 'mm-code-number',
      'mm-code-title', 'mm-code-attr', 'mm-code-literal', 'mm-code-meta',
    ]);
    const samples: Array<[string, string]> = [
      ['python', 'def f(x):\n    # hi\n    return "a" + 1\n'],
      ['bash', '# build\nexport A=1\nls -la "$A"\n'],
      ['json', '{"a": 1, "b": null}\n'],
      ['yaml', '# c\nkey: value\nn: 12\n'],
      ['rust', 'fn main() { let x = 1; }\n'],
      ['go', 'package main\nfunc main() {}\n'],
      ['java', 'class A { void b() { int c = 1; } }\n'],
      ['sql', 'SELECT * FROM t WHERE a = 1;\n'],
      ['c', '#include <stdio.h>\nint main(void) { return 0; }\n'],
      ['cpp', '// c\nint main() { return 42; }\n'],
    ];
    for (const [lang, code] of samples) {
      const tokens = highlightCode(lang, code);
      expect(tokens.length, lang).toBeGreaterThan(0);
      let prev = 0;
      for (const t of tokens) {
        expect(EIGHT.has(t.cls), `${lang}: ${t.cls}`).toBe(true);
        expect(t.from, lang).toBeGreaterThanOrEqual(prev); // sorted, non-overlapping
        expect(t.to, lang).toBeGreaterThan(t.from);
        expect(t.to, lang).toBeLessThanOrEqual(code.length);
        prev = t.to;
      }
    }
  });

  it('U1172: offsets land on the right text — python keywords, comment, string, number', () => {
    const pairs = tokensOf('python', 'def f(x):\n    # hi\n    return "a" + 1\n');
    expect(pairs).toContainEqual(['def', 'mm-code-keyword']);
    expect(pairs).toContainEqual(['f', 'mm-code-title']);
    expect(pairs).toContainEqual(['# hi', 'mm-code-comment']);
    expect(pairs).toContainEqual(['return', 'mm-code-keyword']);
    expect(pairs).toContainEqual(['"a"', 'mm-code-string']);
    expect(pairs).toContainEqual(['1', 'mm-code-number']);
  });

  it('U1166: nested hljs scopes take the innermost mapped class, and text advances offsets', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'text', value: 'ab' },
        {
          type: 'element',
          properties: { className: ['hljs-function'] },
          children: [
            { type: 'text', value: 'c' },
            {
              type: 'element',
              properties: { className: ['hljs-title', 'function_'] },
              children: [{ type: 'text', value: 'de' }],
            },
          ],
        },
        // An unmapped scope contributes no range at all.
        {
          type: 'element',
          properties: { className: ['hljs-punctuation'] },
          children: [{ type: 'text', value: 'fg' }],
        },
      ],
    };
    expect(flattenHighlight(tree)).toEqual([{ from: 3, to: 5, cls: 'mm-code-title' }]);
  });

  it('U1167: the slice is the whole body under budget, and viewport-clamped past it', () => {
    const text = 'aaa\nbbb\nccc\nddd\neee\n';
    const lineBounds = lineBoundsOf(text);
    const body = { from: 0, to: 20 };
    // Under budget: the whole body, so multi-line grammar state stays right.
    expect(codeHighlightSlice(body, { from: 8, to: 12 }, lineBounds)).toEqual(body);
    // Past budget: clamped to the viewport, snapped outwards to whole lines.
    expect(codeHighlightSlice(body, { from: 9, to: 10 }, lineBounds, 4)).toEqual({ from: 8, to: 11 });
    // Off-screen bodies and empty bodies produce nothing.
    expect(codeHighlightSlice(body, { from: 40, to: 60 }, lineBounds)).toBeNull();
    expect(codeHighlightSlice({ from: 5, to: 5 }, { from: 0, to: 20 }, lineBounds)).toBeNull();
    expect(CODE_HIGHLIGHT_BUDGET).toBeGreaterThan(1000);
  });

  it('U1168: the memo returns the identical token list for a repeated slice', () => {
    const code = 'def f():\n    return 1\n';
    const first = highlightCodeCached('python', code);
    expect(highlightCodeCached('python', code)).toBe(first);
    expect(highlightCodeCached('python', code + 'x = 2\n')).not.toBe(first);
    clearCodeHighlightCache();
    expect(highlightCodeCached('python', code)).not.toBe(first);
  });
});
