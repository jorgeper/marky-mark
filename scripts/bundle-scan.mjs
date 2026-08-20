// SPEC11 §6.6 (amended, issue #114; discrimination added, issue #161): the
// counting rule behind the static bundle scan in validate.mjs. A *network
// call site* is a call to the global `fetch` — the one that can leave the
// page. Two shapes that match the naive `\bfetch\s*\(` are NOT network call
// sites and are excluded:
//
//   - a member call on some other object, `foo.fetch(...)` (mermaid pulls in
//     katex, whose parser method is named `fetch` and is called ~27 times per
//     bundle) — but `window.fetch(...)` and its siblings still count, since
//     those receivers ARE the global;
//   - a method *definition*, `fetch(params){…}` (katex's Lexer declares one).
//
// The exclusions are deliberately narrow. A definition is only recognised
// when a paren-balanced parameter list is followed directly by `{` — a shape
// a call expression cannot legally have — and anything the scanner cannot
// classify inside its window still counts, so ambiguity fails the gate
// loudly instead of passing it silently. This module is imported by the unit
// tier too (tests/unit/bundle-scan.test.ts), so the discrimination's
// sensitivity is itself a checked property, not a comment.

/** Receivers that are the global object, so `<receiver>.fetch(` is the global fetch. */
const GLOBAL_RECEIVER = /(?:^|[^\w$])(?:window|globalThis|self)\??\.$/;

/** How far back a receiver is read, and how far forward a parameter list may run. */
const WINDOW = 500;

/**
 * Count the network call sites (calls to the global `fetch`) in bundled JS
 * text. Member calls on other objects and method definitions are excluded
 * (see above).
 */
export function countFetchCallSites(text) {
  let count = 0;
  const re = /\bfetch\s*\(/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - WINDOW), match.index);
    // `foo.fetch(`, `this.fetch(`, `a?.fetch(` — a member call, not the
    // global (`?.` ends in `.`, so testing for a trailing `.` covers both).
    if (before.endsWith('.') && !GLOBAL_RECEIVER.test(before)) continue;
    if (isMethodDefinition(text, match.index + match[0].length - 1)) continue;
    count++;
  }
  return count;
}

/**
 * True when the `(` at `open` closes a parameter list followed directly by
 * `{` — a method/function definition, which valid JS never produces for a
 * call expression. The scan is windowed and counts only parentheses (braces
 * inside default values are fine); text it cannot balance is treated as a
 * call site, so the failure mode is a loud gate failure, not a quiet pass.
 */
function isMethodDefinition(text, open) {
  let depth = 1;
  for (let i = open + 1; i < text.length && i - open < WINDOW; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        return text[j] === '{';
      }
    }
  }
  return false;
}
