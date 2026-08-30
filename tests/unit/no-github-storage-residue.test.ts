import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// PRD 016 Req 20: the residue guard. The GitHub storage backend was removed
// whole (#176); this test asserts that none of its tokens survives — or
// creeps back — anywhere an implementation, a test, a doc or a script could
// carry one. The pattern list is deliberately narrow: the SPEC9/SPEC19
// GitHub Releases tooling and `api.github.com` in the updater stay legal,
// so only the storage backend's own vocabulary is banned.

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Each token is assembled from halves so THIS file can be scanned like every
 * other — the guard has no exclusion list, not even for itself.
 */
const BANNED = [
  'MM_STORAGE' + '_BACKEND',
  'MM_' + 'GITHUB_',
  '/api/' + 'github/',
  'providers/' + 'github',
  'server:' + 'github',
] as const;

const SCAN_DIRS = ['server', 'src', 'tests', 'docs', 'scripts'] as const;
const SCAN_FILES = ['package.json', 'playwright.config.ts', 'playwright.web.config.ts'] as const;

/** Every file under `dir`, recursively, as root-relative paths. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(`${root}${dir}`, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

describe('PRD 016 Req 20 — no GitHub-storage residue', () => {
  it('U797: no file under server/, src/, tests/, docs/, scripts/ — nor package.json or the Playwright configs — carries a GitHub-storage token', () => {
    const files = [
      ...SCAN_DIRS.flatMap((dir) => walk(dir)),
      ...SCAN_FILES.filter((f) => statSync(`${root}${f}`, { throwIfNoEntry: false })?.isFile()),
    ];
    // The sweep really swept: a wrong root or a renamed directory must fail
    // loudly here, not pass on an empty file list.
    expect(files.length).toBeGreaterThan(300);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(`${root}${file}`, 'latin1');
      for (const token of BANNED) {
        if (content.includes(token)) offenders.push(`${file}: ${token}`);
      }
    }
    expect(offenders, 'GitHub-storage residue (PRD 016 removed the backend)').toEqual([]);
  });
});
