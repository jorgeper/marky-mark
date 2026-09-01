import { describe, expect, it } from 'vitest';
import {
  blankSkippedRegions,
  cssCustomProps,
  lintCss,
  lintTsx,
  themesContractVars,
  themesTokenNames,
} from '../../scripts/style-lint.mjs';

// PRD 018 §E28 (issue #205): each style-lint rule proven with a passing and
// a failing fixture, so a future change to the lint cannot silently stop
// catching a pattern. Fixtures are minimal CSS/TSX strings, not tree reads.

const CONTRACT = new Set(['--mm-bg', '--mm-fg', '--mm-accent', '--mm-border']);
const DEFINED = new Set([...CONTRACT, '--mm-hover', '--mm-text-body', '--mm-radius-small', '--mm-card-shadow']);
const OPTS = { contractVars: CONTRACT, definedVars: DEFINED };

describe('PRD 018 §E26 style lint — src/styles.css rules', () => {
  it('U1015: a hex/rgb()/hsl() colour literal in a chrome rule fails with its line', () => {
    const css = `.a {\n  color: #123456;\n}\n.b {\n  background: rgba(0, 0, 0, 0.5);\n}\n.c {\n  border-color: hsl(10, 5%, 5%);\n}`;
    const found = lintCss(css, OPTS);
    expect(found.map((f) => f.line)).toEqual([2, 5, 8]);
    expect(found[0].message).toContain('#123456');
  });

  it('U1016: colour literals pass as contract-variable var() fallbacks and in custom-property definitions', () => {
    const css = [
      '.a {',
      '  color: var(--mm-fg, #1f2328);', // contract fallback — the THEMES.md-documented default
      '  background: var(--mm-bg, rgba(255, 255, 255, 0.9));',
      '}',
      ':root {',
      '  --mm-panel-bg: rgba(127, 127, 127, 0.14);', // token definition owns its literal
      '  --mm-lift: 0 -1px 3px rgba(0, 0, 0, 0.11),',
      '    0 1px 3px rgba(0, 0, 0, 0.07);', // multi-line definition too
      '}',
    ].join('\n');
    expect(lintCss(css, OPTS)).toEqual([]);
    // …but a fallback on a NON-contract (chrome) token is the disagreeing-
    // fallback bug Req 4 killed, and fails:
    expect(lintCss('.a { background: var(--mm-hover, #eeeeee); }', OPTS)).toHaveLength(1);
  });

  it('U1017: the CHROME TOKENS block and every DOCUMENT RENDERING section are outside the lint', () => {
    const css = [
      '/* CHROME TOKENS — BEGIN (PRD 018 Req 1) */',
      '.theme-root { --mm-find: #ffdf5d; color: #111111; }',
      '/* CHROME TOKENS — END (PRD 018 Req 1) */',
      '/* DOCUMENT RENDERING — BEGIN (PRD 018 Req 17) */',
      '.doc h1 { color: #222222; font-size: 28px; }',
      '/* DOCUMENT RENDERING — END (PRD 018 Req 17) */',
      '.chrome { color: var(--mm-fg); }',
      '/* DOCUMENT RENDERING — BEGIN (PRD 018 Req 17) */',
      '.doc td { border-radius: 3px; }',
      '/* DOCUMENT RENDERING — END (PRD 018 Req 17) */',
    ].join('\n');
    expect(lintCss(css, OPTS)).toEqual([]);
    // An unclosed pair is an error, never a silent skip to end-of-file.
    expect(() => blankSkippedRegions('/* DOCUMENT RENDERING — BEGIN (PRD 018 Req 17) */\n.a{}')).toThrow(/unclosed/);
  });

  it('U1018: var(--mm-…) must name a property defined in styles.css or listed in THEMES.md', () => {
    // The exact issue #196 bug: a typo name with a literal fallback draws
    // BOTH findings — the undefined var() and the non-contract colour
    // fallback.
    const bad = lintCss('.a { background: var(--mm-bg-elev, #ffffff); }', OPTS);
    expect(bad).toHaveLength(2);
    expect(bad.map((f) => f.message).join('\n')).toContain('--mm-bg-elev');
    expect(lintCss('.a { background: var(--mm-bg-elev); }', OPTS)).toHaveLength(1);
    expect(lintCss('.a { background: var(--mm-hover); color: var(--mm-fg); }', OPTS)).toEqual([]);
    // The defined set really is styles.css declarations ∪ THEMES.md names:
    expect(cssCustomProps(':root {\n  --mm-zoom: 1;\n}')).toEqual(new Set(['--mm-zoom']));
    expect(themesTokenNames('| `--mm-find` | `#ffdf5d` |')).toEqual(new Set(['--mm-find']));
  });

  it('U1019: a selector ending in a bare descendant button/input/select/textarea fails; qualified forms pass', () => {
    for (const el of ['button', 'input', 'select', 'textarea']) {
      const found = lintCss(`.card .row ${el} { color: var(--mm-fg); }`, OPTS);
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain(`\`${el}\``);
    }
    // Multi-selector lists are split; the offending part is still caught.
    expect(lintCss('.ok, .modal button { color: var(--mm-fg); }', OPTS)).toHaveLength(1);
    // Element-qualified classes, non-final elements, and pseudo-classed
    // elements are not the bare-descendant pattern.
    const fine = [
      'input.field { color: var(--mm-fg); }',
      '.dialog div.field { display: flex; }',
      '.palette input.palette-input { color: var(--mm-fg); }',
      'button { cursor: pointer; }', // bare top-level element, no descendant combinator
    ].join('\n');
    expect(lintCss(fine, OPTS)).toEqual([]);
  });

  it('U1020: font-size / border-radius / box-shadow in chrome rules take tokens, not literals', () => {
    const bad = lintCss('.a {\n  font-size: 13px;\n  border-radius: 6px;\n  box-shadow: 0 0 24px 2px rgba(0, 0, 0, 0.14);\n}', OPTS);
    // Lines 2 and 3 fail the scale rule; line 4 fails both the scale rule
    // and the colour-literal rule (two findings on one declaration).
    expect(bad.map((f) => f.line).sort()).toEqual([2, 3, 4, 4]);
    const good = [
      '.a {',
      '  font-size: var(--mm-text-body);',
      '  border-radius: var(--mm-radius-small) var(--mm-radius-small) 0 0;',
      '  box-shadow: var(--mm-card-shadow);',
      '}',
      '.b { box-shadow: none; font-size: inherit; border-radius: 0; }',
    ].join('\n');
    expect(lintCss(good, OPTS)).toEqual([]);
  });
});

