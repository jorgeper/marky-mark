import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';

/**
 * The rendering pipeline is intentionally identical to ../md-with-comments
 * (remark-parse → gfm → rehype → sanitize → stringify): comment anchors are
 * offsets into the *rendered plain text*, so sharing the pipeline keeps
 * sidecar files interoperable between the two apps. rehype-highlight runs
 * after sanitize; it only wraps existing code text in spans and never alters
 * the text content, so it does not perturb the anchor coordinate space.
 */

// GitHub-style sanitize schema, extended to keep task-list checkboxes.
// SPEC11 §1: image sources are local-only — absolute URLs must be data:/blob:/
// asset: (http/https removed from the default schema), and the pre-sanitize
// plugin below has already swapped remote images for inert placeholders.
const schema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'input'],
  attributes: {
    ...defaultSchema.attributes,
    // SPEC15 §2.2: the one attribute scroll sync needs — inert data, no URL
    // or script surface. Nothing else widens.
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataMmLine'],
    input: ['type', 'checked', 'disabled'],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'mm-blocked-remote']],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['data', 'blob', 'asset'],
  },
};

const REMOTE_SRC = /^(?:https?:)?\/\//i;

/** Hostname for the placeholder label; tolerant of unparsable URLs. */
function remoteHost(src: string): string {
  try {
    return new URL(src.startsWith('//') ? `https:${src}` : src).hostname || 'remote host';
  } catch {
    return 'remote host';
  }
}

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

/**
 * SPEC11 §1 (fixes assessment N1): runs before sanitize. Every image whose
 * src is remote (http:, https:, or protocol-relative) is replaced by an inert
 * placeholder naming the blocked origin — the DOM never contains a remote
 * URL, so nothing can be fetched. Unconditional: there is no setting to turn
 * remote images back on.
 */
function blockRemoteImages() {
  const visit = (node: HastNode) => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type === 'element' && child.tagName === 'img') {
        const src = String(child.properties?.src ?? '');
        if (REMOTE_SRC.test(src)) {
          const alt = String(child.properties?.alt ?? '').trim();
          return {
            type: 'element',
            tagName: 'span',
            properties: { className: ['mm-blocked-remote'] },
            children: [
              {
                type: 'text',
                value: `🚫 remote image (${remoteHost(src)}${alt ? `: “${alt}”` : ''}) — Marky Mark is local-only`,
              },
            ],
          } satisfies HastNode;
        }
      }
      visit(child);
      return child;
    });
  };
  return (tree: HastNode) => visit(tree);
}

interface Positioned {
  position?: { start?: { line?: number } };
}

/**
 * SPEC15 §2: stamp top-level block elements with their markdown source start
 * line (1-based) so the split view can block-anchor its scroll sync. Only
 * direct children of the root are stamped; nodes without position data are
 * left alone (sync interpolates across gaps). Attributes only — the rendered
 * text is untouched, so the comment-anchor coordinate space is unchanged.
 */
function stampSourceLines() {
  return (tree: HastNode) => {
    for (const child of tree.children ?? []) {
      const line = (child as Positioned).position?.start?.line;
      if (child.type === 'element' && typeof line === 'number') {
        child.properties = { ...child.properties, dataMmLine: line };
      }
    }
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(stampSourceLines)
  .use(blockRemoteImages)
  .use(rehypeSanitize, schema)
  .use(rehypeHighlight, { detect: false })
  .use(rehypeStringify);

/** Render markdown to sanitized HTML (GFM: tables, task lists, strikethrough). */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}
