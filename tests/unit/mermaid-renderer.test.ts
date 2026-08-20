import { describe, expect, test } from 'vitest';
import { fenceRendererFor } from '../../src/lib/fenceRenderers';
import {
  createMermaidRenderer,
  registerMermaidRenderer,
  type MermaidApi,
  type MermaidLoader,
} from '../../src/lib/mermaidRenderer';

/**
 * PRD 013 Req 4: the mermaid adapter, exercised entirely through an injected
 * loader — the real library never enters the vitest run. Tests that touch the
 * registry restore it (`isolate: false`).
 */

interface FakeMermaid {
  api: MermaidApi;
  loads: number;
  initConfigs: Array<Parameters<MermaidApi['initialize']>[0]>;
  rendered: Array<{ id: string; source: string }>;
}

function fakeMermaid(svg: string | (() => string)): FakeMermaid & { load: MermaidLoader } {
  const fake: FakeMermaid = {
    loads: 0,
    initConfigs: [],
    rendered: [],
    api: {
      initialize(config) {
        fake.initConfigs.push(config);
      },
      async render(id, source) {
        fake.rendered.push({ id, source });
        return { svg: typeof svg === 'string' ? svg : svg() };
      },
    },
  };
  const load: MermaidLoader = async () => {
    fake.loads += 1;
    return fake.api;
  };
  return Object.assign(fake, { load });
}

const light = { theme: 'light' as const };
const dark = { theme: 'dark' as const };

describe('PRD 013 Req 4 mermaid adapter security posture', () => {
  test('U730: mermaid is initialized with startOnLoad false, securityLevel strict, HTML labels off', async () => {
    const fake = fakeMermaid('<svg><text>ok</text></svg>');
    const render = createMermaidRenderer(fake.load);
    await render('graph TD; a-->b', light);
    await render('graph TD; a-->b', dark);
    expect(fake.initConfigs).toHaveLength(2);
    for (const config of fake.initConfigs) {
      expect(config.startOnLoad).toBe(false);
      expect(config.securityLevel).toBe('strict');
      expect(config.flowchart.htmlLabels).toBe(false);
    }
    expect(fake.initConfigs[0].theme).toBe('default');
    expect(fake.initConfigs[1].theme).toBe('dark');
  });

  test('U731: the loader runs lazily on first render and is reused — never at construction or import', async () => {
    const fake = fakeMermaid('<svg/>');
    const render = createMermaidRenderer(fake.load);
    expect(fake.loads).toBe(0);
    await render('graph TD; a-->b', light);
    await render('graph TD; b-->c', light);
    expect(fake.loads).toBe(1);
    expect(fake.rendered).toHaveLength(2);
    // Render ids are unique per call — mermaid requires distinct element ids.
    expect(fake.rendered[0].id).not.toBe(fake.rendered[1].id);
  });

  test('U732: the returned SVG is scrubbed — no script, no handlers, no external reference, no external link', async () => {
    const crafted = [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
      '<script>alert(1)</script>',
      '<script src="https://evil.example/x.js"/>',
      '<a href="https://evil.example/page"><text>label</text></a>',
      "<image xlink:href='//evil.example/img.png'/>",
      '<rect style="fill:url(https://evil.example/f.svg#p)"/>',
      '<circle fill="url(#localGradient)" onclick="alert(2)"/>',
      '<use href="#localNode"/>',
      '</svg>',
    ].join('');
    const fake = fakeMermaid(crafted);
    const render = createMermaidRenderer(fake.load);
    const result = await render('graph TD; a-->b', light);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nothing executable or external survives…
    expect(result.svg).not.toMatch(/<script/i);
    expect(result.svg).not.toMatch(/on(load|click)/i);
    expect(result.svg).not.toMatch(/https?:\/\//i);
    expect(result.svg).not.toMatch(/['"]\s*\/\//);
    expect(result.svg).not.toContain('evil.example');
    // …while local references and the link's visible content survive.
    expect(result.svg).toContain('url(#localGradient)');
    expect(result.svg).toContain('href="#localNode"');
    expect(result.svg).toContain('<text>label</text>');
  });

  test('U733: malformed diagram source resolves to the failure variant carrying the message — never a rejection', async () => {
    const fake = fakeMermaid(() => {
      throw new Error('Parse error on line 2');
    });
    const render = createMermaidRenderer(fake.load);
    const result = await render('graph TD; a-->', light);
    expect(result).toEqual({ ok: false, message: 'Parse error on line 2' });
    // A bad diagram says nothing about the library, which stays loaded.
    await render('graph TD; b-->', light);
    expect(fake.loads).toBe(1);
  });

  test('U734: a failing loader resolves to the failure variant, and a later render retries the load', async () => {
    let attempts = 0;
    const good = fakeMermaid('<svg><text>ok</text></svg>');
    const flaky: MermaidLoader = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('chunk load failed');
      return good.api;
    };
    const render = createMermaidRenderer(flaky);
    const first = await render('graph TD; a-->b', light);
    expect(first).toEqual({ ok: false, message: 'chunk load failed' });
    const second = await render('graph TD; a-->b', light);
    expect(second.ok).toBe(true);
    expect(attempts).toBe(2);
  });
});

describe('PRD 013 Req 1 mermaid registration', () => {
  test('U735: registerMermaidRenderer is the v1 registration, found through the normalized seam lookup', () => {
    expect(fenceRendererFor('mermaid')).toBeUndefined();
    const restore = registerMermaidRenderer();
    try {
      expect(fenceRendererFor('mermaid')).toBeDefined();
      expect(fenceRendererFor('Mermaid')).toBeDefined();
      expect(fenceRendererFor('  MERMAID ')).toBeDefined();
    } finally {
      restore();
    }
    expect(fenceRendererFor('mermaid')).toBeUndefined();
  });
});
