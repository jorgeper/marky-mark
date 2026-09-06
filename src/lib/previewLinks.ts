/**
 * SPEC11 §4 (issue #268): what a click on a link in the RENDERED document
 * does, as one pure decision — the classifier's kind resolved against the
 * document's heading anchors, so both preview surfaces and the editor's
 * open-link hand-off share a single answer instead of three call sites each
 * doing half of it.
 *
 * The two halves are both borrowed, never re-implemented: `classifyManagedLink`
 * (SPEC11 §4, amended by SPEC43 §11) decides external / anchor / inert and
 * percent-decodes the fragment, and the anchor table is the PRD 020 Req 18
 * `headingAnchors` list — the SAME GitHub-style slugs the copy-link
 * affordance, a shared heading URL and the TOC already agree on. There is no
 * second slugifier here, and slugs are never scraped from the DOM.
 */
import { classifyManagedLink } from './managedLinks';
import type { HeadingAnchor } from './shareLinks';

export type PreviewLinkAction =
  /** SPEC11 §4.2: hand the URL to the platform's external opener. */
  | { kind: 'external'; url: string }
  /** SPEC11 §4.1: scroll to this 1-based source line, locally. */
  | { kind: 'heading'; line: number }
  /** PRD 020 Req 19: a fragment no heading answers — the graceful miss. */
  | { kind: 'miss' }
  /** Every other href: no hand-off, no navigation, no error. */
  | { kind: 'inert' };

export function previewLinkAction(href: string, anchors: HeadingAnchor[]): PreviewLinkAction {
  const link = classifyManagedLink(href);
  if (link.kind === 'external') return { kind: 'external', url: link.url };
  if (link.kind === 'inert') return { kind: 'inert' };
  // Duplicate titles dedupe in `headingAnchors` (`#setup`, `#setup-1`, …), so
  // the first exact slug match IS that occurrence's own line.
  const hit = anchors.find((a) => a.slug === link.id);
  return hit === undefined ? { kind: 'miss' } : { kind: 'heading', line: hit.line };
}
