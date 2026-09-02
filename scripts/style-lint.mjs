// PRD 018 §E26–§E27: the style lint — the spawn-free checks that keep
// src/styles.css and the TSX chrome on the token/primitive layer this PRD
// introduced. Pure functions over file text, imported by scripts/validate.mjs
// (both tiers) and unit-tested directly (tests/unit/style-lint.test.ts), the
// same split scripts/map.mjs uses for the MAP-freshness gate.
//
// The rules enforced here are exactly the lint-enforced entries of the
// Do / Don't list in docs/STYLE-GUIDE.md (PRD 018 §E29) — change them
// together or the guide-lint agreement breaks.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// PRD 018 §E26: the delimited regions the CSS rules skip. CHROME TOKENS is
// the one token-definition block; DOCUMENT RENDERING marks the document
// (non-chrome) sections — several pairs, exact marker text per Req 17.
const SKIP_MARKERS = [
  { begin: 'CHROME TOKENS — BEGIN', end: 'CHROME TOKENS — END' },
  { begin: 'DOCUMENT RENDERING — BEGIN', end: 'DOCUMENT RENDERING — END' },
];

/** Replace /* … *​/ comments with spaces, preserving every newline so
 * indexes keep mapping to the same line numbers. */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 1-indexed line number of `index` in `text`. */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/** PRD 018 §E26: blank the skipped regions (marker lines inclusive),
 * preserving newlines. Marker text is matched on the raw text — the markers
 * live inside CSS comments, so this must run before comment context is
 * considered. An unclosed region is an error, not a silent skip-to-EOF. */
export function blankSkippedRegions(css) {
  const lines = css.split('\n');
  let inside = null; // the marker pair we are inside, or null
  for (let i = 0; i < lines.length; i++) {
    if (inside === null) {
      inside = SKIP_MARKERS.find((m) => lines[i].includes(m.begin)) ?? null;
      if (inside !== null) lines[i] = '';
    } else {
      const done = lines[i].includes(inside.end);
      lines[i] = '';
      if (done) inside = null;
    }
  }
  if (inside !== null) throw new Error(`style lint: unclosed "${inside.begin}" region in src/styles.css`);
  return lines.join('\n');
}

/** Every custom property declared in the stylesheet (all regions — a token
 * defined inside the chrome block still counts as defined). */
export function cssCustomProps(css) {
  const props = new Set();
  for (const m of stripCssComments(css).matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/g)) props.add(m[1]);
  return props;
}

/** Every --mm-* name THEMES.md mentions (contract + chrome tokens). */
export function themesTokenNames(themesMd) {
  return new Set([...themesMd.matchAll(/--mm-[\w-]+/g)].map((m) => m[0]));
}

/** PRD 018 §E26: the *contract* variables — the required theme contract
 * ("The variable contract" section of THEMES.md), the only names whose
 * var() fallbacks may carry a colour literal (a third-party theme may omit
 * them; each fallback is the documented Crisp default). Chrome tokens are
 * NOT contract: they are defined in styles.css, so fallbacks on them are
 * the disagreeing-fallback bug Req 4 killed. */
export function themesContractVars(themesMd) {
  const section = /## The variable contract([\s\S]*?)\n## /.exec(themesMd)?.[1] ?? '';
  return new Set([...section.matchAll(/--mm-[\w-]+/g)].map((m) => m[0]));
}

/** var( spans with paren matching (fallbacks nest parens: rgba(), calc()).
 * Returns [{ start, end, name }]. */
function varSpans(text) {
  const spans = [];
  for (let i = text.indexOf('var('); i !== -1; i = text.indexOf('var(', i + 1)) {
    let depth = 0;
    let end = i + 3;
    for (let j = i + 3; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) {
        end = j + 1;
        break;
      }
    }
    const name = /^var\(\s*(--[\w-]+)/.exec(text.slice(i, end))?.[1] ?? '';
    spans.push({ start: i, end, name });
  }
  return spans;
}

/** The declaration text from the last `;`/`{`/`}` up to `index` — enough to
 * tell a custom-property definition from a style declaration. */
