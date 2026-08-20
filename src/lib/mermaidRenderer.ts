/**
 * PRD 013 Req 4: the mermaid adapter behind the fence-renderer seam
 * (`fenceRenderers.ts`), and mermaid's v1 registration. Mermaid runs at its
 * strictest posture — `startOnLoad: false`, `securityLevel: 'strict'`, HTML
 * labels off — and every SVG leaving here is scrubbed: no `<script>`, no
 * event-handler attribute, no external resource reference (`http://`,
 * `https://`, protocol-relative `//`), no externally clickable link. The
 * adapter performs no network access of its own.
 *
 * PRD 013 Req 7: mermaid loads through a dynamic `import('mermaid')` on the
 * first render call — never at module scope — so importing this module does
 * nothing and a session that never meets a mermaid fence never pays for the
 * library. The loader is injectable so unit tests exercise the adapter
 * without pulling the real library into the vitest run.
 */

import { registerFenceRenderer, type FenceRenderer, type FenceRenderResult } from './fenceRenderers';

/**
 * The slice of mermaid's API the adapter touches; tests fake exactly this.
 * The config members are literal types, not `boolean`/`string`: PRD 013 Req 4's
 * posture is then the only config this interface can express, so a regression
 * to `securityLevel: 'loose'` or HTML labels fails the typecheck as well as
 * the unit tests. The real `Mermaid` object satisfies this shape structurally,
 * so `loadMermaid` needs no cast.
 */
export interface MermaidApi {
  initialize(config: {
    startOnLoad: false;
    securityLevel: 'strict';
    theme: 'default' | 'dark';
    flowchart: { htmlLabels: false };
  }): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

/** PRD 013 Req 7: how the adapter obtains mermaid — injected in tests. */
export type MermaidLoader = () => Promise<MermaidApi>;

// PRD 013 Req 7: the real loader is the lazy chunk boundary — the only
// `import('mermaid')` in the app, evaluated on first render, never at import.
const loadMermaid: MermaidLoader = async () => {
  const mod = await import('mermaid');
  return mod.default;
};

/**
 * PRD 013 Req 4 + Req 10: build a `FenceRenderer` over `load`. The returned
 * renderer never rejects or throws: malformed diagram source (or a loader
 * that fails) resolves to the failure variant carrying the underlying
 * message, so a consumer keeps showing the code block. The library is loaded
 * once and reused across renders.
 */
export function createMermaidRenderer(load: MermaidLoader = loadMermaid): FenceRenderer {
  let api: Promise<MermaidApi> | undefined;
  let nextId = 0;
  return async (source, options): Promise<FenceRenderResult> => {
    let mermaid: MermaidApi;
    try {
      api ??= load();
      mermaid = await api;
    } catch (error) {
      // Drop the rejected promise: a failed load must not poison every later
      // render with a stale rejection, so the next call retries the load.
      api = undefined;
      return { ok: false, message: errorMessage(error) };
    }
    try {
      // PRD 013 Req 4: strictest security level, no auto-start, no HTML
      // labels. Re-initialized per render so a theme change (Req 9) takes
      // effect on the next diagram without extra plumbing.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: options.theme === 'dark' ? 'dark' : 'default',
        flowchart: { htmlLabels: false },
      });
      const { svg } = await mermaid.render(`mm-diagram-${nextId++}`, source);
      return { ok: true, svg: scrubDiagramSvg(svg) };
    } catch (error) {
      // PRD 013 Req 10: bad diagram source is a typed failure, not a throw —
      // and it says nothing about the library, which stays loaded.
      return { ok: false, message: errorMessage(error) };
    }
  };
}

/**
 * PRD 013 Req 1: mermaid's registration site — the only place the tag meets
 * the registry. Returns the registry's restore function.
 */
export function registerMermaidRenderer(): () => void {
  return registerFenceRenderer('mermaid', createMermaidRenderer());
}

/**
 * PRD 013 Req 4: belt-and-braces scrub over the SVG string mermaid returned,
 * so the guarantee holds even against a mermaid regression. Removes script
 * elements, event-handler attributes, any attribute whose value is an
 * external or `javascript:` URL, and external `url(…)` references in inline
 * CSS. Local references (`url(#gradient)`, `href="#node"`) survive. Removing
 * an `<a>`'s href neutralizes the link without disturbing its children.
 * `xmlns` declarations fall to the external-URL rule too — the SVG is
 * injected inline into the HTML DOM, which needs no namespace declaration —
 * so the output carries no `http(s)://` or protocol-relative `//` reference
 * at all.
 */
function scrubDiagramSvg(svg: string): string {
  return (
    svg
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<script\b[^>]*\/?>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
      .replace(/\s+[\w:-]+\s*=\s*"\s*(?:(?:https?:)?\/\/|javascript:)[^"]*"/gi, '')
      .replace(/\s+[\w:-]+\s*=\s*'\s*(?:(?:https?:)?\/\/|javascript:)[^']*'/gi, '')
      .replace(/url\(\s*(?:"|')?\s*(?:https?:)?\/\/[^)]*\)/gi, 'none')
  );
}

/** The underlying failure as a short human-readable string. */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Diagram could not be rendered.';
}
