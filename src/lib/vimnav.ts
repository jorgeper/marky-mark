/**
 * Simplified vim-style navigation (SPEC3 §5). Pure key-sequence resolver —
 * no DOM. The caller feeds key events plus a monotonic timestamp; the
 * resolver tracks pending-`g` state and returns the navigation action.
 */

export type VimAction = 'up' | 'down' | 'halfUp' | 'halfDown' | 'top' | 'bottom';

/** Two `g` presses within this window make `gg`. */
export const GG_WINDOW_MS = 500;

export interface VimKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export class VimNavResolver {
  private pendingGAt: number | null = null;

  reset(): void {
    this.pendingGAt = null;
  }

  /**
   * Resolve a key event to an action (or null). `now` is a monotonic
   * timestamp in ms (performance.now() in the app; anything in tests).
   */
  resolve(e: VimKeyEvent, now: number): VimAction | null {
    // Modified keys other than plain Ctrl combos never match (and clear state).
    if (e.metaKey || e.altKey) {
      this.pendingGAt = null;
      return null;
    }

    if (e.ctrlKey) {
      this.pendingGAt = null;
      if (e.key === 'd') return 'halfDown';
      if (e.key === 'u') return 'halfUp';
      return null;
    }

    switch (e.key) {
      case 'j':
        this.pendingGAt = null;
        return 'down';
      case 'k':
        this.pendingGAt = null;
        return 'up';
      case 'G': // Shift+g; a repeated G is simply another jump to bottom
        this.pendingGAt = null;
        return 'bottom';
      case 'g': {
        if (this.pendingGAt !== null && now - this.pendingGAt <= GG_WINDOW_MS) {
          this.pendingGAt = null;
          return 'top';
        }
        this.pendingGAt = now;
        return null;
      }
      default:
        this.pendingGAt = null;
        return null;
    }
  }
}

/**
 * SPEC23 §2: editor vim NAVIGATION mode — a modal resolver. Typing mode
 * passes everything through except a plain Esc (→ nav). Nav mode resolves
 * the motion keyset, exits on i/a, leaves modified keys (⌘/Alt — and Ctrl
 * except d/u) to the accelerator layers, and swallows every other editing
 * key as 'inert' so the buffer stays byte-identical. Pure: no DOM.
 */
export type VimEditAction =
  | 'left'
  | 'right'
  | 'down'
  | 'up'
  | 'wordFwd'
  | 'wordBack'
  | 'lineStart'
  | 'lineEnd'
  | 'top'
  | 'bottom'
  | 'halfDown'
  | 'halfUp'
  | 'enterNav'
  | 'exitNav'
  | 'inert'
  | 'passthrough';

export type VimEditMode = 'typing' | 'nav';

/** Keys that never belong to vim and must keep working in nav mode. */
const NAV_PASSTHROUGH_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Shift',
  'Control',
  'Meta',
  'Alt',
  'CapsLock',
]);

export class VimEditResolver {
  private pendingGAt: number | null = null;
  private navMode = false;

  get mode(): VimEditMode {
    return this.navMode ? 'nav' : 'typing';
  }

  reset(): void {
    this.pendingGAt = null;
    this.navMode = false;
  }

  resolve(e: VimKeyEvent, now: number): VimEditAction {
    if (!this.navMode) {
      // Typing mode: only a plain Esc is ours.
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        this.navMode = true;
        this.pendingGAt = null;
        return 'enterNav';
      }
      return 'passthrough';
    }

    // Nav mode. ⌘/Alt combos are accelerators — never intercepted.
    if (e.metaKey || e.altKey) {
      this.pendingGAt = null;
      return 'passthrough';
    }
    if (e.ctrlKey) {
      this.pendingGAt = null;
      if (e.key === 'd') return 'halfDown';
      if (e.key === 'u') return 'halfUp';
      return 'passthrough';
    }
    if (NAV_PASSTHROUGH_KEYS.has(e.key)) return 'passthrough';
    if (e.key === 'Escape') {
      this.pendingGAt = null;
      return 'inert'; // Esc in nav stays in nav
    }

    const clear = <T extends VimEditAction>(a: T): T => {
      this.pendingGAt = null;
      return a;
    };
    switch (e.key) {
      case 'i':
      case 'a':
        this.navMode = false;
        return clear('exitNav');
      case 'h':
        return clear('left');
      case 'l':
        return clear('right');
      case 'j':
        return clear('down');
      case 'k':
        return clear('up');
      case 'w':
        return clear('wordFwd');
      case 'b':
        return clear('wordBack');
      case '0':
        return clear('lineStart');
      case '$':
        return clear('lineEnd');
      case 'G':
        return clear('bottom');
      case 'g': {
        if (this.pendingGAt !== null && now - this.pendingGAt <= GG_WINDOW_MS) {
          this.pendingGAt = null;
          return 'top';
        }
        this.pendingGAt = now;
        return 'inert';
      }
      default:
        // Everything else — printable keys, Enter, Backspace, Delete, Tab,
        // function keys — is consumed without effect: navigation only.
        return clear('inert');
    }
  }
}
