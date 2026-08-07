// Shared by the source-scanning guards in this suite — `zoom-purity.test.ts`
// (PRD 011 Req 34) and `static-web-no-llm.test.ts` (PRD 011 Req 14 / SPEC11
// §3.2, amended by issue #114). Both prove a property by reading real source
// files, and both need the same reading: effective code only. One copy, so the
// two guards can never disagree about what counts as a reference.

/**
 * Blank out comments and string literals line by line, so prose about "the
 * document" — or a `'document'` entry id — can never mask, or fake, a real
 * reference.
 */
export function effectiveCode(source: string): string {
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
