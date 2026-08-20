/**
 * PRD 013 Req 1: the fence-renderer seam — a registry mapping a fence language
 * tag to a renderer. Consumers (the preview pipeline, the edit-pane widget
 * layer) look a tag up here; a fence language with no registration renders
 * exactly as today's rehype-highlight code block. Registering a new language
 * is a call to `registerFenceRenderer`, never a change to consuming code, and
 * this module names no concrete language: adapters register themselves.
 *
 * Importing this module does nothing — no renderer load, no timer, no
 * listener, no DOM touch, no network (the `llmSeam.ts` PRD 011 Req 16
 * property, restated for this seam). Work starts only when a caller invokes a
 * renderer it looked up.
 *
 * PRD 013 Req 4: what a renderer returns is injected as a **post-sanitize**
 * DOM enhancement, equivalent in trust posture to the existing image widgets
 * (`src/components/imageView.ts`, SPEC41) — which is why the sanitize schema
 * in `lib/markdown.ts` does not widen for diagrams. PRD 013 Req 3: rendering
 * must not perturb the comment-anchor coordinate space that `lib/markdown.ts`
 * defines — the same reason `lib/codeCopy.ts` grafts its button onto the live
 * preview instead of into the pipeline, injection happens after the rendered
 * plain text that anchors are offsets into already exists.
 */

/**
 * PRD 013 Req 10: success or a typed failure, never a throw. Failure carries a
 * human-readable message so a consumer can keep showing the code block and
 * say why the diagram did not draw.
 */
export type FenceRenderResult =
  | { ok: true; svg: string }
  | { ok: false; message: string };

/** What a renderer may care about beyond the source; plain data only. */
export interface FenceRenderOptions {
  /** PRD 013 Req 9: the app's active theme side, for theme-matched output. */
  theme: 'light' | 'dark';
}

/**
 * PRD 013 Req 1: the renderer contract. Asynchronous — the entry point is
 * what lets an implementation load its library lazily (issue #161) — and
 * failure-typed: a renderer resolves the failure variant for bad diagram
 * source, it never rejects or throws for it.
 */
export type FenceRenderer = (
  source: string,
  options: FenceRenderOptions,
) => Promise<FenceRenderResult>;

const renderers = new Map<string, FenceRenderer>();

/** Trimmed and lower-cased, so ```Lang and ```lang resolve alike. */
function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * PRD 013 Req 1: register `renderer` under a fence language tag. Returns a
 * restore function that puts back whatever the tag mapped to before — unit
 * tests run with `isolate: false` (vitest.config.ts), so a test that mutates
 * this registry must undo it.
 */
export function registerFenceRenderer(tag: string, renderer: FenceRenderer): () => void {
  const key = normalizeTag(tag);
  const previous = renderers.get(key);
  renderers.set(key, renderer);
  return () => {
    if (previous) renderers.set(key, previous);
    else renderers.delete(key);
  };
}

/**
 * PRD 013 Req 1: the lookup consumers call — the renderer registered for the
 * normalized tag, or `undefined`, which means "render as today's code block".
 */
export function fenceRendererFor(tag: string | null | undefined): FenceRenderer | undefined {
  if (tag == null) return undefined;
  const key = normalizeTag(tag);
  return key ? renderers.get(key) : undefined;
}

/**
 * PRD 013 Req 1: the fence-language reader, over both shapes consumers
 * actually hold: an mdast/hast code node's `lang`/info string ("lang", or
 * "lang meta…"), and a rendered `<code>` element's `class` value — the
 * pipeline runs rehype-highlight with `{ detect: false }`, so an unregistered
 * fence arrives as `class="language-<tag>"` (possibly among other classes).
 * Returns the normalized tag, or null when there is no language at all.
 */
export function fenceLanguage(value: string | null | undefined): string | null {
  if (value == null) return null;
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('language-')) {
      const tag = normalizeTag(lower.slice('language-'.length));
      return tag || null;
    }
  }
  // An info string: the language is its first word, the rest is meta.
  return normalizeTag(tokens[0]) || null;
}
