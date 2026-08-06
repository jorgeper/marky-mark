import { describe, expect, test } from 'vitest';
import { modesAreExclusive, planModeSwitch, type Flavor } from '../../src/lib/modeSwitch';

/**
 * PRD 009 Req 4/5: the crossing decision — the pure half of "the two modes are
 * exclusive". Every entry point (Open File…, a window drop, Open Workspace…,
 * New Workspace) asks this before it does anything, so the four flavors and
 * the three modes are pinned here rather than in e2e alone.
 */

const FLAVORS: Flavor[] = ['tauri', 'browser', 'web', 'hosted'];

describe('PRD 009 Req 1: which flavors run the exclusive two-mode model', () => {
  test('U330: every non-desktop flavor is exclusive; Tauri keeps both modes', () => {
    expect(modesAreExclusive('tauri')).toBe(false);
    for (const kind of FLAVORS.filter((k) => k !== 'tauri')) {
      expect(modesAreExclusive(kind), kind).toBe(true);
    }
  });
});

describe('PRD 009 Req 4: the mode-switch plan', () => {
  test('U331: from the initial page every action just enters its mode', () => {
    expect(planModeSwitch('splash', 'file', true)).toBe('enter');
    expect(planModeSwitch('splash', 'workspace', true)).toBe('enter');
  });

  test('U332: a local file with a workspace open closes the workspace first', () => {
    expect(planModeSwitch('workspace', 'file', true)).toBe('close-workspace-first');
  });

  test('U333: a workspace flow in single-file mode closes the files first', () => {
    expect(planModeSwitch('file', 'workspace', true)).toBe('close-files-first');
  });

  test('U334: staying inside a mode is not a crossing', () => {
    // Req 2: "single file" means "no workspace", not "one document" — a
    // second local file joins the open set instead of closing the first.
    expect(planModeSwitch('file', 'file', true)).toBe('enter');
    // A workspace opened over a workspace is the existing replacement flow
    // (PRD 002 §D14 + issue #22's changed-untitled guard), not a mode exit.
    expect(planModeSwitch('workspace', 'workspace', true)).toBe('enter');
  });

  test('U335: desktop never crosses — a local file opens inside the workspace', () => {
    // PRD 009 Non-goals: Tauri behavior is untouched by this model.
    for (const mode of ['splash', 'file', 'workspace'] as const) {
      for (const target of ['file', 'workspace'] as const) {
        expect(planModeSwitch(mode, target, false), `${mode}→${target}`).toBe('enter');
      }
    }
  });
});
