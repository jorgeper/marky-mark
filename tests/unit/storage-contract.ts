// PRD 010 Req 22: the StorageProvider contract as ONE suite, run against
// every implementation of the seam rather than re-described per backend. The
// in-memory reference provider below is what `server-workspaces.test.ts`
// drives the HTTP layer with; `server-github-storage.test.ts` runs the very
// same expectations against a GitHub repo branch. A backend that diverges
// fails here, not in whichever test happened to notice.
//
// Test ids are computed from a `firstId` per caller so the two runs never
// share a U number: each caller states its block, and the ids stay stable and
// unique the way the repo's numbering rule requires.

import { beforeEach, describe, expect, it } from 'vitest';
import type { FileStat, StorageProvider } from '../../server/providers/types';

/** An in-memory StorageProvider — the seam contract, no Azure. */
export function createMemoryStorage(): { provider: StorageProvider; blobs: Map<string, string> } {
  const blobs = new Map<string, string>();
  // PRD 007 Req 8: blobs written as bytes keep their bytes and media type;
  // the text view decodes them, exactly as a real blob store behaves.
  const binaries = new Map<string, { data: Uint8Array; contentType: string }>();
  let stamp = 0;
  // PRD 007 Req 20: every write mints a NEW etag for that path, exactly as a
  // blob store does — that is what makes the conditional write meaningful
  // rather than a formula both sides can guess.
  const etags = new Map<string, string>();
  const stampPath = (path: string): string => {
    const etag = `e${++stamp}`;
    etags.set(path, etag);
    return etag;
  };
  const provider: StorageProvider = {
    kind: 'memory',
    async read(path) {
      const content = blobs.get(path);
      return content === undefined ? null : { content, etag: etags.get(path) ?? '' };
    },
    async write(path, content) {
      binaries.delete(path);
      blobs.set(path, content);
      return { etag: stampPath(path) };
    },
    async writeIfMatch(path, content, ifMatch) {
      if (!blobs.has(path) || etags.get(path) !== ifMatch) return null;
      binaries.delete(path);
      blobs.set(path, content);
      return { etag: stampPath(path) };
    },
    async readBytes(path) {
      const raw = binaries.get(path);
      if (raw) return { ...raw, etag: etags.get(path) ?? '' };
      const content = blobs.get(path);
      return content === undefined
        ? null
        : {
            data: new TextEncoder().encode(content),
            contentType: 'text/plain; charset=utf-8',
            etag: etags.get(path) ?? '',
          };
    },
    async writeBytes(path, data, contentType) {
      binaries.set(path, { data, contentType });
      // The text view decodes the same bytes — a blob store has ONE copy.
      blobs.set(path, new TextDecoder().decode(data));
      return { etag: stampPath(path) };
    },
    async delete(path) {
      binaries.delete(path);
      etags.delete(path);
      return blobs.delete(path);
    },
    async list(prefix) {
      const out: FileStat[] = [];
      for (const [path, content] of blobs) {
        if (path.startsWith(prefix)) {
          out.push({ path, size: content.length, lastModified: '2026-08-05T00:00:00.000Z', etag: 'e' });
        }
      }
      return out;
    },
  };
  return { provider, blobs };
}

export interface StorageContractOptions {
  /** Which implementation is under test, for the describe title. */
  label: string;
  /** The first U number of this run's block; the suite uses `firstId`…`firstId + 8`. */
  firstId: number;
  /** A provider with nothing stored in it yet, built fresh for every test. */
  create: () => StorageProvider | Promise<StorageProvider>;
}

