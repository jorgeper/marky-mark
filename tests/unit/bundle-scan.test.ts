import { describe, expect, test } from 'vitest';
// The scan itself runs only in the Rust-gated full gate; importing the same
// counting function here is what keeps its discrimination checked in the
// fast tier (SPEC11 §6.6, amended by issue #161) rather than asserted in a
// comment in scripts/validate.mjs.
import { countFetchCallSites } from '../../scripts/bundle-scan.mjs';

describe('SPEC11 §6.6 static bundle scan — fetch( call-site counting (issue #161)', () => {
  test('U746: bare fetch calls count — the shapes the audited wrappers minify to', () => {
    // The three allowlisted same-origin wrappers all minify to `=>fetch(`
    // arrows or statement-position calls; each is one call site.
    expect(countFetchCallSites('const api=(p,init={})=>fetch(u(p),{...init,credentials:"include"});')).toBe(1);
    expect(countFetchCallSites('async function go(){const r=await fetch("/api/session");return r.json()}')).toBe(1);
    expect(countFetchCallSites('fetch(a).then(r=>r.json());if(x)fetch(b);')).toBe(2);
    // Whitespace between name and paren is still the same call.
    expect(countFetchCallSites('fetch ("/x")')).toBe(1);
  });

  test('U747: member calls are not network call sites — katex parses with a method named fetch', () => {
    // Real shapes from the built katex chunk: ~27 member calls per bundle.
    const katexish = 'var a=this.fetch();consume();this.fetch(),spaces(),t=r.fetch();e?.fetch()';
    expect(countFetchCallSites(katexish)).toBe(0);
    // …but a member call does not mask a bare call beside it.
    expect(countFetchCallSites(`${katexish};fetch("/real")`)).toBe(1);
  });

  test('U748: a method definition is not a call site; a lookalike identifier is nothing at all', () => {
    // katex's Lexer, as built: `…tToken=null}fetch(){return this.nextToken…`.
    expect(countFetchCallSites('nextToken=null}fetch(){return this.nextToken==null&&(this.next(),1)}')).toBe(0);
    // Parameter lists, including paren-bearing default values, still balance.
    expect(countFetchCallSites('class L{fetch(e,t=f()){return e}}')).toBe(0);
    expect(countFetchCallSites('const o={fetch(u){return u}};')).toBe(0);
    // `myfetch(` shares only a suffix — the word boundary excludes it.
    expect(countFetchCallSites('myfetch("/x");prefetch(y)')).toBe(0);
  });

  test('U749: ambiguity fails loud — unclassifiable text counts as a call site, and a new call raises the count', () => {
    // A paren list the windowed scanner cannot balance is counted, so the
    // gate goes red for a human to audit instead of quietly excluding it.
    expect(countFetchCallSites(`fetch(${'('.repeat(20)}`)).toBe(1);
    // Sensitivity: shipping one genuinely new call site moves the number.
    const bundle = 'var a=this.fetch(1);t=(p,i={})=>fetch(u(p),i);n=null}fetch(){return 1}';
    expect(countFetchCallSites(bundle)).toBe(1);
    expect(countFetchCallSites(`${bundle};fetch("https://exfil.example")`)).toBe(2);
  });

  test('U753: a call through the global object is a network call site, member syntax or not', () => {
    // The member-call exclusion must not become an escape hatch: these three
    // receivers *are* the global, so the call can leave the page.
    expect(countFetchCallSites('window.fetch("https://exfil.example")')).toBe(1);
    expect(countFetchCallSites('globalThis.fetch(u);self.fetch(u)')).toBe(2);
    expect(countFetchCallSites('const f=window?.fetch;window?.fetch(u)')).toBe(1);
    // A `window` that is somebody's property is not the global — but the
    // scanner cannot know that, so it counts and the gate asks a human.
    expect(countFetchCallSites('a.window.fetch(u)')).toBe(1);
  });
});
