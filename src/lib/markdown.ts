import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
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
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'input'],
  attributes: {
    ...defaultSchema.attributes,
    input: ['type', 'checked', 'disabled'],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeHighlight, { detect: false })
  .use(rehypeStringify);

/** Render markdown to sanitized HTML (GFM: tables, task lists, strikethrough). */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}
