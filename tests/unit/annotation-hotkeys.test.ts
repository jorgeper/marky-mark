import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { combosConflict, DEFAULT_HOTKEYS, parseCombo, type HotkeyMap } from '@marky-mark/editor';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/lib/settings';

// PRD 023 Req 21 (issue #289): the two annotation hotkeys are asserted end to
// end in e2e (E460/E461) but their defaults, their settings round-trip and
// their place in the recorder were unpinned by any unit test — a rename or a
// silent default change would only surface in the slow lane.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** PRD 023 §12: the two annotation actions and the combos they ship with. */
const ANNOTATION_DEFAULTS = {
  insertComment: 'Mod+Alt+M',
  applyHighlight: 'Mod+Alt+H',
} as const;

describe('PRD 023 §12: the annotation hotkey defaults', () => {
  test('U1164: both ship on their documented combos, survive a parseSettings round-trip, and rebind like every other hotkey', () => {
    // The defaults themselves — the contract E460/E461 exercise in the app.
    expect(DEFAULT_HOTKEYS.insertComment).toBe('Mod+Alt+M');
    expect(DEFAULT_HOTKEYS.applyHighlight).toBe('Mod+Alt+H');
    // `Mod+` is the portable modifier; both parse as real combos.
    for (const combo of Object.values(ANNOTATION_DEFAULTS)) {
      expect(parseCombo(combo), combo).toMatchObject({ mod: true, alt: true });
    }
    // PRD 023 §12: no per-color hotkeys — Highlight carries the last-used
    // color, so the two actions above are the whole annotation vocabulary.
    const perColor = Object.keys(DEFAULT_HOTKEYS).filter((k) => /^highlight[A-Z]/.test(k));
    expect(perColor).toEqual([]);

    // Neither default collides with another shipped binding.
    for (const [action, combo] of Object.entries(ANNOTATION_DEFAULTS)) {
      const clashes = (Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>).filter(
        (k) => k !== action && combosConflict(DEFAULT_HOTKEYS[k], combo)
      );
      expect(clashes, `${action} ${combo}`).toEqual([]);
    }

    // Round-trip: a settings file that says nothing about them keeps the
    // defaults; one that rebinds them keeps the rebinding, and the other
    // entries fall back to default exactly as they do for any hotkey.
    const untouched = parseSettings(JSON.stringify({ hotkeys: { save: 'Mod+S' } }));
    expect(untouched.hotkeys.insertComment).toBe('Mod+Alt+M');
    expect(untouched.hotkeys.applyHighlight).toBe('Mod+Alt+H');

    const rebound = parseSettings(
      JSON.stringify({ hotkeys: { insertComment: 'Mod+Shift+Y', applyHighlight: 'Ctrl+Alt+K' } })
    );
    expect(rebound.hotkeys.insertComment).toBe('Mod+Shift+Y');
    expect(rebound.hotkeys.applyHighlight).toBe('Ctrl+Alt+K');
    expect(rebound.hotkeys.save).toBe(DEFAULT_HOTKEYS.save);

    // And the round-trip is stable: writing the parsed map back reads back
    // identical, so a rebinding persists rather than drifting on each load.
    expect(parseSettings(JSON.stringify(rebound)).hotkeys).toEqual(rebound.hotkeys);
    expect(DEFAULT_SETTINGS.hotkeys.insertComment).toBe('Mod+Alt+M');
    expect(DEFAULT_SETTINGS.hotkeys.applyHighlight).toBe('Mod+Alt+H');
  });

  test('U1165: both are reachable in the Settings → Hotkeys recorder — labelled rows, rendered off the label registry', () => {
    const panel = readFileSync(`${ROOT}src/components/SettingsPanel.tsx`, 'utf8');
    const registry = /const HOTKEY_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(panel)?.[1] ?? '';
    expect(registry, 'HOTKEY_LABELS').toBeTruthy();
    // A labelled entry each — the recorder shows a row per registry key, so
    // presence here is reachability (the `Record<keyof HotkeyMap, string>`
    // type keeps the registry total, this keeps the labels meaningful).
    for (const action of Object.keys(ANNOTATION_DEFAULTS)) {
      const label = new RegExp(`\\n\\s*${action}:\\s*'([^']+)'`).exec(registry)?.[1];
      expect(label, action).toBeTruthy();
    }
    // The rows are generated from the registry, not hand-listed.
    expect(panel).toMatch(/Object\.keys\(HOTKEY_LABELS\)\s+as\s+Array<keyof HotkeyMap>/);
  });
});
