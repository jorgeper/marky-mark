import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { docDisplayName, SCRATCH_NAME, scratchPresence, untitledDisplayName } from '../../src/lib/docName';

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
    // The tab strip's entry point resolves the same case identically.
    expect(untitledDisplayName(false)).toEqual({ name: 'Untitled', scratch: false });
  });

  test('U1126: the scratch buffer shows "Scratchpad file", flagged for the token treatment (PRD 023 Req 7)', () => {
    expect(docDisplayName({ path: null, untitled: true, scratch: true }, basename))
      .toEqual({ name: SCRATCH_NAME, scratch: true });
    expect(untitledDisplayName(true)).toEqual({ name: SCRATCH_NAME, scratch: true });
    // Issue #244: the placeholder every surface renders reads "Scratchpad".
    expect(SCRATCH_NAME).toBe('Scratchpad file');
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

    // The tab strip's untitled tab resolves through the same module — no
    // hard-coded "Untitled" label remains (untitledDisplayName is the half
    // of the resolution docDisplayName itself delegates to).
    const strip = src('src/components/FileTabStrip.tsx');
    expect(strip).toContain("from '../lib/docName'");
    expect(strip).toContain('untitledDisplayName(');
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

describe('Issue #311 — the scratch buffer’s presence in the folder panel and tab strip', () => {
  test('U1265: an active scratch buffer is present, active, carrying its own dirty flag', () => {
    expect(scratchPresence({ scratch: true, dirty: false, parked: null })).toEqual({ active: true, dirty: false });
    expect(scratchPresence({ scratch: true, dirty: true, parked: null })).toEqual({ active: true, dirty: true });
  });

  test('U1266: a parked scratch buffer is present but inactive, dirty per its park entry', () => {
    expect(scratchPresence({ scratch: false, dirty: true, parked: { dirty: false } })).toEqual({ active: false, dirty: false });
    expect(scratchPresence({ scratch: false, dirty: false, parked: { dirty: true } })).toEqual({ active: false, dirty: true });
  });

  test('U1267: no scratch buffer alive ⇒ no presence (an ordinary dirty Untitled never gets a row, PRD 023 Req 8)', () => {
    expect(scratchPresence({ scratch: false, dirty: true, parked: null })).toBeNull();
    expect(scratchPresence({ scratch: false, dirty: false, parked: null })).toBeNull();
  });

  test('U1268: the active buffer wins over a stale park entry — the scratch never renders twice', () => {
    expect(scratchPresence({ scratch: true, dirty: false, parked: { dirty: true } })).toEqual({ active: true, dirty: false });
  });
});