/** Real PNG magic plus bytes that are not valid UTF-8 — a lossy path mangles these. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x01]);

export function describeStorageContract(options: StorageContractOptions): void {
  const { label, firstId, create } = options;
  const u = (offset: number, title: string): string => `U${firstId + offset}: ${title}`;

  describe(`PRD 007 Req 8+20 / PRD 010 Req 22 StorageProvider contract — ${label}`, () => {
    let storage: StorageProvider;
    beforeEach(async () => {
      storage = await create();
    });

    it(u(0, 'a path that was never written reads null, as bytes too, and deleting it answers false'), async () => {
      expect(await storage.read('workspaces/w1/files/missing.md')).toBeNull();
      expect(await storage.readBytes('workspaces/w1/files/missing.md')).toBeNull();
      expect(await storage.delete('workspaces/w1/files/missing.md')).toBe(false);
    });

    it(u(1, 'a write is readable back with an etag'), async () => {
      const written = await storage.write('workspaces/w1/files/notes.md', '# notes\n');
      expect(written.etag).not.toBe('');
      const read = await storage.read('workspaces/w1/files/notes.md');
      expect(read?.content).toBe('# notes\n');
      expect(read?.etag).toBe(written.etag);
    });

    it(u(2, 'changing a file mints a new etag for it'), async () => {
      const first = await storage.write('workspaces/w1/files/notes.md', 'one\n');
      const second = await storage.write('workspaces/w1/files/notes.md', 'two\n');
      expect(second.etag).not.toBe(first.etag);
      expect((await storage.read('workspaces/w1/files/notes.md'))?.content).toBe('two\n');
    });

    it(u(3, 'writeIfMatch lands while the etag still matches'), async () => {
      const first = await storage.write('workspaces/w1/files/notes.md', 'one\n');
      const written = await storage.writeIfMatch('workspaces/w1/files/notes.md', 'two\n', first.etag);
      expect(written).not.toBeNull();
      expect(written!.etag).not.toBe(first.etag);
      const read = await storage.read('workspaces/w1/files/notes.md');
      expect(read?.content).toBe('two\n');
      expect(read?.etag).toBe(written!.etag);
    });

    // PRD 007 Req 20: the "someone else saved first" case — null, and the
    // content that won is STILL THERE. This is what the API answers 412 for.
    it(u(4, 'writeIfMatch on a stale etag answers null and leaves the stored content untouched'), async () => {
      const stale = (await storage.write('workspaces/w1/files/notes.md', 'one\n')).etag;
      await storage.write('workspaces/w1/files/notes.md', 'somebody else\n');
      expect(await storage.writeIfMatch('workspaces/w1/files/notes.md', 'mine\n', stale)).toBeNull();
      expect((await storage.read('workspaces/w1/files/notes.md'))?.content).toBe('somebody else\n');
      // A conditional write of a file that is not there is equally a no-op.
      expect(await storage.writeIfMatch('workspaces/w1/files/gone.md', 'mine\n', stale)).toBeNull();
      expect(await storage.read('workspaces/w1/files/gone.md')).toBeNull();
    });

    it(u(5, 'an unconditional write overwrites a file that changed since it was read'), async () => {
      const stale = (await storage.write('workspaces/w1/files/notes.md', 'one\n')).etag;
      await storage.write('workspaces/w1/files/notes.md', 'somebody else\n');
      const written = await storage.write('workspaces/w1/files/notes.md', 'mine\n');
      expect(written.etag).not.toBe(stale);
      expect((await storage.read('workspaces/w1/files/notes.md'))?.content).toBe('mine\n');
    });

    // PRD 007 Req 8 / PRD 010 Req 9: bytes in, the same bytes out — a pasted
    // PNG is not valid UTF-8, so any text detour shows up here as corruption.
    it(u(6, 'writeBytes/readBytes round-trip non-UTF-8 bytes and answer the extension media type'), async () => {
      await storage.writeBytes('workspaces/w1/files/assets/shot.png', PNG_BYTES, 'image/png');
      const stored = await storage.readBytes('workspaces/w1/files/assets/shot.png');
      expect(stored).not.toBeNull();
      expect([...stored!.data]).toEqual([...PNG_BYTES]);
      expect(stored!.contentType).toBe('image/png');
      expect(stored!.etag).not.toBe('');
    });

    it(u(7, 'deleting a stored file answers true and the path then reads null'), async () => {
      await storage.write('workspaces/w1/files/notes.md', 'one\n');
      expect(await storage.delete('workspaces/w1/files/notes.md')).toBe(true);
      expect(await storage.read('workspaces/w1/files/notes.md')).toBeNull();
      expect(await storage.delete('workspaces/w1/files/notes.md')).toBe(false);
    });

    it(u(8, 'list answers a prefix with populated stats, and an empty prefix answers everything'), async () => {
      await storage.write('workspaces/w1/files/notes.md', 'one\n');
      await storage.write('workspaces/w1/files/deep/inner.md', 'two\n');
      await storage.write('workspaces/w2/manifest.json', '{}\n');

      const scoped = await storage.list('workspaces/w1/files/');
      expect(scoped.map((f) => f.path).sort()).toEqual([
        'workspaces/w1/files/deep/inner.md',
        'workspaces/w1/files/notes.md',
      ]);
      for (const stat of scoped) {
        expect(stat.size).toBeGreaterThan(0);
        expect(stat.etag).not.toBe('');
        expect(typeof stat.lastModified).toBe('string');
      }

      const everything = await storage.list('');
      expect(everything.map((f) => f.path).sort()).toEqual([
        'workspaces/w1/files/deep/inner.md',
        'workspaces/w1/files/notes.md',
        'workspaces/w2/manifest.json',
      ]);
    });
  });
}