describe('PRD 018 §E27 style lint — TSX rules', () => {
  it('U1021: a raw <button> without a primitive class fails; .btn*/.icon-btn/.menu-item (static or template) pass', () => {
    const bad = lintTsx('export const X = () => (\n  <button data-testid="x" onClick={go}>hi</button>\n);');
    expect(bad).toHaveLength(1);
    expect(bad[0].line).toBe(2);
    const good = [
      '<button className="btn btn-primary" onClick={a}>ok</button>',
      '<button className="icon-btn" title="close" onClick={b}>×</button>',
      '<button className={`menu-item${active ? " active" : ""}`} onClick={c}>row</button>',
      '<button className={"btn-quiet extra-hook"} onClick={(e) => go(e)}>quiet</button>',
    ].join('\n');
    expect(lintTsx(good)).toEqual([]);
    // A non-primitive class alone is still a finding.
    expect(lintTsx('<button className="table-chip" onClick={d}>chip</button>')).toHaveLength(1);
  });

  it('U1022: prose `<button>` mentions in comments carry no attributes and are not findings', () => {
    const src = [
      '/**',
      ' * A span with role=button: the row itself is already a <button>).',
      ' */',
      '// not a nested <button> (the tab is one)',
      'export const Row = () => <button className="btn" onClick={go}>real</button>;',
    ].join('\n');
    expect(lintTsx(src)).toEqual([]);
  });

  it('U1023: inline style={{ }} literals for fontSize/color/background/borderRadius fail; var() strings and computed values pass', () => {
    for (const pair of ['fontSize: 13', "color: '#ffffff'", "background: '#1e1e1e'", "borderRadius: '6px'"]) {
      expect(lintTsx(`<div style={{ ${pair} }} />`), pair).toHaveLength(1);
    }
    const good = [
      "<div style={{ color: 'var(--mm-danger)' }} />",
      "<div style={{ width: 120, '--mm-depth': `${10 + depth * 14}px` }} />", // computed geometry stays allowed
      '<div style={{ background: token }} />',
    ].join('\n');
    expect(lintTsx(good)).toEqual([]);
  });
});

describe('PRD 018 §E26 style lint — THEMES.md contract parsing', () => {
  it('U1024: contract variables come from "The variable contract" section only — chrome tokens are not contract', () => {
    const md = [
      '## The variable contract',
      '| `--mm-bg` | Page background |',
      '| `--mm-fg` | Body text |',
      '## Chrome tokens (optional)',
      '| `--mm-hover` | Hover wash |',
    ].join('\n');
    const contract = themesContractVars(md);
    expect(contract).toEqual(new Set(['--mm-bg', '--mm-fg']));
    // …while the defined-name set still sees every mention:
    expect(themesTokenNames(md).has('--mm-hover')).toBe(true);
  });
});
