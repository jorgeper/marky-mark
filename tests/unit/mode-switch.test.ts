import { describe, expect, test } from 'vitest';
import { modesAreExclusive, planModeSwitch, viewModeForOpen, type Flavor } from '../../src/lib/modeSwitch';

/**
 * PRD 009 Req 4/5: the crossing decision — the pure half of "the two modes are
 * exclusive". Every entry point (Open File…, a window drop, Open Workspace…,
 * New Workspace) asks this before it does anything, so the four flavors and
 * the three modes are pinned here rather than in e2e alone.
 */

const FLAVORS: Flavor[] = ['tauri', 'browser', 'web', 'hosted'];

describe('PRD 009 Req 1: which flavors run the exclusive two-mode model', () => {
  test('U847: every non-desktop flavor is exclusive; Tauri keeps both modes', () => {
    expect(modesAreExclusive('tauri')).toBe(false);
    for (const kind of FLAVORS.filter((k) => k !== 'tauri')) {
      expect(modesAreExclusive(kind), kind).toBe(true);
    }
  });
});

describe('PRD 009 Req 4: the mode-switch plan', () => {
  test('U848: from the initial page every action just enters its mode', () => {
    expect(planModeSwitch('splash', 'file', true)).toBe('enter');
    expect(planModeSwitch('splash', 'workspace', true)).toBe('enter');
  });

  test('U849: a local file with a workspace open closes the workspace first', () => {
    expect(planModeSwitch('workspace', 'file', true)).toBe('close-workspace-first');
  });

  test('U850: a workspace flow in single-file mode closes the files first', () => {
    expect(planModeSwitch('file', 'workspace', true)).toBe('close-files-first');
  });

  test('U851: staying inside a mode is not a crossing', () => {
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

describe('issue #125: the view mode a document opens in', () => {
  test('U911: the remembered mode wins, except where the edit grant says preview', () => {
    // The point of the setting: opening a file while editing keeps editing.
    expect(viewModeForOpen('edit', true)).toBe('edit');
    expect(viewModeForOpen('preview', true)).toBe('preview');
    // PRD 007 Req 17: a document this reader may not change opens in the
    // reading preview, whatever they were last doing.
    expect(viewModeForOpen('edit', false)).toBe('preview');
    expect(viewModeForOpen('preview', false)).toBe('preview');
  });

  test('U1002: SPEC35 §4.2 (issue #194) — a just-created file lands in edit mode, still never past the grant', () => {
    // Edit intent beats the remembered preview: the christening never lands
    // the user on an empty rendered page.
    expect(viewModeForOpen('preview', true, true)).toBe('edit');
    expect(viewModeForOpen('edit', true, true)).toBe('edit');
    // PRD 007 Req 17 still wins: no edit grant ⇒ preview, intent or not.
    expect(viewModeForOpen('preview', false, true)).toBe('preview');
    expect(viewModeForOpen('edit', false, true)).toBe('preview');
    // No intent (the default) is exactly the issue #125 rule above.
    expect(viewModeForOpen('preview', true, false)).toBe('preview');
  });
});
