/**
 * PRD 012 Req 6 (issue #300): where the caret rests after a heading
 * navigation — the column of the heading's first TEXT character on its source
 * line, so typing continues in the title rather than in front of the markers.
 *
 * An ATX heading skips its container prefixes (a blockquote's `>`, a list
 * item's bullet — issue #226's nested headings), its indentation, the `#` run
 * and the whitespace after it; a setext heading, whose `line` is the text
 * line, skips only the prefixes and indentation. A bare `##` with no title
 * lands at its end; a line that is not a heading at all (a stale map) lands
 * after its indentation, never mid-word.
 *
 * PRD 021 Req 5: pure and app-free — a line's text in, a column out.
 */

/**
 * Everything in front of a heading's text, in three parts:
 *   `(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])(?=[ \t]|$))*`  container prefixes, nesting
 *   `[ \t]*`                                          the indentation
 *   `(?:#{1,6}(?:[ \t]+|$))?`                         the `#` run and its space
 * The last part is OPTIONAL and demands whitespace (or the line's end) after
 * the run, so a setext text line, `#hashtag` and a seven-`#` paragraph all
 * fall through it and stop at the indentation.
 */
const HEADING_TEXT_START = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])(?=[ \t]|$))*[ \t]*(?:#{1,6}(?:[ \t]+|$))?/;

/** The column of the first text character of the heading on `lineText`. */
export function headingTextColumn(lineText: string): number {
  return HEADING_TEXT_START.exec(lineText)?.[0].length ?? 0;
}
