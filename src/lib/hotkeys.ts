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
  // SPEC43 §5.1: Smart Edit.
  smartMenu: string;
  bold: string;
  italic: string;
  strikethrough: string;
  inlineCode: string;
  link: string;
  heading1: string;
  heading2: string;
  heading3: string;
  heading4: string;
  heading5: string;
  heading6: string;
  bulletList: string;
  numberedList: string;
  taskList: string;
  blockquote: string;
  codeBlock: string;
  horizontalRule: string;
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
  // SPEC43 §5.1 (Mod+E/Mod+K classics are taken by toggleEdit/headingPalette).
  smartMenu: 'Mod+.',
  bold: 'Mod+B',
  italic: 'Mod+I',
  strikethrough: 'Mod+Shift+X',
  inlineCode: 'Mod+Shift+M',
  link: 'Mod+Shift+K',
  heading1: 'Mod+1',
  heading2: 'Mod+2',
  heading3: 'Mod+3',
  heading4: 'Mod+4',
  heading5: 'Mod+5',
  heading6: 'Mod+6',
  bulletList: 'Mod+Shift+8',
  numberedList: 'Mod+Shift+7',
  taskList: 'Mod+Shift+9',
  blockquote: 'Mod+Shift+B',
  codeBlock: 'Mod+Alt+C',
  horizontalRule: 'Mod+Alt+-',
};

export interface ComboParts {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string; // uppercase single char or key name (e.g. "E", "F5")
}

export function parseCombo(combo: string): ComboParts | null {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: ComboParts = { mod: false, shift: false, alt: false, key: '' };
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === 'mod' || low === 'meta' || low === 'cmd' || low === 'ctrl' || low === 'control') out.mod = true;
    else if (low === 'shift') out.shift = true;
    else if (low === 'alt' || low === 'option') out.alt = true;
    else out.key = p.length === 1 ? p.toUpperCase() : p;
  }
  if (!out.key) return null;
  return out;
}

type ComboEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'> &
  Partial<Pick<KeyboardEvent, 'code'>>;

/** KeyboardEvent.code → canonical key for the punctuation Alt likes to remap. */
const CODE_KEYS: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  Period: '.',
  Comma: ',',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backslash: '\\',
};

/**
 * SPEC43 §5.1: Alt/Shift combos resolve through the PHYSICAL key. On macOS
 * ⌥ transforms `key` (⌘⌥C reports "ç", ⌘⌥- reports "–") and ⇧ shifts digits
 * (⌘⇧8 reports "*"), which would make such bindings layout-dependent —
 * record and match by `code` instead. Bare keys and Mod-only combos keep
 * the layout-aware `key` (a French user's ⌘Z stays ⌘Z).
 */
function eventKey(e: ComboEvent): string {
  if ((e.altKey || e.shiftKey) && typeof e.code === 'string') {
    const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code);
    if (m) return m[1] ?? m[2];
    if (CODE_KEYS[e.code]) return CODE_KEYS[e.code];
  }
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

/** Serialize a keyboard event into a canonical combo string, or null if it is only modifiers. */
export function comboFromEvent(e: ComboEvent): string | null {
  const key = e.key;
  if (key === 'Meta' || key === 'Control' || key === 'Shift' || key === 'Alt') return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('Mod');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  parts.push(eventKey(e));
  return parts.join('+');
}

/** Does this keyboard event match the stored combo? */
export function eventMatches(e: ComboEvent, combo: string): boolean {
  const c = parseCombo(combo);
  if (!c) return false;
  if (eventKey(e) !== c.key) return false;
  if (c.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (c.shift !== e.shiftKey) return false;
  if (c.alt !== e.altKey) return false;
  return true;
}

/** Human-readable form for the current platform ("⌘⇧C" on mac, "Ctrl+Shift+C" elsewhere). */
export function displayCombo(combo: string, isMac: boolean): string {
  const c = parseCombo(combo);
  if (!c) return combo;
  if (isMac) {
    return `${c.mod ? '⌘' : ''}${c.shift ? '⇧' : ''}${c.alt ? '⌥' : ''}${c.key}`;
  }
  const parts: string[] = [];
  if (c.mod) parts.push('Ctrl');
  if (c.shift) parts.push('Shift');
  if (c.alt) parts.push('Alt');
  parts.push(c.key);
  return parts.join('+');
}
