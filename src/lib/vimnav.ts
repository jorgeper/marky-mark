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
