/**
 * Hotkey model (pure). A binding is stored as a canonical string like
 * "Mod+E" or "Mod+Shift+C". "Mod" matches ⌘ on macOS and Ctrl elsewhere
 * (and either one when matching, so bindings written on one OS work on the
 * other — cross-platform discipline, SPEC FR-6).
 */

export interface HotkeyMap {
  toggleEdit: string;
  toggleSplit: string;
  newFile: string;
  openFile: string;
  find: string;
  toggleFolders: string;
  toggleComments: string;
  save: string;
  nextComment: string;
  prevComment: string;
  headingPalette: string;
  toggleWordCount: string;
  /** SPEC36 §5: the only-open-files sidebar view. */
  toggleOpenOnly: string;
  /** SPEC36 §6: cycle the open set (strict Ctrl — the browser-tab idiom). */
  nextFile: string;
  prevFile: string;
}

export const DEFAULT_HOTKEYS: HotkeyMap = {
  toggleEdit: 'Mod+E',
  toggleSplit: 'Mod+\\',
  newFile: 'Mod+N',
  openFile: 'Mod+O',
  find: 'Mod+F',
  toggleFolders: 'Mod+Shift+E',
  toggleComments: 'Mod+Shift+C',
  save: 'Mod+S',
  nextComment: 'Mod+Alt+ArrowDown',
  prevComment: 'Mod+Alt+ArrowUp',
  headingPalette: 'Mod+K',
  toggleWordCount: 'Mod+Shift+W',
  toggleOpenOnly: 'Mod+Shift+O',
  nextFile: 'Ctrl+Tab',
  prevFile: 'Ctrl+Shift+Tab',
};

export interface ComboParts {
  mod: boolean;
  /**
   * SPEC36 §6.1: strict Ctrl — matches ctrlKey on every platform (never ⌘).
   * Distinct from `mod`; when set, `mod` narrows to metaKey alone. No
   * shipped default or recorded binding ever spelled "Ctrl" before, so
   * retiring the old ctrl→Mod alias changes nothing stored.
   */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string; // uppercase single char or key name (e.g. "E", "F5")
}

export function parseCombo(combo: string): ComboParts | null {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: ComboParts = { mod: false, ctrl: false, shift: false, alt: false, key: '' };
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === 'mod' || low === 'meta' || low === 'cmd') out.mod = true;
    else if (low === 'ctrl' || low === 'control') out.ctrl = true;
    else if (low === 'shift') out.shift = true;
    else if (low === 'alt' || low === 'option') out.alt = true;
    else out.key = p.length === 1 ? p.toUpperCase() : p;
  }
  if (!out.key) return null;
  return out;
}

/** Serialize a keyboard event into a canonical combo string, or null if it is only modifiers. */
export function comboFromEvent(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): string | null {
  const key = e.key;
  if (key === 'Meta' || key === 'Control' || key === 'Shift' || key === 'Alt') return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('Mod');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

/** Does this keyboard event match the stored combo? */
export function eventMatches(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  combo: string
): boolean {
  const c = parseCombo(combo);
  if (!c) return false;
  const evKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (evKey !== c.key) return false;
  // Strict Ctrl (SPEC36 §6.1): the ctrl flag consumes ctrlKey, so the mod
  // flag then matches metaKey alone; without it, Mod keeps meaning ⌘-or-Ctrl.
  if (c.ctrl && !e.ctrlKey) return false;
  if (c.mod !== (c.ctrl ? e.metaKey : e.metaKey || e.ctrlKey)) return false;
  if (c.shift !== e.shiftKey) return false;
  if (c.alt !== e.altKey) return false;
  return true;
}

/** Human-readable form for the current platform ("⌘⇧C" on mac, "Ctrl+Shift+C" elsewhere). */
export function displayCombo(combo: string, isMac: boolean): string {
  const c = parseCombo(combo);
  if (!c) return combo;
  if (isMac) {
    return `${c.ctrl ? '⌃' : ''}${c.mod ? '⌘' : ''}${c.shift ? '⇧' : ''}${c.alt ? '⌥' : ''}${c.key}`;
  }
  const parts: string[] = [];
  if (c.mod || c.ctrl) parts.push('Ctrl');
  if (c.shift) parts.push('Shift');
  if (c.alt) parts.push('Alt');
  parts.push(c.key);
  return parts.join('+');
}
