/**
 * Issue #42: the single dirty predicate.
 *
 * Every "has this document changed?" comparison in the app funnels through
 * isDirtyText so the sites can never disagree. Line endings are
 * representation, not content: CodeMirror's doc.toString() joins lines with
 * '\n', so a CRLF file that round-trips through the editor differs
 * byte-wise while being logically identical. Table-mode canonicalization
 * (SPEC38 §3.5) stays at the call sites — collapsing grids needs the live
 * editor state, which this pure module must not touch.
 */

/** Issue #42: CRLF and lone-CR both read as LF — representation only. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Issue #42: true when `buffer` and `savedText` differ by more than
 * line-ending representation. Callers pass CANONICAL buffer text (grids
 * collapsed) whenever table mode may be showing.
 */
export function isDirtyText(buffer: string, savedText: string): boolean {
  return normalizeEol(buffer) !== normalizeEol(savedText);
}
