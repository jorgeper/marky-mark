import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { docDisplayName, SCRATCH_NAME } from '../../src/lib/docName';

const basename = (p: string) => p.split('/').pop()!;

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('PRD 023 Req 6 — document display-name resolution (issue #291)', () => {
  test('U1124: a named document shows its basename, never scratch-styled — even against a stale marker', () => {
    expect(docDisplayName({ path: '/ws/notes/todo.md', untitled: false, scratch: false }, basename))
      .toEqual({ name: 'todo.md', scratch: false });
    // PRD 023 Req 8: a named file is untouched whatever the marker says.
    expect(docDisplayName({ path: '/ws/notes/todo.md', untitled: false, scratch: true }, basename))
      .toEqual({ name: 'todo.md', scratch: false });
  });

  test('U1125: an ordinary untitled buffer shows "Untitled", normally styled (PRD 023 Req 8)', () => {
    expect(docDisplayName({ path: null, untitled: true, scratch: false }, basename))
      .toEqual({ name: 'Untitled', scratch: false });
  });

  test('U1126: the scratch buffer shows "Scratch file", flagged for the token treatment (PRD 023 Req 7)', () => {
    expect(docDisplayName({ path: null, untitled: true, scratch: true }, basename))
      .toEqual({ name: SCRATCH_NAME, scratch: true });
    expect(SCRATCH_NAME).toBe('Scratch file');
  });

  test('U1127: nothing open (splash) resolves to no name at all', () => {
    expect(docDisplayName({ path: null, untitled: false, scratch: false }, basename))
      .toEqual({ name: null, scratch: false });
    // The marker without a buffer names nothing either (cleared on close,
    // but the resolution stays safe regardless).
    expect(docDisplayName({ path: null, untitled: false, scratch: true }, basename))
      .toEqual({ name: null, scratch: false });
  });

  test('U1128: all three name surfaces consume this one helper, so they cannot drift', () => {
    // The toolbar name and the window-title effect both resolve through
    // docDisplayName in App.tsx (one shared const + the effect's own call).
    const app = src('src/App.tsx');
    expect(app).toContain("from './lib/docName'");
    expect(app.match(/docDisplayName\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);

    // The tab strip's untitled tab resolves through the same helper — no
    // hard-coded "Untitled" label remains.
    const strip = src('src/components/FileTabStrip.tsx');
    expect(strip).toContain("from '../lib/docName'");
    expect(strip).toContain('docDisplayName(');
    expect(strip).not.toContain('label="Untitled"');

    // PRD 023 Req 7 + the issue #293 e2e hook: both visible surfaces carry
    // the token-driven class and the stable data-scratch attribute.
    const toolbar = src('src/components/Toolbar.tsx');
    for (const text of [toolbar, strip]) {
      expect(text).toContain('scratch-name');
      expect(text).toContain('data-scratch');
    }
  });
});