function declPrefix(text, index) {
  let start = index;
  while (start > 0 && !';{}'.includes(text[start - 1])) start--;
  return text.slice(start, index);
}

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
const SCALE_PROPS = /(?:^|[;{])[ \t\n]*(font-size|border-radius|box-shadow)[ \t]*:([^;}]*)/g;
// Non-literal scale values that need no token: keywords and the zero length.
const SCALE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'none', '0']);
const BARE_ELEMENTS = ['button', 'input', 'select', 'textarea'];

/**
 * PRD 018 §E26: lint the stylesheet text. `contractVars` is the THEMES.md
 * contract set; `definedVars` is cssCustomProps(css) ∪ themesTokenNames.
 * Returns findings [{ line, message }].
 */
export function lintCss(css, { contractVars, definedVars }) {
  const findings = [];
  const text = stripCssComments(blankSkippedRegions(css));
  const spans = varSpans(text);
  const inContractFallback = (i) =>
    spans.some((s) => i > s.start && i < s.end && contractVars.has(s.name));

  // Rule: no colour literal outside a token definition or a contract-variable
  // var() fallback. Custom-property declarations are where literals live
  // (the chrome block plus the declared one-off internal tokens, PRD 018
  // Req 3) — a literal in a *style* declaration is the unthemed bug.
  for (const m of text.matchAll(COLOUR_LITERAL)) {
    if (inContractFallback(m.index)) continue;
    if (/^[ \t\n]*--[\w-]+[ \t]*:/.test(declPrefix(text, m.index))) continue;
    findings.push({
      line: lineOf(text, m.index),
      message: `colour literal \`${m[0].replace('(', '()')}\` in a chrome rule — use a chrome/contract token (only custom-property definitions and contract-variable var() fallbacks may carry one)`,
    });
  }

  // Rule: every var(--mm-…) names a property defined in src/styles.css or
  // listed in THEMES.md (PRD 018 Req 3 — the --mm-bg-elev typo class).
  for (const s of spans) {
    if (s.name.startsWith('--mm-') && !definedVars.has(s.name)) {
      findings.push({
        line: lineOf(text, s.start),
        message: `var(${s.name}) names a property defined nowhere in src/styles.css or THEMES.md`,
      });
    }
  }

  // Rule: no selector ends in a bare descendant ` button` / ` input` /
  // ` select` / ` textarea` (the ancestor-rule pattern the migration
  // deleted). `input.field` (element-qualified class) and `.x > button`
  // (child, not descendant) do not match; a bare element after a descendant
  // combinator does.
  for (const m of text.matchAll(/([^{};]+)\{/g)) {
    const prelude = m[1];
    if (prelude.trimStart().startsWith('@')) continue;
    for (const rawPart of prelude.split(',')) {
      const part = rawPart.trim().replace(/\s+/g, ' ');
      const bare = BARE_ELEMENTS.find((el) =>
        new RegExp(`(?:^|[^>+~\\s]) ${el}$`).test(part)
      );
      if (bare !== undefined) {
        findings.push({
          line: lineOf(text, m.index + m[0].indexOf(rawPart.trimStart()[0] ?? '{')),
          message: `selector \`${part}\` ends in a bare descendant \`${bare}\` — style a primitive class (.btn*, .icon-btn, .field, .menu-item) instead`,
        });
      }
    }
  }

  // Rule: font-size / border-radius / box-shadow in a chrome rule resolves
  // through a token (references some var(--mm-…)) or is a plain keyword —
  // never a literal value (PRD 018 Req 17).
  for (const m of text.matchAll(SCALE_PROPS)) {
    const value = m[2].replace(/!important/g, '').trim();
    if (/var\(\s*--mm-/.test(value) || SCALE_KEYWORDS.has(value)) continue;
    const at = m.index + m[0].indexOf(m[1]);
    findings.push({
      line: lineOf(text, at),
      message: `${m[1]}: ${value || '(empty)'} — chrome rules take this from a scale token, not a literal`,
    });
  }

  return findings;
}

/** Balanced-brace slice starting at src[start] === '{'; quote-aware. */
function braceSlice(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      for (i++; i < src.length && src[i] !== quote; i++) if (src[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

// PRD 018 §E27: the primitive class tokens a raw <button> may carry — the
// .btn family, .icon-btn, and .menu-item (the menu-row primitive; exactly
// what the MenuItem wrapper emits, and how the palette/smart-edit rows
// migrated in issue #204).
function hasPrimitiveButtonClass(classText) {
  const statics = [...classText.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)]
    .map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ' '));
  const source = statics.length > 0 ? statics.join(' ') : classText;
  return source
    .split(/\s+/)
    .some((t) => t === 'btn' || t === 'icon-btn' || t === 'menu-item' || t.startsWith('btn-'));
}

const STYLE_KEYS = ['fontSize', 'color', 'background', 'borderRadius'];

/**
 * PRD 018 §E27: lint one TSX source. Fails on `<button` without a primitive
 * class (files under src/components/ui/ are exempt at the caller) and on
 * inline style={{ … }} objects giving fontSize / color / background /
 * borderRadius a literal value (a number, or a string that is not a var()
 * reference — computed geometry through variables stays allowed).
 */
export function lintTsx(source) {
  const findings = [];
  const text = source;

  for (const m of text.matchAll(/<button\b/g)) {
    // The opening tag: forward to the first '>' outside braces/quotes.
    let tag = '';
    let depth = 0;
    for (let i = m.index; i < text.length; i++) {
      const c = text[i];
      if (c === '"' || c === "'" || c === '`') {
        const quote = c;
        tag += c;
        for (i++; i < text.length && text[i] !== quote; i++) tag += text[i];
        tag += text[i] ?? '';
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') depth--;
      tag += c;
      if (c === '>' && depth === 0) break;
    }
    // No attribute at all ⇒ not an element this codebase writes (every real
    // chrome button carries at least a handler or testid) — it is a
    // `<button>` mention inside a comment. Real tags proceed to the class
    // check.
    if (!tag.includes('=')) continue;
    const cls = /className\s*=\s*/.exec(tag);
    let classText = null;
    if (cls !== null) {
      const rest = tag.slice(cls.index + cls[0].length);
      classText = rest[0] === '{' ? braceSlice(rest, 0) : (/^"([^"]*)"/.exec(rest)?.[1] ?? '');
    }
    if (classText === null || !hasPrimitiveButtonClass(classText)) {
      findings.push({
        line: lineOf(text, m.index),
        message:
          '<button> without a primitive class — use the Button/IconButton/MenuItem wrappers (src/components/ui/) or carry .btn*/.icon-btn/.menu-item',
      });
    }
  }

  for (const m of text.matchAll(/style=\s*\{\{/g)) {
    const object = braceSlice(text, m.index + m[0].length - 2);
    for (const key of STYLE_KEYS) {
      const km = new RegExp(`(?:[{,]|^)\\s*${key}\\s*:\\s*([^,}]+)`).exec(object);
      if (km === null) continue;
      const value = km[1].trim();
      const literal =
        /^-?[\d.]/.test(value) ||
        ((value[0] === "'" || value[0] === '"' || value[0] === '`') && !/^.var\(/.test(value));
      if (literal) {
        findings.push({
          line: lineOf(text, m.index),
          message: `inline style sets ${key} to a literal — chrome type/colour comes from classes and tokens (inline styles are for computed geometry)`,
        });
      }
    }
  }

  return findings;
}

/** Recursively list the .tsx files under src/, skipping src/components/ui/ (the wrappers
 * are the sanctioned emitters of raw primitive <button> elements). */
export function listTsxFiles(root) {
  const out = [];
  const dirs = [path.join(root, 'src')];
  const uiDir = path.join(root, 'src', 'components', 'ui');
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir === uiDir) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) dirs.push(p);
      else if (entry.name.endsWith('.tsx')) out.push(p);
    }
  }
  return out.sort();
}

/**
 * PRD 018 §E26–§E27: the whole lint over a checkout. Reads src/styles.css,
 * THEMES.md and every .tsx under src/; returns findings [{ file, line, message }]
 * with repo-relative paths, ordered by file then line.
 */
export function runStyleLint(root) {
  const css = readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  const themesMd = readFileSync(path.join(root, 'THEMES.md'), 'utf8');
  const definedVars = new Set([...cssCustomProps(css), ...themesTokenNames(themesMd)]);
  const contractVars = themesContractVars(themesMd);

  const findings = lintCss(css, { contractVars, definedVars }).map((f) => ({
    file: 'src/styles.css',
    ...f,
  }));
  for (const file of listTsxFiles(root)) {
    for (const f of lintTsx(readFileSync(file, 'utf8'))) {
      findings.push({ file: path.relative(root, file), ...f });
    }
  }
  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}
