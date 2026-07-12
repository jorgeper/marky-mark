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

import { VimEditResolver } from '../../src/lib/vimnav';

describe('SPEC23 editor vim nav resolver', () => {
  test('U49: modal transitions, full nav keyset, inert editing keys, accelerators untouched', () => {
    const r = new VimEditResolver();

    // Typing mode: everything passes through except a plain Esc.
    expect(r.mode).toBe('typing');
    expect(r.resolve(key('x'), 0)).toBe('passthrough');
    expect(r.resolve(key('Enter'), 1)).toBe('passthrough');
    expect(r.resolve(key('j'), 2)).toBe('passthrough');
    expect(r.resolve(key('Escape', { shiftKey: true }), 3)).toBe('passthrough');
    expect(r.resolve(key('Escape', { metaKey: true }), 4)).toBe('passthrough');
    expect(r.resolve(key('Escape'), 5)).toBe('enterNav');
    expect(r.mode).toBe('nav');

    // Nav mode: the full motion keyset.
    expect(r.resolve(key('h'), 10)).toBe('left');
    expect(r.resolve(key('l'), 11)).toBe('right');
    expect(r.resolve(key('j'), 12)).toBe('down');
    expect(r.resolve(key('k'), 13)).toBe('up');
    expect(r.resolve(key('w'), 14)).toBe('wordFwd');
    expect(r.resolve(key('b'), 15)).toBe('wordBack');
    expect(r.resolve(key('0'), 16)).toBe('lineStart');
    expect(r.resolve(key('$', { shiftKey: true }), 17)).toBe('lineEnd');
    expect(r.resolve(key('G', { shiftKey: true }), 18)).toBe('bottom');
    expect(r.resolve(key('d', { ctrlKey: true }), 19)).toBe('halfDown');
    expect(r.resolve(key('u', { ctrlKey: true }), 20)).toBe('halfUp');

    // gg inside the window; a lone g is consumed (inert), not typed.
    expect(r.resolve(key('g'), 100)).toBe('inert');
    expect(r.resolve(key('g'), 100 + GG_WINDOW_MS - 1)).toBe('top');
    expect(r.resolve(key('g'), 1000)).toBe('inert');
    expect(r.resolve(key('g'), 1000 + GG_WINDOW_MS + 1)).toBe('inert'); // window expired → pending again

    // Editing keys are inert — navigation only, buffer untouched.
    for (const k of ['x', 'D', 'Enter', 'Backspace', 'Delete', 'Tab', 'q', '#']) {
      expect(r.resolve(key(k), 2000)).toBe('inert');
    }
    // Esc in nav stays in nav.
    expect(r.resolve(key('Escape'), 2100)).toBe('inert');
    expect(r.mode).toBe('nav');

    // Accelerators and native navigation keys pass through in nav mode.
    expect(r.resolve(key('s', { metaKey: true }), 2200)).toBe('passthrough');
    expect(r.resolve(key('v', { altKey: true }), 2201)).toBe('passthrough');
    expect(r.resolve(key('c', { ctrlKey: true }), 2202)).toBe('passthrough');
    expect(r.resolve(key('ArrowDown'), 2203)).toBe('passthrough');
    expect(r.resolve(key('Home'), 2204)).toBe('passthrough');
    expect(r.resolve(key('Shift', { shiftKey: true }), 2205)).toBe('passthrough');

    // i exits to typing; a would too.
    expect(r.resolve(key('i'), 2300)).toBe('exitNav');
    expect(r.mode).toBe('typing');
    expect(r.resolve(key('x'), 2301)).toBe('passthrough');
    expect(r.resolve(key('Escape'), 2302)).toBe('enterNav');
    expect(r.resolve(key('a'), 2303)).toBe('exitNav');
    expect(r.mode).toBe('typing');

    // reset() returns to typing mode and clears pending g.
    r.resolve(key('Escape'), 2400);
    r.resolve(key('g'), 2401);
    r.reset();
    expect(r.mode).toBe('typing');
  });
});
