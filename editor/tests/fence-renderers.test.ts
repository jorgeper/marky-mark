import { describe, expect, test } from 'vitest';
import {
  fenceLanguage,
  fenceRendererFor,
  registerFenceRenderer,
  renderSafely,
  type FenceRenderer,
  type FenceRenderResult,
} from '../src/lib/fenceRenderers';

/**
 * PRD 013 Req 1: the fence-renderer seam's pure logic — registration, the
 * normalized lookup, and the fence-language reader. Every test that registers
 * something restores the registry via the function `registerFenceRenderer`
 * returns: the suite runs `isolate: false`, so a leaked registration would
 * poison other files.
 */

const okRenderer =
  (svg: string): FenceRenderer =>
  async () => ({ ok: true, svg });

const options = { theme: 'light' as const };

describe('PRD 013 Req 1 fence-renderer registry', () => {
  test('U723: lookup returns the renderer registered under a tag, and misses resolve to undefined', () => {
    const restore = registerFenceRenderer('fakegraph', okRenderer('<svg/>'));
    try {
      expect(fenceRendererFor('fakegraph')).toBeDefined();
      expect(fenceRendererFor('unregistered-lang')).toBeUndefined();
      expect(fenceRendererFor(null)).toBeUndefined();
      expect(fenceRendererFor(undefined)).toBeUndefined();
      expect(fenceRendererFor('')).toBeUndefined();
    } finally {
      restore();
    }
    expect(fenceRendererFor('fakegraph')).toBeUndefined();
  });

  test('U724: lookup is normalized — trimmed and case-insensitive on both sides', () => {
    const renderer = okRenderer('<svg/>');
    const restore = registerFenceRenderer('  FakeGraph ', renderer);
    try {
      expect(fenceRendererFor('fakegraph')).toBe(renderer);
      expect(fenceRendererFor('FAKEGRAPH')).toBe(renderer);
      expect(fenceRendererFor('  FakeGraph\t')).toBe(renderer);
    } finally {
      restore();
    }
  });

  test('U725: a second language registers and resolves through the same lookup — no consuming-pipeline change', () => {
    const first = okRenderer('<svg>1</svg>');
    const second = okRenderer('<svg>2</svg>');
    const restoreFirst = registerFenceRenderer('fakegraph', first);
    const restoreSecond = registerFenceRenderer('otherlang', second);
    try {
      expect(fenceRendererFor('fakegraph')).toBe(first);
      expect(fenceRendererFor('OtherLang')).toBe(second);
    } finally {
      restoreSecond();
      restoreFirst();
    }
    expect(fenceRendererFor('otherlang')).toBeUndefined();
  });

  test('U726: restore puts back the renderer a registration shadowed', () => {
    const original = okRenderer('<svg>orig</svg>');
    const override = okRenderer('<svg>override</svg>');
    const restoreOriginal = registerFenceRenderer('fakegraph', original);
    const restoreOverride = registerFenceRenderer('fakegraph', override);
    try {
      expect(fenceRendererFor('fakegraph')).toBe(override);
      restoreOverride();
      expect(fenceRendererFor('fakegraph')).toBe(original);
    } finally {
      restoreOriginal();
    }
  });

  test('U727: fence language reads from an mdast/hast info string — first word, normalized', () => {
    expect(fenceLanguage('fakegraph')).toBe('fakegraph');
    expect(fenceLanguage('FakeGraph')).toBe('fakegraph');
    expect(fenceLanguage('  fakegraph  title="x" ')).toBe('fakegraph');
    expect(fenceLanguage(null)).toBeNull();
    expect(fenceLanguage(undefined)).toBeNull();
    expect(fenceLanguage('')).toBeNull();
    expect(fenceLanguage('   ')).toBeNull();
  });

  test('U728: fence language reads from a language-* class value, among other classes', () => {
    // rehype-highlight with { detect: false } emits class="language-<tag>".
    expect(fenceLanguage('language-fakegraph')).toBe('fakegraph');
    expect(fenceLanguage('language-FakeGraph')).toBe('fakegraph');
    expect(fenceLanguage('hljs language-fakegraph')).toBe('fakegraph');
    expect(fenceLanguage('language-')).toBeNull();
  });

  test('U729: the error-fallback result shape — a failing renderer resolves the failure variant, never rejects', async () => {
    const failing: FenceRenderer = async () => ({ ok: false, message: 'bad diagram source' });
    const restore = registerFenceRenderer('fakegraph', failing);
    try {
      const renderer = fenceRendererFor('fakegraph');
      expect(renderer).toBeDefined();
      const result: FenceRenderResult = await renderer!('nonsense', options);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toBe('bad diagram source');
      // The success variant, for contrast: the discriminant selects `svg`.
      const success = await okRenderer('<svg/>')('a --> b', options);
      expect(success).toEqual({ ok: true, svg: '<svg/>' });
    } finally {
      restore();
    }
  });

  test('U759: renderSafely passes results through and turns a contract-breaking throw into the typed failure', async () => {
    // A well-behaved renderer's result crosses untouched, both variants.
    expect(await renderSafely(okRenderer('<svg/>'), 'a --> b', options)).toEqual({
      ok: true,
      svg: '<svg/>',
    });
    const failing: FenceRenderer = async () => ({ ok: false, message: 'bad diagram source' });
    expect(await renderSafely(failing, 'x', options)).toEqual({
      ok: false,
      message: 'bad diagram source',
    });
    // PRD 013 Req 10: a rejection lands as the failure shape — its message
    // when it has one, the generic fallback otherwise — never a throw.
    const throwing: FenceRenderer = async () => {
      throw new Error('renderer exploded');
    };
    expect(await renderSafely(throwing, 'x', options)).toEqual({
      ok: false,
      message: 'renderer exploded',
    });
    const messageless: FenceRenderer = async () => {
      throw 'not-an-error';
    };
    const fallback = await renderSafely(messageless, 'x', options);
    expect(fallback.ok).toBe(false);
    if (!fallback.ok) expect(fallback.message).toBe('Diagram could not be rendered.');
  });
});
