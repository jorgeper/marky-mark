import { describe, expect, test } from 'vitest';
import { DraftShadow, type DraftShadowIo } from '../../src/lib/draftShadow';
import type { Draft } from '../../src/lib/drafts';

/** An io whose writes settle only when the test says so. */
function slowIo() {
  const log: string[] = [];
  let pending: (() => void)[] = [];
  const io: DraftShadowIo = {
    write: (d) =>
      new Promise<void>((resolve) => {
        pending.push(() => {
          log.push(`write:${d.content}`);
          resolve();
        });
      }),
    remove: async () => {
      log.push('remove');
    },
  };
  const settle = async () => {
    const p = pending;
    pending = [];
    for (const f of p) f();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { io, log, settle };
}

const draft = (content: string): Draft => ({ version: 1, docPath: '/docs/a.md', content, at: '2026-09-06T12:00:00Z' });

describe('SPEC30 §3.2 shadow-write sequencing (issue #319)', () => {
  test('U1236: a write that lands after the buffer turned clean is removed, not kept', async () => {
    const { io, log, settle } = slowIo();
    const shadow = new DraftShadow(io);
    let dirty = true;

    // Ordinary case: the write lands while still dirty → kept; a later clean
    // transition removes it.
    const w1 = shadow.write(draft('one'), () => dirty);
    await settle();
    await w1;
    expect(log).toEqual(['write:one']);
    dirty = false;
    await shadow.clean();
    expect(log).toEqual(['write:one', 'remove']);

    // Nothing landed since → a clean transition has nothing to remove.
    await shadow.clean();
    expect(log).toEqual(['write:one', 'remove']);

    // The race: the save lands (buffer clean, clean() runs) while the write
    // is still in flight. Before #319 the file survived with pre-save content.
    dirty = true;
    const w2 = shadow.write(draft('two'), () => dirty);
    dirty = false;
    await shadow.clean(); // nothing written yet from its point of view
    expect(log).toEqual(['write:one', 'remove']);
    await settle();
    await w2;
    expect(log).toEqual(['write:one', 'remove', 'write:two', 'remove']);

    // Same when the buffer turns clean without clean() having run yet — the
    // landing write re-checks dirtiness itself.
    dirty = true;
    const w3 = shadow.write(draft('three'), () => dirty);
    dirty = false;
    await settle();
    await w3;
    expect(log.slice(-2)).toEqual(['write:three', 'remove']);

    // An explicit discard during flight also wins over the landing write,
    // even if the buffer reads dirty again by then (a new edit gets its own write).
    dirty = true;
    const w4 = shadow.write(draft('four'), () => true);
    await shadow.discard();
    await settle();
    await w4;
    expect(log.slice(-3)).toEqual(['remove', 'write:four', 'remove']);

    // Best effort: a failing io never throws out of the shadow.
    const failing = new DraftShadow({
      write: async () => {
        throw new Error('disk full');
      },
      remove: async () => {
        throw new Error('gone');
      },
    });
    await expect(failing.write(draft('x'), () => true)).resolves.toBeUndefined();
    await expect(failing.discard()).resolves.toBeUndefined();
  });
});
