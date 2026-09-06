/**
 * SPEC11 §4, amended by SPEC43 §11 (issue #270): the managed-link rule as ONE
 * pure classifier, so the preview pane's click handler and the editor's
 * open-link hand-off can never drift. `http(s)` hands off to the platform's
 * external opener; a `#anchor` jumps to that heading in the rendered
 * document; ANY other href is inert.
 *
 * Deliberate scope (issue #270's parity contract): the preview does not open
 * relative in-workspace files today (`./other.md` is inert there), so the
 * editor matches it exactly — neither pane opens files from a link. If
 * relative-`.md` navigation is ever wanted, it is a separate issue that must
 * change BOTH surfaces through this one rule.
 */
export type ManagedLink =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'inert' };

export function classifyManagedLink(href: string): ManagedLink {
  if (href.startsWith('#')) {
    // The rendered heading ids are percent-decoded (the preview's rule).
    try {
      return { kind: 'anchor', id: decodeURIComponent(href.slice(1)) };
    } catch {
      return { kind: 'anchor', id: href.slice(1) };
    }
  }
  if (/^https?:\/\//i.test(href)) return { kind: 'external', url: href };
  return { kind: 'inert' };
}
