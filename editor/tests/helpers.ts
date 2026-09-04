/**
 * Shared setup for the editor package's unit suite (the root e2e suite's
 * helpers.ts convention, package-side).
 */

/**
 * The app's comment anchors are offsets into the concatenation of every text
 * node under the root (its domtext.ts getDocText, which stays app-side per
 * PRD 021's non-goals) — replicated here so decoration contracts ("adds no
 * text nodes", "byte-identical text") are asserted against the same
 * coordinate space.
 */
export function getDocText(root: Node): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  let n: Node | null;
  while ((n = walker.nextNode())) out += n.nodeValue ?? '';
  return out;
}
