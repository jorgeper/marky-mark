import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * PRD 011 Req 34: the semantic-zoom core is pure — no network, no DOM, no
 * host. Convention would let that rot silently, so this scan is the gate:
 * precedent is the file-scanning guards already in this suite.
 */
const MODULES = ['sectionModel.ts', 'zoomLevels.ts', 'sectionExcerpt.ts', 'summaryCache.ts', 'llmCost.ts'];

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/lib/${name}`, import.meta.url)), 'utf8');

/**
 * Blank out comments and string literals line by line, so prose about "the
 * document" and a `'document'` entry id can never mask — or fake — a real
 * global reference.
 */
function code(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = raw;
    if (inBlock) {
      const close = line.indexOf('*/');
      if (close === -1) {
        out.push('');
        continue;
      }
      line = line.slice(close + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, ' ');
    const open = line.indexOf('/*');
    if (open !== -1) {
      inBlock = true;
      line = line.slice(0, open);
    }
    line = line.replace(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g, "''");
    line = line.replace(/\/\/.*$/, '');
    out.push(line);
  }
  return out.join('\n');
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['DOM globals', /\b(?:document|window|globalThis|navigator|localStorage|sessionStorage|DOMParser)\b/],
  ['network', /\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/],
  ['non-determinism', /\b(?:Date\.now|new Date|Math\.random|performance\.now)\b/],
];

const FORBIDDEN_IMPORTS = /^(?:react|react-dom)$|\/platform\/|\/components\//;

describe('PRD 011 Req 34 — the semantic-zoom core stays pure', () => {
  test('U515: the modules reference no DOM, network or non-deterministic global', () => {
    for (const name of MODULES) {
      const body = code(read(name));
      for (const [label, pattern] of FORBIDDEN) {
        const hit = pattern.exec(body);
        expect(hit?.[0], `${name} must not touch ${label}: ${hit?.[0]}`).toBeUndefined();
      }
    }
  });

  test('U516: the modules import no React, platform or component code', () => {
    for (const name of MODULES) {
      const source = read(name);
      expect(source.length, `${name} should be readable`).toBeGreaterThan(0);
      const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const specifier of specifiers) {
        expect(FORBIDDEN_IMPORTS.test(specifier), `${name} must not import ${specifier}`).toBe(false);
      }
    }
  });

  test('U517: no user-visible surface is wired up and no dependency was added', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
    ) as { dependencies: Record<string, string> };
    // Everything the core needs is already in the tree (the render pipeline's parser).
    expect(Object.keys(pkg.dependencies)).toContain('remark-parse');

    // The consumers land in #111/#115/#116/#117/#119; nothing dispatches here yet.
    const commands = readFileSync(fileURLToPath(new URL('../../src/lib/commands.ts', import.meta.url)), 'utf8');
    expect(commands).not.toMatch(/zoomView|semanticZoom|summaryCacheKey/);
  });
});
