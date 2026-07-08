import { describe, expect, test } from 'vitest';
import { GG_WINDOW_MS, VimNavResolver, type VimKeyEvent } from '../../src/lib/vimnav';

function key(k: string, mods: Partial<VimKeyEvent> = {}): VimKeyEvent {
  return { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

describe('vim navigation resolver', () => {
  test('U12: j/k/Ctrl+d/Ctrl+u/gg/G resolve correctly; pending-g state resets properly', () => {
    const r = new VimNavResolver();

    // Basic motions.
    expect(r.resolve(key('j'), 0)).toBe('down');
    expect(r.resolve(key('k'), 10)).toBe('up');
    expect(r.resolve(key('d', { ctrlKey: true }), 20)).toBe('halfDown');
    expect(r.resolve(key('u', { ctrlKey: true }), 30)).toBe('halfUp');
    expect(r.resolve(key('G', { shiftKey: true }), 40)).toBe('bottom');
    // A second consecutive G is just another jump to bottom.
    expect(r.resolve(key('G', { shiftKey: true }), 50)).toBe('bottom');

    // gg within the window jumps to top.
    expect(r.resolve(key('g'), 100)).toBeNull(); // first g: pending
    expect(r.resolve(key('g'), 100 + GG_WINDOW_MS)).toBe('top');

    // g then timeout then g: no jump (second g becomes the new pending g).
    expect(r.resolve(key('g'), 1000)).toBeNull();
    expect(r.resolve(key('g'), 1000 + GG_WINDOW_MS + 1)).toBeNull();
    // ...but a third quick g completes the new pair.
    expect(r.resolve(key('g'), 1000 + GG_WINDOW_MS + 50)).toBe('top');

    // Unrelated keys reset pending state.
    expect(r.resolve(key('g'), 2000)).toBeNull();
    expect(r.resolve(key('x'), 2010)).toBeNull();
    expect(r.resolve(key('g'), 2020)).toBeNull(); // pending again, not 'top'

    // Meta/Alt-modified keys never fire and clear state.
    expect(r.resolve(key('g'), 3000)).toBeNull();
    expect(r.resolve(key('j', { metaKey: true }), 3010)).toBeNull();
    expect(r.resolve(key('g'), 3020)).toBeNull(); // state was cleared → pending, not top
    expect(r.resolve(key('d', { altKey: true }), 3030)).toBeNull();
    expect(r.resolve(key('q', { ctrlKey: true }), 3040)).toBeNull();

    // reset() clears pending g.
    r.resolve(key('g'), 4000);
    r.reset();
    expect(r.resolve(key('g'), 4001)).toBeNull();
  });
});
