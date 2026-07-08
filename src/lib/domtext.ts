/**
 * Utilities that map between the rendered DOM and the plain-text coordinate
 * space used by anchors (see ARCHITECTURE.md). The plain text of the document
 * is the concatenation of every text node under the document root, in tree
 * order — exactly what `Range.prototype.toString()` yields.
 * Ported from ../md-with-comments.
 */

/** Concatenated text of all text nodes under root, in document order. */
export function getDocText(root: Node): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  let n: Node | null;
  while ((n = walker.nextNode())) out += n.nodeValue ?? '';
  return out;
}

/** Convert a live Range's boundaries into plain-text offsets under root. */
export function rangeToOffsets(root: HTMLElement, range: Range): { start: number; end: number } {
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  pre.setEnd(range.endContainer, range.endOffset);
  const end = pre.toString().length;
  return { start, end };
}

/** Build a Range covering plain-text offsets [start, end) under root. */
export function offsetsToRange(root: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let startSet = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = (node.nodeValue ?? '').length;
    if (!startSet && acc + len >= start && (acc + len > start || len > 0)) {
      if (acc + len >= start && start >= acc) {
        range.setStart(node, start - acc);
        startSet = true;
      }
    }
    if (startSet && acc + len >= end && end >= acc) {
      range.setEnd(node, Math.max(0, end - acc));
      return range;
    }
    acc += len;
  }
  return startSet ? range : null;
}

/** Bounding rect for a plain-text offset range, or null if unmappable. */
export function rectForOffsets(root: HTMLElement, start: number, end: number): DOMRect | null {
  const range = offsetsToRange(root, start, end);
  return range ? range.getBoundingClientRect() : null;
}

/**
 * Wrap the plain-text range [start, end) in <mark class="hl" data-cid=...>
 * elements, splitting text nodes at the boundaries. A range spanning several
 * block elements produces one mark per intersected text node. Whitespace-only
 * segments (e.g. formatting newlines between blocks) are left unwrapped.
 * The document's plain text is unchanged by this operation.
 */
export function highlightRange(root: HTMLElement, start: number, end: number, cid: string): HTMLElement[] {
  const segments: Array<{ node: Text; s: number; e: number }> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const len = text.data.length;
    const s = Math.max(0, start - acc);
    const e = Math.min(len, end - acc);
    if (s < e) segments.push({ node: text, s, e });
    acc += len;
    if (acc >= end) break;
  }

  const marks: HTMLElement[] = [];
  for (const seg of segments) {
    let target = seg.node;
    if (seg.s > 0) target = target.splitText(seg.s);
    if (seg.e - seg.s < target.data.length) target.splitText(seg.e - seg.s);
    if (target.data.trim() === '') continue;
    const mark = document.createElement('mark');
    mark.className = 'hl';
    mark.dataset.cid = cid;
    target.parentNode?.replaceChild(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  }
  return marks;
}
